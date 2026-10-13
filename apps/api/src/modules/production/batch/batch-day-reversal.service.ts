import { BadRequestException, Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { classifyPostedRow, ReversibleKind } from './batch-day-reversal';

const toMysqlTimestamp = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export interface UnpostResult {
  /** Daily entries put back to draft, their stock, cost and journals reversed. */
  unposted: number;
  /** Entries left posted, and why — a transfer, a death, a bio-asset batch's output or cost. */
  kept: Array<{ activity_name: string; animal_id: string | null; reason: string }>;
  consumption_reversed: boolean;
}

/**
 * Reopening a posted stage-day used to unlock it and nothing more: correcting an entry and posting it again ran its
 * whole dispatch a second time, so the stock was issued twice, the cost journalled twice and the batch cost counted
 * twice. This reverses what the day posted first — all of it, in one transaction, or none — and puts the entries
 * back to drafts with their values, so the corrected day posts exactly once.
 *
 * Nothing is deleted. A reversed batch transaction stays as the record of what was posted, marked reversed (every
 * reader of batch cost skips it); the ledger and the books carry their own reversing entries. What cannot be
 * reversed safely stays posted — see classifyPostedRow.
 */
@Injectable()
export class BatchDayReversalService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async unpostDay(
    batchId: string,
    stageId: string,
    dateStr: string,
    reason: string,
    tenantId: string,
    userId?: string,
  ): Promise<UnpostResult> {
    return withTenantTransaction(this.cls, async () => {
      const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
      if (!batch) throw new BadRequestException('Batch not found.');

      // The day's posted entries for this stage. A stage exists as a tenant row and a company copy, and a
      // scheduler can sit under either, so the stage is matched by code.
      const [stage] = await this.db.select({ stage_code: schema.stageMaster.stage_code }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
      const rows = await this.db
        .select({
          entry_id: schema.batchDailyData.entry_id,
          line_id: schema.batchDailyData.line_id,
          animal_id: schema.batchDailyData.animal_id,
          posting_reference: schema.batchDailyData.posting_reference,
          entered_value: schema.batchDailyData.entered_value,
          line_type: schema.schedulerLine.line_type,
          kpi_metric: schema.schedulerLine.kpi_metric,
          activity_name: schema.schedulerLine.activity_name,
        })
        .from(schema.batchDailyData)
        .innerJoin(schema.schedulerLine, eq(schema.batchDailyData.line_id, schema.schedulerLine.line_id))
        .innerJoin(schema.schedulerHeader, eq(schema.schedulerLine.scheduler_id, schema.schedulerHeader.scheduler_id))
        .innerJoin(schema.stageMaster, eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id))
        .where(
          and(
            eq(schema.batchDailyData.batch_id, batchId),
            eq(schema.batchDailyData.entry_date, dateStr),
            eq(schema.batchDailyData.posted, true),
            stage?.stage_code ? eq(schema.stageMaster.stage_code, stage.stage_code) : eq(schema.schedulerHeader.stage_id, stageId),
          ),
        );

      // An output posted as a sow's farrowing or weaning points at the litter's record, not at a batch transaction. It is
      // the litter's own record to correct, so it stays posted.
      const outputRefs = rows.filter((r) => r.line_type === 'OUTPUT' && r.posting_reference).map((r) => r.posting_reference as string);
      const litterIds = new Set(
        outputRefs.length
          ? (await this.db.select({ id: schema.farrowingRecord.farrow_id }).from(schema.farrowingRecord).where(inArray(schema.farrowingRecord.farrow_id, outputRefs))).map((l) => l.id)
          : [],
      );
      // A boar's output is a semen collection, which also has its own record (the lot, its stock and its QR).
      const collectionIds = new Set(
        outputRefs.length
          ? (await this.db.select({ id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch).where(inArray(schema.semenBatch.semen_batch_id, outputRefs))).map((l) => l.id)
          : [],
      );

      // An animal that has since left this stage (weaned to Dry Sow, transferred, dead) cannot have her entries for
      // this day posted again here — they would be stranded as drafts and her feed lost. Hers stay posted.
      const animalIds = [...new Set(rows.map((r) => r.animal_id).filter((x): x is string => !!x))];
      const whereNow = new Map(
        animalIds.length
          ? (
              await this.db
                .select({
                  animal_id: schema.animalRegister.animal_id,
                  animal_code: schema.animalRegister.animal_code,
                  is_active: schema.animalRegister.is_active,
                  batch_id: schema.animalRegister.current_batch_id,
                  stage_code: schema.stageMaster.stage_code,
                  stage_name: schema.stageMaster.stage_name,
                })
                .from(schema.animalRegister)
                .leftJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, schema.animalRegister.current_stage_id))
                .where(inArray(schema.animalRegister.animal_id, animalIds))
            ).map((a) => [a.animal_id, a])
          : [],
      );
      const hasLeft = (animalId: string | null) => {
        if (!animalId) return null;
        const a = whereNow.get(animalId);
        if (!a) return null;
        const stillHere = a.is_active && a.batch_id === batchId && (!stage?.stage_code || a.stage_code === stage.stage_code);
        return stillHere ? null : a;
      };

      const kept: UnpostResult['kept'] = [];
      const reversible: Array<(typeof rows)[number] & { kind: ReversibleKind }> = [];
      for (const row of rows) {
        const left = hasLeft(row.animal_id);
        if (left) {
          kept.push({
            activity_name: row.activity_name,
            animal_id: row.animal_id,
            reason: `${left.animal_code} has since left this stage${left.is_active && left.stage_name ? ` (now at ${left.stage_name})` : ''}, so her entries for the day could not be posted here again`,
          });
          continue;
        }
        if (row.posting_reference && litterIds.has(row.posting_reference)) {
          kept.push({ activity_name: row.activity_name, animal_id: row.animal_id, reason: 'it recorded a farrowing or weaning, which has its own record on the Breeding screen' });
          continue;
        }
        if (row.posting_reference && collectionIds.has(row.posting_reference)) {
          kept.push({ activity_name: row.activity_name, animal_id: row.animal_id, reason: 'it recorded a semen collection, which has its own record on the Breeding screen' });
          continue;
        }
        const verdict = classifyPostedRow(row, batch.costing_method);
        if (verdict.reversible) reversible.push({ ...row, kind: verdict.kind });
        else kept.push({ activity_name: row.activity_name, animal_id: row.animal_id, reason: verdict.reason });
      }

      // The batch transactions these entries made. A posting with no transaction behind it (posted before the daily
      // row recorded one) has nothing to reverse from; it stays posted.
      const refs = reversible.map((r) => r.posting_reference).filter((x): x is string => !!x);
      const txs = refs.length
        ? await this.db.select().from(schema.batchTransaction).where(and(inArray(schema.batchTransaction.transaction_id, refs), isNull(schema.batchTransaction.reversed_at)))
        : [];
      const txById = new Map(txs.map((t) => [t.transaction_id, t]));
      const toUnpost = reversible.filter((r) => {
        if (r.kind === 'OBSERVATION') return true;
        const tx = r.posting_reference ? txById.get(r.posting_reference) : undefined;
        if (!tx) {
          kept.push({ activity_name: r.activity_name, animal_id: r.animal_id, reason: 'it was posted before its transaction was recorded, so there is nothing to reverse from' });
          return false;
        }
        return true;
      });

      const reversedTxIds = new Set<string>();

      // CONSUMPTION — one ledger entry covers every animal that took the activity, so it is reversed once.
      const consumptionTxs = toUnpost.filter((r) => r.kind === 'CONSUMPTION').map((r) => txById.get(r.posting_reference!)!);
      const ledgerIds = [...new Set(consumptionTxs.map((t) => t.ledger_id).filter((x): x is string => !!x))];
      for (const ledgerId of ledgerIds) await this.reverseIssue(batch, ledgerId, tenantId, userId);
      if (ledgerIds.length) {
        const group = await this.db.select({ transaction_id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction)
          .where(and(inArray(schema.batchTransaction.ledger_id, ledgerIds), isNull(schema.batchTransaction.reversed_at)));
        group.forEach((g) => reversedTxIds.add(g.transaction_id));
      }

      // OUTPUT — a main output nothing has used yet leaves stock again.
      for (const r of toUnpost.filter((x) => x.kind === 'OUTPUT')) {
        const tx = txById.get(r.posting_reference!)!;
        await this.reverseOutput(tx, tenantId, userId);
        reversedTxIds.add(tx.transaction_id);
      }

      // COST — the journal the overhead posted is found by what it recorded and reversed on its own accounts.
      for (const r of toUnpost.filter((x) => x.kind === 'COST')) {
        const tx = txById.get(r.posting_reference!)!;
        await this.reverseCost(batch, tx, r.activity_name, tenantId, userId);
        reversedTxIds.add(tx.transaction_id);
      }

      // OBSERVATION — the informational ledger rows a value left behind are negated.
      for (const lineId of [...new Set(toUnpost.filter((x) => x.kind === 'OBSERVATION').map((x) => x.line_id))]) {
        await this.negateInformationalRows(lineId, dateStr, tenantId, userId);
      }

      const now = toMysqlTimestamp();
      if (reversedTxIds.size) {
        await this.db.update(schema.batchTransaction)
          .set({ reversed_at: now, reversed_by: userId ?? null })
          .where(inArray(schema.batchTransaction.transaction_id, [...reversedTxIds]));
        for (const id of reversedTxIds) {
          await this.auditService.log({
            tenantId, companyId: batch.company_id, userId, action: 'REVERSE', entityName: 'batch_transaction', entityId: id,
            oldValues: { reversed_at: null }, newValues: { reversed_at: now, reason },
          });
        }
      }

      if (toUnpost.length) {
        await this.db.update(schema.batchDailyData)
          .set({ posted: false, posting_reference: null, updated_by: userId ?? null, updated_at: now })
          .where(inArray(schema.batchDailyData.entry_id, toUnpost.map((r) => r.entry_id)));
      }

      return { unposted: toUnpost.length, kept, consumption_reversed: ledgerIds.length > 0 };
    });
  }

  /** An issue is reversed at its own cost with the layers it drew restored; its journal is mirrored; a premature bio-asset batch's capitalised cost comes back out. */
  private async reverseIssue(batch: typeof schema.batchHeader.$inferSelect, ledgerId: string, tenantId: string, userId?: string) {
    const [original] = await this.db.select().from(schema.inventoryLedger).where(eq(schema.inventoryLedger.ledger_id, ledgerId)).limit(1);
    const reversal = await this.ledgerService.reverseEntry(ledgerId, tenantId, userId);
    await this.glPostingService.reverseInventoryJournal(ledgerId, reversal, userId);

    if (original?.transaction_type === 'BIO_CONSUMPTION_PREMATURE') {
      const capitalised = Math.abs(Number(original.amount));
      const [state] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, batch.batch_id)).limit(1);
      if (state) {
        await this.db.update(schema.batchBioAssetState)
          .set({ nca_book_value: Math.max(0, Number(state.nca_book_value) - capitalised).toString(), updated_at: toMysqlTimestamp() })
          .where(eq(schema.batchBioAssetState.batch_id, batch.batch_id));
      }
      await this.db.insert(schema.bioAssetLedger).values({
        entry_id: randomUUID(), tenant_id: tenantId, company_id: batch.company_id,
        bio_asset_item_id: original.item_id ?? '', entry_type: 'CONSUMPTION', document_no: batch.batch_no,
        batch_id: batch.batch_id, batch_no: batch.batch_no, posting_date: original.posting_date, stage: 'PREMATURE',
        quantity: (-Math.abs(Number(original.quantity))).toString(), cost_amount: (-capitalised).toString(),
        cost_amount_each_unit: original.rate, costing_method: 'COST_ACCUMULATION',
        nob_id: batch.nob_id, lob_id: batch.lob_id, created_by: userId || null,
      });
    }
  }

  private async reverseOutput(tx: typeof schema.batchTransaction.$inferSelect, tenantId: string, userId?: string) {
    if (!tx.ledger_id) throw new BadRequestException('An output with no stock entry behind it cannot be reversed.');

    // A pack or a QC result attached to this output ties it to something already issued; that is not undone silently.
    const [pack] = await this.db.select({ id: schema.qrCodeMaster.qr_id }).from(schema.qrCodeMaster).where(eq(schema.qrCodeMaster.output_line_id, tx.transaction_id)).limit(1);
    if (pack) throw new BadRequestException('A QR pack has been generated from this output, so it cannot be taken back. Void the pack first.');
    const [qc] = await this.db.select({ id: schema.qcBatchDetail.qc_id }).from(schema.qcBatchDetail).where(eq(schema.qcBatchDetail.output_line_id, tx.transaction_id)).limit(1);
    if (qc) throw new BadRequestException('A QC result is recorded against this output, so it cannot be taken back.');

    const reversal = await this.ledgerService.reversePositiveEntry(tx.ledger_id, tenantId, userId);
    // An output posted at no value made no journal; there is then nothing to mirror.
    const [journal] = await this.db.select({ id: schema.journalHeader.journal_id }).from(schema.journalHeader)
      .where(and(eq(schema.journalHeader.source_ledger_id, tx.ledger_id), eq(schema.journalHeader.status, 'POSTED'))).limit(1);
    if (journal) await this.glPostingService.reverseInventoryJournal(tx.ledger_id, reversal, userId);
    await this.db.delete(schema.batchOutputLine).where(eq(schema.batchOutputLine.line_id, tx.transaction_id));
  }

  private async reverseCost(
    batch: typeof schema.batchHeader.$inferSelect,
    tx: typeof schema.batchTransaction.$inferSelect,
    activityName: string,
    tenantId: string,
    userId?: string,
  ) {
    const amount = Math.abs(Number(tx.amount ?? 0));
    if (amount >= 0.005) {
      // The description addTransaction gave the journal: the entry's remarks, else the stock phrase.
      const description = tx.remarks || `Overhead — ${batch.batch_no}`;
      const journal = await this.glPostingService.findBatchCostJournal({
        tenantId, companyId: batch.company_id, documentNo: batch.batch_no, postingDate: String(tx.transaction_date).slice(0, 10), amount, description,
      });
      if (!journal) {
        throw new BadRequestException(`The journal for '${activityName}' on ${String(tx.transaction_date).slice(0, 10)} could not be found, so it cannot be reversed. Nothing has been changed.`);
      }
      await this.glPostingService.reverseJournal(journal.journal_id, String(tx.transaction_date).slice(0, 10), description, userId);
    }
    await this.negateRows(
      and(eq(schema.inventoryLedger.document_line_id, tx.transaction_id), eq(schema.inventoryLedger.entry_type, 'OVERHEAD'), eq(schema.inventoryLedger.tenant_id, tenantId)),
      tenantId, userId,
    );
  }

  private async negateInformationalRows(lineId: string, dateStr: string, tenantId: string, userId?: string) {
    await this.negateRows(
      and(
        eq(schema.inventoryLedger.document_line_id, lineId), eq(schema.inventoryLedger.posting_date, dateStr),
        eq(schema.inventoryLedger.entry_type, 'DESCRIPTIVE'), eq(schema.inventoryLedger.tenant_id, tenantId),
      ),
      tenantId, userId,
    );
  }

  /** Writes the opposite of each informational ledger row not already negated. They move no stock; they would only be counted twice. */
  private async negateRows(where: ReturnType<typeof and>, tenantId: string, userId?: string) {
    const originals = await this.db.select().from(schema.inventoryLedger).where(where);
    for (const original of originals) {
      if (original.transaction_type === 'REVERSAL') continue;
      const [done] = await this.db.select({ id: schema.inventoryLedger.ledger_id }).from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.external_reference_no, original.ledger_id), eq(schema.inventoryLedger.transaction_type, 'REVERSAL'), eq(schema.inventoryLedger.tenant_id, tenantId))).limit(1);
      if (done) continue;
      const { created_at: _c, entry_no: _e, ...rest } = original;
      await this.db.insert(schema.inventoryLedger).values({
        ...rest, ledger_id: randomUUID(), transaction_type: 'REVERSAL',
        quantity: (-Number(original.quantity)).toString(), amount: (-Number(original.amount)).toString(),
        external_reference_no: original.ledger_id, created_by: userId || null,
      });
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export interface MortalityReversal {
  transaction_id: string;
  batch_no: string;
  quantity: number;
  animal_code: string | null;
  write_off_reversed: number;
}

/**
 * Takes back a death that was recorded in error (audit C7). A death is reversed, never edited: the animal chosen is
 * live again and everything the death posted is put back — in one transaction, or nothing.
 *
 *  - the batch's head (closing quantity; a bio-asset batch's head and carrying value too) and its stage counts;
 *  - the write-off journal, by its exact opposite (the journal is found as the day's reopen finds it);
 *  - the bio-asset ledger: the batch's share and the animal's own value, each by an opposite row;
 *  - the animal: live and ACTIVE again, its disposal cleared, the movement log saying the death was reversed;
 *  - the MORTALITY transaction is marked reversed — kept as the record of what was posted, skipped by every reader.
 *
 * Which animal comes back is never guessed: a death names its animal (an animal-wise batch refuses an anonymous one),
 * and a head-count death is reversed as the head count it was.
 */
@Injectable()
export class BatchMortalityReversalService {
  constructor(
    private readonly cls: ClsService,
    private readonly glPostingService: GlPostingService,
    private readonly schedulerHeaderService: SchedulerHeaderService,
    private readonly movementLog: AnimalMovementLogService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async reverse(
    batchId: string,
    transactionId: string,
    reason: string,
    tenantId: string,
    userId?: string,
  ): Promise<MortalityReversal> {
    if (!reason?.trim()) throw new BadRequestException('Give the reason the death is being reversed.');
    return withTenantTransaction(this.cls, async () => {
      const [batch] = await this.db
        .select()
        .from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId)))
        .for('update');
      if (!batch) throw new NotFoundException(`Batch '${batchId}' not found.`);
      if (batch.status !== 'ACTIVE') {
        throw new BadRequestException(`${batch.batch_no} is ${batch.status}: a death can be reversed only on an active batch.`);
      }

      const [tx] = await this.db
        .select()
        .from(schema.batchTransaction)
        .where(and(eq(schema.batchTransaction.transaction_id, transactionId), eq(schema.batchTransaction.batch_id, batchId)))
        .limit(1);
      if (!tx || tx.transaction_type !== 'MORTALITY') {
        throw new NotFoundException('That death is not recorded on this batch.');
      }
      if (tx.reversed_at) throw new BadRequestException('This death has already been reversed.');

      const quantity = Number(tx.quantity || 0);
      const writeOff = Math.abs(Number(tx.amount ?? 0));
      const deathDate = String(tx.transaction_date).slice(0, 10);

      // ── The animal comes back first: if she cannot, nothing else moves.
      let animal: typeof schema.animalRegister.$inferSelect | undefined;
      if (tx.animal_id) {
        [animal] = await this.db
          .select()
          .from(schema.animalRegister)
          .where(eq(schema.animalRegister.animal_id, tx.animal_id))
          .for('update');
        if (!animal || animal.is_active || animal.disposal_type !== 'DIED' || animal.current_batch_id !== batchId) {
          throw new BadRequestException(
            `${animal?.animal_code ?? 'The animal'} is not recorded as having died in ${batch.batch_no}, so this death cannot be reversed.`,
          );
        }
        await this.db
          .update(schema.animalRegister)
          .set({
            is_active: true,
            status: 'ACTIVE',
            disposal_type: null,
            disposal_date: null,
            disposal_reason_id: null,
            updated_by: userId ?? null,
            updated_at: toMysqlTimestamp(),
          })
          .where(eq(schema.animalRegister.animal_id, animal.animal_id));

        // Her own value, written out of her own ledger at death, goes back in.
        const [own] = await this.db
          .select()
          .from(schema.bioAssetLedger)
          .where(
            and(
              eq(schema.bioAssetLedger.animal_id, animal.animal_id),
              eq(schema.bioAssetLedger.entry_type, 'MORTALITY'),
              isNull(schema.bioAssetLedger.batch_id),
              sql`${schema.bioAssetLedger.cost_amount} < 0`,
            ),
          )
          .orderBy(desc(schema.bioAssetLedger.created_at))
          .limit(1);
        if (own) await this.writeOpposite(own, 'ACTIVE', userId);

        await this.movementLog.record({
          tenantId,
          companyId: batch.company_id,
          animalId: animal.animal_id,
          movementType: 'MORTALITY_REVERSED',
          eventDate: deathDate,
          toBatchId: batchId,
          toStageId: animal.current_stage_id,
          toLocationId: animal.current_location_id,
          entryNo: batch.batch_no,
          reason: reason.trim(),
          userId,
        });
      }

      // ── The write-off journal, by its exact opposite. A death at nil value journalled nothing.
      if (writeOff >= 0.005) {
        const description = `Mortality — ${batch.batch_no}`;
        const journal = await this.glPostingService.findBatchCostJournal({
          tenantId,
          companyId: batch.company_id,
          documentNo: batch.batch_no,
          postingDate: deathDate,
          amount: writeOff,
          description,
        });
        if (!journal) {
          throw new BadRequestException(
            `The write-off journal of this death (${writeOff.toFixed(2)} on ${deathDate}) could not be found, so it cannot be reversed. Nothing has been changed.`,
          );
        }
        await this.glPostingService.reverseJournal(journal.journal_id, deathDate, description, userId);
      }

      // ── The batch's head, and a bio-asset batch's carrying value with the ledger row that took it out.
      if (batch.costing_method === 'BIO_ASSET') {
        const [state] = await this.db
          .select()
          .from(schema.batchBioAssetState)
          .where(eq(schema.batchBioAssetState.batch_id, batchId))
          .limit(1);
        if (state) {
          await this.db
            .update(schema.batchBioAssetState)
            .set({
              current_quantity: (Number(state.current_quantity) + quantity).toString(),
              nca_book_value: (Number(state.nca_book_value) + writeOff).toString(),
              updated_at: toMysqlTimestamp(),
            })
            .where(eq(schema.batchBioAssetState.batch_id, batchId));
        }
        const [share] = await this.db
          .select()
          .from(schema.bioAssetLedger)
          .where(
            and(
              eq(schema.bioAssetLedger.batch_id, batchId),
              eq(schema.bioAssetLedger.entry_type, 'MORTALITY'),
              eq(schema.bioAssetLedger.posting_date, deathDate),
              tx.animal_id ? eq(schema.bioAssetLedger.animal_id, tx.animal_id) : isNull(schema.bioAssetLedger.animal_id),
              sql`${schema.bioAssetLedger.quantity} = ${(-quantity).toString()}`,
            ),
          )
          .orderBy(desc(schema.bioAssetLedger.created_at))
          .limit(1);
        if (share) await this.writeOpposite(share, null, userId);
      }
      await this.db
        .update(schema.batchHeader)
        .set({
          closing_quantity: sql`COALESCE(${schema.batchHeader.closing_quantity}, ${schema.batchHeader.opening_quantity}, 0) + ${quantity}`,
          updated_by: userId ?? null,
          updated_at: toMysqlTimestamp(),
        })
        .where(eq(schema.batchHeader.batch_id, batchId));

      // ── Stage counts: an animal-wise batch recounts its register; a head-count batch's stage gets its head back.
      if (batch.tracking_mode === 'ANIMAL_WISE') {
        await this.schedulerHeaderService.syncAnimalWiseCounts(batchId);
      } else if (batch.stage_id) {
        const [stage] = await this.db
          .select({ stage_code: schema.stageMaster.stage_code })
          .from(schema.stageMaster)
          .where(eq(schema.stageMaster.stage_id, batch.stage_id))
          .limit(1);
        const [header] = await this.db
          .select({ scheduler_id: schema.schedulerHeader.scheduler_id })
          .from(schema.schedulerHeader)
          .innerJoin(schema.stageMaster, eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id))
          .where(
            and(
              eq(schema.schedulerHeader.batch_id, batchId),
              stage?.stage_code
                ? eq(schema.stageMaster.stage_code, stage.stage_code)
                : eq(schema.schedulerHeader.stage_id, batch.stage_id),
            ),
          )
          .limit(1);
        if (header) {
          await this.db
            .update(schema.schedulerHeader)
            .set({ animal_count: sql`${schema.schedulerHeader.animal_count} + ${quantity}`, updated_at: toMysqlTimestamp() })
            .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
        }
      }

      const now = toMysqlTimestamp();
      await this.db
        .update(schema.batchTransaction)
        .set({ reversed_at: now, reversed_by: userId ?? null })
        .where(eq(schema.batchTransaction.transaction_id, transactionId));
      await this.auditService.log({
        tenantId,
        companyId: batch.company_id,
        userId,
        action: 'REVERSE',
        entityName: 'batch_transaction',
        entityId: transactionId,
        oldValues: { transaction_type: 'MORTALITY', reversed_at: null },
        newValues: { reversed_at: now, reason: reason.trim(), animal_id: tx.animal_id ?? null, quantity },
      });

      return {
        transaction_id: transactionId,
        batch_no: batch.batch_no,
        quantity,
        animal_code: animal?.animal_code ?? null,
        write_off_reversed: writeOff,
      };
    });
  }

  /** The opposite of a bio-asset ledger row: same item, batch and animal, quantity and value negated. */
  private async writeOpposite(row: typeof schema.bioAssetLedger.$inferSelect, status: string | null, userId?: string) {
    const { entry_id: _id, created_at: _created, ...rest } = row;
    await this.db.insert(schema.bioAssetLedger).values({
      ...rest,
      entry_id: randomUUID(),
      quantity: (-Number(row.quantity)).toString(),
      cost_amount: (-Number(row.cost_amount ?? 0)).toString(),
      status: status ?? row.status,
      created_by: userId ?? null,
    });
  }
}

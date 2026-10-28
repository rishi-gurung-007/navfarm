import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, isNull, count, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateJournalDto, UpdateJournalDto, QueryJournalDto } from './dto/journal.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

interface SystemJournalLineInput {
  glAccountId: string;
  costCenterId?: string;
  debitAmount: number;
  creditAmount: number;
  description?: string;
  nobId?: string;
  lobId?: string;
}

@Injectable()
export class JournalService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
  ) { }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * The readable journal number (JE-000001), from the company's Journal series: the one configured on the Number
   * Series master, else a built-in default made the first time a journal is written and carrying on after the highest
   * number the company already holds. `executor` must be the active transaction when called from inside one (both
   * callers below do this): the series row is locked until the journal is inserted, so two postings never share a
   * number and a failed posting gives its number back. This is the hottest of the document-number generators — every
   * domain's GL auto-posting routes through `createAndPostSystemJournal` — so the series is found with one lookup and
   * the taken-code check asks about one candidate, not the whole table.
   */
  private async generateJournalNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const seriesCode = await this.numberSeriesService.seriesCodeForDocument(
      tenantId,
      companyId,
      { seriesCode: 'JOURNAL', seriesName: 'Journal Entry Number', documentType: 'JOURNAL', prefix: 'JE', separator: '-', seqLength: 6 },
      async () => (await this.db.select({ no: schema.journalHeader.journal_no }).from(schema.journalHeader)
        .where(and(eq(schema.journalHeader.tenant_id, tenantId), eq(schema.journalHeader.company_id, companyId)))).map((r) => r.no),
    );
    return this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, executor);
  }

  private sumLines(lines: { debit_amount?: number; credit_amount?: number }[]) {
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit_amount || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit_amount || 0), 0);
    return { totalDebit, totalCredit };
  }

  // Manual journal lines carry a client-supplied gl_account_id — the DB FK
  // only guarantees the row exists somewhere in the tenant DB, not that it
  // belongs to this journal's company or is still postable. Without this,
  // a journal for Company A could post against Company B's chart of
  // accounts (both live in the same physical tenant database), or against
  // an account that's since been deactivated.
  private async validateJournalAccounts(companyId: string, lines: { gl_account_id: string }[]) {
    const accountIds = [...new Set(lines.map((l) => l.gl_account_id))];
    const accounts = await this.db
      .select({
        gl_account_id: schema.glAccountMaster.gl_account_id,
        account_code: schema.glAccountMaster.account_code,
        company_id: schema.glAccountMaster.company_id,
        is_active: schema.glAccountMaster.is_active,
      })
      .from(schema.glAccountMaster)
      .where(inArray(schema.glAccountMaster.gl_account_id, accountIds));

    const byId = new Map(accounts.map((a) => [a.gl_account_id, a]));
    for (const id of accountIds) {
      const account = byId.get(id);
      if (!account) {
        throw new BadRequestException(`GL account '${id}' not found.`);
      }
      if (account.company_id !== companyId) {
        throw new BadRequestException(`GL account '${account.account_code}' does not belong to this company.`);
      }
      if (!account.is_active) {
        throw new BadRequestException(`GL account '${account.account_code}' is inactive and cannot be posted to.`);
      }
    }
  }

  // --- Manual journal entries (draft -> post lifecycle) ---

  async create(dto: CreateJournalDto, tenantId: string, userPayload?: any) {
    await this.validateJournalAccounts(dto.company_id, dto.lines);

    const journalId = randomUUID();
    const { totalDebit, totalCredit } = this.sumLines(dto.lines);

    const journalNo = await this.db.transaction(async (tx) => {
      const no = await this.generateJournalNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.journalHeader).values({
        journal_id: journalId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        journal_no: no,
        posting_date: dto.posting_date,
        source: 'MANUAL',
        description: dto.description || null,
        status: 'DRAFT',
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.insertLines(journalId, dto.lines);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'journal_header',
      entityId: journalId,
      newValues: { journal_no: journalNo, ...dto },
    });

    return this.findOne(journalId);
  }

  private async insertLines(journalId: string, lines: CreateJournalDto['lines']) {
    await this.db.insert(schema.journalLine).values(
      lines.map((line, idx) => ({
        line_id: randomUUID(),
        journal_id: journalId,
        line_no: idx + 1,
        gl_account_id: line.gl_account_id,
        cost_center_id: line.cost_center_id || null,
        debit_amount: (line.debit_amount || 0).toString(),
        credit_amount: (line.credit_amount || 0).toString(),
        description: line.description || null,
      }))
    );
  }

  async findOne(id: string) {
    const [journal] = await this.db
      .select()
      .from(schema.journalHeader)
      .where(and(eq(schema.journalHeader.journal_id, id), isNull(schema.journalHeader.deleted_at)))
      .limit(1);

    if (!journal) {
      throw new NotFoundException(`Journal Entry with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.journalLine)
      .where(eq(schema.journalLine.journal_id, id));

    return { ...journal, lines };
  }

  // The document a system journal was posted from, with codes and names filled in, so the
  // journal page can show it read-only without loading every master list.
  async findSourceDocument(id: string) {
    const journal = await this.findOne(id);
    const type = journal.source_document_type;
    const no = journal.source_document_no;
    if (!type || !no) throw new NotFoundException(`Journal Entry '${journal.journal_no}' has no source document.`);
    const tenant = journal.tenant_id;
    const notFound = () => new NotFoundException(`${no} was not found.`);
    const result = (header: Record<string, unknown>, lines: Record<string, unknown>[] = []) => ({ type, document_no: no, header, lines });

    if (type === 'GOODS_RECEIPT') {
      const [doc] = await this.db.select().from(schema.goodsReceipt)
        .where(and(eq(schema.goodsReceipt.tenant_id, tenant), eq(schema.goodsReceipt.receipt_no, no))).limit(1);
      if (!doc) throw notFound();
      const lines = await this.db.select().from(schema.goodsReceiptLine)
        .where(eq(schema.goodsReceiptLine.receipt_id, doc.receipt_id)).orderBy(schema.goodsReceiptLine.line_no);
      const [locations, items, suppliers] = await Promise.all([
        this.locationNames([doc.warehouse_id]), this.itemNames(lines.map((l) => l.item_id)), this.supplierNames([doc.supplier_id]),
      ]);
      return result(
        { status: doc.status, posting_date: doc.posting_date, warehouse: locations.get(doc.warehouse_id), supplier: suppliers.get(doc.supplier_id), reference: doc.external_reference_no, posted_at: doc.posted_at, remarks: doc.remarks },
        lines.map((l) => ({ ...items.get(l.item_id), quantity: l.quantity, uom: l.uom, rate: l.rate, amount: l.amount, lot_no: l.lot_no, serial_no: l.serial_no })),
      );
    }

    if (type === 'STOCK_ADJUSTMENT') {
      const [doc] = await this.db.select().from(schema.stockAdjustment)
        .where(and(eq(schema.stockAdjustment.tenant_id, tenant), eq(schema.stockAdjustment.adjustment_no, no))).limit(1);
      if (!doc) throw notFound();
      const lines = await this.db.select().from(schema.stockAdjustmentLine)
        .where(eq(schema.stockAdjustmentLine.adjustment_id, doc.adjustment_id)).orderBy(schema.stockAdjustmentLine.line_no);
      const [locations, items] = await Promise.all([this.locationNames([doc.warehouse_id]), this.itemNames(lines.map((l) => l.item_id))]);
      return result(
        { status: doc.status, posting_date: doc.posting_date, warehouse: locations.get(doc.warehouse_id), reason: doc.reason, posted_at: doc.posted_at, remarks: doc.remarks },
        lines.map((l) => ({ ...items.get(l.item_id), quantity: l.quantity, uom: l.uom, rate: l.rate, lot_no: l.lot_no, serial_no: l.serial_no })),
      );
    }

    if (type === 'STOCK_TRANSFER') {
      // A transfer posts twice: the shipment (SH-…) out of the source and the receipt (RC-…) into the destination.
      const [shipment] = await this.db.select().from(schema.transferShipment)
        .where(and(eq(schema.transferShipment.tenant_id, tenant), eq(schema.transferShipment.shipment_no, no))).limit(1);
      const [receipt] = shipment ? [] : await this.db.select().from(schema.transferReceipt)
        .where(and(eq(schema.transferReceipt.tenant_id, tenant), eq(schema.transferReceipt.receipt_no, no))).limit(1);
      const transferId = shipment?.transfer_id ?? receipt?.transfer_id;
      if (!transferId) throw notFound();
      const [transfer] = await this.db.select().from(schema.stockTransfer).where(eq(schema.stockTransfer.transfer_id, transferId)).limit(1);
      const moved = shipment
        ? await this.db.select({ line_id: schema.transferShipmentLine.line_id, quantity: schema.transferShipmentLine.quantity, uom: schema.transferShipmentLine.uom, lot_no: schema.transferShipmentLine.lot_no, serial_no: schema.transferShipmentLine.serial_no })
          .from(schema.transferShipmentLine).where(eq(schema.transferShipmentLine.shipment_id, shipment.shipment_id))
        : await this.db.select({ line_id: schema.transferReceiptLine.line_id, quantity: schema.transferReceiptLine.quantity, uom: schema.transferReceiptLine.uom, lot_no: schema.transferReceiptLine.lot_no, serial_no: schema.transferReceiptLine.serial_no })
          .from(schema.transferReceiptLine).where(eq(schema.transferReceiptLine.receipt_id, receipt!.receipt_id));
      const orderLines = moved.length
        ? await this.db.select({ line_id: schema.stockTransferLine.line_id, item_id: schema.stockTransferLine.item_id })
          .from(schema.stockTransferLine).where(inArray(schema.stockTransferLine.line_id, moved.map((l) => l.line_id)))
        : [];
      const itemOf = new Map(orderLines.map((l) => [l.line_id, l.item_id]));
      const [locations, items] = await Promise.all([
        this.locationNames([transfer?.from_warehouse_id, transfer?.to_warehouse_id]),
        this.itemNames(orderLines.map((l) => l.item_id)),
      ]);
      return result(
        {
          kind: shipment ? 'SHIPMENT' : 'RECEIPT',
          status: (shipment ?? receipt)!.status,
          date: shipment ? shipment.shipment_date : receipt!.receipt_date,
          transfer_no: transfer?.transfer_no,
          from_warehouse: locations.get(transfer?.from_warehouse_id),
          to_warehouse: locations.get(transfer?.to_warehouse_id),
          vehicle_no: transfer?.vehicle_no,
        },
        moved.map((l) => ({ ...items.get(itemOf.get(l.line_id)), quantity: l.quantity, uom: l.uom, lot_no: l.lot_no, serial_no: l.serial_no })),
      );
    }

    if (type === 'BATCH') {
      const [doc] = await this.db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.tenant_id, tenant), eq(schema.batchHeader.batch_no, no))).limit(1);
      if (!doc) throw notFound();
      const [breed] = doc.breed_id
        ? await this.db.select({ breed_name: schema.breedMaster.breed_name }).from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, doc.breed_id)).limit(1)
        : [];
      const [stage] = doc.stage_id
        ? await this.db.select({ stage_name: schema.stageMaster.stage_name }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, doc.stage_id)).limit(1)
        : [];
      const locations = await this.locationNames([doc.shed_id, doc.location_id]);
      return result({
        status: doc.status, breed: breed?.breed_name, stage: stage?.stage_name ?? doc.current_stage_code,
        shed: locations.get(doc.shed_id) ?? locations.get(doc.location_id), start_date: doc.start_date,
        expected_end_date: doc.expected_end_date, actual_end_date: doc.actual_end_date,
        opening_quantity: doc.opening_quantity, closing_quantity: doc.closing_quantity, uom: doc.uom,
        costing_method: doc.costing_method, total_cost: doc.total_cost, unit_cost: doc.unit_cost,
      });
    }

    if (type === 'EXPENSE') {
      const [doc] = await this.db.select().from(schema.expenseDocument)
        .where(and(eq(schema.expenseDocument.tenant_id, tenant), eq(schema.expenseDocument.document_no, no))).limit(1);
      if (!doc) throw notFound();
      const [accounts, locations] = await Promise.all([
        this.glAccountNames([doc.expense_gl_account_id, doc.payment_gl_account_id]),
        this.locationNames([doc.location_id, doc.sub_location_id]),
      ]);
      return result({
        status: doc.status, posting_date: doc.posting_date, payee: doc.payee, description: doc.description,
        amount: doc.amount, expense_account: accounts.get(doc.expense_gl_account_id),
        payment_account: accounts.get(doc.payment_gl_account_id), location: locations.get(doc.location_id),
        sub_location: locations.get(doc.sub_location_id), remarks: doc.remarks,
      });
    }

    if (type === 'MILL_PRODUCTION_OUTPUT') {
      const [doc] = await this.db.select().from(schema.millProductionOutput)
        .where(and(eq(schema.millProductionOutput.tenant_id, tenant), eq(schema.millProductionOutput.output_no, no))).limit(1);
      if (!doc) throw notFound();
      const [locations, items] = await Promise.all([
        this.locationNames([doc.mill_location_id, doc.bin_location_id]), this.itemNames([doc.item_id]),
      ]);
      return result(
        { status: doc.status, production_date: doc.production_date, mill: locations.get(doc.mill_location_id), bin: locations.get(doc.bin_location_id), remarks: doc.remarks },
        [{ ...items.get(doc.item_id), quantity: doc.quantity_kg, uom: 'KG', rate: doc.rate, amount: doc.amount, lot_no: doc.lot_no }],
      );
    }

    throw new BadRequestException(`Source documents of type ${type} cannot be shown here.`);
  }

  private async locationNames(ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = wanted.length
      ? await this.db.select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, wanted))
      : [];
    return new Map<string | null | undefined, string>(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
  }

  private async itemNames(ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = wanted.length
      ? await this.db.select({ id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, wanted))
      : [];
    return new Map<string | null | undefined, { item_code: string; item_name: string }>(rows.map((r) => [r.id, { item_code: r.item_code, item_name: r.item_name }]));
  }

  private async supplierNames(ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = wanted.length
      ? await this.db.select({ id: schema.supplierMaster.supplier_id, code: schema.supplierMaster.supplier_code, name: schema.supplierMaster.supplier_name })
        .from(schema.supplierMaster).where(inArray(schema.supplierMaster.supplier_id, wanted))
      : [];
    return new Map<string | null | undefined, string>(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
  }

  private async glAccountNames(ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    const rows = wanted.length
      ? await this.db.select({ id: schema.glAccountMaster.gl_account_id, code: schema.glAccountMaster.account_code, name: schema.glAccountMaster.account_name })
        .from(schema.glAccountMaster).where(inArray(schema.glAccountMaster.gl_account_id, wanted))
      : [];
    return new Map<string | null | undefined, string>(rows.map((r) => [r.id, `${r.code} · ${r.name}`]));
  }

  async findAll(query: QueryJournalDto, tenantId: string) {
    const conditions: any[] = [eq(schema.journalHeader.tenant_id, tenantId), isNull(schema.journalHeader.deleted_at)];

    if (query.companyId) conditions.push(eq(schema.journalHeader.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.journalHeader.status, query.status));
    if (query.source) conditions.push(eq(schema.journalHeader.source, query.source));
    if (query.search) conditions.push(like(schema.journalHeader.journal_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.journalHeader)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(journal: { status: string }) {
    if (journal.status !== 'DRAFT') {
      throw new BadRequestException(`Journal Entry cannot be modified — it is already ${journal.status}.`);
    }
  }

  async update(id: string, dto: UpdateJournalDto, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.description !== undefined) updates.description = dto.description;

    if (dto.lines) {
      await this.validateJournalAccounts(journal.company_id, dto.lines);
      const { totalDebit, totalCredit } = this.sumLines(dto.lines);
      updates.total_debit = totalDebit.toString();
      updates.total_credit = totalCredit.toString();
    }

    await this.db.update(schema.journalHeader).set(updates).where(eq(schema.journalHeader.journal_id, id));

    if (dto.lines) {
      await this.db.delete(schema.journalLine).where(eq(schema.journalLine.journal_id, id));
      await this.insertLines(id, dto.lines);
    }

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'journal_header',
      entityId: id,
      oldValues: journal,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.journalHeader)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.journalHeader.journal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'journal_header',
      entityId: id,
      oldValues: journal,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Journal Entry '${journal.journal_no}' has been cancelled.` };
  }

  async post(id: string, tenantId: string, userPayload?: any) {
    const journal = await this.findOne(id);
    this.assertDraft(journal);

    if (!journal.lines || journal.lines.length < 2) {
      throw new BadRequestException('A Journal Entry needs at least two lines to post.');
    }

    const totalDebit = journal.lines.reduce((sum, l) => sum + Number(l.debit_amount), 0);
    const totalCredit = journal.lines.reduce((sum, l) => sum + Number(l.credit_amount), 0);

    // Guard against floating-point drift on the equality check.
    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException(
        `Journal Entry does not balance: total debits (${totalDebit.toFixed(4)}) must equal total credits (${totalCredit.toFixed(4)}).`
      );
    }

    await this.db
      .update(schema.journalHeader)
      .set({
        status: 'POSTED',
        total_debit: totalDebit.toString(),
        total_credit: totalCredit.toString(),
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.journalHeader.journal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: journal.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'journal_header',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
  }

  // --- System-generated journal entries (e.g. from GL auto-posting) ---
  // Created directly as POSTED: the source movement (an Inventory Ledger entry)
  // is already posted, so its GL mirror doesn't need a separate draft/review step.

  async createAndPostSystemJournal(params: {
    tenantId: string;
    companyId: string;
    postingDate: string;
    sourceDocumentType: string;
    sourceDocumentNo: string;
    sourceLedgerId?: string;
    description?: string;
    lines: SystemJournalLineInput[];
    userId?: string;
  }) {
    return withTenantTransaction(this.cls, async () => {
      const totalDebit = params.lines.reduce((sum, l) => sum + l.debitAmount, 0);
      const totalCredit = params.lines.reduce((sum, l) => sum + l.creditAmount, 0);

      if (Math.abs(totalDebit - totalCredit) > 0.0001) {
        throw new BadRequestException(
          `System journal does not balance: total debits (${totalDebit.toFixed(4)}) must equal total credits (${totalCredit.toFixed(4)}).`
        );
      }

      const journalId = randomUUID();
      const postedTime = toMysqlTimestamp();

      const journalNo = await this.db.transaction(async (tx) => {
        const no = await this.generateJournalNo(params.tenantId, params.companyId, tx);
        await tx.insert(schema.journalHeader).values({
          journal_id: journalId,
          tenant_id: params.tenantId,
          company_id: params.companyId,
          journal_no: no,
          posting_date: params.postingDate,
          source: 'SYSTEM',
          source_document_type: params.sourceDocumentType,
          source_document_no: params.sourceDocumentNo,
          source_ledger_id: params.sourceLedgerId || null,
          description: params.description || null,
          status: 'POSTED',
          total_debit: totalDebit.toString(),
          total_credit: totalCredit.toString(),
          posted_at: postedTime as any,
          posted_by: params.userId || null,
          created_by: params.userId || null,
          updated_by: params.userId || null,
        });
        return no;
      });

      await this.db.insert(schema.journalLine).values(
        params.lines.map((line, idx) => ({
          line_id: randomUUID(),
          journal_id: journalId,
          line_no: idx + 1,
          gl_account_id: line.glAccountId,
          cost_center_id: line.costCenterId || null,
          debit_amount: line.debitAmount.toString(),
          credit_amount: line.creditAmount.toString(),
          description: line.description || null,
          nob_id: line.nobId || null,
          lob_id: line.lobId || null,
        }))
      );

      await this.auditService.log({
        tenantId: params.tenantId,
        companyId: params.companyId,
        userId: params.userId,
        action: 'CREATE',
        entityName: 'journal_header',
        entityId: journalId,
        newValues: { journal_no: journalNo, source: 'SYSTEM', ...params },
      });

      return this.findOne(journalId);
    });
  }
}

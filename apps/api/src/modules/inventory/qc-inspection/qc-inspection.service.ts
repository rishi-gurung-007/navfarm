import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertCompanyInScope, farmScope, locationReferenceScopeConditions, restrictedScopeConditions } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { ApproveQcDeviationDto, CompleteQcInspectionDto, QueryQcInspectionDto } from './dto/qc-inspection.dto';
import { decideOutcome, judgeLine, type InspectionLineSpec, type LineResult } from './qc-inspection.rules';

/** The Number Series master's "Applies To" key for QC inspections. */
export const QC_INSPECTION_SERIES = 'QC_INSPECTION';

/** What a source document's ledger entry looks like, so an inspection can write the entry the document would have written. */
const SOURCE_POSTING: Record<string, { documentType: string; transactionType: string }> = {
  GOODS_RECEIPT: { documentType: 'GOODS_RECEIPT', transactionType: 'PURCHASE' },
  // A semen collection posts its doses as an OUTPUT of the boar's batch, filed under BREEDING (semen-lot.service.ts).
  SEMEN_COLLECTION: { documentType: 'BREEDING', transactionType: 'OUTPUT' },
  // A transfer receipt lands in the destination as a TRANSFER_RECEIPT of the transfer (stock-transfer.service.ts). TRANSFER_RECEIPT is the Transfer Order's own
  // receive; TRANSFER_EVENT is a receipt against a shipment, which lands one layer per serial.
  TRANSFER_RECEIPT: { documentType: 'STOCK_TRANSFER', transactionType: 'TRANSFER_RECEIPT' },
  TRANSFER_EVENT: { documentType: 'STOCK_TRANSFER', transactionType: 'TRANSFER_RECEIPT' },
};
const TRANSFER_SOURCES = ['TRANSFER_RECEIPT', 'TRANSFER_EVENT'];
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

const today = () => new Date().toISOString().slice(0, 10);
const timestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const dec = (n: number, places = 4) => n.toFixed(places);

/** What any source needs to hand over to have a quantity inspected before it is written to the ledger. */
export interface RaiseInspection {
  tenantId: string;
  seriesCode: string;
  userId?: string;
  companyId: string;
  sourceDocType: 'GOODS_RECEIPT' | 'SEMEN_COLLECTION' | 'TRANSFER_RECEIPT' | 'TRANSFER_EVENT';
  sourceDocNo: string;
  sourceLineId: string;
  sourcePostingDate: string;
  supplierId?: string | null;
  poNo?: string | null;
  itemId: string;
  lotNo?: string | null;
  serialNo?: string | null;
  expiryDate?: string | null;
  quantity: string | number;
  uom: string;
  /** The rate the stock goes in at (the standard cost where the item is standard-costed), and the price variance posted beside it. */
  rate?: number;
  priceVariance?: number;
  warehouseId: string;
  glMappingType?: string | null;
  batchNo?: string | null;
  /** A transfer receipt: what it takes out of In Transit (default quantity x rate), its entry type, the transfer, and the source location a rejected quantity returns to. */
  amount?: number;
  entryType?: string | null;
  parentDocNo?: string | null;
  returnWarehouseId?: string | null;
}

export interface RaiseForReceiptLine {
  tenantId: string;
  seriesCode: string;
  userId?: string;
  receipt: {
    company_id: string;
    receipt_no: string;
    posting_date: string;
    warehouse_id: string;
    supplier_id: string | null;
    external_reference_no: string | null;
  };
  line: {
    line_id: string;
    item_id: string;
    quantity: string | number;
    uom: string;
    lot_no: string | null;
    serial_no: string | null;
    expiry_date: string | null;
  };
  rate: number | undefined;
  priceVariance: number;
}

@Injectable()
export class QcInspectionService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  // ---------------------------------------------------------------- raised by a receipt

  /** Which of these items are marked QC required: their quantity is held back from the ledger until inspected. */
  async qcRequiredItemIds(itemIds: string[]): Promise<Set<string>> {
    if (!itemIds.length) return new Set();
    const rows = await this.db
      .select({ item_id: schema.itemMaster.item_id })
      .from(schema.itemMaster)
      .where(and(
        inArray(schema.itemMaster.item_id, itemIds),
        eq(schema.itemMaster.is_qc_required, true),
        eq(schema.itemMaster.is_biological_asset, false),
      ));
    return new Set(rows.map((r) => r.item_id));
  }

  /** The series to number inspections from. Call it before the transaction opens, like the GRN's own series. */
  resolveSeries(tenantId: string, companyId: string): Promise<string> {
    return this.numberSeriesService.seriesCodeForDocument(
      tenantId,
      companyId,
      { seriesCode: QC_INSPECTION_SERIES, seriesName: 'QC Inspection Number', documentType: QC_INSPECTION_SERIES, prefix: 'QC', separator: '-', seqLength: 6 },
      async () => (await this.db.select({ no: schema.qcInspection.inspection_no }).from(schema.qcInspection)
        .where(and(eq(schema.qcInspection.tenant_id, tenantId), eq(schema.qcInspection.company_id, companyId)))).map((r) => r.no),
    );
  }

  /** The inspection that stands in for a receipt line's ledger entry. */
  raiseForReceiptLine(p: RaiseForReceiptLine) {
    return this.raise({
      tenantId: p.tenantId, seriesCode: p.seriesCode, userId: p.userId, companyId: p.receipt.company_id,
      sourceDocType: 'GOODS_RECEIPT', sourceDocNo: p.receipt.receipt_no, sourceLineId: p.line.line_id, sourcePostingDate: p.receipt.posting_date,
      supplierId: p.receipt.supplier_id, poNo: p.receipt.external_reference_no, itemId: p.line.item_id, lotNo: p.line.lot_no, serialNo: p.line.serial_no,
      expiryDate: p.line.expiry_date, quantity: p.line.quantity, uom: p.line.uom, rate: p.rate, priceVariance: p.priceVariance, warehouseId: p.receipt.warehouse_id,
    });
  }

  /**
   * Raises the inspection that stands in for a ledger entry. Runs inside the source's posting transaction, so a failure here (an item marked
   * QC required with nothing to check) leaves the source unposted. Nothing is written to the Inventory Ledger.
   */
  async raise(p: RaiseInspection): Promise<{ inspection_id: string; inspection_no: string }> {
    const [item] = await this.db
      .select({ item_code: schema.itemMaster.item_code })
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, p.itemId))
      .limit(1);
    const specs = await this.db
      .select()
      .from(schema.itemQcSpecLine)
      .where(and(eq(schema.itemQcSpecLine.item_id, p.itemId), eq(schema.itemQcSpecLine.is_active, true)))
      .orderBy(asc(schema.itemQcSpecLine.line_no));
    if (!specs.length) {
      throw new BadRequestException(
        `Item '${item?.item_code ?? p.itemId}' requires QC but has no QC specification. Add at least one check on the item's QC Specification tab, then try again.`,
      );
    }

    const inspectionId = randomUUID();
    const inspectionNo = await this.numberSeriesService.generateNext(p.seriesCode, p.tenantId, p.companyId, this.db);
    await this.db.insert(schema.qcInspection).values({
      inspection_id: inspectionId,
      tenant_id: p.tenantId,
      company_id: p.companyId,
      inspection_no: inspectionNo,
      inspection_date: today(),
      status: 'OPEN',
      source_doc_type: p.sourceDocType,
      source_doc_no: p.sourceDocNo,
      source_line_id: p.sourceLineId,
      source_posting_date: p.sourcePostingDate,
      supplier_id: p.supplierId ?? null,
      po_no: p.poNo ?? null,
      item_id: p.itemId,
      lot_no: p.lotNo ?? null,
      serial_no: p.serialNo ?? null,
      expiry_date: p.expiryDate ?? null,
      quantity: dec(Number(p.quantity)),
      uom: p.uom,
      rate: p.rate == null ? null : dec(p.rate, 6),
      price_variance: p.priceVariance ? dec(p.priceVariance) : null,
      warehouse_id: p.warehouseId,
      gl_mapping_type: p.glMappingType ?? null,
      batch_no: p.batchNo ?? null,
      amount: p.amount != null ? dec(p.amount) : p.rate != null && TRANSFER_SOURCES.includes(p.sourceDocType) ? dec(Number(p.quantity) * p.rate) : null,
      entry_type: p.entryType ?? null,
      parent_doc_no: p.parentDocNo ?? null,
      return_warehouse_id: p.returnWarehouseId ?? null,
      created_by: p.userId ?? null,
    });
    await this.db.insert(schema.qcInspectionLine).values(
      specs.map((s, i) => ({
        line_id: randomUUID(),
        inspection_id: inspectionId,
        line_no: (i + 1) * 10000,
        spec_line_id: s.spec_line_id,
        stage: s.stage,
        measurement_code: s.measurement_code,
        measurement_description: s.measurement_description,
        sampling_type: s.sampling_type,
        uom: s.uom,
        min_value: s.min_value,
        max_value: s.max_value,
        acceptance_text: s.acceptance_text,
        is_mandatory: s.is_mandatory,
      })),
    );
    await this.auditService.log({
      tenantId: p.tenantId,
      companyId: p.companyId,
      userId: p.userId,
      action: 'CREATE',
      entityName: 'qc_inspection',
      entityId: inspectionId,
      newValues: { inspection_no: inspectionNo, source_doc_type: p.sourceDocType, source_doc_no: p.sourceDocNo, item_id: p.itemId, quantity: p.quantity },
    });
    return { inspection_id: inspectionId, inspection_no: inspectionNo };
  }

  // ---------------------------------------------------------------- reading

  private scopeConditions() {
    const scope = farmScope(this.cls);
    return [
      ...locationReferenceScopeConditions(scope, schema.qcInspection.warehouse_id),
      ...restrictedScopeConditions(scope, { companyId: schema.qcInspection.company_id }),
    ];
  }

  private headerSelect() {
    return this.db
      .select({
        inspection: schema.qcInspection,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        supplier_name: schema.supplierMaster.supplier_name,
        warehouse_name: schema.locationMaster.location_name,
        reason_code: schema.reasonMaster.reason_code,
      })
      .from(schema.qcInspection)
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.qcInspection.item_id))
      .leftJoin(schema.supplierMaster, eq(schema.supplierMaster.supplier_id, schema.qcInspection.supplier_id))
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.qcInspection.warehouse_id))
      .leftJoin(schema.reasonMaster, eq(schema.reasonMaster.reason_id, schema.qcInspection.reason_id));
  }

  async findAll(query: QueryQcInspectionDto, tenantId: string) {
    const conditions = [eq(schema.qcInspection.tenant_id, tenantId), ...this.scopeConditions()];
    if (query.companyId) conditions.push(eq(schema.qcInspection.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.qcInspection.status, query.status));
    if (query.itemId) conditions.push(eq(schema.qcInspection.item_id, query.itemId));
    if (query.search) {
      const like_ = `%${query.search}%`;
      conditions.push(or(
        like(schema.qcInspection.inspection_no, like_),
        like(schema.qcInspection.source_doc_no, like_),
        like(schema.qcInspection.po_no, like_),
        like(schema.itemMaster.item_code, like_),
      )!);
    }
    const rows = await this.headerSelect()
      .where(and(...conditions))
      .orderBy(desc(schema.qcInspection.created_at), desc(schema.qcInspection.inspection_no))
      .limit(query.limit || 50)
      .offset(query.offset || 0);
    return rows.map(({ inspection, ...rest }) => ({ ...inspection, ...rest }));
  }

  async findOne(id: string) {
    const [row] = await this.headerSelect().where(and(eq(schema.qcInspection.inspection_id, id), ...this.scopeConditions())).limit(1);
    if (!row) throw new NotFoundException(`QC inspection '${id}' not found.`);
    const lines = await this.db
      .select()
      .from(schema.qcInspectionLine)
      .where(eq(schema.qcInspectionLine.inspection_id, id))
      .orderBy(asc(schema.qcInspectionLine.line_no));
    const { inspection, ...rest } = row;
    return { ...inspection, ...rest, lines };
  }

  // ---------------------------------------------------------------- completing

  /**
   * Records the inspector's findings. A passing inspection writes the Inventory Ledger entry (and its journal) for the accepted
   * quantity here and now; a failure writes nothing; a deviation writes nothing until a second person approves it.
   */
  async complete(id: string, dto: CompleteQcInspectionDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const inspection = await this.findOne(id);
      assertCompanyInScope(farmScope(this.cls), inspection.company_id);
      if (inspection.status !== 'OPEN') {
        throw new BadRequestException(`QC inspection ${inspection.inspection_no} is ${inspection.status} and cannot be completed again.`);
      }

      const known = new Set(inspection.lines.map((l) => l.line_id));
      const stray = dto.lines.find((l) => !known.has(l.line_id));
      if (stray) throw new BadRequestException('A result was sent for a check that is not on this inspection.');

      const judged = inspection.lines.map((line) => {
        const entry = dto.lines.find((l) => l.line_id === line.line_id);
        const verdict = judgeLine(line as InspectionLineSpec, entry);
        return { line, entry, verdict };
      });

      let reasonId: string | null = null;
      if (dto.reason_id) {
        const [reason] = await this.db
          .select({ reason_id: schema.reasonMaster.reason_id })
          .from(schema.reasonMaster)
          .where(and(eq(schema.reasonMaster.reason_id, dto.reason_id), eq(schema.reasonMaster.tenant_id, tenantId)))
          .limit(1);
        if (!reason) throw new BadRequestException('The Reason Code was not found.');
        reasonId = reason.reason_id;
      }

      const quantity = Number(inspection.quantity);
      const decided = decideOutcome({
        quantity,
        acceptedQty: dto.accepted_qty,
        rejectedQty: dto.rejected_qty,
        sampleQty: dto.sample_qty ?? null,
        deviation: dto.deviation === true,
        hasReason: !!reasonId,
        lines: judged.map(({ line, verdict }) => ({ code: line.measurement_code, is_mandatory: line.is_mandatory, result: (verdict?.result ?? null) as LineResult | null })),
      });
      if ('error' in decided) throw new BadRequestException(decided.error);
      const { outcome } = decided;

      // A serial-tracked lot is one set of serial numbers: it is accepted or rejected whole.
      if (inspection.serial_no && dto.accepted_qty > 0 && dto.rejected_qty > 0) {
        throw new BadRequestException('A serial-tracked lot is accepted or rejected whole: serial numbers cannot be split between Accepted and Rejected.');
      }

      const postingDate = dto.posting_date ?? today();
      if ((outcome.postNow > 0 || TRANSFER_SOURCES.includes(inspection.source_doc_type)) && postingDate < inspection.source_posting_date) {
        throw new BadRequestException(`Posting Date cannot be before the receipt's posting date (${inspection.source_posting_date}).`);
      }

      // Claim the OPEN -> next transition before writing anything, so two people completing the same inspection cannot both post.
      const [claim] = await this.db
        .update(schema.qcInspection)
        .set({ status: outcome.status, result: outcome.result, updated_at: timestamp() as any })
        .where(and(eq(schema.qcInspection.inspection_id, id), eq(schema.qcInspection.status, 'OPEN')));
      if (claim.affectedRows === 0) throw new BadRequestException('This inspection was completed by someone else.');

      for (const { line, entry, verdict } of judged) {
        await this.db
          .update(schema.qcInspectionLine)
          .set({
            actual_value: verdict?.actual_value != null ? dec(verdict.actual_value) : null,
            actual_text: verdict?.actual_text ?? entry?.actual_text ?? null,
            result: verdict?.result ?? null,
            remarks: entry?.remarks ?? null,
          })
          .where(eq(schema.qcInspectionLine.line_id, line.line_id));
      }

      let ledgerEntryId: string | null = null;
      if (outcome.postNow > 0) {
        ledgerEntryId = await this.postAccepted(inspection, outcome.postNow, postingDate, user?.userId);
      }
      // A deviation is settled when it is approved; everything else is settled now.
      if (outcome.status === 'CLOSED') await this.settleSource(inspection, outcome.postNow, !!ledgerEntryId);
      if (outcome.status === 'CLOSED') await this.returnRejected(inspection, quantity - outcome.postNow, postingDate, user?.userId);

      await this.db
        .update(schema.qcInspection)
        .set({
          sample_qty: dto.sample_qty != null ? dec(dto.sample_qty) : null,
          accepted_qty: dec(dto.accepted_qty),
          rejected_qty: dec(dto.rejected_qty),
          reason_id: reasonId,
          deviation: outcome.result === 'DEVIATION',
          posting_date: outcome.result === 'FAIL' ? null : postingDate,
          remarks: dto.remarks ?? null,
          inspected_by: user?.userId ?? null,
          inspected_at: timestamp() as any,
          ledger_entry_id: ledgerEntryId,
        })
        .where(eq(schema.qcInspection.inspection_id, id));

      await this.auditService.log({
        tenantId,
        companyId: inspection.company_id,
        userId: user?.userId,
        action: 'UPDATE',
        entityName: 'qc_inspection',
        entityId: id,
        newValues: { status: outcome.status, result: outcome.result, accepted_qty: dto.accepted_qty, rejected_qty: dto.rejected_qty, ledger_entry_id: ledgerEntryId },
      });
      return this.findOne(id);
    });
  }

  /** A second person releases a deviation: only now is the accepted quantity written to the ledger. */
  async approveDeviation(id: string, dto: ApproveQcDeviationDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const inspection = await this.findOne(id);
      assertCompanyInScope(farmScope(this.cls), inspection.company_id);
      if (inspection.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`QC inspection ${inspection.inspection_no} is ${inspection.status}; only one pending approval can be approved.`);
      }
      if (user?.userId && user.userId === inspection.inspected_by) {
        throw new ForbiddenException('A deviation must be approved by someone other than the inspector.');
      }
      const postingDate = dto.posting_date ?? inspection.posting_date ?? today();
      if (postingDate < inspection.source_posting_date) {
        throw new BadRequestException(`Posting Date cannot be before the receipt's posting date (${inspection.source_posting_date}).`);
      }

      const [claim] = await this.db
        .update(schema.qcInspection)
        .set({ status: 'CLOSED', approved_by: user?.userId ?? null, approved_at: timestamp() as any, posting_date: postingDate, updated_at: timestamp() as any })
        .where(and(eq(schema.qcInspection.inspection_id, id), eq(schema.qcInspection.status, 'PENDING_APPROVAL')));
      if (claim.affectedRows === 0) throw new BadRequestException('This inspection was already decided by someone else.');

      const ledgerEntryId = await this.postAccepted(inspection, Number(inspection.accepted_qty), postingDate, user?.userId);
      await this.settleSource(inspection, Number(inspection.accepted_qty), true);
      await this.returnRejected(inspection, Number(inspection.quantity) - Number(inspection.accepted_qty), postingDate, user?.userId);
      await this.db
        .update(schema.qcInspection)
        .set({ ledger_entry_id: ledgerEntryId, remarks: dto.remarks ?? inspection.remarks })
        .where(eq(schema.qcInspection.inspection_id, id));

      await this.auditService.log({
        tenantId,
        companyId: inspection.company_id,
        userId: user?.userId,
        action: 'APPROVE',
        entityName: 'qc_inspection',
        entityId: id,
        newValues: { status: 'CLOSED', result: 'DEVIATION', accepted_qty: inspection.accepted_qty, ledger_entry_id: ledgerEntryId },
      });
      return this.findOne(id);
    });
  }

  /** The approver refuses the deviation: the lot is failed whole and nothing is ever written to the ledger. */
  async rejectDeviation(id: string, dto: ApproveQcDeviationDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const inspection = await this.findOne(id);
      assertCompanyInScope(farmScope(this.cls), inspection.company_id);
      if (inspection.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`QC inspection ${inspection.inspection_no} is ${inspection.status}; only one pending approval can be refused.`);
      }
      if (user?.userId && user.userId === inspection.inspected_by) {
        throw new ForbiddenException('A deviation must be decided by someone other than the inspector.');
      }
      const [claim] = await this.db
        .update(schema.qcInspection)
        .set({
          status: 'CLOSED',
          result: 'FAIL',
          deviation: false,
          accepted_qty: '0.0000',
          rejected_qty: dec(Number(inspection.quantity)),
          posting_date: null,
          approved_by: user?.userId ?? null,
          approved_at: timestamp() as any,
          remarks: dto.remarks ?? inspection.remarks,
          updated_at: timestamp() as any,
        })
        .where(and(eq(schema.qcInspection.inspection_id, id), eq(schema.qcInspection.status, 'PENDING_APPROVAL')));
      if (claim.affectedRows === 0) throw new BadRequestException('This inspection was already decided by someone else.');
      await this.settleSource(inspection, 0, false);
      await this.returnRejected(inspection, Number(inspection.quantity), today(), user?.userId);
      await this.auditService.log({
        tenantId,
        companyId: inspection.company_id,
        userId: user?.userId,
        action: 'REJECT',
        entityName: 'qc_inspection',
        entityId: id,
        newValues: { status: 'CLOSED', result: 'FAIL' },
      });
      return this.findOne(id);
    });
  }

  /**
   * A transfer's rejected quantity goes back to the location it was sent from, at the cost it left at, so what the shipment took out of In Transit is all
   * accounted for (the same return a short-closed transfer makes). Other sources have nothing to return: a rejected receipt was never stock.
   */
  private async returnRejected(
    inspection: Parameters<QcInspectionService['postAccepted']>[0],
    rejectedQty: number,
    postingDate: string,
    userId?: string,
  ) {
    if (!TRANSFER_SOURCES.includes(inspection.source_doc_type) || !(rejectedQty > 1e-9) || !inspection.return_warehouse_id) return;
    const total = inspection.amount != null ? Number(inspection.amount) : undefined;
    const whole = Number(inspection.quantity);
    // Whatever the accepted part did not take, so the two together equal the amount carried.
    const accepted = whole - rejectedQty;
    const amount = total == null ? undefined : round4(total - (accepted <= 1e-9 ? 0 : accepted >= whole - 1e-9 ? total : round4((total * accepted) / whole)));
    const posting = SOURCE_POSTING[inspection.source_doc_type];
    const entry = await this.ledgerService.writePositiveEntry({
      tenantId: inspection.tenant_id,
      companyId: inspection.company_id,
      itemId: inspection.item_id,
      documentType: posting.documentType,
      documentNo: inspection.source_doc_no,
      documentLineId: inspection.source_line_id,
      postingDate,
      transactionType: posting.transactionType,
      entryType: inspection.entry_type || undefined,
      quantity: rejectedQty,
      uom: inspection.uom,
      rate: inspection.rate != null ? Number(inspection.rate) : undefined,
      amount,
      lotNo: inspection.lot_no || undefined,
      serialNo: inspection.serial_no || undefined,
      warehouseId: inspection.return_warehouse_id,
      userId,
    });
    await this.glPostingService.postInventoryLedgerEntry(entry, userId);
  }

  /**
   * Tells the source what became of its quantity. A semen lot is held as stock only once its inspection has put it there; a lot that passed
   * only in part has only the accepted doses to use, and one that failed has none.
   */
  private async settleSource(
    inspection: { source_doc_type: string; source_line_id: string; inspection_no: string; quantity: string },
    acceptedQty: number,
    posted: boolean,
  ) {
    if (inspection.source_doc_type !== 'SEMEN_COLLECTION') return;
    const collected = Number(inspection.quantity);
    const note = acceptedQty + 1e-9 < collected ? `QC ${inspection.inspection_no}: ${acceptedQty} of ${collected} doses accepted.` : null;
    await this.db
      .update(schema.semenBatch)
      .set({
        inventory_posted: posted,
        ...(acceptedQty + 1e-9 < collected ? { doses_collected: String(acceptedQty) } : {}),
        ...(note ? { notes: sql`concat(coalesce(${schema.semenBatch.notes}, ''), ${note}, ' ')` } : {}),
      })
      .where(eq(schema.semenBatch.semen_batch_id, inspection.source_line_id));
  }

  // ---------------------------------------------------------------- the ledger entry

  /**
   * Writes the entry the receipt held back: the same ledger call and the same journal calls the receipt used to make, for the
   * accepted quantity, dated the inspection's posting date. A price variance is carried over in proportion to what was accepted.
   */
  private async postAccepted(
    inspection: { company_id: string; tenant_id: string; source_doc_type: string; source_doc_no: string; source_line_id: string; po_no: string | null; item_id: string; uom: string; quantity: string; rate: string | null; price_variance: string | null; lot_no: string | null; serial_no: string | null; expiry_date: string | null; warehouse_id: string; gl_mapping_type: string | null; batch_no: string | null; amount: string | null; entry_type: string | null; return_warehouse_id: string | null },
    quantity: number,
    postingDate: string,
    userId?: string,
  ): Promise<string> {
    const posting = SOURCE_POSTING[inspection.source_doc_type];
    if (!posting) throw new BadRequestException(`QC inspections raised by ${inspection.source_doc_type} cannot be posted yet.`);
    // A transfer receipt takes its share of what the shipment carried out of In Transit; the whole quantity takes all of it, so no rounding residue is left.
    const total = inspection.amount != null ? Number(inspection.amount) : undefined;
    const whole = Number(inspection.quantity);
    const amountFor = (q: number) => (total == null ? undefined : q >= whole - 1e-9 ? total : round4((total * q) / whole));
    const common = {
      tenantId: inspection.tenant_id,
      companyId: inspection.company_id,
      itemId: inspection.item_id,
      documentType: posting.documentType,
      documentNo: inspection.source_doc_no,
      documentLineId: inspection.source_line_id,
      postingDate,
      externalReferenceNo: inspection.po_no || undefined,
      transactionType: posting.transactionType,
      entryType: inspection.entry_type || undefined,
      glMappingType: inspection.gl_mapping_type || undefined,
      batchNo: inspection.batch_no || undefined,
      uom: inspection.uom,
      rate: inspection.rate != null ? Number(inspection.rate) : undefined,
      lotNo: inspection.lot_no || undefined,
      expiryDate: inspection.expiry_date || undefined,
      warehouseId: inspection.warehouse_id,
      userId,
    };
    const serials = (inspection.serial_no || '').split(',').map((x) => x.trim()).filter(Boolean);
    let entry: typeof schema.inventoryLedger.$inferSelect;
    if (inspection.source_doc_type === 'TRANSFER_EVENT' && serials.length > 1) {
      // A receipt against a shipment lands one layer per serial (the shape its consumers read), the amount shared between them.
      const amount = amountFor(quantity);
      let left = amount;
      let last: typeof entry | undefined;
      for (const [i, serialNo] of serials.entries()) {
        const share = amount == null ? undefined : i === serials.length - 1 ? round4(left!) : round4(amount / serials.length);
        if (share != null) left = round4(left! - share);
        last = await this.ledgerService.writePositiveEntry({ ...common, quantity: 1, serialNo, amount: share });
        await this.glPostingService.postInventoryLedgerEntry(last, userId);
      }
      entry = last!;
      return entry.ledger_id;
    }
    entry = await this.ledgerService.writePositiveEntry({
      ...common,
      quantity,
      serialNo: inspection.serial_no || undefined,
      amount: amountFor(quantity),
    });
    await this.glPostingService.postInventoryLedgerEntry(entry, userId);
    const variance = Number(inspection.price_variance ?? 0);
    if (variance !== 0) {
      await this.glPostingService.postPurchasePriceVariance(entry, variance * (quantity / Number(inspection.quantity)), userId);
    }
    return entry.ledger_id;
  }
}

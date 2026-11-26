import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertLocationOnActiveFarm, farmOfLocation, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { CreateSemenDisposalDto, QuerySemenDisposalDto } from './dto/semen-disposal.dto';
import { disposalProblem, disposalStore } from './semen-disposal.rules';
import { nextDisposalNo } from './semen-disposal.record';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Destroyed semen doses (Phase 3, 24 Nov 2026). Doses in stock are written off where they are (a VARIANCE_NEGATIVE entry on the store, costed
 * from the lot's own layers there, with its journal) and counted on the lot. QC rejections that were scrapped are recorded when the QC
 * inspection tells its source (semen-qc-source.ts, which writes through semen-disposal.record.ts). Both are listed here: the AI Station report's "Destroyed".
 */
@Injectable()
export class SemenDisposalService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeries: NumberSeriesService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private async lotOf(id: string, tenantId: string) {
    const [lot] = await this.db
      .select()
      .from(schema.semenBatch)
      .where(and(eq(schema.semenBatch.semen_batch_id, id), eq(schema.semenBatch.tenant_id, tenantId)))
      .limit(1);
    if (!lot) throw new NotFoundException(`Semen lot '${id}' not found.`);
    return lot;
  }

  /** Where the lot's doses are now: each store holding it, with its farm. */
  async stock(id: string, tenantId: string) {
    const lot = await this.lotOf(id, tenantId);
    if (!lot.inventory_posted || !lot.output_item_id || !lot.lot_no) return [];
    const L = schema.inventoryLedger;
    const rows = await this.db
      .select({ warehouse_id: L.warehouse_id, qty: sql<string>`SUM(${L.quantity})` })
      .from(L)
      .where(and(eq(L.item_id, lot.output_item_id), eq(L.lot_no, lot.lot_no)))
      .groupBy(L.warehouse_id);
    const out: { warehouse_id: string; code: string | null; name: string | null; farm_id: string | null; qty: number }[] = [];
    for (const r of rows) {
      if (!r.warehouse_id || !(Number(r.qty) > 1e-9)) continue;
      const [loc] = await this.db
        .select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, r.warehouse_id))
        .limit(1);
      out.push({ warehouse_id: r.warehouse_id, code: loc?.code ?? null, name: loc?.name ?? null, farm_id: await farmOfLocation(this.db, r.warehouse_id), qty: Number(r.qty) });
    }
    return out;
  }

  async dispose(id: string, dto: CreateSemenDisposalDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const lot = await this.lotOf(id, tenantId);
      const lotNo = lot.lot_no ?? id;
      const counterLeft = Number(lot.doses_collected) - Number(lot.doses_used_internal ?? 0) - Number(lot.doses_sold ?? 0) - Number(lot.doses_destroyed ?? 0);
      const inStock = !!(lot.inventory_posted && lot.output_item_id && lot.lot_no && lot.warehouse_id);
      if (!lot.inventory_posted && lot.output_item_id) {
        throw new BadRequestException(`Lot ${lotNo} is not stock yet: it is held by its QC inspection. Reject it there instead.`);
      }

      let warehouseId: string | null = null;
      let warehouseFarmId: string | null = null;
      let available = counterLeft;
      let where = 'the lot';
      if (inStock) {
        const stock = await this.stock(id, tenantId);
        const chosen = disposalStore(dto.warehouse_id, stock.map((s) => ({ warehouse_id: s.warehouse_id, label: s.code ?? s.warehouse_id, qty: s.qty })));
        if ('error' in chosen) throw new BadRequestException(chosen.error);
        warehouseId = chosen.warehouseId;
        const here = stock.find((s) => s.warehouse_id === warehouseId);
        available = Math.min(here?.qty ?? 0, counterLeft);
        where = here?.code ?? 'that store';
        warehouseFarmId = here?.farm_id ?? null;
        await assertLocationOnActiveFarm(this.db, farmScope(this.cls), warehouseId, 'Store');
      }
      const problem = disposalProblem({
        lotNo, doses: dto.doses, available, where, date: dto.disposal_date, collectionDate: String(lot.collection_date).slice(0, 10),
        today: today(), reasonType: dto.reason_type, remarks: dto.remarks,
      });
      if (problem) throw new BadRequestException(problem);

      const companyId = lot.company_id ?? '';
      const disposalNo = await nextDisposalNo(this.db, this.numberSeries, tenantId, companyId);
      let ledgerEntryId: string | null = null;
      let amount: string | null = null;
      if (inStock && warehouseId) {
        // Costed from the lot's own layers at that store (its collection OUTPUT, the transfer receipts that brought it there), oldest first and
        // across as many as it takes (costFromLot), as a mating's issue is. Before 26 Nov one single layer had to hold every dose written off;
        // otherwise the write-off was costed oldest-first from whatever lot was in the store.
        const [item] = await this.db.select({ uom: schema.itemMaster.uom_primary }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, lot.output_item_id!)).limit(1);
        const entry = await this.ledgerService.writeNegativeEntry({
          tenantId,
          companyId,
          itemId: lot.output_item_id!,
          documentType: 'SEMEN_DISPOSAL',
          documentNo: disposalNo,
          postingDate: dto.disposal_date,
          transactionType: 'VARIANCE_NEGATIVE',
          quantity: dto.doses,
          uom: item?.uom ?? 'DOSE',
          lotNo: lot.lot_no!,
          costFromLot: true,
          warehouseId,
          userId: user?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(entry, user?.userId);
        ledgerEntryId = entry.ledger_id;
        amount = entry.amount != null ? Math.abs(Number(entry.amount)).toFixed(4) : null;
      }

      const disposalId = randomUUID();
      await this.db.insert(schema.semenDoseDisposal).values({
        disposal_id: disposalId,
        tenant_id: tenantId,
        company_id: companyId,
        disposal_no: disposalNo,
        semen_batch_id: lot.semen_batch_id,
        lot_no: lot.lot_no,
        item_id: lot.output_item_id,
        warehouse_id: warehouseId,
        farm_id: warehouseFarmId,
        doses: dto.doses.toFixed(2),
        disposal_date: dto.disposal_date,
        reason_type: dto.reason_type,
        reason_id: dto.reason_id ?? null,
        source: 'MANUAL',
        ledger_entry_id: ledgerEntryId,
        amount,
        remarks: dto.remarks?.trim() || null,
        created_by: user?.userId ?? null,
      });
      await this.db
        .update(schema.semenBatch)
        .set({ doses_destroyed: (Number(lot.doses_destroyed ?? 0) + dto.doses).toFixed(2) })
        .where(eq(schema.semenBatch.semen_batch_id, lot.semen_batch_id));
      await this.auditService.log({
        tenantId, companyId, userId: user?.userId, action: 'CREATE', entityName: 'semen_dose_disposal', entityId: disposalId,
        newValues: { disposal_no: disposalNo, lot_no: lot.lot_no, doses: dto.doses, reason_type: dto.reason_type, warehouse_id: warehouseId, ledger_entry_id: ledgerEntryId },
      });
      const [row] = await this.list({ semen_batch_id: lot.semen_batch_id }, tenantId).then((rows) => rows.filter((r) => r.disposal_id === disposalId));
      return row;
    });
  }

  async list(query: QuerySemenDisposalDto, tenantId: string) {
    const D = schema.semenDoseDisposal;
    const conditions = [eq(D.tenant_id, tenantId)];
    if (query.semen_batch_id) conditions.push(eq(D.semen_batch_id, query.semen_batch_id));
    if (query.farm_id) conditions.push(eq(D.farm_id, query.farm_id));
    if (query.company_id) conditions.push(eq(D.company_id, query.company_id));
    if (query.from_date) conditions.push(gte(D.disposal_date, query.from_date));
    if (query.to_date) conditions.push(lte(D.disposal_date, query.to_date));
    const rows = await this.db
      .select({
        disposal: D,
        store_code: schema.locationMaster.location_code,
        inspection_no: schema.qcInspection.inspection_no,
      })
      .from(D)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, D.warehouse_id))
      .leftJoin(schema.qcInspection, eq(schema.qcInspection.inspection_id, D.qc_inspection_id))
      .where(and(...conditions))
      .orderBy(desc(D.disposal_date), desc(D.created_at))
      .limit(500);
    return rows.map(({ disposal, ...rest }) => ({ ...disposal, ...rest }));
  }
}

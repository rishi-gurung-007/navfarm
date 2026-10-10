import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  allocateMillCapacity, buildCompareReport, capacityBreaches, DietCapacity, DietDemand, DietInfo, FeedForm, isoWeekDates,
  MillCapacitySetup, MillDemandLine, MillDietSchedule,
} from './mill-capacity.rules';

const DEAD_FEED_STATUSES = ['REJECTED', 'CANCELLED'];
const num = (value: unknown): number | null => value === null || value === undefined || value === '' ? null : Number(value);

/**
 * Reads the masters the mill capacity rule needs — the MILL location's
 * capacity and the day's BIN Diet Assignments — and the approved feed demand,
 * then hands them to the pure rule in mill-capacity.rules.ts.
 */
@Injectable()
export class MillCapacityService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async mills(tenantId: string, companyIds: string[]): Promise<Array<MillCapacitySetup & { millName: string; companyId: string }>> {
    if (!companyIds.length) return [];
    const L = schema.locationMaster;
    const rows = await this.db.select({
      id: L.location_id, code: L.location_code, name: L.location_name, company_id: L.company_id,
      daily: L.mill_daily_capacity_kg, hourly: L.mill_hourly_capacity_kg,
      bulk: L.mill_bulk_daily_allocation_kg, bagged: L.mill_bagged_daily_allocation_kg,
    }).from(L).where(and(
      eq(L.tenant_id, tenantId), inArray(L.company_id, companyIds), eq(L.location_type, 'MILL'),
      eq(L.is_active, true), isNull(L.deleted_at),
    )).orderBy(L.location_code);
    return rows.map((row) => ({
      millId: row.id, millCode: row.code, millName: row.name, companyId: row.company_id as string,
      dailyKg: num(row.daily), hourlyKg: num(row.hourly), bulkKg: num(row.bulk), baggedKg: num(row.bagged),
    }));
  }

  /** Active BIN Diet Assignments on the dates, with each BIN's MILL and feed form. */
  async schedules(tenantId: string, companyIds: string[], dates: string[]) {
    const byDate = new Map<string, MillDietSchedule[]>();
    const diets = new Map<string, DietInfo>();
    if (!companyIds.length || !dates.length) return { byDate, diets };
    const A = schema.binDietAssignment;
    const bin = schema.locationMaster;
    const rows = await this.db.select({
      production_date: A.production_date, item_id: A.feed_item_id, priority: A.diet_priority,
      bin_id: bin.location_id, bin_code: bin.location_code, mill_id: bin.parent_location_id, feed_form: bin.bin_feed_type,
      item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, diet_no: schema.itemMaster.diet_no,
    }).from(A)
      .innerJoin(bin, eq(bin.location_id, A.bin_location_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, A.feed_item_id))
      .where(and(
        eq(A.tenant_id, tenantId), inArray(A.company_id, companyIds), inArray(A.production_date, dates),
        eq(A.is_active, true), isNull(A.deleted_at), eq(bin.is_active, true), isNull(bin.deleted_at),
      ));
    for (const row of rows) {
      if (!row.mill_id || (row.feed_form !== 'BULK' && row.feed_form !== 'BAGGED')) continue;
      const date = String(row.production_date).slice(0, 10);
      byDate.set(date, [...(byDate.get(date) ?? []), {
        itemId: row.item_id, millId: row.mill_id, feedForm: row.feed_form as FeedForm, priority: Number(row.priority),
        binId: row.bin_id, binCode: row.bin_code,
      }]);
      diets.set(row.item_id, { itemId: row.item_id, itemCode: row.item_code, itemName: row.item_name, dietNo: row.diet_no ?? null });
    }
    return { byDate, diets };
  }

  /**
   * Approved feed requisition lines on production dates `from`..`to` (Engine
   * r40 "Sum of farm approved requisition quantities"), with the mill-approved
   * KG of their consolidation line. A line's production date is its
   * requisition's, falling back to the requested delivery date exactly as the
   * consolidation sheet does.
   */
  async approvedDemand(tenantId: string, scope: { companyIds?: string[]; farmIds?: string[] }, from: string, to: string) {
    const R = schema.requisition;
    const L = schema.requisitionLine;
    const C = schema.feedConsolidationLine;
    const productionDate = sql<string>`COALESCE(${R.production_date}, ${L.proposed_delivery_date})`;
    const conditions = [
      eq(R.tenant_id, tenantId), eq(R.doc_type, 'FEED'), isNull(R.deleted_at),
      sql`(${R.status} = 'APPROVED' OR ${R.approval_status} = 'APPROVED')`,
      notInArray(R.status, DEAD_FEED_STATUSES),
      sql`${productionDate} >= ${from}`, sql`${productionDate} <= ${to}`,
    ];
    if (scope.companyIds) conditions.push(scope.companyIds.length ? inArray(R.company_id, scope.companyIds) : sql`1 = 0`);
    if (scope.farmIds) conditions.push(scope.farmIds.length ? inArray(R.farm_id, scope.farmIds) : sql`1 = 0`);
    const rows = await this.db.select({
      production_date: productionDate, farm_id: R.farm_id, item_id: L.item_id, quantity: L.quantity,
      mill_approved: C.mill_approved_qty_kg,
      item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, diet_no: schema.itemMaster.diet_no,
    }).from(R)
      .innerJoin(L, eq(L.requisition_id, R.requisition_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, L.item_id))
      .leftJoin(C, eq(C.requisition_line_id, L.line_id))
      .where(and(...conditions));
    const diets = new Map<string, DietInfo>();
    const lines: MillDemandLine[] = [];
    for (const row of rows) {
      if (!row.item_id || !row.farm_id) continue;
      diets.set(row.item_id, { itemId: row.item_id, itemCode: row.item_code, itemName: row.item_name, dietNo: row.diet_no ?? null });
      lines.push({
        productionDate: String(row.production_date).slice(0, 10), farmId: row.farm_id, itemId: row.item_id,
        requestedKg: Number(row.quantity) || 0, millApprovedKg: num(row.mill_approved),
      });
    }
    return { lines, diets };
  }

  /** Mill-approved KG already on consolidation sheets for these production dates. */
  async consolidatedDemand(tenantId: string, companyIds: string[], dates: string[], excludeConsolidationId?: string) {
    if (!companyIds.length || !dates.length) return [] as Array<{ productionDate: string; itemId: string; millApprovedKg: number }>;
    const C = schema.feedConsolidationLine;
    const H = schema.feedConsolidation;
    const productionDate = sql<string>`COALESCE(${C.production_date}, ${C.requested_delivery_date})`;
    const conditions = [eq(H.tenant_id, tenantId), inArray(H.company_id, companyIds), inArray(productionDate, dates)];
    if (excludeConsolidationId) conditions.push(sql`${H.consolidation_id} <> ${excludeConsolidationId}`);
    const rows = await this.db.select({ production_date: productionDate, item_id: C.item_id, approved: C.mill_approved_qty_kg })
      .from(C).innerJoin(H, eq(H.consolidation_id, C.consolidation_id)).where(and(...conditions));
    return rows.map((row) => ({ productionDate: String(row.production_date).slice(0, 10), itemId: row.item_id, millApprovedKg: Number(row.approved) || 0 }));
  }

  /** Mill Capacity Available per diet on one production date for a company's mills. */
  async allocateOn(tenantId: string, companyIds: string[], date: string, demands: DietDemand[]) {
    const [mills, { byDate }] = await Promise.all([this.mills(tenantId, companyIds), this.schedules(tenantId, companyIds, [date])]);
    return allocateMillCapacity({ mills, schedules: byDate.get(date) ?? [], demands });
  }

  /**
   * Checkpoint 42 (Checkpoints and Validations r48): a consolidation may not
   * carry a diet above its Mill Capacity Available. Demand is every
   * mill-approved KG on consolidation sheets for that production date plus
   * `proposed`. Refuses with the diet, date and both figures.
   */
  async assertConsolidationWithinCapacity(tenantId: string, companyId: string, proposed: Array<{ productionDate: string; itemId: string; itemCode: string; millApprovedKg: number }>, excludeConsolidationId?: string) {
    const dates = [...new Set(proposed.map((line) => line.productionDate).filter(Boolean))];
    if (!dates.length) return;
    const [mills, { byDate }, existing] = await Promise.all([
      this.mills(tenantId, [companyId]),
      this.schedules(tenantId, [companyId], dates),
      this.consolidatedDemand(tenantId, [companyId], dates, excludeConsolidationId),
    ]);
    const problems: string[] = [];
    for (const date of dates) {
      const own = proposed.filter((line) => line.productionDate === date);
      const allocation = allocateMillCapacity({
        mills, schedules: byDate.get(date) ?? [],
        demands: [
          ...existing.filter((line) => line.productionDate === date).map((line) => ({ itemId: line.itemId, demandKg: line.millApprovedKg })),
          ...own.map((line) => ({ itemId: line.itemId, demandKg: line.millApprovedKg })),
        ],
      });
      for (const breach of capacityBreaches(allocation, own.map((line) => line.itemId))) {
        const code = own.find((line) => line.itemId === breach.itemId)?.itemCode ?? breach.itemId;
        problems.push(`${code} on ${date}: ${breach.demandKg.toLocaleString('en-US')} KG mill approved exceeds ${Number(breach.availableKg).toLocaleString('en-US')} KG Mill Capacity Available`);
      }
    }
    if (problems.length) {
      throw new ConflictException(`Mill capacity exceeded — ${problems.join('; ')}. Reduce Mill Approved Qty KG with an adjustment reason before consolidating.`);
    }
  }

  /** Compare Report for one MILL on a production date, or the ISO week containing it. */
  async compareReport(tenantId: string, farmIds: string[], companyIds: string[], query: { millId?: string; date: string; period?: 'DAY' | 'WEEK' }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date ?? '')) throw new BadRequestException('A production date in YYYY-MM-DD format is required.');
    const mills = await this.mills(tenantId, companyIds);
    if (!mills.length) return { mills: [], report: null };
    const mill = query.millId ? mills.find((row) => row.millId === query.millId) : mills[0];
    if (!mill) throw new NotFoundException('Mill not found.');
    const dates = query.period === 'WEEK' ? isoWeekDates(query.date) : [query.date];
    const [{ byDate, diets }, demand] = await Promise.all([
      this.schedules(tenantId, [mill.companyId], dates),
      this.approvedDemand(tenantId, { farmIds, companyIds: [mill.companyId] }, dates[0], dates[dates.length - 1]),
    ]);
    for (const [id, info] of demand.diets) diets.set(id, info);
    const report = buildCompareReport({ mill, dates, schedulesByDate: byDate, demand: demand.lines, diets });
    return { mills: mills.map((row) => ({ millId: row.millId, millCode: row.millCode, millName: row.millName })), report };
  }
}

export type { DietCapacity };

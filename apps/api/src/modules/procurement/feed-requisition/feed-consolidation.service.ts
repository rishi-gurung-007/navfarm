import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { FeedForecastService, draftForecastRange } from '../../inventory/feed-forecast/feed-forecast.service';
import { addDaysIso, exceedsCapacity, lifecycleRefLabel, projectedSiloStockKg } from './feed-requisition.rules';
import { isoProductionWeek } from '../../inventory/feed-forecast/feed-plan.rules';
import type { CreateFeedConsolidationDto, FeedConsolidationQueryDto } from './dto/feed-requisition.dto';
import { activeBinAssignments } from './feed-bin-assignments.query';
import { resolveLoadingBinId } from './feed-requisition-transfer.rules';
import { FeedLoadingService, transfersByRequisitionLine } from './feed-loading.service';
import { MillCapacityService, type CapacityObserver } from '../../inventory/feed-forecast/mill-capacity.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import type { DietCapacity } from '../../inventory/feed-forecast/mill-capacity.rules';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';

type User = { userId?: string; userType?: string };

/** Rishi, 30 Oct: the sheet shows each silo's projected stock for this many days from the farm's today. */
export const SHEET_FORECAST_DAYS = 14;

// Requisition §1 row 34's priorities (feed-requisition.rules.ts), most urgent first.
const PRIORITY_RANK: Record<string, number> = { CRITICAL_FIRST_PRIORITY: 0, CRITICAL: 1, WARNING: 2, INFO: 3 };
/**
 * Most urgent first: the earliest shortage, then the fewest days left, then the farm's Priority No. (1 first; a line
 * without one after those with one), then priority, then the delivery date asked for.
 */
export function byUrgency(
  a: { first_shortage_date: string | null; days_remaining: number | null; priority_no?: number | null; priority: string | null; proposed_delivery_date: string | null; req_no: string },
  b: { first_shortage_date: string | null; days_remaining: number | null; priority_no?: number | null; priority: string | null; proposed_delivery_date: string | null; req_no: string },
): number {
  const last = '9999-12-31';
  return (a.first_shortage_date ?? last).localeCompare(b.first_shortage_date ?? last)
    || (a.days_remaining ?? Number.POSITIVE_INFINITY) - (b.days_remaining ?? Number.POSITIVE_INFINITY)
    || (a.priority_no ?? Number.POSITIVE_INFINITY) - (b.priority_no ?? Number.POSITIVE_INFINITY)
    || (PRIORITY_RANK[a.priority ?? ''] ?? 9) - (PRIORITY_RANK[b.priority ?? ''] ?? 9)
    || String(a.proposed_delivery_date ?? last).localeCompare(String(b.proposed_delivery_date ?? last))
    || a.req_no.localeCompare(b.req_no);
}

@Injectable()
export class FeedConsolidationService {
  private readonly logger = new Logger(FeedConsolidationService.name);
  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    private readonly loading: FeedLoadingService,
    @Optional() private readonly millCapacity?: MillCapacityService,
    @Optional() private readonly feedAlerts?: FeedAlertService,
    @Optional() private readonly siloFeed?: SiloFeedService,
    @Optional() private readonly ledger?: InventoryLedgerService,
  ) {}

  /**
   * What is in each destination now, by the ledger — the System Balance a requisition drafted from the
   * calculation stores (feed-requisition.service currentBalances), not the forecast's projected opening.
   * Keyed `${locationId}|${itemId}`; a silo holding another item, or nothing, has 0 of this one.
   */
  private async ledgerBalances(
    lines: Array<{ destination_silo_id: string | null; item_id: string | null; company_id: string | null }>,
    tenantId: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const ids = [...new Set(lines.map((l) => l.destination_silo_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return result;
    const types = await this.db.select({ location_id: schema.locationMaster.location_id, location_type: schema.locationMaster.location_type })
      .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, ids));
    const typeOf = new Map(types.map((t) => [t.location_id, t.location_type]));
    for (const line of lines) {
      const id = line.destination_silo_id;
      if (!id || !line.item_id || !line.company_id || result.has(`${id}|${line.item_id}`)) continue;
      if (typeOf.get(id) === 'SILO' && this.siloFeed) {
        const resident = (await this.siloFeed.currentItems([id], line.company_id, tenantId)).get(id);
        result.set(`${id}|${line.item_id}`, resident && resident.item_id === line.item_id ? resident.on_hand_qty : 0);
      } else if (this.ledger) {
        const rows = await this.ledger.getStockBalance({ companyId: line.company_id, warehouseId: id } as any, tenantId);
        result.set(`${id}|${line.item_id}`, rows.filter((r: any) => r.item_id === line.item_id && r.uom === 'KG').reduce((sum: number, r: any) => sum + Number(r.on_hand_qty), 0));
      }
    }
    return result;
  }

  /**
   * W4G1 (checkpoint 34): CAPACITY_EXCEEDED follows the capacity check — raised, for each farm asking for the diet on
   * that day, when approved demand exceeds the Mill Capacity Available, and resolved where the same check now passes.
   * Alerts never fail the consolidation; the check itself still refuses as before.
   */
  /** The trailing arguments of the capacity check: nothing extra when no alerts are wired, so the call is unchanged. */
  private observerArgs(exclude: string | undefined, observer: CapacityObserver | undefined): [string?, CapacityObserver?] {
    return observer ? [exclude, observer] : exclude === undefined ? [] : [exclude];
  }

  private capacityObserver(tenantId: string, companyId: string, lines: Array<{ farmId: string; itemId: string; date: string }>): CapacityObserver | undefined {
    const alerts = this.feedAlerts;
    if (!alerts) return undefined;
    return async ({ checked, breaches }) => {
      try {
        const breached = new Set(breaches.map((b) => `${b.itemId}|${b.date}`));
        for (const b of breaches) {
          const farms = [...new Set(lines.filter((l) => l.itemId === b.itemId && l.date === b.date).map((l) => l.farmId))];
          for (const farmId of farms) {
            const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
            await alerts.raiseEvent({ farmId, companyId, tenantId }, {
              eventType: 'CAPACITY_EXCEEDED', subjectType: 'DIET_DATE', subjectId: b.itemId, dedupSuffix: `${b.itemId}|${b.date}`, itemId: b.itemId, observedValue: b.demandKg,
              title: `Mill capacity exceeded: ${b.itemCode} on ${b.date}`,
              message: `Approved demand for ${b.itemCode} on ${b.date} is ${kg(b.demandKg)} KG, above the ${kg(b.availableKg)} KG the mill can produce. Reduce Mill Approved Qty KG.`,
            });
          }
        }
        await alerts.resolveEvent({ companyId, tenantId }, 'CAPACITY_EXCEEDED', checked.map((c) => `${c.itemId}|${c.date}`).filter((k) => !breached.has(k)));
      } catch (error) {
        this.logger.warn(`CAPACITY_EXCEEDED alerts not updated: ${(error as Error).message}`);
      }
    };
  }

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async allowedFarmIds(tenantId: string, user: User, farmId?: string) {
    const farms = await this.forecast.listFarms(tenantId, user.userType);
    const allowed = new Set(farms.map((farm) => farm.farmId));
    if (farmId) {
      if (!allowed.has(farmId)) throw new NotFoundException('Farm not found.');
      return [farmId];
    }
    if (!farms.length) throw new NotFoundException('No farms are available in this scope.');
    return [...allowed];
  }

  /** A sheet is acted on only by someone whose scope reaches its company; a sheet of another company reads as not found. */
  private async assertCompanyAccess(companyId: string | null, tenantId: string, user: User): Promise<void> {
    const farms = await this.forecast.listFarms(tenantId, user.userType);
    if (!companyId || !farms.some((farm) => farm.companyId === companyId)) throw new NotFoundException('Consolidation sheet not found.');
  }

  private eligibleConditions(tenantId: string, farmIds: string[], query: FeedConsolidationQueryDto) {
    const R = schema.requisition;
    const conditions = [
      eq(R.tenant_id, tenantId),
      inArray(R.farm_id, farmIds),
      eq(R.doc_type, 'FEED'),
      isNull(R.deleted_at),
      isNull(R.feed_consolidation_id),
      sql`(${R.status} = 'APPROVED' OR ${R.approval_status} = 'APPROVED')`,
    ];
    if (query.requisitionIds?.length) conditions.push(inArray(R.requisition_id, query.requisitionIds));
    if (query.fromDate) conditions.push(sql`DATE(${R.created_at}) >= ${query.fromDate}`);
    if (query.toDate) conditions.push(sql`DATE(${R.created_at}) <= ${query.toDate}`);
    return conditions;
  }

  async eligible(query: FeedConsolidationQueryDto, tenantId: string, user: User) {
    const farmIds = await this.allowedFarmIds(tenantId, user, query.farmId);
    const R = schema.requisition;
    const rows = await this.db.select({
      requisition_id: R.requisition_id,
      req_no: R.req_no,
      requisition_date: R.requisition_date,
      production_date: R.production_date,
      company_id: R.company_id,
      created_at: R.created_at,
      farm_id: R.farm_id,
      farm_code: schema.locationMaster.location_code,
      farm_name: schema.locationMaster.location_name,
      line_id: schema.requisitionLine.line_id,
      item_id: schema.requisitionLine.item_id,
      item_code: schema.itemMaster.item_code,
      item_name: schema.itemMaster.item_name,
      diet_no: schema.itemMaster.diet_no,
      quantity: schema.requisitionLine.quantity,
      destination_silo_id: schema.requisitionLine.destination_location_id,
      proposed_delivery_date: schema.requisitionLine.proposed_delivery_date,
      feed_type: schema.requisitionLine.feed_type,
    }).from(R)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, R.farm_id))
      .innerJoin(schema.requisitionLine, eq(schema.requisitionLine.requisition_id, R.requisition_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.requisitionLine.item_id))
      .where(and(...this.eligibleConditions(tenantId, farmIds, query)))
      .orderBy(desc(R.created_at), R.req_no);
    const siloIds = [...new Set(rows.map((row) => row.destination_silo_id).filter((id): id is string => Boolean(id)))];
    const silos = siloIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name })
        .from(schema.locationMaster)
        .where(inArray(schema.locationMaster.location_id, siloIds))
      : [];
    const siloById = new Map(silos.map((silo) => [silo.location_id, silo]));
    const bins = await this.db.select({
      location_id: schema.locationMaster.location_id,
      location_code: schema.locationMaster.location_code,
      location_name: schema.locationMaster.location_name,
      bin_capacity_kg: schema.locationMaster.bin_capacity_kg,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'BIN'),
      isNull(schema.locationMaster.deleted_at),
    ));
    const binById = new Map(bins.map((bin) => [bin.location_id, bin]));
    const capacity = await this.capacityByDate(tenantId, rows);
    return rows.map((row) => {
      const silo = row.destination_silo_id ? siloById.get(row.destination_silo_id) : undefined;
      // Workbook Requisition and Loading Sheet r122/r125: the loading BIN and
      // Mill Capacity Available come from the mill setup for this diet on the
      // production date (the BIN Diet Assignment), never an arbitrary BIN.
      const diet = (row.item_id ? capacity.get(this.productionDateOf(row))?.get(row.item_id) : undefined) ?? null;
      const bin = diet?.binId ? binById.get(diet.binId) : undefined;
      return {
        ...row,
        destination_silo_code: silo?.location_code ?? null,
        destination_silo_name: silo?.location_name ?? null,
        loading_bin: bin?.location_code ?? null,
        loading_bin_name: bin?.location_name ?? null,
        loading_bin_capacity_kg: bin?.bin_capacity_kg ?? null,
        available_mill_output_kg: diet?.availableKg ?? null,
        mill_capacity_state: diet?.state ?? 'NOT_CONFIGURED',
        mill_capacity_status: diet?.status ?? null,
        mill_demand_kg: diet?.demandKg ?? null,
      };
    });
  }

  /**
   * The eligible lines with what the mill needs to rank them: how soon each farm's silo runs out, its
   * balance and daily use, the silo's capacity and the batches it feeds. A requisition made from a saved
   * calculation carries the forecast it was drafted from; a manual one has none, so its figures are read
   * from today's forecast for that farm and marked live. Sorted most urgent first.
   */
  async eligibleWithPriority(query: FeedConsolidationQueryDto, tenantId: string, user: User) {
    const rows = await this.eligible(query, tenantId, user);
    if (!rows.length) return [];
    const R = schema.requisition;
    const L = schema.requisitionLine;
    const lineIds = rows.map((r) => r.line_id);
    const stored = await this.db.select({
      line_id: L.line_id,
      priority: L.priority,
      priority_no: L.priority_no,
      requisition_type: R.requisition_type,
      system_balance_kg: L.system_balance_kg,
      daily_requirement_kg: L.daily_requirement_kg,
      days_remaining: L.days_remaining,
      first_shortage_date: L.first_shortage_date,
      recommended_qty_kg: L.recommended_qty_kg,
      recommended_delivery_date: L.recommended_delivery_date,
      is_next_diet: L.is_next_diet,
      days_before_diet_change: L.days_before_diet_change,
      lifecycle_ref_id: L.lifecycle_ref_id,
      needs_silo_changeover: L.needs_silo_changeover,
      exceeds_silo_capacity: L.exceeds_silo_capacity,
    }).from(L).innerJoin(R, eq(R.requisition_id, L.requisition_id)).where(inArray(L.line_id, lineIds));
    const storedById = new Map(stored.map((s) => [s.line_id, s]));

    // The Breed Lifecycle Row each line was drafted for, worded as the requisition document words it.
    const lifecycleIds = [...new Set(stored.map((s) => s.lifecycle_ref_id).filter((id): id is string => Boolean(id)))];
    const lifecycle = schema.breedLifecycleStages;
    const lifecycleRows = lifecycleIds.length
      ? await this.db.select({
        lifecycle_id: lifecycle.lifecycle_id, breed_code: schema.breedMaster.breed_code, stage_code: schema.stageMaster.stage_code,
        period_from: lifecycle.period_from, period_to: lifecycle.period_to, calc_unit: lifecycle.calc_unit,
      }).from(lifecycle)
        .leftJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, lifecycle.breed_id))
        .leftJoin(schema.stageMaster, eq(schema.stageMaster.stage_id, lifecycle.stage_id))
        .where(inArray(lifecycle.lifecycle_id, lifecycleIds))
      : [];
    const lifecycleLabelOf = new Map(lifecycleRows.map((r) => [r.lifecycle_id, lifecycleRefLabel(r)]));

    const siloIds = [...new Set(rows.map((r) => r.destination_silo_id).filter((id): id is string => Boolean(id)))];
    const capacities = siloIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_type: schema.locationMaster.location_type, silo_capacity_kg: schema.locationMaster.silo_capacity_kg })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, siloIds))
      : [];
    const capacityById = new Map(capacities.map((c) => [c.location_id, c.location_type === 'SILO' && c.silo_capacity_kg != null ? Number(c.silo_capacity_kg) : null]));
    const isSiloId = new Set(capacities.filter((c) => c.location_type === 'SILO').map((c) => c.location_id));

    const B = schema.requisitionLineBatch;
    const batchRows = await this.db.select({
      line_id: B.line_id, batch_id: B.batch_id, heads: B.heads, demand_kg: B.demand_kg,
      batch_no: schema.batchHeader.batch_no, shed_code: schema.locationMaster.location_code,
    }).from(B)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, B.batch_id))
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, B.shed_id))
      .where(inArray(B.line_id, lineIds));
    const batchesByLine = new Map<string, Array<{ batch_id: string; batch_no: string | null; shed_code: string | null; heads: number | null; demand_kg: number | null }>>();
    for (const b of batchRows) {
      const list = batchesByLine.get(b.line_id) ?? [];
      list.push({ batch_id: b.batch_id, batch_no: b.batch_no ?? null, shed_code: b.shed_code ?? null, heads: b.heads == null ? null : Number(b.heads), demand_kg: b.demand_kg == null ? null : Number(b.demand_kg) });
      batchesByLine.set(b.line_id, list);
    }

    const hasStored = (s: (typeof stored)[number] | undefined) =>
      !!s && (s.first_shortage_date != null || s.days_remaining != null || s.system_balance_kg != null);
    // One live forecast per farm on the sheet (Rishi, 30 Oct: every line shows its silo's coming days, not only
    // a manual one's figures); a farm the forecast cannot read is left N/A.
    type Forecast = Awaited<ReturnType<FeedForecastService['computeForFarm']>>;
    const liveFarms = [...new Map(rows.map((r) => [r.farm_id, r.company_id])).entries()];
    const liveByFarm = new Map<string, Forecast['sources']>();
    const balancesByFarm = new Map<string, Forecast['sourceBalances']>();
    const todayByFarm = new Map<string, string>();
    for (const [farmId, companyId] of liveFarms) {
      if (!farmId || !companyId) continue;
      try {
        const clock = await this.forecast.farmToday(companyId, tenantId);
        const result = await this.forecast.withFarmScope(farmId, companyId, () =>
          this.forecast.computeForFarm(farmId, companyId, tenantId, draftForecastRange(clock.today), clock));
        liveByFarm.set(farmId, result.sources);
        balancesByFarm.set(farmId, result.sourceBalances ?? []);
        todayByFarm.set(farmId, clock.today);
      } catch (err) {
        this.logger.warn(`Live forecast for farm ${farmId} could not be read: ${(err as Error).message}`);
      }
    }
    // What each silo holds now, for a day the forecast does not reach (projectedSiloStockKg).
    const onHandBySilo = new Map<string, number>();
    if (this.siloFeed) {
      for (const companyId of [...new Set(rows.map((r) => r.company_id).filter((id): id is string => Boolean(id)))]) {
        const ids = [...new Set(rows.filter((r) => r.company_id === companyId && r.destination_silo_id && isSiloId.has(r.destination_silo_id)).map((r) => r.destination_silo_id!))];
        if (!ids.length) continue;
        try {
          for (const [id, resident] of await this.siloFeed.currentItems(ids, companyId, tenantId)) onHandBySilo.set(id, resident?.on_hand_qty ?? 0);
        } catch (err) {
          this.logger.warn(`Silo stock for company ${companyId} could not be read: ${(err as Error).message}`);
        }
      }
    }
    const stockOf = (row: (typeof rows)[number], date: string) =>
      projectedSiloStockKg(balancesByFarm.get(row.farm_id ?? '') ?? [], row.destination_silo_id!, date, onHandBySilo.get(row.destination_silo_id!) ?? 0);

    const balances = await this.ledgerBalances(rows.filter((r) => !hasStored(storedById.get(r.line_id))), tenantId);
    const num = (v: unknown) => (v == null ? null : Number(v));
    const ranked = rows.map((row) => {
      const s = storedById.get(row.line_id);
      const capacityKg = row.destination_silo_id ? capacityById.get(row.destination_silo_id) ?? null : null;
      const today = row.farm_id ? todayByFarm.get(row.farm_id) : undefined;
      const isSilo = !!row.destination_silo_id && isSiloId.has(row.destination_silo_id);
      const delivery = row.proposed_delivery_date ? String(row.proposed_delivery_date).slice(0, 10) : null;
      // The silo's projected stock each morning; it already counts every approved, open requisition's delivery.
      const forecastDays = today && isSilo
        ? Array.from({ length: SHEET_FORECAST_DAYS }, (_, i) => { const date = addDaysIso(today, i); return { date, stock_kg: stockOf(row, date) }; })
        : [];
      const deliveryDayStockKg = today && isSilo && delivery ? stockOf(row, delivery) : null;
      const base = {
        ...row, priority: s?.priority ?? null, priority_no: s?.priority_no ?? null, silo_capacity_kg: capacityKg, batches: batchesByLine.get(row.line_id) ?? [],
        lifecycle_ref_label: s?.lifecycle_ref_id ? lifecycleLabelOf.get(s.lifecycle_ref_id) ?? null : null,
        days_before_diet_change: s?.days_before_diet_change ?? null,
        forecast_days: forecastDays,
        delivery_day_stock_kg: deliveryDayStockKg,
      };
      // The 30 Oct quantity rule, read today: the morning stock on the delivery day plus this delivery past the capacity.
      const overCapacity = deliveryDayStockKg !== null && exceedsCapacity(Number(row.quantity), deliveryDayStockKg, capacityKg);
      if (hasStored(s)) {
        return {
          ...base,
          figures_source: 'STORED' as const,
          system_balance_kg: num(s!.system_balance_kg),
          daily_requirement_kg: num(s!.daily_requirement_kg),
          days_remaining: num(s!.days_remaining),
          first_shortage_date: s!.first_shortage_date ? String(s!.first_shortage_date).slice(0, 10) : null,
          recommended_qty_kg: num(s!.recommended_qty_kg),
          recommended_delivery_date: s!.recommended_delivery_date ? String(s!.recommended_delivery_date).slice(0, 10) : null,
          is_next_diet: !!s!.is_next_diet,
          needs_silo_changeover: !!s!.needs_silo_changeover,
          exceeds_silo_capacity: deliveryDayStockKg !== null ? overCapacity : !!s!.exceeds_silo_capacity,
        };
      }
      const live = (row.farm_id ? liveByFarm.get(row.farm_id) : undefined)?.find((src) => src.locationId === row.destination_silo_id && src.itemId === row.item_id);
      return {
        ...base,
        figures_source: live ? ('LIVE' as const) : ('NONE' as const),
        system_balance_kg: row.destination_silo_id ? balances.get(`${row.destination_silo_id}|${row.item_id}`) ?? null : null,
        daily_requirement_kg: live ? (live.planningDayDemandKg > 0 ? live.planningDayDemandKg : live.firstDayDemandKg) : null,
        days_remaining: live ? live.daysLeft : null,
        first_shortage_date: live?.shortageDate ?? null,
        recommended_qty_kg: live ? live.shortfallKg : null,
        recommended_delivery_date: null,
        is_next_diet: live?.isNextDiet ?? false,
        needs_silo_changeover: live?.noSiloHoldsItem ?? false,
        exceeds_silo_capacity: deliveryDayStockKg !== null ? overCapacity : live ? exceedsCapacity(Number(row.quantity), live.deliveryDayOpeningKg, capacityKg) : false,
      };
    });
    return ranked.sort(byUrgency);
  }

  private productionDateOf(row: { production_date: string | null; proposed_delivery_date: string | null }) {
    return String(row.production_date || row.proposed_delivery_date || '').slice(0, 10);
  }

  /** All farms' approved demand per diet and date, allocated against the mill (Engine r40–r42). */
  private async capacityByDate(tenantId: string, rows: Array<{ company_id: string | null; production_date: string | null; proposed_delivery_date: string | null }>) {
    const result = new Map<string, Map<string, DietCapacity>>();
    if (!this.millCapacity) return result;
    const companyIds = [...new Set(rows.map((row) => row.company_id).filter((id): id is string => Boolean(id)))];
    const dates = [...new Set(rows.map((row) => this.productionDateOf(row)).filter(Boolean))].sort();
    if (!dates.length) return result;
    // One demand query across the whole date span and one mill/schedule load for every date.
    const { lines } = await this.millCapacity.approvedDemand(tenantId, { companyIds }, dates[0], dates[dates.length - 1]);
    const demandsByDate = new Map<string, Array<{ itemId: string; demandKg: number }>>(dates.map((date) => [date, []]));
    for (const line of lines) demandsByDate.get(line.productionDate)?.push({ itemId: line.itemId, demandKg: line.requestedKg });
    return this.millCapacity.allocateOnDates(tenantId, companyIds, demandsByDate);
  }

  async create(dto: CreateFeedConsolidationDto, tenantId: string, user: User) {
    if ((dto.fromDate && !dto.toDate) || (!dto.fromDate && dto.toDate) || (dto.fromDate && dto.toDate && dto.fromDate > dto.toDate)) {
      throw new ConflictException('A valid date range requires both From date and To date.');
    }
    const eligible = await this.eligible({
      farmId: dto.farmId,
      requisitionIds: dto.requisitionIds,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
    }, tenantId, user);
    const requested = new Map(eligible.map((line) => [line.line_id, Number(line.quantity)]));
    const selected = eligible.filter((line) => dto.lines.some((input) => input.requisitionLineId === line.line_id));
    if (!selected.length) throw new ConflictException('Select at least one approved requisition line without a consolidation sheet.');
    const edits = new Map(dto.lines.map((line) => [line.requisitionLineId, line]));
    for (const line of selected) {
      const edit = edits.get(line.line_id)!;
      const approved = edit.millApprovedQtyKg ?? requested.get(line.line_id)!;
      if (approved < 0) throw new ConflictException(`Mill approved quantity for ${line.req_no} cannot be negative.`);
      if (approved !== requested.get(line.line_id) && !edit.adjustmentReason?.trim()) {
        throw new ConflictException(`Adjustment reason is required for ${line.req_no}.`);
      }
    }
    const selectedCompanies = [...new Set(selected.map((line) => line.company_id).filter(Boolean))];
    if (selectedCompanies.length === 1) {
      await this.millCapacity?.assertConsolidationWithinCapacity(tenantId, selectedCompanies[0]!, selected.map((line) => ({
        productionDate: this.productionDateOf(line), itemId: line.item_id!, itemCode: line.item_code,
        millApprovedKg: edits.get(line.line_id)!.millApprovedQtyKg ?? requested.get(line.line_id)!,
      })), ...this.observerArgs(undefined, this.capacityObserver(tenantId, selectedCompanies[0]!, selected.map((line) => ({ farmId: line.farm_id!, itemId: line.item_id!, date: this.productionDateOf(line) })))));
    }
    const productionDate = selected.map((line) => line.production_date || line.proposed_delivery_date).find(Boolean) || new Date().toISOString().slice(0, 10);
    const productionWeek = isoProductionWeek(productionDate);
    return withTenantTransaction(this.cls, async () => {
      const [countRow] = await this.db.select({ count: sql<number>`COUNT(*)` }).from(schema.feedConsolidation).where(and(
        eq(schema.feedConsolidation.tenant_id, tenantId),
        eq(schema.feedConsolidation.production_week, productionWeek),
      )).for('update');
      const sequence = Number(countRow?.count ?? 0) + 1;
      const consolidationId = randomUUID();
      const consolidationNo = `CONS-${productionWeek}-${String(sequence).padStart(3, '0')}`;
      const companyIds = new Set(selected.map((line) => line.farm_id));
      const farms = await this.db.select({ farm_id: schema.locationMaster.location_id, company_id: schema.locationMaster.company_id })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, [...companyIds]));
      const companyId = farms[0]?.company_id;
      if (!companyId || farms.some((farm) => farm.company_id !== companyId)) throw new ConflictException('Selected requisitions must belong to one company.');
      await this.db.insert(schema.feedConsolidation).values({
        consolidation_id: consolidationId, consolidation_no: consolidationNo, tenant_id: tenantId,
        company_id: companyId, production_week: productionWeek,
        consolidation_date: new Date().toISOString().slice(0, 10), created_by: user.userId ?? null, status: 'DRAFT',
      });
      await this.db.insert(schema.feedConsolidationLine).values(selected.map((line) => {
        const edit = edits.get(line.line_id)!;
        const approved = edit.millApprovedQtyKg ?? requested.get(line.line_id)!;
        return {
          consolidation_line_id: randomUUID(), consolidation_id: consolidationId,
          requisition_id: line.requisition_id, requisition_line_id: line.line_id,
          farm_id: line.farm_id!, item_id: line.item_id!, requested_qty_kg: String(requested.get(line.line_id)),
          destination_silo_id: line.destination_silo_id, requested_delivery_date: line.proposed_delivery_date,
          production_date: line.production_date,
          mill_approved_qty_kg: String(approved), adjustment_reason: edit.adjustmentReason?.trim() || null, bc_to_no: null,
        };
      }));
      await this.db.update(schema.requisition).set({ feed_consolidation_id: consolidationId, status: 'IN_CONSOLIDATION', updated_by: user.userId ?? null })
        .where(inArray(schema.requisition.requisition_id, [...new Set(selected.map((line) => line.requisition_id))]));
      await this.loading.createForConsolidation(consolidationId, tenantId, user);
      return { consolidationId, consolidationNo, productionWeek, status: 'DRAFT', lineCount: selected.length };
    });
  }

  async list(query: FeedConsolidationQueryDto, tenantId: string, user: User) {
    const farmIds = await this.allowedFarmIds(tenantId, user, query.farmId);
    const companyIds = (await this.db.select({ company_id: schema.locationMaster.company_id })
      .from(schema.locationMaster)
      .where(inArray(schema.locationMaster.location_id, farmIds)))
      .map((r) => r.company_id!).filter(Boolean);
    const conditions = [
      eq(schema.feedConsolidation.tenant_id, tenantId),
      inArray(schema.feedConsolidation.company_id, companyIds),
    ];
    if (query.status) conditions.push(eq(schema.feedConsolidation.status, query.status));
    if (query.fromDate) conditions.push(sql`${schema.feedConsolidation.consolidation_date} >= ${query.fromDate}`);
    if (query.toDate) conditions.push(sql`${schema.feedConsolidation.consolidation_date} <= ${query.toDate}`);
    const rows = await this.db.select().from(schema.feedConsolidation).where(and(...conditions)).orderBy(desc(schema.feedConsolidation.consolidation_date), desc(schema.feedConsolidation.created_at));
    const ids = rows.map((row) => row.consolidation_id);
    const lines = ids.length ? await this.db.select({ consolidation_id: schema.feedConsolidationLine.consolidation_id, requested_qty_kg: schema.feedConsolidationLine.requested_qty_kg, mill_approved_qty_kg: schema.feedConsolidationLine.mill_approved_qty_kg }).from(schema.feedConsolidationLine).where(inArray(schema.feedConsolidationLine.consolidation_id, ids)) : [];
    return rows.map((row) => ({ ...row, line_count: lines.filter((line) => line.consolidation_id === row.consolidation_id).length, requested_qty_kg: lines.filter((line) => line.consolidation_id === row.consolidation_id).reduce((sum, line) => sum + Number(line.requested_qty_kg), 0), mill_approved_qty_kg: lines.filter((line) => line.consolidation_id === row.consolidation_id).reduce((sum, line) => sum + Number(line.mill_approved_qty_kg), 0) }));
  }

  async findOne(consolidationId: string, tenantId: string, _user: User) {
    const [header] = await this.db.select().from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId)));
    if (!header) throw new NotFoundException('Consolidation sheet not found.');
    const lines = await this.db.select().from(schema.feedConsolidationLine).where(eq(schema.feedConsolidationLine.consolidation_id, consolidationId));
    const loadingSheets = lines.length ? await this.db.select({
      consolidation_line_id: schema.feedLoadingSheet.consolidation_line_id,
      loading_sheet_id: schema.feedLoadingSheet.loading_sheet_id,
      loading_sheet_no: schema.feedLoadingSheet.loading_sheet_no,
      mill_loading_bin_id: schema.feedLoadingSheet.mill_loading_bin_id,
    }).from(schema.feedLoadingSheet).where(eq(schema.feedLoadingSheet.consolidation_id, consolidationId)) : [];
    const loadingByLine = new Map(loadingSheets.map((sheet) => [sheet.consolidation_line_id, sheet]));
    // r122/r125: the diet's BIN and Mill Capacity Available on the line's production date.
    const capacity = await this.capacityByDate(tenantId, lines.map((line) => ({
      company_id: header.company_id, production_date: line.production_date, proposed_delivery_date: line.requested_delivery_date,
    })));
    const dietOf = (line: typeof lines[number]) => capacity.get(this.productionDateOf({ production_date: line.production_date, proposed_delivery_date: line.requested_delivery_date }))?.get(line.item_id);
    // r122: the loading sheet's BIN snapshot is what the mill loads from; before a sheet exists, the assignment.
    // Before a sheet exists, the same BIN Diet lookup Release and the loading sheet use (resolveLoadingBinId), not the capacity schedule.
    const assignments = await activeBinAssignments(this.db, header.company_id, lines.map((line) => line.production_date), lines.map((line) => line.item_id), tenantId);
    const binOf = (line: typeof lines[number]) => loadingByLine.get(line.consolidation_line_id)?.mill_loading_bin_id
      ?? resolveLoadingBinId({ itemId: line.item_id, productionDate: line.production_date }, assignments);
    const locationIds = [...new Set(lines.flatMap((line) => [line.farm_id, line.destination_silo_id, binOf(line)].filter((id): id is string => !!id)))];
    const locations = locationIds.length ? await this.db.select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
      .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds)) : [];
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const items = lines.length ? await this.db.select({ id: schema.itemMaster.item_id, code: schema.itemMaster.item_code, name: schema.itemMaster.item_name, diet_no: schema.itemMaster.diet_no })
      .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, [...new Set(lines.map((line) => line.item_id))])) : [];
    const itemById = new Map(items.map((item) => [item.id, item]));
    const requisitions = lines.length ? await this.db.select({ id: schema.requisition.requisition_id, no: schema.requisition.req_no })
      .from(schema.requisition).where(inArray(schema.requisition.requisition_id, [...new Set(lines.map((line) => line.requisition_id))])) : [];
    const reqById = new Map(requisitions.map((req) => [req.id, req]));
    // r130: the transfer per farm line, created at Release.
    const transfers = await transfersByRequisitionLine(this.db, lines.map((line) => line.requisition_line_id));
    // r118: Feed Mill Manager = the user who created the sheet.
    const [manager] = header.created_by ? await this.db.select({ id: schema.userMaster.user_id, name: schema.userMaster.full_name })
      .from(schema.userMaster).where(eq(schema.userMaster.user_id, header.created_by)).limit(1) : [];
    // r124: Total All Farms KG for the diet = the sheet's requested KG for that diet across every farm.
    const dietTotal = new Map<string, number>();
    for (const line of lines) dietTotal.set(line.item_id, (dietTotal.get(line.item_id) ?? 0) + (Number(line.requested_qty_kg) || 0));
    return { ...header, feed_mill_manager_name: manager?.name ?? null, lines: lines.map((line) => {
      const location = (id: string | null) => (id ? locationById.get(id) : undefined);
      const item = itemById.get(line.item_id);
      const diet = dietOf(line);
      const binId = binOf(line);
      const loadingSheet = loadingByLine.get(line.consolidation_line_id);
      const transfer = transfers.get(line.requisition_line_id);
      return {
        ...line,
        requisition_no: reqById.get(line.requisition_id)?.no ?? null,
        farm_code: location(line.farm_id)?.code ?? null,
        farm_name: location(line.farm_id)?.name ?? null,
        destination_silo_code: location(line.destination_silo_id)?.code ?? null,
        destination_silo_name: location(line.destination_silo_id)?.name ?? null,
        item_code: item?.code ?? null,
        item_name: item?.name ?? null,
        diet_no: item?.diet_no ?? null,
        mill_loading_bin_id: binId && location(binId) ? binId : null,
        mill_loading_bin_code: location(binId)?.code ?? null,
        mill_loading_bin_name: location(binId)?.name ?? null,
        available_mill_output_kg: diet?.availableKg ?? null,
        mill_capacity_state: diet?.state ?? 'NOT_CONFIGURED',
        mill_capacity_status: diet?.status ?? null,
        total_all_farms_kg: dietTotal.get(line.item_id) ?? 0,
        transfer_id: transfer?.transfer_id ?? null,
        transfer_no: transfer?.transfer_no ?? null,
        loading_sheet_id: loadingSheet?.loading_sheet_id ?? null,
        loading_sheet_no: loadingSheet?.loading_sheet_no ?? null,
      };
    }) };
  }

  /** Req r128: DRAFT to REVIEWED, the mill manager's check before the sheet is consolidated. */
  async markReviewed(consolidationId: string, tenantId: string, user: User) {
    const [row] = await this.db.select().from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId))).limit(1).for('update');
    if (!row) throw new NotFoundException('Consolidation sheet not found.');
    await this.assertCompanyAccess(row.company_id, tenantId, user);
    if (row.status !== 'DRAFT') throw new ConflictException(`Consolidation ${row.consolidation_no} cannot be marked reviewed from ${row.status}.`);
    await this.db.update(schema.feedConsolidation).set({ status: 'REVIEWED' }).where(eq(schema.feedConsolidation.consolidation_id, consolidationId));
    return this.findOne(consolidationId, tenantId, user);
  }

  async finalize(consolidationId: string, tenantId: string, user: User) {
    const [row] = await this.db.select().from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId))).limit(1).for('update');
    if (!row) throw new NotFoundException('Consolidation sheet not found.');
    await this.assertCompanyAccess(row.company_id, tenantId, user);
    if (!['DRAFT', 'REVIEWED'].includes(row.status)) throw new ConflictException(`Consolidation ${row.consolidation_no} cannot be finalized from ${row.status}.`);
    if (this.millCapacity) {
      // Checkpoint 42: "Cannot push infeasible plan" — finalizing is the
      // in-house push, so the sheet is checked again against the mill as it
      // stands now (its setup may have changed since the sheet was created).
      const lines = await this.db.select({
        item_id: schema.feedConsolidationLine.item_id, item_code: schema.itemMaster.item_code, farm_id: schema.feedConsolidationLine.farm_id,
        production_date: schema.feedConsolidationLine.production_date, requested_delivery_date: schema.feedConsolidationLine.requested_delivery_date,
        mill_approved_qty_kg: schema.feedConsolidationLine.mill_approved_qty_kg,
      }).from(schema.feedConsolidationLine)
        .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.feedConsolidationLine.item_id))
        .where(eq(schema.feedConsolidationLine.consolidation_id, consolidationId));
      await this.millCapacity.assertConsolidationWithinCapacity(tenantId, row.company_id, lines.map((line) => ({
        productionDate: this.productionDateOf({ production_date: line.production_date, proposed_delivery_date: line.requested_delivery_date }),
        itemId: line.item_id, itemCode: line.item_code, millApprovedKg: Number(line.mill_approved_qty_kg) || 0,
      })), ...this.observerArgs(consolidationId, this.capacityObserver(tenantId, row.company_id, lines.map((line) => ({
        farmId: line.farm_id, itemId: line.item_id, date: this.productionDateOf({ production_date: line.production_date, proposed_delivery_date: line.requested_delivery_date }),
      })))));
    }
    await this.db.update(schema.feedConsolidation).set({ status: 'CONSOLIDATED' }).where(eq(schema.feedConsolidation.consolidation_id, consolidationId));
    await this.notifyMillAdjusted(consolidationId, row.company_id, row.consolidation_no, tenantId);
    return this.findOne(consolidationId, tenantId, user);
  }

  /**
   * W4G1 (Req. row 126): once the sheet is final, each farm whose lines the mill approved at a different KG than it
   * asked for is told, with the lines and the reason given. A farm whose lines all match hears nothing.
   */
  private async notifyMillAdjusted(consolidationId: string, companyId: string, consolidationNo: string, tenantId: string) {
    if (!this.feedAlerts) return;
    try {
      const L = schema.feedConsolidationLine;
      const lines = await this.db.select({
        farm_id: L.farm_id, item_code: schema.itemMaster.item_code, requested: L.requested_qty_kg, approved: L.mill_approved_qty_kg, reason: L.adjustment_reason,
      }).from(L).innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, L.item_id)).where(eq(L.consolidation_id, consolidationId));
      const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
      const byFarm = new Map<string, typeof lines>();
      for (const line of lines) {
        if (Math.abs(Number(line.approved) - Number(line.requested)) < 1e-6) continue;
        byFarm.set(line.farm_id, [...(byFarm.get(line.farm_id) ?? []), line]);
      }
      for (const [farmId, changed] of byFarm) {
        await this.feedAlerts.raiseEvent({ farmId, companyId, tenantId }, {
          eventType: 'MILL_ADJUSTED', subjectType: 'CONSOLIDATION', subjectId: consolidationId, dedupSuffix: `${consolidationId}|${farmId}`,
          title: `Mill changed your quantity: ${consolidationNo}`,
          message: `${consolidationNo}: ${changed.map((l) => `${l.item_code} asked ${kg(Number(l.requested))} KG, mill approved ${kg(Number(l.approved))} KG${l.reason ? ` (${l.reason})` : ''}`).join('; ')}.`,
        });
      }
    } catch (error) {
      this.logger.warn(`MILL_ADJUSTED alerts not raised for ${consolidationNo}: ${(error as Error).message}`);
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, ne, notInArray, or, sql, SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../core/database/schema';
import { withTenantTransaction } from '../../common/tenant-transaction';
import { assertCompanyInScope, farmOfLocation, farmScope, locationOnFarm, restrictedScopeConditions } from '../../common/farm-scope';
import { companyCondition } from '../../common/master-data-scope';
import { AuditLogService } from '../system/audit-log/audit-log.service';
import { UomService } from '../master-data/uom/uom.service';
import { quantityInKilograms } from '../inventory/stock-transfer/kilograms';
import { CAPACITY_BY_VEHICLE_TYPE, VEHICLE_TYPES } from './logistics.rules';
import {
  baseFreight, canMove, capacityCheck, estimateArrival, pickRate, shareByWeight, TRIP_STATUSES, type RateRow, type TripStatus,
} from './trip.rules';
import { driverExclusions, vehicleExclusions, type DriverFacts, type Interval, type VehicleFacts, type VehicleType } from './trip-eligibility';

type Row = Record<string, any>;
type RouteRow = typeof schema.logisticsRoute.$inferSelect;

export type PlanTripInput = {
  transfer_ids: string[];
  planned_departure: string;
  route_id: string;
  vehicle_type: string;
  carrier_supplier_id?: string | null;
};
/** Phase 3: a trip for one cross-farm livestock batch transfer. The truck is a LIVESTOCK one and the load is its head. */
export type PlanBatchTripInput = {
  batch_transfer_id: string;
  planned_departure: string;
  route_id: string;
  carrier_supplier_id?: string | null;
};
export type AssignTripInput = { vehicle_id: string; driver_id: string; carrier_supplier_id?: string | null };
export type MoveTripInput = { to: string; reason?: string; hq_approval_ref?: string; at?: string };
export type TripListQuery = { status?: string; limit?: number | string; offset?: number | string };

/** A trip's place in no truck's or driver's diary once it is over. */
const TERMINAL: TripStatus[] = ['CANCELLED', 'CLOSED'];
const LOCKED = 'This trip is closed and locked.';
const NO_RATE = 'No approved freight rate.';
const ASSIGN_FIRST = 'Assign a vehicle to estimate cost.';
const NO_WEIGHT = 'No line has a weight; cost shared equally between lines.';
/** Statuses that say the load has reached the farm; a TO still DRAFT on the trip cannot be there (final review I1). */
const DELIVERED: TripStatus[] = ['ARRIVED', 'POD_RECEIVED', 'RETURNED', 'CLOSED'];

/** What the planner says the load is (Ruling, 12 Nov): the truck type, and the measure its capacity is in. */
const LOAD_UNIT: Record<VehicleType, 'KG' | 'BAGS' | 'HEAD'> = { BULK_FEED: 'KG', BAGGED_FEED: 'BAGS', LIVESTOCK: 'HEAD' };
const TYPE_OF_UNIT: Record<string, VehicleType> = { KG: 'BULK_FEED', BAGS: 'BAGGED_FEED', HEAD: 'LIVESTOCK' };
const LINE_MEASURE: Record<string, 'weight_kg' | 'bag_count' | 'head_count'> = { KG: 'weight_kg', BAGS: 'bag_count', HEAD: 'head_count' };
/** Said when a line cannot be put in the trip's measure: capacity is then not checked, never guessed. */
const UNMEASURED: Record<string, string> = {
  KG: 'Some lines have no conversion to KG, so the load cannot be checked against the truck capacity.',
  BAGS: 'Bag size is not set for this feed, so the load in bags cannot be checked against the truck capacity.',
  HEAD: 'Some lines are not counted in HEAD, so the load cannot be checked against the truck capacity.',
};

// Times. A trip's times are the farm's local wall-clock ('YYYY-MM-DDTHH:mm:ss', no zone); arithmetic treats them as
// UTC only so that the server's own zone never shifts them.
const NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/;
const naive = (v: unknown): string | null => {
  const m = typeof v === 'string' ? NAIVE.exec(v.trim()) : null;
  return m ? `${m[1]}T${m[2]}${m[3] ?? ':00'}` : null;
};
const fromDb = (v: unknown): string | null => (v ? naive(String(v).slice(0, 19)) : null);
const toDb = (v: string) => v.replace('T', ' ');
const asDate = (v: string) => new Date(Date.parse(`${v}Z`));
const fromDate = (d: Date) => d.toISOString().slice(0, 19);
const addMinutes = (v: string, minutes: number) => fromDate(new Date(asDate(v).getTime() + Math.round(minutes * 60000)));
const day = (v: unknown) => String(v ?? '').slice(0, 10);
/** Audit columns, written the way the Phase 1 masters write them. */
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
/** The server's local wall-clock, for a status time the user did not give. */
const localNow = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const dec = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v.toFixed(2));
const notes = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' ') || null;

/** The time a truck going to a stamp field on a status move. */
const STAMP: Partial<Record<TripStatus, string>> = {
  IN_TRANSIT: 'actual_departure', ARRIVED: 'actual_arrival', POD_RECEIVED: 'pod_received_at', RETURNED: 'returned_at',
};

/**
 * Logistics Phase 2 trips (NAVFarm TDD: Logistics Module): plan a trip from Transfer Orders, find and assign a truck and
 * driver, and move it through its statuses. A company document like the Phase 1 masters: tenant- and company-scoped,
 * never deleted (cancelled, with a reason), every write audited. The rules live in trip.rules.ts and trip-eligibility.ts;
 * this file only gathers their inputs and writes their answers. Vehicle status is not touched in Phase 2 (Ruling, 12
 * Nov): two trips are kept off one truck by their time windows overlapping.
 */
@Injectable()
export class LogisticsTripService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly uomService: UomService,
  ) {}

  private get db() {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Which Transfer Orders the caller may see: the same rule as StockTransferService's findOne/loadForClose — a
   * farm-bound or farm-selected caller sees TOs from or to their farm; a restricted caller, TOs touching their LOB.
   * The company boundary is added by the caller of this, on whichever table it reads.
   */
  private transferScope(): SQL[] {
    const scope = farmScope(this.cls);
    const T = schema.stockTransfer;
    const out: SQL[] = [];
    if (scope.farmId) out.push(or(locationOnFarm(T.from_warehouse_id, scope.farmId), locationOnFarm(T.to_warehouse_id, scope.farmId))!);
    if (scope.restricted && scope.lobId)
      out.push(or(
        sql`${T.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
        sql`${T.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
      )!);
    return out;
  }

  /** The same rule for livestock batch transfers as BatchTransferService.findAll: a transfer from or to a batch on the caller's farm (or LOB). */
  private batchTransferScope(): SQL[] {
    const scope = farmScope(this.cls);
    const BT = schema.batchTransfer;
    const out: SQL[] = [];
    if (scope.farmId)
      out.push(or(
        sql`${BT.from_batch_id} IN (SELECT bh.batch_id FROM batch_header bh WHERE bh.farm_id = ${scope.farmId})`,
        sql`${BT.to_batch_id} IN (SELECT bh.batch_id FROM batch_header bh WHERE bh.farm_id = ${scope.farmId})`,
      )!);
    if (scope.restricted && scope.lobId)
      out.push(or(
        sql`${BT.from_batch_id} IN (SELECT bh.batch_id FROM batch_header bh WHERE bh.lob_id = ${scope.lobId})`,
        sql`${BT.to_batch_id} IN (SELECT bh.batch_id FROM batch_header bh WHERE bh.lob_id = ${scope.lobId})`,
      )!);
    return out;
  }

  /**
   * A trip is visible within the caller's company and, for a farm- or LOB-restricted caller, only when at least one
   * of its TOs is (through its lines, which outlive a cancel that frees the TOs). Unrestricted callers see every trip.
   */
  private scope(): SQL[] {
    const out = restrictedScopeConditions(farmScope(this.cls), { companyId: schema.logisticsTrip.company_id });
    const onTransfers = this.transferScope();
    if (onTransfers.length) {
      const L = schema.logisticsTripLine;
      const T = schema.stockTransfer;
      const BT = schema.batchTransfer;
      out.push(or(
        sql`exists (select 1 from ${L} inner join ${T} on ${eq(T.transfer_id, L.transfer_id)} where ${and(
          eq(L.trip_id, schema.logisticsTrip.trip_id), isNull(L.deleted_at), ...onTransfers,
        )})`,
        sql`exists (select 1 from ${L} inner join ${BT} on ${eq(BT.transfer_id, L.batch_transfer_id)} where ${and(
          eq(L.trip_id, schema.logisticsTrip.trip_id), isNull(L.deleted_at), ...this.batchTransferScope(),
        )})`,
      )!);
    }
    return out;
  }

  private async loadTrip(id: string, tenantId: string): Promise<Row> {
    const [trip] = await this.db.select().from(schema.logisticsTrip)
      .where(and(eq(schema.logisticsTrip.trip_id, id), eq(schema.logisticsTrip.tenant_id, tenantId), isNull(schema.logisticsTrip.deleted_at), ...this.scope()))
      .limit(1);
    if (!trip) throw new NotFoundException('Trip not found.');
    return trip;
  }

  private async routeOf(routeId: string | null, companyId: string | null, tenantId: string): Promise<RouteRow> {
    const [route] = routeId
      ? await this.db.select().from(schema.logisticsRoute)
        .where(and(
          eq(schema.logisticsRoute.route_id, routeId), eq(schema.logisticsRoute.tenant_id, tenantId),
          companyCondition(schema.logisticsRoute.company_id, companyId), isNull(schema.logisticsRoute.deleted_at),
        ))
        .limit(1)
      : [];
    if (!route) throw new NotFoundException('Route is not available in this company.');
    return route;
  }

  async findAll(query: TripListQuery, tenantId: string) {
    const conditions: SQL[] = [eq(schema.logisticsTrip.tenant_id, tenantId), isNull(schema.logisticsTrip.deleted_at), ...this.scope()];
    if (query.status) conditions.push(eq(schema.logisticsTrip.status, String(query.status)));
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const where = and(...conditions);
    const data = await this.db.select().from(schema.logisticsTrip).where(where)
      .orderBy(desc(schema.logisticsTrip.created_at)).limit(limit).offset(offset);
    const [{ total }] = await this.db.select({ total: count() }).from(schema.logisticsTrip).where(where);
    return { data, total: Number(total), limit, offset };
  }

  /**
   * The Dispatch Board (Phase 3): the trips still to run or running — Planned, Confirmed, In transit, Arrived — whose
   * departure falls inside the next `days` days (a trip already on the road or arrived stays on the board whatever its
   * date), and the Transfer Orders still in DRAFT with no trip. Read-only; the caller's farm scope applies to both.
   */
  async dispatchBoard(query: { days?: string | number }, tenantId: string) {
    const days = Math.min(Math.max(Number(query.days) || 7, 1), 31);
    const today = localNow().slice(0, 10);
    const until = fromDate(new Date(asDate(`${today}T00:00:00`).getTime() + days * 86400000)).slice(0, 10);
    const T = schema.logisticsTrip;
    const trips = await this.db
      .select({
        trip_id: T.trip_id, trip_no: T.trip_no, status: T.status, planned_departure: T.planned_departure,
        estimated_arrival: T.estimated_arrival, capacity_pct: T.capacity_pct, estimated_cost: T.estimated_cost,
        vehicle_no: schema.logisticsVehicle.registration_no, driver_name: schema.logisticsDriver.driver_name,
        route_code: schema.logisticsRoute.route_code,
      })
      .from(T)
      .leftJoin(schema.logisticsVehicle, eq(schema.logisticsVehicle.vehicle_id, T.vehicle_id))
      .leftJoin(schema.logisticsDriver, eq(schema.logisticsDriver.driver_id, T.driver_id))
      .leftJoin(schema.logisticsRoute, eq(schema.logisticsRoute.route_id, T.route_id))
      .where(and(
        eq(T.tenant_id, tenantId), isNull(T.deleted_at), ...this.scope(),
        inArray(T.status, ['PLANNED', 'CONFIRMED', 'IN_TRANSIT', 'ARRIVED']),
        or(
          inArray(T.status, ['IN_TRANSIT', 'ARRIVED']),
          sql`${T.planned_departure} < ${`${until} 23:59:59`}`,
        ),
      ))
      .orderBy(asc(T.planned_departure));

    const S = schema.stockTransfer;
    const waiting = await this.db
      .select({
        kind: sql<string>`'STOCK_TRANSFER'`, id: S.transfer_id, document_no: S.transfer_no, posting_date: S.posting_date,
        from_name: sql<string>`(select lm.location_name from location_master lm where lm.location_id = ${S.from_warehouse_id})`,
        to_name: sql<string>`(select lm.location_name from location_master lm where lm.location_id = ${S.to_warehouse_id})`,
      })
      .from(S)
      .where(and(
        eq(S.tenant_id, tenantId), isNull(S.deleted_at), isNull(S.trip_id), eq(S.status, 'DRAFT'),
        ...restrictedScopeConditions(farmScope(this.cls), { companyId: S.company_id }), ...this.transferScope(),
      ))
      .orderBy(asc(S.posting_date), asc(S.transfer_no))
      .limit(200);

    // Livestock batch transfers between farms that have no trip yet (a move inside one farm needs no truck).
    const BT = schema.batchTransfer;
    const farmOf = (batch: SQL) => sql`(select bh.farm_id from batch_header bh where bh.batch_id = ${batch})`;
    const farmName = (batch: SQL) => sql<string>`(select lm.location_name from batch_header bh inner join location_master lm on lm.location_id = bh.farm_id where bh.batch_id = ${batch})`;
    const waitingBatch = await this.db
      .select({
        kind: sql<string>`'BATCH_TRANSFER'`, id: BT.transfer_id, document_no: BT.transfer_no, posting_date: BT.transfer_date,
        from_name: farmName(sql`${BT.from_batch_id}`), to_name: farmName(sql`${BT.to_batch_id}`),
      })
      .from(BT)
      .where(and(
        eq(BT.tenant_id, tenantId), isNull(BT.deleted_at), isNull(BT.trip_id), eq(BT.status, 'DRAFT'),
        sql`${farmOf(sql`${BT.from_batch_id}`)} is not null and ${farmOf(sql`${BT.to_batch_id}`)} is not null and ${farmOf(sql`${BT.from_batch_id}`)} <> ${farmOf(sql`${BT.to_batch_id}`)}`,
        ...restrictedScopeConditions(farmScope(this.cls), { companyId: BT.company_id }), ...this.batchTransferScope(),
      ))
      .orderBy(asc(BT.transfer_date), asc(BT.transfer_no))
      .limit(200);

    const status = (s: string) => trips.filter((t) => t.status === s);
    return {
      from: today, until,
      columns: { PLANNED: status('PLANNED'), CONFIRMED: status('CONFIRMED'), IN_TRANSIT: status('IN_TRANSIT'), ARRIVED: status('ARRIVED') },
      waiting: [...waiting, ...waitingBatch],
    };
  }

  /** The trip with its lines, estimate rows, truck, driver, route, and the estimate split by destination farm. */
  async findOne(id: string, tenantId: string) {
    const trip = await this.loadTrip(id, tenantId);
    const lines = await this.linesOf(id, tenantId);
    const costs = await this.db.select().from(schema.logisticsTripCost)
      .where(and(eq(schema.logisticsTripCost.tenant_id, tenantId), eq(schema.logisticsTripCost.trip_id, id), isNull(schema.logisticsTripCost.deleted_at)));
    const [vehicle] = trip.vehicle_id
      ? await this.db.select({ registration_no: schema.logisticsVehicle.registration_no }).from(schema.logisticsVehicle)
        .where(and(eq(schema.logisticsVehicle.vehicle_id, trip.vehicle_id), eq(schema.logisticsVehicle.tenant_id, tenantId))).limit(1)
      : [];
    const [driver] = trip.driver_id
      ? await this.db.select({ driver_name: schema.logisticsDriver.driver_name }).from(schema.logisticsDriver)
        .where(and(eq(schema.logisticsDriver.driver_id, trip.driver_id), eq(schema.logisticsDriver.tenant_id, tenantId))).limit(1)
      : [];
    const [route] = trip.route_id
      ? await this.db.select({ route_code: schema.logisticsRoute.route_code }).from(schema.logisticsRoute)
        .where(and(eq(schema.logisticsRoute.route_id, trip.route_id), eq(schema.logisticsRoute.tenant_id, tenantId))).limit(1)
      : [];

    const transferIds = [...new Set(lines.map((l) => l.transfer_id).filter(Boolean))];
    const batchIds = [...new Set(lines.map((l) => l.batch_transfer_id).filter(Boolean))];
    const batchTransfers = batchIds.length
      ? await this.db.select({
        transfer_id: schema.batchTransfer.transfer_id, transfer_no: schema.batchTransfer.transfer_no, to_batch_id: schema.batchTransfer.to_batch_id,
      }).from(schema.batchTransfer).where(and(eq(schema.batchTransfer.tenant_id, tenantId), inArray(schema.batchTransfer.transfer_id, batchIds)))
      : [];
    const transfers = transferIds.length
      ? await this.db.select({ transfer_id: schema.stockTransfer.transfer_id, transfer_no: schema.stockTransfer.transfer_no, to_warehouse_id: schema.stockTransfer.to_warehouse_id })
        .from(schema.stockTransfer).where(and(eq(schema.stockTransfer.tenant_id, tenantId), inArray(schema.stockTransfer.transfer_id, transferIds)))
      : [];
    const farmOf = new Map<string, string | null>();
    for (const t of transfers) farmOf.set(t.transfer_id, await farmOfLocation(this.db, t.to_warehouse_id));
    for (const b of batchTransfers) {
      const [dest] = await this.db.select({ farm_id: schema.batchHeader.farm_id }).from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, b.to_batch_id), eq(schema.batchHeader.tenant_id, tenantId))).limit(1);
      farmOf.set(b.transfer_id, dest?.farm_id ?? null);
    }
    const farmIds = [...new Set([...farmOf.values()].filter((f): f is string => !!f))];
    const farms = farmIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_name: schema.locationMaster.location_name })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, farmIds))
      : [];
    const byFarm = new Map<string, Row>();
    for (const l of lines) {
      const farmId = farmOf.get(l.transfer_id ?? l.batch_transfer_id) ?? null;
      const key = farmId ?? '';
      const f = byFarm.get(key) ?? {
        farm_id: farmId, farm_name: farms.find((x) => x.location_id === farmId)?.location_name ?? null,
        weight_kg: 0, share_pct: 0, estimated_cost_share: trip.estimated_cost === null ? null : 0,
      };
      f.weight_kg += Number(l.weight_kg ?? 0);
      f.share_pct += Number(l.share_pct ?? 0);
      if (f.estimated_cost_share !== null) f.estimated_cost_share += Number(l.estimated_cost_share ?? 0);
      byFarm.set(key, f);
    }
    const farm_shares = [...byFarm.values()].map((f) => ({
      ...f, weight_kg: dec(f.weight_kg), share_pct: dec(f.share_pct), estimated_cost_share: dec(f.estimated_cost_share),
    }));

    return {
      ...trip,
      vehicle_no: vehicle?.registration_no ?? null,
      driver_name: driver?.driver_name ?? null,
      route_code: route?.route_code ?? null,
      lines: lines.map((l) => ({
        ...l,
        transfer_no: (l.transfer_id
          ? transfers.find((t) => t.transfer_id === l.transfer_id)
          : batchTransfers.find((b) => b.transfer_id === l.batch_transfer_id))?.transfer_no ?? null,
      })),
      costs,
      farm_shares,
    };
  }

  private linesOf(tripId: string, tenantId: string): Promise<Row[]> {
    return this.db.select().from(schema.logisticsTripLine)
      .where(and(eq(schema.logisticsTripLine.tenant_id, tenantId), eq(schema.logisticsTripLine.trip_id, tripId), isNull(schema.logisticsTripLine.deleted_at)))
      .orderBy(asc(schema.logisticsTripLine.created_at));
  }

  // ── Plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Row-locked like generateTransferNo in stock-transfer.service.ts: called inside the transaction that inserts. */
  private async generateTripNo(tenantId: string, companyId: string): Promise<string> {
    const [row] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.logisticsTrip.trip_no}, 5) AS UNSIGNED)), 0)` })
      .from(schema.logisticsTrip)
      .where(and(eq(schema.logisticsTrip.tenant_id, tenantId), eq(schema.logisticsTrip.company_id, companyId)))
      .for('update');
    return `TRP-${String(Number(row?.maxSeq || 0) + 1).padStart(6, '0')}`;
  }

  /** A Transfer Order may be on one open trip only. */
  private async assertNotOnOpenTrip(transfers: Row[], tenantId: string) {
    const tripIds = [...new Set(transfers.map((t) => t.trip_id).filter(Boolean))] as string[];
    if (!tripIds.length) return;
    const trips = await this.db.select({ trip_id: schema.logisticsTrip.trip_id, trip_no: schema.logisticsTrip.trip_no, status: schema.logisticsTrip.status })
      .from(schema.logisticsTrip)
      .where(and(eq(schema.logisticsTrip.tenant_id, tenantId), inArray(schema.logisticsTrip.trip_id, tripIds), isNull(schema.logisticsTrip.deleted_at)));
    for (const t of transfers) {
      const open = trips.find((x) => x.trip_id === t.trip_id && !TERMINAL.includes(x.status as TripStatus));
      if (open) throw new BadRequestException(`Transfer Order ${t.transfer_no} is already on trip ${open.trip_no}.`);
    }
  }

  /**
   * Every TO line in the three measures: KG through the UOM conversions (the stock-transfer silo check's own), HEAD
   * when counted in HEAD, bags when counted in BAG or else KG ÷ the destination farm's bag size (Feed Planning
   * Settings, farm row before company row). A measure that cannot be worked out is null, never guessed.
   */
  private async measure(transfers: Row[], companyId: string, tenantId: string) {
    const ids = transfers.map((t) => t.transfer_id);
    const lines = await this.db.select().from(schema.stockTransferLine)
      .where(inArray(schema.stockTransferLine.transfer_id, ids))
      .orderBy(asc(schema.stockTransferLine.transfer_id), asc(schema.stockTransferLine.line_no));
    const settings = await this.db
      .select({ farm_id: schema.feedPlanningSetting.farm_id, bag_size_kg: schema.feedPlanningSetting.bag_size_kg })
      .from(schema.feedPlanningSetting)
      .where(and(eq(schema.feedPlanningSetting.tenant_id, tenantId), eq(schema.feedPlanningSetting.company_id, companyId), eq(schema.feedPlanningSetting.is_active, true)));
    const companyBag = settings.find((s) => s.farm_id === null)?.bag_size_kg ?? null;
    const farmOf = new Map<string, string | null>();
    for (const t of transfers) farmOf.set(t.transfer_id, await farmOfLocation(this.db, t.to_warehouse_id));

    const out: Row[] = [];
    for (const l of lines) {
      const qty = Number(l.quantity);
      const uom = String(l.uom ?? '').toUpperCase().trim();
      const kg = await quantityInKilograms(this.uomService, qty, uom, l.item_id, companyId, tenantId).catch(() => null);
      const farmId = farmOf.get(l.transfer_id) ?? null;
      const bagSize = num(settings.find((s) => farmId && s.farm_id === farmId)?.bag_size_kg ?? companyBag);
      const bags = uom === 'BAG' ? Math.round(qty) : kg !== null && bagSize && bagSize > 0 ? Math.round(kg / bagSize) : null;
      out.push({
        transfer_id: l.transfer_id,
        transfer_line_id: l.line_id,
        weight_kg: kg === null || !Number.isFinite(kg) ? null : Math.round(kg * 100) / 100,
        head_count: uom === 'HEAD' ? Math.round(qty) : null,
        bag_count: bags,
      });
    }
    return out;
  }

  /** The trip's load in its own measure; null (with the reason) when a line cannot be measured. */
  private load(lines: Row[], unit: string): { value: number | null; note: string | null } {
    const field = LINE_MEASURE[unit];
    if (!lines.length) return { value: 0, note: null };
    if (lines.some((l) => l[field] === null || l[field] === undefined)) return { value: null, note: UNMEASURED[unit] };
    return { value: lines.reduce((a, l) => a + Number(l[field]), 0), note: null };
  }

  async plan(dto: PlanTripInput, tenantId: string, user?: any) {
    const ids = [...new Set((Array.isArray(dto?.transfer_ids) ? dto.transfer_ids : []).filter((x) => typeof x === 'string' && x.trim()))];
    const departure = naive(dto?.planned_departure);
    const problems: string[] = [];
    if (!ids.length) problems.push('Choose at least one Transfer Order.');
    if (!(VEHICLE_TYPES as readonly string[]).includes(String(dto?.vehicle_type ?? ''))) problems.push(`Vehicle Type must be one of ${VEHICLE_TYPES.join(', ')}.`);
    if (!departure) problems.push('Planned departure must be a local date and time (YYYY-MM-DDTHH:mm).');
    if (!dto?.route_id) problems.push('Route is required.');
    if (problems.length) throw new BadRequestException(problems.join(' '));
    const unit = LOAD_UNIT[dto.vehicle_type as VehicleType];

    return withTenantTransaction(this.cls, async () => {
      const transfers = await this.db.select().from(schema.stockTransfer)
        .where(and(
          eq(schema.stockTransfer.tenant_id, tenantId), inArray(schema.stockTransfer.transfer_id, ids), isNull(schema.stockTransfer.deleted_at),
          ...restrictedScopeConditions(farmScope(this.cls), { companyId: schema.stockTransfer.company_id }), ...this.transferScope(),
        ))
        // Locked so two planners cannot put one TO on two trips at once.
        .for('update');
      // Out of the caller's scope reads as not found, as StockTransferService answers it.
      const missing = ids.find((id) => !transfers.some((t) => t.transfer_id === id));
      if (missing) throw new NotFoundException(`Transfer Order with ID '${missing}' not found.`);
      // Ruling (12 Nov): only a TO not yet shipped, received or cancelled goes on a trip.
      const notDraft = transfers.find((t) => t.status !== 'DRAFT');
      if (notDraft) throw new BadRequestException(`This transfer order is ${notDraft.status} and cannot be planned onto a trip.`);
      if (new Set(transfers.map((t) => t.company_id)).size > 1)
        throw new BadRequestException('Transfer Orders of different companies cannot share a trip.');
      const companyId = transfers[0].company_id;
      assertCompanyInScope(farmScope(this.cls), companyId);
      await this.assertNotOnOpenTrip(transfers, tenantId);

      const route = await this.routeOf(dto.route_id, companyId, tenantId);
      const carrierId = dto.carrier_supplier_id ? String(dto.carrier_supplier_id).trim() || null : null;
      if (carrierId) await this.assertCarrier(carrierId, companyId, tenantId);
      const lines = await this.measure(transfers, companyId, tenantId);
      const load = this.load(lines, unit);
      const arrival = fromDate(estimateArrival(asDate(departure!), route));
      const est = carrierId
        ? await this.estimate(route, departure!, lines, carrierId, companyId, tenantId)
        : { cost: null, note: ASSIGN_FIRST, shares: lines.map(() => null) };
      const pct = this.sharePct(lines);

      const tripId = randomUUID();
      const tripNo = await this.generateTripNo(tenantId, companyId);
      await this.db.insert(schema.logisticsTrip).values({
        trip_id: tripId, tenant_id: tenantId, company_id: companyId, trip_no: tripNo, route_id: route.route_id,
        carrier_supplier_id: carrierId, status: 'DRAFT', planned_departure: toDb(departure!), estimated_arrival: toDb(arrival),
        load_value: dec(load.value), load_unit: unit, estimated_cost: dec(est.cost), estimate_note: notes(load.note, this.weightNote(lines), est.note),
        created_by: user?.userId, updated_by: user?.userId,
      } as never);
      if (lines.length)
        await this.db.insert(schema.logisticsTripLine).values(lines.map((l, i) => ({
          trip_line_id: randomUUID(), tenant_id: tenantId, company_id: companyId, trip_id: tripId,
          transfer_id: l.transfer_id, transfer_line_id: l.transfer_line_id, weight_kg: dec(l.weight_kg),
          head_count: l.head_count, bag_count: l.bag_count, share_pct: dec(pct[i]), estimated_cost_share: dec(est.shares[i]),
          created_by: user?.userId, updated_by: user?.userId,
        })) as never);
      if (est.cost !== null) await this.writeEstimateCost(tripId, companyId, tenantId, est.cost, user);
      await this.db.update(schema.stockTransfer).set({ trip_id: tripId } as never)
        .where(and(eq(schema.stockTransfer.tenant_id, tenantId), inArray(schema.stockTransfer.transfer_id, ids)));

      const created = await this.findOne(tripId, tenantId);
      await this.log('CREATE', created, user, undefined, { transfer_ids: ids });
      return created;
    });
  }

  /**
   * Whether a livestock batch transfer moves head between two farms. Only that needs a truck: a move inside one farm
   * (or between batches with no farm) never does. Takes the two batches' farms as batchTransferFarms reads them.
   */
  isCrossFarm(farms: { from: string | null; to: string | null }): boolean {
    return !!farms.from && !!farms.to && farms.from !== farms.to;
  }

  /** The farms of a batch transfer's two batches. */
  async batchTransferFarms(fromBatchId: string, toBatchId: string, tenantId: string): Promise<{ from: string | null; to: string | null }> {
    const B = schema.batchHeader;
    const rows = await this.db.select({ batch_id: B.batch_id, farm_id: B.farm_id }).from(B)
      .where(and(eq(B.tenant_id, tenantId), inArray(B.batch_id, [fromBatchId, toBatchId])));
    return {
      from: rows.find((r) => r.batch_id === fromBatchId)?.farm_id ?? null,
      to: rows.find((r) => r.batch_id === toBatchId)?.farm_id ?? null,
    };
  }

  /** Phase 3: plan a trip for one DRAFT cross-farm livestock batch transfer. Always a LIVESTOCK truck, loaded in head. */
  async planBatchTransfer(dto: PlanBatchTripInput, tenantId: string, user?: any) {
    const departure = naive(dto?.planned_departure);
    const problems: string[] = [];
    if (!dto?.batch_transfer_id || typeof dto.batch_transfer_id !== 'string') problems.push('Choose a batch transfer.');
    if (!departure) problems.push('Planned departure must be a local date and time (YYYY-MM-DDTHH:mm).');
    if (!dto?.route_id) problems.push('Route is required.');
    if (problems.length) throw new BadRequestException(problems.join(' '));

    return withTenantTransaction(this.cls, async () => {
      const BT = schema.batchTransfer;
      const [transfer] = await this.db.select().from(BT)
        .where(and(
          eq(BT.tenant_id, tenantId), eq(BT.transfer_id, dto.batch_transfer_id), isNull(BT.deleted_at),
          ...restrictedScopeConditions(farmScope(this.cls), { companyId: BT.company_id }), ...this.batchTransferScope(),
        ))
        // Locked so two planners cannot put one transfer on two trips at once.
        .for('update');
      if (!transfer) throw new NotFoundException(`Batch transfer with ID '${dto.batch_transfer_id}' not found.`);
      assertCompanyInScope(farmScope(this.cls), transfer.company_id);
      if (transfer.status !== 'DRAFT')
        throw new BadRequestException(`This batch transfer is ${transfer.status} and cannot be planned onto a trip.`);
      const farms = await this.batchTransferFarms(transfer.from_batch_id, transfer.to_batch_id, tenantId);
      if (!this.isCrossFarm(farms)) throw new BadRequestException('This batch transfer stays on one farm and needs no truck.');
      const head = Math.round(Number(transfer.head_count));
      if (!(head > 0)) throw new BadRequestException('This batch transfer moves no head, so there is nothing to put on a truck.');
      await this.assertNotOnOpenTrip([{ ...transfer, transfer_no: transfer.transfer_no }], tenantId);

      const companyId = transfer.company_id;
      const route = await this.routeOf(dto.route_id, companyId, tenantId);
      const carrierId = dto.carrier_supplier_id ? String(dto.carrier_supplier_id).trim() || null : null;
      if (carrierId) await this.assertCarrier(carrierId, companyId, tenantId);
      const lines: Row[] = [{ batch_transfer_id: transfer.transfer_id, weight_kg: null, head_count: head, bag_count: null }];
      const load = this.load(lines, 'HEAD');
      const arrival = fromDate(estimateArrival(asDate(departure!), route));
      const est = carrierId
        ? await this.estimate(route, departure!, lines, carrierId, companyId, tenantId)
        : { cost: null, note: ASSIGN_FIRST, shares: lines.map(() => null) };
      const pct = this.sharePct(lines);

      const tripId = randomUUID();
      const tripNo = await this.generateTripNo(tenantId, companyId);
      await this.db.insert(schema.logisticsTrip).values({
        trip_id: tripId, tenant_id: tenantId, company_id: companyId, trip_no: tripNo, route_id: route.route_id,
        carrier_supplier_id: carrierId, status: 'DRAFT', planned_departure: toDb(departure!), estimated_arrival: toDb(arrival),
        load_value: dec(load.value), load_unit: 'HEAD', estimated_cost: dec(est.cost), estimate_note: notes(load.note, this.weightNote(lines), est.note),
        created_by: user?.userId, updated_by: user?.userId,
      } as never);
      await this.db.insert(schema.logisticsTripLine).values({
        trip_line_id: randomUUID(), tenant_id: tenantId, company_id: companyId, trip_id: tripId,
        transfer_id: null, batch_transfer_id: transfer.transfer_id, weight_kg: null, head_count: head, bag_count: null,
        share_pct: dec(pct[0]), estimated_cost_share: dec(est.shares[0]), created_by: user?.userId, updated_by: user?.userId,
      } as never);
      if (est.cost !== null) await this.writeEstimateCost(tripId, companyId, tenantId, est.cost, user);
      await this.db.update(BT).set({ trip_id: tripId } as never).where(and(eq(BT.tenant_id, tenantId), eq(BT.transfer_id, transfer.transfer_id)));

      const created = await this.findOne(tripId, tenantId);
      await this.log('CREATE', created, user, undefined, { batch_transfer_id: transfer.transfer_id });
      return created;
    });
  }

  /**
   * The carrier a trip is priced on. A hired truck: its own carrier. Otherwise the carrier given with this assign;
   * failing that, the carrier the trip already holds — but only while that is still the planner's, i.e. the trip has
   * never had a hired truck put on it since (a hired truck's carrier is written over it, and an own truck must never
   * be priced on the carrier of the truck it replaced). No column remembers the planner's carrier separately, so once a
   * hired truck has been on the trip, an own truck needs the carrier in the assign body or is not estimated.
   */
  private async carrierFor(vehicle: Row, trip: Row, given: string | null | undefined, tenantId: string): Promise<string | null> {
    if (vehicle.ownership === 'HIRED') return vehicle.carrier_supplier_id ?? null;
    const carrier = given ? String(given).trim() || null : null;
    if (carrier) {
      await this.assertCarrier(carrier, trip.company_id, tenantId);
      return carrier;
    }
    if (!trip.carrier_supplier_id) return null;
    if (!trip.vehicle_id) return trip.carrier_supplier_id;
    const [previous] = await this.db.select({ ownership: schema.logisticsVehicle.ownership }).from(schema.logisticsVehicle)
      .where(and(eq(schema.logisticsVehicle.vehicle_id, trip.vehicle_id), eq(schema.logisticsVehicle.tenant_id, tenantId))).limit(1);
    return previous?.ownership === 'HIRED' ? null : trip.carrier_supplier_id;
  }

  private async assertCarrier(carrierId: string, companyId: string, tenantId: string) {
    const [found] = await this.db.select({ id: schema.supplierMaster.supplier_id }).from(schema.supplierMaster)
      .where(and(
        eq(schema.supplierMaster.supplier_id, carrierId), eq(schema.supplierMaster.tenant_id, tenantId),
        isNull(schema.supplierMaster.deleted_at), companyCondition(schema.supplierMaster.company_id, companyId),
      ))
      .limit(1);
    if (!found) throw new BadRequestException('Carrier is not available in this company.');
  }

  // ── Estimate ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Said when shares fall back to an equal split because no line weighs anything. */
  private weightNote(lines: Row[]): string | null {
    return lines.length && lines.every((l) => !(Number(l.weight_kg ?? 0) > 0)) ? NO_WEIGHT : null;
  }

  /** Each line's share of the trip, by weight (equal when nothing is weighed), cents-exact to 100. */
  private sharePct(lines: Row[]): number[] {
    return shareByWeight(100, lines.map((l) => Number(l.weight_kg ?? 0)));
  }

  /** The freight estimate from the carrier's approved rate; null with the reason when there is none — never 0. */
  private async estimate(route: RouteRow, departure: string, lines: Row[], carrierId: string | null, companyId: string, tenantId: string) {
    const none = (note: string) => ({ cost: null as number | null, note, shares: lines.map(() => null as number | null) });
    if (!carrierId) return none(NO_RATE);
    const rates = await this.db.select().from(schema.logisticsFreightRate)
      .where(and(
        eq(schema.logisticsFreightRate.tenant_id, tenantId), companyCondition(schema.logisticsFreightRate.company_id, companyId),
        eq(schema.logisticsFreightRate.carrier_supplier_id, carrierId), eq(schema.logisticsFreightRate.is_active, true),
        isNull(schema.logisticsFreightRate.deleted_at),
      ));
    const rate = pickRate(
      rates.map((r) => ({ ...r, valid_from: day(r.valid_from), valid_to: r.valid_to ? day(r.valid_to) : null }) as RateRow),
      { carrierId, routeId: route.route_id, on: day(departure) },
    );
    if (!rate) return none(NO_RATE);
    const kg = lines.reduce((a, l) => a + Number(l.weight_kg ?? 0), 0);
    const head = lines.reduce((a, l) => a + Number(l.head_count ?? 0), 0);
    const cost = baseFreight(
      rate,
      { distance_km: route.distance_km, return_leg_charged: Boolean(route.return_leg_charged), tolls: route.tolls },
      { tonnes: kg / 1000, head },
    );
    return { cost, note: null, shares: shareByWeight(cost, lines.map((l) => Number(l.weight_kg ?? 0))) as (number | null)[] };
  }

  private async writeEstimateCost(tripId: string, companyId: string, tenantId: string, amount: number, user?: any) {
    await this.db.insert(schema.logisticsTripCost).values({
      cost_id: randomUUID(), tenant_id: tenantId, company_id: companyId, trip_id: tripId, cost_type: 'FREIGHT',
      amount: dec(amount), is_estimate: true, remarks: 'Freight estimate from the approved rate.',
      created_by: user?.userId, updated_by: user?.userId,
    } as never);
  }

  // ── Find vehicle / assign ─────────────────────────────────────────────────────────────────────────────────────────

  /** The trip's time window: departure to arrival plus the drive back empty (Ruling, 12 Nov). */
  private windowEnd(trip: Row, route: RouteRow | undefined): string | null {
    const departure = fromDb(trip.planned_departure);
    if (!departure) return null;
    const arrival = fromDb(trip.estimated_arrival) ?? (route ? fromDate(estimateArrival(asDate(departure), route)) : departure);
    const speed = Number(route?.speed_kmh ?? 0);
    const back = speed > 0 ? (Number(route?.distance_km ?? 0) / speed) * 60 : 0;
    return addMinutes(arrival, back);
  }

  private async context(trip: Row, route: RouteRow, tenantId: string) {
    const type = TYPE_OF_UNIT[String(trip.load_unit)];
    const departure = fromDb(trip.planned_departure);
    const end = this.windowEnd(trip, route);
    if (!type || !departure || !end) throw new BadRequestException('This trip has no load type or departure time.');
    const [setting] = await this.db.select({ pct: schema.logisticsSetting.capacity_warning_pct }).from(schema.logisticsSetting)
      .where(and(
        eq(schema.logisticsSetting.tenant_id, tenantId), companyCondition(schema.logisticsSetting.company_id, trip.company_id),
        isNull(schema.logisticsSetting.deleted_at),
      ))
      .limit(1);
    return {
      // returnAt (exact) bounds the busy check; returnDate (the day) is for document and licence expiry only.
      type, departure, returnDate: day(end), returnAt: end, warnPct: num(setting?.pct) ?? 95,
      load: trip.load_value === null || trip.load_value === undefined ? null : Number(trip.load_value),
    };
  }

  /** Every other live trip of these trucks or drivers, as the windows they are busy in. */
  private async busy(column: 'vehicle_id' | 'driver_id', ids: string[], trip: Row, tenantId: string): Promise<Map<string, Interval[]>> {
    const out = new Map<string, Interval[]>();
    if (!ids.length) return out;
    const T = schema.logisticsTrip;
    const others = (await this.db.select().from(T).where(and(
      eq(T.tenant_id, tenantId), inArray(T[column], ids), ne(T.trip_id, trip.trip_id), notInArray(T.status, TERMINAL), isNull(T.deleted_at),
    ))).filter((o) => o.trip_id !== trip.trip_id && !TERMINAL.includes(o.status as TripStatus) && o[column] && ids.includes(o[column] as string));
    const routeIds = [...new Set(others.map((o) => o.route_id).filter(Boolean))] as string[];
    const routes = routeIds.length
      ? await this.db.select().from(schema.logisticsRoute).where(and(eq(schema.logisticsRoute.tenant_id, tenantId), inArray(schema.logisticsRoute.route_id, routeIds)))
      : [];
    for (const o of others) {
      const start = fromDb(o.planned_departure);
      const end = this.windowEnd(o, routes.find((r) => r.route_id === o.route_id));
      if (!start || !end) continue;
      const key = o[column] as string;
      out.set(key, [...(out.get(key) ?? []), { trip_no: o.trip_no, start, end }]);
    }
    return out;
  }

  private async documentsOf(vehicleIds: string[], tenantId: string): Promise<Row[]> {
    if (!vehicleIds.length) return [];
    const D = schema.logisticsVehicleDocument;
    return this.db.select().from(D)
      .where(and(eq(D.tenant_id, tenantId), inArray(D.vehicle_id, vehicleIds), eq(D.is_active, true), isNull(D.deleted_at)));
  }

  /**
   * Why this truck cannot take the trip. Capacity is checked here with capacityCheck (so the refusal says "over the
   * limit", and a trip whose load cannot be measured is not refused for it); trip-eligibility checks everything else.
   */
  private vehicleReasons(v: Row, docs: Row[], ctx: Awaited<ReturnType<LogisticsTripService['context']>>, busy: Interval[]): string[] {
    const facts: VehicleFacts = {
      registration_no: v.registration_no, status: v.status, is_active: Boolean(v.is_active), vehicle_type: v.vehicle_type,
      capacity_kg: num(v.capacity_kg), capacity_head: num(v.capacity_head), capacity_bags: num(v.capacity_bags),
      documents: docs.filter((d) => d.vehicle_id === v.vehicle_id).map((d) => ({ document_type: d.document_type, expiry_date: day(d.expiry_date) })),
    };
    const reasons = vehicleExclusions(facts, { type: ctx.type, load: 0, departure: ctx.departure, returnDate: ctx.returnDate, returnAt: ctx.returnAt, warnPct: ctx.warnPct }, busy);
    if (v.vehicle_type === ctx.type && ctx.load !== null) {
      const check = capacityCheck(ctx.load, this.capacityOf(v, ctx.type), ctx.warnPct);
      if (check.level === 'BLOCK' && check.message && !reasons.includes(check.message)) reasons.push(check.message);
    }
    return reasons;
  }

  private capacityOf(v: Row, type: VehicleType): number {
    return Number(v[CAPACITY_BY_VEHICLE_TYPE[type].field] ?? 0);
  }

  private driverReasons(d: Row, ctx: { departure: string; returnDate: string; returnAt: string }, busy: Interval[]): string[] {
    const facts: DriverFacts = {
      driver_name: d.driver_name, is_active: Boolean(d.is_active), licence_class: d.licence_class ?? null,
      licence_expiry: d.licence_expiry ? day(d.licence_expiry) : null,
    };
    return driverExclusions(facts, { departure: ctx.departure, returnDate: ctx.returnDate, returnAt: ctx.returnAt }, busy);
  }

  async findVehicle(id: string, tenantId: string) {
    const trip = await this.loadTrip(id, tenantId);
    const route = await this.routeOf(trip.route_id, trip.company_id, tenantId);
    const ctx = await this.context(trip, route, tenantId);
    const V = schema.logisticsVehicle;
    const vehicles = await this.db.select().from(V)
      .where(and(eq(V.tenant_id, tenantId), companyCondition(V.company_id, trip.company_id), isNull(V.deleted_at)))
      .orderBy(asc(V.registration_no));
    const docs = await this.documentsOf(vehicles.map((v) => v.vehicle_id), tenantId);
    const busyV = await this.busy('vehicle_id', vehicles.map((v) => v.vehicle_id), trip, tenantId);
    const DR = schema.logisticsDriver;
    const drivers = await this.db.select().from(DR)
      .where(and(eq(DR.tenant_id, tenantId), companyCondition(DR.company_id, trip.company_id), isNull(DR.deleted_at)))
      .orderBy(asc(DR.driver_name));
    const busyD = await this.busy('driver_id', drivers.map((d) => d.driver_id), trip, tenantId);

    const split = <T extends Row>(rows: T[], reasonsOf: (r: T) => string[], key: 'vehicle' | 'driver') => {
      const eligible: T[] = [];
      const excluded: Row[] = [];
      for (const r of rows) {
        const reasons = reasonsOf(r);
        if (reasons.length) excluded.push({ [key]: r, reasons });
        else eligible.push(r);
      }
      return { eligible, excluded };
    };
    const v = split(vehicles, (r) => this.vehicleReasons(r, docs, ctx, busyV.get(r.vehicle_id) ?? []), 'vehicle');
    const d = split(drivers, (r) => this.driverReasons(r, ctx, busyD.get(r.driver_id) ?? []), 'driver');
    return { eligible: v.eligible, excluded: v.excluded, drivers: d };
  }

  async assign(id: string, dto: AssignTripInput, tenantId: string, user?: any) {
    if (!dto?.vehicle_id || !dto?.driver_id) throw new BadRequestException('Choose a vehicle and a driver.');
    return withTenantTransaction(this.cls, async () => {
      const trip = await this.loadTrip(id, tenantId);
      if (trip.status === 'CLOSED') throw new BadRequestException(LOCKED);
      if (!['DRAFT', 'PLANNED'].includes(trip.status))
        throw new BadRequestException(`A vehicle can be assigned only while the trip is DRAFT or PLANNED; this trip is ${trip.status}.`);
      const route = await this.routeOf(trip.route_id, trip.company_id, tenantId);
      const ctx = await this.context(trip, route, tenantId);

      const V = schema.logisticsVehicle;
      const [vehicle] = await this.db.select().from(V)
        .where(and(eq(V.vehicle_id, dto.vehicle_id), eq(V.tenant_id, tenantId), companyCondition(V.company_id, trip.company_id), isNull(V.deleted_at)))
        .limit(1);
      if (!vehicle) throw new NotFoundException('Vehicle is not available in this company.');
      const DR = schema.logisticsDriver;
      const [driver] = await this.db.select().from(DR)
        .where(and(eq(DR.driver_id, dto.driver_id), eq(DR.tenant_id, tenantId), companyCondition(DR.company_id, trip.company_id), isNull(DR.deleted_at)))
        .limit(1);
      if (!driver) throw new NotFoundException('Driver is not available in this company.');

      const docs = await this.documentsOf([vehicle.vehicle_id], tenantId);
      const busyV = await this.busy('vehicle_id', [vehicle.vehicle_id], trip, tenantId);
      const busyD = await this.busy('driver_id', [driver.driver_id], trip, tenantId);
      const vr = this.vehicleReasons(vehicle, docs, ctx, busyV.get(vehicle.vehicle_id) ?? []);
      const dr = this.driverReasons(driver, ctx, busyD.get(driver.driver_id) ?? []);
      if (vr.length || dr.length)
        throw new BadRequestException(notes(
          vr.length ? `${vehicle.registration_no}: ${vr.join(' ')}` : null,
          dr.length ? `${driver.driver_name}: ${dr.join(' ')}` : null,
        ));

      const check = ctx.load === null ? null : capacityCheck(ctx.load, this.capacityOf(vehicle, ctx.type), ctx.warnPct);
      const carrierId = await this.carrierFor(vehicle, trip, dto.carrier_supplier_id, tenantId);
      const lines = await this.linesOf(id, tenantId);
      const est = await this.estimate(route, ctx.departure, lines, carrierId ?? null, trip.company_id, tenantId);
      const pct = this.sharePct(lines);
      const set = {
        vehicle_id: vehicle.vehicle_id, driver_id: driver.driver_id, status: 'PLANNED', carrier_supplier_id: carrierId ?? null,
        capacity_pct: check ? dec(check.pct) : null, estimated_cost: dec(est.cost),
        estimate_note: notes(
          check?.level === 'WARN' ? check.message : null, ctx.load === null ? UNMEASURED[trip.load_unit] : null, this.weightNote(lines), est.note,
        ),
        updated_by: user?.userId, updated_at: nowTs(),
      };
      // Guarded: a shipment that committed meanwhile has moved the trip on, and must not be set back to PLANNED.
      const T = schema.logisticsTrip;
      const [res] = await this.db.update(T).set(set as never)
        .where(and(eq(T.trip_id, id), inArray(T.status, ['DRAFT', 'PLANNED'])));
      if ((res as { affectedRows?: number } | undefined)?.affectedRows === 0)
        throw new BadRequestException('This trip has moved on since it was opened; it can no longer be assigned.');
      for (const [i, l] of lines.entries())
        await this.db.update(schema.logisticsTripLine)
          .set({ share_pct: dec(pct[i]), estimated_cost_share: dec(est.shares[i]), updated_by: user?.userId, updated_at: nowTs() } as never)
          .where(eq(schema.logisticsTripLine.trip_line_id, l.trip_line_id));
      // The estimate is recomputed on every assign: the one before it is retired, never left beside it.
      await this.db.update(schema.logisticsTripCost).set({ deleted_at: nowTs(), updated_by: user?.userId, updated_at: nowTs() } as never)
        .where(and(
          eq(schema.logisticsTripCost.tenant_id, tenantId), eq(schema.logisticsTripCost.trip_id, id), eq(schema.logisticsTripCost.cost_type, 'FREIGHT'),
          eq(schema.logisticsTripCost.is_estimate, true), isNull(schema.logisticsTripCost.deleted_at),
        ));
      if (est.cost !== null) await this.writeEstimateCost(id, trip.company_id, tenantId, est.cost, user);

      await this.log('ASSIGN', { ...trip, ...set }, user, trip);
      return this.findOne(id, tenantId);
    });
  }

  // ── Status moves ──────────────────────────────────────────────────────────────────────────────────────────────────

  private async toColcom(trip: Row, tenantId: string): Promise<boolean> {
    if (!trip.route_id) return false;
    const [route] = await this.db.select({ to_zone_id: schema.logisticsRoute.to_zone_id }).from(schema.logisticsRoute)
      .where(and(eq(schema.logisticsRoute.route_id, trip.route_id), eq(schema.logisticsRoute.tenant_id, tenantId))).limit(1);
    if (!route?.to_zone_id) return false;
    const [zone] = await this.db.select({ zone_type: schema.logisticsDeliveryZone.zone_type }).from(schema.logisticsDeliveryZone)
      .where(and(eq(schema.logisticsDeliveryZone.zone_id, route.to_zone_id), eq(schema.logisticsDeliveryZone.tenant_id, tenantId))).limit(1);
    return zone?.zone_type === 'COLCOM';
  }

  /** Writes one status step. Callers have already decided the step is allowed. */
  private async applyMove(
    trip: Row, to: TripStatus, opts: { at?: string | null; hq?: string; reason?: string; onlyFrom?: TripStatus }, user?: any,
  ): Promise<Row> {
    const set: Row = { status: to, updated_by: user?.userId, updated_at: nowTs() };
    if (to === 'CONFIRMED') {
      const given = String(opts.hq ?? '').trim();
      // Slaughter rule: a trip to Colcom goes only with HQ's approval reference.
      if (!given && !String(trip.hq_approval_ref ?? '').trim() && (await this.toColcom(trip, trip.tenant_id)))
        throw new BadRequestException('A trip to Colcom needs the HQ approval reference before it is confirmed.');
      if (given) set.hq_approval_ref = given.slice(0, 100);
    }
    const stamp = STAMP[to];
    if (stamp) set[stamp] = opts.at ? toDb(opts.at) : localNow();
    if (to === 'CLOSED') set.closed_at = localNow();
    const T = schema.logisticsTrip;
    const [res] = await this.db.update(T).set(set as never)
      .where(opts.onlyFrom ? and(eq(T.trip_id, trip.trip_id), eq(T.status, opts.onlyFrom)) : eq(T.trip_id, trip.trip_id));
    // A guarded move that found the trip already moved on changes nothing, and logs nothing.
    if (opts.onlyFrom && (res as { affectedRows?: number } | undefined)?.affectedRows === 0) return trip;
    const after = { ...trip, ...set };
    await this.log('STATUS_CHANGE', after, user, trip, opts.reason ? { reason: opts.reason } : undefined);
    return after;
  }

  async move(id: string, dto: MoveTripInput, tenantId: string, user?: any) {
    const to = String(dto?.to ?? '') as TripStatus;
    if (!TRIP_STATUSES.includes(to)) throw new BadRequestException(`Status must be one of ${TRIP_STATUSES.join(', ')}.`);
    if (to === 'CANCELLED') return this.cancel(id, { reason: dto.reason ?? '' }, tenantId, user);
    const at = dto.at ? naive(dto.at) : null;
    if (dto.at && !at) throw new BadRequestException('The time must be a local date and time (YYYY-MM-DDTHH:mm).');
    return withTenantTransaction(this.cls, async () => {
      const trip = await this.loadTrip(id, tenantId);
      const refused = canMove(trip.status as TripStatus, to);
      if (refused) throw new BadRequestException(refused);
      if (DELIVERED.includes(to)) await this.assertAllShipped(trip, tenantId);
      await this.applyMove(trip, to, { at, hq: dto.hq_approval_ref, reason: dto.reason }, user);
      return this.findOne(id, tenantId);
    });
  }

  /**
   * A trip marked arrived by hand while one of its TOs never shipped would strand that TO: it could no longer ship on
   * the trip, the trip could not be cancelled, and the TO could not be planned again.
   */
  private async assertAllShipped(trip: Row, tenantId: string) {
    const S = schema.stockTransfer;
    const onTrip = (await this.db.select({ transfer_id: S.transfer_id, transfer_no: S.transfer_no, status: S.status, trip_id: S.trip_id }).from(S)
      .where(and(eq(S.tenant_id, tenantId), eq(S.trip_id, trip.trip_id), isNull(S.deleted_at))))
      .filter((t) => t.trip_id === trip.trip_id);
    const unshipped = onTrip.find((t) => t.status === 'DRAFT');
    if (unshipped)
      throw new BadRequestException(
        `Transfer order ${unshipped.transfer_no} has not shipped yet; ship it or cancel the trip before marking it arrived.`,
      );
    const BT = schema.batchTransfer;
    const unposted = (await this.db.select({ transfer_no: BT.transfer_no, status: BT.status, trip_id: BT.trip_id }).from(BT)
      .where(and(eq(BT.tenant_id, tenantId), eq(BT.trip_id, trip.trip_id), isNull(BT.deleted_at))))
      .find((t) => t.trip_id === trip.trip_id && t.status === 'DRAFT');
    if (unposted)
      throw new BadRequestException(
        `Batch transfer ${unposted.transfer_no} has not been posted yet; post it or cancel the trip before marking it arrived.`,
      );
  }

  async cancel(id: string, dto: { reason?: string }, tenantId: string, user?: any) {
    return withTenantTransaction(this.cls, async () => {
      const trip = await this.loadTrip(id, tenantId);
      const refused = canMove(trip.status as TripStatus, 'CANCELLED');
      if (refused) throw new BadRequestException(refused);
      const reason = String(dto?.reason ?? '').trim();
      if (!reason) throw new BadRequestException('A reason is required to cancel a trip.');
      const set = { status: 'CANCELLED', cancel_reason: reason.slice(0, 500), updated_by: user?.userId, updated_at: nowTs() };
      // Guarded like assign: a trip that has left meanwhile is not cancelled, and its TOs stay on it.
      const T = schema.logisticsTrip;
      const [res] = await this.db.update(T).set(set as never)
        .where(and(eq(T.trip_id, id), inArray(T.status, ['DRAFT', 'PLANNED', 'CONFIRMED'])));
      if ((res as { affectedRows?: number } | undefined)?.affectedRows === 0)
        throw new BadRequestException('This trip has moved on since it was opened; it can no longer be cancelled.');
      // The Transfer Orders are free to go on another trip.
      await this.db.update(schema.stockTransfer).set({ trip_id: null } as never)
        .where(and(eq(schema.stockTransfer.tenant_id, tenantId), eq(schema.stockTransfer.trip_id, id)));
      await this.db.update(schema.batchTransfer).set({ trip_id: null } as never)
        .where(and(eq(schema.batchTransfer.tenant_id, tenantId), eq(schema.batchTransfer.trip_id, id)));
      await this.log('CANCEL', { ...trip, ...set }, user, trip);
      return this.findOne(id, tenantId);
    });
  }

  // ── For the Transfer Order (Task 5) ───────────────────────────────────────────────────────────────────────────────

  private assertLive(trip: Row) {
    if (trip.status === 'CLOSED') throw new BadRequestException(LOCKED);
    if (trip.status === 'CANCELLED') throw new BadRequestException('This trip is cancelled.');
  }

  /**
   * The trip for the Transfer Order's own hooks: by tenant and id only. StockTransferService has already decided the
   * caller may act on the TO (a requisition's shipment deliberately skips the caller's TO scope), so the caller's trip
   * scope must not refuse it here, after the stock has moved. The HTTP-facing methods keep loadTrip's scope.
   */
  private async tripById(id: string, tenantId: string): Promise<Row | null> {
    const T = schema.logisticsTrip;
    const [trip] = await this.db.select().from(T)
      .where(and(eq(T.trip_id, id), eq(T.tenant_id, tenantId), isNull(T.deleted_at))).limit(1);
    return trip ?? null;
  }

  /**
   * The TO has shipped: the trip leaves. Service-internal, so it may take a PLANNED trip through CONFIRMED to
   * IN_TRANSIT in one go (Ruling, 12 Nov) — the Colcom approval rule still applies on the way. A trip already on the
   * road (a second, partial shipment) is left as it is.
   */
  async onShipped(tripId: string, tenantId: string, userPayload?: any): Promise<Row> {
    return withTenantTransaction(this.cls, async () => {
      let trip = await this.tripById(tripId, tenantId);
      if (!trip) throw new NotFoundException('Trip not found.');
      this.assertLive(trip);
      if (trip.status === 'DRAFT') throw new BadRequestException('Assign a vehicle and a driver to this trip before it ships.');
      if (trip.status === 'PLANNED') trip = await this.applyMove(trip, 'CONFIRMED', {}, userPayload);
      if (trip.status === 'CONFIRMED') trip = await this.applyMove(trip, 'IN_TRANSIT', {}, userPayload);
      return trip;
    });
  }

  /**
   * A TO on this trip has been received in full. Best-effort, and never refuses: a receipt must always post (Ruling,
   * 12 Nov, Task 5 review). The trip moves IN_TRANSIT -> ARRIVED only when every live TO on it is received in full —
   * RECEIVED (the two-step receive and close) or POSTED (the event receipts) — so a TO still to ship keeps the trip on
   * the road. In any other state (closed, cancelled, already arrived, not yet left, gone) nothing happens. The update
   * itself is guarded on the trip still being IN_TRANSIT.
   */
  async onArrived(tripId: string, tenantId: string, userPayload?: any): Promise<Row | null> {
    return withTenantTransaction(this.cls, async () => {
      const trip = await this.tripById(tripId, tenantId);
      if (!trip || trip.status !== 'IN_TRANSIT') return trip;
      const S = schema.stockTransfer;
      const transfers = await this.db.select({ trip_id: S.trip_id, status: S.status }).from(S)
        .where(and(eq(S.tenant_id, tenantId), eq(S.trip_id, tripId), isNull(S.deleted_at)));
      if (transfers.some((t) => t.trip_id === tripId && !['RECEIVED', 'POSTED'].includes(String(t.status)))) return trip;
      return this.applyMove(trip, 'ARRIVED', { onlyFrom: 'IN_TRANSIT' }, userPayload);
    });
  }

  /** tenant:company → whether shipping needs a trip, and when it was read. */
  private readonly requiredCache = new Map<string, { value: boolean; at: number }>();

  /**
   * Whether this company ships a Transfer Order only on a trip (logistics_setting.trip_required_to_ship; false when
   * the company has no setting row). Asked on every untripped shipment, so it is held for a minute per tenant and
   * company: a change to the setting takes up to 60 seconds to apply.
   */
  async tripRequiredToShip(companyId: string | null, tenantId: string): Promise<boolean> {
    const key = `${tenantId}:${companyId ?? ''}`;
    const hit = this.requiredCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const S = schema.logisticsSetting;
    const [setting] = await this.db.select({ trip_required_to_ship: S.trip_required_to_ship }).from(S)
      .where(and(eq(S.tenant_id, tenantId), companyCondition(S.company_id, companyId), isNull(S.deleted_at)))
      .limit(1);
    const value = Boolean(setting?.trip_required_to_ship);
    this.requiredCache.set(key, { value, at: Date.now() });
    return value;
  }

  /** The trip a Transfer Order is on, with its truck, or null when it is on none. */
  async assertTripFor(transferId: string, tenantId: string): Promise<{
    trip_id: string; trip_no: string; status: string; vehicle_no: string | null; driver_name: string | null; estimated_arrival: string | null;
  } | null> {
    const [transfer] = await this.db.select({ trip_id: schema.stockTransfer.trip_id }).from(schema.stockTransfer)
      .where(and(eq(schema.stockTransfer.transfer_id, transferId), eq(schema.stockTransfer.tenant_id, tenantId))).limit(1);
    if (!transfer?.trip_id) return null;
    const T = schema.logisticsTrip;
    const [trip] = await this.db.select().from(T)
      .where(and(eq(T.trip_id, transfer.trip_id), eq(T.tenant_id, tenantId), isNull(T.deleted_at))).limit(1);
    if (!trip) return null;
    const [vehicle] = trip.vehicle_id
      ? await this.db.select({ registration_no: schema.logisticsVehicle.registration_no }).from(schema.logisticsVehicle)
        .where(and(eq(schema.logisticsVehicle.vehicle_id, trip.vehicle_id), eq(schema.logisticsVehicle.tenant_id, tenantId))).limit(1)
      : [];
    const [driver] = trip.driver_id
      ? await this.db.select({ driver_name: schema.logisticsDriver.driver_name }).from(schema.logisticsDriver)
        .where(and(eq(schema.logisticsDriver.driver_id, trip.driver_id), eq(schema.logisticsDriver.tenant_id, tenantId))).limit(1)
      : [];
    return {
      trip_id: trip.trip_id, trip_no: trip.trip_no, status: trip.status, vehicle_no: vehicle?.registration_no ?? null,
      driver_name: driver?.driver_name ?? null, estimated_arrival: trip.estimated_arrival ?? null,
    };
  }

  // ── For the livestock batch transfer (Phase 3) ──────────────────────────────────────────────────────────────────

  /**
   * The trip a batch transfer is on, with its truck, or null when it is on none. A trip past (or short of) posting is
   * refused in words, as a Transfer Order's is: a transfer posts only on a planned, confirmed or in-transit trip.
   */
  async assertTripForBatchTransfer(batchTransferId: string, tenantId: string): Promise<{ trip_id: string; trip_no: string } | null> {
    const BT = schema.batchTransfer;
    const [transfer] = await this.db.select({ trip_id: BT.trip_id }).from(BT)
      .where(and(eq(BT.transfer_id, batchTransferId), eq(BT.tenant_id, tenantId))).limit(1);
    if (!transfer?.trip_id) return null;
    const trip = await this.tripById(transfer.trip_id, tenantId);
    if (!trip) return null;
    if (!['PLANNED', 'CONFIRMED', 'IN_TRANSIT'].includes(trip.status))
      throw new BadRequestException(`Trip ${trip.trip_no} is ${trip.status}; a transfer can only post on a planned, confirmed or in-transit trip.`);
    if (!trip.vehicle_id || !trip.driver_id)
      throw new BadRequestException(`Trip ${trip.trip_no} has no vehicle and driver yet; assign them before the transfer posts.`);
    return { trip_id: trip.trip_id, trip_no: trip.trip_no };
  }

  /** The batch transfer has posted, in its transaction: heads moved at once, so the trip leaves and arrives together (as a Direct Transfer's does). */
  async onBatchTransferPosted(tripId: string, tenantId: string, userPayload?: any): Promise<void> {
    await this.onShipped(tripId, tenantId, userPayload);
    await this.onArrived(tripId, tenantId, userPayload);
  }

  /** A short summary of a batch transfer's trip for its own screen, or null. */
  async tripOfBatchTransfer(batchTransferId: string, tenantId: string) {
    const BT = schema.batchTransfer;
    const [transfer] = await this.db.select({ trip_id: BT.trip_id }).from(BT)
      .where(and(eq(BT.transfer_id, batchTransferId), eq(BT.tenant_id, tenantId))).limit(1);
    if (!transfer?.trip_id) return null;
    const trip = await this.tripById(transfer.trip_id, tenantId);
    if (!trip) return null;
    const [vehicle] = trip.vehicle_id
      ? await this.db.select({ registration_no: schema.logisticsVehicle.registration_no }).from(schema.logisticsVehicle)
        .where(and(eq(schema.logisticsVehicle.vehicle_id, trip.vehicle_id), eq(schema.logisticsVehicle.tenant_id, tenantId))).limit(1)
      : [];
    const [driver] = trip.driver_id
      ? await this.db.select({ driver_name: schema.logisticsDriver.driver_name }).from(schema.logisticsDriver)
        .where(and(eq(schema.logisticsDriver.driver_id, trip.driver_id), eq(schema.logisticsDriver.tenant_id, tenantId))).limit(1)
      : [];
    return {
      trip_id: trip.trip_id, trip_no: trip.trip_no, status: trip.status, vehicle_no: vehicle?.registration_no ?? null,
      driver_name: driver?.driver_name ?? null, estimated_arrival: trip.estimated_arrival ?? null,
    };
  }

  // ── Audit ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async log(action: string, row: Row, user: any, oldValues?: unknown, extra?: Row) {
    await this.audit.log({
      tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action,
      entityName: 'logistics_trip', entityId: row.trip_id, oldValues, newValues: extra ? { ...row, ...extra } : row,
    });
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { and, eq, inArray, isNotNull, isNull, gt, notInArray, or, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { batchScopeConditions, farmScope } from '../../../common/farm-scope';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedRow, stageDayRange } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastFlag, ForecastInput, ForecastRow } from './feed-forecast.engine';
import { QueryFeedForecastDto } from './dto/feed-forecast.dto';

/** Workbook checkpoint 15: the forecast looks at most 45 days past `from`. */
export const MAX_SPAN_DAYS = 45;
const DEFAULT_SPAN_DAYS = 7;

/** Animals that have left the register no longer eat — same list batch-transfer and daily entry use. */
const GONE_STATUSES = ['DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED'];

/**
 * Upper bound on projected stage changes per batch. A 45-day window with
 * one-day stages needs at most 46; the cap exists only so a stage chain that
 * loops back on itself (a sow's reproductive cycle legitimately does) cannot
 * spin forever on a zero-progress edge.
 */
const MAX_SEGMENTS = 60;

export interface ForecastFarm {
  id: string;
  code: string;
  name: string;
  companyId: string;
  refillBufferDays: number;
  leadTimeDays: number;
}

export interface FeedForecastResponse {
  planningDate: string;
  from: string;
  to: string;
  farm: { id: string; code: string; name: string };
  rows: ForecastRow[];
  flags: ForecastFlag[];
}

export interface StageInfo {
  stageId: string;
  stageCode: string;
  durationDays: number | null;
  nextStageId: string | null;
}

type Segment = ForecastInput['batches'][number]['segments'][number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(iso: string, n: number): string {
  return new Date(parseIsoUtc(iso) + n * 86_400_000).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((parseIsoUtc(b) - parseIsoUtc(a)) / 86_400_000);
}

/**
 * The server's own calendar day, not the UTC one: `toISOString()` would hand a
 * farm east of Greenwich yesterday's date for the first hours of every
 * morning, and the forecast's planning date is a farm-local calendar day.
 */
function todayLocal(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * A batch's stage calendar across the window: the stage it is in now, then —
 * only where Stage Master says how long a stage lasts and what follows it —
 * the stages it is expected to move through before `to` (D11: known dated
 * movements only). Each projected segment is marked so the engine can flag
 * the assumption; a stage with no duration or no successor simply runs on
 * past `to`, which is what "the count stays flat" means for the stage too.
 */
export function projectSegments(stageId: string, start: string, to: string, stages: Map<string, StageInfo>): Segment[] {
  const first = stages.get(stageId);
  const segments: Segment[] = [{ stageId, stageCode: first?.stageCode ?? stageId, start, end: null, projected: false }];
  while (segments.length < MAX_SEGMENTS) {
    const current = segments[segments.length - 1];
    const stage = stages.get(current.stageId);
    if (!stage?.durationDays || stage.durationDays < 1 || !stage.nextStageId) break;
    const end = addDays(current.start, stage.durationDays - 1);
    if (end >= to) break;
    const next = stages.get(stage.nextStageId);
    if (!next) break;
    current.end = end;
    segments.push({ stageId: next.stageId, stageCode: next.stageCode, start: addDays(end, 1), end: null, projected: true });
  }
  return segments;
}

/**
 * One silo as the engine sees it. An empty silo is passed with no item and a
 * zero balance rather than dropped: the engine then never matches it, so a
 * shed it feeds falls through to another silo or the STORE exactly as D6/D9
 * say. Feed is held in KG; a balance in any other unit is refused outright,
 * because the forecast would otherwise add bags to kilograms and report a
 * run-down date that is off by the bag weight.
 */
export function siloInput(
  silo: { siloId: string; siloCode: string },
  resident: { item_id: string; on_hand_qty: number; uom: string } | null,
): ForecastInput['silos'][number] {
  if (!resident) return { siloId: silo.siloId, siloCode: silo.siloCode, itemId: null, balanceKg: 0 };
  if (resident.uom !== 'KG') {
    throw new ConflictException(
      `Silo '${silo.siloCode}' holds its feed in ${resident.uom}, not KG — the forecast cannot add bags to kilograms.`,
    );
  }
  return { siloId: silo.siloId, siloCode: silo.siloCode, itemId: resident.item_id, balanceKg: resident.on_hand_qty };
}

/**
 * GET /feed-forecast — loads one farm's sheds, silos, store, batches and
 * feed standards from the tenant database and hands them to the pure engine
 * (feed-forecast.engine.ts). Everything that decides *what* the forecast says
 * lives in the engine; this class only decides which rows are in it, so the
 * two can be tested apart.
 */
@Injectable()
export class FeedForecastService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly siloFeedService: SiloFeedService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async getForecast(query: QueryFeedForecastDto, tenantId: string): Promise<FeedForecastResponse> {
    const planningDate = todayLocal();
    const from = query.from ?? planningDate;
    const to = query.to ?? addDays(from, DEFAULT_SPAN_DAYS);
    if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) {
      throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    }
    if (to < from) throw new BadRequestException('to must not be before from.');
    if (diffDays(from, to) > MAX_SPAN_DAYS) {
      throw new BadRequestException(`The forecast covers at most ${MAX_SPAN_DAYS} days after from.`);
    }

    // D13: a farm-bound user sees their own farm and nothing else. A request
    // naming another farm answers NotFound, not Forbidden, so the endpoint
    // does not confirm that farm exists.
    const scope = farmScope(this.cls);
    if (scope.farmId && query.farmId && query.farmId !== scope.farmId) {
      throw new NotFoundException('Farm not found.');
    }
    const farmId = scope.farmId ?? query.farmId;
    if (!farmId) throw new BadRequestException('Select a farm.');

    const farm = await this.loadFarm(farmId, tenantId);
    const input = await this.loadInput(farm, planningDate, from, to, tenantId);
    const { rows, flags } = buildFeedForecast(input);
    return { planningDate, from, to, farm: { id: farm.id, code: farm.code, name: farm.name }, rows, flags };
  }

  /** The FARM row itself, inside the caller's company — the same test farm-scope uses for an active farm. */
  private async loadFarm(farmId: string, tenantId: string): Promise<ForecastFarm> {
    const scope = farmScope(this.cls);
    const [row] = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_name: schema.locationMaster.location_name,
        company_id: schema.locationMaster.company_id,
        feed_refill_buffer_days: schema.locationMaster.feed_refill_buffer_days,
        feed_lead_time_days: schema.locationMaster.feed_lead_time_days,
      })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.location_id, farmId),
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
          isNull(schema.locationMaster.parent_location_id),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
          ...(scope.companyId ? [eq(schema.locationMaster.company_id, scope.companyId)] : []),
        ),
      )
      .limit(1);
    if (!row || !row.company_id) throw new NotFoundException('Farm not found.');
    return {
      id: row.location_id,
      code: row.location_code,
      name: row.location_name,
      companyId: row.company_id,
      refillBufferDays: row.feed_refill_buffer_days ?? 2,
      leadTimeDays: row.feed_lead_time_days ?? 0,
    };
  }

  private async loadInput(farm: ForecastFarm, planningDate: string, from: string, to: string, tenantId: string): Promise<ForecastInput> {
    const companyId = farm.companyId;

    // Every location on the farm in one read: sheds, silos and the store are
    // picked out of it below, and scheduler/batch locations (often a PEN, or a
    // CRATE under a pen) are walked up to their SHED through it in memory.
    const locations = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_type: schema.locationMaster.location_type,
        parent_location_id: schema.locationMaster.parent_location_id,
        is_active: schema.locationMaster.is_active,
      })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.company_id, companyId),
          eq(schema.locationMaster.farm_id, farm.id),
          isNull(schema.locationMaster.deleted_at),
        ),
      );
    const locationById = new Map(locations.map((l) => [l.location_id, l]));
    const activeOfType = (type: string) =>
      locations.filter((l) => l.location_type === type && l.is_active).sort((a, b) => a.location_code.localeCompare(b.location_code));

    const shedRows = activeOfType('SHED');
    const siloRows = activeOfType('SILO');
    const activeSiloIds = new Set(siloRows.map((s) => s.location_id));

    /** A location's SHED: itself, or the nearest SHED above it (PEN -> SHED, CRATE -> PEN -> SHED). */
    const shedOf = (locationId: string | null | undefined): string | null => {
      let current = locationId ? locationById.get(locationId) : undefined;
      for (let hops = 0; current && hops < 5; hops++) {
        if (current.location_type === 'SHED') return current.location_id;
        current = current.parent_location_id ? locationById.get(current.parent_location_id) : undefined;
      }
      return null;
    };

    // silo_shed_link (D7) is the only silo<->shed source; location_master.feed_silo_id is being dropped (Task 9).
    const shedIds = shedRows.map((s) => s.location_id);
    const links = shedIds.length
      ? await this.db
          .select({ silo_id: schema.siloShedLink.silo_id, shed_id: schema.siloShedLink.shed_id })
          .from(schema.siloShedLink)
          .where(and(eq(schema.siloShedLink.tenant_id, tenantId), inArray(schema.siloShedLink.shed_id, shedIds)))
      : [];
    const siloIdsByShed = new Map<string, string[]>();
    for (const link of links) {
      if (!activeSiloIds.has(link.silo_id)) continue; // a link to a retired silo feeds nothing
      siloIdsByShed.set(link.shed_id, [...(siloIdsByShed.get(link.shed_id) ?? []), link.silo_id]);
    }
    const sheds = shedRows.map((s) => ({ shedId: s.location_id, shedCode: s.location_code, siloIds: siloIdsByShed.get(s.location_id) ?? [] }));

    const linkedSiloIds = [...new Set(links.map((l) => l.silo_id).filter((id) => activeSiloIds.has(id)))];
    const residents = linkedSiloIds.length ? await this.siloFeedService.currentItems(linkedSiloIds, companyId, tenantId) : new Map();
    const silos = siloRows
      .filter((s) => linkedSiloIds.includes(s.location_id))
      .map((s) => siloInput({ siloId: s.location_id, siloCode: s.location_code }, residents.get(s.location_id) ?? null));

    const batches = await this.loadBatches(farm, to, tenantId, shedOf);
    const feedRows = await this.loadFeedRows([...new Set(batches.map((b) => b.breedId))], companyId, tenantId);

    // The farm's STORE (D6 fallback). One per farm in every template; if a farm
    // somehow has two, the first by code is used — the forecast needs one pool.
    const storeRow = activeOfType('STORE')[0];
    let store: ForecastInput['store'] = null;
    if (storeRow) {
      const feedItemIds = new Set(feedRows.map((r) => r.itemId));
      const balances: Record<string, number> = {};
      const stock = await this.ledgerService.getStockBalance({ companyId, warehouseId: storeRow.location_id } as any, tenantId);
      for (const line of stock) {
        // The store also holds medicine in PCS and the like; only a *feed*
        // item held in a unit other than KG would corrupt the forecast.
        if (!feedItemIds.has(line.item_id)) continue;
        if (line.uom !== 'KG') {
          throw new ConflictException(
            `Store '${storeRow.location_code}' holds '${line.item_code}' in ${line.uom}, not KG — the forecast cannot add bags to kilograms.`,
          );
        }
        balances[line.item_id] = (balances[line.item_id] ?? 0) + line.on_hand_qty;
      }
      store = { storeId: storeRow.location_id, storeCode: storeRow.location_code, balances };
    }

    const itemIds = new Set<string>(feedRows.map((r) => r.itemId));
    for (const s of silos) if (s.itemId) itemIds.add(s.itemId);
    const items: Record<string, string> = {};
    if (itemIds.size) {
      const itemRows = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, [...itemIds])));
      for (const i of itemRows) items[i.item_id] = i.item_name;
    }

    return {
      planningDate,
      from,
      to,
      refillBufferDays: farm.refillBufferDays,
      leadTimeDays: farm.leadTimeDays,
      sheds,
      silos,
      store,
      items,
      batches,
      feedRows,
    };
  }

  /**
   * ACTIVE batches on the farm, as the engine's input batches. A BATCH_WISE
   * batch is one input batch; an ANIMAL_WISE batch has no single stage, so it
   * becomes one input batch per stage its live animals are in, each with that
   * group's head count (D11: the latest count, flat unless a stage change is
   * scheduled).
   */
  private async loadBatches(
    farm: ForecastFarm,
    to: string,
    tenantId: string,
    shedOf: (locationId: string | null | undefined) => string | null,
  ): Promise<ForecastInput['batches']> {
    const scope = farmScope(this.cls);
    const batchRows = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        breed_id: schema.batchHeader.breed_id,
        lob_id: schema.batchHeader.lob_id,
        stage_id: schema.batchHeader.stage_id,
        shed_id: schema.batchHeader.shed_id,
        tracking_mode: schema.batchHeader.tracking_mode,
        start_date: schema.batchHeader.start_date,
        opening_quantity: schema.batchHeader.opening_quantity,
        closing_quantity: schema.batchHeader.closing_quantity,
      })
      .from(schema.batchHeader)
      .where(
        and(
          eq(schema.batchHeader.tenant_id, tenantId),
          eq(schema.batchHeader.company_id, farm.companyId),
          eq(schema.batchHeader.farm_id, farm.id),
          eq(schema.batchHeader.status, 'ACTIVE'),
          ...batchScopeConditions(scope),
        ),
      );
    // A batch with no breed has no feed standard to look up; nothing to forecast for it.
    const fed = batchRows.filter((b) => b.breed_id);
    if (!fed.length) return [];
    const batchIds = fed.map((b) => b.batch_id);

    const animalGroups = new Map<string, { stageId: string; heads: number }[]>();
    const animalWiseIds = fed.filter((b) => b.tracking_mode === 'ANIMAL_WISE').map((b) => b.batch_id);
    if (animalWiseIds.length) {
      const groups = await this.db
        .select({
          batch_id: schema.animalRegister.current_batch_id,
          stage_id: schema.animalRegister.current_stage_id,
          heads: sql<number>`COUNT(*)`,
        })
        .from(schema.animalRegister)
        .where(
          and(
            eq(schema.animalRegister.tenant_id, tenantId),
            eq(schema.animalRegister.company_id, farm.companyId),
            inArray(schema.animalRegister.current_batch_id, animalWiseIds),
            isNotNull(schema.animalRegister.current_stage_id),
            notInArray(schema.animalRegister.status, GONE_STATUSES),
          ),
        )
        .groupBy(schema.animalRegister.current_batch_id, schema.animalRegister.current_stage_id);
      for (const g of groups) {
        if (!g.batch_id || !g.stage_id) continue;
        animalGroups.set(g.batch_id, [...(animalGroups.get(g.batch_id) ?? []), { stageId: g.stage_id, heads: Number(g.heads) }]);
      }
    }

    // scheduler_header is one row per (batch, stage): its effective_from is
    // when the batch entered that stage, and its location_id where it stood.
    const headers = await this.db
      .select({
        batch_id: schema.schedulerHeader.batch_id,
        stage_id: schema.schedulerHeader.stage_id,
        effective_from: schema.schedulerHeader.effective_from,
        location_id: schema.schedulerHeader.location_id,
      })
      .from(schema.schedulerHeader)
      .where(
        and(
          eq(schema.schedulerHeader.tenant_id, tenantId),
          eq(schema.schedulerHeader.company_id, farm.companyId),
          inArray(schema.schedulerHeader.batch_id, batchIds),
        ),
      );
    const headerOf = new Map(headers.map((h) => [`${h.batch_id}:${h.stage_id}`, h]));

    const lobIds = [...new Set(fed.map((b) => b.lob_id))];
    const stageRows = await this.db
      .select({
        stage_id: schema.stageMaster.stage_id,
        stage_code: schema.stageMaster.stage_code,
        typical_duration_days: schema.stageMaster.typical_duration_days,
        next_stage_id: schema.stageMaster.next_stage_id,
      })
      .from(schema.stageMaster)
      .where(
        and(
          eq(schema.stageMaster.tenant_id, tenantId),
          or(isNull(schema.stageMaster.company_id), eq(schema.stageMaster.company_id, farm.companyId)),
          inArray(schema.stageMaster.lob_id, lobIds),
          isNull(schema.stageMaster.deleted_at),
        ),
      );
    const stages = new Map<string, StageInfo>(
      stageRows.map((s) => [
        s.stage_id,
        { stageId: s.stage_id, stageCode: s.stage_code, durationDays: s.typical_duration_days, nextStageId: s.next_stage_id },
      ]),
    );

    const result: ForecastInput['batches'] = [];
    for (const b of fed) {
      const groups =
        b.tracking_mode === 'ANIMAL_WISE'
          ? animalGroups.get(b.batch_id) ?? []
          : b.stage_id
            ? [{ stageId: b.stage_id, heads: Number(b.closing_quantity ?? b.opening_quantity) }]
            : [];
      for (const g of groups) {
        const header = headerOf.get(`${b.batch_id}:${g.stageId}`);
        const start = header?.effective_from ?? b.start_date;
        const shedId = (header ? shedOf(header.location_id) : null) ?? shedOf(b.shed_id) ?? b.shed_id ?? '';
        result.push({
          // ANIMAL_WISE groups need distinct ids: the engine keys its rows by (batchId, item).
          batchId: b.tracking_mode === 'ANIMAL_WISE' ? `${b.batch_id}:${g.stageId}` : b.batch_id,
          batchNo: b.batch_no,
          breedId: b.breed_id!,
          shedId,
          heads: g.heads,
          segments: projectSegments(g.stageId, start, to, stages),
        });
      }
    }
    return result;
  }

  /** Active lifecycle rows with a feed item and a positive rate, as stage-day ranges (feed-row-days.ts). */
  private async loadFeedRows(breedIds: string[], companyId: string, tenantId: string): Promise<FeedRow[]> {
    if (!breedIds.length) return [];
    const rows = await this.db
      .select({
        lifecycle_id: schema.breedLifecycleStages.lifecycle_id,
        breed_id: schema.breedLifecycleStages.breed_id,
        stage_id: schema.breedLifecycleStages.stage_id,
        feed_item_id: schema.breedLifecycleStages.feed_item_id,
        calc_unit: schema.breedLifecycleStages.calc_unit,
        period_from: schema.breedLifecycleStages.period_from,
        period_to: schema.breedLifecycleStages.period_to,
        kg: schema.breedLifecycleStages.feed_qty_per_head_per_day_kg,
        wastage: schema.breedLifecycleStages.feed_wastage_pct,
      })
      .from(schema.breedLifecycleStages)
      .where(
        and(
          eq(schema.breedLifecycleStages.tenant_id, tenantId),
          or(isNull(schema.breedLifecycleStages.company_id), eq(schema.breedLifecycleStages.company_id, companyId)),
          inArray(schema.breedLifecycleStages.breed_id, breedIds),
          eq(schema.breedLifecycleStages.is_active, true),
          isNotNull(schema.breedLifecycleStages.feed_item_id),
          gt(schema.breedLifecycleStages.feed_qty_per_head_per_day_kg, '0'),
        ),
      );
    return rows.map((r) => {
      let range: { fromDay: number; toDay: number };
      try {
        range = stageDayRange(r.calc_unit, r.period_from, r.period_to);
      } catch (e) {
        // Corrupt master data: name the row rather than answer a bare 500.
        throw new ConflictException(`Breed lifecycle row ${r.lifecycle_id}: ${(e as Error).message}`);
      }
      return {
        lifecycleId: r.lifecycle_id,
        breedId: r.breed_id,
        stageId: r.stage_id,
        itemId: r.feed_item_id!,
        itemName: null,
        fromDay: range.fromDay,
        toDay: range.toDay,
        kgPerHeadPerDay: Number(r.kg),
        wastagePct: Number(r.wastage ?? 0),
      };
    });
  }
}

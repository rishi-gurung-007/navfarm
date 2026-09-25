import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { and, eq, inArray, isNotNull, isNull, gt, notInArray, or, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { activeFarmOfCompany, batchScopeConditions, farmScope, FARM_SCOPE_KEY, FarmScope } from '../../../common/farm-scope';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedRow, stageDayRange } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastFlag, ForecastInput, ForecastRow } from './feed-forecast.engine';
import { QueryFeedForecastDto } from './dto/feed-forecast.dto';

/**
 * The LOB bound on the forecast's location read for a restricted
 * (OPERATIONAL_ADMIN) caller. A location with no lob_id belongs to every LOB —
 * a farm STORE is often created without one — so it is admitted alongside the
 * caller's own, the same rule assertLocationOnActiveFarm (common/farm-scope.ts)
 * applies; a strict equality silently dropped such a store and its feed.
 */
export function locationLobConditions(scope: FarmScope) {
  return scope.restricted && scope.lobId
    ? [or(eq(schema.locationMaster.lob_id, scope.lobId), isNull(schema.locationMaster.lob_id))!]
    : [];
}

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
  isActive: boolean;
}

/** The slice of a location_master row the shed walk needs. */
export interface LocationNode {
  location_id: string;
  location_type: string;
  parent_location_id: string | null;
}

/** The slice of a batch_header row buildInputBatches needs. */
export interface BatchRow {
  batch_id: string;
  batch_no: string;
  breed_id: string | null;
  stage_id: string | null;
  shed_id: string | null;
  tracking_mode: string;
  animal_tracking: string | null;
  start_date: string;
  opening_quantity: string;
  closing_quantity: string | null;
}

export interface HeaderRow {
  batch_id: string;
  stage_id: string;
  effective_from: string;
  location_id: string | null;
}

type InputBatch = ForecastInput['batches'][number];

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

/** YYYY-MM-DD *and* a real day: Date.UTC rolls 2026-02-31 over to 3 March, so the parse must round-trip. */
function isCalendarDay(iso: string): boolean {
  return ISO_DAY.test(iso) && new Date(parseIsoUtc(iso)).toISOString().slice(0, 10) === iso;
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
 * the assumption; a stage with no duration, no successor, or a retired
 * (inactive) successor simply runs on past `to`.
 *
 * A stage whose typical length ran out *before* the planning date is not
 * projected either (fix round 1 ruling): the transition should have happened
 * but was not posted, so it is not a known movement — the batch keeps the
 * stage its record says, and the diet shown is that stage's.
 */
export function projectSegments(
  stageId: string,
  start: string,
  planningDate: string,
  to: string,
  stages: Map<string, StageInfo>,
): Segment[] {
  const first = stages.get(stageId);
  const segments: Segment[] = [{ stageId, stageCode: first?.stageCode ?? stageId, start, end: null, projected: false }];
  while (segments.length < MAX_SEGMENTS) {
    const current = segments[segments.length - 1];
    const stage = stages.get(current.stageId);
    if (!stage?.durationDays || stage.durationDays < 1 || !stage.nextStageId) break;
    const end = addDays(current.start, stage.durationDays - 1);
    if (end >= to || end < planningDate) break;
    const next = stages.get(stage.nextStageId);
    if (!next || !next.isActive) break;
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
  resident: { item_id: string; on_hand_qty: number; uoms: string[] } | null,
): ForecastInput['silos'][number] {
  if (!resident) return { siloId: silo.siloId, siloCode: silo.siloCode, itemId: null, balanceKg: 0 };
  // Every balance row of the item, not just the first: the ledger groups by
  // unit, so a KG row can sit beside a BAG row of the same feed.
  const foreign = resident.uoms.find((u) => u !== 'KG');
  if (foreign) {
    throw new ConflictException(
      `Silo '${silo.siloCode}' holds its feed in ${foreign}, not KG — the forecast cannot add bags to kilograms.`,
    );
  }
  return { siloId: silo.siloId, siloCode: silo.siloCode, itemId: resident.item_id, balanceKg: resident.on_hand_qty };
}

/** A location's SHED: itself, or the nearest SHED above it (PEN -> SHED, CRATE -> PEN -> SHED); null if none. */
export function resolveShed(locationId: string | null | undefined, locationById: Map<string, LocationNode>): string | null {
  let current = locationId ? locationById.get(locationId) : undefined;
  for (let hops = 0; current && hops < 5; hops++) {
    if (current.location_type === 'SHED') return current.location_id;
    current = current.parent_location_id ? locationById.get(current.parent_location_id) : undefined;
  }
  return null;
}

/**
 * ACTIVE batch rows -> the engine's input batches. A BATCH_WISE batch is one
 * input batch; an ANIMAL_WISE batch has no single stage, so it becomes one
 * input batch per stage its live animals are in, each with that group's head
 * count (D11: the latest count, flat unless a stage change is scheduled), and
 * a batchNo carrying the stage so the rows can be told apart. No live
 * animals, no input.
 *
 * For ANIMAL_WISE, animals with no current stage are counted in the batch's
 * own stage group rather than dropped; with no batch stage either there is no
 * diet to give them, and they feed nothing.
 *
 * A BATCH_WISE batch whose animal_tracking is REGISTERED is split by stage
 * too (final review, I2): its animals are registered one by one and each
 * moves through its own stages — a breeding herd is part flushing, part
 * gestating, part lactating at once — so the batch row's single stage would
 * feed every sow the diet of whichever stage the batch was opened at. Its
 * head count is still the batch's own (closing ?? opening): each stage group
 * is the live animals standing in that stage, and the batch's own stage gets
 * only what is left over, never less than zero and omitted at zero. Stage-less
 * animal rows are deliberately not counted one by one (I2 follow-up ruling):
 * a BIO_ASSET batch registers one placeholder row per opening head, so on the
 * demo 58 placeholders sit beside the 58 real animals they stand for, and
 * counting both fed the herd twice. The remainder rule does not depend on how
 * a placeholder is marked.
 *
 * Stage start and shed come from the batch's scheduler_header for that stage
 * — its effective_from is when the batch entered the stage, its location_id
 * where it stood — else from the batch row. Where the location does not walk
 * up to an *active* SHED of the farm, the batch is passed with no shed (so it
 * draws on the STORE) and flagged BATCH_SHED_UNKNOWN, since otherwise it would
 * read exactly like a D6 shed-without-silo.
 */
export function buildInputBatches(args: {
  batchRows: BatchRow[];
  animalGroups: Map<string, { stageId: string | null; heads: number }[]>;
  headers: HeaderRow[];
  stages: Map<string, StageInfo>;
  locationById: Map<string, LocationNode>;
  activeShedIds: Set<string>;
  planningDate: string;
  to: string;
}): { batches: InputBatch[]; flags: ForecastFlag[] } {
  const { batchRows, animalGroups, headers, stages, locationById, activeShedIds, planningDate, to } = args;

  // One header per (batch, stage) is the schema's intent (uq_scheduler_header_batch_stage),
  // but if several exist the latest that has already started wins — a future one is a plan, not a fact.
  const headerOf = new Map<string, HeaderRow>();
  for (const h of [...headers].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    if (h.effective_from <= planningDate) headerOf.set(`${h.batch_id}:${h.stage_id}`, h);
  }

  const batches: InputBatch[] = [];
  const flags: ForecastFlag[] = [];
  for (const b of batchRows) {
    if (!b.breed_id) continue; // no breed, no feed standard to look up
    const animalWise = isGroupedByAnimal(b);
    const groups = b.tracking_mode === 'ANIMAL_WISE'
      ? stageGroupsOf(animalGroups.get(b.batch_id) ?? [])
      : animalWise
        ? registeredStageGroups(animalGroups.get(b.batch_id) ?? [], b.stage_id, Number(b.closing_quantity ?? b.opening_quantity))
        : b.stage_id
        ? [{ stageId: b.stage_id, heads: Number(b.closing_quantity ?? b.opening_quantity) }]
        : [];
    for (const g of groups) {
      const stageCode = stages.get(g.stageId)?.stageCode ?? g.stageId;
      const batchNo = animalWise ? `${b.batch_no} · ${stageCode}` : b.batch_no;
      const header = headerOf.get(`${b.batch_id}:${g.stageId}`);
      const resolved = resolveShed(header?.location_id ?? b.shed_id, locationById);
      const shedId = resolved && activeShedIds.has(resolved) ? resolved : '';
      if (!shedId) flags.push({ kind: 'BATCH_SHED_UNKNOWN', batchNo });
      batches.push({
        // ANIMAL_WISE groups need distinct ids: the engine keys its rows by (batchId, item).
        batchId: animalWise ? `${b.batch_id}:${g.stageId}` : b.batch_id,
        batchNo,
        breedId: b.breed_id,
        shedId,
        heads: g.heads,
        segments: projectSegments(g.stageId, header?.effective_from ?? b.start_date, planningDate, to, stages),
      });
    }
  }
  return { batches, flags };
}

/** Batches the forecast splits by their animals' own stages (see buildInputBatches). */
function isGroupedByAnimal(b: Pick<BatchRow, 'tracking_mode' | 'animal_tracking'>): boolean {
  return b.tracking_mode === 'ANIMAL_WISE' || b.animal_tracking === 'REGISTERED';
}

/**
 * An ANIMAL_WISE batch's stage groups: live animals per current stage, in
 * first-seen order. Stage-less rows are skipped — daily entry can only post
 * against an animal at the line's stage, and a stage-less row is typically a
 * BIO_ASSET placeholder, so counting it would double the herd.
 */
function stageGroupsOf(groups: { stageId: string | null; heads: number }[]): { stageId: string; heads: number }[] {
  const heads = new Map<string, number>();
  for (const g of groups) {
    if (!g.stageId) continue;
    heads.set(g.stageId, (heads.get(g.stageId) ?? 0) + g.heads);
  }
  return [...heads].map(([stageId, n]) => ({ stageId, heads: n }));
}

/**
 * A REGISTERED batch's stage groups: staged live animals per stage, first-seen
 * order, then the batch's own stage topped up with the heads no staged animal
 * accounts for (merged into it if animals already stand in that stage).
 * Stage-less rows are ignored — see buildInputBatches.
 */
function registeredStageGroups(
  groups: { stageId: string | null; heads: number }[],
  batchStageId: string | null,
  batchHeads: number,
): { stageId: string; heads: number }[] {
  const heads = new Map<string, number>();
  for (const g of groups) {
    if (!g.stageId) continue;
    heads.set(g.stageId, (heads.get(g.stageId) ?? 0) + g.heads);
  }
  const staged = [...heads.values()].reduce((n, h) => n + h, 0);
  const remainder = Math.max(0, batchHeads - staged);
  if (batchStageId && remainder > 0) heads.set(batchStageId, (heads.get(batchStageId) ?? 0) + remainder);
  return [...heads].map(([stageId, n]) => ({ stageId, heads: n }));
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

  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string): Promise<FeedForecastResponse> {
    const planningDate = todayLocal();
    const from = query.from ?? planningDate;
    const to = query.to ?? addDays(from, DEFAULT_SPAN_DAYS);
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    }
    if (to < from) throw new BadRequestException('to must not be before from.');
    if (diffDays(from, to) > MAX_SPAN_DAYS) {
      throw new BadRequestException(`The forecast covers at most ${MAX_SPAN_DAYS} days after from.`);
    }

    const scope = farmScope(this.cls);
    // Ruling (fix round 1): only STANDARD_USER is farm-bound for this
    // endpoint. STANDARD_USER keeps D13 — a request naming another farm
    // answers NotFound, not Forbidden, so the endpoint does not confirm that
    // farm exists. Every other user type may ask for any active farm of
    // their company (LOB-checked for OPERATIONAL_ADMIN); the query farmId
    // wins over whatever the workspace switcher has pinned in the header, so
    // an admin can switch farms on this page without re-pinning first.
    const isStandardUser = !userType || userType === 'STANDARD_USER';
    let farmId: string | undefined;
    // The company that validated the chosen farm — normally scope.companyId,
    // but a TENANT_ADMIN/SYSTEM_ADMIN in tenant-wide scope (no company
    // pinned) has none, so it is resolved from the farm itself (fix round 2,
    // finding 2).
    let effectiveCompanyId = scope.companyId;
    if (isStandardUser) {
      if (scope.farmId && query.farmId && query.farmId !== scope.farmId) {
        throw new NotFoundException('Farm not found.');
      }
      farmId = scope.farmId ?? query.farmId;
    } else {
      farmId = query.farmId ?? scope.farmId ?? undefined;
      if (farmId) {
        if (scope.companyId) {
          if (!(await activeFarmOfCompany(this.db, farmId, scope.companyId, tenantId))) {
            throw new NotFoundException('Farm not found.');
          }
        } else if (userType === 'TENANT_ADMIN' || userType === 'SYSTEM_ADMIN') {
          const tenantFarmCompanyId = await this.activeFarmOfTenant(farmId, tenantId);
          if (!tenantFarmCompanyId) throw new NotFoundException('Farm not found.');
          effectiveCompanyId = tenantFarmCompanyId;
        } else {
          // No company to validate against and not a tenant-wide admin type —
          // a data-integrity gap (e.g. a COMPANY_ADMIN with no assigned
          // company), never something to silently widen access for.
          throw new NotFoundException('Farm not found.');
        }
        if (scope.restricted && scope.lobId) {
          const [farmRow] = await this.db
            .select({ lob_id: schema.locationMaster.lob_id })
            .from(schema.locationMaster)
            .where(eq(schema.locationMaster.location_id, farmId))
            .limit(1);
          if (!farmRow || farmRow.lob_id !== scope.lobId) throw new NotFoundException('Farm not found.');
        }
      }
    }
    if (!farmId) throw new BadRequestException('Select a farm.');

    // Every loader below must see the farm actually being reported on, not
    // whatever farm happens to be pinned in the header — otherwise an admin
    // switching farms through `farmId` would have their loaders silently
    // filtered back down to the pinned farm (or, worse, another company's).
    // Fix round 2, finding 1: this must replace the CLS-held scope itself
    // (`this.cls.set`), not just a value threaded through this method's own
    // loaders — InventoryLedgerService and SiloFeedService (via
    // siloFeedService.currentItems -> ledgerService.getStockBalance) read
    // farmScope(cls) independently for their own warehouse-balance queries,
    // several calls below this one, and never saw the effective farm before
    // this fix. `cls.set` needs an active CLS context, so this runs the rest
    // of the request inside `cls.run()` — the same idiom withTenantTransaction
    // uses (tenant-transaction.ts) to open one when it isn't already inside
    // one; nested inside a real request it inherits the guard's own context
    // (tenantDb, tenantId, ...) and only farmScope is overridden within it.
    const farmIdResolved = farmId;
    const effectiveScope: FarmScope = { ...scope, farmId: farmIdResolved, companyId: effectiveCompanyId };
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, effectiveScope);
      const farm = await this.loadFarm(farmIdResolved, tenantId);
      const { input, flags: loadFlags } = await this.loadInput(farm, planningDate, from, to, tenantId);
      const { rows, flags } = buildFeedForecast(input);
      return { planningDate, from, to, farm: { id: farm.id, code: farm.code, name: farm.name }, rows, flags: [...flags, ...loadFlags] };
    });
  }

  /** Company of an active, top-level, non-deleted FARM of the tenant — no company condition, for
   * a TENANT_ADMIN/SYSTEM_ADMIN in tenant-wide scope who has no company pinned to check against. */
  private async activeFarmOfTenant(farmId: string, tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ company_id: schema.locationMaster.company_id })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.location_id, farmId),
          isNull(schema.locationMaster.parent_location_id),
          eq(schema.locationMaster.location_type, 'FARM'),
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
        ),
      )
      .limit(1);
    return row?.company_id ?? null;
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

  private async loadInput(
    farm: ForecastFarm,
    planningDate: string,
    from: string,
    to: string,
    tenantId: string,
  ): Promise<{ input: ForecastInput; flags: ForecastFlag[] }> {
    const companyId = farm.companyId;
    // getForecast has already replaced the CLS scope with the effective one
    // (fix round 2, finding 1) — every read below, direct or through
    // siloFeedService/ledgerService, sees the chosen farm this way.
    const scope = farmScope(this.cls);

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
          // Fix round 2, finding 4: a restricted (OPERATIONAL_ADMIN) caller's
          // read is bounded by LOB everywhere else — this one had been left out.
          ...locationLobConditions(scope),
        ),
      );
    const locationById = new Map(locations.map((l) => [l.location_id, l]));
    const activeOfType = (type: string) =>
      locations.filter((l) => l.location_type === type && l.is_active).sort((a, b) => a.location_code.localeCompare(b.location_code));

    const shedRows = activeOfType('SHED');
    const siloRows = activeOfType('SILO');
    const activeSiloIds = new Set(siloRows.map((s) => s.location_id));

    // silo_shed_link (D7) is the only silo<->shed source; the feed_silo_id column it replaced went in 0115.
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

    const { batches, flags } = await this.loadBatches(farm, planningDate, to, tenantId, locationById, new Set(shedIds));
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
      input: {
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
      },
      flags,
    };
  }

  /** Reads the ACTIVE batches of the farm and everything buildInputBatches needs to place them. */
  private async loadBatches(
    farm: ForecastFarm,
    planningDate: string,
    to: string,
    tenantId: string,
    locationById: Map<string, LocationNode>,
    activeShedIds: Set<string>,
  ): Promise<{ batches: InputBatch[]; flags: ForecastFlag[] }> {
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
        animal_tracking: schema.batchHeader.animal_tracking,
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
          isNull(schema.batchHeader.deleted_at),
          ...batchScopeConditions(scope),
        ),
      );
    const fed = batchRows.filter((b) => b.breed_id);
    if (!fed.length) return { batches: [], flags: [] };
    const batchIds = fed.map((b) => b.batch_id);

    const animalGroups = new Map<string, { stageId: string | null; heads: number }[]>();
    const animalWiseIds = fed.filter(isGroupedByAnimal).map((b) => b.batch_id);
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
            // Stage-less rows are read but never counted individually: an
            // ANIMAL_WISE batch skips them, and a REGISTERED one derives its
            // own-stage group from the batch head count instead (I2).
            notInArray(schema.animalRegister.status, GONE_STATUSES),
          ),
        )
        .groupBy(schema.animalRegister.current_batch_id, schema.animalRegister.current_stage_id);
      for (const g of groups) {
        if (!g.batch_id) continue;
        animalGroups.set(g.batch_id, [...(animalGroups.get(g.batch_id) ?? []), { stageId: g.stage_id ?? null, heads: Number(g.heads) }]);
      }
    }

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

    // Inactive stages are loaded too (a batch may still sit in one); projectSegments refuses to move *into* one.
    const lobIds = [...new Set(fed.map((b) => b.lob_id))];
    const stageRows = await this.db
      .select({
        stage_id: schema.stageMaster.stage_id,
        stage_code: schema.stageMaster.stage_code,
        typical_duration_days: schema.stageMaster.typical_duration_days,
        next_stage_id: schema.stageMaster.next_stage_id,
        is_active: schema.stageMaster.is_active,
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
        {
          stageId: s.stage_id,
          stageCode: s.stage_code,
          durationDays: s.typical_duration_days,
          nextStageId: s.next_stage_id,
          isActive: s.is_active,
        },
      ]),
    );

    return buildInputBatches({ batchRows: fed, animalGroups, headers, stages, locationById, activeShedIds, planningDate, to });
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

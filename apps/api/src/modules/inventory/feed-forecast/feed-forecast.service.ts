import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { and, eq, gte, inArray, isNotNull, isNull, gt, lte, notInArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import * as schema from '../../../core/database/schema';
import { activeFarmOfCompany, batchScopeConditions, farmScope, FARM_SCOPE_KEY, FarmScope, restrictedScopeConditions } from '../../../common/farm-scope';
import { FeedStockMovement, InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { FeedRow, stageDayRange } from '../../production/lifecycle/feed-row-days';
import { asBatchPk, buildFeedForecast, DailyForecastRow, dayShort, DietChange, ForecastFlag, ForecastInput, ForecastRow, ForecastSource, isTimeZone, todayInZone } from './feed-forecast.engine';
import { defaultWindowEnd, ForecastView, groupRows, MAX_SPAN_DAYS, PeriodRange, ReportRow, resolveViewRange, spanProblem } from './feed-forecast.view';
import { stockAsOf } from './feed-forecast.stock';
import { QueryFeedForecastDto, UpdateSiloPlanningDto } from './dto/feed-forecast.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { assertSiloLevels } from '../silo-feed/silo-levels';
import { isFarmBoundUserType } from '../../../common/user-type-hierarchy';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { FeedForecastRunService } from './feed-forecast-run.service';
import { buildSourceSnapshot } from './feed-forecast-run.rules';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { toFarmFeedSettings } from '../feed-settings/feed-settings.rules';
import { productionCycle } from '../../procurement/feed-requisition/feed-requisition.rules';
import { buildSiloStatus, SiloFact, SiloStatusRow } from './feed-silo-status';

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

// Checkpoint 15's limit lives with the views (feed-forecast.view.ts); re-exported for the requisition, which imports it from here.
export { MAX_SPAN_DAYS };

/** Animals that have left the register no longer eat — same list batch-transfer and daily entry use. */
const GONE_STATUSES = ['DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED'];

/**
 * Upper bound on projected stage changes per batch. A 45-day window with
 * one-day stages needs at most 46; the cap exists only so a stage chain that
 * loops back on itself (a sow's reproductive cycle legitimately does) cannot
 * spin forever on a zero-progress edge.
 */
const MAX_SEGMENTS = 60;

/** Ledger transaction types that bring feed into a silo (Master Setup row 16); variances and reversals are not receipts. */
const SILO_RECEIPT_TRANSACTION_TYPES = ['PURCHASE', 'TRANSFER_RECEIPT'] as const;

export interface ForecastFarm {
  id: string;
  code: string;
  name: string;
  companyId: string;
}

/** One farm a feed screen may offer (review A2). companyName labels it in the tenant-wide workspace. */
export interface FeedFarmOption {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
}

/**
 * A farm's override of the feed-planning logistics values, read from its active
 * feed_planning_setting row (Task 8, spec 2026-10-03 §3.2). null = the farm sets
 * nothing and inherits the company value. Edited through PUT /feed-settings/farm.
 */
export interface FeedFarmSettings {
  safetyStockKg: number | null;
  bagSizeKg: number | null;
  bulkMultipleKg: number | null;
  truckTargetKg: number | null;
  productionWeekday: number | null;
}

/** D41: one silo of a farm, as Silo Feed Setup lists it. */
export interface FeedPlanningSilo {
  locationId: string;
  code: string;
  name: string;
  linkedSheds: Array<{ locationId: string; code: string; name: string }>;
  feedType: 'BULK' | 'BAGGED';
  /** What it is holding now — read-only; null when it is empty. */
  feedItemCode: string | null;
  feedItemName: string | null;
  capacityKg: number | null;
  lowLevelKg: number | null;
  highLevelKg: number | null;
  status: string;
}

export interface FeedFarmSettingsRow extends FeedFarmOption {
  settings: FeedFarmSettings;
  /** D41: the farm's silos, in code order. */
  silos: FeedPlanningSilo[];
}

export interface FeedForecastResponse {
  planningDate: string;
  /** The farm's own day (D16) and the zone it was read in — a planning date before it is AS_OF_PAST (Q8). */
  today: string;
  timeZone: string | null;
  from: string;
  to: string;
  /** How far the run-down was looked for (Q12): at least `to`, at most 45 days past the planning date. */
  horizonTo: string;
  farm: { id: string; code: string; name: string };
  /** TDD Engine Step 8 / Dashboard row 60: the configured planning settings the engine used for this run. */
  settings: { safetyStockKg: number; bulkMultipleKg: number; bagSizeKg: number };
  rows: ForecastRow[];
  daily: DailyForecastRow[];
  flags: ForecastFlag[];
  // Plan B: the requisition's lines and the DIET_CHANGE alert read these (engine Task 2).
  sources: ForecastSource[];
  dietChanges: DietChange[];
  /** Plan R: each batch's current / next stage block (field specification, supporting block). */
  stages: StageBlock[];
  /** Detached, canonical pure-engine inputs. Saved runs use this as their deterministic source evidence. */
  sourceSnapshot: { version: string; hash: string; values: { engineInput: ForecastInput } };
}

export interface ResolvedFarm {
  farmId: string;
  companyId: string;
}

/** "Today" for a farm (D16) and the zone it was read in; timeZone null = the server's day (no usable zone on record). */
export interface FarmClock {
  today: string;
  timeZone: string | null;
}

/**
 * Field specification, Supporting Stage / Diet Reference Block: the stage the
 * batch is in (dated from when it actually entered it — its scheduler header,
 * else the batch start), the next stage from Stage Master, and the day the
 * batch is due to change. Stage Master's typical duration dates both; without
 * one the dates stay open rather than being guessed. A change that fell due
 * on or before the planning date and was not posted is marked, because the
 * forecast keeps feeding the recorded stage (Plan A fix round 1).
 */
export interface StageBlock {
  batchId: string;
  batchNo: string;
  shedCode: string;
  currentStageCode: string;
  currentFrom: string;
  currentTo: string | null;
  nextStageCode: string | null;
  nextFrom: string | null;
  nextTo: string | null;
  /**
   * D36 (Rishi, 28 Sep): the earliest day the stage could be left — the stage
   * master's `min_days_before_move` — when the stage is event-based and that
   * minimum sits strictly inside 0…latest. Null on a dated stage: its change
   * is a day, not a window. The web shows "earliest – latest (expected)".
   */
  stageChangeEarliest: string | null;
  stageChangeDate: string | null; // the latest day (typical_duration_days), which the forecast plans on
  stageChangeOverdue: boolean; // due on or before the planning date but not posted
}

/**
 * One block per input batch (an ANIMAL_WISE or REGISTERED batch is one per
 * stage group, as its report rows are). The current stage is the batch's
 * first segment — the recorded one, never a projection — so its start is the
 * scheduler header buildInputBatches chose under the header cutoff (Ruling
 * I1: today's register, not a back-dated planning date).
 */
export function stageBlocksFor(
  batches: ForecastInput['batches'],
  stages: Map<string, StageInfo>,
  shedCodeById: Map<string, string>,
  planningDate: string,
): StageBlock[] {
  return batches
    .map((b) => {
      const current = b.segments[0];
      const stage = stages.get(current.stageId);
      const currentTo = stage?.durationDays && stage.durationDays >= 1 ? addDays(current.start, stage.durationDays - 1) : null;
      // A retired successor is not a stage the batch can move into (projectSegments refuses it too).
      const candidate = stage?.nextStageId ? stages.get(stage.nextStageId) : undefined;
      const next = candidate && candidate.isActive ? candidate : undefined;
      const nextFrom = currentTo && next ? addDays(currentTo, 1) : null;
      const nextTo = nextFrom && next?.durationDays && next.durationDays >= 1 ? addDays(nextFrom, next.durationDays - 1) : null;
      return {
        batchId: b.batchId,
        batchNo: b.batchNo,
        shedCode: shedCodeById.get(b.shedId) ?? '',
        currentStageCode: current.stageCode,
        currentFrom: current.start,
        currentTo,
        nextStageCode: next?.stageCode ?? null,
        nextFrom,
        nextTo,
        // D36: the earliest day the change could happen — the stage master's
        // min_days_before_move, read as day N's end (same -1 convention as
        // durationDays above) — shown only when it falls strictly inside
        // 0…latest. The planned date itself stays the LATEST day (D36).
        stageChangeEarliest:
          nextFrom && next && stage?.minDays != null && stage.minDays > 0 && stage.minDays < stage.durationDays!
            ? addDays(current.start, stage.minDays)
            : null,
        stageChangeDate: nextFrom,
        stageChangeOverdue: nextFrom !== null && nextFrom <= planningDate,
      };
    })
    // Stage is the last tie-break: batchId + currentStageCode is the web's row key (an ANIMAL_WISE batch has a block
    // per stage group), so the order must be total over it and never depend on the order batches were loaded in.
    .sort((a, b) =>
      a.shedCode !== b.shedCode
        ? a.shedCode.localeCompare(b.shedCode)
        : a.batchNo !== b.batchNo
          ? a.batchNo.localeCompare(b.batchNo)
          : a.currentStageCode.localeCompare(b.currentStageCode),
    );
}

/** GET /feed-forecast (Plan R): the field specification's report — grouped rows, the stage block and the range it covers. */
export interface FeedForecastReport {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  /** First date forecast (Q7): the planning date or `from`, whichever is later; null when the range ends before the planning date. */
  forecastFrom: string | null;
  /** Q7 said in words: set whenever part or all of the range lies before the planning date and so is not forecast. */
  forecastNote: string | null;
  horizonTo: string;
  period: PeriodRange | null;
  farm: { id: string; code: string; name: string };
  /** TDD Engine Step 8 / Dashboard row 60: the configured planning settings the engine used for this run. */
  settings: { safetyStockKg: number; bulkMultipleKg: number; bagSizeKg: number };
  rows: ReportRow[];
  stages: StageBlock[];
  flags: ForecastFlag[];
  sources: ForecastSource[];
  dietChanges: DietChange[];
}

type PersistableFeedForecastReport = FeedForecastReport & {
  daily: DailyForecastRow[];
  sourceSnapshot: FeedForecastResponse['sourceSnapshot'];
};

export interface StageInfo {
  stageId: string;
  stageCode: string;
  durationDays: number | null;
  /** D36: min_days_before_move — the earliest day an event-based stage can be left. */
  minDays?: number | null;
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

/**
 * The forecast's standard horizon: the run-down and the shortage date are
 * looked for up to MAX_SPAN_DAYS past the planning date (Q12), whatever window
 * is shown. getForecast (and so Save Run) and the requisition draft both use it.
 */
export function forecastHorizon(planningDate: string): string {
  return addDays(planningDate, MAX_SPAN_DAYS);
}

/**
 * 9d D1: the range a requisition draft computes its forecast over. A draft
 * links the run saved for its window only when the two source hashes are
 * equal, and the hash covers the whole engine input, horizonTo included — so
 * the draft computes exactly what Save Run computes for a CUSTOM window from
 * the planning date to `to`: the standard horizon, not `to`. The draft's
 * order window (the shortfall, the lines) stays `to`.
 */
export function draftForecastRange(planningDate: string, to?: string): { planningDate: string; from: string; to: string; horizonTo: string } {
  return { planningDate, from: planningDate, to: to ?? defaultWindowEnd(planningDate), horizonTo: forecastHorizon(planningDate) };
}

function diffDays(a: string, b: string): number {
  return Math.round((parseIsoUtc(b) - parseIsoUtc(a)) / 86_400_000);
}

/**
 * Q8: heads and stages are always today's register, so an as-of date far from
 * today would mislead. Shared by getForecast (checked before a Reporting
 * Period is looked up) and computeForFarm (every caller), so the two can never
 * word or bound it differently.
 */
function planningDateProblem(today: string, planningDate: string): string | null {
  return Math.abs(diffDays(today, planningDate)) > MAX_SPAN_DAYS ? `The planning date must be within ${MAX_SPAN_DAYS} days of today (${dayShort(today)}).` : null;
}

/**
 * Q12: nothing is forecast past 45 days after the planning date, and the walk
 * runs from the stock date to at least `to`, so a later `to` is refused rather
 * than walked. When the caller sent no `to` the date refused is one it never
 * typed — the default from + 6 (7 days inclusive) — so the message names that instead of
 * pointing at a value the caller cannot see.
 */
function reachProblem(planningDate: string, to: string, toSent: boolean): string | null {
  const reach = addDays(planningDate, MAX_SPAN_DAYS);
  if (to <= reach) return null;
  return toSent
    ? `The forecast reaches ${dayShort(reach)} at most (${MAX_SPAN_DAYS} days after the planning date).`
    : `The range would end ${dayShort(to)}, after the last forecast day ${dayShort(reach)}. Choose an end date on or before ${dayShort(reach)}.`;
}

/** YYYY-MM-DD *and* a real day: Date.UTC rolls 2026-02-31 over to 3 March, so the parse must round-trip. */
function isCalendarDay(iso: string): boolean {
  return ISO_DAY.test(iso) && new Date(parseIsoUtc(iso)).toISOString().slice(0, 10) === iso;
}

/**
 * The AS_OF_PAST note (Q8 and the Task 6 carry ruling). Only balances are
 * rebuilt as of a past planning date; the batch set, head counts and stages
 * are read as they stand today, so a batch that entered its current stage
 * after the planning date is fed nothing for the days before that stage
 * began — said here so the gap is never read as "no feed needed".
 */
export function asOfPastNote(planningDate: string, today: string): string {
  return (
    `Stock as of ${dayShort(planningDate)}. Batches, head counts and stages are as of today (${dayShort(today)}); ` +
    `a batch that entered its stage after ${dayShort(planningDate)} shows no feed before that.`
  );
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
  // The initial segment carries the stage's change window (D36):
  // changeWindowStart needs min_days_before_move, read off the same row.
  const first = stages.get(stageId);
  const segments: Segment[] = [{
    stageId,
    stageCode: first?.stageCode ?? stageId,
    start,
    end: null,
    projected: false,
    // D36: an event-based stage's change window — earliest day (min_days_before_move)
    // to latest (typical_duration_days). Set when the minimum sits strictly inside
    // 0…latest; the forecast still plans the change on the latest day.
    ...(first?.minDays != null && first.minDays > 0 && first.durationDays != null && first.minDays < first.durationDays
      ? { changeWindowStart: addDays(start, first.minDays) }
      : {}),
  }];
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
  /** Latest header that counts as started; defaults to planningDate. The service passes max(planningDate, today) (Ruling I1). */
  headerCutoff?: string;
}): { batches: InputBatch[]; flags: ForecastFlag[] } {
  const { batchRows, animalGroups, headers, stages, locationById, activeShedIds, planningDate, to } = args;
  const headerCutoff = args.headerCutoff ?? planningDate;

  // One header per (batch, stage) is the schema's intent (uq_scheduler_header_batch_stage),
  // but if several exist the latest that has already started wins — a future one is a plan, not a fact.
  // "Already started" is judged against today's register, not a back-dated planning date (Ruling I1, Q8):
  // batches and stages are read as they stand today, so a stage entered after a past planning date is
  // still the stage the batch is in, and dropping its header would start it at the batch's own start —
  // the wrong day of stage, the wrong diet row, and a wrong stage block.
  const headerOf = new Map<string, HeaderRow>();
  for (const h of [...headers].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    if (h.effective_from <= headerCutoff) headerOf.set(`${h.batch_id}:${h.stage_id}`, h);
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
        // This composite is an aggregation/display key only — never a batch_header PK — so it must
        // never be written to a database column (D1, 3 Oct: ER_DATA_TOO_LONG / FK rejection on
        // requisition_line_batch.batch_id and feed_forecast_run_line.batch_id). `realBatchId` below
        // is always the genuine PK and is what downstream writers must persist.
        batchId: animalWise ? `${b.batch_id}:${g.stageId}` : b.batch_id,
        realBatchId: asBatchPk(b.batch_id),
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
    private readonly auditService: AuditLogService,
    // D41: what each silo is holding now, for Silo Feed Setup's read-only columns.
    private readonly siloFeedService: SiloFeedService,
    // Task 4 fix round 2 (Important 3, Rishi's ruling): required, not
    // optional. A module-wiring mistake that silently dropped this
    // dependency must fail loudly (Nest throws at boot), not degrade every
    // forecast to safety stock 0 — the exact production defect this task
    // exists to repair. FeedForecastModule always provides a real one
    // (imports FeedSettingsModule); every unit test that constructs this
    // service directly now passes a stub too.
    private readonly feedSettings: FeedSettingsService,
    @Optional() private readonly runService?: FeedForecastRunService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * GET /feed-forecast (Plan R). The view only chooses the range and how the
   * engine's per-date rows are grouped (feed-forecast.view.ts); whatever the
   * view, the run-down is looked for 45 days past the planning date (Q12).
   *
   * Every date the caller sends is checked here, before anything is read, even
   * one the chosen view does not use (`from` under PERIOD, `to` under DAILY or
   * WEEKLY): the DTO's IsDateString admits a timestamp or a rolled-over day
   * such as 2026-02-31, and a malformed value must answer 400, never be
   * quietly dropped because this view happens not to need it.
   */
  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string, includeDaily?: false): Promise<FeedForecastReport>;
  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType: string | undefined, includeDaily: true): Promise<PersistableFeedForecastReport>;
  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string, includeDaily = false): Promise<FeedForecastReport | PersistableFeedForecastReport> {
    const { farmId, companyId } = await this.resolveFarm(query.farmId, tenantId, userType);
    for (const [name, value] of [['planningDate', query.planningDate], ['from', query.from], ['to', query.to]] as const) {
      if (value !== undefined && !isCalendarDay(value)) throw new BadRequestException(`${name} must be a calendar date (YYYY-MM-DD).`);
    }
    const clock = await this.farmToday(companyId, tenantId);
    const planningDate = query.planningDate ?? clock.today;
    // Q8, checked again in computeForFarm: here as well so a Reporting Period is not looked up for a date that is refused.
    const dateProblem = planningDateProblem(clock.today, planningDate);
    if (dateProblem) throw new BadRequestException(dateProblem);
    const view: ForecastView = query.view ?? 'CUSTOM';
    let period: PeriodRange | null = null;
    if (view === 'PERIOD') {
      const periods = await this.loadPeriods(companyId, tenantId);
      period = query.periodId
        ? periods.find((p) => p.periodId === query.periodId) ?? null
        : periods.find((p) => p.startDate <= planningDate && planningDate <= p.endDate) ?? null;
      if (!period) {
        throw new BadRequestException(
          query.periodId ? 'Reporting period not found.' : `No reporting period covers ${dayShort(planningDate)}. Add one under Farm Master → Reporting Periods.`,
        );
      }
    } else if (query.periodId !== undefined) {
      // A period chosen for another view would be silently ignored — say so instead.
      throw new BadRequestException('periodId applies only to the Reporting Period view.');
    }
    const { from, to } = resolveViewRange({ view, planningDate, from: query.from, to: query.to, period });
    const span = spanProblem(from, to, period);
    if (span) throw new BadRequestException(span);
    // `reach` is the last forecast day (45 days after the planning date). computeForFarm refuses a `to` past it
    // (reachProblem) and looks for the run-down up to `horizonTo` (Q12), so the horizon keeps the full reach.
    // The computed and returned range is the one resolveViewRange chose: an omitted `to` means the 7-day default
    // window (from + 6, Engine §5 row 67), never the reach. An explicit `to` is sent as typed and stays bound by it.
    const reach = forecastHorizon(planningDate);
    const sentTo = query.to ?? to;
    const result = await this.computeForFarm(farmId, companyId, tenantId, { from, to: sentTo, planningDate, horizonTo: reach }, clock);
    // Q7: an "as of" forecast has no projection for days already behind the planning date.
    const forecastFrom = to < planningDate ? null : from > planningDate ? from : planningDate;
    const forecastNote = forecastFrom === null
      ? `Nothing from ${dayShort(from)} to ${dayShort(to)} is forecast: the range ends before the planning date (${dayShort(planningDate)}).`
      : forecastFrom > from
        ? `Days before the planning date (${dayShort(planningDate)}) are not forecast.`
        : null;
    // shortageDate is new run/requisition evidence. Keep the ordinary GET
    // response compatible by exposing the same source shape it had before
    // persisted runs; the explicit save path receives it on `daily` instead.
    const reportSources = result.sources.map((source) => {
      const compatible = { ...source };
      delete compatible.shortageDate;
      return compatible;
    });
    const report: FeedForecastReport = {
      planningDate: result.planningDate,
      today: result.today,
      timeZone: result.timeZone,
      view,
      from,
      to: sentTo,
      forecastFrom,
      forecastNote,
      horizonTo: result.horizonTo,
      period,
      farm: result.farm,
      settings: result.settings,
      rows: groupRows(result.daily, view, from),
      stages: result.stages,
      flags: result.flags,
      sources: reportSources,
      dietChanges: result.dietChanges,
    };
    return includeDaily ? { ...report, daily: result.daily, sourceSnapshot: result.sourceSnapshot } : report;
  }

  /** Explicit persistence boundary. Ordinary getForecast calls never enter it. */
  async saveRun(query: QueryFeedForecastDto, tenantId: string, actor?: { userId?: string; userType?: string }) {
    if (!this.runService) throw new Error('Feed forecast run service is not configured.');
    if (!actor?.userId) throw new UnauthorizedException('An authenticated creator is required to save a forecast run.');
    const runService = this.runService;
    return withTenantTransaction(this.cls, async () => {
      // This is transaction/database time, not application wall-clock time.
      // It records when the evidence was taken; deterministic reconstruction
      // comes from sourceSnapshot, which contains the exact detached engine
      // inputs read by this transaction.
      const [clockRows] = await this.db.execute(sql`SELECT CURRENT_TIMESTAMP AS source_cutoff_at`) as unknown as [
        Array<{ source_cutoff_at: string }>,
        unknown,
      ];
      const [clock] = clockRows;
      if (!clock?.source_cutoff_at) throw new Error('Database source cutoff could not be established.');
      const { farmId, companyId } = await this.resolveFarm(query.farmId, tenantId, actor?.userType);
      const output = await this.getForecast({ ...query, farmId }, tenantId, actor?.userType, true);
      return runService.createRun({
        tenantId,
        companyId,
        farmId,
        planningDate: output.planningDate,
        view: output.view,
        from: output.from,
        to: output.to,
        periodId: output.period?.periodId ?? null,
        sourceCutoffAt: clock.source_cutoff_at,
      }, output, actor);
    });
  }

  async listRuns(queryFarmId: string | undefined, tenantId: string, userType?: string) {
    if (!this.runService) throw new Error('Feed forecast run service is not configured.');
    const { farmId, companyId } = await this.resolveFarm(queryFarmId, tenantId, userType);
    return this.runService.findAll(farmId, companyId, tenantId);
  }

  async findRun(runId: string, tenantId: string) {
    if (!this.runService) throw new Error('Feed forecast run service is not configured.');
    return this.runService.findOne(runId, tenantId);
  }

  /**
   * GET /feed-forecast/periods: the periods the Reporting Period view may use,
   * for the caller's farm (D13, D20). Through resolveFarm, so a farm login gets
   * its own company's list and an unknown user type fails closed.
   */
  async listPeriods(queryFarmId: string | undefined, tenantId: string, userType: string | undefined): Promise<PeriodRange[]> {
    const { companyId } = await this.resolveFarm(queryFarmId, tenantId, userType);
    return this.loadPeriods(companyId, tenantId);
  }

  /**
   * The company's own active reporting periods by start date (D20). Ruling M5:
   * the company's rows only — never a tenant-template (company NULL) row, the
   * same line the Reporting Period Master's own company scope draws, so the
   * report can never cut by a calendar the company's master screen does not show.
   */
  private async loadPeriods(companyId: string, tenantId: string): Promise<PeriodRange[]> {
    const P = schema.reportingPeriod;
    const rows = await this.db
      .select({
        period_id: P.period_id,
        period_code: P.period_code,
        start_date: P.start_date,
        end_date: P.end_date,
        stock_take_date: P.stock_take_date,
        production_start_date: P.production_start_date,
      })
      .from(P)
      .where(and(eq(P.tenant_id, tenantId), eq(P.company_id, companyId), eq(P.is_active, true), isNull(P.deleted_at)))
      .orderBy(P.start_date);
    return rows.map((r) => ({
      periodId: r.period_id,
      periodCode: r.period_code,
      startDate: r.start_date,
      endDate: r.end_date,
      stockTakeDate: r.stock_take_date,
      productionStartDate: r.production_start_date,
    }));
  }

  /**
   * GET /feed-forecast/farms (review A2, A5): the farms the feed screens may
   * offer this caller, by the rules resolveFarm applies — so the picker never
   * lists a farm the report would then refuse, and never hides one it would
   * open. A tenant admin in the tenant-wide workspace (no company pinned) gets
   * every active farm of the tenant, which is what resolveFarm's
   * activeFarmOfTenant already allowed; the location list the screens used
   * before answered [] there. Sorted by code, the order the farms are known by.
   */
  /** The same farms GET /feed-forecast/farms offers, each with its farm override row's values (null = inherits the company). */
  async listFarmSettings(tenantId: string, userType: string | undefined): Promise<FeedFarmSettingsRow[]> {
    const L = schema.locationMaster;
    const conditions = this.farmListConditions(tenantId, userType);
    if (!conditions) return [];
    const rows = await this.db
      .select({
        farm_id: L.location_id,
        code: L.location_code,
        name: L.location_name,
        company_id: L.company_id,
        company_name: schema.companyMaster.company_name,
      })
      .from(L)
      .leftJoin(schema.companyMaster, eq(schema.companyMaster.company_id, L.company_id))
      .where(and(...conditions))
      .orderBy(L.location_code);
    // D41: every silo of these farms, in one read, then grouped per farm.
    const silosByFarm = await this.siloPlanningRows(rows.map((r) => r.farm_id), tenantId);
    const overrides = await this.farmOverrideRows(rows.map((r) => r.farm_id));
    return rows.map((r) => ({
      farmId: r.farm_id,
      code: r.code,
      name: r.name,
      companyId: r.company_id as string,
      companyName: r.company_name ?? null,
      silos: silosByFarm.get(r.farm_id) ?? [],
      settings: overrides.get(r.farm_id) ?? { safetyStockKg: null, bagSizeKg: null, bulkMultipleKg: null, truckTargetKg: null, productionWeekday: null },
    }));
  }

  /** The active farm-scope feed_planning_setting rows of these farms, as override values (null = inherit). */
  private async farmOverrideRows(farmIds: string[]): Promise<Map<string, FeedFarmSettings>> {
    const byFarm = new Map<string, FeedFarmSettings>();
    if (!farmIds.length) return byFarm;
    const S = schema.feedPlanningSetting;
    const rows = await this.db.select({
      farm_id: S.farm_id,
      safety_stock_kg: S.safety_stock_kg,
      bag_size_kg: S.bag_size_kg,
      bulk_multiple_kg: S.bulk_multiple_kg,
      truck_target_kg: S.truck_target_kg,
      production_weekday: S.production_weekday,
    }).from(S).where(and(inArray(S.farm_id, farmIds), eq(S.is_active, true)));
    const num = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
    for (const r of rows) {
      if (!r.farm_id) continue;
      byFarm.set(r.farm_id, {
        safetyStockKg: num(r.safety_stock_kg), bagSizeKg: num(r.bag_size_kg), bulkMultipleKg: num(r.bulk_multiple_kg),
        truckTargetKg: num(r.truck_target_kg), productionWeekday: r.production_weekday ?? null,
      });
    }
    return byFarm;
  }

  /**
   * D41: the silos of these farms, in code order, each with what it is holding
   * now. One location read and one balance read per silo (SiloFeedService), so a
   * farm with no silo costs nothing.
   */
  private async siloPlanningRows(farmIds: string[], tenantId: string): Promise<Map<string, FeedPlanningSilo[]>> {
    const byFarm = new Map<string, FeedPlanningSilo[]>();
    if (!farmIds.length) return byFarm;
    const L = schema.locationMaster;
    const rows = await this.db
      .select({
        location_id: L.location_id,
        farm_id: L.farm_id,
        company_id: L.company_id,
        location_code: L.location_code,
        location_name: L.location_name,
        feed_in_bags: L.feed_in_bags,
        silo_capacity_kg: L.silo_capacity_kg,
        low_level_kg: L.low_level_kg,
        high_level_kg: L.high_level_kg,
        status: L.status,
      })
      .from(L)
      .where(and(
        eq(L.tenant_id, tenantId),
        eq(L.location_type, 'SILO'),
        inArray(L.farm_id, farmIds),
        eq(L.is_active, true),
        isNull(L.deleted_at),
      ))
      .orderBy(L.location_code);
    if (!rows.length) return byFarm;

    const Shed = alias(schema.locationMaster, 'feed_planning_shed') as unknown as typeof schema.locationMaster;
    const shedLinks = await this.db
      .select({
        silo_id: schema.siloShedLink.silo_id,
        shed_id: Shed.location_id,
        shed_code: Shed.location_code,
        shed_name: Shed.location_name,
      })
      .from(schema.siloShedLink)
      .innerJoin(Shed, eq(Shed.location_id, schema.siloShedLink.shed_id))
      .where(and(
        eq(schema.siloShedLink.tenant_id, tenantId),
        inArray(schema.siloShedLink.silo_id, rows.map((row) => row.location_id)),
        eq(Shed.location_type, 'SHED'),
        eq(Shed.is_active, true),
        isNull(Shed.deleted_at),
      ))
      .orderBy(Shed.location_code);
    const shedsBySilo = new Map<string, Array<{ locationId: string; code: string; name: string }>>();
    for (const link of shedLinks) {
      const linkedShed = { locationId: link.shed_id, code: link.shed_code, name: link.shed_name };
      shedsBySilo.set(link.silo_id, [...(shedsBySilo.get(link.silo_id) ?? []), linkedShed]);
    }

    // The feed held, per company, only for the silos there are.
    const held = new Map<string, { item_code: string; item_description: string | null } | null>();
    const byCompany = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.company_id) continue;
      byCompany.set(row.company_id, [...(byCompany.get(row.company_id) ?? []), row.location_id]);
    }
    for (const [companyId, siloIds] of byCompany) {
      const items = await this.siloFeedService.currentItems(siloIds, companyId, tenantId);
      for (const [siloId, item] of items) held.set(siloId, item);
    }

    const num = (v: unknown) => (v == null ? null : Number(v));
    for (const row of rows) {
      const current = held.get(row.location_id) ?? null;
      const silo: FeedPlanningSilo = {
        locationId: row.location_id,
        code: row.location_code,
        name: row.location_name,
        linkedSheds: shedsBySilo.get(row.location_id) ?? [],
        // Match the established feed-requisition rule: only explicit true is bagged;
        // a physical silo with the older nullable field unset remains bulk.
        feedType: row.feed_in_bags === true ? 'BAGGED' : 'BULK',
        feedItemCode: current?.item_code ?? null,
        feedItemName: current?.item_description ?? null,
        capacityKg: num(row.silo_capacity_kg),
        lowLevelKg: num(row.low_level_kg),
        highLevelKg: num(row.high_level_kg),
        status: row.status,
      };
      const key = row.farm_id as string;
      byFarm.set(key, [...(byFarm.get(key) ?? []), silo]);
    }
    return byFarm;
  }

  /**
   * D41: a silo's feed levels, edited from Silo Feed Setup. It writes only
   * those two columns, and it applies the SAME rules the silo form applies
   * (silo-feed/silo-levels.ts) — a value sent alone is judged against the one
   * already stored, so the pair is never checked by halves.
   *
   * Task 4 (3 Oct ruling): this endpoint no longer writes silo_reorder_days —
   * the forecast does not read it (engine.ts, Task 3). The column stays on
   * location_master, and Location Master's own generic form still edits it
   * (spec R6).
   */
  async updateSiloSettings(
    farmIdIn: string,
    siloId: string,
    dto: UpdateSiloPlanningDto,
    tenantId: string,
    user: { userId?: string; userType?: string } | undefined,
  ) {
    const { farmId, companyId } = await this.resolveFarm(farmIdIn, tenantId, user?.userType);
    const L = schema.locationMaster;
    const [silo] = await this.db
      .select({
        location_id: L.location_id,
        company_id: L.company_id,
        farm_id: L.farm_id,
        location_type: L.location_type,
        location_code: L.location_code,
        silo_capacity_kg: L.silo_capacity_kg,
        low_level_kg: L.low_level_kg,
        high_level_kg: L.high_level_kg,
        feed_in_bags: L.feed_in_bags,
      })
      .from(L)
      .where(and(eq(L.location_id, siloId), eq(L.tenant_id, tenantId), isNull(L.deleted_at)))
      .limit(1);
    // Fails closed on every mismatch: the wrong farm, the wrong company, or a
    // location that is not a silo all answer the same "not found".
    if (!silo || silo.location_type !== 'SILO' || silo.farm_id !== farmId || silo.company_id !== companyId) {
      throw new NotFoundException('Silo not found on this farm.');
    }

    const num = (v: unknown) => (v == null ? null : Number(v));
    const updates: Record<string, number | null | boolean> = {};
    if (dto.low_level_kg !== undefined) updates.low_level_kg = dto.low_level_kg;
    if (dto.high_level_kg !== undefined) updates.high_level_kg = dto.high_level_kg;
    // Feed Type (workbook row 15): BULK or BAGGED, stored as feed_in_bags.
    if (dto.feedType !== undefined) {
      if (dto.feedType !== 'BULK' && dto.feedType !== 'BAGGED') throw new BadRequestException('Feed Type must be BULK or BAGGED.');
      updates.feed_in_bags = dto.feedType === 'BAGGED';
    }
    if (!Object.keys(updates).length) throw new BadRequestException('Send at least one silo setting to change.');

    // The pair as it would stand after this change, against the silo's capacity.
    const effectiveLow = dto.low_level_kg !== undefined ? dto.low_level_kg : num(silo.low_level_kg);
    const effectiveHigh = dto.high_level_kg !== undefined ? dto.high_level_kg : num(silo.high_level_kg);
    assertSiloLevels(effectiveLow, effectiveHigh, num(silo.silo_capacity_kg));

    await this.db.update(L).set({ ...updates, updated_by: user?.userId ?? null }).where(eq(L.location_id, siloId));
    await this.auditService.log({
      tenantId,
      companyId,
      userId: user?.userId,
      action: 'UPDATE',
      entityName: 'location_master',
      entityId: siloId,
      oldValues: {
        low_level_kg: num(silo.low_level_kg),
        high_level_kg: num(silo.high_level_kg),
        feedType: silo.feed_in_bags === true ? 'BAGGED' : 'BULK',
      },
      newValues: { ...updates, ...(dto.feedType !== undefined ? { feedType: dto.feedType } : {}) },
    });
    return { farmId, siloId, code: silo.location_code, settings: updates };
  }

  /**
   * Which farms this caller may be offered, as WHERE conditions — null when the
   * answer is "none at all". Shared by GET /feed-forecast/farms and D32's
   * farm-settings list so the two can never disagree about whose farms a user
   * sees.
   */
  private farmListConditions(tenantId: string, userType: string | undefined): SQL[] | null {
    const scope = farmScope(this.cls);
    const L = schema.locationMaster;
    const conditions: SQL[] = [
      eq(L.tenant_id, tenantId),
      eq(L.location_type, 'FARM'),
      isNull(L.parent_location_id),
      eq(L.is_active, true),
      isNull(L.deleted_at),
    ];
    if (isFarmBoundUserType(userType)) {
      if (!scope.farmId) return null;
      conditions.push(eq(L.location_id, scope.farmId));
      if (scope.companyId) conditions.push(eq(L.company_id, scope.companyId));
    } else if (scope.companyId) {
      conditions.push(eq(L.company_id, scope.companyId));
      if (scope.restricted && scope.lobId) conditions.push(eq(L.lob_id, scope.lobId));
    } else if (userType !== 'TENANT_ADMIN' && userType !== 'SYSTEM_ADMIN') {
      return null;
    }
    return conditions;
  }

  async listFarms(tenantId: string, userType: string | undefined): Promise<FeedFarmOption[]> {
    const L = schema.locationMaster;
    const conditions = this.farmListConditions(tenantId, userType);
    if (!conditions) return [];
    const rows = await this.db
      .select({
        farm_id: L.location_id,
        code: L.location_code,
        name: L.location_name,
        company_id: L.company_id,
        company_name: schema.companyMaster.company_name,
      })
      .from(L)
      .leftJoin(schema.companyMaster, eq(schema.companyMaster.company_id, L.company_id))
      .where(and(...conditions))
      .orderBy(L.location_code);
    return rows.map((r) => ({
      farmId: r.farm_id,
      code: r.code,
      name: r.name,
      companyId: r.company_id as string,
      companyName: r.company_name ?? null,
    }));
  }

  /**
   * Which farm a caller may be answered for (D13 and fix rounds 1–2) — shared
   * by the report, the feed alerts and the feed requisitions so the three can
   * never disagree about whose farm a user may see.
   *
   * `userType` is required (fix round 1, security): the endpoint used to
   * treat a missing/unknown type as STANDARD_USER, which is the *more*
   * restrictive branch — safe there, but a caller that meant to be an admin
   * and mistakenly sent no type would have been silently bound to whatever
   * farm happened to be pinned. Every caller now states its type; only the
   * literal string `'STANDARD_USER'` takes that branch, and anything else
   * (unset, unknown, or a real admin type) takes the company/LOB-checked one
   * below, which fails closed with no exceptions carved out.
   */
  async resolveFarm(queryFarmId: string | undefined, tenantId: string, userType: string | undefined): Promise<ResolvedFarm> {
    const query = { farmId: queryFarmId };
    const scope = farmScope(this.cls);
    // Ruling (Task 1): only farm-bound personas are farm-bound for this
    // endpoint. They keep D13 — a request naming another farm
    // answers NotFound, not Forbidden, so the endpoint does not confirm that
    // farm exists. Every other user type may ask for any active farm of
    // their company (LOB-checked for OPERATIONAL_ADMIN); the query farmId
    // wins over whatever the workspace switcher has pinned in the header, so
    // an admin can switch farms on this page without re-pinning first.
    const isFarmBoundUser = isFarmBoundUserType(userType);
    let farmId: string | undefined;
    // The company that validated the chosen farm — normally scope.companyId,
    // but a TENANT_ADMIN/SYSTEM_ADMIN in tenant-wide scope (no company
    // pinned) has none, so it is resolved from the farm itself (fix round 2,
    // finding 2).
    let effectiveCompanyId = scope.companyId;
    if (isFarmBoundUser) {
      // The guard always pins a farm for a farm-bound persona — a scope with
      // none is a malformed session, not an
      // unrestricted one, so it must not fall through to an unchecked query
      // farm.
      if (!scope.farmId) throw new NotFoundException('Farm not found.');
      if (query.farmId && query.farmId !== scope.farmId) {
        throw new NotFoundException('Farm not found.');
      }
      farmId = scope.farmId;
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
    // Fix round 1 (security): fail closed here rather than a second,
    // unbounded tenant-wide lookup. Only the explicit TENANT_ADMIN/
    // SYSTEM_ADMIN-with-no-company branch above may resolve a company from
    // the farm itself; every other path must already have one.
    if (!effectiveCompanyId) throw new NotFoundException('Farm not found.');
    return { farmId, companyId: effectiveCompanyId };
  }

  /**
   * Today in the farm's time zone (D16, open question Q14). A farm row carries
   * no zone, so the company's default_timezone_id is the one on record —
   * Africa/Harare for Triple C. The column is a free varchar with no foreign
   * key, so a value the runtime does not know as an IANA zone is tried as a
   * timezone_master id before giving up. No usable zone → the server's day,
   * which is what the forecast used before, and timeZone null says so.
   */
  async farmToday(companyId: string, tenantId: string, nowMs: number = Date.now()): Promise<FarmClock> {
    const [company] = await this.db
      .select({ zone: schema.companyMaster.default_timezone_id })
      .from(schema.companyMaster)
      .where(and(eq(schema.companyMaster.company_id, companyId), eq(schema.companyMaster.tenant_id, tenantId)))
      .limit(1);
    let zone: string | null = company?.zone ?? null;
    if (zone && !isTimeZone(zone)) {
      const [tz] = await this.db
        .select({ code: schema.timezoneMaster.tz_code })
        .from(schema.timezoneMaster)
        .where(eq(schema.timezoneMaster.tz_id, zone))
        .limit(1);
      zone = tz?.code && isTimeZone(tz.code) ? tz.code : null;
    }
    return { today: todayInZone(zone, nowMs), timeZone: zone };
  }

  /**
   * The forecast for a farm already resolved — callers pass exactly the
   * `{ farmId, companyId }` pair `resolveFarm` produced (or, from a posting
   * hook, a farm/company already known from the location that was posted).
   * No user checks here — that is resolveFarm's job, done once. This method
   * validates the range itself (fix round 1: it used to be getForecast's job,
   * done before resolveFarm — a trusted internal caller going straight to
   * computeForFarm would then have had no bound on the span at all) so every
   * caller, HTTP or internal, is held to the same 45-day cap. from/to default
   * as the report does.
   *
   * Plan R: the planning date may be chosen (±45 days of the farm's today, Q8);
   * stock is read as of the stock date — the planning date, or today when
   * planning ahead, the days in between being walked (D19); the run-down may be
   * looked for up to `horizonTo`, capped at 45 days past the planning date and
   * never before `to` (Q12). A caller that has already read the farm's day
   * passes it as `clock`, so one evaluation never reads the zone twice.
   */
  async computeForFarm(
    farmId: string,
    companyId: string,
    tenantId: string,
    range: { from?: string; to?: string; planningDate?: string; horizonTo?: string } = {},
    clock?: FarmClock,
  ): Promise<FeedForecastResponse> {
    const { today, timeZone } = clock ?? (await this.farmToday(companyId, tenantId));
    const planningDate = range.planningDate ?? today;
    if (!isCalendarDay(planningDate)) throw new BadRequestException('planningDate must be a calendar date (YYYY-MM-DD).');
    const dateProblem = planningDateProblem(today, planningDate);
    if (dateProblem) throw new BadRequestException(dateProblem);
    const from = range.from ?? planningDate;
    const to = range.to ?? defaultWindowEnd(from);
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    }
    const span = spanProblem(from, to);
    if (span) throw new BadRequestException(span);
    // A horizon that is sent must be a real day, like the other dates: silently falling back to `to` would hide the
    // run-down the caller asked to see (fix round 1). Only its size is clamped below — that is Q12's rule, not an error.
    if (range.horizonTo !== undefined && !isCalendarDay(range.horizonTo)) {
      throw new BadRequestException('horizonTo must be a calendar date (YYYY-MM-DD).');
    }
    // Held here, not in getForecast, so the alert and requisition callers are bound by the reach too (follow-up).
    const reachError = reachProblem(planningDate, to, range.to !== undefined);
    if (reachError) throw new BadRequestException(reachError);
    const cap = addDays(planningDate, MAX_SPAN_DAYS);
    const wanted = range.horizonTo ?? to;
    const capped = wanted < cap ? wanted : cap;
    const horizonTo = capped > to ? capped : to;
    const stockDate = planningDate < today ? planningDate : today;
    // Ruling I1: scheduler headers are today's register — see buildInputBatches.
    const headerCutoff = planningDate > today ? planningDate : today;
    return this.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, tenantId);
      // Task 4 / Task 2: safety stock (and the two other draft-rounding
      // settings the report carries) come from the company/farm's configured
      // planning settings now, never from the farm's own lead-time column.
      // Important 4 (fix round 2): resolved through resolveForFeedPlanning, not
      // directly — see FeedSettingsService.resolveForFeedPlanning for why.
      const resolvedSettings = await this.feedSettings.resolveForFeedPlanning(companyId, farmId);
      const { input: loadedInput, flags: loadFlags, stageBlocks } = await this.loadInput(farm, planningDate, from, to, tenantId, { stockDate, horizonTo, headerCutoff });
      const input: ForecastInput = { ...loadedInput, safetyStockKg: resolvedSettings.safetyStockKg };
      const { rows, flags, sources, dietChanges, daily } = buildFeedForecast(input);
      const sourceSnapshot = buildSourceSnapshot({ engineInput: input });
      const asOf: ForecastFlag[] = planningDate < today ? [{ kind: 'AS_OF_PAST', planningDate, today, note: asOfPastNote(planningDate, today) }] : [];
      return {
        planningDate, today, timeZone, from, to, horizonTo,
        farm: { id: farm.id, code: farm.code, name: farm.name },
        settings: {
          safetyStockKg: resolvedSettings.safetyStockKg,
          bulkMultipleKg: resolvedSettings.bulkMultipleKg,
          bagSizeKg: resolvedSettings.bagSizeKg,
        },
        rows, daily, flags: [...flags, ...loadFlags, ...asOf], sources, dietChanges,
        stages: stageBlocks, sourceSnapshot,
      };
    });
  }

  /**
   * Silo dashboard (TDD Engine §4 rows 47–64, Master Setup §1): one row per silo
   * with the workbook's derived fields, from a seven-day forecast starting at
   * the planning date. Same farm resolution and 45-day planning-date bound as
   * the forecast itself; the engine is run once, through computeForFarm.
   */
  async siloStatus(
    query: { farmId?: string; planningDate?: string },
    tenantId: string,
    userType?: string,
  ): Promise<{ planningDate: string; farm: { id: string; code: string; name: string }; submissionDeadline: string; itemNames: Record<string, string>; rows: SiloStatusRow[] }> {
    const { farmId, companyId } = await this.resolveFarm(query.farmId, tenantId, userType);
    if (query.planningDate !== undefined && !isCalendarDay(query.planningDate)) {
      throw new BadRequestException('planningDate must be a calendar date (YYYY-MM-DD).');
    }
    const clock = await this.farmToday(companyId, tenantId);
    const planningDate = query.planningDate ?? clock.today;
    const to = defaultWindowEnd(planningDate);
    const settings = toFarmFeedSettings(await this.feedSettings.resolveForFeedPlanning(companyId, farmId));
    const { submissionDeadline } = productionCycle(planningDate, settings.productionWeekday);
    return this.withFarmScope(farmId, companyId, async () => {
      // 9d F1: the window stays seven days (Projected Need, the shortfall and the recommended order are the
      // week's), but the first shortage date is "determined from the dated item level projection" (Dashboard row
      // 55 / Master Setup row 15) with no window limit — so the run-down is searched over the forecast's own
      // standard horizon, exactly as the grid does. Without this the dashboard left First Shortage Date blank for
      // a shortage 8-45 days out while the grid showed its date (pass 2: RIC100/SILO-002, LEX100/SILO-001).
      const forecast = await this.computeForFarm(
        farmId, companyId, tenantId, { planningDate, from: planningDate, to, horizonTo: forecastHorizon(planningDate) }, clock,
      );
      const silos = await this.loadSiloFacts(farmId, companyId, tenantId);
      const requisitionStatusBySilo = await this.loadLatestRequisitionStatuses(farmId, tenantId, submissionDeadline);
      const rows = buildSiloStatus({ silos, result: forecast, requisitionStatusBySilo, submissionDeadline, settings });
      // Names for the diet columns, which the rows carry as ids.
      const itemNames: Record<string, string> = {};
      for (const source of forecast.sources) itemNames[source.itemId] = source.itemName;
      for (const change of forecast.dietChanges) {
        itemNames[change.fromItemId] ??= change.fromItemName;
        itemNames[change.toItemId] ??= change.toItemName;
      }
      return { planningDate, farm: forecast.farm, submissionDeadline, itemNames, rows };
    });
  }

  /**
   * The silo facts the dashboard shows that the engine does not carry: Feed in
   * Silo is the item of the last posted inbound ledger movement into the silo
   * (Master Setup row 16); System Balance is that item's ledger balance now;
   * the last approved count is the latest POSTED stock count line.
   */
  private async loadSiloFacts(farmId: string, companyId: string, tenantId: string): Promise<SiloFact[]> {
    // Engine §1 row 8: only ACTIVE silos are planned; location_master.status is ACTIVE or INACTIVE.
    const planning = ((await this.siloPlanningRows([farmId], tenantId)).get(farmId) ?? []).filter((s) => s.status === 'ACTIVE');
    if (!planning.length) return [];
    const siloIds = planning.map((s) => s.locationId);

    const Count = schema.feedStockCount;
    const Line = schema.feedStockCountLine;
    const counts = await this.db
      .select({ silo_id: Line.silo_id, item_id: Line.item_id, counted_qty_kg: Line.counted_qty_kg, counted_at: Count.counted_at })
      .from(Line)
      .innerJoin(Count, eq(Count.count_id, Line.count_id))
      .where(and(eq(Count.tenant_id, tenantId), eq(Count.farm_id, farmId), eq(Count.status, 'POSTED'), inArray(Line.silo_id, siloIds)))
      .orderBy(sql`${Count.counted_at} DESC`);

    const Ledger = schema.inventoryLedger;
    const facts: SiloFact[] = [];
    for (const silo of planning) {
      // Master Setup row 16: the last genuine receipt (purchase or transfer in), newest first, one row.
      // Variances and reversals are not receipts, and neither is a receipt a REVERSAL row points back at.
      const [last = null] = await this.db
        .select({ item_id: Ledger.item_id, item_description: Ledger.item_description, posting_date: Ledger.posting_date })
        .from(Ledger)
        .where(and(
          eq(Ledger.tenant_id, tenantId), eq(Ledger.company_id, companyId), eq(Ledger.warehouse_id, silo.locationId),
          eq(Ledger.entry_type, 'POSITIVE'), inArray(Ledger.transaction_type, [...SILO_RECEIPT_TRANSACTION_TYPES]), gt(Ledger.quantity, '0'),
          sql`NOT EXISTS (SELECT 1 FROM ${schema.inventoryLedger} AS feed_receipt_reversal WHERE feed_receipt_reversal.external_reference_no = ${Ledger.ledger_id} AND feed_receipt_reversal.transaction_type = 'REVERSAL')`,
        ))
        .orderBy(sql`${Ledger.posting_date} DESC`, sql`${Ledger.created_at} DESC`)
        .limit(1);
      const itemId = last?.item_id ?? null;
      const balances = itemId
        ? (await this.ledgerService.getStockBalance({ companyId, warehouseId: silo.locationId } as any, tenantId)).filter((b) => b.item_id === itemId)
        : [];
      // Bags are never added to kilograms (silo-feed.service.ts); the dashboard flags the silo instead of refusing.
      const onHand = balances.filter((b) => b.uom === 'KG').reduce((sum, b) => sum + Number(b.on_hand_qty), 0);
      const count = counts.find((c) => c.silo_id === silo.locationId && (itemId === null || c.item_id === itemId)) ?? null;
      facts.push({
        siloId: silo.locationId,
        siloCode: silo.code,
        houseCodes: silo.linkedSheds.map((shed) => shed.code),
        capacityKg: silo.capacityKg,
        belowFeedLevelKg: silo.lowLevelKg,
        aboveThresholdKg: silo.highLevelKg,
        feedInSiloItemId: itemId,
        feedInSiloItemName: last?.item_description ?? null,
        feedType: silo.feedType,
        systemBalanceKg: Math.round(onHand * 1000) / 1000,
        lastApprovedCountKg: count ? Number(count.counted_qty_kg) : null,
        lastApprovedCountAt: count?.counted_at ?? null,
        lastFeedReceiptDate: last?.posting_date ?? null,
        nonKgBalance: balances.some((b) => b.uom !== 'KG' && Math.abs(Number(b.on_hand_qty)) > 0.0001),
      });
    }
    return facts;
  }

  /** The cycle's feed requisition covering each silo: the latest created one, rejected and cancelled excluded. */
  private async loadLatestRequisitionStatuses(farmId: string, tenantId: string, submissionDeadline: string): Promise<Map<string, string>> {
    const R = schema.requisition;
    const RL = schema.requisitionLine;
    const rows = await this.db
      .select({ destination: RL.destination_location_id, status: R.status, created_at: R.created_at })
      .from(RL)
      .innerJoin(R, eq(R.requisition_id, RL.requisition_id))
      .where(and(
        eq(R.tenant_id, tenantId), eq(R.farm_id, farmId), eq(R.doc_type, 'FEED'),
        eq(R.submission_deadline, submissionDeadline), notInArray(R.status, ['REJECTED', 'CANCELLED']), isNull(R.deleted_at),
      ));
    const latest = new Map<string, { status: string; createdMs: number }>();
    for (const row of rows) {
      if (!row.destination) continue;
      const seen = latest.get(row.destination);
      const createdMs = new Date(row.created_at as unknown as string | Date).getTime();
      if (!seen || createdMs > seen.createdMs) latest.set(row.destination, { status: row.status, createdMs });
    }
    return new Map([...latest].map(([silo, v]) => [silo, v.status]));
  }

  /**
   * Runs `work` with the CLS farm scope replaced by this farm (fix round 2,
   * finding 1: InventoryLedgerService reads farmScope(cls) itself — here
   * through getFeedStockAsOf, and SiloFeedService through getStockBalance for
   * the alert evaluator). Public so the alert evaluator and the requisition
   * read silo balances under the same farm.
   *
   * Every loader below must see the farm actually being reported on, not
   * whatever farm happens to be pinned in the header — otherwise an admin
   * switching farms through `farmId` would have their loaders silently
   * filtered back down to the pinned farm (or, worse, another company's).
   * Fix round 2, finding 1: this must replace the CLS-held scope itself
   * (`this.cls.set`), not just a value threaded through the caller's own
   * loaders — InventoryLedgerService (getFeedStockAsOf, the forecast's stock
   * read; getStockBalance, reached through SiloFeedService by the alerts)
   * applies farmScope(cls) independently in its own queries, and never saw the
   * effective farm before this fix. `cls.set` needs an active
   * CLS context, so this runs `work` inside `cls.run()` — the same idiom
   * withTenantTransaction uses (tenant-transaction.ts) to open one when it
   * isn't already inside one; nested inside a real request it inherits the
   * guard's own context (tenantDb, tenantId, ...) and only farmScope is
   * overridden within it.
   */
  async withFarmScope<T>(farmId: string, companyId: string, work: () => Promise<T>): Promise<T> {
    const effectiveScope: FarmScope = { ...farmScope(this.cls), farmId, companyId };
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, effectiveScope);
      return work();
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
    };
  }

  private async loadInput(
    farm: ForecastFarm,
    planningDate: string,
    from: string,
    to: string,
    tenantId: string,
    opts: { stockDate: string; horizonTo: string; headerCutoff: string },
  ): Promise<{ input: ForecastInput; flags: ForecastFlag[]; stageBlocks: StageBlock[] }> {
    const companyId = farm.companyId;
    // computeForFarm has already replaced the CLS scope with the effective one
    // (fix round 2, finding 1) — every read below, direct or through the
    // ledger service, sees the chosen farm this way.
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
        low_level_kg: schema.locationMaster.low_level_kg,
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

    // Stages are projected to the run-down horizon, so a stage change just past `to` still moves the run-down (Q12).
    const { batches, flags, stages } = await this.loadBatches(farm, planningDate, opts.horizonTo, opts.headerCutoff, tenantId, locationById, new Set(shedIds));
    const feedRows = await this.loadFeedRows([...new Set(batches.map((b) => b.breedId))], companyId, tenantId);

    // The farm's STORE (D6 fallback). One per farm in every template; if a farm
    // somehow has two, the first by code is used — the forecast needs one pool.
    const storeRow = activeOfType('STORE')[0];
    const stockIds = [...linkedSiloIds, ...(storeRow ? [storeRow.location_id] : [])];
    // Q6 / D19: the opening is the ledger strictly before the stock date; posted
    // non-feeding movements from it on, and DRAFT transfers inside the walk,
    // are incoming (Ruling on Task 6's carry). Feeding is left to the engine.
    const ledger = stockIds.length
      ? await this.ledgerService.getFeedStockAsOf({ companyId, warehouseIds: stockIds, stockDate: opts.stockDate, horizonTo: opts.horizonTo }, tenantId)
      : { opening: [], movements: [] };
    const drafts = stockIds.length ? await this.loadDraftTransfers(stockIds, companyId, tenantId, opts.stockDate, opts.horizonTo) : [];
    const stock = stockAsOf({
      silos: siloRows
        .filter((s) => linkedSiloIds.includes(s.location_id))
        .map((s) => ({
          siloId: s.location_id,
          siloCode: s.location_code,
          lowLevelKg: s.low_level_kg == null ? null : Number(s.low_level_kg),
        })),
      store: storeRow ? { storeId: storeRow.location_id, storeCode: storeRow.location_code } : null,
      feedItemIds: new Set(feedRows.map((r) => r.itemId)),
      opening: ledger.opening,
      movements: ledger.movements,
      drafts,
    });

    const itemIds = new Set<string>(feedRows.map((r) => r.itemId));
    for (const s of stock.silos) if (s.itemId) itemIds.add(s.itemId);
    const items: Record<string, string> = {};
    const itemCodes: Record<string, string> = {};
    if (itemIds.size) {
      const itemRows = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, item_code: schema.itemMaster.item_code })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, [...itemIds])));
      for (const i of itemRows) {
        items[i.item_id] = i.item_name;
        itemCodes[i.item_id] = i.item_code; // Item No (D16)
      }
    }

    const stageBlocks = stageBlocksFor(batches, stages, new Map(shedRows.map((s) => [s.location_id, s.location_code])), planningDate);

    return {
      input: {
        planningDate,
        from,
        to,
        stockDate: opts.stockDate,
        horizonTo: opts.horizonTo,
        sheds,
        silos: stock.silos,
        store: stock.store,
        incoming: stock.incoming,
        items,
        itemCodes,
        batches,
        feedRows,
      },
      flags,
      stageBlocks,
    };
  }

  /**
   * D19 "confirmed incoming", part (b) of open question Q2: stock transfers
   * saved but not yet posted, dated inside the walk. Nothing in NAVFarm is in
   * transit — a transfer posts both sides at once (stock-transfer.service
   * post()) — so a dated DRAFT is the only booked-but-not-arrived feed until
   * Plan C's Transfer Orders. Into one of the farm's silos or its store it is
   * incoming; out of one it is negative, so a store-to-silo transfer is not
   * counted in both places. A POSTED transfer is already among the ledger
   * movements, so it is never counted here as well.
   *
   * Bounded like the ledger read it sits beside (Ruling M2): the locations are
   * already the effective farm's (and, for a restricted caller, its LOB's or
   * LOB-less), a transfer has no LOB of its own, so the caller's LOB is held
   * against the item's — the same column a ledger row's lob_id is copied from.
   */
  private async loadDraftTransfers(
    locationIds: string[],
    companyId: string,
    tenantId: string,
    stockDate: string,
    horizonTo: string,
  ): Promise<FeedStockMovement[]> {
    const T = schema.stockTransfer;
    const TL = schema.stockTransferLine;
    const common = [
      eq(T.tenant_id, tenantId),
      eq(T.company_id, companyId),
      eq(T.status, 'DRAFT'),
      isNull(T.deleted_at),
      gte(T.posting_date, stockDate),
      lte(T.posting_date, horizonTo),
      ...restrictedScopeConditions(farmScope(this.cls), { companyId: T.company_id, lobId: schema.itemMaster.lob_id }),
    ];
    const qty = sql<string>`COALESCE(SUM(${TL.quantity}), 0)`;
    const into = await this.db
      .select({ warehouse_id: T.to_warehouse_id, item_id: TL.item_id, item_code: schema.itemMaster.item_code, uom: TL.uom, posting_date: T.posting_date, qty })
      .from(T)
      .innerJoin(TL, eq(TL.transfer_id, T.transfer_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, TL.item_id))
      .where(and(...common, inArray(T.to_warehouse_id, locationIds)))
      .groupBy(T.to_warehouse_id, TL.item_id, schema.itemMaster.item_code, TL.uom, T.posting_date);
    const out = await this.db
      .select({ warehouse_id: T.from_warehouse_id, item_id: TL.item_id, item_code: schema.itemMaster.item_code, uom: TL.uom, posting_date: T.posting_date, qty })
      .from(T)
      .innerJoin(TL, eq(TL.transfer_id, T.transfer_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, TL.item_id))
      .where(and(...common, inArray(T.from_warehouse_id, locationIds)))
      .groupBy(T.from_warehouse_id, TL.item_id, schema.itemMaster.item_code, TL.uom, T.posting_date);
    return [
      ...into.map((r) => ({ warehouse_id: r.warehouse_id, item_id: r.item_id, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: Number(r.qty) })),
      ...out.map((r) => ({ warehouse_id: r.warehouse_id, item_id: r.item_id, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: -Number(r.qty) })),
    ];
  }

  /** Reads the ACTIVE batches of the farm and everything buildInputBatches needs to place them. */
  private async loadBatches(
    farm: ForecastFarm,
    planningDate: string,
    horizonTo: string,
    headerCutoff: string,
    tenantId: string,
    locationById: Map<string, LocationNode>,
    activeShedIds: Set<string>,
  ): Promise<{ batches: InputBatch[]; flags: ForecastFlag[]; stages: Map<string, StageInfo> }> {
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
    if (!fed.length) return { batches: [], flags: [], stages: new Map() };
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
        min_days_before_move: schema.stageMaster.min_days_before_move,
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
          minDays: s.min_days_before_move,
          nextStageId: s.next_stage_id,
          isActive: s.is_active,
        },
      ]),
    );

    // Stage Master is returned as well: the stage block dates the current and next stage from it.
    return { ...buildInputBatches({ batchRows: fed, animalGroups, headers, stages, locationById, activeShedIds, planningDate, to: horizonTo, headerCutoff }), stages };
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

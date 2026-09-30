/**
 * Pure feed-forecast engine (Task 6 of the Feed Forecast Plan A design,
 * docs/superpowers/specs/2026-09-25-feed-forecast-design.md, D1-D20). No DB,
 * no Nest — it takes a plain snapshot of sheds/silos/batches/feed rows and
 * returns forecast rows plus data-quality flags. The service layer is
 * responsible for assembling ForecastInput from MySQL and for turning this
 * into the GET /feed-forecast response; this file only does the math, so it
 * can be unit-tested against the workbook's worked example without a
 * database.
 *
 * Ideas that don't fall out of the types by themselves:
 *
 * 1. Balance projection is per (source, item), not per (batch, item) — D9
 *    already guarantees at most one silo per shed holds a given item, but a
 *    single silo can feed several sheds (D7) and the farm STORE is shared by
 *    every shed that falls back to it. So before walking the calendar we
 *    group demand by the physical container ("key" below) and run the
 *    depletion once per container; every row drawing on that container then
 *    reads off the same daysLeft/runDownDate.
 * 2. The balance is a **stock-date snapshot**. Plan A walked from
 *    `planningDate`; Plan R (D16, D19) walks from `stockDate` — the planning
 *    date itself, or today when the planning date is in the future, so the
 *    days in between consume stock without producing rows. Run-down, refill
 *    and required-on are only ever reported on or after the planning date. If
 *    `to` is before planningDate there is nothing to walk and runDownDate is
 *    null. `rangeDemandKg` and `perDayIntakeKg` still describe the requested
 *    `from…to` window.
 * 3. `sourceDailyDemandKg` (used for D1's daysLeft) is the combined demand
 *    on the *planning date specifically* — a diet can start later in the
 *    window (D15), in which case it is legitimately 0 and daysLeft is null.
 * 4. All balance/demand arithmetic is done in integer micrograms
 *    (`Math.round(kg * 1_000_000)`), converted back to kg only for output.
 *    Kg-denominated floats don't divide or subtract exactly in IEEE 754
 *    doubles — `floor(123.6 / 41.2)` can come out 2 instead of 3.
 * 5. Plan B reads `sources` (one entry per physical container and item — the
 *    unit a feed requisition line is drafted for) and `dietChanges` off the
 *    same walk, so the requisition, the alert and the report can never
 *    disagree about demand or dates.
 * 6. D19 (Plan R): each day opens with what the day before left plus what
 *    arrives that day (confirmed incoming), and closes after that day's
 *    demand. A silo cannot go below empty, so demand it cannot meet is not
 *    carried. Run-Down is the first day, on or after the planning date, whose
 *    closing balance is at or below the silo's low level — at or below zero
 *    when none is set (open question Q1). The day must have demand or a
 *    transfer out: a transfer out on a day nobody eats can take the silo to
 *    its low level, and the shortfall it causes must have a run-down and a
 *    Required On — but an empty next-diet silo sitting idle is not run down
 *    until its diet starts, or its requisition would be due today. The run-down may be looked for past
 *    `to` (`horizonTo`) so a one-day view still shows it; everything else
 *    keeps its window.
 * 7. Plan R (D16–D18): `daily` is one row per batch, item and date, read off
 *    the same walk. Its Current Inventory is the container's opening that day
 *    (Ruling M7): what the day before left, plus that day's `incoming` —
 *    which carries posted receipts and posted non-feeding outflows as well as
 *    saved transfers — but not that day's feeding, which is the forecast's
 *    own demand, so a posted daily entry is never subtracted twice.
 */
import { FeedRow, feedRowFor } from '../../production/lifecycle/feed-row-days';

/**
 * D19 "confirmed incoming" into (or, negative, out of) one container, on one day. What counts is the service's rule
 * (Q2): posted non-feeding movements dated on or after the stock date (receipts, transfers, goods issues, adjustments)
 * and saved-but-unposted transfers. Each lands in the opening of its own day, so it is in that day's Current
 * Inventory (Ruling M7); feeding is never passed here — the engine's own demand stands for it.
 */
export interface IncomingFeed {
  locationId: string; // silo_id or the store's location_id
  itemId: string;
  date: string;
  kg: number;
}

/**
 * D38: the standard refill buffer — the field specification's "− 2 days" — used
 * for a store source and for a silo whose Silo Reorder Days was never set.
 */
export const DEFAULT_REFILL_BUFFER_DAYS = 2;

export interface ForecastInput {
  planningDate: string;
  from: string;
  to: string;
  /** Balances below are opening balances of this day (D19). Defaults to planningDate; a later date is ignored. */
  stockDate?: string;
  /** Run-down, refill and required-on are searched up to here (Q12). Defaults to `to`; an earlier date is ignored. */
  horizonTo?: string;
  /**
   * D38 (28 Sep, refines D3): the refill buffer is per SILO now — the silo's
   * own reorderDays below. A store, or a silo without the value, uses
   * DEFAULT_REFILL_BUFFER_DAYS. The farm's feed_refill_buffer_days column is
   * kept but no longer read.
   */
  leadTimeDays: number;
  sheds: { shedId: string; shedCode: string; siloIds: string[] }[];
  silos: {
    siloId: string;
    siloCode: string;
    itemId: string | null;
    balanceKg: number;
    lowLevelKg?: number | null;
    /** D38: location_master.silo_reorder_days — days before run-down this silo must be refilled. */
    reorderDays?: number | null;
  }[];
  store: { storeId: string; storeCode: string; balances: Record<string, number> } | null;
  incoming?: IncomingFeed[];
  items: Record<string, string>; // itemId -> item name
  itemCodes?: Record<string, string>; // itemId -> item code (Item No, D16)
  batches: {
    batchId: string;
    batchNo: string;
    breedId: string;
    shedId: string;
    heads: number;
    segments: {
      stageId: string;
      stageCode: string;
      start: string;
      end: string | null;
      projected: boolean;
      /**
       * D36: the earliest day this segment could end (its stage's
       * min_days_before_move), when the stage is event-based with a window
       * 0 < earliest < latest. Set only on the CURRENT (recorded) segment —
       * a posted move is a fact and its segments carry no window. Rows whose
       * date falls on/after this day and before `end` are indicative.
       */
      changeWindowStart?: string | null;
    }[];
  }[];
  feedRows: FeedRow[];
}

export type ForecastFlag =
  | { kind: 'NO_FEED_ROW'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'OVERLAPPING_FEED_ROWS'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'NO_SILO_HOLDS_ITEM'; shedCode: string; itemName: string }
  | { kind: 'STAGE_CHANGE_PROJECTED'; batchNo: string; stageCode: string; date: string }
  | { kind: 'HEADS_ASSUMED_FLAT'; batchNo: string }
  // Raised by the service, not this engine: the batch's location did not resolve to an active SHED of the farm, so it
  // was passed with no shed and draws on the STORE — flagged so it is not mistaken for a D6 shed-without-silo.
  | { kind: 'BATCH_SHED_UNKNOWN'; batchNo: string }
  // Raised by the service (Plan R, Q8): the planning date is in the past — balances are as of it, heads are today's.
  // `note` says so in words, including the ruling's consequence that days before a batch's current stage began carry no demand.
  | { kind: 'AS_OF_PAST'; planningDate: string; today: string; note: string };

export interface ForecastRow {
  batchNo: string;
  itemId: string;
  itemName: string;
  shedCode: string;
  planningDate: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number | null; // this row, first day it has demand in range
  sourceDailyDemandKg: number | null; // all rows on the same source+item, planning day
  daysLeft: number | null; // D1
  runDownDate: string | null; // D19; null = lasts to the horizon
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean; // D3/D19
  rangeDemandKg: number;
}

/**
 * Plan R (spec D16–D18; field specification of 26 Sep, Report Grid): one row
 * per batch, feed item and forecast date. A diet change is a new item, so it
 * is a new row — never blended. Current Inventory is the container's
 * projected opening balance that day; Per Day Intake and demand are heads ×
 * feed rate — D34 dropped wastage from the forecast entirely (Rishi, 28 Sep:
 * neither client document has it), so run-down, refill dates and requisition
 * quantities all use the same number.
 */
export interface DailyForecastRow {
  date: string;
  batchId: string;
  batchNo: string;
  shedId?: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string; // item code, '' when unknown
  itemName: string;
  lifecycleId: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  destinationLocationId?: string | null;
  currentItemId?: string | null;
  openingStockKg?: number;
  confirmedReceiptKg?: number;
  currentInventoryKg: number; // projected System Balance at the start of `date` (Q6)
  heads: number;
  feedRateKg: number; // kg per head per day
  perDayIntakeKg: number; // D17: heads × rate, no wastage
  wastagePct: number;
  demandKg: number; // D34: heads × rate — the forecast carries no wastage
  projectedClosingKg?: number;
  recommendedQtyKg?: number;
  daysOfStock: number | null; // D35: floor(currentInventory ÷ this row's perDayIntakeKg)
  sharedBatchCount: number; // batches drawing on the same container and item that day
  indicative: boolean; // Q13
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}

export interface ForecastSource {
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  locationId: string; // silo_id or the store's location_id
  itemId: string;
  itemName: string;
  balanceKg: number; // projected System Balance at the start of the planning date
  planningDayDemandKg: number; // combined demand on the planning date
  firstDemandDate: string | null; // first day (planningDate..to) with demand
  firstDayDemandKg: number; // combined demand on firstDemandDate
  walkDemandKg: number; // combined demand planningDate..to
  daysLeft: number | null; // D1
  runDownDate: string | null; // D19
  isNextDiet: boolean; // a batch changes onto this item in the window and nothing eats it today
  noSiloHoldsItem: boolean; // a shed with silos draws it from the store because no silo holds it
  lifecycleIds: string[]; // lifecycle rows that produce its demand in the window, sorted
  thresholdKg: number; // D19: the silo's low level, 0 for none and for a store
  incomingKg: number; // confirmed incoming after the planning date, up to `to`
  shortfallKg: number; // Q3: largest deficit below thresholdKg through `to` after incoming — what an order must bring
  refillDate: string | null; // D19: runDownDate − refill buffer
  requiredOn: string | null; // D19: refillDate − lead time
  overdue: boolean; // requiredOn before the planning date
}

export interface DietChange {
  batchId: string;
  batchNo: string;
  shedCode: string;
  fromItemId: string;
  fromItemName: string;
  toItemId: string;
  toItemName: string;
  changeDate: string; // first day of the new diet, > planningDate
  nextSourceType: 'SILO' | 'STORE' | 'NONE';
  nextSourceCode: string | null; // the silo that will feed it, null unless SILO
}

export interface ForecastResult {
  rows: ForecastRow[];
  flags: ForecastFlag[];
  sources: ForecastSource[];
  dietChanges: DietChange[];
  daily: DailyForecastRow[]; // sorted by shedCode, batchNo, date, itemName
}

/** Date arithmetic on UTC midnights — see context.md: farm-local calendar days in, UTC midnight math internally. */
function parseIsoUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatIsoUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Exported for Plan B's requisition rules (feed-requisition.rules.ts, ruling L12) so calendar-date arithmetic has one
// implementation, not a second copy.
export function addDays(iso: string, n: number): string {
  return formatIsoUtc(parseIsoUtc(iso) + n * 86_400_000);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseIsoUtc(b) - parseIsoUtc(a)) / 86_400_000);
}

/**
 * The server's own calendar day, not the UTC one: `toISOString()` would hand a
 * farm east of Greenwich yesterday's date for the first hours of every
 * morning, and the forecast's planning date is a farm-local calendar day.
 * Lives here, beside addDays/diffDays, so the forecast service, the alert
 * evaluator and the requisition rules share one pure implementation (Ruling
 * L12) and the rules module needs no Nest service to know what day it is.
 */
export function todayLocal(ms: number = Date.now()): string {
  const now = new Date(ms);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** True when the runtime knows `zone` as an IANA time zone (Intl throws a RangeError otherwise). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar day in `zone` — spec D16: the planning date defaults to today
 * in the farm's time zone (Africa/Harare for Triple C). Without a usable zone
 * it is todayLocal, the server's day, which is what Plans A and B used, so a
 * company with no zone on record behaves exactly as before.
 */
export function todayInZone(zone: string | null | undefined, ms: number = Date.now()): string {
  if (!zone || !isTimeZone(zone)) return todayLocal(ms);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * "YYYY-MM-DD" (or a timestamp starting with one) → "DD/MM/YY", the field
 * specification's date format (D16), for every message a user reads off the
 * API (review A9: alert texts said "deadline is 2026-09-26" while the screens
 * said 26/09/26). Anything that is not a date comes back as it was.
 */
export function dayShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : iso;
}

/**
 * Timestamps Plan B writes from JavaScript (feed_alert raised/notified/
 * escalated/acknowledged/resolved, requisition approved_at/deleted_at) follow
 * the codebase's convention for JS-written datetime columns: UTC as
 * `YYYY-MM-DD HH:MM:SS` — the `toISOString().slice(0, 19)` form some forty
 * services use (location, item, stock adjustment, goods receipt, alert …).
 * Columns left to their DB default (created_at, updated_at) take MySQL's
 * CURRENT_TIMESTAMP in the session zone, which agrees on a UTC server and
 * differs on a dev machine running in local time — a pre-existing split this
 * code does not add a third convention to. `parseUtcTimestamp` reads back
 * only what `utcTimestamp` wrote.
 */
export function utcTimestamp(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseUtcTimestamp(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** Inclusive list of ISO dates from `from` to `to`; empty if `to` is before `from`. */
function dateRange(from: string, to: string): string[] {
  const days = diffDays(from, to);
  const dates: string[] = [];
  for (let i = 0; i <= days; i++) dates.push(addDays(from, i));
  return dates;
}

/**
 * kg -> integer micrograms, so the balance walk (fix round 1, #4 above) divides and subtracts exactly.
 * Whole grams (1e3x) aren't fine-grained enough: 50 heads x 0.35 kg/day is exactly
 * 17.5 kg/day but 40 x 1.03 is 41.2, whose thirds drift a gram-scale walk. Micrograms (1e6x)
 * push that below any input precision this engine sees (kg/head/day, head counts).
 */
function toMicrograms(kg: number): number {
  return Math.round(kg * 1_000_000);
}

function toKg(micrograms: number): number {
  return micrograms / 1_000_000;
}

type SourceResolution = {
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  // The shed has silos but none holds this item, so it falls back to the store (Plan A Task 4's rule).
  noSiloHoldsItem: boolean;
};

/** One physical container (a silo, or the shared farm store) holding one item — the unit balance projection runs over. */
interface SourceKey {
  key: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  itemId: string;
}

export function buildFeedForecast(input: ForecastInput): ForecastResult {
  const flags: ForecastFlag[] = [];

  // Plan R: the walk may start before the planning date and look past `to`; neither widens what rows, flags, walk
  // demand or diet changes cover (see #2 and #6 above).
  const stockDate = input.stockDate && input.stockDate < input.planningDate ? input.stockDate : input.planningDate;
  const horizonTo = input.horizonTo && input.horizonTo > input.to ? input.horizonTo : input.to;

  // The visible/reporting window (rangeDemandKg, perDayIntakeKg, NO_FEED_ROW/OVERLAP flags).
  const rangeDates = dateRange(input.from, input.to);
  const isInRange = (date: string) => date >= input.from && date <= input.to;

  // Planning window: planningDate..to — Plan B's requisition window (walk demand, lifecycle ids, diet changes).
  const planDates = input.planningDate <= input.to ? dateRange(input.planningDate, input.to) : [];

  // Balance walk: stockDate..horizonTo, and nothing at all when `to` precedes the planning date.
  const walkDates = planDates.length ? dateRange(stockDate, horizonTo) : [];

  const demandDates = Array.from(new Set([...rangeDates, ...walkDates, input.planningDate])).sort();

  const siloById = new Map(input.silos.map((s) => [s.siloId, s]));
  const shedById = new Map(input.sheds.map((s) => [s.shedId, s]));

  // D19 incoming, per container and item, per day, in micrograms (several transfers on one day add up).
  const incomingByLocation = new Map<string, Map<string, number>>();
  for (const inc of input.incoming ?? []) {
    const k = `${inc.locationId}|${inc.itemId}`;
    let byDate = incomingByLocation.get(k);
    if (!byDate) {
      byDate = new Map();
      incomingByLocation.set(k, byDate);
    }
    byDate.set(inc.date, (byDate.get(inc.date) ?? 0) + toMicrograms(inc.kg));
  }

  // D9: no shed has two silos holding the same item, so this lookup is safe — at most one match per (shed, item).
  const sourceCache = new Map<string, SourceResolution>();
  function resolveSource(shedId: string, itemId: string): SourceResolution {
    const cacheKey = `${shedId}:${itemId}`;
    const cached = sourceCache.get(cacheKey);
    if (cached) return cached;

    const shed = shedById.get(shedId);
    const shedSilos = (shed?.siloIds ?? []).map((id) => siloById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    const matching = shedSilos.find((s) => s.itemId === itemId);

    let resolution: SourceResolution;
    if (matching) {
      resolution = { sourceType: 'SILO', sourceCode: matching.siloCode, siloId: matching.siloId, storeId: null, noSiloHoldsItem: false };
    } else if (shedSilos.length === 0) {
      // D6: sheds without a silo are included, fed from the farm STORE — no flag, this is expected.
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: false }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: false };
    } else {
      // The shed has silos, but none of them hold this item — falls back to STORE (Task 4's daily-entry rule).
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: true }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: true };
    }
    sourceCache.set(cacheKey, resolution);
    return resolution;
  }

  // NO_SILO_HOLDS_ITEM once per (shed, item), and only for demand up to `to` — a diet that starts only in the
  // run-down horizon past the range is not something the user asked to see (Plan R; Plan A never walked past `to`).
  const flaggedNoSilo = new Set<string>();
  function flagNoSilo(shedId: string, itemId: string) {
    const k = `${shedId}:${itemId}`;
    if (flaggedNoSilo.has(k)) return;
    flaggedNoSilo.add(k);
    flags.push({ kind: 'NO_SILO_HOLDS_ITEM', shedCode: shedById.get(shedId)?.shedCode ?? '', itemName: input.items[itemId] ?? itemId });
  }

  function sourceKeyFor(resolution: SourceResolution, itemId: string): SourceKey {
    return {
      key: `${resolution.sourceType}:${resolution.sourceCode ?? 'NONE'}:${itemId}`,
      sourceType: resolution.sourceType,
      sourceCode: resolution.sourceCode,
      siloId: resolution.siloId,
      storeId: resolution.storeId,
      itemId,
    };
  }

  /** Opening balance at stockDate in micrograms — silos are looked up by siloId (the stable key), not siloCode. */
  function balanceMicrogramsFor(sk: SourceKey): number {
    if (sk.sourceType === 'SILO') {
      const silo = sk.siloId ? siloById.get(sk.siloId) : undefined;
      return toMicrograms(silo?.balanceKg ?? 0);
    }
    if (sk.sourceType === 'STORE') {
      return toMicrograms(input.store?.balances[sk.itemId] ?? 0);
    }
    return 0;
  }

  /**
   * D38: how many days before run-down this source must be refilled. A silo
   * answers with its own reorder days; a store — and a silo whose value was
   * never set — uses the field specification's standard 2.
   */
  function refillBufferDaysFor(sk: SourceKey): number {
    if (sk.sourceType !== 'SILO' || !sk.siloId) return DEFAULT_REFILL_BUFFER_DAYS;
    const days = siloById.get(sk.siloId)?.reorderDays;
    return days != null && days >= 0 ? days : DEFAULT_REFILL_BUFFER_DAYS;
  }

  /** D19: the silo's Below Feed Level; a store and a silo without one run down to zero. */
  function thresholdMicrogramsFor(sk: SourceKey): number {
    if (sk.sourceType !== 'SILO' || !sk.siloId) return 0;
    const low = siloById.get(sk.siloId)?.lowLevelKg;
    return low != null && low > 0 ? toMicrograms(low) : 0;
  }

  // Demand per source-key per calendar day, in micrograms, accumulated across every batch that draws on that container.
  const demandMicrogramsByKeyByDate = new Map<string, Map<string, number>>();
  const keyMeta = new Map<string, SourceKey>();

  // Per (batch, item) row aggregate — one ForecastRow per pair that has at least one day of demand > 0 in range.
  interface RowAgg {
    batchNo: string;
    itemId: string;
    shedCode: string;
    heads: number;
    key: string;
    sourceType: 'SILO' | 'STORE' | 'NONE';
    sourceCode: string | null;
    rangeDemandMicrograms: number;
    perDayIntakeMicrograms: number; // set once, on the first in-range day with demand > 0
    firstDemandDate: string;
  }
  const rowAggs = new Map<string, RowAgg>(); // keyed by batchId:itemId

  // Plan B: which lifecycle rows feed each container inside the planning window, which item each batch eats on each
  // planning day (for diet changes), and which containers are a store fallback for a shed that has silos.
  const lifecycleIdsByKey = new Map<string, Set<string>>();
  const itemByBatchDate = new Map<string, string>();
  const noSiloKeys = new Set<string>();

  // Plan R: per-date rows run from the planning date (or `from`, if later) to `to` (Q7). The batches eating from a
  // container on a day give its shared count (D18); an ANIMAL_WISE batch's stage groups count as separate batches,
  // because each is fed its own stage's diet.
  const rowFrom = input.from > input.planningDate ? input.from : input.planningDate;
  interface DailyEntry {
    date: string;
    batchId: string;
    batchNo: string;
    shedId: string;
    heads: number;
    stageCode: string;
    feedRow: FeedRow;
    key: string;
    sourceType: 'SILO' | 'STORE' | 'NONE';
    sourceCode: string | null;
    demandMicrograms: number;
    /** D36: the date sits inside the segment's stage-change window (earliest…latest) — see DailyForecastRow. */
    inChangeWindow: boolean;
  }
  const dailyEntries: DailyEntry[] = [];
  const batchesByKeyDate = new Map<string, Set<string>>();

  for (const batch of input.batches) {
    flags.push({ kind: 'HEADS_ASSUMED_FLAT', batchNo: batch.batchNo }); // D11: heads assumed flat unless movements say otherwise
    for (const segment of batch.segments) {
      // The service projects stages to the run-down horizon; only a change the user can see in from..to is flagged.
      if (segment.projected && segment.start <= input.to) {
        flags.push({ kind: 'STAGE_CHANGE_PROJECTED', batchNo: batch.batchNo, stageCode: segment.stageCode, date: segment.start });
      }
    }

    const feedRowsForBreed = input.feedRows.filter((r) => r.breedId === batch.breedId);

    for (const date of demandDates) {
      const segment = batch.segments.find((s) => s.start <= date && (s.end === null || date <= s.end));
      if (!segment) continue;

      const dayOfStage = diffDays(segment.start, date) + 1;
      const candidates = feedRowsForBreed.filter((r) => r.stageId === segment.stageId);
      const result = feedRowFor(candidates, dayOfStage);

      if ('error' in result) {
        // Flags are reserved for the visible window; a gap outside it still correctly contributes no demand.
        if (isInRange(date)) {
          flags.push({
            kind: result.error === 'NONE' ? 'NO_FEED_ROW' : 'OVERLAPPING_FEED_ROWS',
            batchNo: batch.batchNo,
            stageCode: segment.stageCode,
            day: dayOfStage,
            date,
          });
        }
        continue;
      }

      const feedRow = result.row;
      const demandMicrograms = toMicrograms(batch.heads * feedRow.kgPerHeadPerDay); // D34: no wastage
      if (demandMicrograms <= 0) continue; // zero demand: no row, no source resolution, nothing to project

      // D36: a row whose date falls inside the stage-change window — on or
      // after the earliest day, before the planned (latest) day's successor —
      // is indicative: the change may already have happened by then.
      const inChangeWindow =
        !!segment.changeWindowStart && date >= segment.changeWindowStart && segment.end !== null && date <= segment.end;

      const resolution = resolveSource(batch.shedId, feedRow.itemId);
      if (resolution.noSiloHoldsItem && date <= input.to) flagNoSilo(batch.shedId, feedRow.itemId);
      const sk = sourceKeyFor(resolution, feedRow.itemId);
      keyMeta.set(sk.key, sk);

      let byDate = demandMicrogramsByKeyByDate.get(sk.key);
      if (!byDate) {
        byDate = new Map();
        demandMicrogramsByKeyByDate.set(sk.key, byDate);
      }
      byDate.set(date, (byDate.get(date) ?? 0) + demandMicrograms);

      if (date >= input.planningDate && date <= input.to) {
        let ids = lifecycleIdsByKey.get(sk.key);
        if (!ids) {
          ids = new Set();
          lifecycleIdsByKey.set(sk.key, ids);
        }
        ids.add(feedRow.lifecycleId);
        itemByBatchDate.set(`${batch.batchId}|${date}`, feedRow.itemId);
        if (resolution.noSiloHoldsItem) noSiloKeys.add(sk.key);
      }

      if (date >= rowFrom && date <= input.to) {
        dailyEntries.push({
          date, batchId: batch.batchId, batchNo: batch.batchNo, shedId: batch.shedId, heads: batch.heads,
          stageCode: segment.stageCode, feedRow, key: sk.key, sourceType: sk.sourceType, sourceCode: sk.sourceCode, demandMicrograms,
          inChangeWindow,
        });
        const shareKey = `${sk.key}|${date}`;
        let sharing = batchesByKeyDate.get(shareKey);
        if (!sharing) {
          sharing = new Set();
          batchesByKeyDate.set(shareKey, sharing);
        }
        sharing.add(batch.batchId);
      }

      if (!isInRange(date)) continue; // walk-only date: contributes to the balance, not to the row

      const aggKey = `${batch.batchId}:${feedRow.itemId}`;
      let agg = rowAggs.get(aggKey);
      if (!agg) {
        const shed = shedById.get(batch.shedId);
        agg = {
          batchNo: batch.batchNo,
          itemId: feedRow.itemId,
          shedCode: shed?.shedCode ?? '',
          heads: batch.heads,
          key: sk.key,
          sourceType: sk.sourceType,
          sourceCode: sk.sourceCode,
          rangeDemandMicrograms: 0,
          perDayIntakeMicrograms: demandMicrograms,
          firstDemandDate: date,
        };
        rowAggs.set(aggKey, agg);
      }
      agg.rangeDemandMicrograms += demandMicrograms;
    }
  }

  // Balance projection per source key (D1, D19), computed once and shared by every row drawing on that container.
  interface KeyProjection {
    currentInventoryKg: number;
    sourceDailyDemandKg: number | null;
    daysLeft: number | null;
    runDownDate: string | null;
    refillDate: string | null;
    requiredOn: string | null;
    overdue: boolean;
    walkDemandKg: number;
    firstDemandDate: string | null;
    firstDayDemandKg: number;
    thresholdKg: number;
    incomingKg: number;
    shortfallKg: number;
  }
  const projectionByKey = new Map<string, KeyProjection>();
  // Opening balance of every walked day, per key — the per-date rows read Current Inventory off it (Ruling M7).
  const openingByKey = new Map<string, Map<string, number>>();

  for (const [key, sk] of keyMeta) {
    const byDate = demandMicrogramsByKeyByDate.get(key) ?? new Map<string, number>();
    const locationId = sk.siloId ?? sk.storeId;
    const inflow = (locationId ? incomingByLocation.get(`${locationId}|${sk.itemId}`) : undefined) ?? new Map<string, number>();
    const threshold = thresholdMicrogramsFor(sk);

    const opening = new Map<string, number>();
    let carried = balanceMicrogramsFor(sk);
    let runDownDate: string | null = null;
    for (const date of walkDates) {
      // A transfer out can exceed what is there on paper; a silo is never below empty.
      const open = Math.max(0, carried + (inflow.get(date) ?? 0));
      opening.set(date, open);
      const demand = byDate.get(date) ?? 0;
      const closing = open - demand;
      // Only a day that takes feed out counts — eaten from, or a transfer out. Either can bring the silo to its low
      // level (so no shortfall is left without a date); a day with neither leaves an idle, empty silo alone.
      const outgoing = demand > 0 || (inflow.get(date) ?? 0) < 0;
      if (runDownDate === null && date >= input.planningDate && outgoing && closing <= threshold) runDownDate = date;
      carried = Math.max(0, closing); // demand the silo cannot meet is not carried into the next day
    }
    openingByKey.set(key, opening);
    // The fallback (a purely retrospective range, nothing walked) reads the raw
    // opening, which can be negative since stockAsOf carries the signed ledger;
    // stock on hand is never shown below zero, the same clamp the walk applies.
    const planningOpening = opening.get(input.planningDate) ?? Math.max(0, balanceMicrogramsFor(sk));

    const sourceDailyDemandMicrograms = byDate.get(input.planningDate) ?? 0;
    const daysLeft = sourceDailyDemandMicrograms > 0 ? Math.floor(planningOpening / sourceDailyDemandMicrograms) : null;

    const refillDate = runDownDate !== null ? addDays(runDownDate, -refillBufferDaysFor(sk)) : null;
    const requiredOn = refillDate !== null ? addDays(refillDate, -input.leadTimeDays) : null;
    const overdue = requiredOn !== null && requiredOn < input.planningDate;

    // Plan B's window (planningDate..to): walk demand, first demand day, and — Plan R, Q3 — the shortfall: the largest
    // amount by which the balance would sit below the threshold at the end of any day if nothing more were ordered.
    // Without a low level or incoming it is simply requirement − opening, the Worked Example's column G.
    let walkDemandMicrograms = 0;
    let firstDemandDate: string | null = null;
    let firstDayDemandMicrograms = 0;
    let incomingMicrograms = 0;
    let shortfallMicrograms = 0;
    for (const date of planDates) {
      const m = byDate.get(date) ?? 0;
      if (m > 0 && firstDemandDate === null) {
        firstDemandDate = date;
        firstDayDemandMicrograms = m;
      }
      walkDemandMicrograms += m;
      if (date !== input.planningDate) incomingMicrograms += inflow.get(date) ?? 0; // the planning day's is in its opening
      shortfallMicrograms = Math.max(shortfallMicrograms, walkDemandMicrograms + threshold - planningOpening - incomingMicrograms);
    }

    projectionByKey.set(key, {
      currentInventoryKg: toKg(planningOpening),
      sourceDailyDemandKg: toKg(sourceDailyDemandMicrograms),
      daysLeft,
      runDownDate,
      refillDate,
      requiredOn,
      overdue,
      walkDemandKg: toKg(walkDemandMicrograms),
      firstDemandDate,
      firstDayDemandKg: toKg(firstDayDemandMicrograms),
      thresholdKg: toKg(threshold),
      incomingKg: toKg(incomingMicrograms),
      shortfallKg: toKg(shortfallMicrograms),
    });
  }

  // Diet changes (checkpoint 30): a batch whose item changes between two planning days, compared against the last day
  // that HAD an item — not strictly the day before (a gap day with no feed row must not hide the change).
  const dietChanges: DietChange[] = [];
  const nextDietKeys = new Set<string>();
  for (const batch of input.batches) {
    let lastItem: string | null = null;
    for (const date of planDates) {
      const item = itemByBatchDate.get(`${batch.batchId}|${date}`);
      if (!item) continue;
      if (lastItem !== null && item !== lastItem) {
        const next = resolveSource(batch.shedId, item); // cached: already resolved by the demand loop
        nextDietKeys.add(sourceKeyFor(next, item).key);
        dietChanges.push({
          batchId: batch.batchId,
          batchNo: batch.batchNo,
          shedCode: shedById.get(batch.shedId)?.shedCode ?? '',
          fromItemId: lastItem,
          fromItemName: input.items[lastItem] ?? lastItem,
          toItemId: item,
          toItemName: input.items[item] ?? item,
          changeDate: date,
          nextSourceType: next.sourceType,
          nextSourceCode: next.sourceType === 'SILO' ? next.sourceCode : null,
        });
      }
      lastItem = item;
    }
  }
  dietChanges.sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
    return a.changeDate < b.changeDate ? -1 : a.changeDate > b.changeDate ? 1 : 0;
  });

  // One summary per real container and item. NONE (no silo, no store) has nowhere to deliver to, so no requisition line.
  const sources: ForecastSource[] = [];
  for (const [key, sk] of keyMeta) {
    if (sk.sourceType === 'NONE') continue;
    const p = projectionByKey.get(key)!;
    // Demand only before the planning date or only past `to` (the run-down horizon) is nothing to requisition now.
    if (p.walkDemandKg <= 0) continue;
    const planningDayDemandKg = p.sourceDailyDemandKg ?? 0;
    sources.push({
      sourceType: sk.sourceType,
      sourceCode: sk.sourceCode!,
      locationId: (sk.siloId ?? sk.storeId)!,
      itemId: sk.itemId,
      itemName: input.items[sk.itemId] ?? sk.itemId,
      balanceKg: p.currentInventoryKg,
      planningDayDemandKg,
      firstDemandDate: p.firstDemandDate,
      firstDayDemandKg: p.firstDayDemandKg,
      walkDemandKg: p.walkDemandKg,
      daysLeft: p.daysLeft,
      runDownDate: p.runDownDate,
      isNextDiet: nextDietKeys.has(key) && planningDayDemandKg === 0,
      noSiloHoldsItem: noSiloKeys.has(key),
      lifecycleIds: [...(lifecycleIdsByKey.get(key) ?? [])].sort(),
      thresholdKg: p.thresholdKg,
      incomingKg: p.incomingKg,
      shortfallKg: p.shortfallKg,
      refillDate: p.refillDate,
      requiredOn: p.requiredOn,
      overdue: p.overdue,
    });
  }
  sources.sort((a, b) => (a.sourceCode !== b.sourceCode ? (a.sourceCode < b.sourceCode ? -1 : 1) : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const daily: DailyForecastRow[] = dailyEntries.map((e) => {
    const p = projectionByKey.get(e.key)!;
    const opening = openingByKey.get(e.key)?.get(e.date) ?? 0;
    const rowIntakeMicrograms = toMicrograms(e.heads * e.feedRow.kgPerHeadPerDay);
    // Q13: indicative when what this container feeds per day changes later in the window — a diet, rate or stage
    // change of any batch on it — because the balance the row divides is shared, and any change on the container
    // (this batch's own rate or another batch drawing on the same silo/store) dates how long the stock really lasts.
    let indicative = false;
    const byDate = demandMicrogramsByKeyByDate.get(e.key) ?? new Map<string, number>();
    const containerDemand = byDate.get(e.date) ?? 0;
    for (const d of planDates) {
      if (d > e.date && (byDate.get(d) ?? 0) !== containerDemand) {
        indicative = true;
        break;
      }
    }
    const itemId = e.feedRow.itemId;
    const source = keyMeta.get(e.key)!;
    const confirmedReceiptMicrograms = incomingByLocation.get(`${source.siloId ?? source.storeId}|${itemId}`)?.get(e.date) ?? 0;
    const totalDemandMicrograms = byDate.get(e.date) ?? 0;
    return {
      date: e.date,
      batchId: e.batchId,
      batchNo: e.batchNo,
      shedId: e.shedId,
      shedCode: shedById.get(e.shedId)?.shedCode ?? '',
      stageCode: e.stageCode,
      itemId,
      itemNo: input.itemCodes?.[itemId] ?? '',
      itemName: input.items[itemId] ?? itemId,
      lifecycleId: e.feedRow.lifecycleId,
      sourceType: e.sourceType,
      sourceCode: e.sourceCode,
      destinationLocationId: source.siloId ?? source.storeId,
      currentItemId: e.sourceType === 'NONE' ? null : itemId,
      openingStockKg: toKg(opening - confirmedReceiptMicrograms),
      confirmedReceiptKg: toKg(confirmedReceiptMicrograms),
      currentInventoryKg: toKg(opening),
      heads: e.heads,
      feedRateKg: e.feedRow.kgPerHeadPerDay,
      perDayIntakeKg: toKg(toMicrograms(e.heads * e.feedRow.kgPerHeadPerDay)),
      wastagePct: e.feedRow.wastagePct, // kept for the breed feed master's display; unused by the forecast (D34)
      demandKg: toKg(e.demandMicrograms),
      projectedClosingKg: toKg(Math.max(0, opening - totalDemandMicrograms)),
      recommendedQtyKg: p.shortfallKg,
      // D35 (supersedes D18): the specification defines Days of Stock as
      // Current Inventory ÷ Per Day Intake of that row's batch — not the
      // silo's combined use, so two batches sharing one silo each see their
      // own division of the same balance. Whole days (floor); empty when the
      // intake is 0; NONE has no container at all and no stock to divide.
      daysOfStock: e.sourceType !== 'NONE' && e.heads > 0 && rowIntakeMicrograms > 0 ? Math.floor(opening / rowIntakeMicrograms) : null,
      sharedBatchCount: e.sourceType === 'NONE' ? 1 : (batchesByKeyDate.get(`${e.key}|${e.date}`)?.size ?? 1),
      indicative: indicative || e.inChangeWindow,
      runDownDate: p.runDownDate,
      refillDate: p.refillDate,
      requiredOn: p.requiredOn,
      overdue: p.overdue,
    };
  });
  daily.sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.itemName !== b.itemName) return a.itemName < b.itemName ? -1 : 1;
    // An ANIMAL_WISE batch's stage groups share its batch number; batch id last keeps the order total.
    if (a.stageCode !== b.stageCode) return a.stageCode < b.stageCode ? -1 : 1;
    return a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0;
  });

  const entries: { row: ForecastRow; firstDemandDate: string }[] = [];
  for (const agg of rowAggs.values()) {
    const projection = projectionByKey.get(agg.key)!;
    entries.push({
      firstDemandDate: agg.firstDemandDate,
      row: {
        batchNo: agg.batchNo,
        itemId: agg.itemId,
        itemName: input.items[agg.itemId] ?? agg.itemId,
        shedCode: agg.shedCode,
        planningDate: input.planningDate,
        sourceType: agg.sourceType,
        sourceCode: agg.sourceCode,
        currentInventoryKg: projection.currentInventoryKg,
        heads: agg.heads,
        perDayIntakeKg: toKg(agg.perDayIntakeMicrograms),
        sourceDailyDemandKg: projection.sourceDailyDemandKg,
        daysLeft: projection.daysLeft,
        runDownDate: projection.runDownDate,
        refillDate: projection.refillDate,
        requiredOn: projection.requiredOn,
        overdue: projection.overdue,
        rangeDemandKg: toKg(agg.rangeDemandMicrograms),
      },
    });
  }

  entries.sort((a, b) => {
    if (a.row.shedCode !== b.row.shedCode) return a.row.shedCode < b.row.shedCode ? -1 : 1;
    if (a.row.batchNo !== b.row.batchNo) return a.row.batchNo < b.row.batchNo ? -1 : 1;
    return a.firstDemandDate < b.firstDemandDate ? -1 : a.firstDemandDate > b.firstDemandDate ? 1 : 0;
  });

  return { rows: entries.map((e) => e.row), flags, sources, dietChanges, daily };
}

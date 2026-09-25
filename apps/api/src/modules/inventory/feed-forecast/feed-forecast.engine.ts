/**
 * Pure feed-forecast engine (Task 6 of the Feed Forecast Plan A design,
 * docs/superpowers/specs/2026-09-25-feed-forecast-design.md, D1-D15). No DB,
 * no Nest — it takes a plain snapshot of sheds/silos/batches/feed rows and
 * returns forecast rows plus data-quality flags. The service layer (Task 7)
 * is responsible for assembling ForecastInput from MySQL and for turning
 * this into the GET /feed-forecast response; this file only does the math,
 * so it can be unit-tested against the workbook's worked example without a
 * database.
 *
 * Four ideas that don't fall out of the types by themselves:
 *
 * 1. Balance projection is per (source, item), not per (batch, item) — D9
 *    already guarantees at most one silo per shed holds a given item, but a
 *    single silo can feed several sheds (D7) and the farm STORE is shared by
 *    every shed that falls back to it. So before walking the calendar we
 *    group demand by the physical container ("key" below) and run the
 *    depletion once per container; every ForecastRow drawing on that
 *    container then reads off the same daysLeft/runDownDate.
 * 2. The balance is a **planning-date snapshot**, not a `from`-date snapshot
 *    (fix round 1, ruling in the review ledger): daysLeft, runDownDate,
 *    refillDate, requiredOn and overdue are all computed by walking the
 *    calendar from `planningDate` through `to`. Days before planningDate
 *    never consume the balance — if `to` is before planningDate there is
 *    nothing to walk and runDownDate is null. `rangeDemandKg` and
 *    `perDayIntakeKg` are unaffected: they still describe demand over the
 *    requested `from…to` window, which can start before or after
 *    planningDate.
 * 3. `sourceDailyDemandKg` (used for D1's daysLeft) is the combined demand
 *    on the *planning date specifically*, not a row's first day of demand in
 *    the range — a diet can start later in the window (D15), in which case
 *    the planning-date demand is legitimately 0 and daysLeft is null even
 *    though the row still shows demand later on (see the worked example's
 *    R2, whose diet starts three days into the range). Because planningDate
 *    can fall outside `from…to` (see #2), demand is evaluated for the union
 *    of the display range, the walk range and planningDate itself — not
 *    just for the display range.
 * 4. All balance/demand arithmetic that feeds daysLeft/runDownDate is done
 *    in integer micrograms (`Math.round(kg * 1_000_000)`), converted back to
 *    kg only for output. Kg-denominated floats (e.g. 40 heads x 1.03 kg/day =
 *    41.2 kg against a 123.6 kg balance, which is exactly 3 days of stock)
 *    don't divide or subtract exactly in IEEE 754 doubles — `floor(123.6 /
 *    41.2)` can come out 2 instead of 3. Whole grams aren't precise enough
 *    either (e.g. 17.9375 kg/day is a half-gram), so the scale is 1e6, not 1e3.
 * 5. Plan B reads two more things off the same walk: `sources` (one entry per
 *    physical container and item — the unit a feed requisition line is
 *    drafted for) and `dietChanges` (each batch's switch to its next
 *    lifecycle feed row inside planningDate..to, for the DIET_CHANGE alert).
 *    They are computed here, not by callers, so the requisition, the alert
 *    and the report can never disagree about demand or dates.
 */
import { FeedRow, feedRowFor } from '../../production/lifecycle/feed-row-days';

export interface ForecastInput {
  planningDate: string;
  from: string;
  to: string;
  refillBufferDays: number;
  leadTimeDays: number;
  sheds: { shedId: string; shedCode: string; siloIds: string[] }[];
  silos: { siloId: string; siloCode: string; itemId: string | null; balanceKg: number }[];
  store: { storeId: string; storeCode: string; balances: Record<string, number> } | null;
  items: Record<string, string>; // itemId -> item name
  batches: {
    batchId: string;
    batchNo: string;
    breedId: string;
    shedId: string;
    heads: number;
    segments: { stageId: string; stageCode: string; start: string; end: string | null; projected: boolean }[];
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
  | { kind: 'BATCH_SHED_UNKNOWN'; batchNo: string };

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
  runDownDate: string | null; // D2; null = lasts the whole range
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean; // D3
  rangeDemandKg: number;
}

export interface ForecastSource {
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  locationId: string; // silo_id or the store's location_id
  itemId: string;
  itemName: string;
  balanceKg: number; // System Balance at the planning date
  planningDayDemandKg: number; // combined demand on the planning date
  firstDemandDate: string | null; // first walk day (planningDate..to) with demand
  firstDayDemandKg: number; // combined demand on firstDemandDate
  walkDemandKg: number; // combined demand planningDate..to
  daysLeft: number | null; // D1
  runDownDate: string | null; // D2
  isNextDiet: boolean; // a batch changes onto this item in the window and nothing eats it today
  noSiloHoldsItem: boolean; // a shed with silos draws it from the store because no silo holds it
  lifecycleIds: string[]; // lifecycle rows that produce its demand in the window, sorted
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

function addDays(iso: string, n: number): string {
  return formatIsoUtc(parseIsoUtc(iso) + n * 86_400_000);
}

function diffDays(a: string, b: string): number {
  return Math.round((parseIsoUtc(b) - parseIsoUtc(a)) / 86_400_000);
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
 * Whole grams (1e3x) aren't fine-grained enough: e.g. 50 heads x 0.35 kg/day x 2.5% wastage is exactly
 * 17.9375 kg/day, which rounds to a half-gram at 1e3x scale and drifts the division. Micrograms (1e6x)
 * push that below any input precision this engine sees (kg/head/day, wastage%, head counts).
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

  // The visible/reporting window (rangeDemandKg, perDayIntakeKg, NO_FEED_ROW/OVERLAP flags).
  const rangeDates = dateRange(input.from, input.to);
  const isInRange = (date: string) => date >= input.from && date <= input.to;

  // The balance-walk window: planningDate through `to` — fix round 1, #2. Empty when `to` precedes planningDate.
  const walkDates = input.planningDate <= input.to ? dateRange(input.planningDate, input.to) : [];

  // Demand must be evaluated for every date that either window (or planningDate itself, for sourceDailyDemandKg)
  // needs — the union can extend before `from` when planningDate < from, or after `to` never (walkDates ⊆ [.., to]).
  const demandDates = Array.from(new Set([...rangeDates, ...walkDates, input.planningDate])).sort();

  const siloById = new Map(input.silos.map((s) => [s.siloId, s]));
  const shedById = new Map(input.sheds.map((s) => [s.shedId, s]));

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
      // The shed has silos, but none of them hold this item — falls back to STORE (Task 4's daily-entry rule), flagged.
      flags.push({ kind: 'NO_SILO_HOLDS_ITEM', shedCode: shed!.shedCode, itemName: input.items[itemId] ?? itemId });
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: true }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: true };
    }
    sourceCache.set(cacheKey, resolution);
    return resolution;
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

  /** Current balance in micrograms — silos are looked up by siloId (the stable key), not siloCode. */
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

  // Demand per source-key per calendar day, in micrograms, accumulated across every batch that draws on that container
  // (Review Focus 1) and over every date demand needs evaluating for (Review Focus 3 / fix round 1 #2-#3).
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

  // Plan B: which lifecycle rows feed each container inside the walk window, which item each batch eats on each walk
  // day (for diet changes), and which containers are a store fallback for a shed that has silos.
  const lifecycleIdsByKey = new Map<string, Set<string>>();
  const itemByBatchDate = new Map<string, string>();
  const noSiloKeys = new Set<string>();

  for (const batch of input.batches) {
    flags.push({ kind: 'HEADS_ASSUMED_FLAT', batchNo: batch.batchNo }); // D11: heads assumed flat unless movements say otherwise
    for (const segment of batch.segments) {
      if (segment.projected) {
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
        // Flags are reserved for the visible window — a gap that only affects the pre-`from` walk tail is not
        // shown to the user (Task 7/8 handle display), but it still correctly contributes no demand either way.
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
      const demandMicrograms = toMicrograms(batch.heads * feedRow.kgPerHeadPerDay * (1 + feedRow.wastagePct / 100));
      if (demandMicrograms <= 0) continue; // zero demand: no row, no source resolution, nothing to project (minor fix)

      const resolution = resolveSource(batch.shedId, feedRow.itemId);
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

      if (!isInRange(date)) continue; // walk-only date (before `from`): contributes to the balance, not to the row

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

  // Balance projection per source key (D2, D1, D3), computed once and shared by every row drawing on that container.
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
  }
  const projectionByKey = new Map<string, KeyProjection>();

  for (const [key, sk] of keyMeta) {
    const byDate = demandMicrogramsByKeyByDate.get(key) ?? new Map<string, number>();
    const balanceMicrograms = balanceMicrogramsFor(sk);

    const sourceDailyDemandMicrograms = byDate.get(input.planningDate) ?? 0;
    const daysLeft = sourceDailyDemandMicrograms > 0 ? Math.floor(balanceMicrograms / sourceDailyDemandMicrograms) : null;

    // Walk from planningDate, not from `from` (fix round 1, #2) — days before planningDate never consume the balance.
    let remainingMicrograms = balanceMicrograms;
    let runDownDate: string | null = null;
    for (const date of walkDates) {
      const demandMicrograms = byDate.get(date) ?? 0;
      if (demandMicrograms > 0 && remainingMicrograms < demandMicrograms) {
        runDownDate = date;
        break;
      }
      remainingMicrograms -= demandMicrograms;
    }

    const refillDate = runDownDate !== null ? addDays(runDownDate, -input.refillBufferDays) : null;
    const requiredOn = refillDate !== null ? addDays(refillDate, -input.leadTimeDays) : null;
    const overdue = requiredOn !== null && requiredOn < input.planningDate;

    // Plan B: demand over the walk window and its first day — the requisition's shortfall and daily requirement.
    let walkDemandMicrograms = 0;
    let firstDemandDate: string | null = null;
    let firstDayDemandMicrograms = 0;
    for (const date of walkDates) {
      const m = byDate.get(date) ?? 0;
      if (m > 0 && firstDemandDate === null) {
        firstDemandDate = date;
        firstDayDemandMicrograms = m;
      }
      walkDemandMicrograms += m;
    }

    projectionByKey.set(key, {
      currentInventoryKg: toKg(balanceMicrograms),
      sourceDailyDemandKg: toKg(sourceDailyDemandMicrograms),
      daysLeft,
      runDownDate,
      refillDate,
      requiredOn,
      overdue,
      walkDemandKg: toKg(walkDemandMicrograms),
      firstDemandDate,
      firstDayDemandKg: toKg(firstDayDemandMicrograms),
    });
  }

  // Diet changes (checkpoint 30): a batch whose item on walk day i differs from day i-1. Days before planningDate are
  // not walked, so a change that already happened is never reported as upcoming.
  const dietChanges: DietChange[] = [];
  const nextDietKeys = new Set<string>();
  for (const batch of input.batches) {
    for (let i = 1; i < walkDates.length; i++) {
      const before = itemByBatchDate.get(`${batch.batchId}|${walkDates[i - 1]}`);
      const after = itemByBatchDate.get(`${batch.batchId}|${walkDates[i]}`);
      if (!before || !after || before === after) continue;
      const next = resolveSource(batch.shedId, after); // cached: already resolved by the demand loop
      nextDietKeys.add(sourceKeyFor(next, after).key);
      dietChanges.push({
        batchId: batch.batchId,
        batchNo: batch.batchNo,
        shedCode: shedById.get(batch.shedId)?.shedCode ?? '',
        fromItemId: before,
        fromItemName: input.items[before] ?? before,
        toItemId: after,
        toItemName: input.items[after] ?? after,
        changeDate: walkDates[i],
        nextSourceType: next.sourceType,
        nextSourceCode: next.sourceType === 'SILO' ? next.sourceCode : null,
      });
    }
  }

  // One summary per real container and item. NONE (no silo, no store) has nowhere to deliver to, so no requisition line.
  const sources: ForecastSource[] = [];
  for (const [key, sk] of keyMeta) {
    if (sk.sourceType === 'NONE') continue;
    const p = projectionByKey.get(key)!;
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
      // "Is Next Diet Requisition — True if generated for the upcoming next diet" (Requisition §1 row 16): a batch
      // changes onto it inside the window and nothing on this container eats it on the planning date.
      isNextDiet: nextDietKeys.has(key) && planningDayDemandKg === 0,
      noSiloHoldsItem: noSiloKeys.has(key),
      lifecycleIds: [...(lifecycleIdsByKey.get(key) ?? [])].sort(),
    });
  }
  sources.sort((a, b) => (a.sourceCode !== b.sourceCode ? (a.sourceCode < b.sourceCode ? -1 : 1) : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

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

  // Sort by shedCode, batchNo, first-demand date — a single consistent key, not a re-derived one (minor fix).
  entries.sort((a, b) => {
    if (a.row.shedCode !== b.row.shedCode) return a.row.shedCode < b.row.shedCode ? -1 : 1;
    if (a.row.batchNo !== b.row.batchNo) return a.row.batchNo < b.row.batchNo ? -1 : 1;
    return a.firstDemandDate < b.firstDemandDate ? -1 : a.firstDemandDate > b.firstDemandDate ? 1 : 0;
  });

  return { rows: entries.map((e) => e.row), flags, sources, dietChanges };
}

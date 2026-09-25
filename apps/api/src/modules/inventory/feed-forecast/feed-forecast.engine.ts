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
 * The two ideas that don't fall out of the types by themselves:
 *
 * 1. Balance projection is per (source, item), not per (batch, item) — D9
 *    already guarantees at most one silo per shed holds a given item, but a
 *    single silo can feed several sheds (D7) and the farm STORE is shared by
 *    every shed that falls back to it. So before walking the calendar we
 *    group demand by the physical container ("key" below) and run the
 *    depletion once per container; every ForecastRow drawing on that
 *    container then reads off the same daysLeft/runDownDate.
 * 2. `sourceDailyDemandKg` (used for D1's daysLeft) is the combined demand
 *    on the *planning date specifically*, not a row's first day of demand in
 *    the range — a diet can start later in the window (D15), in which case
 *    the planning-date demand is legitimately 0 and daysLeft is null even
 *    though the row still shows demand later on (see the worked example's
 *    R2, whose diet starts three days into the range).
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
  | { kind: 'HEADS_ASSUMED_FLAT'; batchNo: string };

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

/** heads x kg/head/day x (1 + wastage%) (D5), kept to 3 decimals so repeated day-by-day summation doesn't drift. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dateRange(from: string, to: string): string[] {
  const days = diffDays(from, to);
  const dates: string[] = [];
  for (let i = 0; i <= days; i++) dates.push(addDays(from, i));
  return dates;
}

type SourceResolution = { sourceType: 'SILO' | 'STORE' | 'NONE'; sourceCode: string | null };

/** One physical container (a silo, or the shared farm store) holding one item — the unit balance projection runs over. */
interface SourceKey {
  key: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  itemId: string;
}

export function buildFeedForecast(input: ForecastInput): { rows: ForecastRow[]; flags: ForecastFlag[] } {
  const flags: ForecastFlag[] = [];
  const dates = dateRange(input.from, input.to);

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
      resolution = { sourceType: 'SILO', sourceCode: matching.siloCode };
    } else if (shedSilos.length === 0) {
      // D6: sheds without a silo are included, fed from the farm STORE — no flag, this is expected.
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode }
        : { sourceType: 'NONE', sourceCode: null };
    } else {
      // The shed has silos, but none of them hold this item — falls back to STORE (Task 4's daily-entry rule), flagged.
      flags.push({ kind: 'NO_SILO_HOLDS_ITEM', shedCode: shed!.shedCode, itemName: input.items[itemId] ?? itemId });
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode }
        : { sourceType: 'NONE', sourceCode: null };
    }
    sourceCache.set(cacheKey, resolution);
    return resolution;
  }

  function sourceKeyFor(resolution: SourceResolution, itemId: string): SourceKey {
    return {
      key: `${resolution.sourceType}:${resolution.sourceCode ?? 'NONE'}:${itemId}`,
      sourceType: resolution.sourceType,
      sourceCode: resolution.sourceCode,
      itemId,
    };
  }

  function balanceFor(sk: SourceKey): number {
    if (sk.sourceType === 'SILO') {
      const silo = input.silos.find((s) => s.siloCode === sk.sourceCode);
      return silo?.balanceKg ?? 0;
    }
    if (sk.sourceType === 'STORE') {
      return input.store?.balances[sk.itemId] ?? 0;
    }
    return 0;
  }

  // Demand per source-key per calendar day, accumulated across every batch that draws on that container (Review Focus 1).
  const demandByKeyByDate = new Map<string, Map<string, number>>();
  const keyMeta = new Map<string, SourceKey>();

  // Per (batch, item) row aggregate — one ForecastRow per pair that has at least one day of demand in range.
  interface RowAgg {
    batchNo: string;
    itemId: string;
    shedCode: string;
    heads: number;
    key: string;
    sourceType: 'SILO' | 'STORE' | 'NONE';
    sourceCode: string | null;
    rangeDemandKg: number;
    perDayIntakeKg: number;
    firstDemandDate: string;
  }
  const rowAggs = new Map<string, RowAgg>(); // keyed by batchId:itemId

  for (const batch of input.batches) {
    flags.push({ kind: 'HEADS_ASSUMED_FLAT', batchNo: batch.batchNo }); // D11: heads assumed flat unless movements say otherwise
    for (const segment of batch.segments) {
      if (segment.projected) {
        flags.push({ kind: 'STAGE_CHANGE_PROJECTED', batchNo: batch.batchNo, stageCode: segment.stageCode, date: segment.start });
      }
    }

    const feedRowsForBreed = input.feedRows.filter((r) => r.breedId === batch.breedId);

    for (const date of dates) {
      const segment = batch.segments.find((s) => s.start <= date && (s.end === null || date <= s.end));
      if (!segment) continue;

      const dayOfStage = diffDays(segment.start, date) + 1;
      const candidates = feedRowsForBreed.filter((r) => r.stageId === segment.stageId);
      const result = feedRowFor(candidates, dayOfStage);

      if ('error' in result) {
        flags.push({
          kind: result.error === 'NONE' ? 'NO_FEED_ROW' : 'OVERLAPPING_FEED_ROWS',
          batchNo: batch.batchNo,
          stageCode: segment.stageCode,
          day: dayOfStage,
          date,
        });
        continue;
      }

      const feedRow = result.row;
      const demand = round3(batch.heads * feedRow.kgPerHeadPerDay * (1 + feedRow.wastagePct / 100));

      const resolution = resolveSource(batch.shedId, feedRow.itemId);
      const sk = sourceKeyFor(resolution, feedRow.itemId);
      keyMeta.set(sk.key, sk);

      let byDate = demandByKeyByDate.get(sk.key);
      if (!byDate) {
        byDate = new Map();
        demandByKeyByDate.set(sk.key, byDate);
      }
      byDate.set(date, round3((byDate.get(date) ?? 0) + demand));

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
          rangeDemandKg: 0,
          perDayIntakeKg: demand,
          firstDemandDate: date,
        };
        rowAggs.set(aggKey, agg);
      }
      agg.rangeDemandKg = round3(agg.rangeDemandKg + demand);
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
  }
  const projectionByKey = new Map<string, KeyProjection>();

  for (const [key, sk] of keyMeta) {
    const byDate = demandByKeyByDate.get(key) ?? new Map<string, number>();
    const currentInventoryKg = balanceFor(sk);

    const sourceDailyDemandKg = byDate.get(input.planningDate) ?? 0;
    const daysLeft = sourceDailyDemandKg > 0 ? Math.floor(currentInventoryKg / sourceDailyDemandKg) : null;

    let remaining = currentInventoryKg;
    let runDownDate: string | null = null;
    for (const date of dates) {
      const demand = byDate.get(date) ?? 0;
      if (demand > 0 && remaining < demand) {
        runDownDate = date;
        break;
      }
      remaining -= demand;
    }

    const refillDate = runDownDate !== null ? addDays(runDownDate, -input.refillBufferDays) : null;
    const requiredOn = refillDate !== null ? addDays(refillDate, -input.leadTimeDays) : null;
    const overdue = requiredOn !== null && requiredOn < input.planningDate;

    projectionByKey.set(key, {
      currentInventoryKg,
      sourceDailyDemandKg,
      daysLeft,
      runDownDate,
      refillDate,
      requiredOn,
      overdue,
    });
  }

  const rows: ForecastRow[] = [];
  for (const agg of rowAggs.values()) {
    const projection = projectionByKey.get(agg.key)!;
    rows.push({
      batchNo: agg.batchNo,
      itemId: agg.itemId,
      itemName: input.items[agg.itemId] ?? agg.itemId,
      shedCode: agg.shedCode,
      planningDate: input.planningDate,
      sourceType: agg.sourceType,
      sourceCode: agg.sourceCode,
      currentInventoryKg: projection.currentInventoryKg,
      heads: agg.heads,
      perDayIntakeKg: agg.perDayIntakeKg,
      sourceDailyDemandKg: projection.sourceDailyDemandKg,
      daysLeft: projection.daysLeft,
      runDownDate: projection.runDownDate,
      refillDate: projection.refillDate,
      requiredOn: projection.requiredOn,
      overdue: projection.overdue,
      rangeDemandKg: agg.rangeDemandKg,
    });
  }

  const firstDemandByAggKey = new Map<string, string>();
  for (const [aggKey, agg] of rowAggs) firstDemandByAggKey.set(aggKey, agg.firstDemandDate);

  rows.sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
    const da = firstDemandByAggKey.get(`${a.batchNo}:${a.itemId}`) ?? '';
    const db = firstDemandByAggKey.get(`${b.batchNo}:${b.itemId}`) ?? '';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  return { rows, flags };
}

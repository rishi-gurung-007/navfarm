/**
 * Shared stage-day rule for breed_lifecycle_stages rows. A stage's calendar is
 * counted in stage-days from 1 (the day a batch enters the stage); calc_unit/
 * period_from/period_to say which stretch of those days a given row's standard
 * applies to. Both the scheduler (Task 5, one CONSUMPTION line per feed-bearing
 * row) and the forecast engine (Task 6, picking the day's diet) resolve that
 * stretch the same way, so the rule lives here once rather than twice.
 */

export type CalcUnit = 'DAY' | 'WEEK' | 'MONTH';

/** Stage days per calc_unit. MONTH = 30 — Rishi's decision (2026-09-25), not a placeholder. */
export const DAYS_PER_UNIT: Record<CalcUnit, number> = { DAY: 1, WEEK: 7, MONTH: 30 };

/**
 * Inclusive stage-day range a lifecycle row covers: WEEK 2-3 -> days 8-21
 * (week 1 is days 1-7, so week 2 starts at day 8; week 3 ends at day 21).
 * calc_unit is read as a free-form string, not the CalcUnit union, because it
 * comes off a varchar column — corrupt data (rows are validated on entry, so
 * this should never happen from the UI) throws naming the offending value
 * rather than silently defaulting.
 */
export function stageDayRange(
  calcUnit: string,
  periodFrom: number,
  periodTo: number,
): { fromDay: number; toDay: number } {
  const n = DAYS_PER_UNIT[calcUnit as CalcUnit];
  if (n === undefined) {
    throw new Error(`breed_lifecycle_stages.calc_unit must be DAY, WEEK or MONTH — got "${calcUnit}"`);
  }
  return { fromDay: (periodFrom - 1) * n + 1, toDay: periodTo * n };
}

/** One breed_lifecycle_stages row's feed standard, reduced to what feedRowFor needs. */
export interface FeedRow {
  lifecycleId: string;
  breedId: string;
  stageId: string;
  itemId: string;
  itemName: string | null;
  fromDay: number;
  toDay: number;
  kgPerHeadPerDay: number;
  wastagePct: number;
  /** Master Setup r30/r38: first calendar day this row applies. Absent/null = no start limit. */
  effectiveFrom?: string | null;
  /** Last calendar day (inclusive) this row applies. Absent/null = open-ended. */
  effectiveTo?: string | null;
  /** Master Setup r30/r39: a row for one farm overrides the default (null/absent) on that farm. */
  farmId?: string | null;
}

/** True when `onDate` (YYYY-MM-DD) falls in the row's effective window; a row with no dates is always effective. */
export function isEffectiveOn(row: Pick<FeedRow, 'effectiveFrom' | 'effectiveTo'>, onDate: string): boolean {
  if (row.effectiveFrom && onDate < row.effectiveFrom) return false;
  if (row.effectiveTo && onDate > row.effectiveTo) return false;
  return true;
}

/**
 * The single row covering dayOfStage, or an error kind when none or several
 * do. Matches purely by day range — if the caller hands it rows from more
 * than one breed/stage, that mixing is the caller's concern, not something
 * this function detects or guards against.
 */
export function feedRowFor(rows: FeedRow[], dayOfStage: number, onDate?: string, farmId?: string | null): { row: FeedRow } | { error: 'NONE' | 'OVERLAP' } {
  // onDate is the forecast date: with it, only rows effective that day compete (the one place effective dating is applied).
  const matches = rows.filter((r) => dayOfStage >= r.fromDay && dayOfStage <= r.toDay && (onDate === undefined || isEffectiveOn(r, onDate)));
  // Farm override (r30/r39): a row for this farm wins; otherwise the default (no farm). Rows of other farms never compete.
  const own = farmId ? matches.filter((r) => r.farmId === farmId) : [];
  const pool = own.length ? own : matches.filter((r) => !r.farmId);
  if (pool.length === 0) return { error: 'NONE' };
  if (pool.length > 1) return { error: 'OVERLAP' };
  return { row: pool[0] };
}

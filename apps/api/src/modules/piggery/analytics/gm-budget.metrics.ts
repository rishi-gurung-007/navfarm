/**
 * GM Dashboard Budget master: pure aggregation of budget lines and the variance rule (design spec, "Reading it",
 * "Colour" and "Settled after the builder check"). No database, no Nest.
 */
import { BudgetMetric, BudgetMetricCode } from '../budget/budget-metrics';

export interface BudgetLine {
  period_id: string;
  farm_id: string;
  metric_code: BudgetMetricCode;
  amount: number;
  tolerance_pct: number | null;
}

export interface BudgetFigure {
  budget: number | null;
  tolerance_pct: number | null;
  /** Farm codes (Month) or "<farm_code> <period_code>" (YTD) that have no line. */
  missing: string[];
}

export type VarianceStatus = 'GREEN' | 'AMBER' | 'RED' | null;

/** A blank tolerance counts as this many percent. */
const DEFAULT_TOLERANCE_PCT = 10;

const round = (value: number, places = 4) => Number(value.toFixed(places));
const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
const tol = (l: BudgetLine) => l.tolerance_pct ?? DEFAULT_TOLERANCE_PCT;

function figure(lines: BudgetLine[], metric: BudgetMetric, missing: string[], allowPartial: boolean): BudgetFigure {
  const tolerance_pct = round(lines.length ? mean(lines.map(tol)) : DEFAULT_TOLERANCE_PCT);
  if ((missing.length && !allowPartial) || !lines.length) return { budget: null, tolerance_pct, missing };
  const amounts = lines.map((l) => l.amount);
  const budget = metric.aggregation === 'SUM' ? amounts.reduce((a, v) => a + v, 0) : mean(amounts);
  return { budget: round(budget), tolerance_pct, missing };
}

export function monthBudget(
  lines: BudgetLine[],
  metric: BudgetMetric,
  periodId: string,
  farms: Array<{ farm_id: string; farm_code: string }>,
): BudgetFigure {
  const included: BudgetLine[] = [];
  const missing: string[] = [];
  for (const f of farms) {
    const l = lines.find(
      (x) => x.metric_code === metric.code && x.period_id === periodId && x.farm_id === f.farm_id,
    );
    if (l) included.push(l);
    else missing.push(f.farm_code);
  }
  return figure(included, metric, missing, false);
}

export function ytdBudget(
  lines: BudgetLine[],
  metric: BudgetMetric,
  periodIds: Array<{ period_id: string; period_code: string }>,
  farms: Array<{ farm_id: string; farm_code: string }>,
): BudgetFigure {
  const included: BudgetLine[] = [];
  const missing: string[] = [];
  const ratio = metric.aggregation === 'MEAN';
  let unbudgetedFarm = false;
  for (const f of farms) {
    const farmLines: BudgetLine[] = [];
    const farmMissing: string[] = [];
    for (const p of periodIds) {
      const l = lines.find(
        (x) => x.metric_code === metric.code && x.period_id === p.period_id && x.farm_id === f.farm_id,
      );
      if (l) farmLines.push(l);
      else farmMissing.push(`${f.farm_code} ${p.period_code}`);
    }
    if (ratio && !farmLines.length) {
      // A farm with no line in any period: the budget would cover fewer farms than the actual.
      unbudgetedFarm = true;
      missing.push(f.farm_code);
    } else {
      missing.push(...farmMissing);
    }
    included.push(...farmLines);
  }
  if (unbudgetedFarm) {
    const tolerance_pct = round(included.length ? mean(included.map(tol)) : DEFAULT_TOLERANCE_PCT);
    return { budget: null, tolerance_pct, missing };
  }
  return figure(included, metric, missing, ratio);
}

/** The inclusive day count between two "YYYY-MM-DD" dates, read at UTC midnight so no zone can shift it. */
const inclusiveDays = (start: string, end: string): number =>
  Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000) + 1;

/**
 * A custom date range's budget (19 Nov): no line is ever set against a range directly, so each Reporting Period it
 * overlaps contributes its own daily rate — that period's own budget divided by its own day count — for the days
 * of overlap. A SUM metric (a total, e.g. Pigs to Slaughter) accumulates those daily contributions; a MEAN metric
 * (a ratio or average, e.g. Avg CDM) instead time-weights the periods' own budgeted averages by the days each
 * contributes, since an average has no daily rate to sum. Null — not partial — the moment any overlapping period
 * itself has no budget line, the same as `monthBudget` already refuses a period missing just one farm's line.
 */
export function rangeBudget(
  lines: BudgetLine[],
  metric: BudgetMetric,
  periods: Array<{ period_id: string; period_code: string; start_date: string; end_date: string }>,
  from: string,
  to: string,
  farms: Array<{ farm_id: string; farm_code: string }>,
): BudgetFigure {
  const overlapping = periods.filter((p) => p.start_date <= to && p.end_date >= from);
  if (!overlapping.length) {
    return { budget: null, tolerance_pct: DEFAULT_TOLERANCE_PCT, missing: farms.map((f) => f.farm_code) };
  }
  let sumAccum = 0;
  let weightedSum = 0;
  let totalDays = 0;
  let anyMissing = false;
  const missing: string[] = [];
  const tolerances: number[] = [];
  for (const p of overlapping) {
    const overlapStart = p.start_date > from ? p.start_date : from;
    const overlapEnd = p.end_date < to ? p.end_date : to;
    const overlapDays = inclusiveDays(overlapStart, overlapEnd);
    const periodFigure = monthBudget(lines, metric, p.period_id, farms);
    if (periodFigure.tolerance_pct !== null) tolerances.push(periodFigure.tolerance_pct);
    if (periodFigure.budget === null) {
      anyMissing = true;
      periodFigure.missing.forEach((m) => missing.push(`${m} ${p.period_code}`));
      continue;
    }
    const periodDays = inclusiveDays(p.start_date, p.end_date);
    sumAccum += (periodFigure.budget / periodDays) * overlapDays;
    weightedSum += periodFigure.budget * overlapDays;
    totalDays += overlapDays;
  }
  const tolerance_pct = round(tolerances.length ? mean(tolerances) : DEFAULT_TOLERANCE_PCT);
  if (anyMissing || !totalDays) return { budget: null, tolerance_pct, missing };
  const budget = metric.aggregation === 'SUM' ? sumAccum : weightedSum / totalDays;
  return { budget: round(budget), tolerance_pct, missing: [] };
}

export function variance(
  actual: number | null,
  budget: number | null,
  metric: BudgetMetric,
  tolerancePct: number | null,
): { var: number | null; var_pct: number | null; status: VarianceStatus } {
  if (actual === null || budget === null) return { var: null, var_pct: null, status: null };
  const diff = actual - budget;
  const var_pct = metric.amountType === 'PERCENT' || budget === 0 ? null : round((diff / Math.abs(budget)) * 100);
  const favourable = metric.better === 'HIGHER' ? diff >= 0 : diff <= 0;
  let status: VarianceStatus;
  if (favourable) status = 'GREEN';
  else {
    const band = (Math.abs(budget) * (tolerancePct ?? DEFAULT_TOLERANCE_PCT)) / 100;
    status = Math.abs(diff) <= band + 1e-9 ? 'AMBER' : 'RED';
  }
  return { var: round(diff), var_pct, status };
}

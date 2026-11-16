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
  for (const p of periodIds) {
    for (const f of farms) {
      const l = lines.find(
        (x) => x.metric_code === metric.code && x.period_id === p.period_id && x.farm_id === f.farm_id,
      );
      if (l) included.push(l);
      else missing.push(`${f.farm_code} ${p.period_code}`);
    }
  }
  return figure(included, metric, missing, metric.aggregation === 'MEAN');
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

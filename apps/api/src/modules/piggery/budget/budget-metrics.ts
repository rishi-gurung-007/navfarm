/**
 * GM Dashboard Budget master: the fixed list of budgetable metrics and the rules for one budget entry. Kept as plain
 * values so they can be tested without a database. Additive metrics sum across farms and months, ratio metrics take
 * the mean (design spec, "Metrics"). The currency is the company's own, so currency amounts carry no unit text.
 */

export type BudgetMetricCode =
  | 'PIGS_TO_SLAUGHTER'
  | 'AVG_CDM'
  | 'COST_OF_SALES'
  | 'COS_PER_TONNE'
  | 'GROSS_MARGIN'
  | 'GROSS_MARGIN_PCT'
  | 'OTHER_OVERHEADS'
  | 'STAFF_OVERHEADS'
  | 'KG_SOLD_PER_SOW_YEAR'
  | 'PBT';

export interface BudgetMetric {
  code: BudgetMetricCode;
  label: string;
  unit: string;
  amountType: 'NUMBER' | 'PERCENT';
  aggregation: 'SUM' | 'MEAN';
  better: 'HIGHER' | 'LOWER';
  /** Smallest amount allowed. */
  min: number;
  /** Largest amount allowed, or null for no upper limit. */
  max: number | null;
  /** The dashboard row this metric is compared against. */
  dashboardKey: string;
}

const metric = (
  code: BudgetMetricCode,
  label: string,
  unit: string,
  amountType: BudgetMetric['amountType'],
  aggregation: BudgetMetric['aggregation'],
  better: BudgetMetric['better'],
  dashboardKey: string,
  min: number | null = 0,
  max: number | null = null,
): BudgetMetric => ({ code, label, unit, amountType, aggregation, better, min: min ?? Number.MIN_SAFE_INTEGER, max, dashboardKey });

export const BUDGET_METRICS: BudgetMetric[] = [
  metric('PIGS_TO_SLAUGHTER', 'Pigs to Slaughter', 'head', 'NUMBER', 'SUM', 'HIGHER', 'pigs_to_slaughter'),
  metric('AVG_CDM', 'Avg CDM', 'kg', 'NUMBER', 'MEAN', 'HIGHER', 'avg_cdm'),
  metric('COST_OF_SALES', 'Cost of Sales', '', 'NUMBER', 'SUM', 'LOWER', 'cost_of_sales'),
  metric('COS_PER_TONNE', 'COS per tonne', 'per tonne', 'NUMBER', 'MEAN', 'LOWER', 'cos_per_tonne'),
  metric('GROSS_MARGIN', 'Gross Margin', '', 'NUMBER', 'SUM', 'HIGHER', 'gross_margin', null),
  metric('GROSS_MARGIN_PCT', 'Gross Margin %', '%', 'PERCENT', 'MEAN', 'HIGHER', 'gross_margin_pct', -100, 100),
  metric('OTHER_OVERHEADS', 'Other Overheads', '', 'NUMBER', 'SUM', 'LOWER', 'other_overheads'),
  metric('STAFF_OVERHEADS', 'Staff Overheads', '', 'NUMBER', 'SUM', 'LOWER', 'staff_overheads'),
  metric('KG_SOLD_PER_SOW_YEAR', 'Kg Meat Sold / Sow / Year', 'kg', 'NUMBER', 'MEAN', 'HIGHER', 'kg_sold_per_sow_year'),
  metric('PBT', 'PBT', '', 'NUMBER', 'SUM', 'HIGHER', 'pbt', null),
];

export function budgetMetric(code: string): BudgetMetric | undefined {
  return BUDGET_METRICS.find((m) => m.code === code);
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Plain-words problems with one budget entry `{ metric_code, amount, tolerance_pct }`; empty means valid. */
export function budgetProblems(values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const m = budgetMetric(String(values.metric_code ?? ''));
  if (!m) {
    problems.push(`Metric must be one of ${BUDGET_METRICS.map((x) => x.code).join(', ')}.`);
  } else if (blank(values.amount) || !Number.isFinite(Number(values.amount))) {
    problems.push(`${m.label} needs a number as its budget.`);
  } else {
    const n = Number(values.amount);
    if (m.max !== null && (n < m.min || n > m.max)) {
      problems.push(`${m.label} budget must be between ${m.min} and ${m.max}.`);
    } else if (n < m.min) {
      problems.push(`${m.label} budget cannot be negative.`);
    }
  }
  if (!blank(values.tolerance_pct)) {
    const t = Number(values.tolerance_pct);
    if (!Number.isFinite(t) || t < 0 || t > 100) problems.push('Tolerance must be blank or between 0 and 100.');
  }
  return problems;
}

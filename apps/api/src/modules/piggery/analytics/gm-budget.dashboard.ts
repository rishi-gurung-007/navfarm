/**
 * GM Dashboard Budget master: the dashboard's budget section, assembled from the budget lines and the actuals the
 * dashboard already has (design spec, "Reading it", "Colour" and "Settled after the builder check"). Pure: the service
 * reads the lines in one query and calls this.
 */
import { BUDGET_METRICS, BudgetMetricCode } from '../budget/budget-metrics';
import { BudgetFigure, BudgetLine, monthBudget, variance, VarianceStatus, ytdBudget } from './gm-budget.metrics';
import { type MetricRow, type OverheadFigures, pbtOf, type SalesFigures } from './gm-dashboard.metrics';

export interface BudgetCell extends BudgetFigure {
  actual: number | null;
  var: number | null;
  var_pct: number | null;
  status: VarianceStatus;
}

/** Keyed first by farm id or 'all', then by the metric's dashboardKey. */
export interface GmBudgetSection {
  month: Record<string, Record<string, BudgetCell>>;
  ytd: Record<string, Record<string, BudgetCell>>;
  /**
   * The farms' (one chosen farm, or All farms) running budget over the business year: each period's value sums the
   * month budgets of the periods up to and including it; null from the first period missing a line for any farm.
   */
  by_period: Array<{ period_code: string; pigs_to_slaughter: number | null; pbt: number | null }>;
}

/** The actual of each metric that has one; a metric left out has no actual. */
export type BudgetActuals = Partial<Record<BudgetMetricCode, number | null>>;

/** The Slaughter & Financial rows of the web's matrix, with its keys, labels, units and directions. */
export const FINANCIAL_ROWS: Array<Pick<MetricRow, 'key' | 'label' | 'unit' | 'lower_is_better'>> = [
  { key: 'pigs_to_slaughter', label: 'Pigs to Slaughter', unit: '', lower_is_better: false },
  { key: 'avg_cdm', label: 'Avg CDM', unit: 'kg', lower_is_better: false },
  { key: 'cost_of_sales', label: 'Cost of Sales', unit: '', lower_is_better: true },
  { key: 'cos_per_tonne', label: 'COS $/tonne', unit: '', lower_is_better: true },
  { key: 'gross_margin', label: 'Gross Margin', unit: '', lower_is_better: false },
  { key: 'gross_margin_pct', label: 'Gross Margin %', unit: '%', lower_is_better: false },
  { key: 'other_overheads', label: 'Other Overheads', unit: '', lower_is_better: true },
  { key: 'staff_overheads', label: 'Staff Overheads', unit: '', lower_is_better: true },
];

/**
 * The actuals there are today: Pigs to Slaughter, Cost of Sales, Gross Margin and its % from the sold disposals, Kg Meat
 * Sold / Sow / Year, the two overheads from their GL accounts, and PBT (gross margin less the overheads). Avg CDM and
 * COS per tonne have none yet: they need the sold weight.
 */
export function budgetActuals(
  sales: SalesFigures | null,
  kgSoldPerSowYear: number | null,
  overheads: OverheadFigures | null = null,
  slaughter?: { avg_cdm: number | null; cos_per_tonne: number | null; heads?: number | null } | null,
): BudgetActuals {
  return {
    PIGS_TO_SLAUGHTER: sales?.heads ?? (slaughter?.heads && slaughter.heads > 0 ? slaughter.heads : null),
    AVG_CDM: slaughter?.avg_cdm ?? null,
    COST_OF_SALES: sales?.cost_of_sales ?? null,
    COS_PER_TONNE: slaughter?.cos_per_tonne ?? null,
    GROSS_MARGIN: sales?.gross_margin ?? null,
    GROSS_MARGIN_PCT: sales?.gross_margin_pct ?? null,
    KG_SOLD_PER_SOW_YEAR: kgSoldPerSowYear,
    OTHER_OVERHEADS: overheads?.other ?? null,
    STAFF_OVERHEADS: overheads?.staff ?? null,
    PBT: pbtOf(sales, overheads),
  };
}

export function budgetSection(args: {
  lines: BudgetLine[];
  /** The farms on the dashboard, already narrowed to the user's scope (and to the chosen farm). */
  farms: Array<{ farm_id: string; farm_code: string }>;
  /** The business year's periods, in order. */
  yearPeriods: Array<{ period_id: string; period_code: string }>;
  periodId: string;
  /** Keyed by farm id and 'all'. */
  actuals: { month: Record<string, BudgetActuals>; ytd: Record<string, BudgetActuals> };
}): { budget: GmBudgetSection; financialRows: MetricRow[] } {
  const { lines, farms, yearPeriods, periodId, actuals } = args;
  const at = yearPeriods.findIndex((p) => p.period_id === periodId);
  const toDate = at >= 0 ? yearPeriods.slice(0, at + 1) : yearPeriods.filter((p) => p.period_id === periodId);
  const keys: Array<[string, Array<{ farm_id: string; farm_code: string }>]> = [
    ['all', farms],
    ...farms.map((f): [string, typeof farms] => [f.farm_id, [f]]),
  ];

  const cellOf = (figure: BudgetFigure, actual: number | null, metric: (typeof BUDGET_METRICS)[number]): BudgetCell => ({
    ...figure,
    actual,
    ...variance(actual, figure.budget, metric, figure.tolerance_pct),
  });
  const month: GmBudgetSection['month'] = {};
  const ytd: GmBudgetSection['ytd'] = {};
  for (const [key, inKey] of keys) {
    month[key] = {};
    ytd[key] = {};
    for (const metric of BUDGET_METRICS) {
      month[key][metric.dashboardKey] = cellOf(
        monthBudget(lines, metric, periodId, inKey),
        actuals.month[key]?.[metric.code] ?? null,
        metric,
      );
      ytd[key][metric.dashboardKey] = cellOf(
        ytdBudget(lines, metric, toDate, inKey),
        actuals.ytd[key]?.[metric.code] ?? null,
        metric,
      );
    }
  }

  const pigs = BUDGET_METRICS.find((m) => m.code === 'PIGS_TO_SLAUGHTER')!;
  const pbt = BUDGET_METRICS.find((m) => m.code === 'PBT')!;
  // A running total, like the chart's actual: once a period lacks a line for a farm, it and every later period are null.
  const running = { pigs: 0 as number | null, pbt: 0 as number | null };
  const add = (sum: number | null, month: number | null) =>
    sum === null || month === null ? null : Number((sum + month).toFixed(4));
  const by_period = yearPeriods.map((p) => {
    running.pigs = add(running.pigs, monthBudget(lines, pigs, p.period_id, farms).budget);
    running.pbt = add(running.pbt, monthBudget(lines, pbt, p.period_id, farms).budget);
    return { period_code: p.period_code, pigs_to_slaughter: running.pigs, pbt: running.pbt };
  });

  const financialRows: MetricRow[] = FINANCIAL_ROWS.map((row) => ({
    ...row,
    cells: Object.fromEntries(
      farms.map((f) => {
        const c = month[f.farm_id][row.key];
        return [f.farm_id, { value: c.actual, target: c.budget, status: c.status }];
      }),
    ),
  }));

  return { budget: { month, ytd, by_period }, financialRows };
}

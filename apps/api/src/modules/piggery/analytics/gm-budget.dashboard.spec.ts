import { BudgetLine } from './gm-budget.metrics';
import { budgetActuals, budgetSection, FINANCIAL_ROWS } from './gm-budget.dashboard';
import { alertsFrom } from './gm-dashboard.metrics';

const line = (
  farm: string,
  period: string,
  code: string,
  amount: number,
  tol: number | null = null,
): BudgetLine => ({
  period_id: period,
  farm_id: farm,
  metric_code: code as BudgetLine['metric_code'],
  amount,
  tolerance_pct: tol,
});
const farms = [
  { farm_id: 'f1', farm_code: 'F1', farm_name: 'Farm One' },
  { farm_id: 'f2', farm_code: 'F2', farm_name: 'Farm Two' },
];
const yearPeriods = [
  { period_id: 'p1', period_code: '2026-07' },
  { period_id: 'p2', period_code: '2026-08' },
  { period_id: 'p3', period_code: '2026-09' },
];
const sales = (heads: number, cost: number, margin: number, pct: number | null) => ({
  heads,
  cost_of_sales: cost,
  revenue: cost + margin,
  gross_margin: margin,
  gross_margin_pct: pct,
});

/** f1 sold 100 heads in p2 and 180 over the year; f2 sold 50 and 90. */
const actuals = {
  month: {
    f1: budgetActuals(sales(100, 1000, 300, 23.08), 2000),
    f2: budgetActuals(sales(50, 500, 100, 16.67), 1800),
    all: budgetActuals(sales(150, 1500, 400, 21.05), 1900),
  },
  ytd: {
    f1: budgetActuals(sales(180, 1900, 500, 20.83), 2100),
    f2: budgetActuals(sales(90, 950, 150, 13.64), 1700),
    all: budgetActuals(sales(270, 2850, 650, 18.57), 1950),
  },
};
const lines: BudgetLine[] = [
  line('f1', 'p1', 'PIGS_TO_SLAUGHTER', 90),
  line('f1', 'p2', 'PIGS_TO_SLAUGHTER', 120),
  line('f2', 'p1', 'PIGS_TO_SLAUGHTER', 40),
  line('f2', 'p2', 'PIGS_TO_SLAUGHTER', 45),
  line('f1', 'p2', 'AVG_CDM', 80),
  line('f2', 'p2', 'AVG_CDM', 70),
  line('f1', 'p2', 'COST_OF_SALES', 950, 5),
  line('f1', 'p2', 'PBT', 200),
  line('f2', 'p2', 'PBT', 100),
  line('f1', 'p3', 'PIGS_TO_SLAUGHTER', 130),
];
const section = (over: Partial<Parameters<typeof budgetSection>[0]> = {}) =>
  budgetSection({ lines, farms, yearPeriods, periodId: 'p2', actuals, ...over });

describe('budgetSection (GM Dashboard Budget master, Task 5)', () => {
  it('Month and YTD cells carry budget, actual, var and status for a farm and for all', () => {
    const { budget } = section();
    expect(budget.month.f1.pigs_to_slaughter).toEqual({
      budget: 120,
      tolerance_pct: 10,
      missing: [],
      actual: 100,
      var: -20,
      var_pct: -16.6667,
      status: 'RED',
    });
    expect(budget.ytd.f1.pigs_to_slaughter).toMatchObject({ budget: 210, actual: 180, var: -30, status: 'RED' });
    expect(budget.month.all.pigs_to_slaughter).toMatchObject({ budget: 165, actual: 150, var: -15, status: 'AMBER' });
    expect(budget.ytd.all.pigs_to_slaughter).toMatchObject({ budget: 295, actual: 270, var: -25, status: 'AMBER' });
    // A lower-is-better metric over budget by 50 on 950 with a 5 % tolerance (47.5): red.
    expect(budget.month.f1.cost_of_sales).toMatchObject({ budget: 950, tolerance_pct: 5, actual: 1000, var: 50, status: 'RED' });
  });

  it('a metric with no actual (Avg CDM) has a budget and a null var', () => {
    const { budget } = section();
    expect(budget.month.f1.avg_cdm).toEqual({
      budget: 80,
      tolerance_pct: 10,
      missing: [],
      actual: null,
      var: null,
      var_pct: null,
      status: null,
    });
    expect(budget.month.all.avg_cdm).toMatchObject({ budget: 75, actual: null, var: null, status: null });
  });

  it('a farm the user cannot see is left out of All farms', () => {
    const withHidden = [...lines, line('f9', 'p2', 'PIGS_TO_SLAUGHTER', 1000)];
    const { budget } = section({ lines: withHidden });
    expect(budget.month.all.pigs_to_slaughter.budget).toBe(165);
    expect(budget.month.f9).toBeUndefined();
  });

  it('no lines gives null budgets, never 0', () => {
    const { budget, financialRows } = section({ lines: [] });
    for (const key of ['f1', 'f2', 'all']) {
      for (const cell of Object.values(budget.month[key])) expect(cell.budget).toBeNull();
      for (const cell of Object.values(budget.ytd[key])) expect(cell.budget).toBeNull();
    }
    expect(budget.month.f1.pigs_to_slaughter).toMatchObject({ actual: 100, var: null, var_pct: null, status: null });
    expect(budget.by_period.every((p) => p.pigs_to_slaughter === null && p.pbt === null)).toBe(true);
    for (const row of financialRows) for (const c of Object.values(row.cells)) expect(c.target).toBeNull();
  });

  it('a partial All farms is null with the missing farm named', () => {
    const { budget } = section();
    expect(budget.month.all.cost_of_sales.budget).toBeNull();
    expect(budget.month.all.cost_of_sales.missing).toEqual(['F2']);
    expect(budget.month.all.cost_of_sales.status).toBeNull();
  });

  it('the first period of its business year makes YTD equal Month', () => {
    const { budget } = section({ periodId: 'p1' });
    expect(budget.ytd.f1.pigs_to_slaughter.budget).toBe(90);
    expect(budget.ytd.f1.pigs_to_slaughter.budget).toBe(budget.month.f1.pigs_to_slaughter.budget);
    expect(budget.ytd.all.pigs_to_slaughter.budget).toBe(budget.month.all.pigs_to_slaughter.budget);
  });

  it('by_period carries the farms\' Pigs to Slaughter and PBT month budget for every period of the year', () => {
    expect(section().budget.by_period).toEqual([
      { period_code: '2026-07', pigs_to_slaughter: 130, pbt: null },
      { period_code: '2026-08', pigs_to_slaughter: 165, pbt: 300 },
      { period_code: '2026-09', pigs_to_slaughter: null, pbt: null },
    ]);
    const one = section({ farms: [farms[0]] }).budget.by_period;
    expect(one.map((p) => p.pigs_to_slaughter)).toEqual([90, 120, 130]);
  });

  it('builds the eight Slaughter & Financial rows from the Month cells, one cell per farm', () => {
    const { financialRows } = section();
    expect(financialRows.map((r) => [r.key, r.label, r.unit, r.lower_is_better])).toEqual([
      ['pigs_to_slaughter', 'Pigs to Slaughter', '', false],
      ['avg_cdm', 'Avg CDM', 'kg', false],
      ['cost_of_sales', 'Cost of Sales', '', true],
      ['cos_per_tonne', 'COS $/tonne', '', true],
      ['gross_margin', 'Gross Margin', '', false],
      ['gross_margin_pct', 'Gross Margin %', '%', false],
      ['other_overheads', 'Other Overheads', '', true],
      ['staff_overheads', 'Staff Overheads', '', true],
    ]);
    expect(FINANCIAL_ROWS).toHaveLength(8);
    const pigs = financialRows[0];
    expect(Object.keys(pigs.cells).sort()).toEqual(['f1', 'f2']);
    expect(pigs.cells.f1).toEqual({ value: 100, target: 120, status: 'RED' });
    expect(pigs.cells.f2).toEqual({ value: 50, target: 45, status: 'GREEN' });
  });

  it('a RED financial row reaches the alerts', () => {
    const { financialRows } = section();
    const alerts = alertsFrom(financialRows, farms);
    expect(alerts).toContainEqual(
      expect.objectContaining({ farm_id: 'f1', metric: 'Pigs to Slaughter', value: 100, target: 120, status: 'RED' }),
    );
    expect(alerts).toContainEqual(expect.objectContaining({ farm_id: 'f1', metric: 'Cost of Sales', status: 'RED' }));
    // Avg CDM has a budget but no actual: no colour, no alert.
    expect(alerts.some((a) => a.metric === 'Avg CDM')).toBe(false);
  });
});

describe('budgetActuals', () => {
  it('takes heads, cost of sales, gross margin and its % from the sales figures and kg from the kg figure', () => {
    expect(budgetActuals(sales(10, 100, 30, 23.08), 1500)).toEqual({
      PIGS_TO_SLAUGHTER: 10,
      COST_OF_SALES: 100,
      GROSS_MARGIN: 30,
      GROSS_MARGIN_PCT: 23.08,
      KG_SOLD_PER_SOW_YEAR: 1500,
    });
  });

  it('no sale gives null actuals, never 0', () => {
    expect(budgetActuals(null, null)).toEqual({
      PIGS_TO_SLAUGHTER: null,
      COST_OF_SALES: null,
      GROSS_MARGIN: null,
      GROSS_MARGIN_PCT: null,
      KG_SOLD_PER_SOW_YEAR: null,
    });
  });
});

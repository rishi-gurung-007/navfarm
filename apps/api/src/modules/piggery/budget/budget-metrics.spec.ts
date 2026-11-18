import { BUDGET_METRICS, budgetMetric, budgetProblems } from './budget-metrics';

describe('budget metrics', () => {
  it("catalogue holds the ten metrics with the spec's type, aggregation and direction", () => {
    const rows = BUDGET_METRICS.map((m) => [m.code, m.dashboardKey, m.amountType, m.aggregation, m.better]);
    expect(rows).toEqual([
      ['PIGS_TO_SLAUGHTER', 'pigs_to_slaughter', 'NUMBER', 'SUM', 'HIGHER'],
      ['AVG_CDM', 'avg_cdm', 'NUMBER', 'MEAN', 'HIGHER'],
      ['COST_OF_SALES', 'cost_of_sales', 'NUMBER', 'SUM', 'LOWER'],
      ['COS_PER_TONNE', 'cos_per_tonne', 'NUMBER', 'MEAN', 'LOWER'],
      ['GROSS_MARGIN', 'gross_margin', 'NUMBER', 'SUM', 'HIGHER'],
      ['GROSS_MARGIN_PCT', 'gross_margin_pct', 'PERCENT', 'MEAN', 'HIGHER'],
      ['OTHER_OVERHEADS', 'other_overheads', 'NUMBER', 'SUM', 'LOWER'],
      ['STAFF_OVERHEADS', 'staff_overheads', 'NUMBER', 'SUM', 'LOWER'],
      ['KG_SOLD_PER_SOW_YEAR', 'kg_sold_per_sow_year', 'NUMBER', 'MEAN', 'HIGHER'],
      ['PBT', 'pbt', 'NUMBER', 'SUM', 'HIGHER'],
    ]);
    expect(budgetMetric('PBT')?.code).toBe('PBT');
    expect(budgetMetric('NOPE')).toBeUndefined();
  });

  it('rejects an unknown metric', () => {
    const p = budgetProblems({ metric_code: 'NOPE', amount: 5 });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/metric/i);
    expect(budgetProblems({ amount: 5 })).toHaveLength(1);
  });

  it('rejects a negative amount for COST_OF_SALES but allows it for GROSS_MARGIN and PBT', () => {
    const p = budgetProblems({ metric_code: 'COST_OF_SALES', amount: -1 });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/Cost of Sales/);
    expect(budgetProblems({ metric_code: 'GROSS_MARGIN', amount: -1 })).toEqual([]);
    expect(budgetProblems({ metric_code: 'PBT', amount: -50000 })).toEqual([]);
  });

  it('GROSS_MARGIN_PCT allows -100 and 100, rejects 100.01 and -100.01', () => {
    expect(budgetProblems({ metric_code: 'GROSS_MARGIN_PCT', amount: 100 })).toEqual([]);
    expect(budgetProblems({ metric_code: 'GROSS_MARGIN_PCT', amount: -100 })).toEqual([]);
    expect(budgetProblems({ metric_code: 'GROSS_MARGIN_PCT', amount: 100.01 })).toHaveLength(1);
    const p = budgetProblems({ metric_code: 'GROSS_MARGIN_PCT', amount: -100.01 });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/-100 and 100/);
  });

  it('allows an amount of 0', () => {
    for (const m of BUDGET_METRICS) expect(budgetProblems({ metric_code: m.code, amount: 0 })).toEqual([]);
    expect(budgetProblems({ metric_code: 'OTHER_OVERHEADS', amount: '0' })).toEqual([]);
  });

  it('rejects a non-numeric amount', () => {
    expect(budgetProblems({ metric_code: 'PBT', amount: 'abc' })).toHaveLength(1);
    expect(budgetProblems({ metric_code: 'PBT', amount: '' })).toHaveLength(1);
    expect(budgetProblems({ metric_code: 'PBT', amount: null })).toHaveLength(1);
    expect(budgetProblems({ metric_code: 'PBT', amount: Infinity })).toHaveLength(1);
    expect(budgetProblems({ metric_code: 'PBT' })).toHaveLength(1);
  });

  it('tolerance must be blank or 0-100', () => {
    const base = { metric_code: 'PBT', amount: 10 };
    expect(budgetProblems({ ...base, tolerance_pct: null })).toEqual([]);
    expect(budgetProblems({ ...base, tolerance_pct: '' })).toEqual([]);
    expect(budgetProblems({ ...base, tolerance_pct: 0 })).toEqual([]);
    expect(budgetProblems({ ...base, tolerance_pct: 100 })).toEqual([]);
    expect(budgetProblems({ ...base, tolerance_pct: -1 })).toHaveLength(1);
    expect(budgetProblems({ ...base, tolerance_pct: 100.5 })).toHaveLength(1);
    expect(budgetProblems({ ...base, tolerance_pct: 'x' })).toHaveLength(1);
  });
});

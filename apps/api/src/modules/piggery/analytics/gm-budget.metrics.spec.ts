import { BUDGET_METRICS, BudgetMetric } from '../budget/budget-metrics';
import { BudgetLine, monthBudget, rangeBudget, ytdBudget, variance } from './gm-budget.metrics';

const m = (code: string): BudgetMetric => BUDGET_METRICS.find((x) => x.code === code)!;
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
  { farm_id: 'f1', farm_code: 'F1' },
  { farm_id: 'f2', farm_code: 'F2' },
];

describe('monthBudget', () => {
  it('month budget of one farm is its line', () => {
    const r = monthBudget([line('f1', 'p1', 'GROSS_MARGIN', 100)], m('GROSS_MARGIN'), 'p1', [farms[0]]);
    expect(r).toEqual({ budget: 100, tolerance_pct: 10, missing: [] });
  });

  it('All farms sums an additive metric and means a ratio metric', () => {
    const add = [line('f1', 'p1', 'GROSS_MARGIN', 100), line('f2', 'p1', 'GROSS_MARGIN', 50)];
    expect(monthBudget(add, m('GROSS_MARGIN'), 'p1', farms).budget).toBe(150);
    const ratio = [line('f1', 'p1', 'GROSS_MARGIN_PCT', 30), line('f2', 'p1', 'GROSS_MARGIN_PCT', 40)];
    expect(monthBudget(ratio, m('GROSS_MARGIN_PCT'), 'p1', farms).budget).toBe(35);
  });

  it('a farm without a line makes All farms null and names it', () => {
    const r = monthBudget([line('f1', 'p1', 'GROSS_MARGIN', 100)], m('GROSS_MARGIN'), 'p1', farms);
    expect(r.budget).toBeNull();
    expect(r.missing).toEqual(['F2']);
  });

  it('tolerance blank counts as 10, and the aggregate tolerance is the mean of the lines (blank as 10)', () => {
    const ls = [line('f1', 'p1', 'GROSS_MARGIN', 100, 4), line('f2', 'p1', 'GROSS_MARGIN', 50, null)];
    expect(monthBudget(ls, m('GROSS_MARGIN'), 'p1', farms).tolerance_pct).toBe(7);
    const blank = [line('f1', 'p1', 'GROSS_MARGIN', 100)];
    expect(monthBudget(blank, m('GROSS_MARGIN'), 'p1', [farms[0]]).tolerance_pct).toBe(10);
  });
});

describe('ytdBudget', () => {
  const periods = [
    { period_id: 'p1', period_code: '2026-01' },
    { period_id: 'p2', period_code: '2026-02' },
  ];

  it('additive YTD needs every period; ratio YTD means the lines present', () => {
    const add = [line('f1', 'p1', 'GROSS_MARGIN', 100), line('f1', 'p2', 'GROSS_MARGIN', 60)];
    expect(ytdBudget(add, m('GROSS_MARGIN'), periods, [farms[0]]).budget).toBe(160);
    const r = ytdBudget([add[0]], m('GROSS_MARGIN'), periods, [farms[0]]);
    expect(r.budget).toBeNull();
    expect(r.missing).toEqual(['F1 2026-02']);

    const ratio = [line('f1', 'p1', 'GROSS_MARGIN_PCT', 30)];
    expect(ytdBudget(ratio, m('GROSS_MARGIN_PCT'), periods, [farms[0]]).budget).toBe(30);
    expect(ytdBudget([], m('GROSS_MARGIN_PCT'), periods, [farms[0]]).budget).toBeNull();
  });

  it('ratio YTD is null when a farm has no line in any period, and names it', () => {
    const ls = [line('f1', 'p1', 'GROSS_MARGIN_PCT', 30), line('f1', 'p2', 'GROSS_MARGIN_PCT', 40)];
    const r = ytdBudget(ls, m('GROSS_MARGIN_PCT'), periods, farms);
    expect(r.budget).toBeNull();
    expect(r.missing).toEqual(['F2']);
  });

  it('ratio YTD with every farm budgeted but a period missing stays non-null and names the period', () => {
    const ls = [
      line('f1', 'p1', 'GROSS_MARGIN_PCT', 30),
      line('f1', 'p2', 'GROSS_MARGIN_PCT', 40),
      line('f2', 'p1', 'GROSS_MARGIN_PCT', 20),
    ];
    const r = ytdBudget(ls, m('GROSS_MARGIN_PCT'), periods, farms);
    expect(r.budget).toBe(30);
    expect(r.missing).toEqual(['F2 2026-02']);
  });

  it('YTD of the first period equals its Month', () => {
    const ls = [line('f1', 'p1', 'GROSS_MARGIN', 100), line('f2', 'p1', 'GROSS_MARGIN', 50)];
    expect(ytdBudget(ls, m('GROSS_MARGIN'), [periods[0]], farms)).toEqual(
      monthBudget(ls, m('GROSS_MARGIN'), 'p1', farms),
    );
  });
});

describe('rangeBudget', () => {
  // p1: 1–10 Oct (10 days), p2: 11–20 Oct (10 days).
  const p1 = { period_id: 'p1', period_code: '2026-10', start_date: '2026-10-01', end_date: '2026-10-10' };
  const p2 = { period_id: 'p2', period_code: '2026-11', start_date: '2026-10-11', end_date: '2026-10-20' };

  it('a range inside one period accumulates its daily rate for a SUM metric', () => {
    const lines = [line('f1', 'p1', 'GROSS_MARGIN', 100)];
    // 100 over 10 days = 10/day; 5 days (01–05) = 50.
    const r = rangeBudget(lines, m('GROSS_MARGIN'), [p1, p2], '2026-10-01', '2026-10-05', [farms[0]]);
    expect(r).toEqual({ budget: 50, tolerance_pct: 10, missing: [] });
  });

  it('a range spanning two periods sums each one\'s own daily rate for the days it overlaps', () => {
    const lines = [line('f1', 'p1', 'GROSS_MARGIN', 100), line('f1', 'p2', 'GROSS_MARGIN', 200)];
    // p1: 10/day × 5 days (06–10) = 50. p2: 20/day × 5 days (11–15) = 100. Total 150.
    const r = rangeBudget(lines, m('GROSS_MARGIN'), [p1, p2], '2026-10-06', '2026-10-15', [farms[0]]);
    expect(r.budget).toBe(150);
  });

  it('a MEAN metric time-weights each period\'s own budgeted average by the days it overlaps, not a daily rate', () => {
    const lines = [line('f1', 'p1', 'GROSS_MARGIN_PCT', 30), line('f1', 'p2', 'GROSS_MARGIN_PCT', 40)];
    // Half the range in p1 (30%), half in p2 (40%): the time-weighted average is 35%, not a summed rate.
    const r = rangeBudget(lines, m('GROSS_MARGIN_PCT'), [p1, p2], '2026-10-06', '2026-10-15', [farms[0]]);
    expect(r.budget).toBe(35);
  });

  it('is null — not partial — the moment any overlapping period is missing a line, and names it', () => {
    const lines = [line('f1', 'p1', 'GROSS_MARGIN', 100), line('f1', 'p2', 'GROSS_MARGIN', 200)];
    const r = rangeBudget(lines, m('GROSS_MARGIN'), [p1, p2], '2026-10-06', '2026-10-15', farms);
    expect(r.budget).toBeNull();
    expect(r.missing).toEqual(['F2 2026-10', 'F2 2026-11']);
  });

  it('no period overlaps the range: null, every farm missing', () => {
    const r = rangeBudget([], m('GROSS_MARGIN'), [p1, p2], '2026-12-01', '2026-12-10', farms);
    expect(r).toEqual({ budget: null, tolerance_pct: 10, missing: ['F1', 'F2'] });
  });
});

describe('variance', () => {
  it('variance is actual minus budget and % of |budget|', () => {
    expect(variance(110, 100, m('GROSS_MARGIN'), 10)).toEqual({ var: 10, var_pct: 10, status: 'GREEN' });
  });

  it('budget 0 gives var_pct null and green when favourable or equal, red otherwise', () => {
    expect(variance(5, 0, m('GROSS_MARGIN'), 10)).toEqual({ var: 5, var_pct: null, status: 'GREEN' });
    expect(variance(0, 0, m('GROSS_MARGIN'), 10).status).toBe('GREEN');
    expect(variance(-1, 0, m('GROSS_MARGIN'), 10).status).toBe('RED');
  });

  it('a LOWER metric with budget 0: actual 0 is GREEN with var_pct null, any spend is RED', () => {
    const o = m('OTHER_OVERHEADS');
    expect(variance(0, 0, o, 10)).toEqual({ var: 0, var_pct: null, status: 'GREEN' });
    expect(variance(5, 0, o, 10)).toEqual({ var: 5, var_pct: null, status: 'RED' });
  });

  it('negative GROSS_MARGIN budget uses |budget| for tolerance', () => {
    const r = variance(-105, -100, m('GROSS_MARGIN'), 10);
    expect(r.var).toBe(-5);
    expect(r.var_pct).toBe(-5);
    expect(r.status).toBe('AMBER');
    expect(variance(-120, -100, m('GROSS_MARGIN'), 10).status).toBe('RED');
  });

  it('cost metric below budget is GREEN, above within 10% AMBER, beyond RED', () => {
    const c = m('COST_OF_SALES');
    expect(variance(90, 100, c, 10).status).toBe('GREEN');
    expect(variance(108, 100, c, 10).status).toBe('AMBER');
    expect(variance(110, 100, c, 10).status).toBe('AMBER');
    expect(variance(115, 100, c, 10).status).toBe('RED');
  });

  it('GROSS_MARGIN_PCT 35.4 vs 32.0 is +3.4 points GREEN', () => {
    expect(variance(35.4, 32.0, m('GROSS_MARGIN_PCT'), 10)).toEqual({ var: 3.4, var_pct: null, status: 'GREEN' });
  });

  it('no actual or no budget gives no colour', () => {
    expect(variance(null, 100, m('GROSS_MARGIN'), 10)).toEqual({ var: null, var_pct: null, status: null });
    expect(variance(100, null, m('GROSS_MARGIN'), 10)).toEqual({ var: null, var_pct: null, status: null });
  });

  it('a null tolerance counts as 10', () => {
    expect(variance(91, 100, m('GROSS_MARGIN'), null).status).toBe('AMBER');
    expect(variance(89, 100, m('GROSS_MARGIN'), null).status).toBe('RED');
  });
});

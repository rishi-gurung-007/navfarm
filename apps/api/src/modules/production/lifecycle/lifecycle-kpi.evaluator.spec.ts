import { LifecycleKpiEvaluator, actualForPeriod, effectivePeriod, evaluateLifecycleKpiLine, isoWeekKey, periodWindow, type KpiValue } from './lifecycle-kpi.evaluator';

const v = (date: string, value: number): KpiValue => ({ date, value });

describe('lifecycle KPI pure rules', () => {
  it('line period wins, then header, then DAILY', () => {
    expect(effectivePeriod({ kpi_period: 'WEEKLY' }, 'MONTHLY')).toBe('WEEKLY');
    expect(effectivePeriod({ kpi_period: null }, 'MONTHLY')).toBe('MONTHLY');
    expect(effectivePeriod({}, null)).toBe('DAILY');
  });

  it('keys: date, ISO week (year boundary), month', () => {
    expect(periodWindow('DAILY', '2026-10-12')).toEqual({ from: '2026-10-12', key: '2026-10-12' });
    expect(periodWindow('WEEKLY', '2026-10-14')).toEqual({ from: '2026-10-12', key: '2026-W42' });
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(periodWindow('MONTHLY', '2026-10-12')).toEqual({ from: '2026-10-01', key: '2026-10' });
  });

  it('DAILY uses that day only; WEEKLY averages Monday..date; MONTHLY averages the month to date', () => {
    const vals = [v('2026-10-11', 100), v('2026-10-12', 10), v('2026-10-13', 20), v('2026-10-14', 30), v('2026-10-15', 999), v('2026-09-30', 500)];
    expect(actualForPeriod(vals, 'DAILY', '2026-10-13')?.actual).toBe(20);
    expect(actualForPeriod(vals, 'WEEKLY', '2026-10-14')).toEqual({ actual: 20, key: '2026-W42' }); // 12,13,14
    expect(actualForPeriod(vals, 'MONTHLY', '2026-10-14')?.actual).toBeCloseTo((100 + 10 + 20 + 30) / 4);
    expect(actualForPeriod(vals, 'DAILY', '2026-10-20')).toBeNull();
  });

  it('lower / upper limits fire only when set', () => {
    const line = { metric: 'ADG', lower_limit: 450, upper_limit: 700, severity: 'CRITICAL' };
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 449)], '2026-10-12').map((b) => [b.rule, b.severity])).toEqual([['LOWER_LIMIT', 'CRITICAL']]);
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 701)], '2026-10-12').map((b) => b.rule)).toEqual(['UPPER_LIMIT']);
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 450)], '2026-10-12')).toEqual([]);
    expect(evaluateLifecycleKpiLine({ metric: 'ADG', upper_limit: 5 }, null, [v('2026-10-12', 0)], '2026-10-12')).toEqual([]);
  });

  it('UPPER tolerance fires above +5% and not at +4%', () => {
    const line = { metric: 'FCR', average_value: 100, tolerance_pct: 5, tolerance_type: 'UPPER' };
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 104)], '2026-10-12')).toEqual([]);
    const b = evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 106)], '2026-10-12');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ rule: 'TOLERANCE', direction: 'above', severity: 'WARNING' });
    expect(b[0].message).toContain('5% UPPER');
    // UPPER tolerance does not care about a low value
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 50)], '2026-10-12')).toEqual([]);
  });

  it('LOWER tolerance fires below -5% and not at -4%', () => {
    const line = { metric: 'ADG', average_value: 100, tolerance_pct: 5, tolerance_type: 'LOWER' };
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 96)], '2026-10-12')).toEqual([]);
    expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', 94)], '2026-10-12')[0]).toMatchObject({ rule: 'TOLERANCE', direction: 'below' });
  });

  it('tolerance needs the average, the percent and the type', () => {
    for (const l of [{ tolerance_pct: 5, tolerance_type: 'UPPER' }, { average_value: 100, tolerance_type: 'UPPER' }, { average_value: 100, tolerance_pct: 5 }]) {
      expect(evaluateLifecycleKpiLine({ metric: 'X', ...l }, null, [v('2026-10-12', 1000)], '2026-10-12')).toEqual([]);
    }
  });

  it('a weekly line judges the weekly average, not the single day', () => {
    const line = { metric: 'ADG', upper_limit: 100, kpi_period: 'WEEKLY' };
    const vals = [v('2026-10-12', 50), v('2026-10-13', 160)]; // avg 105 > 100 on the 13th; day alone would be 160
    expect(evaluateLifecycleKpiLine(line, null, vals, '2026-10-12')).toEqual([]);
    expect(evaluateLifecycleKpiLine(line, null, vals, '2026-10-13')[0]).toMatchObject({ period: 'WEEKLY', periodKey: '2026-W42', actual: 105 });
  });
});

// A queue-driven fake of the drizzle select chain: every select() consumes the next answer; the chain is
// awaitable at .where()/.orderBy() and also offers .limit() and .innerJoin().
function fakeDb(answers: unknown[][]) {
  const inserted: any[] = [];
  const next = () => answers.shift() ?? [];
  const chain = (): any => {
    const rows = next();
    const c: any = {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      limit: () => Promise.resolve(rows),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return c;
  };
  return { db: { select: () => chain(), insert: () => ({ values: (x: any) => { inserted.push(x); return Promise.resolve(); } }) }, inserted };
}

describe('LifecycleKpiEvaluator', () => {
  const batch = { batch_id: 'b1', batch_no: 'FIN-001', company_id: 'c1', lob_id: 'l1', farm_id: 'f1' };
  const header = { scheduler_id: 'sc1', breed_id: 'br1', stage_id: 's1', effective_from: '2026-10-01' };
  const stageRow = (kpis: unknown[], extra: Record<string, unknown> = {}) => ({
    lifecycle_id: 'lc1', breed_id: 'br1', stage_id: 's1', calc_unit: 'DAY', period_from: 1, period_to: 60,
    feed_item_id: null, effective_from: null, effective_to: null, farm_id: null, kpi_thresholds: kpis, kpi_alert_period: null, ...extra,
  });
  const make = (answers: unknown[][]) => {
    const { db, inserted } = fakeDb(answers);
    const ev = new LifecycleKpiEvaluator({ get: () => db } as any);
    return { ev, inserted };
  };

  it('writes a LIFECYCLE_KPI alert naming batch, KPI, actual, tolerance, direction, period', async () => {
    // batch, headers, lifecycle rows, daily data, dedupe lookup (none)
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 100, tolerance_pct: 5, tolerance_type: 'UPPER', kpi_period: 'DAILY', severity: 'CRITICAL' }])], [{ metric: 'ADG', date: '2026-10-12', value: '110.000000' }], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
    expect(inserted[0]).toMatchObject({ alert_type: 'LIFECYCLE_KPI', severity: 'CRITICAL', batch_id: 'b1', tenant_id: 't1', activity_name: 'ADG', kpi_mode: 'TOL_UPPER', actual_value: '110' });
    expect(inserted[0].message).toContain('FIN-001');
    expect(inserted[0].message).toContain('5% UPPER');
    expect(inserted[0].message).toContain('Period: DAILY 2026-10-12.');
  });

  it('does not alert twice for the same batch + metric + rule + period', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', upper_limit: 100, severity: 'WARNING' }])], [{ metric: 'ADG', date: '2026-10-12', value: '120' }], [{ alert_id: 'old' }]]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('uses the header period when the line has none', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', upper_limit: 100, severity: 'WARNING' }], { kpi_alert_period: 'MONTHLY' })], [{ metric: 'ADG', date: '2026-10-05', value: '150' }, { metric: 'ADG', date: '2026-10-12', value: '120' }], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
    expect(inserted[0].message).toContain('Period: MONTHLY 2026-10.');
    expect(inserted[0].actual_value).toBe('135');
  });

  it('skips a stage row whose day range does not cover the day-in-stage', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', upper_limit: 1 }], { period_from: 100, period_to: 120 })]]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('evaluateSafely swallows failures', async () => {
    const ev = new LifecycleKpiEvaluator({ get: () => ({ select: () => { throw new Error('db down'); } }) } as any);
    await expect(ev.evaluateSafely('b1', 't1', '2026-10-12', ['ADG'])).resolves.toBe(0);
  });
});

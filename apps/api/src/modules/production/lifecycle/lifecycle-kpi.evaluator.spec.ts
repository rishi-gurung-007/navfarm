import { LifecycleKpiEvaluator, actualForPeriod, aggregationForUom, effectivePeriod, evaluateLifecycleKpiLine, isoWeekKey, periodWindow, type KpiValue } from './lifecycle-kpi.evaluator';

const v = (date: string, value: number): KpiValue => ({ date, value });

describe('lifecycle KPI pure rules', () => {
  it('the header period decides; the line period is ignored; default DAILY; stored MONTHLY reads as WEEKLY', () => {
    expect(effectivePeriod('WEEKLY')).toBe('WEEKLY');
    expect(effectivePeriod('DAILY')).toBe('DAILY');
    expect(effectivePeriod(null)).toBe('DAILY');
    expect(effectivePeriod('MONTHLY')).toBe('WEEKLY');
    // a stale per-line WEEKLY does not move a DAILY header
    const line = { metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', kpi_period: 'WEEKLY' };
    const vals = [v('2026-10-12', 50), v('2026-10-13', 160)];
    expect(evaluateLifecycleKpiLine(line, 'DAILY', vals, '2026-10-13')[0]).toMatchObject({ period: 'DAILY', actual: 160 });
    expect(evaluateLifecycleKpiLine(line, null, vals, '2026-10-13')[0]).toMatchObject({ period: 'DAILY' });
  });

  it('keys: date and ISO week (year boundary)', () => {
    expect(periodWindow('DAILY', '2026-10-12')).toEqual({ from: '2026-10-12', key: '2026-10-12' });
    expect(periodWindow('WEEKLY', '2026-10-14')).toEqual({ from: '2026-10-12', key: '2026-W42' });
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });

  it('DAILY uses that day only; WEEKLY averages Monday..date by default', () => {
    const vals = [v('2026-10-11', 100), v('2026-10-12', 10), v('2026-10-13', 20), v('2026-10-14', 30), v('2026-10-15', 999)];
    expect(actualForPeriod(vals, 'DAILY', '2026-10-13')?.actual).toBe(20);
    expect(actualForPeriod(vals, 'WEEKLY', '2026-10-14')).toEqual({ actual: 20, key: '2026-W42' }); // 12,13,14
    expect(actualForPeriod(vals, 'DAILY', '2026-10-20')).toBeNull();
  });

  it('aggregation follows the UOM: percent -> % of heads, count -> sum, else average', () => {
    for (const u of ['%', 'PCT', 'percent']) expect(aggregationForUom(u)).toBe('PCT_OF_HEADS');
    expect(aggregationForUom('X', { uom_name: 'Percentage', uom_type: 'OTHER' })).toBe('PCT_OF_HEADS');
    expect(aggregationForUom('X', { uom_name: 'x', uom_type: 'PERCENT' })).toBe('PCT_OF_HEADS');
    for (const u of ['HEAD', 'heads', 'NOS', 'PCS', 'EA', 'COUNT']) expect(aggregationForUom(u)).toBe('SUM');
    expect(aggregationForUom('DOSE', { uom_name: 'Dose', uom_type: 'COUNT' })).toBe('SUM');
    expect(aggregationForUom('KG', { uom_name: 'Kilogram', uom_type: 'WEIGHT' })).toBe('AVERAGE');
    expect(aggregationForUom(null)).toBe('AVERAGE');
  });

  describe('week of deaths 2+1+0+3+1+0+0 on 500 heads', () => {
    const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
    const vals = [2, 1, 0, 3, 1, 0, 0].map((n, i) => v(week[i], n));
    it('PCT_OF_HEADS: 7 / 500 x 100 = 1.4, not the mean of the daily percentages', () => {
      const got = actualForPeriod(vals, 'WEEKLY', '2026-10-18', { aggregation: 'PCT_OF_HEADS', headsAtStart: 500 });
      expect(got?.actual).toBeCloseTo(1.4, 10);
      const dailyMean = vals.reduce((s, x) => s + (x.value / 500) * 100, 0) / 7;
      expect(dailyMean).toBeCloseTo(0.2, 10);
      expect(got!.actual).not.toBeCloseTo(dailyMean, 3);
      const b = evaluateLifecycleKpiLine({ metric: 'MORTALITY_COUNT', uom: 'PCT', average_value: 1, tolerance_pct: 0, tolerance_type: 'UPPER' }, 'WEEKLY', vals, '2026-10-18', { aggregation: 'PCT_OF_HEADS', headsAtStart: 500 });
      expect(b[0].rule).toBe('TOLERANCE');
      expect(b[0].actual).toBeCloseTo(1.4, 10);
    });
    it('SUM: 7 heads; AVERAGE: the mean of the entries', () => {
      expect(actualForPeriod(vals, 'WEEKLY', '2026-10-18', { aggregation: 'SUM' })?.actual).toBe(7);
      expect(actualForPeriod(vals, 'WEEKLY', '2026-10-18', { aggregation: 'AVERAGE' })?.actual).toBe(1);
    });
    it('PCT_OF_HEADS with no head count is skipped, not a division by zero', () => {
      expect(actualForPeriod(vals, 'WEEKLY', '2026-10-18', { aggregation: 'PCT_OF_HEADS', headsAtStart: 0 })).toBeNull();
      expect(actualForPeriod(vals, 'WEEKLY', '2026-10-18', { aggregation: 'PCT_OF_HEADS', headsAtStart: null })).toBeNull();
    });
    it('DAILY percent is that day alone over the heads at the start of the day', () => {
      expect(actualForPeriod(vals, 'DAILY', '2026-10-15', { aggregation: 'PCT_OF_HEADS', headsAtStart: 490 })?.actual).toBeCloseTo((3 / 490) * 100, 10);
    });
  });

  it('From/To stage days: a line is checked only inside its window; weekly counts only entries inside it', () => {
    const line = { metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', from_day: 3, to_day: 5 };
    const vals = [{ ...v('2026-10-12', 500), dayInStage: 2 }, { ...v('2026-10-13', 150), dayInStage: 3 }, { ...v('2026-10-14', 170), dayInStage: 4 }, { ...v('2026-10-15', 900), dayInStage: 6 }];
    expect(evaluateLifecycleKpiLine(line, 'DAILY', vals, '2026-10-12', { dayInStage: 2 })).toEqual([]);
    expect(evaluateLifecycleKpiLine(line, 'DAILY', vals, '2026-10-15', { dayInStage: 6 })).toEqual([]);
    expect(evaluateLifecycleKpiLine(line, 'DAILY', vals, '2026-10-13', { dayInStage: 3 })[0]).toMatchObject({ actual: 150 });
    // weekly on day 4: days 2 (before) and 6 (after) do not count -> mean(150,170)=160
    expect(evaluateLifecycleKpiLine(line, 'WEEKLY', vals, '2026-10-14', { dayInStage: 4 })[0]).toMatchObject({ actual: 160 });
    expect(evaluateLifecycleKpiLine({ metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', from_day: 4 }, 'DAILY', vals, '2026-10-15', { dayInStage: 6 })).toHaveLength(1);
    expect(evaluateLifecycleKpiLine({ metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER' }, 'DAILY', vals, '2026-10-12', { dayInStage: 2 })).toHaveLength(1);
  });

  it('lower / upper limits on a line are ignored; only the tolerance against the average alerts', () => {
    const line = { metric: 'ADG', lower_limit: 450, upper_limit: 700, severity: 'CRITICAL' };
    for (const x of [449, 701, 450, 0, 5000]) expect(evaluateLifecycleKpiLine(line, null, [v('2026-10-12', x)], '2026-10-12')).toEqual([]);
    const withTol = { ...line, average_value: 600, tolerance_pct: 5, tolerance_type: 'UPPER' };
    expect(evaluateLifecycleKpiLine(withTol, null, [v('2026-10-12', 701)], '2026-10-12').map((x) => [x.rule, x.severity])).toEqual([['TOLERANCE', 'CRITICAL']]);
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
    const line = { metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER' };
    const vals = [v('2026-10-12', 50), v('2026-10-13', 160)]; // avg 105 > 100 on the 13th; day alone would be 160
    expect(evaluateLifecycleKpiLine(line, 'WEEKLY', vals, '2026-10-12')).toEqual([]);
    expect(evaluateLifecycleKpiLine(line, 'WEEKLY', vals, '2026-10-13')[0]).toMatchObject({ period: 'WEEKLY', periodKey: '2026-W42', actual: 105 });
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
    feed_item_id: null, farm_id: null, kpi_thresholds: kpis, kpi_alert_period: null, ...extra,
  });
  const make = (answers: unknown[][]) => {
    const { db, inserted } = fakeDb(answers);
    const ev = new LifecycleKpiEvaluator({ get: () => db } as any);
    return { ev, inserted };
  };

  it('writes a LIFECYCLE_KPI alert naming batch, KPI, actual, tolerance, direction, period', async () => {
    // batch, headers, lifecycle rows, daily data, dedupe lookup (none)
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 100, tolerance_pct: 5, tolerance_type: 'UPPER', severity: 'CRITICAL' }])], [{ metric: 'ADG', date: '2026-10-12', value: '110.000000' }], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
    expect(inserted[0]).toMatchObject({ alert_type: 'LIFECYCLE_KPI', severity: 'CRITICAL', batch_id: 'b1', tenant_id: 't1', activity_name: 'ADG', kpi_mode: 'TOL_UPPER', actual_value: '110' });
    expect(inserted[0].message).toContain('FIN-001');
    expect(inserted[0].message).toContain('5% UPPER');
    expect(inserted[0].message).toContain('Period: DAILY 2026-10-12.');
  });

  it('does not alert twice for the same batch + metric + rule + period', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', severity: 'WARNING' }])], [{ metric: 'ADG', date: '2026-10-12', value: '120' }], [{ alert_id: 'old' }]]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('uses the header period (a stored MONTHLY reads as WEEKLY) and ignores the line period', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', severity: 'WARNING', kpi_period: 'DAILY' }], { kpi_alert_period: 'MONTHLY' })], [{ metric: 'ADG', date: '2026-10-12', value: '120' }], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
    expect(inserted[0].message).toContain('Period: WEEKLY 2026-W42.');
  });

  it('checks a line only while the day-in-stage is inside From/To', async () => {
    // 2026-10-12 is day 12 of the stage that began 1 Oct.
    const mk = (extra: object) => make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 100, tolerance_pct: 0, tolerance_type: 'UPPER', severity: 'WARNING', ...extra }])], [{ metric: 'ADG', date: '2026-10-12', value: '120' }], []]);
    expect(await mk({ from_day: 13, to_day: 20 }).ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(await mk({ from_day: 1, to_day: 11 }).ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(await mk({ from_day: 10, to_day: 12 }).ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
    expect(await mk({}).ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(1);
  });

  it('a % UOM line alerts on deaths / heads at period start x 100', async () => {
    // answers: batch (500 opening), headers, stage rows, uom lookup, daily data, mortality before the week (none), dedupe
    const b = { ...batch, opening_quantity: '500.0000' };
    const { ev, inserted } = make([[b], [header], [stageRow([{ metric: 'MORTALITY_COUNT', uom: 'PCT', average_value: 1, tolerance_pct: 0, tolerance_type: 'UPPER', severity: 'CRITICAL' }], { kpi_alert_period: 'WEEKLY' })],
      [{ uom_code: 'PCT', uom_name: 'Percent', uom_type: 'OTHER' }],
      [{ metric: 'MORTALITY_COUNT', date: '2026-10-12', value: '5' }, { metric: 'MORTALITY_COUNT', date: '2026-10-13', value: '3' }], [], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-13')).toBe(1);
    expect(inserted[0].actual_value).toBe('1.6');
  });

  it('a % UOM line divides by heads net of posted Data Entry deaths before the week (500 - 10 = 490)', async () => {
    const b = { ...batch, opening_quantity: '500.0000' };
    // answers: batch, headers, stage rows, uom, daily data, batch_transaction MORTALITY (none), posted MORTALITY_COUNT before the week, dedupe
    const { ev, inserted } = make([[b], [header], [stageRow([{ metric: 'MORTALITY_COUNT', uom: 'PCT', average_value: 1, tolerance_pct: 0, tolerance_type: 'UPPER', severity: 'CRITICAL' }], { kpi_alert_period: 'WEEKLY' })],
      [{ uom_code: 'PCT', uom_name: 'Percent', uom_type: 'OTHER' }],
      [{ metric: 'MORTALITY_COUNT', date: '2026-10-12', value: '5' }, { metric: 'MORTALITY_COUNT', date: '2026-10-13', value: '3' }], [],
      [{ batchId: 'b1', date: '2026-10-05', quantity: '10' }], []]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-13')).toBe(1);
    expect(inserted[0].actual_value).toBe('1.6327');
  });

  it('a % UOM line with no head count is skipped', async () => {
    const { ev, inserted } = make([[{ ...batch, opening_quantity: '0' }], [header], [stageRow([{ metric: 'MORTALITY_COUNT', uom: 'PCT', average_value: 1, tolerance_pct: 0, tolerance_type: 'UPPER' }])],
      [{ uom_code: 'PCT', uom_name: 'Percent', uom_type: 'OTHER' }], [{ metric: 'MORTALITY_COUNT', date: '2026-10-12', value: '5' }]]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('skips a stage row whose day range does not cover the day-in-stage', async () => {
    const { ev, inserted } = make([[batch], [header], [stageRow([{ metric: 'ADG', average_value: 1, tolerance_pct: 0, tolerance_type: 'UPPER' }], { period_from: 100, period_to: 120 })]]);
    expect(await ev.evaluateBatch('b1', 't1', '2026-10-12')).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('evaluateSafely swallows failures', async () => {
    const ev = new LifecycleKpiEvaluator({ get: () => ({ select: () => { throw new Error('db down'); } }) } as any);
    await expect(ev.evaluateSafely('b1', 't1', '2026-10-12', ['ADG'])).resolves.toBe(0);
  });
});

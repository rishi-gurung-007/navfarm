import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { groupRows, MAX_SPAN_DAYS, resolveViewRange, spanProblem } from './feed-forecast.view';

const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 5 },
  ],
};
const { daily } = buildFeedForecast(workedExample);
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 1e6) / 1e6;

describe('groupRows — Step 6 "Build dated forecast"', () => {
  it('WEEKLY: R1 3 days × 2,000 = 6,000 kg and R2 4 days × 2,500 = 10,000 kg, as two rows', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemNo: 'FEED-R1', date: '2026-09-23', dateTo: '2026-09-25', days: 3, intakeKg: 6000, demandKg: 6000,
      currentInventoryKg: 1500, perDayIntakeKg: 2000, heads: 1000, indicative: true,
    });
    // R2 carries 5 % wastage: intake 10,000 kg, 10,500 kg leaves the silo.
    expect(rows[1]).toMatchObject({ itemNo: 'FEED-R2', date: '2026-09-26', dateTo: '2026-09-29', days: 4, intakeKg: 10000, demandKg: 10500, wastagePct: 5 });
  });

  it('a stage change on the same feed inside a week starts a new line, so no row keeps a stage it has left', () => {
    const staged = daily.map((d) => (d.date >= '2026-09-26' ? { ...d, stageCode: 'GROWER', itemId: 'r1', itemNo: 'FEED-R1' } : d));
    const rows = groupRows(staged, 'WEEKLY', '2026-09-23');
    expect(rows.map((r) => [r.stageCode, r.itemNo, r.date])).toEqual([
      ['WEANER', 'FEED-R1', '2026-09-23'],
      ['GROWER', 'FEED-R1', '2026-09-26'],
    ]);
  });

  it('never changes the daily numbers: grouped totals equal the daily sums for every view', () => {
    for (const view of ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'] as const) {
      const rows = groupRows(daily, view, '2026-09-23');
      expect(sum(rows.map((r) => r.demandKg))).toBe(sum(daily.map((d) => d.demandKg)));
      expect(sum(rows.map((r) => r.intakeKg))).toBe(sum(daily.map((d) => d.perDayIntakeKg)));
    }
  });

  it('DAILY and CUSTOM keep one row per date', () => {
    expect(groupRows(daily, 'CUSTOM', '2026-09-23')).toHaveLength(7);
    expect(groupRows(daily, 'DAILY', '2026-09-23').every((r) => r.days === 1 && r.date === r.dateTo)).toBe(true);
  });

  it('WEEKLY cuts a longer range into 7-day buckets from the week start', () => {
    const row = (over: Partial<FeedRow> = {}): FeedRow => ({
      lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower', fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
    });
    const long: ForecastInput = {
      ...workedExample, to: '2026-10-06', silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
      sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1'] }], feedRows: [row({ stageId: 'wean' })],
      batches: [{ ...workedExample.batches[0], heads: 100 }],
    };
    const rows = groupRows(buildFeedForecast(long).daily, 'WEEKLY', '2026-09-23');
    expect(rows.map((r) => `${r.date}..${r.dateTo} ${r.days}`)).toEqual(['2026-09-23..2026-09-29 7', '2026-09-30..2026-10-06 7']);
  });

  it('M4: a PERIOD row\'s date is its own group start, not the period\'s "from" (a diet starting mid-period)', () => {
    // R1 covers days 25-26 (=> 2026-09-23..24), R2 starts mid-period on day 28 (=> 2026-09-26). A Reporting
    // Period is one bucket for its whole span, so both land in the same PERIOD grouping key as far as `from` is
    // concerned — but R2's line must still report its own first actual date, not the period's `from`.
    const midPeriod: ForecastInput = {
      ...workedExample,
      feedRows: [
        { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 26, kgPerHeadPerDay: 2.0, wastagePct: 0 },
        { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 5 },
      ],
    };
    const rows = groupRows(buildFeedForecast(midPeriod).daily, 'PERIOD', '2026-09-23');
    const r1 = rows.find((r) => r.itemNo === 'FEED-R1');
    const r2 = rows.find((r) => r.itemNo === 'FEED-R2');
    expect(r1?.date).toBe('2026-09-23'); // R1 does start on the period's `from` here
    expect(r2?.date).toBe('2026-09-26'); // R2 does not — its own first actual date, not '2026-09-23'
    expect(r2?.dateTo).toBe('2026-09-29');
  });
});

describe('resolveViewRange and spanProblem', () => {
  const period = { periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' };

  it('DAILY is one date (the planning date unless one is chosen); WEEKLY is 7 days from the week start', () => {
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-23' });
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23', from: '2026-09-25' })).toEqual({ from: '2026-09-25', to: '2026-09-25' });
    expect(resolveViewRange({ view: 'WEEKLY', planningDate: '2026-09-23', from: '2026-09-27' })).toEqual({ from: '2026-09-27', to: '2026-10-03' });
  });

  it('PERIOD takes the Reporting Period Master dates; CUSTOM defaults to from + 7 (the Plan A default)', () => {
    expect(resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period })).toEqual({ from: '2026-08-30', to: '2026-09-26' });
    expect(resolveViewRange({ view: 'CUSTOM', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-30' });
    expect(() => resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period: null })).toThrow('A Reporting Period view needs a period.');
  });

  it('accepts exactly 45 days after from and refuses 46, naming a reporting period when it is one (checkpoint 15)', () => {
    expect(MAX_SPAN_DAYS).toBe(45);
    expect(spanProblem('2026-09-25', '2026-11-09')).toBeNull();
    expect(spanProblem('2026-09-25', '2026-11-10')).toBe('The forecast covers at most 45 days after from.');
    expect(spanProblem('2026-09-25', '2026-09-24')).toBe('to must not be before from.');
    expect(spanProblem('2026-08-01', '2026-09-19', { ...period, periodCode: '2026-X', startDate: '2026-08-01', endDate: '2026-09-19' }))
      .toBe('Reporting period 2026-X runs 50 days (2026-08-01 to 2026-09-19); the forecast covers at most 46.');
  });
});

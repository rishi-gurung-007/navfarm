import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { DEFAULT_WINDOW_DAYS, defaultWindowEnd, groupRows, MAX_SPAN_DAYS, resolveViewRange, spanProblem } from './feed-forecast.view';

const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29',
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
  batches: [{
    batchId: 'b', realBatchId: 'b' as any, batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
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
  it('exposes every Engine row 70 field with stable ids and source evidence', () => {
    const rows = groupRows(daily, 'DAILY', '2026-09-23', { 'GRS/SILO-001': 'Weaner silo' }, 'farm-grs');
    const first = rows[0];

    expect(first).toMatchObject({
      farmId: 'farm-grs', batchId: 'b', batchGroupId: 'b', shedId: 'h3', shedCode: 'GRS/SHED-003',
      sourceLocationId: 's1', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo',
      itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1',
      currentItemId: 'r1', currentItemNo: 'FEED-R1', currentItemName: 'Weaner Diet R1',
      heads: 1000, feedRateKg: 2, openingSystemBalanceKg: 1500, confirmedReceiptsKg: 0,
      dailyUseKg: 2000, projectedClosingBalanceKg: 0, recommendedQtyKg: 4500,
      firstShortageDate: '2026-09-23', deliveryDate: '2026-09-21',
    });
  });

  it('keeps shared source evidence as a balance, not a sum across grouped dates', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23');
    expect(rows[0]).toMatchObject({
      openingSystemBalanceKg: 1500,
      confirmedReceiptsKg: 0,
      dailyUseKg: 6000,
      projectedClosingBalanceKg: 0,
    });
  });

  it('puts shortage and delivery dates only on the line whose date range contains the shortage', () => {
    const rows = groupRows(daily, 'DAILY', '2026-09-23');
    const shortageDay = rows.find((row) => row.date === '2026-09-23' && row.itemNo === 'FEED-R1')!;
    const laterDay = rows.find((row) => row.date === '2026-09-24' && row.itemNo === 'FEED-R1')!;

    expect(shortageDay).toMatchObject({ firstShortageDate: '2026-09-23', deliveryDate: '2026-09-21' });
    expect(laterDay).toMatchObject({ firstShortageDate: null, deliveryDate: null });
  });

  it('WEEKLY: R1 3 days × 2,000 = 6,000 kg and R2 4 days × 2,500 = 10,000 kg, as two rows', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemNo: 'FEED-R1', date: '2026-09-23', dateTo: '2026-09-25', days: 3, intakeKg: 6000,
      currentInventoryKg: 1500, perDayIntakeKg: 2000, heads: 1000, indicative: true,
    });
    // R2's feed row carries 5 % wastage, which D34 dropped: demand is heads × rate only.
    expect(rows[1]).toMatchObject({ itemNo: 'FEED-R2', date: '2026-09-26', dateTo: '2026-09-29', days: 4, intakeKg: 10000 });
  });

  it('each row carries the source NAME beside its code, from the names map; none when unknown (Engine r70)', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23', { 'GRS/SILO-001': 'Weaner silo' });
    expect(rows[0]).toMatchObject({ sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo' });
    expect(rows[1]).toMatchObject({ sourceCode: 'GRS/SILO-002', sourceName: null });
  });

  it('carries the configured Bulk/Bagged location form for result filtering', () => {
    const rows = groupRows(daily, 'DAILY', '2026-09-23', {}, 'farm-grs', { 'GRS/SILO-001': 'BAGGED' });
    expect(rows.find((row) => row.sourceCode === 'GRS/SILO-001')?.feedType).toBe('BAGGED');
    expect(rows.find((row) => row.sourceCode === 'GRS/SILO-002')?.feedType).toBe('BULK');
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

describe('groupRows — Days of Stock passes the row-level division through (D35)', () => {
  // The worked example has one batch, so its per-row number is the container's; the point is
  // that grouping never recomputes it against the container's combined demand.
  it('keeps the daily row Days of Stock on the grouped line', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23');
    expect(rows[0].daysOfStock).toBe(0.8); // 1,500 kg opens the day, 2,000 kg is drawn: 1,500 ÷ 2,000 = 0.75 → 0.8
    expect(rows[1].daysOfStock).toBe(0.4); // 1,000 ÷ 2,500
  });
});

describe('resolveViewRange and spanProblem', () => {
  const period = { periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' };

  it('DAILY is one date (the planning date unless one is chosen); WEEKLY is 7 days from the week start', () => {
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-23' });
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23', from: '2026-09-25' })).toEqual({ from: '2026-09-25', to: '2026-09-25' });
    expect(resolveViewRange({ view: 'WEEKLY', planningDate: '2026-09-23', from: '2026-09-27' })).toEqual({ from: '2026-09-27', to: '2026-10-03' });
  });

  it('PERIOD takes the Reporting Period Master dates; CUSTOM defaults to 7 calendar days inclusive (from + 6)', () => {
    expect(resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period })).toEqual({ from: '2026-08-30', to: '2026-09-26' });
    expect(resolveViewRange({ view: 'CUSTOM', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-29' });
    expect(() => resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period: null })).toThrow('A Reporting Period view needs a period.');
  });

  it('the default window is 7 days inclusive: Worked Example 23 to 29 Sep, the same length as WEEKLY (Engine §5 row 67)', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
    expect(defaultWindowEnd('2026-09-23')).toBe('2026-09-29');
    expect(resolveViewRange({ view: 'CUSTOM', planningDate: '2026-09-23' }).to).toBe('2026-09-29');
    expect(resolveViewRange({ view: 'WEEKLY', planningDate: '2026-09-23' }).to).toBe('2026-09-29');
  });

  it('accepts exactly 45 days after from and refuses 46, naming a reporting period when it is one (checkpoint 15)', () => {
    expect(MAX_SPAN_DAYS).toBe(45);
    expect(spanProblem('2026-09-25', '2026-11-09')).toBeNull();
    expect(spanProblem('2026-09-25', '2026-11-10')).toBe('Choose a range of at most 45 days.');
    expect(spanProblem('2026-09-25', '2026-09-24')).toBe('The end date is before the start date.');
    expect(spanProblem('2026-08-01', '2026-09-19', { ...period, periodCode: '2026-X', startDate: '2026-08-01', endDate: '2026-09-19' }))
      .toBe('Reporting period 2026-X runs 50 days (01/08/26 to 19/09/26); the forecast covers at most 46.');
  });
});

describe('FF1 (Rishi 5 Oct) — Daily and Weekly run through the run-down date', () => {
  /**
   * VIL100-shaped: 100 head at 2 kg/day = 200 kg/day against 3,200 kg on hand
   * runs down on the 17th day (selected + 16). DAILY showed only the selected
   * date although the walk already knew the run-down; WEEKLY showed only the
   * first 7-day group although run-down falls in the third group.
   */
  const rundownInput: ForecastInput = {
    planningDate: '2026-10-05', from: '2026-10-05', to: '2026-10-05',
    horizonTo: '2026-11-19',
    sheds: [{ shedId: 'h1', shedCode: 'VIL100/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'VIL100/SILO-001', itemId: 'r1', balanceKg: 3200 }],
    store: null,
    items: { r1: 'Grower' },
    itemCodes: { r1: 'FEED-G' },
    batches: [{
      batchId: 'b', realBatchId: 'b' as never, batchNo: 'WG-2026-40', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grow', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }],
    }],
    feedRows: [
      { lifecycleId: 'row-g', breedId: 'l', stageId: 'grow', itemId: 'r1', itemName: 'Grower', fromDay: 1, toDay: 400, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    ],
  };

  it('the engine emits daily rows past `to` up to the run-down date', () => {
    const { daily } = buildFeedForecast(rundownInput);
    const dates = [...new Set(daily.map((d) => d.date))].sort();
    // 200 kg/day against 3,200 kg: 16 full days then the 17th day's demand exceeds the opening.
    expect(dates[0]).toBe('2026-10-05');
    expect(dates[dates.length - 1]).toBe('2026-10-21');
    expect(dates).toHaveLength(17);
    expect(daily[0].runDownDate).toBe('2026-10-21');
  });

  it('DAILY groups every date from the selected date through run-down; WEEKLY groups consecutive 7-day buckets through the group containing run-down', () => {
    const { daily } = buildFeedForecast(rundownInput);
    const dated = groupRows(daily, 'DAILY', '2026-10-05');
    expect(dated.map((r) => r.date)).toHaveLength(17);
    expect(dated[dated.length - 1].date).toBe('2026-10-21');
    const weekly = groupRows(daily, 'WEEKLY', '2026-10-05');
    expect(weekly.map((r) => `${r.date}..${r.dateTo}`)).toEqual([
      '2026-10-05..2026-10-11', '2026-10-12..2026-10-18', '2026-10-19..2026-10-21',
    ]);
  });

  it('a row stops at zero: dates past its own run-down carry no row, and no demand is invented for them', () => {
    const { daily } = buildFeedForecast(rundownInput);
    const after = daily.filter((d) => d.date > '2026-10-21');
    expect(after).toHaveLength(0);
  });

  it('no run-down within the horizon: rows run through the horizon and say no run-down occurs there', () => {
    const ample: ForecastInput = {
      ...rundownInput,
      silos: [{ siloId: 's1', siloCode: 'VIL100/SILO-001', itemId: 'r1', balanceKg: 100000 }],
    };
    const { daily } = buildFeedForecast(ample);
    const dates = [...new Set(daily.map((d) => d.date))].sort();
    expect(dates[dates.length - 1]).toBe('2026-11-19');
    expect(daily.every((d) => d.runDownDate === null)).toBe(true);
  });

  it('an incoming delivery moves only the dates it should: run-down shifts later, earlier balances unchanged', () => {
    const before = buildFeedForecast(rundownInput).daily;
    const withDelivery = buildFeedForecast({
      ...rundownInput,
      incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-10-10', kg: 2000 }],
    }).daily;
    const openingOf = (rows: { date: string; currentInventoryKg: number }[], date: string) =>
      rows.find((r) => r.date === date)!.currentInventoryKg;
    expect(openingOf(withDelivery, '2026-10-05')).toBe(openingOf(before, '2026-10-05'));
    expect(openingOf(withDelivery, '2026-10-10')).toBe(openingOf(before, '2026-10-10') + 2000);
    expect(withDelivery[0].runDownDate! > '2026-10-21').toBe(true);
  });
});

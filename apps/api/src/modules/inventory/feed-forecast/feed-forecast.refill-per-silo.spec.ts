import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * D38 (Rishi, 28 Sep evening; refines D3 and D32): the refill buffer is per
 * SILO, from the silo's own "Silo Reorder Days" — a silo close to the mill and
 * one on the far side of the farm do not need the same warning. A store source,
 * or a silo with no value, uses the standard 2 (the field specification's
 * "− 2 days"). The farm's feed_refill_buffer_days is no longer read.
 */
const FEED = {
  lifecycleId: 'a',
  breedId: 'l',
  stageId: 'wean',
  itemId: 'r1',
  itemName: 'Weaner Diet R1',
  fromDay: 1,
  toDay: 120,
  calcUnit: 'DAY' as const,
  kgPerHeadPerDay: 10,
  wastagePct: 0,
};

/** One shed, two silos holding different items, 100 kg/day out of each. */
function input(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-29',
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'F/SHED-001', siloIds: ['near', 'far'] }],
    silos: [
      { siloId: 'near', siloCode: 'F/SILO-NEAR', itemId: 'r1', balanceKg: 500, reorderDays: 1 },
      { siloId: 'far', siloCode: 'F/SILO-FAR', itemId: 'r2', balanceKg: 500, reorderDays: 5 },
    ],
    store: null,
    items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
    batches: [
      { batchId: 'b1', batchNo: 'B-1', breedId: 'l', shedId: 'h1', heads: 10, segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-09-01', end: null, projected: false }] },
      { batchId: 'b2', batchNo: 'B-2', breedId: 'l', shedId: 'h1', heads: 10, segments: [{ stageId: 'grow', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
    ],
    // One row per stage, so no day range overlaps — feedRowFor refuses an overlap.
    feedRows: [FEED, { ...FEED, lifecycleId: 'b', stageId: 'grow', itemId: 'r2', itemName: 'Weaner Diet R2' }],
    ...over,
  } as ForecastInput;
}

const bySilo = (result: ReturnType<typeof buildFeedForecast>) =>
  Object.fromEntries(result.sources.map((s) => [s.sourceCode, { runDown: s.runDownDate, refill: s.refillDate, requiredOn: s.requiredOn }]));

describe('D38 — the refill buffer is the silo\'s own reorder days', () => {
  it('gives two silos on one farm different refill dates from their own reorder days', () => {
    const out = bySilo(buildFeedForecast(input()));
    // 500 kg at 100 kg/day: Sep27 closes to 0. Sep28: open=0, demand=100, 100>0 → runDownDate=Sep28.
    expect(out['F/SILO-NEAR'].runDown).toBe('2026-09-28');
    expect(out['F/SILO-FAR'].runDown).toBe('2026-09-28');
    // …and each is warned by its own number of days, not one farm-wide figure.
    expect(out['F/SILO-NEAR'].refill).toBe('2026-09-27'); // run-down − 1
    expect(out['F/SILO-FAR'].refill).toBe('2026-09-23');  // run-down − 5
  });

  it('falls back to 2 for a silo with no reorder days', () => {
    const out = bySilo(buildFeedForecast(input({
      silos: [
        { siloId: 'near', siloCode: 'F/SILO-NEAR', itemId: 'r1', balanceKg: 500 },
        { siloId: 'far', siloCode: 'F/SILO-FAR', itemId: 'r2', balanceKg: 500, reorderDays: null },
      ],
    } as Partial<ForecastInput>)));
    expect(out['F/SILO-NEAR'].refill).toBe('2026-09-26'); // runDown Sep28 − 2
    expect(out['F/SILO-FAR'].refill).toBe('2026-09-26');
  });

  it('uses 2 for a STORE source, which has no reorder days of its own', () => {
    const out = bySilo(buildFeedForecast(input({
      sheds: [{ shedId: 'h1', shedCode: 'F/SHED-001', siloIds: [] }],
      silos: [],
      store: { storeId: 'st', storeCode: 'F/STORE-001', balances: { r1: 500, r2: 500 } },
    } as Partial<ForecastInput>)));
    // The store is one source per item, each holding its own 500 kg at 100 kg/day,
    // so each runs down on Sep28 (demand exceeds zero stock) and each is warned 2 days earlier.
    expect(out['F/STORE-001'].runDown).toBe('2026-09-28');
    expect(out['F/STORE-001'].refill).toBe('2026-09-26'); // run-down − 2
  });

  it('subtracts the farm lead time from the silo\'s own refill date, not from a farm buffer', () => {
    const out = bySilo(buildFeedForecast(input({ leadTimeDays: 3 })));
    expect(out['F/SILO-NEAR'].refill).toBe('2026-09-27'); // runDown Sep28 − 1
    expect(out['F/SILO-NEAR'].requiredOn).toBe('2026-09-24'); // refill Sep27 − 3
    expect(out['F/SILO-FAR'].requiredOn).toBe('2026-09-20');  // refill Sep23 − 3
  });

  it('no longer reads a farm-wide refill buffer: a silo with reorder days ignores it', () => {
    const out = bySilo(buildFeedForecast(input({ refillBufferDays: 30 } as Partial<ForecastInput>)));
    expect(out['F/SILO-NEAR'].refill).toBe('2026-09-27'); // runDown Sep28 − 1
    expect(out['F/SILO-FAR'].refill).toBe('2026-09-23');  // runDown Sep28 − 5
  });
});

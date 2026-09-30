import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan B needs the engine's per-container view (one requisition line per silo
 * and item) and each batch's diet change date (DIET_CHANGE alert). The fixture
 * is the workbook's Worked Example: GRS H3, WG-2026-38, 1,000 pigs, R1 days
 * 25–27 at 2.0 kg (23–25 Sep), R2 days 28–31 at 2.5 kg (26–29 Sep), SILO1 R1
 * 1,500 kg, SILO2 R2 1,000 kg.
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

describe('buildFeedForecast — sources and diet changes (Plan B)', () => {
  it('summarises each silo and item over the planning window, as the Worked Example tabulates it', () => {
    const { sources } = buildFeedForecast(workedExample);
    expect(sources).toEqual([
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
        balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000,
        walkDemandKg: 6000, daysLeft: 0, runDownDate: '2026-09-23', shortageDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false,
        lifecycleIds: ['row-r1'], thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,
      },
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
        balanceKg: 1000, planningDayDemandKg: 0, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500,
        walkDemandKg: 10000, daysLeft: null, runDownDate: '2026-09-26', shortageDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false,
        lifecycleIds: ['row-r2'], thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, refillDate: '2026-09-24', requiredOn: '2026-09-24', overdue: false,
      },
    ]);
  });

  it('reports the R1 → R2 change on 26 Sep and the silo that will feed it', () => {
    const { dietChanges } = buildFeedForecast(workedExample);
    expect(dietChanges).toEqual([{
      batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003',
      fromItemId: 'r1', fromItemName: 'Weaner Diet R1', toItemId: 'r2', toItemName: 'Weaner Diet R2',
      changeDate: '2026-09-26', nextSourceType: 'SILO', nextSourceCode: 'GRS/SILO-002',
    }]);
  });

  it('marks a next diet no silo on the shed holds as drawn from the store, flagged for changeover', () => {
    const input: ForecastInput = {
      ...workedExample,
      sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1'] }],
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 }],
      store: { storeId: 'st', storeCode: 'GRS/STORE-001', balances: {} },
    };
    const { sources, dietChanges, flags } = buildFeedForecast(input);
    const r2 = sources.find((s) => s.itemId === 'r2')!;
    expect(r2).toMatchObject({ sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'st', isNextDiet: true, noSiloHoldsItem: true, balanceKg: 0 });
    expect(dietChanges[0]).toMatchObject({ nextSourceType: 'STORE', nextSourceCode: null });
    expect(flags.filter((f) => f.kind === 'NO_SILO_HOLDS_ITEM')).toHaveLength(1);
  });

  it('leaves sources with no container out, and reports no change for a batch that stays on one diet', () => {
    const input: ForecastInput = { ...workedExample, to: '2026-09-25', store: null, sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: [] }], silos: [] };
    const { sources, dietChanges } = buildFeedForecast(input);
    expect(sources).toEqual([]);
    expect(dietChanges).toEqual([]);
  });

  it('reports a diet change across a gap day with no feed row, comparing against the last known item', () => {
    // R1 days 25-27 (23-25 Sep), day 28 (26 Sep) has no candidate row for the breed/stage — a gap — then R2 picks up
    // from day 29 (27 Sep). Without the gap fix, day i-1 (26 Sep) reads as "no item" and the change is missed.
    const input: ForecastInput = {
      ...workedExample,
      feedRows: [
        { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
        { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 29, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
      ],
    };
    const { sources, dietChanges } = buildFeedForecast(input);
    expect(dietChanges).toEqual([{
      batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003',
      fromItemId: 'r1', fromItemName: 'Weaner Diet R1', toItemId: 'r2', toItemName: 'Weaner Diet R2',
      changeDate: '2026-09-27', nextSourceType: 'SILO', nextSourceCode: 'GRS/SILO-002',
    }]);
    const r2 = sources.find((s) => s.itemId === 'r2')!;
    expect(r2.isNextDiet).toBe(true);
  });

  it('does not emit a source whose demand falls entirely before planningDate', () => {
    // from (20 Sep) is before planningDate (23 Sep); the single feed row (days 1-3 of the stage, 20-22 Sep) is
    // entirely consumed before the walk starts, so the container has nothing left to requisition.
    const input: ForecastInput = {
      planningDate: '2026-09-23', from: '2026-09-20', to: '2026-09-25', leadTimeDays: 0,
      sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s0'] }],
      silos: [{ siloId: 's0', siloCode: 'GRS/SILO-000', itemId: 'r0', balanceKg: 500 }],
      store: null,
      items: { r0: 'Starter Diet R0' },
      batches: [{
        batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
        segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-09-20', end: null, projected: false }],
      }],
      feedRows: [
        { lifecycleId: 'row-r0', breedId: 'l', stageId: 'wean', itemId: 'r0', itemName: 'Starter Diet R0', fromDay: 1, toDay: 3, kgPerHeadPerDay: 1.0, wastagePct: 0 },
      ],
    };
    const { sources } = buildFeedForecast(input);
    expect(sources).toEqual([]);
  });
});

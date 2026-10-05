import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { defaultWindowEnd } from './feed-forecast.view';

/**
 * Plan B needs the engine's per-container view (one requisition line per silo
 * and item) and each batch's diet change date (DIET_CHANGE alert). The fixture
 * is the workbook's Worked Example: GRS H3, WG-2026-38, 1,000 pigs, R1 days
 * 25–27 at 2.0 kg (23–25 Sep), R2 days 28–31 at 2.5 kg (26–29 Sep), SILO1 R1
 * 1,500 kg, SILO2 R2 1,000 kg.
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29',
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
  it('emits one source balance point per silo/item/date, including days before a future diet starts', () => {
    const { sourceBalances } = buildFeedForecast(workedExample);
    const r2 = sourceBalances.filter((point) => point.itemId === 'r2' && point.date <= '2026-09-26');

    expect(r2).toEqual([
      expect.objectContaining({ date: '2026-09-23', locationId: 's2', itemId: 'r2', openingSystemBalanceKg: 1000, confirmedReceiptKg: 0, dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      expect.objectContaining({ date: '2026-09-24', locationId: 's2', itemId: 'r2', openingSystemBalanceKg: 1000, confirmedReceiptKg: 0, dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      expect.objectContaining({ date: '2026-09-25', locationId: 's2', itemId: 'r2', openingSystemBalanceKg: 1000, confirmedReceiptKg: 0, dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      expect.objectContaining({ date: '2026-09-26', locationId: 's2', itemId: 'r2', openingSystemBalanceKg: 1000, confirmedReceiptKg: 0, dailyUseKg: 2500, projectedClosingBalanceKg: 0 }),
    ]);
  });

  it('does not duplicate a source balance point when two batches draw from the same silo and item', () => {
    const shared: ForecastInput = {
      ...workedExample,
      batches: [
        { ...workedExample.batches[0], batchId: 'b1', realBatchId: 'b1' as any, heads: 600 },
        { ...workedExample.batches[0], batchId: 'b2', realBatchId: 'b2' as any, batchNo: 'WG-2026-39', heads: 400 },
      ],
    };

    const { sourceBalances } = buildFeedForecast(shared);
    const first = sourceBalances.filter((point) => point.locationId === 's1' && point.itemId === 'r1' && point.date === '2026-09-23');

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ dailyUseKg: 2000, projectedClosingBalanceKg: 0 });
  });

  it('summarises each silo and item over the planning window, as the Worked Example tabulates it', () => {
    const { sources } = buildFeedForecast(workedExample);
    expect(sources).toEqual([
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
        balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000,
        walkDemandKg: 6000, daysLeft: 0.8, runDownDate: '2026-09-23', shortageDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false,
        lifecycleIds: ['row-r1'], thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, safetyStockKg: 0, deliveryDayOpeningKg: 1500,
      },
      {
        sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
        balanceKg: 1000, planningDayDemandKg: 0, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500,
        walkDemandKg: 10000, daysLeft: null, runDownDate: '2026-09-26', shortageDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false,
        lifecycleIds: ['row-r2'], thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, safetyStockKg: 0, deliveryDayOpeningKg: 1000,
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

  /**
   * Task 9b fix round 1, finding 2: an ANIMAL_WISE/REGISTERED stage group's
   * batchId is the composite `<batch_id>:<stage_id>`; the DIET_CHANGE alert
   * wrote it to feed_alert.subject_id (varchar(36)). The change must carry the
   * genuine batch_header PK separately for that.
   */
  it('carries the real batch id beside a composite stage-group batchId', () => {
    const input: ForecastInput = {
      ...workedExample,
      batches: [{ ...workedExample.batches[0], batchId: 'b:wean', realBatchId: 'b' as any }],
    };
    const { dietChanges } = buildFeedForecast(input);
    expect(dietChanges).toHaveLength(1);
    expect(dietChanges[0]).toMatchObject({ batchId: 'b:wean', realBatchId: 'b' });
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
      planningDate: '2026-09-23', from: '2026-09-20', to: '2026-09-25',
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

describe('buildFeedForecast — TDD workbook alignment (3 Oct rulings 2 and 3)', () => {
  const withLevels = (safetyStockKg?: number): ForecastInput => ({
    ...workedExample,
    safetyStockKg,
    silos: workedExample.silos.map((s) => ({ ...s, lowLevelKg: 1000 })), // Master Setup row 10: 1,000 KG each
  });

  it('orders the workbook quantities even with the 1,000 KG Below Feed Level set', () => {
    const { sources } = buildFeedForecast(withLevels());
    expect(sources.map((s) => [s.itemId, s.walkDemandKg, s.shortfallKg, s.shortageDate, s.safetyStockKg]))
      .toEqual([['r1', 6000, 4500, '2026-09-23', 0], ['r2', 10000, 9000, '2026-09-26', 0]]);
  });

  it('over the default window (no `to` sent) R1 is 6,000 and R2 is 10,000 KG, not the 12,500 an eighth day gave', () => {
    const { sources } = buildFeedForecast({ ...withLevels(), to: defaultWindowEnd('2026-09-23') });
    expect(sources.map((s) => [s.itemId, s.walkDemandKg, s.shortfallKg])).toEqual([['r1', 6000, 4500], ['r2', 10000, 9000]]);
  });

  it('adds configured safety stock to the shortfall', () => {
    const { sources } = buildFeedForecast(withLevels(500));
    expect(sources.map((s) => s.shortfallKg)).toEqual([5000, 9500]);
  });

  it('no longer reports refill or required-on dates', () => {
    const { sources, rows, daily } = buildFeedForecast(withLevels());
    for (const o of [...sources, ...rows, ...daily]) {
      expect(o).not.toHaveProperty('refillDate');
      expect(o).not.toHaveProperty('requiredOn');
      expect(o).not.toHaveProperty('overdue');
    }
  });

  it('gives days remaining to one decimal and the delivery-day opening', () => {
    const input = withLevels();
    input.silos = input.silos.map((s) => (s.siloId === 's1' ? { ...s, balanceKg: 5500 } : s));
    const r1 = buildFeedForecast(input).sources.find((s) => s.itemId === 'r1')!;
    expect(r1.daysLeft).toBe(2.8); // 5,500 ÷ 2,000 = 2.75 → 2.8 (Silo Balance row 9: "about 2.75 days", one decimal)
    // 5,500 lasts 23–24 Sep; on 25 Sep the opening is 1,500 against 2,000 demand → shortage 25 Sep, opening 1,500.
    expect(r1.shortageDate).toBe('2026-09-25');
    expect(r1.deliveryDayOpeningKg).toBe(1500);
  });
});

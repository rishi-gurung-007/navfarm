import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { buildSiloStatus, SiloFact } from './feed-silo-status';

/** Engine §4 Dashboard rows 47–64, on the workbook's Worked Example (SILO1 R1 1,500 kg, SILO2 R2 1,000 kg). */
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

const fact = (over: Partial<SiloFact>): SiloFact => ({
  siloId: 's1', siloCode: 'GRS/SILO-001', houseCodes: ['GRS/SHED-003'], capacityKg: 12000, belowFeedLevelKg: 1000, aboveThresholdKg: 10800,
  feedInSiloItemId: 'r1', feedInSiloItemName: 'Weaner Diet R1', feedType: 'BULK', systemBalanceKg: 1500,
  lastApprovedCountKg: null, lastApprovedCountAt: null, lastFeedReceiptDate: null, blocked: false, ...over,
});

describe('buildSiloStatus', () => {
  const result = buildFeedForecast(workedExample);
  const silos = [
    fact({}),
    fact({ siloId: 's2', siloCode: 'GRS/SILO-002', feedInSiloItemId: 'r2', feedInSiloItemName: 'Weaner Diet R2', systemBalanceKg: 1000 }),
    fact({ siloId: 's3', siloCode: 'GRS/SILO-003', feedInSiloItemId: 'r3', systemBalanceKg: 11000 }),
  ];
  const rows = buildSiloStatus({ silos, result, requisitionStatusBySilo: new Map([['s1', 'DRAFT']]), submissionDeadline: '2026-09-27' });

  it('gives one row per silo, in the order given', () => {
    expect(rows.map((r) => r.siloId)).toEqual(['s1', 's2', 's3']);
  });

  it('SILO1: current diet R1, shortage today, next diet R2 on 26 Sep, order rounded to the bulk multiple', () => {
    expect(rows[0]).toMatchObject({
      currentDietItemId: 'r1', dailyRequirementKg: 2000, firstShortageDate: '2026-09-23', projectedNeedKg: 6000,
      nextDietItemId: 'r2', nextDietDate: '2026-09-26', siloAvailableForNextDiet: true,
      projectedShortfallKg: 4500, recommendedOrderKg: 6000, requisitionStatus: 'DRAFT', submissionDeadline: '2026-09-27', alert: null,
    });
  });

  it('SILO2: eats nothing today, needs 10,000 kg, sits at its Below Feed Level so is CRITICAL_FIRST_PRIORITY', () => {
    expect(rows[1]).toMatchObject({
      currentDietItemId: null, projectedNeedKg: 10000, projectedShortfallKg: 9000, recommendedOrderKg: 9000,
      alert: 'CRITICAL_FIRST_PRIORITY', requisitionStatus: null,
    });
  });

  it('a silo with no demand and balance at or above Above Threshold is INFO', () => {
    expect(rows[2]).toMatchObject({ currentDietItemId: null, dailyRequirementKg: 0, daysRemaining: null, projectedNeedKg: 0, projectedShortfallKg: 0, recommendedOrderKg: 0, alert: 'INFO', nextDietItemId: null, siloAvailableForNextDiet: null });
  });

  it('rounds a bagged silo to the bag size', () => {
    const [row] = buildSiloStatus({
      silos: [fact({ feedType: 'BAGGED' })], result: { ...result, sources: result.sources.map((s) => ({ ...s, shortfallKg: 4510 })) },
      requisitionStatusBySilo: new Map(), submissionDeadline: null,
    });
    expect(row.recommendedOrderKg).toBe(4550);
  });

  it('no thresholds set means no alert', () => {
    const [row] = buildSiloStatus({ silos: [fact({ belowFeedLevelKg: null, aboveThresholdKg: null, systemBalanceKg: 0 })], result, requisitionStatusBySilo: new Map(), submissionDeadline: null });
    expect(row.alert).toBeNull();
  });
});

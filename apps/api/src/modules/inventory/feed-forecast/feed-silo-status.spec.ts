import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { buildSelectedSiloDashboard, buildSiloStatus, SiloFact, SiloStatusRow } from './feed-silo-status';

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
    batchId: 'b', realBatchId: 'b' as any, batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

const fact = (over: Partial<SiloFact>): SiloFact => ({
  siloId: 's1', siloCode: 'GRS/SILO-001', siloName: 'Weaner silo', houseCodes: ['GRS/SHED-003'], capacityKg: 12000, belowFeedLevelKg: 1000, aboveThresholdKg: 10800,
  feedInSiloItemId: 'r1', feedInSiloItemName: 'Weaner Diet R1', feedType: 'BULK', systemBalanceKg: 1500,
  lastApprovedCountKg: null, lastApprovedCountAt: null, lastFeedReceiptDate: null, nonKgBalance: false, ...over,
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

  it('I2: the earliest shortage date and the minimum days left come from across all of a silo\'s sources, not from primary alone — dailyRequirementKg stays on primary (the workbook\'s Dashboard row 58 shape: current diet ample, next diet none)', () => {
    const twoSourceSilo = {
      sources: [
        // current diet: ample stock, no shortage anywhere in the window.
        { sourceType: 'SILO', locationId: 's1', itemId: 'r1', planningDayDemandKg: 400, firstDayDemandKg: 400, walkDemandKg: 2800, safetyStockKg: 0, shortfallKg: 0, daysLeft: 22.5, shortageDate: null },
        // next diet: nothing eats it today, but the silo holds none of it — an immediate shortage.
        { sourceType: 'SILO', locationId: 's1', itemId: 'r2', planningDayDemandKg: 0, firstDayDemandKg: 0, walkDemandKg: 1200, safetyStockKg: 0, shortfallKg: 1200, daysLeft: 0, shortageDate: '2026-09-24' },
      ],
      dietChanges: [],
    };
    const [row] = buildSiloStatus({
      silos: [fact({ systemBalanceKg: 9000 })],
      result: twoSourceSilo as any,
      requisitionStatusBySilo: new Map(),
      submissionDeadline: null,
    });
    // Before the fix, firstShortageDate/daysRemaining read `primary` (the current-diet
    // source) only: a blank shortage date and a comfortable 22.5 days beside a real
    // 1,200 kg shortfall and recommended order driven entirely by the next-diet source.
    expect(row).toMatchObject({
      dailyRequirementKg: 400,
      firstShortageDate: '2026-09-24',
      daysRemaining: 0,
      projectedShortfallKg: 1200,
    });
  });

  it('shows a next diet only on silos serving the shed that changes (fix round 1, finding 2)', () => {
    const twoSheds = {
      sources: [],
      dietChanges: [{
        batchId: 'b', realBatchId: 'b' as any, batchNo: 'B1', shedCode: 'SHED-A', fromItemId: 'r1', fromItemName: 'R1', toItemId: 'r2', toItemName: 'R2',
        changeDate: '2026-09-26', nextSourceType: 'SILO' as const, nextSourceCode: 'SILO-X',
      }],
    };
    const [a, b] = buildSiloStatus({
      silos: [fact({ siloId: 'sa', siloCode: 'SILO-A', houseCodes: ['SHED-A'] }), fact({ siloId: 'sb', siloCode: 'SILO-B', houseCodes: ['SHED-B'] })],
      result: twoSheds, requisitionStatusBySilo: new Map(), submissionDeadline: null,
    });
    expect(a).toMatchObject({ nextDietItemId: 'r2', nextDietDate: '2026-09-26' });
    expect(b).toMatchObject({ nextDietItemId: null, nextDietDate: null, siloAvailableForNextDiet: null });
  });
});

describe('buildSelectedSiloDashboard', () => {
  it('deduplicates a shared physical balance, sums batch demand, and splits current/next need', () => {
    const status: SiloStatusRow = {
      ...fact({}),
      currentDietItemId: 'r1',
      dailyRequirementKg: 500,
      daysRemaining: 3,
      firstShortageDate: '2026-09-26',
      projectedNeedKg: 1700,
      nextDietItemId: 'r2',
      nextDietDate: '2026-09-26',
      siloAvailableForNextDiet: true,
      projectedShortfallKg: 200,
      recommendedOrderKg: 3000,
      requisitionId: 'req-1',
      requisitionStatus: 'DRAFT',
      submissionDeadline: '2026-09-25',
      alert: null,
    };
    const source = (itemId: string, itemName: string, walkDemandKg: number) => ({
      sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId, itemName,
      balanceKg: 1500, planningDayDemandKg: itemId === 'r1' ? 500 : 0,
      currentDietDaysRemaining: itemId === 'r1' ? 3 : null, firstDemandDate: '2026-09-23',
      firstDayDemandKg: 500, walkDemandKg, daysLeft: 3, runDownDate: '2026-09-26', shortageDate: '2026-09-26',
      isNextDiet: itemId === 'r2', noSiloHoldsItem: false, lifecycleIds: [], thresholdKg: 0, safetyStockKg: 100,
      deliveryDayOpeningKg: 0, incomingKg: 0, shortfallKg: 200,
    });
    const daily = (batchId: string, itemId: string, itemName: string, date: string, demandKg: number, closingKg: number) => ({
      batchId, itemId, itemName, date, demandKg, projectedClosingKg: closingKg,
      sourceType: 'SILO', destinationLocationId: 's1', currentInventoryKg: 1500, confirmedReceiptKg: 0,
    });

    const shaped = buildSelectedSiloDashboard({
      status,
      planningDate: '2026-09-23',
      nextBinAssignment: null,
      result: {
        sources: [source('r1', 'Diet R1', 1000), source('r2', 'Diet R2', 500)] as any,
        daily: [
          daily('batch-a', 'r1', 'Diet R1', '2026-09-23', 200, 1000),
          daily('batch-b', 'r1', 'Diet R1', '2026-09-23', 300, 1000),
          daily('batch-a', 'r2', 'Diet R2', '2026-09-26', 500, 1000),
        ] as any,
      },
    });

    expect(shaped.silo).toMatchObject({
      currentDietItemName: 'Diet R1',
      currentProjectedNeedKg: 1100,
      nextProjectedNeedKg: 600,
      currentDietDaysRemaining: 3,
      nextDietItemName: 'Diet R2',
      millLoadingBin: null,
    });
    expect(shaped.balanceSeries).toEqual([
      { date: '2026-09-23', itemId: 'r1', itemName: 'Diet R1', openingKg: 1500, confirmedReceiptKg: 0, demandKg: 500, closingKg: 1000 },
      { date: '2026-09-26', itemId: 'r2', itemName: 'Diet R2', openingKg: 1500, confirmedReceiptKg: 0, demandKg: 500, closingKg: 1000 },
    ]);
    expect(shaped.demandSeries).toEqual([
      { date: '2026-09-23', currentDietKg: 500, nextDietKg: 0 },
      { date: '2026-09-26', currentDietKg: 0, nextDietKg: 500 },
    ]);
  });

  it('returns an exact Mill BIN assignment when supplied instead of inventing one', () => {
    const status = {
      ...fact({}), currentDietItemId: 'r1', dailyRequirementKg: 0, daysRemaining: null, firstShortageDate: null,
      projectedNeedKg: 0, nextDietItemId: null, nextDietDate: null, siloAvailableForNextDiet: null,
      projectedShortfallKg: 0, recommendedOrderKg: 0, requisitionId: null, requisitionStatus: null,
      submissionDeadline: null, alert: null,
    } as SiloStatusRow;
    const assignment = {
      binId: 'bin-1', binCode: 'BIN-001', productionDate: '2026-09-24',
      slotId: 'slot-1', slotCode: 'AM', slotName: 'Morning',
    };

    const shaped = buildSelectedSiloDashboard({
      status, result: { sources: [], daily: [] }, planningDate: '2026-09-23', nextBinAssignment: assignment,
    });

    expect(shaped.silo.millLoadingBin).toEqual(assignment);
  });
});

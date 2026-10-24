import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { resolveNextStageDiets, type NextStageStage } from './next-stage-diet';
import {
  buildSelectedSiloDashboard,
  buildSiloStatus,
  SiloFact,
  SiloStatusRow,
} from './feed-silo-status';

/** Engine §4 Dashboard rows 47–64, on the workbook's Worked Example (SILO1 R1 1,500 kg, SILO2 R2 1,000 kg). */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23',
  from: '2026-09-23',
  to: '2026-09-29',
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [
    {
      batchId: 'b',
      realBatchId: 'b' as any,
      batchNo: 'WG-2026-38',
      breedId: 'l',
      shedId: 'h3',
      heads: 1000,
      segments: [
        {
          stageId: 'wean',
          stageCode: 'WEANER',
          start: '2026-08-30',
          end: null,
          projected: false,
        },
      ],
    },
  ],
  feedRows: [
    {
      lifecycleId: 'row-r1',
      breedId: 'l',
      stageId: 'wean',
      itemId: 'r1',
      itemName: 'Weaner Diet R1',
      fromDay: 25,
      toDay: 27,
      kgPerHeadPerDay: 2.0,
      wastagePct: 0,
    },
    {
      lifecycleId: 'row-r2',
      breedId: 'l',
      stageId: 'wean',
      itemId: 'r2',
      itemName: 'Weaner Diet R2',
      fromDay: 28,
      toDay: 31,
      kgPerHeadPerDay: 2.5,
      wastagePct: 0,
    },
  ],
};

const fact = (over: Partial<SiloFact>): SiloFact => ({
  siloId: 's1',
  siloCode: 'GRS/SILO-001',
  siloName: 'Weaner silo',
  houseCodes: ['GRS/SHED-003'],
  capacityKg: 12000,
  belowFeedLevelKg: 1000,
  aboveThresholdKg: 10800,
  feedInSiloItemId: 'r1',
  feedInSiloItemName: 'Weaner Diet R1',
  feedType: 'BULK',
  systemBalanceKg: 1500,
  lastApprovedCountKg: null,
  lastApprovedCountAt: null,
  lastFeedReceiptDate: null,
  nonKgBalance: false,
  ...over,
});

describe('buildSiloStatus', () => {
  const result = buildFeedForecast(workedExample);
  const silos = [
    fact({}),
    fact({
      siloId: 's2',
      siloCode: 'GRS/SILO-002',
      feedInSiloItemId: 'r2',
      feedInSiloItemName: 'Weaner Diet R2',
      systemBalanceKg: 1000,
    }),
    fact({
      siloId: 's3',
      siloCode: 'GRS/SILO-003',
      feedInSiloItemId: 'r3',
      systemBalanceKg: 11000,
    }),
  ];
  const rows = buildSiloStatus({
    silos,
    result,
    requisitionStatusBySilo: new Map([['s1', 'DRAFT']]),
    submissionDeadline: '2026-09-27',
  });

  it('gives one row per silo, in the order given', () => {
    expect(rows.map((r) => r.siloId)).toEqual(['s1', 's2', 's3']);
  });

  it('SILO1: current diet R1, shortage today, next diet R2 on 26 Sep, order rounded to the bulk multiple', () => {
    expect(rows[0]).toMatchObject({
      currentDietItemId: 'r1',
      dailyRequirementKg: 2000,
      firstShortageDate: '2026-09-23',
      projectedNeedKg: 6000,
      nextDietItemId: 'r2',
      nextDietDate: '2026-09-26',
      siloAvailableForNextDiet: true,
      projectedShortfallKg: 4500,
      recommendedOrderKg: 6000,
      requisitionStatus: 'DRAFT',
      submissionDeadline: '2026-09-27',
      alert: null,
    });
  });

  it('SILO2: eats nothing today, needs 10,000 kg, sits at its Below Feed Level so is CRITICAL_FIRST_PRIORITY', () => {
    expect(rows[1]).toMatchObject({
      currentDietItemId: null,
      projectedNeedKg: 10000,
      projectedShortfallKg: 9000,
      recommendedOrderKg: 9000,
      alert: 'CRITICAL_FIRST_PRIORITY',
      requisitionStatus: null,
    });
  });

  it('a silo with no demand and balance at or above Above Threshold is INFO', () => {
    expect(rows[2]).toMatchObject({
      currentDietItemId: null,
      dailyRequirementKg: 0,
      daysRemaining: null,
      projectedNeedKg: 0,
      projectedShortfallKg: 0,
      recommendedOrderKg: 0,
      alert: 'INFO',
      nextDietItemId: null,
      siloAvailableForNextDiet: null,
    });
  });

  it('rounds a bagged silo to the bag size', () => {
    const [row] = buildSiloStatus({
      silos: [fact({ feedType: 'BAGGED' })],
      result: {
        ...result,
        sources: result.sources.map((s) => ({ ...s, shortfallKg: 4510 })),
      },
      requisitionStatusBySilo: new Map(),
      submissionDeadline: null,
    });
    expect(row.recommendedOrderKg).toBe(4550);
  });

  it('no thresholds set means no alert', () => {
    const [row] = buildSiloStatus({
      silos: [
        fact({
          belowFeedLevelKg: null,
          aboveThresholdKg: null,
          systemBalanceKg: 0,
        }),
      ],
      result,
      requisitionStatusBySilo: new Map(),
      submissionDeadline: null,
    });
    expect(row.alert).toBeNull();
  });

  it("I2: the earliest shortage date and the minimum days left come from across all of a silo's sources, not from primary alone — dailyRequirementKg stays on primary (the workbook's Dashboard row 58 shape: current diet ample, next diet none)", () => {
    const twoSourceSilo = {
      sources: [
        // current diet: ample stock, no shortage anywhere in the window.
        {
          sourceType: 'SILO',
          locationId: 's1',
          itemId: 'r1',
          planningDayDemandKg: 400,
          firstDayDemandKg: 400,
          walkDemandKg: 2800,
          safetyStockKg: 0,
          shortfallKg: 0,
          daysLeft: 22.5,
          shortageDate: null,
        },
        // next diet: nothing eats it today, but the silo holds none of it — an immediate shortage.
        {
          sourceType: 'SILO',
          locationId: 's1',
          itemId: 'r2',
          planningDayDemandKg: 0,
          firstDayDemandKg: 0,
          walkDemandKg: 1200,
          safetyStockKg: 0,
          shortfallKg: 1200,
          daysLeft: 0,
          shortageDate: '2026-09-24',
        },
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
      dietChanges: [
        {
          batchId: 'b',
          realBatchId: 'b' as any,
          batchNo: 'B1',
          shedCode: 'SHED-A',
          fromItemId: 'r1',
          fromItemName: 'R1',
          toItemId: 'r2',
          toItemName: 'R2',
          changeDate: '2026-09-26',
          nextSourceType: 'SILO' as const,
          nextSourceCode: 'SILO-X',
        },
      ],
    };
    const [a, b] = buildSiloStatus({
      silos: [
        fact({ siloId: 'sa', siloCode: 'SILO-A', houseCodes: ['SHED-A'] }),
        fact({ siloId: 'sb', siloCode: 'SILO-B', houseCodes: ['SHED-B'] }),
      ],
      result: twoSheds,
      requisitionStatusBySilo: new Map(),
      submissionDeadline: null,
    });
    expect(a).toMatchObject({
      nextDietItemId: 'r2',
      nextDietDate: '2026-09-26',
    });
    expect(b).toMatchObject({
      nextDietItemId: null,
      nextDietDate: null,
      siloAvailableForNextDiet: null,
    });
  });

  /**
   * W2D / A5 (Dashboard rows 50, 58, 59; checkpoint 9): the current and next diet items come with their Item No.
   * for a link, and the next-diet silo is an ACTIVE silo at the changing house whose Feed Type (BULK/BAGGED)
   * matches the next diet's feed form — not the engine's "a silo already holds the item".
   */
  describe('W2D A5: item codes and next-diet silo by Feed Type', () => {
    const change = (over: object = {}) => ({
      sources: [],
      dietChanges: [
        {
          batchId: 'b',
          realBatchId: 'b' as any,
          batchNo: 'B1',
          shedCode: 'SHED-A',
          fromItemId: 'r1',
          fromItemName: 'R1',
          toItemId: 'r2',
          toItemName: 'R2',
          changeDate: '2026-09-26',
          nextSourceType: 'STORE' as const,
          nextSourceCode: null,
          ...over,
        },
      ],
    });
    const silosAtA = [
      fact({
        siloId: 'sa',
        siloCode: 'SILO-A',
        houseCodes: ['SHED-A'],
        feedType: 'BULK',
      }),
      fact({
        siloId: 'sb',
        siloCode: 'SILO-B',
        houseCodes: ['SHED-A'],
        feedType: 'BAGGED',
        feedInSiloItemId: 'r9',
      }),
      fact({
        siloId: 'sc',
        siloCode: 'SILO-C',
        houseCodes: ['SHED-Z'],
        feedType: 'BAGGED',
        feedInSiloItemId: 'r9',
      }),
    ];

    it('returns current and next diet item codes', () => {
      const [row] = buildSiloStatus({
        silos: [fact({})],
        result: buildFeedForecast(workedExample),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
        itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
      });
      expect(row).toMatchObject({
        currentDietItemId: 'r1',
        currentDietItemCode: 'FEED-R1',
        nextDietItemId: 'r2',
        nextDietItemCode: 'FEED-R2',
      });
    });

    it('codes are null when unknown, never an id', () => {
      const [row] = buildSiloStatus({
        silos: [fact({})],
        result: buildFeedForecast(workedExample),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
      });
      expect(row).toMatchObject({
        currentDietItemCode: null,
        nextDietItemCode: null,
      });
    });

    it('finds a BAGGED silo at the house for a BAGGED next diet even though no silo holds the item', () => {
      const [a] = buildSiloStatus({
        silos: silosAtA,
        result: change(),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
        itemFeedTypes: { r2: 'BAGGED' },
      });
      expect(a).toMatchObject({
        nextDietFeedType: 'BAGGED',
        siloAvailableForNextDiet: true,
        nextDietSiloId: 'sb',
        nextDietSiloCode: 'SILO-B',
      });
    });

    it('is not available when no silo at that house has the feed type, even if the engine found a silo holding the item', () => {
      const [a] = buildSiloStatus({
        silos: silosAtA.map((s) => ({ ...s, feedType: 'BULK' as const })),
        result: change({ nextSourceType: 'SILO', nextSourceCode: 'SILO-A' }),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
        itemFeedTypes: { r2: 'BAGGED' },
      });
      expect(a).toMatchObject({
        siloAvailableForNextDiet: false,
        nextDietSiloId: null,
        nextDietSiloCode: null,
      });
    });

    it('prefers the silo the engine will draw from when it matches the feed type', () => {
      const silos = [
        ...silosAtA,
        fact({
          siloId: 'sd',
          siloCode: 'SILO-D',
          houseCodes: ['SHED-A'],
          feedType: 'BAGGED',
          feedInSiloItemId: 'r2',
        }),
      ];
      const [a] = buildSiloStatus({
        silos,
        result: change({ nextSourceType: 'SILO', nextSourceCode: 'SILO-D' }),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
        itemFeedTypes: { r2: 'BAGGED' },
      });
      expect(a).toMatchObject({
        siloAvailableForNextDiet: true,
        nextDietSiloId: 'sd',
        nextDietSiloCode: 'SILO-D',
      });
    });

    it('without a configured feed form falls back to the engine source', () => {
      const [a] = buildSiloStatus({
        silos: silosAtA,
        result: change({ nextSourceType: 'SILO', nextSourceCode: 'SILO-B' }),
        requisitionStatusBySilo: new Map(),
        submissionDeadline: null,
      });
      expect(a).toMatchObject({
        nextDietFeedType: null,
        siloAvailableForNextDiet: true,
        nextDietSiloId: 'sb',
        nextDietSiloCode: 'SILO-B',
      });
    });
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
      currentDietItemCode: null,
      feedInSiloItemCode: null,
      nextDietItemCode: null,
      nextDietItemName: null,
      nextDietNote: null,
      nextDietFeedType: null,
      nextDietSiloId: null,
      nextDietSiloCode: null,
    };
    const source = (
      itemId: string,
      itemName: string,
      walkDemandKg: number,
    ) => ({
      sourceType: 'SILO',
      sourceCode: 'GRS/SILO-001',
      locationId: 's1',
      itemId,
      itemName,
      balanceKg: 1500,
      planningDayDemandKg: itemId === 'r1' ? 500 : 0,
      currentDietDaysRemaining: itemId === 'r1' ? 3 : null,
      firstDemandDate: '2026-09-23',
      firstDayDemandKg: 500,
      walkDemandKg,
      daysLeft: 3,
      runDownDate: '2026-09-26',
      shortageDate: '2026-09-26',
      isNextDiet: itemId === 'r2',
      noSiloHoldsItem: false,
      lifecycleIds: [],
      thresholdKg: 0,
      safetyStockKg: 100,
      deliveryDayOpeningKg: 0,
      incomingKg: 0,
      shortfallKg: 200,
    });
    const daily = (
      batchId: string,
      itemId: string,
      itemName: string,
      date: string,
      demandKg: number,
      closingKg: number,
    ) => ({
      batchId,
      itemId,
      itemName,
      date,
      demandKg,
      projectedClosingKg: closingKg,
      sourceType: 'SILO',
      destinationLocationId: 's1',
      currentInventoryKg: 1500,
      confirmedReceiptKg: 0,
    });

    const shaped = buildSelectedSiloDashboard({
      status,
      planningDate: '2026-09-23',
      nextBinAssignment: null,
      result: {
        sources: [
          source('r1', 'Diet R1', 1000),
          source('r2', 'Diet R2', 500),
        ] as any,
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
      {
        date: '2026-09-23',
        itemId: 'r1',
        itemName: 'Diet R1',
        openingKg: 1500,
        confirmedReceiptKg: 0,
        demandKg: 500,
        closingKg: 1000,
      },
      {
        date: '2026-09-26',
        itemId: 'r2',
        itemName: 'Diet R2',
        openingKg: 1500,
        confirmedReceiptKg: 0,
        demandKg: 500,
        closingKg: 1000,
      },
    ]);
    expect(shaped.demandSeries).toEqual([
      { date: '2026-09-23', currentDietKg: 500, nextDietKg: 0 },
      { date: '2026-09-26', currentDietKg: 0, nextDietKg: 500 },
    ]);
  });

  it('counts a next stage on the same item as current demand once, not as next demand too (12 Oct)', () => {
    const status = {
      siloId: 's1',
      siloCode: 'SILO-1',
      feedInSiloItemId: 'r1',
      currentDietItemId: 'r1',
      nextDietItemId: 'r1',
      nextDietItemName: 'Diet R1',
      submissionDeadline: null,
    } as any;
    const src = {
      sourceType: 'SILO',
      sourceCode: 'SILO-1',
      locationId: 's1',
      itemId: 'r1',
      itemName: 'Diet R1',
      balanceKg: 1500,
      planningDayDemandKg: 200,
      currentDietDaysRemaining: 5,
      firstDemandDate: '2026-09-23',
      firstDayDemandKg: 200,
      walkDemandKg: 1000,
      daysLeft: 5,
      runDownDate: null,
      shortageDate: null,
      isNextDiet: false,
      noSiloHoldsItem: false,
      lifecycleIds: [],
      thresholdKg: 0,
      safetyStockKg: 0,
      deliveryDayOpeningKg: 0,
      incomingKg: 0,
      shortfallKg: 0,
    };
    const day = {
      batchId: 'batch-a',
      itemId: 'r1',
      itemName: 'Diet R1',
      date: '2026-09-23',
      demandKg: 200,
      projectedClosingKg: 1300,
      sourceType: 'SILO',
      destinationLocationId: 's1',
      currentInventoryKg: 1500,
      confirmedReceiptKg: 0,
    };
    const shaped = buildSelectedSiloDashboard({
      status,
      planningDate: '2026-09-23',
      nextBinAssignment: null,
      result: { sources: [src] as any, daily: [day] as any },
    });
    expect(shaped.demandSeries).toEqual([
      { date: '2026-09-23', currentDietKg: 200, nextDietKg: 0 },
    ]);
    expect(shaped.silo.nextProjectedNeedKg).toBe(0);
  });

  it('returns an exact Mill BIN assignment when supplied instead of inventing one', () => {
    const status = {
      ...fact({}),
      currentDietItemId: 'r1',
      dailyRequirementKg: 0,
      daysRemaining: null,
      firstShortageDate: null,
      projectedNeedKg: 0,
      nextDietItemId: null,
      nextDietDate: null,
      siloAvailableForNextDiet: null,
      projectedShortfallKg: 0,
      recommendedOrderKg: 0,
      requisitionId: null,
      requisitionStatus: null,
      submissionDeadline: null,
      alert: null,
    } as SiloStatusRow;
    const assignment = {
      binId: 'bin-1',
      binCode: 'BIN-001',
      productionDate: '2026-09-24',
    };

    const shaped = buildSelectedSiloDashboard({
      status,
      result: { sources: [], daily: [] },
      planningDate: '2026-09-23',
      nextBinAssignment: assignment,
    });

    expect(shaped.silo.millLoadingBin).toEqual(assignment);
  });
});

/** Rishi, 12 Oct: Next Diet Feed Item / Silo Available come from the breed lifecycle of the stage the Next Stage field names. */
describe('buildSiloStatus: next diet from the Next Stage field', () => {
  const stage = (
    stageId: string,
    sequence: number,
    over: Partial<NextStageStage> = {},
  ): NextStageStage => ({
    stageId,
    stageCode: stageId.toUpperCase(),
    stageName: stageId,
    durationDays: 10,
    isActive: true,
    sequence,
    companyId: 'c1',
    lobId: 'l1',
    ...over,
  });
  const stages = new Map<string, NextStageStage>([
    ['grower', stage('grower', 13, { nextStageId: 'finisher' })],
    ['finisher', stage('finisher', 14, { nextStageId: null })],
    // Weaner's Next Stage field skips Grower although Grower is next by display order: the field wins.
    ['weaner', stage('weaner', 12, { nextStageId: 'finisher' })],
    ['culled', stage('culled', 20, { nextStageId: 'retired' })],
    ['retired', stage('retired', 21, { isActive: false })],
  ]);
  const row = (over: object) => ({
    lifecycleId: 'x',
    breedId: 'br',
    stageId: 'finisher',
    itemId: 'fin',
    itemName: 'Finisher',
    fromDay: 1,
    toDay: 30,
    kgPerHeadPerDay: 2,
    wastagePct: 0,
    ...over,
  });
  const batch = (stageId: string, over: object = {}) => ({
    batchNo: 'B1',
    breedId: 'br',
    shedId: 'shed',
    heads: 100,
    segments: [
      { stageId, stageCode: stageId.toUpperCase(), start: '2026-10-01' },
    ],
    ...over,
  });
  const diets = (
    stageId: string,
    feedRows: any[],
    farmId: string | null = null,
    extra: object = {},
  ) =>
    resolveNextStageDiets({
      batches: [batch(stageId, extra)],
      stages,
      feedRows,
      farmId,
      planningDate: '2026-10-12',
      shedCodeById: new Map([['shed', 'SHED-A']]),
      items: { fin: 'Finisher', fin2: 'Finisher Farm' },
      breedNames: { br: 'Duroc' },
    });
  const silos = [
    fact({
      siloId: 'sa',
      siloCode: 'SILO-A',
      houseCodes: ['SHED-A'],
      feedType: 'BULK',
      feedInSiloItemId: 'gro',
    }),
    fact({
      siloId: 'sb',
      siloCode: 'SILO-B',
      houseCodes: ['SHED-A'],
      feedType: 'BAGGED',
      feedInSiloItemId: null,
    }),
  ];
  const noChange = { sources: [], dietChanges: [] };
  const run = (
    nextStageDiets: any[],
    itemFeedTypes: Record<string, 'BULK' | 'BAGGED'>,
    s = silos,
    result: any = noChange,
  ) =>
    buildSiloStatus({
      silos: s,
      result,
      requisitionStatusBySilo: new Map(),
      submissionDeadline: null,
      itemFeedTypes,
      nextStageDiets,
      asOf: '2026-10-12',
      itemCodes: { fin: 'FIN-1' },
    });

  it('(a) a diet change the engine found in the window wins over the lifecycle', () => {
    const dietChanges = [
      {
        batchId: 'b',
        realBatchId: 'b' as any,
        batchNo: 'B1',
        shedCode: 'SHED-A',
        fromItemId: 'gro',
        fromItemName: 'Grower',
        toItemId: 'chg',
        toItemName: 'Changed',
        changeDate: '2026-10-15',
        nextSourceType: 'SILO' as const,
        nextSourceCode: 'SILO-A',
      },
    ];
    const [a] = run(
      diets('grower', [row({})]),
      { chg: 'BULK', fin: 'BULK' },
      silos,
      { sources: [], dietChanges },
    );
    expect(a).toMatchObject({
      nextDietItemId: 'chg',
      nextDietDate: '2026-10-15',
      nextDietNote: null,
    });
  });

  it('(b) no change in the window: the Next Stage field -> its feed item, date and a matching BULK silo', () => {
    const [a, b] = run(diets('grower', [row({})]), { fin: 'BULK' });
    // Grower -> Finisher by its Next Stage field. Grower starts 1 Oct for 10 days -> 11 Oct.
    expect(a).toMatchObject({
      nextDietItemId: 'fin',
      nextDietItemCode: 'FIN-1',
      nextDietDate: '2026-10-11',
      nextDietFeedType: 'BULK',
      siloAvailableForNextDiet: true,
      nextDietSiloCode: 'SILO-A',
      nextDietNote: null,
    });
    expect(b).toMatchObject({
      nextDietItemId: 'fin',
      siloAvailableForNextDiet: true,
      nextDietSiloCode: 'SILO-A',
    });
  });

  it('(c) next item is BAGGED and the shed has no bagged silo: Silo Available is No', () => {
    const [a] = run(diets('grower', [row({})]), { fin: 'BAGGED' }, [silos[0]]);
    expect(a).toMatchObject({
      nextDietItemId: 'fin',
      nextDietFeedType: 'BAGGED',
      siloAvailableForNextDiet: false,
      nextDietSiloCode: null,
    });
  });

  it('(d) no Next Stage set: blank next diet with a reason', () => {
    const [a] = run(diets('finisher', [row({ stageId: 'finisher' })]), {
      fin: 'BULK',
    });
    expect(a).toMatchObject({
      nextDietItemId: null,
      nextDietDate: null,
      siloAvailableForNextDiet: null,
    });
    expect(a.nextDietNote).toBe(
      'No Next Stage set for stage finisher — no next diet',
    );
  });

  it('the Next Stage field wins over Display Order', () => {
    const [a] = run(diets('weaner', [row({})]), { fin: 'BULK' });
    expect(a).toMatchObject({ nextDietItemId: 'fin' });
  });

  it('a Next Stage that is inactive gives no next diet', () => {
    const [a] = run(diets('culled', [row({ stageId: 'retired' })]), {
      fin: 'BULK',
    });
    expect(a.nextDietItemId).toBeNull();
    expect(a.nextDietNote).toMatch(/No Next Stage set for stage culled/);
  });

  it('(d2) next stage has no lifecycle feed item: blank with a reason naming stage and breed', () => {
    const [a] = run(diets('grower', []), {});
    expect(a).toMatchObject({
      nextDietItemId: null,
      siloAvailableForNextDiet: null,
    });
    expect(a.nextDietNote).toBe(
      'No feed item set for stage finisher of breed Duroc',
    );
  });

  it('(e) a farm override lifecycle row beats the default row', () => {
    const rows = [
      row({ lifecycleId: 'def' }),
      row({
        lifecycleId: 'own',
        itemId: 'fin2',
        itemName: 'Finisher Farm',
        farmId: 'farm-1',
      }),
    ];
    const [a] = run(diets('grower', rows, 'farm-1'), { fin2: 'BULK' });
    expect(a).toMatchObject({
      nextDietItemId: 'fin2',
      siloAvailableForNextDiet: true,
    });
    const [d] = run(diets('grower', rows, 'farm-2'), { fin: 'BULK' });
    expect(d.nextDietItemId).toBe('fin');
  });

  it('prefers the silo already holding the item, and only counts links in effect', () => {
    const held = [
      fact({
        siloId: 'sa',
        siloCode: 'SILO-A',
        houseCodes: ['SHED-A'],
        feedType: 'BULK',
        feedInSiloItemId: 'gro',
      }),
      fact({
        siloId: 'sc',
        siloCode: 'SILO-C',
        houseCodes: ['SHED-A'],
        feedType: 'BULK',
        feedInSiloItemId: 'fin',
      }),
      fact({
        siloId: 'sd',
        siloCode: 'SILO-D',
        houseCodes: ['SHED-A'],
        houseLinks: [{ code: 'SHED-A', effectiveTo: '2026-09-01' }],
        feedType: 'BULK',
        feedInSiloItemId: 'fin',
      }),
    ];
    const rows = run(diets('grower', [row({})]), { fin: 'BULK' }, held);
    expect(rows[0]).toMatchObject({ nextDietSiloCode: 'SILO-C' });
    expect(rows[2]).toMatchObject({ nextDietItemId: null }); // SILO-D's link to the shed ended: it serves no batch
  });

  it('several batches: the one with an item, then the earliest date, then the most heads', () => {
    const many = [
      ...diets('grower', [row({})], null, {
        batchNo: 'LATE',
        segments: [
          { stageId: 'grower', stageCode: 'GROWER', start: '2026-10-05' },
        ],
        heads: 500,
      }),
      ...diets('grower', [row({ itemId: 'fin2' })], null, {
        batchNo: 'EARLY',
        heads: 10,
      }),
    ];
    const [a] = run(many, { fin: 'BULK', fin2: 'BULK' });
    expect(a.nextDietItemId).toBe('fin2');
  });
});

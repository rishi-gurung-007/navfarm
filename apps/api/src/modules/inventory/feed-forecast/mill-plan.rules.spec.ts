import type { DailyForecastRow, DietChange } from './feed-forecast.engine';
import {
  requisitionStage,
  animalTypeOfStage,
  buildMillPlan,
  MillPlanFarmInput,
  MillPlanInput,
  shareHeads,
} from './mill-plan.rules';

// Mill Planning (spec 2026-11-03): one week of every selected farm's forecast,
// added up for the mill, with approved requisitions not yet produced on top.
const dates = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];
const STARTER = 'item-starter';
const GROWER = 'item-grower';

const row = (over: Partial<DailyForecastRow>): DailyForecastRow => ({
  date: dates[0],
  batchId: 'B-1',
  realBatchId: 'B-1' as any,
  batchNo: 'B-1',
  shedCode: 'S1',
  stageCode: 'GRW',
  stageId: 'st',
  groupStageId: 'st',
  itemId: GROWER,
  itemNo: 'GRW',
  itemName: 'Grower',
  lifecycleId: 'lc',
  sourceType: 'SILO',
  sourceCode: 'SL-1',
  currentInventoryKg: 0,
  heads: 100,
  feedRateKg: 2,
  perDayIntakeKg: 200,
  wastagePct: 0,
  demandKg: 200,
  daysOfStock: null,
  sharedBatchCount: 1,
  indicative: false,
  runDownDate: null,
  ...over,
});

const balance = (over: Record<string, unknown>) => ({
  date: dates[0],
  sourceType: 'SILO' as const,
  sourceCode: 'SL-1',
  sourceName: 'Silo 1',
  feedType: 'BULK' as const,
  locationId: 'loc-sl1',
  itemId: GROWER,
  itemNo: 'GRW',
  itemName: 'Grower',
  currentItemId: null,
  currentItemNo: null,
  currentItemName: null,
  openingSystemBalanceKg: 0,
  confirmedReceiptKg: 0,
  openTransferMovementKg: 0,
  plannedIncomingKg: 0,
  otherOutflowKg: 0,
  usedBeforeReceivedKg: 0,
  incomingReferences: [],
  dailyUseKg: 0,
  projectedClosingBalanceKg: 0,
  recommendedQtyKg: 0,
  firstShortageDate: null,
  deliveryDate: null,
  runDownDate: null,
  ...over,
});

const farm = (over: Partial<MillPlanFarmInput> = {}): MillPlanFarmInput => ({
  farm: { id: 'farm-1', code: 'F1', name: 'Farm One' },
  daily: [],
  sourceBalances: [],
  dietChanges: [],
  flags: [],
  ...over,
});

const input = (over: Partial<MillPlanInput> = {}): MillPlanInput => ({
  dates,
  farms: [farm()],
  failedFarms: [],
  itemIds: null,
  items: new Map([
    [STARTER, { itemCode: 'STR', itemName: 'Starter', feedForm: 'BULK' }],
    [GROWER, { itemCode: 'GRW', itemName: 'Grower', feedForm: 'BULK' }],
  ]),
  planFarmIds: ['farm-1'],
  approved: [],
  producedKg: [],
  mill: {
    millId: 'mill-1',
    millCode: 'MILL-1',
    millName: 'Main Mill',
    dailyKg: 10_000,
    hourlyKg: null,
    bulkKg: null,
    baggedKg: null,
  },
  capacityByDate: new Map(),
  siloCapacityKg: new Map(),
  warningPct: 90,
  ...over,
});

describe('buildMillPlan', () => {
  it('sums shed demand per date for the selected feeds only', () => {
    const plan = buildMillPlan(
      input({
        itemIds: [GROWER],
        farms: [
          farm({
            daily: [
              row({ itemId: STARTER, itemName: 'Starter', demandKg: 150 }),
              row({ itemId: GROWER, demandKg: 200 }),
            ],
          }),
        ],
      }),
    );
    expect(plan.farms[0].sheds[0].kg[0]).toBe(200);
    expect(plan.farms[0].totals[0]).toBe(200);
  });

  it('keeps two batches in one shed as two rows', () => {
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            daily: [
              row({ batchId: 'B-1', batchNo: 'B-1' }),
              row({ batchId: 'B-2', batchNo: 'B-2' }),
            ],
          }),
        ],
      }),
    );
    expect(plan.farms[0].sheds).toHaveLength(2);
  });

  it('approved minus produced never goes below zero', () => {
    const approved = (itemId: string, kg: number) => ({
      productionDate: dates[0],
      farmId: 'farm-1',
      itemId,
      requestedKg: kg,
      millApprovedKg: null,
    });
    const plan = buildMillPlan(
      input({
        approved: [approved(STARTER, 5000), approved(GROWER, 5000)],
        producedKg: [
          { productionDate: dates[0], itemId: STARTER, quantityKg: 6000 },
          { productionDate: dates[0], itemId: GROWER, quantityKg: 2000 },
        ],
      }),
    );
    const day = (itemId: string) =>
      plan.production.find((p) => p.itemId === itemId)?.days[0].approvedKg ?? 0;
    expect(day(STARTER)).toBe(0);
    expect(day(GROWER)).toBe(3000);
  });

  it("counts a shared silo's recommended quantity once", () => {
    const point = {
      recommendedQtyKg: 4000,
      deliveryDate: dates[2],
      firstShortageDate: dates[4],
    };
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            sourceBalances: dates.map((date) => balance({ date, ...point })),
          }),
        ],
      }),
    );
    const grower = plan.production.find((p) => p.itemId === GROWER)!;
    expect(grower.days[2].forecastKg).toBe(4000);
    expect(grower.totalKg).toBe(4000);
  });

  it('marks a day WARN at the warning percent and OVER above 100', () => {
    const approved = (date: string, kg: number) => ({
      productionDate: date,
      farmId: 'farm-1',
      itemId: GROWER,
      requestedKg: kg,
      millApprovedKg: null,
    });
    const plan = buildMillPlan(
      input({
        approved: [
          approved(dates[0], 9000),
          approved(dates[1], 10_001),
          approved(dates[2], 8999),
        ],
      }),
    );
    expect(plan.capacity.slice(0, 3).map((d) => d.status)).toEqual([
      'WARN',
      'OVER',
      'OK',
    ]);
    expect(plan.capacity[0].usedPct).toBe(90);
    expect(plan.cards.daysNearOrOver).toBe(2);
  });

  it('reports NO_CAPACITY when the mill has no daily capacity', () => {
    const plan = buildMillPlan(input({ mill: null }));
    expect(
      plan.capacity.every(
        (d) => d.status === 'NO_CAPACITY' && d.usedPct === null,
      ),
    ).toBe(true);
  });

  it('lists a diet change when either feed is selected, with heads from the daily row', () => {
    const change: DietChange = {
      batchId: 'B-1',
      realBatchId: 'B-1' as any,
      batchNo: 'B-1',
      shedCode: 'S1',
      fromItemId: STARTER,
      fromItemName: 'Starter',
      toItemId: GROWER,
      toItemName: 'Grower',
      changeDate: dates[3],
      nextSourceType: 'SILO',
      nextSourceCode: 'SL-1',
    };
    const plan = buildMillPlan(
      input({
        itemIds: [GROWER],
        farms: [
          farm({
            dietChanges: [change],
            daily: [row({ date: dates[3], heads: 120 })],
          }),
        ],
      }),
    );
    expect(plan.dietChanges).toEqual([
      expect.objectContaining({
        shedCode: 'S1',
        changeDate: dates[3],
        heads: 120,
        farmName: 'Farm One',
      }),
    ]);
    expect(plan.farms[0].sheds[0].changeDate).toBe(dates[3]);
  });

  it("finds a silo's run-out date", () => {
    const closing = [3000, 1000, 0, 0, 0, 0, 0];
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            sourceBalances: dates.map((date, i) =>
              balance({
                date,
                openingSystemBalanceKg: i === 0 ? 5000 : 0,
                projectedClosingBalanceKg: closing[i],
              }),
            ),
          }),
        ],
      }),
    );
    const silo = plan.farms[0].silos[0];
    expect(silo.openingKg).toBe(5000);
    expect(silo.closingKg).toEqual(closing);
    expect(silo.runOutDate).toBe(dates[2]);
    expect(plan.cards.silosRunningOut).toBe(1);
  });

  it('leaves a day the forecast does not cover blank, not a run-out', () => {
    // The week starts before the planning date: no balance for the first day.
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            sourceBalances: dates.slice(1).map((date, i) =>
              balance({
                date,
                openingSystemBalanceKg: i === 0 ? 4000 : 0,
                projectedClosingBalanceKg: 3000,
              }),
            ),
          }),
        ],
      }),
    );
    const silo = plan.farms[0].silos[0];
    expect(silo.closingKg[0]).toBeNull();
    expect(silo.openingKg).toBe(4000);
    expect(silo.runOutDate).toBeNull();
    expect(plan.cards.silosRunningOut).toBe(0);
  });

  it("credits mill output to every farm's order of that feed and day, in proportion", () => {
    // The mill made 5 t of Grower on day 1 against farm-1's 4 t and farm-2's 6 t: half of each is still to make.
    const plan = buildMillPlan(
      input({
        planFarmIds: ['farm-1'],
        approved: [
          {
            productionDate: dates[0],
            farmId: 'farm-1',
            itemId: GROWER,
            requestedKg: 4000,
            millApprovedKg: null,
          },
          {
            productionDate: dates[0],
            farmId: 'farm-2',
            itemId: GROWER,
            requestedKg: 6000,
            millApprovedKg: null,
          },
        ],
        producedKg: [
          { productionDate: dates[0], itemId: GROWER, quantityKg: 5000 },
        ],
      }),
    );
    expect(
      plan.production.find((p) => p.itemId === GROWER)!.days[0].approvedKg,
    ).toBe(2000);
  });

  it('shows one row per feed of a store holding two feeds, each with its own opening', () => {
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            sourceBalances: [
              balance({
                sourceType: 'STORE',
                sourceCode: 'ST-1',
                itemId: GROWER,
                itemName: 'Grower',
                openingSystemBalanceKg: 800,
                projectedClosingBalanceKg: 700,
              }),
              balance({
                sourceType: 'STORE',
                sourceCode: 'ST-1',
                itemId: STARTER,
                itemName: 'Starter',
                openingSystemBalanceKg: 300,
                projectedClosingBalanceKg: 250,
              }),
            ],
          }),
        ],
      }),
    );
    const rows = plan.farms[0].silos.map((s) => [
      s.sourceCode,
      s.itemId,
      s.itemName,
      s.openingKg,
    ]);
    expect(rows).toEqual([
      ['ST-1', GROWER, 'Grower', 800],
      ['ST-1', STARTER, 'Starter', 300],
    ]);
  });

  it('makes one card per silo of every farm: stock against capacity, stores left out', () => {
    const plan = buildMillPlan(
      input({
        siloCapacityKg: new Map([
          ['loc-sl1', 10000],
          ['loc-sl2', null],
        ]),
        farms: [
          farm({
            sourceBalances: [
              balance({
                date: dates[1],
                sourceCode: 'SL-1',
                locationId: 'loc-sl1',
                openingSystemBalanceKg: 4000,
                projectedClosingBalanceKg: 3800,
              }),
              balance({
                date: dates[1],
                sourceCode: 'SL-1',
                locationId: 'loc-sl1',
                itemId: STARTER,
                itemName: 'Starter',
                openingSystemBalanceKg: 0,
                projectedClosingBalanceKg: 0,
              }),
              balance({
                date: dates[2],
                sourceCode: 'SL-1',
                locationId: 'loc-sl1',
                openingSystemBalanceKg: 3800,
                projectedClosingBalanceKg: 3600,
              }),
              balance({
                date: dates[1],
                sourceCode: 'SL-2',
                locationId: 'loc-sl2',
                openingSystemBalanceKg: 900,
                projectedClosingBalanceKg: 0,
              }),
              balance({
                date: dates[1],
                sourceType: 'STORE',
                sourceCode: 'ST-1',
                locationId: 'loc-st1',
                openingSystemBalanceKg: 500,
                projectedClosingBalanceKg: 500,
              }),
            ],
          }),
        ],
      }),
    );
    expect(plan.siloCards).toEqual([
      {
        farmId: 'farm-1',
        farmCode: 'F1',
        farmName: 'Farm One',
        sourceCode: 'SL-1',
        sourceName: 'Silo 1',
        items: ['Grower', 'Starter'],
        stockKg: 4000,
        capacityKg: 10000,
        fillPct: 40,
        runOutDate: null,
      },
      {
        farmId: 'farm-1',
        farmCode: 'F1',
        farmName: 'Farm One',
        sourceCode: 'SL-2',
        sourceName: 'Silo 1',
        items: ['Grower'],
        stockKg: 900,
        capacityKg: null,
        fillPct: null,
        runOutDate: dates[1],
      },
    ]);
  });

  it('says which batches eat nothing for want of a lifecycle feed row, once per batch and stage', () => {
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            flags: [
              {
                kind: 'NO_FEED_ROW',
                batchNo: 'B-302',
                stageCode: 'LACTATION',
                day: 185,
                date: dates[1],
              },
              {
                kind: 'NO_FEED_ROW',
                batchNo: 'B-302',
                stageCode: 'LACTATION',
                day: 184,
                date: dates[0],
              },
              { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B-302' },
            ],
          }),
        ],
      }),
    );
    expect(plan.farms[0].noFeedRows).toEqual([
      {
        batchNo: 'B-302',
        stageCode: 'LACTATION',
        fromDay: 184,
        fromDate: dates[0],
      },
    ]);
  });

  it('carries failed farms through untouched', () => {
    const failed = [
      { farmId: 'farm-2', code: 'F2', name: 'Farm Two', error: 'No lifecycle' },
    ];
    expect(buildMillPlan(input({ failedFarms: failed })).failedFarms).toEqual(
      failed,
    );
  });
});

// Rishi, 4 Nov: Production by Feed Type shows what the animals eat — heads, kg/head/day, and heads by Animal Type.
describe('consumption per feed', () => {
  it('types count-only heads by stage: piglets while suckling, commercial pigs after', () => {
    expect(animalTypeOfStage('LACTATION')).toBe('PIGLET');
    expect(animalTypeOfStage('WEANER')).toBe('COMMERCIAL_PIG');
    expect(animalTypeOfStage('GROWER')).toBe('COMMERCIAL_PIG');
  });

  it('shares heads out in whole numbers that add up', () => {
    expect(shareHeads(4, { SOW: 3, GILT: 1 })).toEqual({ SOW: 3, GILT: 1 });
    expect(shareHeads(3, { SOW: 1, GILT: 1 })).toEqual({ GILT: 2, SOW: 1 });
    expect(shareHeads(0, { SOW: 1 })).toEqual({});
  });

  it('gives each eaten feed its average heads, kg per head per day and Animal Types, with or without production', () => {
    const daily = dates.flatMap((date) => [
      row({
        date,
        batchId: 'W',
        realBatchId: 'W' as any,
        batchNo: 'W',
        stageCode: 'WEANER',
        heads: 200,
        demandKg: 100,
      }),
      row({
        date,
        batchId: 'S',
        realBatchId: 'S' as any,
        batchNo: 'S',
        stageCode: 'INSEMINATION',
        heads: 4,
        demandKg: 10,
      }),
    ]);
    const plan = buildMillPlan(
      input({
        farms: [farm({ daily, animalTypes: { S: { SOW: 3, GILT: 1 } } })],
      }),
    );
    const grower = plan.production.find((p) => p.itemId === GROWER)!;
    expect(grower.totalKg).toBe(0);
    expect(grower.consumption).toEqual({
      animals: 204,
      byType: [
        { animalType: 'COMMERCIAL_PIG', heads: 200 },
        { animalType: 'SOW', heads: 3 },
        { animalType: 'GILT', heads: 1 },
      ],
      kgPerHeadDay: Math.round((770 / 1428) * 1000) / 1000,
      kg: 770,
    });
  });

  it('averages heads over the days the feed is eaten only', () => {
    const daily = [
      row({ date: dates[5], heads: 50, demandKg: 25 }),
      row({ date: dates[6], heads: 70, demandKg: 35 }),
    ];
    const c = buildMillPlan(input({ farms: [farm({ daily })] })).production[0]
      .consumption;
    expect(c.animals).toBe(60);
    expect(c.kgPerHeadDay).toBe(0.5);
    expect(c.byType).toEqual([{ animalType: 'COMMERCIAL_PIG', heads: 60 }]);
  });
});

// Rishi, 4 Nov: a requisition due in the week is circled on its day, as on the consolidation sheet.
describe('requisitions due in the grid', () => {
  it('puts a requisition on its silo row and on each shed row drawing that feed from that silo, on its day', () => {
    const daily = dates.flatMap((date) => [
      row({
        date,
        batchId: 'B-1',
        batchNo: 'B-1',
        shedCode: 'S1',
        destinationLocationId: 'loc-sl1',
      }),
      row({
        date,
        batchId: 'B-2',
        batchNo: 'B-2',
        shedCode: 'S2',
        destinationLocationId: 'loc-sl1',
      }),
      row({
        date,
        batchId: 'B-3',
        batchNo: 'B-3',
        shedCode: 'S3',
        destinationLocationId: 'loc-sl2',
        sourceCode: 'SL-2',
      }),
    ]);
    const sourceBalances = dates.map((date) => balance({ date }));
    const requisitions = [
      {
        requisitionId: 'r1',
        reqNo: 'REQ-1',
        status: 'APPROVED',
        stage: 'APPROVED' as const,
        transferNos: [],
        shippedKg: 0,
        receivedKg: 0,
        siloId: 'loc-sl1',
        itemId: GROWER,
        date: dates[3],
        kg: 3000,
      },
      {
        requisitionId: 'r2',
        reqNo: 'REQ-2',
        status: 'APPROVED',
        stage: 'APPROVED' as const,
        transferNos: [],
        shippedKg: 0,
        receivedKg: 0,
        siloId: 'loc-sl1',
        itemId: STARTER,
        date: dates[4],
        kg: 1000,
      },
      {
        requisitionId: 'r3',
        reqNo: 'REQ-3',
        status: 'APPROVED',
        stage: 'APPROVED' as const,
        transferNos: [],
        shippedKg: 0,
        receivedKg: 0,
        siloId: 'loc-sl1',
        itemId: GROWER,
        date: '2026-11-20',
        kg: 500,
      },
    ];
    const plan = buildMillPlan(
      input({ farms: [farm({ daily, sourceBalances, requisitions })] }),
    );
    const f = plan.farms[0];
    const due = {
      date: dates[3],
      requisitionId: 'r1',
      reqNo: 'REQ-1',
      status: 'APPROVED',
      stage: 'APPROVED',
      transferNos: [],
      shippedKg: 0,
      receivedKg: 0,
      stage: 'APPROVED' as const,
      transferNos: [],
      shippedKg: 0,
      receivedKg: 0,
      kg: 3000,
      sourceCode: 'SL-1',
      itemName: 'Grower',
    };
    expect(f.silos.find((s) => s.sourceCode === 'SL-1')!.requisitions).toEqual([
      due,
    ]);
    expect(f.sheds.find((s) => s.batchNo === 'B-1')!.requisitions).toEqual([
      due,
    ]);
    expect(f.sheds.find((s) => s.batchNo === 'B-2')!.requisitions).toEqual([
      due,
    ]);
    expect(f.sheds.find((s) => s.batchNo === 'B-3')!.requisitions).toEqual([]);
  });
});

// Rishi, 4 Nov: Feed Type Changes carry the animals (by Animal Type) and the kg/head/day of the new feed.
describe('feed change details', () => {
  it('gives a change its heads by type, the new and old feed rates, and puts it on its grid row', () => {
    const change: DietChange = {
      batchId: 'B-1',
      realBatchId: 'B-1' as any,
      batchNo: 'B-1',
      shedCode: 'S1',
      fromItemId: STARTER,
      fromItemName: 'Starter',
      toItemId: GROWER,
      toItemName: 'Grower',
      changeDate: dates[3],
      nextSourceType: 'SILO',
      nextSourceCode: 'SL-1',
    };
    const daily = [
      row({
        date: dates[2],
        itemId: STARTER,
        itemName: 'Starter',
        heads: 4,
        feedRateKg: 1.5,
        demandKg: 6,
        stageCode: 'GESTATION',
      }),
      row({
        date: dates[3],
        itemId: GROWER,
        itemName: 'Grower',
        heads: 4,
        feedRateKg: 2.8,
        demandKg: 11.2,
        stageCode: 'GESTATION',
      }),
    ];
    const plan = buildMillPlan(
      input({
        farms: [
          farm({
            daily,
            dietChanges: [change],
            animalTypes: { 'B-1': { SOW: 3, GILT: 1 } },
          }),
        ],
      }),
    );
    const expected = {
      farmId: 'farm-1',
      farmName: 'Farm One',
      shedCode: 'S1',
      batchNo: 'B-1',
      changeDate: dates[3],
      fromItemName: 'Starter',
      toItemName: 'Grower',
      heads: 4,
      byType: [
        { animalType: 'SOW', heads: 3 },
        { animalType: 'GILT', heads: 1 },
      ],
      kgPerHeadDay: 2.8,
      fromKgPerHeadDay: 1.5,
    };
    expect(plan.dietChanges).toEqual([expected]);
    expect(plan.farms[0].sheds[0].changes).toEqual([expected]);
  });
});

// Rishi, 4 Nov: a requisition's real stage from its three status fields and its transfer's shipped / received kg.
describe('requisitionStage', () => {
  const base = {
    status: 'APPROVED',
    documentStatus: null,
    fulfilmentStatus: null,
    kg: 3000,
    hasTransfer: false,
    shippedKg: 0,
    receivedKg: 0,
  };
  it('follows a requisition from approval to receipt', () => {
    expect(requisitionStage({ ...base, status: 'PENDING_APPROVAL' })).toBe(
      'PENDING',
    );
    expect(requisitionStage(base)).toBe('APPROVED');
    expect(requisitionStage({ ...base, status: 'IN_CONSOLIDATION' })).toBe(
      'IN_CONSOLIDATION',
    );
    expect(
      requisitionStage({
        ...base,
        status: 'IN_CONSOLIDATION',
        documentStatus: 'RELEASED',
      }),
    ).toBe('RELEASED');
    expect(
      requisitionStage({
        ...base,
        documentStatus: 'RELEASED',
        hasTransfer: true,
      }),
    ).toBe('TRANSFER_OPEN');
    expect(
      requisitionStage({ ...base, hasTransfer: true, shippedKg: 3000 }),
    ).toBe('SHIPPED');
    expect(
      requisitionStage({
        ...base,
        hasTransfer: true,
        shippedKg: 3000,
        receivedKg: 1000,
      }),
    ).toBe('PARTLY_RECEIVED');
    expect(
      requisitionStage({
        ...base,
        hasTransfer: true,
        shippedKg: 3000,
        receivedKg: 3000,
      }),
    ).toBe('RECEIVED');
  });

  it('reads the approval field alone as In Consolidation even when the delivery has moved on', () => {
    // REQ-MUL100-2026-00001: status IN_CONSOLIDATION, fulfilment RECEIVED, all 3,000 KG received.
    expect(
      requisitionStage({
        ...base,
        status: 'IN_CONSOLIDATION',
        documentStatus: 'RECEIVED',
        fulfilmentStatus: 'RECEIVED',
        hasTransfer: true,
        shippedKg: 3000,
        receivedKg: 3000,
      }),
    ).toBe('RECEIVED');
    expect(
      requisitionStage({
        ...base,
        status: 'IN_CONSOLIDATION',
        fulfilmentStatus: 'TRANSFER_OPEN',
      }),
    ).toBe('TRANSFER_OPEN');
  });
});

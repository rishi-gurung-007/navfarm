import type { DailyForecastRow, DietChange } from './feed-forecast.engine';
import { buildMillPlan, MillPlanFarmInput, MillPlanInput } from './mill-plan.rules';

// Mill Planning (spec 2026-11-03): one week of every selected farm's forecast,
// added up for the mill, with approved requisitions not yet produced on top.
const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const STARTER = 'item-starter';
const GROWER = 'item-grower';

const row = (over: Partial<DailyForecastRow>): DailyForecastRow => ({
  date: dates[0], batchId: 'B-1', realBatchId: 'B-1' as any, batchNo: 'B-1', shedCode: 'S1', stageCode: 'GRW',
  stageId: 'st', groupStageId: 'st', itemId: GROWER, itemNo: 'GRW', itemName: 'Grower', lifecycleId: 'lc',
  sourceType: 'SILO', sourceCode: 'SL-1', currentInventoryKg: 0, heads: 100, feedRateKg: 2, perDayIntakeKg: 200,
  wastagePct: 0, demandKg: 200, daysOfStock: null, sharedBatchCount: 1, indicative: false, runDownDate: null,
  ...over,
});

const balance = (over: Record<string, unknown>) => ({
  date: dates[0], sourceType: 'SILO' as const, sourceCode: 'SL-1', sourceName: 'Silo 1', feedType: 'BULK' as const,
  locationId: 'loc-sl1', itemId: GROWER, itemNo: 'GRW', itemName: 'Grower', currentItemId: null, currentItemNo: null,
  currentItemName: null, openingSystemBalanceKg: 0, confirmedReceiptKg: 0, openTransferMovementKg: 0, plannedIncomingKg: 0,
  otherOutflowKg: 0, usedBeforeReceivedKg: 0, incomingReferences: [], dailyUseKg: 0, projectedClosingBalanceKg: 0,
  recommendedQtyKg: 0, firstShortageDate: null, deliveryDate: null, runDownDate: null,
  ...over,
});

const farm = (over: Partial<MillPlanFarmInput> = {}): MillPlanFarmInput => ({
  farm: { id: 'farm-1', code: 'F1', name: 'Farm One' },
  daily: [], sourceBalances: [], dietChanges: [],
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
  mill: { millId: 'mill-1', millCode: 'MILL-1', millName: 'Main Mill', dailyKg: 10_000, hourlyKg: null, bulkKg: null, baggedKg: null },
  capacityByDate: new Map(),
  warningPct: 90,
  ...over,
});

describe('buildMillPlan', () => {
  it('sums shed demand per date for the selected feeds only', () => {
    const plan = buildMillPlan(input({
      itemIds: [GROWER],
      farms: [farm({ daily: [
        row({ itemId: STARTER, itemName: 'Starter', demandKg: 150 }),
        row({ itemId: GROWER, demandKg: 200 }),
      ] })],
    }));
    expect(plan.farms[0].sheds[0].kg[0]).toBe(200);
    expect(plan.farms[0].totals[0]).toBe(200);
  });

  it('keeps two batches in one shed as two rows', () => {
    const plan = buildMillPlan(input({
      farms: [farm({ daily: [row({ batchId: 'B-1', batchNo: 'B-1' }), row({ batchId: 'B-2', batchNo: 'B-2' })] })],
    }));
    expect(plan.farms[0].sheds).toHaveLength(2);
  });

  it('approved minus produced never goes below zero', () => {
    const approved = (itemId: string, kg: number) => ({ productionDate: dates[0], farmId: 'farm-1', itemId, requestedKg: kg, millApprovedKg: null });
    const plan = buildMillPlan(input({
      approved: [approved(STARTER, 5000), approved(GROWER, 5000)],
      producedKg: [
        { productionDate: dates[0], itemId: STARTER, quantityKg: 6000 },
        { productionDate: dates[0], itemId: GROWER, quantityKg: 2000 },
      ],
    }));
    const day = (itemId: string) => plan.production.find((p) => p.itemId === itemId)?.days[0].approvedKg ?? 0;
    expect(day(STARTER)).toBe(0);
    expect(day(GROWER)).toBe(3000);
  });

  it('counts a shared silo\'s recommended quantity once', () => {
    const point = { recommendedQtyKg: 4000, deliveryDate: dates[2], firstShortageDate: dates[4] };
    const plan = buildMillPlan(input({
      farms: [farm({ sourceBalances: dates.map((date) => balance({ date, ...point })) })],
    }));
    const grower = plan.production.find((p) => p.itemId === GROWER)!;
    expect(grower.days[2].forecastKg).toBe(4000);
    expect(grower.totalKg).toBe(4000);
  });

  it('marks a day WARN at the warning percent and OVER above 100', () => {
    const approved = (date: string, kg: number) => ({ productionDate: date, farmId: 'farm-1', itemId: GROWER, requestedKg: kg, millApprovedKg: null });
    const plan = buildMillPlan(input({ approved: [approved(dates[0], 9000), approved(dates[1], 10_001), approved(dates[2], 8999)] }));
    expect(plan.capacity.slice(0, 3).map((d) => d.status)).toEqual(['WARN', 'OVER', 'OK']);
    expect(plan.capacity[0].usedPct).toBe(90);
    expect(plan.cards.daysNearOrOver).toBe(2);
  });

  it('reports NO_CAPACITY when the mill has no daily capacity', () => {
    const plan = buildMillPlan(input({ mill: null }));
    expect(plan.capacity.every((d) => d.status === 'NO_CAPACITY' && d.usedPct === null)).toBe(true);
  });

  it('lists a diet change when either feed is selected, with heads from the daily row', () => {
    const change: DietChange = {
      batchId: 'B-1', realBatchId: 'B-1' as any, batchNo: 'B-1', shedCode: 'S1', fromItemId: STARTER, fromItemName: 'Starter',
      toItemId: GROWER, toItemName: 'Grower', changeDate: dates[3], nextSourceType: 'SILO', nextSourceCode: 'SL-1',
    };
    const plan = buildMillPlan(input({
      itemIds: [GROWER],
      farms: [farm({ dietChanges: [change], daily: [row({ date: dates[3], heads: 120 })] })],
    }));
    expect(plan.dietChanges).toEqual([expect.objectContaining({ shedCode: 'S1', changeDate: dates[3], heads: 120, farmName: 'Farm One' })]);
    expect(plan.farms[0].sheds[0].changeDate).toBe(dates[3]);
  });

  it('finds a silo\'s run-out date', () => {
    const closing = [3000, 1000, 0, 0, 0, 0, 0];
    const plan = buildMillPlan(input({
      farms: [farm({ sourceBalances: dates.map((date, i) => balance({ date, openingSystemBalanceKg: i === 0 ? 5000 : 0, projectedClosingBalanceKg: closing[i] })) })],
    }));
    const silo = plan.farms[0].silos[0];
    expect(silo.openingKg).toBe(5000);
    expect(silo.closingKg).toEqual(closing);
    expect(silo.runOutDate).toBe(dates[2]);
    expect(plan.cards.silosRunningOut).toBe(1);
  });

  it('leaves a day the forecast does not cover blank, not a run-out', () => {
    // The week starts before the planning date: no balance for the first day.
    const plan = buildMillPlan(input({
      farms: [farm({ sourceBalances: dates.slice(1).map((date, i) => balance({ date, openingSystemBalanceKg: i === 0 ? 4000 : 0, projectedClosingBalanceKg: 3000 })) })],
    }));
    const silo = plan.farms[0].silos[0];
    expect(silo.closingKg[0]).toBeNull();
    expect(silo.openingKg).toBe(4000);
    expect(silo.runOutDate).toBeNull();
    expect(plan.cards.silosRunningOut).toBe(0);
  });

  it('credits mill output to every farm\'s order of that feed and day, in proportion', () => {
    // The mill made 5 t of Grower on day 1 against farm-1's 4 t and farm-2's 6 t: half of each is still to make.
    const plan = buildMillPlan(input({
      planFarmIds: ['farm-1'],
      approved: [
        { productionDate: dates[0], farmId: 'farm-1', itemId: GROWER, requestedKg: 4000, millApprovedKg: null },
        { productionDate: dates[0], farmId: 'farm-2', itemId: GROWER, requestedKg: 6000, millApprovedKg: null },
      ],
      producedKg: [{ productionDate: dates[0], itemId: GROWER, quantityKg: 5000 }],
    }));
    expect(plan.production.find((p) => p.itemId === GROWER)!.days[0].approvedKg).toBe(2000);
  });

  it('shows one row per feed of a store holding two feeds, each with its own opening', () => {
    const plan = buildMillPlan(input({
      farms: [farm({ sourceBalances: [
        balance({ sourceType: 'STORE', sourceCode: 'ST-1', itemId: GROWER, itemName: 'Grower', openingSystemBalanceKg: 800, projectedClosingBalanceKg: 700 }),
        balance({ sourceType: 'STORE', sourceCode: 'ST-1', itemId: STARTER, itemName: 'Starter', openingSystemBalanceKg: 300, projectedClosingBalanceKg: 250 }),
      ] })],
    }));
    const rows = plan.farms[0].silos.map((s) => [s.sourceCode, s.itemName, s.openingKg]);
    expect(rows).toEqual([['ST-1', 'Grower', 800], ['ST-1', 'Starter', 300]]);
  });

  it('carries failed farms through untouched', () => {
    const failed = [{ farmId: 'farm-2', code: 'F2', name: 'Farm Two', error: 'No lifecycle' }];
    expect(buildMillPlan(input({ failedFarms: failed })).failedFarms).toEqual(failed);
  });
});

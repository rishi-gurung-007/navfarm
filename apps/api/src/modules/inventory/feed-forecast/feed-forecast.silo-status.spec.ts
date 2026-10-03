import { transactionCls } from '../../../test-utils/transaction-cls';
import { farmScope } from '../../../common/farm-scope';
import { FeedForecastService } from './feed-forecast.service';
import { buildFeedForecast } from './feed-forecast.engine';

const SETTINGS = { safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 6 };
const FEED_SETTINGS_STUB = { resolveForFeedPlanning: jest.fn(async () => SETTINGS) } as any;

/** Task 7: the service runs the engine once for a seven-day window from the planning date and hands it to buildSiloStatus. */
describe('FeedForecastService.siloStatus', () => {
  const farm = { id: 'farm-b', code: 'GRS', name: 'Grasmere', companyId: 'co-1' };
  const input = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-30',
    sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 }],
    store: null, items: { r1: 'Weaner Diet R1' },
    batches: [{ batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000, segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }] }],
    feedRows: [{ lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 40, kgPerHeadPerDay: 2.0, wastagePct: 0 }],
  };
  const siloFact = {
    siloId: 's1', siloCode: 'GRS/SILO-001', houseCodes: ['GRS/SHED-003'], capacityKg: 12000, belowFeedLevelKg: 1000, aboveThresholdKg: 10800,
    feedInSiloItemId: 'r1', feedInSiloItemName: 'Weaner Diet R1', feedType: 'BULK', systemBalanceKg: 1500,
    lastApprovedCountKg: null, lastApprovedCountAt: null, lastFeedReceiptDate: '2026-09-20', blocked: false,
  };

  function build() {
    const cls = transactionCls({});
    const service = new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB);
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-23', timeZone: null });
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-b', companyId: 'co-1' });
    jest.spyOn(service as any, 'loadFarm').mockResolvedValue(farm);
    jest.spyOn(service as any, 'loadInput').mockResolvedValue({ input, flags: [], stageBlocks: [] });
    return { cls, service };
  }

  it('forecasts seven days from the planning date, under the farm scope, and returns one row per silo', async () => {
    const { cls, service } = build();
    const compute = jest.spyOn(service, 'computeForFarm');
    const facts: Array<string | null> = [];
    jest.spyOn(service as any, 'loadSiloFacts').mockImplementation(async () => { facts.push(farmScope(cls).farmId); return [siloFact]; });
    jest.spyOn(service as any, 'loadOpenRequisitionStatuses').mockResolvedValue(new Map([['s1', 'AUTO_DRAFT']]));

    const out = await cls.run(() => service.siloStatus({ farmId: 'farm-b' }, 'tenant-1', 'TENANT_ADMIN'));

    expect(compute).toHaveBeenCalledWith('farm-b', 'co-1', 'tenant-1', { planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-30' }, expect.anything());
    expect(facts).toEqual(['farm-b']);
    expect(out.planningDate).toBe('2026-09-23');
    // Production day 6 (Saturday) after Wed 23 Sep is 26 Sep; the deadline is the day before.
    expect(out.submissionDeadline).toBe('2026-09-25');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ siloId: 's1', currentDietItemId: 'r1', dailyRequirementKg: 2000, requisitionStatus: 'AUTO_DRAFT', submissionDeadline: '2026-09-25' });
    expect(buildFeedForecast(input).sources[0].shortfallKg).toBeGreaterThan(0);
    expect(out.rows[0].recommendedOrderKg).toBeGreaterThan(0);
  });

  it('refuses a malformed planning date', async () => {
    const { cls, service } = build();
    await expect(cls.run(() => service.siloStatus({ planningDate: '2026-02-31' }, 'tenant-1', 'TENANT_ADMIN'))).rejects.toThrow(/calendar date/);
  });
});

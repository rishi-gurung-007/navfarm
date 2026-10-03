import { transactionCls } from '../../../test-utils/transaction-cls';
import { farmScope } from '../../../common/farm-scope';
import { FeedForecastService } from './feed-forecast.service';
import { buildFeedForecast } from './feed-forecast.engine';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

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
    lastApprovedCountKg: null, lastApprovedCountAt: null, lastFeedReceiptDate: '2026-09-20', nonKgBalance: false,
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

  it('forecasts seven days inclusive from the planning date, under the farm scope, and returns one row per silo', async () => {
    const { cls, service } = build();
    const compute = jest.spyOn(service, 'computeForFarm');
    const facts: Array<string | null> = [];
    jest.spyOn(service as any, 'loadSiloFacts').mockImplementation(async () => { facts.push(farmScope(cls).farmId); return [siloFact]; });
    jest.spyOn(service as any, 'loadLatestRequisitionStatuses').mockResolvedValue(new Map([['s1', 'AUTO_DRAFT']]));

    const out = await cls.run(() => service.siloStatus({ farmId: 'farm-b' }, 'tenant-1', 'TENANT_ADMIN'));

    // 9d F1: the shown window is still seven days; only the run-down/shortage search reaches the standard horizon.
    expect(compute).toHaveBeenCalledWith('farm-b', 'co-1', 'tenant-1',
      { planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', horizonTo: '2026-11-07' }, expect.anything());
    expect(facts).toEqual(['farm-b']);
    expect(out.planningDate).toBe('2026-09-23');
    // Production day 6 (Saturday) after Wed 23 Sep is 26 Sep; the deadline is the day before.
    expect(out.submissionDeadline).toBe('2026-09-25');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ siloId: 's1', currentDietItemId: 'r1', dailyRequirementKg: 2000, requisitionStatus: 'AUTO_DRAFT', submissionDeadline: '2026-09-25' });
    expect(buildFeedForecast(input).sources[0].shortfallKg).toBeGreaterThan(0);
    expect(out.rows[0].recommendedOrderKg).toBeGreaterThan(0);
  });

  /**
   * 9d F1 (Part A verification pass 2): the dashboard left First Shortage Date
   * blank for a shortage 8-45 days out while the forecast grid showed the date
   * (RIC100/SILO-002 19/10/26, LEX100/SILO-001 22/10/26), because siloStatus
   * computed with no horizonTo and so searched only its own seven-day window.
   * Dashboard row 55 / Master Setup row 15: "Determine first shortage date
   * from dated item level projection" — no window limit. Projected Need (and
   * so the shortfall and the recommended order) stays the seven-day window.
   */
  it('reports a shortage on day 10 while Projected Need stays the seven-day window (9d F1)', async () => {
    const { cls, service } = build();
    const compute = jest.spyOn(service, 'computeForFarm');
    // 100 heads at 1 kg/head/day on 950 kg: opening falls under a day's demand on day 10 (2026-10-02).
    const slowShortage = {
      ...input,
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 950 }],
      batches: [{ batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 100,
        segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-09-23', end: null, projected: false }] }],
      feedRows: [{ lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1',
        fromDay: 1, toDay: 90, kgPerHeadPerDay: 1, wastagePct: 0 }],
    };
    // As the real loadInput: the range and the horizon it is handed are what the engine walks.
    jest.spyOn(service as any, 'loadInput').mockImplementation(async (...args: unknown[]) => {
      const [, planningDate, from, to, , opts] = args as [unknown, string, string, string, string, { stockDate: string; horizonTo: string }];
      return { input: { ...slowShortage, planningDate, from, to, horizonTo: opts.horizonTo }, flags: [], stageBlocks: [] };
    });
    jest.spyOn(service as any, 'loadSiloFacts').mockResolvedValue([{ ...siloFact, systemBalanceKg: 950 }]);
    jest.spyOn(service as any, 'loadLatestRequisitionStatuses').mockResolvedValue(new Map());

    const out = await cls.run(() => service.siloStatus({ farmId: 'farm-b' }, 'tenant-1', 'TENANT_ADMIN'));

    expect(out.rows[0]).toMatchObject({
      firstShortageDate: '2026-10-02', // day 10, outside the dashboard's own window
      daysRemaining: 9.5,
      projectedNeedKg: 700, // 7 days x 100 kg, unchanged by the longer horizon
      projectedShortfallKg: 0,
      recommendedOrderKg: 0,
    });
    // The grid's own horizon: the planning date plus MAX_SPAN_DAYS (Q12).
    expect(compute).toHaveBeenCalledWith('farm-b', 'co-1', 'tenant-1',
      { planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', horizonTo: '2026-11-07' }, expect.anything());
  });

  it('refuses a malformed planning date', async () => {
    const { cls, service } = build();
    await expect(cls.run(() => service.siloStatus({ planningDate: '2026-02-31' }, 'tenant-1', 'TENANT_ADMIN'))).rejects.toThrow(/calendar date/);
  });
});

/** Fix round 1: what loadSiloFacts and loadOpenRequisitionStatuses read, with a query double that answers in order and keeps each where(). */
describe('FeedForecastService silo facts and requisition status (fix round 1)', () => {
  // Real drizzle builders (no connection) so the FULL statement is compiled; only execution is answered from a queue.
  const proto: any = Object.getPrototypeOf(drizzle.mock({ schema, mode: 'default' } as any).select().from(schema.locationMaster));
  const originalThen = proto.then;
  afterEach(() => { proto.then = originalThen; });
  function fakeDb(answers: unknown[][]) {
    const real = drizzle.mock({ schema, mode: 'default' } as any);
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const queue = [...answers];
    proto.then = function (this: any, resolve: any, reject: any) {
      statements.push(this.toSQL());
      return Promise.resolve(queue.shift() ?? []).then(resolve, reject);
    };
    return { db: real, statements };
  }
  const planningSilo = (over: object) => ({
    locationId: 's1', code: 'SILO-1', name: 'Silo 1', linkedSheds: [{ locationId: 'h', code: 'SHED-1', name: 'H' }], feedType: 'BULK',
    feedItemCode: null, feedItemName: null, capacityKg: 12000, lowLevelKg: 1000, highLevelKg: 10800, status: 'ACTIVE', ...over,
  });
  const make = (db: any, balances: any[] = []) => {
    const cls = transactionCls(db);
    const service = new FeedForecastService(cls, { getStockBalance: jest.fn(async () => balances) } as any, { log: jest.fn() } as any, {} as any, FEED_SETTINGS_STUB);
    return { cls, service };
  };

  it('lists ACTIVE silos only; an INACTIVE silo is not returned (finding 1)', async () => {
    const { db } = fakeDb([[], [{ warehouse_id: 's1', item_id: 'r1', item_description: 'R1', posting_date: '2026-09-20' }]]);
    const { cls, service } = make(db, [{ item_id: 'r1', uom: 'KG', on_hand_qty: '1500' }]);
    jest.spyOn(service as any, 'siloPlanningRows').mockResolvedValue(new Map([['farm-b', [planningSilo({}), planningSilo({ locationId: 's2', code: 'SILO-2', status: 'INACTIVE' })]]]));
    const facts = await cls.run(() => (service as any).loadSiloFacts('farm-b', 'co-1', 'tenant-1'));
    expect(facts.map((f: any) => f.siloId)).toEqual(['s1']);
    expect(facts[0]).not.toHaveProperty('blocked');
  });

  it('reads only genuine receipts for Feed in Silo / Last Feed Receipt, never variances or reversals (finding 3)', async () => {
    const { db, statements } = fakeDb([[], []]);
    const { cls, service } = make(db);
    jest.spyOn(service as any, 'siloPlanningRows').mockResolvedValue(new Map([['farm-b', [planningSilo({})]]]));
    await cls.run(() => (service as any).loadSiloFacts('farm-b', 'co-1', 'tenant-1'));
    const receipt = statements.find((st) => /inventory_ledger/.test(st.sql) && /limit/i.test(st.sql))!;
    expect(receipt.params).toEqual(expect.arrayContaining(['PURCHASE', 'TRANSFER_RECEIPT']));
    expect(receipt.params).not.toContain('VARIANCE_POSITIVE');
    // The reversal sub-select must have a real source: FROM <table> AS <alias>, or MySQL answers ER_NO_SUCH_TABLE.
    expect(receipt.sql).toMatch(/not exists \(select 1 from `inventory_ledger` as `?feed_receipt_reversal`?/i);
  });

  it('sums KG rows only and flags a silo that also holds bags (finding 4)', async () => {
    const { db } = fakeDb([[], [{ warehouse_id: 's1', item_id: 'r1', item_description: 'R1', posting_date: '2026-09-20' }]]);
    const { cls, service } = make(db, [{ item_id: 'r1', uom: 'KG', on_hand_qty: '1500' }, { item_id: 'r1', uom: 'BAG', on_hand_qty: '40' }]);
    jest.spyOn(service as any, 'siloPlanningRows').mockResolvedValue(new Map([['farm-b', [planningSilo({})]]]));
    const [fact] = await cls.run(() => (service as any).loadSiloFacts('farm-b', 'co-1', 'tenant-1'));
    expect(fact.systemBalanceKg).toBe(1500);
    expect(fact.nonKgBalance).toBe(true);
  });

  it('picks the latest created requisition per silo, whatever order rows come back in (finding 5)', async () => {
    const { db } = fakeDb([[
      { destination: 's1', status: 'APPROVED', created_at: '2026-09-24 10:00:00' },
      { destination: 's1', status: 'DRAFT', created_at: '2026-09-23 10:00:00' },
    ]]);
    const { cls, service } = make(db);
    const map = await cls.run(() => (service as any).loadLatestRequisitionStatuses('farm-b', 'tenant-1', '2026-09-25'));
    expect(map.get('s1')).toBe('APPROVED');
  });
});

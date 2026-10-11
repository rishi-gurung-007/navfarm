import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FeedForecastService } from './feed-forecast.service';

const FEED_SETTINGS_STUB = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } as any;

/**
 * Task 8 (3 Oct ruling): the per-farm logistics values moved off location_master
 * onto the farm's override row in feed_planning_setting. This list reads them
 * from there (null = the farm inherits the company value) and no longer has a
 * write path of its own: PUT /feed-settings/farm (FeedSettingsService.saveFarm)
 * is the only one.
 */
describe('FeedForecastService.listFarmSettings (D32)', () => {
  const dialect = new MySqlDialect();
  // Every where is kept: [0] the farms.
  const wheres: unknown[] = [];
  const rows = [{
    farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery',
  }];
  const overrideRows = [{ farm_id: 'f-vil', safety_stock_kg: null, bag_size_kg: null, bulk_multiple_kg: '6000.00', truck_target_kg: '28000.00', production_weekday: 3 }];
  // The answers are queued: the farms first, then the override rows.
  const answers: unknown[][] = [];
  const chain: any = { from: () => chain, leftJoin: () => chain, where: (w: unknown) => { wheres.push(w); return chain; },
    orderBy: async () => answers.shift() ?? [],
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answers.shift() ?? []).then(res, rej) };
  const db = { select: jest.fn(() => chain) };

  beforeEach(() => { wheres.length = 0; answers.length = 0; db.select.mockClear(); });

  it('answers the farms the caller may open, in code order, with the farm override values and null where it inherits', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    answers.push(rows, overrideRows); // the farms, then the override rows
    const list = await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{
      farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery',
      settings: { safetyStockKg: null, bagSizeKg: null, bulkMultipleKg: 6000, truckTargetKg: 28000, productionWeekday: 3 },
    }]);
    const q = dialect.sqlToQuery(wheres[0] as any);
    expect(q.sql).toContain('`location_master`.`location_type` = ?');
    expect(q.sql).toContain('`location_master`.`parent_location_id` is null');
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'FARM']));
  });

  it('answers a farm login only its own farm, and nothing at all without one', async () => {
    const bound = transactionCls(db);
    useFarmScope(bound, { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    answers.push(rows, []);
    expect(await new FeedForecastService(bound, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'STANDARD_USER')).toHaveLength(1);
    expect(dialect.sqlToQuery(wheres[0] as any).params).toEqual(expect.arrayContaining(['f-vil']));

    const loose = transactionCls(db);
    useFarmScope(loose, { farmId: null, restricted: true, companyId: null, lobId: null });
    expect(await new FeedForecastService(loose, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'STANDARD_USER')).toEqual([]);
  });

  it('limits the Company Settings list to the company being edited', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    answers.push(rows, overrideRows);

    await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB)
      .listFarmSettings('tenant-1', 'TENANT_ADMIN', 'co-1');

    const q = dialect.sqlToQuery(wheres[0] as any);
    expect(q.sql).toContain('`location_master`.`company_id` = ?');
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1', 'FARM']));
  });
});

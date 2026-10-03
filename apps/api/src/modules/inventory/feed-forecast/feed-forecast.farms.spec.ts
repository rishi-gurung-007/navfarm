import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FeedForecastService } from './feed-forecast.service';

const FEED_SETTINGS_STUB = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } as any;

/**
 * Review A2 (27 Sep): a tenant admin in the tenant-wide workspace got an empty
 * farm picker on every feed screen — GET /location?locationType=FARM answers []
 * with no company — although resolveFarm already lets that admin open any
 * farm of the tenant. The list now comes from the same scope rules.
 */
describe('FeedForecastService.listFarms (A2)', () => {
  const dialect = new MySqlDialect();
  let where: unknown;
  const rows = [
    { farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery' },
  ];
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (w: unknown) => { where = w; return chain; },
    orderBy: async () => rows,
  };
  const db = { select: jest.fn(() => chain) };
  const rendered = () => dialect.sqlToQuery(where as any);

  beforeEach(() => { where = undefined; db.select.mockClear(); });

  it('tenant admin with no company sees every company\'s farms, labelled with the company', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    const list = await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarms('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{ farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery' }]);
    const q = rendered();
    expect(q.sql).toContain('`location_master`.`location_type` = ?');
    expect(q.sql).toContain('`location_master`.`parent_location_id` is null');
    expect(q.sql).not.toContain('`location_master`.`company_id` = ?');
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'FARM']));
  });

  it('a company admin sees the company\'s farms only', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'f-other', restricted: false, companyId: 'co-1', lobId: null });
    await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarms('tenant-1', 'COMPANY_ADMIN');
    const q = rendered();
    expect(q.sql).toContain('`location_master`.`company_id` = ?');
    expect(q.params).toContain('co-1');
    // A pinned farm does not narrow an admin's list: resolveFarm lets them open any farm of the company.
    expect(q.params).not.toContain('f-other');
  });

  it('an operational admin sees the farms of their LOB only', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarms('tenant-1', 'OPERATIONAL_ADMIN');
    expect(rendered().sql).toContain('`location_master`.`lob_id` = ?');
    expect(rendered().params).toContain('lob-pig');
  });

  it('a farm user sees only their pinned farm', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarms('tenant-1', 'STANDARD_USER');
    expect(rendered().sql).toContain('`location_master`.`location_id` = ?');
    expect(rendered().params).toContain('f-vil');
  });

  it('answers an empty list, without querying, where resolveFarm would refuse every farm', async () => {
    for (const [scope, type] of [
      [{ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' }, 'STANDARD_USER'],
      [{ farmId: null, restricted: false, companyId: null, lobId: null }, 'COMPANY_ADMIN'],
      [{ farmId: null, restricted: false, companyId: null, lobId: null }, undefined],
    ] as const) {
      const cls = transactionCls(db);
      useFarmScope(cls, scope);
      await expect(new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarms('tenant-1', type)).resolves.toEqual([]);
    }
    expect(db.select).not.toHaveBeenCalled();
  });
});

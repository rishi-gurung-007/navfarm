import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { FeedForecastService } from './feed-forecast.service';

/**
 * D32 (Rishi, 28 Sep). The six per-farm feed settings leave the Location form
 * and are edited on Settings → Inventory Setup → Feed Planning. They stay
 * where they are stored — columns on the FARM's location_master row, no
 * migration — so this endpoint writes exactly those six and nothing else, and
 * it fails closed the way the rest of the module does: resolveFarm decides
 * whose farm the caller may touch. It is deliberately NOT the generic
 * PUT /location, which demands Max Capacity and the rest of a farm's form.
 */
// D38 narrowed these to five: the refill buffer is the silo's own reorder days.
const FIVE = [
  'feed_lead_time_days',
  'feed_bulk_multiple_kg',
  'feed_bag_size_kg',
  'feed_truck_target_kg',
  'feed_production_weekday',
] as const;

describe('FeedForecastService.listFarmSettings (D32)', () => {
  const dialect = new MySqlDialect();
  let where: unknown;
  const rows = [{
    farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery',
    feed_lead_time_days: null, feed_bulk_multiple_kg: 3000,
    feed_bag_size_kg: null, feed_truck_target_kg: 30000, feed_production_weekday: 0,
  }];
  const chain: any = { from: () => chain, leftJoin: () => chain, where: (w: unknown) => { where = w; return chain; }, orderBy: async () => rows };
  const db = { select: jest.fn(() => chain) };

  beforeEach(() => { where = undefined; db.select.mockClear(); });

  it('answers the farms the caller may open, in code order, with the five values and null where unset', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    const list = await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any).listFarmSettings('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{
      farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery',
      settings: {
        feed_lead_time_days: null, feed_bulk_multiple_kg: 3000,
        feed_bag_size_kg: null, feed_truck_target_kg: 30000, feed_production_weekday: 0,
      },
    }]);
    const q = dialect.sqlToQuery(where as any);
    expect(q.sql).toContain('`location_master`.`location_type` = ?');
    expect(q.sql).toContain('`location_master`.`parent_location_id` is null');
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'FARM']));
  });

  it('answers a farm login only its own farm, and nothing at all without one', async () => {
    const bound = transactionCls(db);
    useFarmScope(bound, { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    expect(await new FeedForecastService(bound, {} as any, { log: jest.fn() } as any).listFarmSettings('tenant-1', 'STANDARD_USER')).toHaveLength(1);
    expect(dialect.sqlToQuery(where as any).params).toEqual(expect.arrayContaining(['f-vil']));

    const loose = transactionCls(db);
    useFarmScope(loose, { farmId: null, restricted: true, companyId: null, lobId: null });
    expect(await new FeedForecastService(loose, {} as any, { log: jest.fn() } as any).listFarmSettings('tenant-1', 'STANDARD_USER')).toEqual([]);
  });
});

describe('FeedForecastService.updateFarmSettings (D32)', () => {
  const dialect = new MySqlDialect();

  /** A database that records the update's SET clause and its WHERE. */
  function recording(farmRow: Record<string, unknown> | null) {
    const state: { set?: any; updateWhere?: unknown; table?: unknown; selects: number } = { selects: 0 };
    const selectChain: any = {
      from: () => selectChain, leftJoin: () => selectChain, where: () => selectChain,
      orderBy: async () => (farmRow ? [farmRow] : []),
      limit: async () => (farmRow ? [farmRow] : []),
      then: (res: any, rej: any) => Promise.resolve(farmRow ? [farmRow] : []).then(res, rej),
    };
    const db: any = {
      select: jest.fn(() => { state.selects += 1; return selectChain; }),
      update: jest.fn((table: unknown) => {
        state.table = table;
        return { set: (s: any) => ({ where: async (w: unknown) => { state.set = s; state.updateWhere = w; } }) };
      }),
    };
    return { db, state };
  }

  const FARM = { location_id: 'f-vil', company_id: 'co-1', location_code: 'VIL100', location_type: 'FARM' };
  const audit = () => ({ log: jest.fn() });

  const serviceFor = (farmRow: Record<string, unknown> | null, scope: any, auditService = audit()) => {
    const { db, state } = recording(farmRow);
    const cls = transactionCls(db);
    useFarmScope(cls, scope);
    return { service: new FeedForecastService(cls, {} as any, auditService as any), state, auditService };
  };

  const OWN = { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };
  const ADMIN = { farmId: null, restricted: false, companyId: 'co-1', lobId: null };

  it('writes only the five columns, and nothing else', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await service.updateFarmSettings('f-vil', {
      feed_lead_time_days: 1, feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: 25, feed_truck_target_kg: 28000, feed_production_weekday: 3,
    }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' } as any);
    expect(state.table).toBe(schema.locationMaster);
    expect(Object.keys(state.set).filter((k) => !['updated_by', 'updated_at'].includes(k)).sort()).toEqual([...FIVE].sort());
    expect(state.set).toMatchObject({
      feed_lead_time_days: 1, feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: 25, feed_truck_target_kg: 28000, feed_production_weekday: 3,
    });
    expect(dialect.sqlToQuery(state.updateWhere as any).params).toEqual(expect.arrayContaining(['f-vil', 'tenant-1']));
  });

  it('clears a setting sent as null, and leaves one not sent alone', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await service.updateFarmSettings('f-vil', { feed_lead_time_days: null }, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' } as any);
    expect(state.set).toMatchObject({ feed_lead_time_days: null });
    expect(Object.keys(state.set)).not.toContain('feed_bag_size_kg');
  });

  it('refuses a farm outside the caller\'s scope before writing anything', async () => {
    const { service, state } = serviceFor(null, OWN);
    await expect(service.updateFarmSettings('f-other', { feed_lead_time_days: 2 }, 'tenant-1', { userId: 'u', userType: 'STANDARD_USER' } as any))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(state.set).toBeUndefined();
  });

  it.each([
    ['feed_lead_time_days', 31],
    ['feed_lead_time_days', -1],
    ['feed_bulk_multiple_kg', 0],
    ['feed_bag_size_kg', 0],
    ['feed_truck_target_kg', 0],
    ['feed_production_weekday', 7],
    ['feed_production_weekday', -1],
  ])('refuses %s = %s, the same bounds the location form used', async (key, value) => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await expect(service.updateFarmSettings('f-vil', { [key]: value } as any, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(state.set).toBeUndefined();
  });

  it('refuses a change with none of the six in it', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await expect(service.updateFarmSettings('f-vil', {} as any, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' } as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(state.set).toBeUndefined();
  });

  it('audit-logs the change as a location_master update, old and new', async () => {
    const auditService = audit();
    const { service } = serviceFor(FARM, ADMIN, auditService);
    await service.updateFarmSettings('f-vil', { feed_bag_size_kg: 25 }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' } as any);
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', companyId: 'co-1', userId: 'u-admin',
      action: 'UPDATE', entityName: 'location_master', entityId: 'f-vil',
      newValues: expect.objectContaining({ feed_bag_size_kg: 25 }),
    }));
  });
});

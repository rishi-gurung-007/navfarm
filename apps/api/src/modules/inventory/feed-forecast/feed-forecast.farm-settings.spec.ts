import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { FeedForecastService } from './feed-forecast.service';

const FEED_SETTINGS_STUB = { resolve: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } as any;

/**
 * D32 (Rishi, 28 Sep). The six per-farm feed settings leave the Location form
 * and were originally edited on Settings → Inventory Setup. They stay
 * where they are stored — columns on the FARM's location_master row, no
 * migration — so this endpoint writes exactly those six and nothing else, and
 * it fails closed the way the rest of the module does: resolveFarm decides
 * whose farm the caller may touch. It is deliberately NOT the generic
 * PUT /location, which demands Max Capacity and the rest of a farm's form.
 */
// D38 narrowed these to five (the refill buffer is the silo's own reorder
// days); Task 4 (3 Oct ruling) narrowed them again to four — feed_lead_time_days
// left this screen for FeedSettingsService's safety stock (Task 2).
const FOUR = [
  'feed_bulk_multiple_kg',
  'feed_bag_size_kg',
  'feed_truck_target_kg',
  'feed_production_weekday',
] as const;

describe('FeedForecastService.listFarmSettings (D32)', () => {
  const dialect = new MySqlDialect();
  // Two reads now (D41), so every where is kept: [0] the farms, [1] the silos.
  const wheres: unknown[] = [];
  const rows = [{
    farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery',
    feed_bulk_multiple_kg: 3000,
    feed_bag_size_kg: null, feed_truck_target_kg: 30000, feed_production_weekday: 0,
  }];
  // D41 added a second read (the farm's silos), so the answers are queued:
  // the farms first, then the silos.
  const answers: unknown[][] = [];
  const chain: any = { from: () => chain, leftJoin: () => chain, where: (w: unknown) => { wheres.push(w); return chain; },
    orderBy: async () => answers.shift() ?? [] };
  const db = { select: jest.fn(() => chain) };

  beforeEach(() => { wheres.length = 0; answers.length = 0; db.select.mockClear(); });

  it('answers the farms the caller may open, in code order, with the four values and null where unset', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    answers.push(rows, []); // the farms, then no silos
    const list = await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{
      farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery',
      silos: [],
      settings: {
        feed_bulk_multiple_kg: 3000,
        feed_bag_size_kg: null, feed_truck_target_kg: 30000, feed_production_weekday: 0,
      },
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
    return { service: new FeedForecastService(cls, {} as any, auditService as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB), state, auditService };
  };

  const OWN = { farmId: 'f-vil', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };
  const ADMIN = { farmId: null, restricted: false, companyId: 'co-1', lobId: null };

  it('writes only the four columns, and nothing else', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await service.updateFarmSettings('f-vil', {
      feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: 25, feed_truck_target_kg: 28000, feed_production_weekday: 3,
    }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' } as any);
    expect(state.table).toBe(schema.locationMaster);
    expect(Object.keys(state.set).filter((k) => !['updated_by', 'updated_at'].includes(k)).sort()).toEqual([...FOUR].sort());
    expect(state.set).toMatchObject({
      feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: 25, feed_truck_target_kg: 28000, feed_production_weekday: 3,
    });
    expect(dialect.sqlToQuery(state.updateWhere as any).params).toEqual(expect.arrayContaining(['f-vil', 'tenant-1']));
  });

  // Task 4: feed_lead_time_days is no longer a recognized key at all — a
  // caller sending only that key now gets "no setting sent", not a clear.
  it('clears a setting sent as null, and leaves one not sent alone', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await service.updateFarmSettings('f-vil', { feed_bag_size_kg: null }, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' } as any);
    expect(state.set).toMatchObject({ feed_bag_size_kg: null });
    expect(Object.keys(state.set)).not.toContain('feed_bulk_multiple_kg');
  });

  it('refuses a farm outside the caller\'s scope before writing anything', async () => {
    const { service, state } = serviceFor(null, OWN);
    await expect(service.updateFarmSettings('f-other', { feed_bulk_multiple_kg: 2000 }, 'tenant-1', { userId: 'u', userType: 'STANDARD_USER' } as any))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(state.set).toBeUndefined();
  });

  it('a feed_lead_time_days sent alone is simply not a recognized setting (Task 4: moved to FeedSettingsService)', async () => {
    const { service, state } = serviceFor(FARM, ADMIN);
    await expect(service.updateFarmSettings('f-vil', { feed_lead_time_days: 1 } as any, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' } as any))
      .rejects.toThrow('Send at least one feed setting to change.');
    expect(state.set).toBeUndefined();
  });

  it.each([
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

  it('refuses a change with none of the four in it', async () => {
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

/**
 * D41 (Rishi, 29 Sep): Silo Feed Setup lists each farm's silos, and only the
 * levels and reorder days are editable there.
 */
describe('FeedForecastService silos on Silo Feed Setup (D41)', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self,
      limit: async () => rows, then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    update: jest.fn(() => ({ set: (s: any) => ({ where: async () => { db.__set = s; } }) })),
  };
  const forecast = { currentItems: jest.fn() };
  const audit = { log: jest.fn() };

  const FARM = { farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'T',
    feed_bulk_multiple_kg: null, feed_bag_size_kg: null, feed_truck_target_kg: null, feed_production_weekday: null };
  const SILO = { location_id: 's-1', farm_id: 'f-vil', company_id: 'co-1', location_code: 'VIL100/SILO-001', location_name: 'Feed Silo 1',
    feed_in_bags: false, silo_capacity_kg: '10000', low_level_kg: '2000', high_level_kg: '9000', status: 'ACTIVE' };
  const SHED_LINKS = [
    { silo_id: 's-1', shed_id: 'sh-1', shed_code: 'VIL100/SHED-001', shed_name: 'Dry Sow House' },
    { silo_id: 's-1', shed_id: 'sh-2', shed_code: 'VIL100/SHED-002', shed_name: 'Farrowing House' },
  ];

  beforeEach(() => { selectQueue.length = 0; jest.clearAllMocks(); });

  const service = (cls: any, siloFeed: any = forecast) => new FeedForecastService(cls, {} as any, audit as any, siloFeed as any, FEED_SETTINGS_STUB);

  it('returns the complete read-only Silo Feed Setup identity, allocation, handling, feed and status fields', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });
    selectQueue.push([FARM], [SILO], SHED_LINKS);
    forecast.currentItems.mockResolvedValueOnce(new Map([['s-1', { item_id: 'i1', item_code: 'ICAT-004-ITM-0002', item_description: 'Dry Sow Mash', on_hand_qty: 4200 }]]));

    const list = await service(cls).listFarmSettings('tenant-1', 'COMPANY_ADMIN');

    expect(list[0].silos).toEqual([{
      locationId: 's-1',
      code: 'VIL100/SILO-001',
      name: 'Feed Silo 1',
      linkedSheds: [
        { locationId: 'sh-1', code: 'VIL100/SHED-001', name: 'Dry Sow House' },
        { locationId: 'sh-2', code: 'VIL100/SHED-002', name: 'Farrowing House' },
      ],
      feedType: 'BULK',
      feedItemCode: 'ICAT-004-ITM-0002',
      feedItemName: 'Dry Sow Mash',
      capacityKg: 10000,
      lowLevelKg: 2000,
      highLevelKg: 9000,
      status: 'ACTIVE',
    }]);
  });

  it('says a silo holds nothing rather than guessing, and asks the ledger nothing when a farm has no silo', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });
    selectQueue.push([FARM], []);
    const list = await service(cls).listFarmSettings('tenant-1', 'COMPANY_ADMIN');
    expect(list[0].silos).toEqual([]);
    expect(forecast.currentItems).not.toHaveBeenCalled();
  });
});

describe('FeedForecastService.updateSiloSettings (D41)', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const state: { set?: any } = {};
  const selectQueue: unknown[][] = [];
  const db: any = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    update: jest.fn(() => ({ set: (s: any) => ({ where: async () => { state.set = s; } }) })),
  };
  const audit = { log: jest.fn() };
  const SILO_ROW = { location_id: 's-1', company_id: 'co-1', farm_id: 'f-vil', location_type: 'SILO',
    location_code: 'VIL100/SILO-001', silo_capacity_kg: '10000', low_level_kg: '2000', high_level_kg: '9000' };

  const service = (scope: any) => {
    const cls = transactionCls(db);
    useFarmScope(cls, scope);
    return new FeedForecastService(cls, {} as any, audit as any, { currentItems: jest.fn() } as any, FEED_SETTINGS_STUB);
  };
  const ADMIN = { farmId: null, restricted: false, companyId: 'co-1', lobId: null };
  const USER = { userId: 'u-1', userType: 'COMPANY_ADMIN' } as any;

  beforeEach(() => { selectQueue.length = 0; state.set = undefined; jest.clearAllMocks(); });

  // Task 4 (3 Oct ruling): this endpoint no longer writes silo_reorder_days —
  // the forecast does not read it; Location Master's own generic form still
  // edits the column (spec R6).
  it('writes only the levels', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 2500, high_level_kg: 8000 }, 'tenant-1', USER);
    expect(Object.keys(state.set).filter((k) => !['updated_by', 'updated_at'].includes(k)).sort())
      .toEqual(['high_level_kg', 'low_level_kg']);
  });

  it('a silo_reorder_days sent alone is simply not a recognized setting here', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { silo_reorder_days: 1 } as any, 'tenant-1', USER))
      .rejects.toThrow('Send at least one silo setting to change.');
    expect(state.set).toBeUndefined();
  });

  it('applies the silo form\'s own rules — a low at or above the high is refused, and nothing is written', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 9000, high_level_kg: 9000 }, 'tenant-1', USER))
      .rejects.toThrow('The low feed level must be below the high feed level.');
    expect(state.set).toBeUndefined();
  });

  it('judges a single changed level against the one already stored', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    // 9500 alone, against the stored high of 9000
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 9500 }, 'tenant-1', USER))
      .rejects.toThrow('The low feed level must be below the high feed level.');
    expect(state.set).toBeUndefined();
  });

  it('refuses a level above the silo\'s capacity', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { high_level_kg: 12000 }, 'tenant-1', USER))
      .rejects.toThrow('The high feed level cannot exceed the silo capacity.');
  });

  it('refuses a silo that is not on the farm named in the path', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [{ ...SILO_ROW, farm_id: 'f-other' }]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 2000 }, 'tenant-1', USER))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(state.set).toBeUndefined();
  });

  it('refuses a location that is not a silo', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [{ ...SILO_ROW, location_type: 'SHED' }]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 2000 }, 'tenant-1', USER))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a change with nothing in it', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', {}, 'tenant-1', USER))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('audit-logs it as a location_master update', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await service(ADMIN).updateSiloSettings('f-vil', 's-1', { low_level_kg: 2500 }, 'tenant-1', USER);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', companyId: 'co-1', userId: 'u-1',
      action: 'UPDATE', entityName: 'location_master', entityId: 's-1',
      newValues: expect.objectContaining({ low_level_kg: 2500 }),
    }));
  });
});

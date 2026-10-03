import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
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
  // Two reads now (D41), so every where is kept: [0] the farms, [1] the silos.
  const wheres: unknown[] = [];
  const rows = [{
    farm_id: 'f-vil', code: 'VIL100', name: 'Villa Franca', company_id: 'co-1', company_name: 'Colcom Piggery',
  }];
  const overrideRows = [{ farm_id: 'f-vil', safety_stock_kg: null, bag_size_kg: null, bulk_multiple_kg: '6000.00', truck_target_kg: '28000.00', production_weekday: 3 }];
  // D41 added a second read (the farm's silos), so the answers are queued:
  // the farms first, then the silos.
  const answers: unknown[][] = [];
  const chain: any = { from: () => chain, leftJoin: () => chain, where: (w: unknown) => { wheres.push(w); return chain; },
    orderBy: async () => answers.shift() ?? [],
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(answers.shift() ?? []).then(res, rej) };
  const db = { select: jest.fn(() => chain) };

  beforeEach(() => { wheres.length = 0; answers.length = 0; db.select.mockClear(); });

  it('answers the farms the caller may open, in code order, with the farm override values and null where it inherits', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    answers.push(rows, [], overrideRows); // the farms, no silos, then the override rows
    const list = await new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'TENANT_ADMIN');
    expect(list).toEqual([{
      farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom Piggery',
      silos: [],
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
    answers.push(rows, [], []);
    expect(await new FeedForecastService(bound, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'STANDARD_USER')).toHaveLength(1);
    expect(dialect.sqlToQuery(wheres[0] as any).params).toEqual(expect.arrayContaining(['f-vil']));

    const loose = transactionCls(db);
    useFarmScope(loose, { farmId: null, restricted: true, companyId: null, lobId: null });
    expect(await new FeedForecastService(loose, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB).listFarmSettings('tenant-1', 'STANDARD_USER')).toEqual([]);
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
  };
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

  // Requisition / Loading Sheet row 15: Feed Type is BULK or BAGGED and drives
  // rounding and truck type. Stored as location_master.feed_in_bags.
  it('feedType BAGGED writes feed_in_bags true, BULK writes false', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await service(ADMIN).updateSiloSettings('f-vil', 's-1', { feedType: 'BAGGED' }, 'tenant-1', USER);
    expect(state.set).toMatchObject({ feed_in_bags: true });
    expect(state.set).not.toHaveProperty('low_level_kg');
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await service(ADMIN).updateSiloSettings('f-vil', 's-1', { feedType: 'BULK', low_level_kg: 2500 }, 'tenant-1', USER);
    expect(state.set).toMatchObject({ feed_in_bags: false, low_level_kg: 2500 });
  });

  it('refuses a feedType other than BULK or BAGGED and writes nothing', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [SILO_ROW]);
    await expect(service(ADMIN).updateSiloSettings('f-vil', 's-1', { feedType: 'LOOSE' } as any, 'tenant-1', USER))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(state.set).toBeUndefined();
  });

  it('a feedType change is audit-logged with the old value', async () => {
    selectQueue.push([{ location_id: 'f-vil' }], [{ ...SILO_ROW, feed_in_bags: false }]);
    await service(ADMIN).updateSiloSettings('f-vil', 's-1', { feedType: 'BAGGED' }, 'tenant-1', USER);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      oldValues: expect.objectContaining({ feedType: 'BULK' }),
      newValues: expect.objectContaining({ feedType: 'BAGGED' }),
    }));
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

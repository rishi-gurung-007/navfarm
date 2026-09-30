import { BadRequestException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { serverToday } from './feed-requisition.rules';
import { FeedRequisitionService } from './feed-requisition.service';

/**
 * F3 (final review I3). The New requisition dialog read GET /location and
 * GET /item, which are Master Data routes under the master scope: in the
 * tenant-wide workspace they answer with templates or nothing, and a farm
 * login has no grant for them at all — while the same screen happily lists
 * the farm. The options now come from this module, under the same farm rules
 * as the rest of it. And createManual, which only ever checked the tenant,
 * refuses an item that belongs to another company, is not a feed item, or is
 * inactive.
 */
describe('FeedRequisitionService.options (F3)', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
  };
  const service = new FeedRequisitionService(transactionCls(db), forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any, {} as any, {} as any);

  beforeEach(() => {
    selectQueue.length = 0;
    jest.clearAllMocks();
  });

  it('resolves the farm the same way the rest of the module does, and returns its silos, stores and the company feed items', async () => {
    selectQueue.push(
      [
        { location_id: 'store-1', location_code: 'GRS/STORE-001', location_type: 'STORE' },
        { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO' },
      ],
      [{ item_id: 'feed-1', item_code: 'ICAT-004-ITM-0001', item_name: 'Weaner Mash', uom_primary: 'KG' }],
    );
    const out = await service.options('farm-grs', 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' } as any);
    expect(forecast.resolveFarm).toHaveBeenCalledWith('farm-grs', 'tenant-1', 'TENANT_ADMIN');
    expect(out.farmId).toBe('farm-grs');
    expect(out.destinations.map((d: any) => d.location_code)).toEqual(['GRS/SILO-001', 'GRS/STORE-001']);
    expect(out.items).toEqual([{ item_id: 'feed-1', item_code: 'ICAT-004-ITM-0001', item_name: 'Weaner Mash', uom_primary: 'KG' }]);
  });
});

describe('FeedRequisitionService.createManual — the item must be the farm company\'s active feed item (F3)', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
  };
  const service = new FeedRequisitionService(transactionCls(db), forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any, {} as any, {} as any);
  const silo = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null };
  const line = { destination_location_id: 'silo-1', item_id: 'item-x', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' };

  beforeEach(() => {
    selectQueue.length = 0;
    jest.clearAllMocks();
  });

  /** The item read answers with nothing whenever the row fails any of the three rules. */
  const refuses = async () => {
    selectQueue.push(
      [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }],
      [silo],
      [],
    );
    await expect(service.createManual({ lines: [line] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Feed item item-x is not an active feed item of this company.'));
    expect(db.insert).not.toHaveBeenCalled();
  };

  it('refuses an item of another company', refuses);
  it('refuses an item that is not a feed item', refuses);
  it('refuses an inactive or deleted item', refuses);

  it('bounds the item read by company, type and state, not by tenant alone', async () => {
    selectQueue.push(
      [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }],
      [silo],
      [{ item_id: 'item-x', item_name: 'Weaner Mash' }],
    );
    // It gets past the item check and on to the numbering/transaction work.
    await expect(service.createManual({ lines: [line] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.not.toThrow(new BadRequestException('Feed item item-x is not an active feed item of this company.'));
  });
});

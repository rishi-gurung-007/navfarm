import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedForecastService } from './feed-forecast.service';

describe('FeedForecastService feed plan', () => {
  it('returns no invented plan before the farm has a current saved calculation', async () => {
    const db: any = { select: jest.fn() };
    const runService = { findCurrent: jest.fn(async () => null) };
    const service = new FeedForecastService(
      transactionCls(db), {} as any, {} as any, {} as any, {} as any, runService as any,
    );
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });

    await expect(service.feedPlan('farm-1', 'tenant-1', 'TENANT_ADMIN')).resolves.toEqual({ run: null, rows: [] });
    expect(service.resolveFarm).toHaveBeenCalledWith('farm-1', 'tenant-1', 'TENANT_ADMIN');
    expect(runService.findCurrent).toHaveBeenCalledWith('farm-1', 'company-1', 'tenant-1');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('does not present destination silo capacity as the workbook mill-capacity field', async () => {
    const answers = [
      [{ code: 'GRA100', name: 'Grasmere' }],
      [{
        destination_id: 'silo-1', forecast_date: '2026-10-12', shortage_date: '2026-10-12',
        item_id: 'item-1', item_code: 'FEED-001', item_name: 'Grower Feed',
        recommended_qty_kg: '6000', capacity_kg: '10000',
      }],
      [],
    ];
    const db: any = {
      select: jest.fn(() => {
        const rows = answers.shift() ?? [];
        const chain: any = {
          from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      }),
    };
    const runService = { findCurrent: jest.fn(async () => ({
      run_id: 'run-1', run_code: 'RUN-GRA100-1', from_date: '2026-10-08', to_date: '2026-10-15',
    })) };
    const service = new FeedForecastService(
      transactionCls(db), {} as any, {} as any, {} as any, {} as any, runService as any,
    );
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });

    const result = await service.feedPlan('farm-1', 'tenant-1', 'TENANT_ADMIN');

    expect(result.rows).toEqual([expect.objectContaining({ capacityKg: null })]);
  });

  it('fills Mill Capacity Available and Plan vs Mill Capacity for the production date (Engine r42–r43)', async () => {
    const answers = [
      [{ code: 'GRA100', name: 'Grasmere' }],
      [{
        destination_id: 'silo-1', forecast_date: '2026-10-12', shortage_date: '2026-10-12',
        item_id: 'item-1', item_code: 'FEED-001', item_name: 'Grower Feed', recommended_qty_kg: '6000',
      }],
      [],
    ];
    const db: any = {
      select: jest.fn(() => {
        const rows = answers.shift() ?? [];
        const chain: any = {
          from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      }),
    };
    const runService = { findCurrent: jest.fn(async () => ({ run_id: 'run-1', run_code: 'RUN-1', from_date: '2026-10-08', to_date: '2026-10-15' })) };
    const capacity = { itemId: 'item-1', state: 'AVAILABLE', demandKg: 21_000, availableKg: 20_000, status: 'RED', priority: 1, millId: 'mill-1', millCode: 'MILL-001', binId: 'bin-1', binCode: 'BIN01', feedForm: 'BULK' };
    const millCapacity = {
      approvedDemand: jest.fn(async () => ({ lines: [{ productionDate: '2026-10-11', farmId: 'farm-2', itemId: 'item-1', requestedKg: 15_000, millApprovedKg: null }], diets: new Map() })),
      allocateOn: jest.fn(async () => new Map([['item-1', capacity]])),
    };
    const service = new FeedForecastService(
      transactionCls(db), {} as any, {} as any, {} as any, {} as any, runService as any, undefined, millCapacity as any,
    );
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });

    const result = await service.feedPlan('farm-1', 'tenant-1', 'TENANT_ADMIN', undefined, undefined, '2026-10-11');

    // Other farms' approved 15,000 KG plus this farm's unapproved tentative 6,000 KG.
    expect(millCapacity.allocateOn).toHaveBeenCalledWith('tenant-1', ['company-1'], '2026-10-11', [
      { itemId: 'item-1', demandKg: 15_000 }, { itemId: 'item-1', demandKg: 6_000 },
    ]);
    expect(result.rows).toEqual([expect.objectContaining({ capacityKg: 20_000, capacity })]);
  });

  it('keeps Mill Capacity unavailable, never 0, when no production date is chosen', async () => {
    const answers = [[{ code: 'GRA100', name: 'Grasmere' }], [{
      destination_id: 'silo-1', forecast_date: '2026-10-12', shortage_date: null,
      item_id: 'item-1', item_code: 'FEED-001', item_name: 'Grower Feed', recommended_qty_kg: '6000',
    }], []];
    const db: any = { select: jest.fn(() => {
      const rows = answers.shift() ?? [];
      const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => rows,
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
      return chain;
    }) };
    const millCapacity = { approvedDemand: jest.fn(), allocateOn: jest.fn() };
    const service = new FeedForecastService(transactionCls(db), {} as any, {} as any, {} as any, {} as any,
      { findCurrent: jest.fn(async () => ({ run_id: 'run-1', run_code: 'RUN-1', from_date: '2026-10-08', to_date: '2026-10-15' })) } as any, undefined, millCapacity as any);
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });
    const result = await service.feedPlan('farm-1', 'tenant-1', 'TENANT_ADMIN');
    expect(result.rows).toEqual([expect.objectContaining({ capacityKg: null, capacity: null })]);
    expect(millCapacity.allocateOn).not.toHaveBeenCalled();
  });
});

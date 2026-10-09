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
});

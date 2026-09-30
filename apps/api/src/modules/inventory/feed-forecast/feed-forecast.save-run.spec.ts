import { FeedForecastService } from './feed-forecast.service';
import { transactionCls } from '../../../test-utils/transaction-cls';

describe('FeedForecastService.saveRun', () => {
  it('saves the exact normalized filters/output and actor through the explicit action', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-01T06:30:00.000Z'));
    const runService = { createRun: jest.fn(async () => ({ runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 })) };
    const service = new FeedForecastService(transactionCls({}), {} as any, {} as any, {} as any, runService as any);
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });
    jest.spyOn(service, 'getForecast').mockResolvedValue({
      planningDate: '2026-10-01', view: 'WEEKLY', from: '2026-10-01', to: '2026-10-07',
      period: null, farm: { id: 'farm-1', code: 'F1', name: 'Farm 1' }, daily: [], rows: [], stages: [], flags: [], sources: [], dietChanges: [],
      today: '2026-10-01', timeZone: 'Africa/Harare', forecastFrom: '2026-10-01', forecastNote: null, horizonTo: '2026-11-15', leadTimeDays: 2,
    } as any);

    const query = { farmId: 'farm-1', planningDate: '2026-10-01', view: 'WEEKLY' as const, from: '2026-10-01' };
    await expect(service.saveRun(query, 'tenant-1', { userId: 'user-1', userType: 'FARM_MANAGER' }))
      .resolves.toEqual({ runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 });

    expect(runService.createRun).toHaveBeenCalledWith({
      tenantId: 'tenant-1', companyId: 'company-1', farmId: 'farm-1', planningDate: '2026-10-01',
      view: 'WEEKLY', from: '2026-10-01', to: '2026-10-07', periodId: null,
      sourceCutoffAt: '2026-10-01 06:30:00',
    }, expect.objectContaining({ farm: { id: 'farm-1', code: 'F1', name: 'Farm 1' } }), { userId: 'user-1', userType: 'FARM_MANAGER' });
    jest.useRealTimers();
  });
});

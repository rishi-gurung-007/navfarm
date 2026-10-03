import { draftForecastRange, FeedForecastService } from './feed-forecast.service';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { UnauthorizedException } from '@nestjs/common';

describe('FeedForecastService.saveRun', () => {
  it('saves the exact normalized filters/output and actor through the explicit action', async () => {
    const db: any = {
      execute: jest.fn(async () => [[{ source_cutoff_at: '2026-10-01 06:31:07' }], []]),
    };
    const runService = { createRun: jest.fn(async () => ({ runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 })) };
    const service = new FeedForecastService(transactionCls(db), {} as any, {} as any, {} as any, { resolve: jest.fn() } as any, runService as any);
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });
    jest.spyOn(service, 'getForecast').mockResolvedValue({
      planningDate: '2026-10-01', view: 'WEEKLY', from: '2026-10-01', to: '2026-10-07',
      period: null, farm: { id: 'farm-1', code: 'F1', name: 'Farm 1' }, daily: [], rows: [], stages: [], flags: [], sources: [], dietChanges: [],
      today: '2026-10-01', timeZone: 'Africa/Harare', forecastFrom: '2026-10-01', forecastNote: null, horizonTo: '2026-11-15',
      settings: { safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 },
      sourceSnapshot: { version: 'sha256:source', hash: 'source', values: { engineInput: { batches: [] } } },
    } as any);

    const query = { farmId: 'farm-1', planningDate: '2026-10-01', view: 'WEEKLY' as const, from: '2026-10-01' };
    await expect(service.saveRun(query, 'tenant-1', { userId: 'user-1', userType: 'FARM_MANAGER' }))
      .resolves.toEqual({ runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 });

    expect(runService.createRun).toHaveBeenCalledWith({
      tenantId: 'tenant-1', companyId: 'company-1', farmId: 'farm-1', planningDate: '2026-10-01',
      view: 'WEEKLY', from: '2026-10-01', to: '2026-10-07', periodId: null,
      sourceCutoffAt: '2026-10-01 06:31:07',
    }, expect.objectContaining({ farm: { id: 'farm-1', code: 'F1', name: 'Farm 1' } }), { userId: 'user-1', userType: 'FARM_MANAGER' });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('refuses a save without an authenticated creator before reading forecast sources', async () => {
    const db: any = { execute: jest.fn() };
    const runService = { createRun: jest.fn() };
    const service = new FeedForecastService(transactionCls(db), {} as any, {} as any, {} as any, { resolve: jest.fn() } as any, runService as any);

    await expect(service.saveRun({ farmId: 'farm-1' }, 'tenant-1', { userType: 'FARM_MANAGER' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.execute).not.toHaveBeenCalled();
    expect(runService.createRun).not.toHaveBeenCalled();
  });
});

/**
 * 9d D1 (Part A Pass 2): auto-draft links the run saved for its window only when
 * the draft's source hash equals the saved run's. The hash covers the whole
 * engine input, horizonTo included, so the draft's forecast must be computed
 * over the same range Save Run computes (getForecast: horizon = planning + 45).
 */
describe('draftForecastRange — the draft and the run saved for its window hash alike (9d D1)', () => {
  it('computeForFarm(draftForecastRange) and saveRun for the same window give one source hash', async () => {
    const db: any = { execute: jest.fn(async () => [[{ source_cutoff_at: '2026-10-03 06:00:00' }], []]) };
    const runService = { createRun: jest.fn(async () => ({ runId: 'run-1', runCode: 'RUN-F1-20261003-001', version: 1 })) };
    const feedSettings = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 })) };
    const service = new FeedForecastService(transactionCls(db), {} as any, {} as any, {} as any, feedSettings as any, runService as any);
    const clock = { today: '2026-10-03', timeZone: 'Africa/Harare' };
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'company-1' });
    jest.spyOn(service, 'farmToday').mockResolvedValue(clock);
    jest.spyOn(service, 'withFarmScope').mockImplementation(async (_f, _c, work) => work());
    jest.spyOn(service as any, 'loadFarm').mockResolvedValue({ id: 'farm-1', code: 'F1', name: 'Farm 1', companyId: 'company-1' });
    // As the real loadInput: the range and horizon it is handed go into the engine input.
    jest.spyOn(service as any, 'loadInput').mockImplementation(async (...args: unknown[]) => {
      const [, planningDate, from, to, , opts] = args as [unknown, string, string, string, string, { stockDate: string; horizonTo: string }];
      return {
        input: { planningDate, from, to, stockDate: opts.stockDate, horizonTo: opts.horizonTo, sheds: [], silos: [], store: null, incoming: [], items: {}, itemCodes: {}, batches: [], feedRows: [] },
        flags: [], stageBlocks: [],
      };
    });

    const draft = await service.computeForFarm('farm-1', 'company-1', 'tenant-1', draftForecastRange('2026-10-03', '2026-11-01'), clock);
    // What autoDraft hands saveRun for that draft.
    await service.saveRun(
      { farmId: 'farm-1', planningDate: draft.planningDate, view: 'CUSTOM', from: draft.from, to: draft.to },
      'tenant-1', { userId: 'user-1', userType: 'COMPANY_ADMIN' },
    );

    const saved = (runService.createRun.mock.calls[0] as unknown[])[1] as { sourceSnapshot: { hash: string }; to: string; horizonTo: string };
    expect(draft.to).toBe('2026-11-01'); // the draft's order window stays `to`
    expect(saved.to).toBe('2026-11-01');
    expect(draft.horizonTo).toBe(saved.horizonTo);
    expect(draft.sourceSnapshot?.hash).toBeTruthy();
    expect(draft.sourceSnapshot?.hash).toBe(saved.sourceSnapshot.hash);
  });
});

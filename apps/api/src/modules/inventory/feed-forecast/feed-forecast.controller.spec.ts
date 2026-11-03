import { FeedForecastController } from './feed-forecast.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

describe('FeedForecastController run persistence boundary', () => {
  const req = { user: { tenantId: 'tenant-1', userId: 'user-1', userType: 'FARM_MANAGER' } };

  it('ordinary GET remains read-only and response-compatible', async () => {
    const forecast = { rows: [], farm: { id: 'farm-1' } };
    const service = { getForecast: jest.fn(async () => forecast), saveRun: jest.fn() } as any;
    const controller = new FeedForecastController(service);

    await expect(controller.get({ farmId: 'farm-1' }, req)).resolves.toEqual({
      success: true,
      message: 'Feed forecast retrieved successfully.',
      data: forecast,
    });
    expect(service.saveRun).not.toHaveBeenCalled();
  });

  it('persists only through the explicit Save Run action', async () => {
    const service = { saveRun: jest.fn(async () => ({ runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 })) } as any;
    const controller = new FeedForecastController(service);

    await expect(controller.saveRun({ farmId: 'farm-1', view: 'CUSTOM' }, req)).resolves.toEqual({
      success: true,
      message: 'Feed forecast run saved.',
      data: { runId: 'run-1', runCode: 'FFR-farm-1-000001', version: 1 },
    });
    expect(service.saveRun).toHaveBeenCalledWith({ farmId: 'farm-1', view: 'CUSTOM' }, 'tenant-1', req.user);
  });

  it('lists and reads runs through the scoped forecast service boundary', async () => {
    const service = {
      listRuns: jest.fn(async () => [{ run_id: 'run-1', version: 1 }]),
      findRun: jest.fn(async () => ({ run_id: 'run-1', lines: [] })),
    } as any;
    const controller = new FeedForecastController(service);

    await expect(controller.runs({ farmId: 'farm-1' }, req)).resolves.toMatchObject({ data: [{ run_id: 'run-1' }] });
    await expect(controller.run('f4cf8276-17ed-4b46-95df-5234dfb2b48a', req)).resolves.toMatchObject({ data: { run_id: 'run-1' } });
    expect(service.listRuns).toHaveBeenCalledWith('farm-1', 'tenant-1', 'FARM_MANAGER');
    expect(service.findRun).toHaveBeenCalledWith('f4cf8276-17ed-4b46-95df-5234dfb2b48a', 'tenant-1');
  });

  it('reads and archives the current farm calculation through explicit routes', async () => {
    const service = {
      currentRun: jest.fn(async () => ({ run_id: 'run-1' })),
      archiveRun: jest.fn(async () => ({ run_id: 'run-1', archived_at: true })),
    } as any;
    const controller = new FeedForecastController(service);
    await expect(controller.currentRun({ farmId: 'farm-1' }, req)).resolves.toMatchObject({ data: { run_id: 'run-1' } });
    await expect(controller.archiveRun('f4cf8276-17ed-4b46-95df-5234dfb2b48a', req)).resolves.toMatchObject({ data: { archived_at: true } });
    expect(service.currentRun).toHaveBeenCalledWith('farm-1', 'tenant-1', 'FARM_MANAGER');
    expect(service.archiveRun).toHaveBeenCalledWith('f4cf8276-17ed-4b46-95df-5234dfb2b48a', 'tenant-1', req.user);
  });

  it('keeps run visibility separate from Save Run action authority', () => {
    const prototype = FeedForecastController.prototype;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.runs)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'view',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.run)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'view',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.saveRun)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'create',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.currentRun)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'view',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.archiveRun)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'create',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.deleteRunPermanently)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'delete',
    });
  });

  // Mill Planning replaced Feed Plan (spec 2026-11-03): its routes are gone.
  it('no longer serves the Feed Plan routes', () => {
    const prototype = FeedForecastController.prototype as any;
    for (const name of ['feedPlan', 'feedPlanVersions', 'feedPlanVersion', 'generateFeedPlanVersion']) expect(prototype[name]).toBeUndefined();
  });

  it('serves silo status under the forecast grant, through the scoped service', async () => {
    const query = { farmId: 'farm-1', shedId: 'shed-1', siloId: 'silo-1', planningDate: '2026-09-23', view: 'CUSTOM' as const, from: '2026-09-23', to: '2026-09-29' };
    const data = { planningDate: '2026-09-23', selection: { shedId: 'shed-1', siloId: 'silo-1' }, silo: {} };
    const service = { siloStatus: jest.fn(async () => data) } as any;
    const controller = new FeedForecastController(service);
    await expect(controller.siloStatus(query, req)).resolves.toMatchObject({ success: true, data });
    expect(service.siloStatus).toHaveBeenCalledWith(query, 'tenant-1', 'FARM_MANAGER');
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, FeedForecastController.prototype.siloStatus)).toEqual({
      moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'view',
    });
  });

  it('passes the selected Company Settings company to the scoped farm settings query', async () => {
    const service = { listFarmSettings: jest.fn(async () => []) } as any;
    const controller = new FeedForecastController(service);

    await controller.farmSettings('co-1', req);

    expect(service.listFarmSettings).toHaveBeenCalledWith('tenant-1', 'FARM_MANAGER', 'co-1');
  });
});

describe('FeedForecastController mill plan', () => {
  const req = { user: { tenantId: 'tenant-1', userId: 'user-1', userType: 'TENANT_ADMIN' } };

  it('returns the generated mill plan under INVENTORY/LEDGER view', async () => {
    const plan = { dates: [], farms: [] };
    const millPlan = { generate: jest.fn(async () => plan) } as any;
    const controller = new FeedForecastController({} as any, millPlan);

    await expect(controller.millPlan({ weekOf: '2026-11-02' }, req)).resolves.toEqual({
      success: true,
      message: 'Mill plan generated.',
      data: plan,
    });
    expect(millPlan.generate).toHaveBeenCalledWith('tenant-1', 'TENANT_ADMIN', { weekOf: '2026-11-02' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, FeedForecastController.prototype.millPlan))
      .toMatchObject({ moduleCode: 'INVENTORY', resource: 'LEDGER', action: 'view' });
  });
});

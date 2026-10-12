import { BadRequestException, ConflictException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionController } from './feed-requisition.controller';
import { FeedRequisitionService } from './feed-requisition.service';

const preview = {
  runId: 'run-1', runCode: 'RUN-GRA100-20261008-001', farmId: 'farm-1', existingRequisitionId: null,
  settings: { bulkMultipleKg: 3000, truckTargetKg: 30000 },
  lines: [{
    destination_location_id: 'silo-1', destination_code: 'GRA100/SILO-001', destination_name: 'Feed Silo 1',
    item_id: 'item-1', item_code: 'FEED-001', item_name: 'Grower Feed', recommended_qty_kg: 3000,
    quantity_kg: 3000, proposed_delivery_date: '2026-10-10', feed_type: 'BULK', run_line_ids: ['run-line-1'],
  }],
};

describe('feed requisition from a saved calculation', () => {
  const req = { user: { tenantId: 'tenant-1', userId: 'user-1', userType: 'FARM_MANAGER' } };

  it('exposes explicit preview/create routes with view/create authority', async () => {
    const service = {
      previewFromRun: jest.fn(async () => preview),
      createFromRun: jest.fn(async () => ({ requisition_id: 'req-1' })),
    } as any;
    const controller = new FeedRequisitionController(service);
    await expect(controller.previewFromRun('run-1', req)).resolves.toMatchObject({ data: preview });
    await expect(controller.createFromRun('run-1', { lines: [] }, req)).resolves.toMatchObject({ data: { requisition_id: 'req-1' } });
    expect(service.previewFromRun).toHaveBeenCalledWith('run-1', 'tenant-1', req.user);
    expect(service.createFromRun).toHaveBeenCalledWith('run-1', { lines: [] }, 'tenant-1', req.user);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, FeedRequisitionController.prototype.previewFromRun)).toMatchObject({ action: 'view' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, FeedRequisitionController.prototype.createFromRun)).toMatchObject({ action: 'create' });
  });

  it('rounds the editable request quantity with the effective settings saved on the run', async () => {
    const rows = new Map<unknown, unknown[]>([
      ['run', [{
        run_id: 'run-1', run_code: 'RUN-GRA100-20261008-001', farm_id: 'farm-1',
        planning_date: '2026-10-08', to_date: '2026-10-15',
        config_snapshot: { values: { requisitionDraftSettings: {
          bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0,
        } } },
      }]],
      ['lines', [{
        run_line_id: 'run-line-1', destination_location_id: 'silo-1', item_id: 'item-1',
        recommended_qty_kg: '3200.0000', shortage_date: '2026-10-12',
      }]],
      ['items', [{ item_id: 'item-1', item_code: 'FEED-001', item_name: 'Grower Feed' }]],
      ['destinations', [{
        location_id: 'silo-1', location_code: 'GRA100/SILO-001', location_name: 'Feed Silo 1',
        location_type: 'SILO', feed_in_bags: false,
      }]],
      ['existing', []],
    ]);
    let call = 0;
    const order = ['run', 'lines', 'items', 'destinations', 'existing'];
    const db: any = {
      select: jest.fn(() => {
        const key = order[call++];
        const chain: any = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          then: (ok: any, fail: any) => Promise.resolve(rows.get(key) ?? []).then(ok, fail),
        };
        return chain;
      }),
    };
    const forecast = {
      resolveFarm: jest.fn(async () => ({ farmId: 'farm-1', companyId: 'company-1' })),
      withFarmScope: jest.fn(async (_farmId: string, _companyId: string, work: () => Promise<unknown>) => work()),
      getForecast: jest.fn(),
    };
    const service = new FeedRequisitionService(
      transactionCls(db), forecast as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );

    const result = await service.previewFromRun('run-1', 'tenant-1', req.user);

    expect(result.lines[0]).toMatchObject({ recommended_qty_kg: 6000, quantity_kg: 6000 });
    expect(forecast.getForecast).not.toHaveBeenCalled();
  });

  it('refuses a second requisition for the same run before writing', async () => {
    const service = Object.create(FeedRequisitionService.prototype) as FeedRequisitionService;
    (service as any).savedRunDraft = jest.fn(async () => ({ ...preview, existingRequisitionId: 'req-existing' }));
    await expect(service.createFromRun('run-1', { lines: preview.lines }, 'tenant-1', req.user))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a destination or item that was not part of the saved run', async () => {
    const service = Object.create(FeedRequisitionService.prototype) as FeedRequisitionService;
    (service as any).savedRunDraft = jest.fn(async () => preview);
    await expect(service.createFromRun('run-1', { lines: [{
      destination_location_id: 'tampered-silo', item_id: 'item-1', quantity_kg: 3000, proposed_delivery_date: '2026-10-10',
    }] }, 'tenant-1', req.user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a duplicated saved line that omits another shortage line', async () => {
    const second = {
      ...preview.lines[0],
      destination_location_id: 'silo-2',
      destination_code: 'GRA100/SILO-002',
      run_line_ids: ['run-line-2'],
    };
    const service = Object.create(FeedRequisitionService.prototype) as FeedRequisitionService;
    (service as any).savedRunDraft = jest.fn(async () => ({
      ...preview,
      lines: [...preview.lines, second],
    }));

    await expect(service.createFromRun('run-1', {
      lines: [preview.lines[0], preview.lines[0]],
    }, 'tenant-1', req.user)).rejects.toBeInstanceOf(BadRequestException);
  });
});

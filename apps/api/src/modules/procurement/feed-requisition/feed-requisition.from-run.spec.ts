import { BadRequestException, ConflictException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
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
});

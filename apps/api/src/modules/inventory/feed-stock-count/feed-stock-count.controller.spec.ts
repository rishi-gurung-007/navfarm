import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { FeedStockCountController } from './feed-stock-count.controller';

describe('FeedStockCountController authorization and delegation', () => {
  const req = { user: { tenantId: 'tenant-1', userId: 'worker-1', userType: 'STANDARD_USER' } };

  it('keeps visibility, entry, correction, submission and posting permissions distinct', () => {
    const prototype = FeedStockCountController.prototype;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.list)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'view' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.detail)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'view' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.create)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'create' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.update)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'edit' });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.submit)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'edit' });
    // Posting moves stock and value, so it sits with the privileged action —
    // count entry alone must never be able to post.
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.post)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'approve' });
  });

  it('passes authenticated scope and actor to create, submit and post without owning the approval decision', async () => {
    const service = {
      create: jest.fn(async () => ({ count_id: 'count-1', status: 'DRAFT' })),
      submit: jest.fn(async () => ({ count_id: 'count-1', status: 'PENDING_APPROVAL' })),
      postApprovedCount: jest.fn(async () => ({ count_id: 'count-1', status: 'POSTED' })),
    } as any;
    const controller = new FeedStockCountController(service);
    const dto = { companyId: 'company-1', farmId: 'farm-1', countedAt: '2026-10-01T06:00:00.000Z', scheduleSource: 'ON_DEMAND', lines: [] } as any;
    await expect(controller.create(dto, req)).resolves.toMatchObject({ data: { status: 'DRAFT' } });
    await expect(controller.submit('count-1', req)).resolves.toMatchObject({ data: { status: 'PENDING_APPROVAL' } });
    await expect(controller.post('count-1', req)).resolves.toMatchObject({ data: { status: 'POSTED' } });
    expect(service.create).toHaveBeenCalledWith(dto, 'tenant-1', req.user);
    expect(service.submit).toHaveBeenCalledWith('count-1', 'tenant-1', req.user);
    expect(service.postApprovedCount).toHaveBeenCalledWith('count-1', 'tenant-1', req.user);
  });
});

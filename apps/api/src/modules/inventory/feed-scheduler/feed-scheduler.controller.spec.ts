import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FeedSchedulerController } from './feed-scheduler.controller';

describe('FeedSchedulerController — "Run now" is admin only', () => {
  const scheduler = { runNow: jest.fn(async () => [{ status: 'DONE' }]), recentRuns: jest.fn(async () => []) };
  const controller = new FeedSchedulerController(scheduler as any);
  const req = (userType: string, extra: Record<string, unknown> = {}) => ({ user: { userId: 'u1', userType, tenantId: 't1', companyId: 'co-1', ...extra } });
  beforeEach(() => jest.clearAllMocks());

  it.each(['FARM_MANAGER', 'OPERATIONAL_ADMIN', 'STAFF', 'MILL_MANAGER'])('refuses %s and runs nothing', async (userType) => {
    await expect(controller.run('TENTATIVE_PLAN', {}, req(userType))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.runs({}, req(userType))).rejects.toBeInstanceOf(ForbiddenException);
    expect(scheduler.runNow).not.toHaveBeenCalled();
  });

  it.each(['TENANT_ADMIN', 'SYSTEM_ADMIN'])('lets %s run any job of the tenant', async (userType) => {
    const result = await controller.run('REQ_CUTOFF', { companyId: 'co-9' }, req(userType));
    expect(scheduler.runNow).toHaveBeenCalledWith('REQ_CUTOFF', { companyId: 'co-9', farmId: undefined }, 't1', 'u1');
    expect(result.success).toBe(true);
  });

  it('keeps a company admin to their own company', async () => {
    await expect(controller.run('DIET_CHANGE', { companyId: 'co-9' }, req('COMPANY_ADMIN'))).rejects.toBeInstanceOf(ForbiddenException);
    await controller.run('DIET_CHANGE', {}, req('COMPANY_ADMIN'));
    expect(scheduler.runNow).toHaveBeenCalledWith('DIET_CHANGE', { companyId: 'co-1', farmId: undefined }, 't1', 'u1');
  });

  it('refuses a company admin with no company, instead of running every company', async () => {
    await expect(controller.run('DIET_CHANGE', {}, req('COMPANY_ADMIN', { companyId: undefined }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(scheduler.runNow).not.toHaveBeenCalled();
  });

  it('rejects a job name that is not one of the five', async () => {
    await expect(controller.run('SEND_EMAIL', {}, req('TENANT_ADMIN'))).rejects.toBeInstanceOf(BadRequestException);
  });
});

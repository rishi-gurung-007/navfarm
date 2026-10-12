import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SetupWizardAccessGuard, WIZARD_ACCESS_KEY } from '../../system/setup-wizard/setup-wizard-access.guard';
import { FeedSettingsController } from './feed-settings.controller';

describe('FeedSettingsController company-settings access', () => {
  const proto = FeedSettingsController.prototype as any;
  const context = (handler: 'get' | 'put', request: any) => ({
    getHandler: () => proto[handler],
    getClass: () => FeedSettingsController,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

  const guardWithRows = (...answers: unknown[][]) => {
    const queue = [...answers];
    const db = {
      select: jest.fn(() => {
        const rows = queue.shift() ?? [];
        const chain: any = { from: () => chain, where: () => chain, limit: async () => rows };
        return chain;
      }),
    };
    return new SetupWizardAccessGuard(new Reflector(), transactionCls(db));
  };

  it('mounts the established company-access guard and marks company writes admin-only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FeedSettingsController)).toEqual(expect.arrayContaining([RolesGuard, SetupWizardAccessGuard]));
    expect(Reflect.getMetadata(WIZARD_ACCESS_KEY, proto.get)).toEqual({ admin: false, target: 'company', workspaceFallback: true });
    expect(Reflect.getMetadata(WIZARD_ACCESS_KEY, proto.put)).toEqual({ admin: true, target: 'company', workspaceFallback: true });
  });

  it('rejects an operational administrator even when it has Location edit permission', async () => {
    const guard = guardWithRows();
    await expect(guard.canActivate(context('put', {
      user: { userId: 'op-1', userType: 'OPERATIONAL_ADMIN', tenantId: 'tenant-1', companyId: 'co-1' },
      body: { companyId: 'co-1' }, params: {}, query: {},
    }))).rejects.toThrow('Only a System, Tenant or Company Admin');
  });

  it('rejects a company administrator targeting a company it does not belong to', async () => {
    const guard = guardWithRows([{ tenant_id: 'tenant-1' }], []);
    await expect(guard.canActivate(context('put', {
      user: { userId: 'admin-1', userType: 'COMPANY_ADMIN', tenantId: 'tenant-1', companyId: 'co-home' },
      body: { companyId: 'co-other' }, params: {}, query: {},
    }))).rejects.toThrow('Not authorized for this company');
  });

  it('keeps the controller contract that derives an omitted companyId from the active workspace', async () => {
    const guard = guardWithRows([{ tenant_id: 'tenant-1' }]);
    await expect(guard.canActivate(context('get', {
      user: { userId: 'admin-1', userType: 'COMPANY_ADMIN', tenantId: 'tenant-1', companyId: 'co-1' },
      headers: { 'x-active-company-id': 'co-1' }, body: {}, params: {}, query: {},
    }))).resolves.toBe(true);
  });

  it('marks the farm-override write admin-only and passes the farm to the service', async () => {
    expect(Reflect.getMetadata(WIZARD_ACCESS_KEY, proto.putFarm)).toEqual({ admin: true, target: 'company', workspaceFallback: true });
    const saveFarm = jest.fn(async () => ({ farmId: 'farm-1' }));
    const controller = new FeedSettingsController({ saveFarm } as any);
    await controller.putFarm({ farmId: 'farm-1', bulkMultipleKg: 6000 } as any, { headers: { 'x-active-company-id': 'co-1' }, user: { tenantId: 't-1', userId: 'u-1' } });
    expect(saveFarm).toHaveBeenCalledWith('co-1', 'farm-1', { bulkMultipleKg: 6000 }, 't-1', 'u-1');
  });
});


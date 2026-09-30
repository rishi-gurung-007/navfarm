import { NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { FeedAlertService, visibleTo } from './feed-alert.service';

/**
 * D24 (Rishi, 27 Sep): feed alerts are shown in the one Alerts page, for every
 * farm the user may open, and opening that page evaluates those farms (there
 * is still no scheduler). Farm scope is listFarms' — the same rules as
 * resolveFarm — so nothing here widens who sees what.
 */
describe('FeedAlertService — every farm in scope (D24)', () => {
  const farms = [
    { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom' },
    { farmId: 'farm-lex', code: 'LEX100', name: 'Lionshead Ext', companyId: 'co-1', companyName: 'Colcom' },
  ];
  const alertRow = (over: Record<string, unknown>) => ({
    alert_id: 'a', tenant_id: 't', company_id: 'co-1', farm_id: 'farm-vil', status: 'ACTIVE', recipient_roles: ['FARM_MANAGER'],
    escalation_role: null, escalated_at: null, last_notified_at: '2026-09-27 08:00:00', ...over,
  });

  function build(rows: unknown[], roleCodes: string[] = []) {
    let where: unknown;
    const db: any = {
      select: jest.fn(() => {
        let table: unknown;
        const self: any = {
          from: (t: unknown) => { table = t; return self; },
          leftJoin: () => self, innerJoin: () => self,
          where: (w: unknown) => { if (table === schema.feedAlert) where = w; return self; },
          orderBy: () => self,
          limit: async () => rows,
          then: (ok: any, err: any) => Promise.resolve(roleCodes.map((code) => ({ code }))).then(ok, err),
        };
        return self;
      }),
    };
    const forecast = { listFarms: jest.fn(async () => farms) };
    const service = new FeedAlertService(transactionCls(db), forecast as any, {} as any, {} as any);
    return { service, forecast, where: () => new MySqlDialect().sqlToQuery(where as any) };
  }

  it('lists the alerts of every farm in scope, with the farm code, for an admin', async () => {
    const { service, where } = build([
      { alert: alertRow({ alert_id: 'a1' }), farm_code: 'VIL100' },
      { alert: alertRow({ alert_id: 'a2', farm_id: 'farm-lex' }), farm_code: 'LEX100' },
    ]);
    const list = await service.listScope({}, 't', { userId: 'u', userType: 'TENANT_ADMIN' });
    expect(list.map((a: any) => [a.alert_id, a.farm_code])).toEqual([['a1', 'VIL100'], ['a2', 'LEX100']]);
    expect(where().params).toEqual(expect.arrayContaining(['farm-vil', 'farm-lex', 'ACTIVE']));
  });

  it('narrows to one farm, and answers not found for a farm outside the scope', async () => {
    const { service, where } = build([]);
    await service.listScope({ farmId: 'farm-lex', status: 'ALL' }, 't', { userId: 'u', userType: 'COMPANY_ADMIN' });
    expect(where().params).toContain('farm-lex');
    expect(where().params).not.toContain('farm-vil');
    await expect(service.listScope({ farmId: 'farm-other' }, 't', { userId: 'u', userType: 'COMPANY_ADMIN' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows a non-admin only the alerts addressed to one of their roles', async () => {
    const { service } = build([
      { alert: alertRow({ alert_id: 'mine' }), farm_code: 'VIL100' },
      { alert: alertRow({ alert_id: 'theirs', recipient_roles: ['HEAD_OF_FARM'] }), farm_code: 'VIL100' },
    ], ['FARM_MANAGER']);
    const list = await service.listScope({}, 't', { userId: 'u', userType: 'STANDARD_USER' });
    expect(list.map((a: any) => a.alert_id)).toEqual(['mine']);
  });

  it('shows a FARM_MANAGER alerts addressed to the farm-manager persona', async () => {
    const { service } = build([{ alert: alertRow({ alert_id: 'mine' }), farm_code: 'VIL100' }]);
    const list = await service.listScope({}, 't', { userId: 'u', userType: 'FARM_MANAGER' });
    expect(list.map((a: any) => a.alert_id)).toEqual(['mine']);
  });

  it('treats legacy HEAD_OF_FARM alert configuration as OPERATIONAL_ADMIN, not a user type', () => {
    expect(visibleTo(alertRow({ recipient_roles: ['HEAD_OF_FARM'] }), ['OPERATIONAL_ADMIN'], false)).toBe(true);
    expect(visibleTo(alertRow({ recipient_roles: [], escalated_at: '2026-10-01 08:00:00', escalation_role: 'HEAD_OF_FARM' }), ['OPERATIONAL_ADMIN'], false)).toBe(true);
  });

  it('drops a row whose company is not its farm\'s company in scope', async () => {
    const { service } = build([{ alert: alertRow({ alert_id: 'x', company_id: 'co-2' }), farm_code: 'VIL100' }]);
    await expect(service.listScope({}, 't', { userId: 'u', userType: 'TENANT_ADMIN' })).resolves.toEqual([]);
  });

  it('evaluates and lists every farm in scope, reporting a failed farm and a forecast gap without stopping (Review Focus 2)', async () => {
    const { service } = build([]);
    jest.spyOn(service, 'evaluateFarm')
      .mockImplementationOnce(async () => ({ raise: [], renotify: [], escalate: [], resolve: [], forecastError: 'Silo holds feed in BAG' }) as any)
      .mockImplementationOnce(async () => { throw new Error('connection lost'); });
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    const result = await service.evaluateScope('t', { userId: 'u', userType: 'TENANT_ADMIN' });
    expect(service.evaluateFarm).toHaveBeenNthCalledWith(1, 'farm-vil', 'co-1', 't');
    expect(service.evaluateFarm).toHaveBeenNthCalledWith(2, 'farm-lex', 'co-1', 't');
    expect(result).toEqual({
      farms: 2,
      forecastErrors: [{ farmCode: 'VIL100', reason: 'Silo holds feed in BAG' }],
      failed: [{ farmCode: 'LEX100', reason: 'connection lost' }],
    });
  });
});

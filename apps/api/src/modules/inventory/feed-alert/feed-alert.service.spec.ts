import { NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { FeedAlertService, visibleTo } from './feed-alert.service';
import type { AlertPlan } from './feed-alert.rules';

describe('visibleTo — who sees a feed alert (Q1)', () => {
  const alert = { recipient_roles: ['FARM_MANAGER'], escalation_role: 'HEAD_OF_FARM', escalated_at: null as string | null };
  it('shows a recipient role holder their alert', () => expect(visibleTo(alert, ['FARM_MANAGER'], false)).toBe(true));
  it('hides it from a user with none of its roles', () => expect(visibleTo(alert, ['OPERATOR'], false)).toBe(false));
  it('shows the escalation role only once escalated', () => {
    expect(visibleTo(alert, ['HEAD_OF_FARM'], false)).toBe(false);
    expect(visibleTo({ ...alert, escalated_at: '2026-09-23 16:00:00' }, ['HEAD_OF_FARM'], false)).toBe(true);
  });
  it('shows admins everything', () => expect(visibleTo(alert, [], true)).toBe(true));
});

describe('FeedAlertService', () => {
  const inserted: any[] = [];
  const updates: any[] = [];
  const db: any = {
    insert: jest.fn(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) })),
    update: jest.fn(() => ({ set: jest.fn((v: any) => ({ where: jest.fn(async () => { updates.push(v); }) })) })),
    select: jest.fn(() => { throw new Error('connection lost'); }),
  };
  const cls = transactionCls(db);
  const service = new FeedAlertService(cls, {} as any, {} as any, {} as any);

  beforeEach(() => { inserted.length = 0; updates.length = 0; });

  it('evaluateLevelsSafely swallows errors so a posting is never failed by its alerts (Review Focus 5)', async () => {
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.evaluateLevelsSafely(['silo-1'], 'tenant-1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('writes a raised alert with active_key = dedup key, and a resolved one with active_key cleared', async () => {
    const rule = { ruleId: 'rule-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null,
      priorityLevel: 'CRITICAL_FIRST_PRIORITY', recipientRoles: ['FARM_MANAGER'], frequency: 'ESCALATING', escalationAfterHours: 4, escalationRole: 'HEAD_OF_FARM', farmId: null, isActive: true } as const;
    const plan: AlertPlan = {
      raise: [{ rule: rule as any, dedupKey: 'rule-low|s1', subjectType: 'SILO', subjectId: 's1', itemId: 'r1', title: 'Low feed: GRS/SILO-001', message: 'm', observedValue: 900, thresholdValue: 1000 }],
      renotify: [{ alertId: 'a3', observedValue: 850 }], escalate: [{ alertId: 'a2', role: 'HEAD_OF_FARM' }], resolve: [{ alertId: 'a1', reason: 'RECOVERED' }],
    };
    await (service as any).applyPlan(plan, { tenantId: 't', companyId: 'co', farmId: 'farm', nowMs: Date.UTC(2026, 8, 23, 12) });

    expect(inserted[0]).toMatchObject({
      tenant_id: 't', company_id: 'co', farm_id: 'farm', rule_id: 'rule-low', notification_code: 'FEED-BELOW-L1', event_type: 'FEED_BELOW_L1',
      priority_level: 'CRITICAL_FIRST_PRIORITY', subject_type: 'SILO', subject_id: 's1', item_id: 'r1', dedup_key: 'rule-low|s1', active_key: 'rule-low|s1',
      status: 'ACTIVE', observed_value: '900', threshold_value: '1000', recipient_roles: ['FARM_MANAGER'], raised_at: '2026-09-23 12:00:00',
      last_notified_at: '2026-09-23 12:00:00',
    });
    expect(updates).toEqual(expect.arrayContaining([
      // Caller contract (d): a re-notify stamps the day it was sent and the value it was about.
      expect.objectContaining({ last_notified_at: '2026-09-23 12:00:00', observed_value: '850' }),
      expect.objectContaining({ escalated_at: '2026-09-23 12:00:00', escalation_role: 'HEAD_OF_FARM' }),
      expect.objectContaining({ status: 'RESOLVED', active_key: null, resolved_reason: 'RECOVERED', resolved_at: '2026-09-23 12:00:00' }),
    ]));
  });

  it('ignores a duplicate active_key raised concurrently rather than failing', async () => {
    // Drizzle wraps the driver error in `cause`; the duplicate must be recognised through it.
    db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw Object.assign(new Error('Failed query'), { cause: { code: 'ER_DUP_ENTRY' } }); }) }));
    const plan: AlertPlan = { raise: [{ rule: { ruleId: 'r', notificationCode: 'X', eventType: 'FEED_ABOVE', recipientRoles: ['A'], priorityLevel: 'INFO' } as any,
      dedupKey: 'r|s1', subjectType: 'SILO', subjectId: 's1', itemId: null, title: 't', message: 'm', observedValue: 1, thresholdValue: 1 }], renotify: [], escalate: [], resolve: [] };
    await expect((service as any).applyPlan(plan, { tenantId: 't', companyId: 'co', farmId: 'farm', nowMs: 0 })).resolves.toBeUndefined();
  });

  it('still throws any other insert failure (the safe wrappers log it)', async () => {
    db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw new Error('disk full'); }) }));
    const plan: AlertPlan = { raise: [{ rule: { ruleId: 'r', notificationCode: 'X', eventType: 'FEED_ABOVE', recipientRoles: ['A'], priorityLevel: 'INFO' } as any,
      dedupKey: 'r|s1', subjectType: 'SILO', subjectId: 's1', itemId: null, title: 't', message: 'm', observedValue: 1, thresholdValue: 1 }], renotify: [], escalate: [], resolve: [] };
    await expect((service as any).applyPlan(plan, { tenantId: 't', companyId: 'co', farmId: 'farm', nowMs: 0 })).rejects.toThrow('disk full');
  });
});

/** A select chain that is awaitable at any step and records every where() it saw. */
function selectDb(answer: (table: unknown) => unknown[]) {
  const wheres: unknown[] = [];
  const db: any = {
    select: jest.fn(() => {
      let table: unknown;
      const self: any = {
        from: (t: unknown) => { table = t; return self; },
        innerJoin: () => self,
        leftJoin: () => self,
        where: (c: unknown) => { wheres.push(c); return self; },
        orderBy: () => self,
        limit: () => self,
        then: (ok: any, err: any) => Promise.resolve(answer(table)).then(ok, err),
      };
      return self;
    }),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => undefined) })) })),
    insert: jest.fn(() => ({ values: jest.fn(async () => undefined) })),
  };
  return { db, wheres };
}
const render = (c: unknown) => new MySqlDialect().sqlToQuery(c as any);

describe('FeedAlertService — evaluation (caller contract of planAlerts)', () => {
  it('evaluateLevelsSafely does nothing inside an open posting transaction — it must run after commit (M6)', async () => {
    const { db } = selectDb(() => []);
    const cls = transactionCls(db);
    const service = new FeedAlertService(cls, {} as any, {} as any, {} as any);
    const evaluate = jest.spyOn(service, 'evaluateFarm');
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await cls.run(async () => {
      cls.set('tenantPostingTransaction', true);
      await service.evaluateLevelsSafely(['silo-1'], 't');
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('evaluateLevelsSafely re-checks each touched farm once, silo levels only', async () => {
    const { db } = selectDb(() => [
      { location_id: 'silo-1', location_type: 'SILO', farm_id: 'farm-a', company_id: 'co' },
      { location_id: 'store-1', location_type: 'STORE', farm_id: 'farm-a', company_id: 'co' },
      { location_id: 'farm-b', location_type: 'FARM', farm_id: null, company_id: 'co' },
    ]);
    const service = new FeedAlertService(transactionCls(db), {} as any, {} as any, {} as any);
    const evaluate = jest.spyOn(service, 'evaluateFarm').mockResolvedValue({ raise: [], renotify: [], escalate: [], resolve: [] });
    await service.evaluateLevelsSafely(['silo-1', 'store-1', null, 'farm-b', 'silo-1'], 't');
    expect(evaluate.mock.calls).toEqual([
      ['farm-a', 'co', 't', { levelsOnly: true }],
      ['farm-b', 'co', 't', { levelsOnly: true }],
    ]);
  });

  it('evaluateFarm ensures the company defaults first (M8), then reads every fact under the farm as system work — never the caller\'s LOB-restricted scope', async () => {
    const { db } = selectDb(() => []);
    const cls = transactionCls(db);
    const order: string[] = [];
    const alertRules = { ensureDefaultRules: jest.fn(async () => { order.push('ensure'); }) };
    const forecast = {
      withFarmScope: jest.fn((farmId: string, companyId: string, work: () => Promise<unknown>) =>
        cls.run(async () => { cls.set(FARM_SCOPE_KEY, { ...farmScope(cls), farmId, companyId }); return work(); })),
      computeForFarm: jest.fn(),
      farmToday: jest.fn(async () => ({ today: '2026-09-25', timeZone: 'Africa/Harare' })),
    };
    const service = new FeedAlertService(cls, forecast as any, {} as any, alertRules as any);
    const seen: unknown[] = [];
    jest.spyOn(service as any, 'loadRules').mockImplementation(async () => { order.push('rules'); seen.push(farmScope(cls)); return []; });
    jest.spyOn(service as any, 'loadSiloLevels').mockImplementation(async () => { seen.push(farmScope(cls)); return []; });
    const loadReqs = jest.spyOn(service as any, 'loadOpenRequisitions').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadActive').mockResolvedValue([]);
    jest.spyOn(service as any, 'applyPlan').mockResolvedValue(undefined);

    await cls.run(async () => {
      // A restricted operational admin posted; the alert is the farm's, not theirs.
      cls.set(FARM_SCOPE_KEY, { farmId: 'other-farm', restricted: true, companyId: 'co', lobId: 'lob-pig' });
      await service.evaluateFarm('farm-a', 'co', 't', { levelsOnly: true });
    });

    expect(order).toEqual(['ensure', 'rules']);
    expect(alertRules.ensureDefaultRules).toHaveBeenCalledWith('co', 't');
    expect(seen).toEqual([
      { farmId: 'farm-a', companyId: 'co', restricted: false, lobId: null },
      { farmId: 'farm-a', companyId: 'co', restricted: false, lobId: null },
    ]);
    // levelsOnly: no diet or requisition facts, which only a full evaluation advances.
    expect(loadReqs).not.toHaveBeenCalled();
    expect(forecast.computeForFarm).not.toHaveBeenCalled();
  });

  it('a levelsOnly (posting-hook) evaluation does not throw when farmToday rejects — silo rules still raise, on the server-day fallback (M6)', async () => {
    const cls = transactionCls({});
    const alertRules = { ensureDefaultRules: jest.fn() };
    const forecast = {
      withFarmScope: jest.fn((_f: string, _c: string, work: () => Promise<unknown>) => work()),
      computeForFarm: jest.fn(),
      farmToday: jest.fn().mockRejectedValue(new Error('connection lost')),
    };
    const service = new FeedAlertService(cls, forecast as any, {} as any, alertRules as any);
    const siloRule = {
      ruleId: 'r-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null,
      priorityLevel: 'WARNING', recipientRoles: ['FARM_MANAGER'], frequency: 'ONCE', escalationAfterHours: null, escalationRole: null, farmId: null, isActive: true,
    };
    jest.spyOn(service as any, 'loadRules').mockResolvedValue([siloRule]);
    jest.spyOn(service as any, 'loadSiloLevels').mockResolvedValue([
      { siloId: 's1', siloCode: 'F/SILO-1', itemId: 'i1', itemName: 'Grower', balanceKg: 500, lowLevelKg: 1000, highLevelKg: null },
    ]);
    jest.spyOn(service as any, 'loadActive').mockResolvedValue([]);
    const apply = jest.spyOn(service as any, 'applyPlan').mockResolvedValue(undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await service.evaluateFarm('farm-a', 'co', 't', { levelsOnly: true });

    expect(result.forecastError).toBe('connection lost');
    const plan = apply.mock.calls[0][0] as AlertPlan;
    expect(plan.raise).toEqual([expect.objectContaining({ rule: siloRule, subjectId: 's1' })]);
  });

  it('hands planAlerts every active silo of the farm, levelled or not, so a FIXED_VALUE rule and recovery both see them (contract a)', async () => {
    const silos = [
      { location_id: 's1', location_code: 'F/SILO-1', low_level_kg: '1000.0000', high_level_kg: null },
      { location_id: 's2', location_code: 'F/SILO-2', low_level_kg: null, high_level_kg: null },
    ];
    const { db, wheres } = selectDb((t) => (t === schema.locationMaster ? silos : []));
    const siloFeed = { currentItems: jest.fn(async () => new Map([['s1', { item_id: 'i1', item_code: 'GRW', item_description: 'Grower', on_hand_qty: 800, uoms: ['KG'] }], ['s2', null]])) };
    const service = new FeedAlertService(transactionCls(db), {} as any, siloFeed as any, {} as any);
    const facts = await (service as any).loadSiloLevels('farm-a', 'co', 't');
    expect(siloFeed.currentItems).toHaveBeenCalledWith(['s1', 's2'], 'co', 't');
    expect(facts).toEqual([
      { siloId: 's1', siloCode: 'F/SILO-1', itemId: 'i1', itemName: 'Grower', balanceKg: 800, lowLevelKg: 1000, highLevelKg: null },
      { siloId: 's2', siloCode: 'F/SILO-2', itemId: null, itemName: null, balanceKg: 0, lowLevelKg: null, highLevelKg: null },
    ]);
    const q = render(wheres[0]);
    expect(q.sql).toContain('`location_master`.`farm_id` = ?');
    expect(q.params).toEqual(expect.arrayContaining(['farm-a', 'co', 'SILO']));
  });

  it('reads open alerts of the evaluated farm only (contract b) and only unapproved feed requisitions (contract c)', async () => {
    const { db, wheres } = selectDb(() => []);
    const service = new FeedAlertService(transactionCls(db), {} as any, {} as any, {} as any);
    await (service as any).loadActive('farm-a', 't');
    await (service as any).loadOpenRequisitions('farm-a', 'co', 't');
    const active = render(wheres[0]);
    expect(active.sql).toContain('`feed_alert`.`farm_id` = ?');
    expect(active.params).toEqual(expect.arrayContaining(['farm-a', 'ACTIVE']));
    const reqs = render(wheres[1]);
    expect(reqs.params).toEqual(expect.arrayContaining(['farm-a', 'co', 'FEED', 'AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL']));
    expect(reqs.params).not.toContain('APPROVED');
  });

  it('resolves a user\'s role codes within the alert\'s company only (L15)', async () => {
    const { db, wheres } = selectDb(() => [{ code: 'FARM_MANAGER' }]);
    const service = new FeedAlertService(transactionCls(db), {} as any, {} as any, {} as any);
    await expect((service as any).roleCodesOf('u1', 'co-a')).resolves.toEqual(['FARM_MANAGER']);
    const q = render(wheres[0]);
    expect(q.sql).toContain('`role_master`.`company_id` = ?');
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'co-a']));
  });

  describe('full evaluation when the forecast cannot be built (final review I1)', () => {
    const rule = (over: Record<string, unknown>) => ({
      thresholdReference: 'FIXED_VALUE', priorityLevel: 'WARNING', recipientRoles: ['FARM_MANAGER'], frequency: 'ONCE',
      escalationAfterHours: null, escalationRole: null, farmId: null, isActive: true, ...over,
    });
    const rules = [
      rule({ ruleId: 'r-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null }),
      rule({ ruleId: 'r-diet', notificationCode: 'DIET-CHANGE', eventType: 'DIET_CHANGE', thresholdValue: 3 }),
      rule({ ruleId: 'r-over', notificationCode: 'REQ-OVERDUE', eventType: 'REQ_DEADLINE', thresholdValue: 0 }),
    ];
    const openDiet = {
      alertId: 'al-diet', ruleId: 'r-diet', eventType: 'DIET_CHANGE', subjectType: 'BATCH', dedupKey: 'r-diet|b1|i2|2026-09-27',
      raisedAtMs: 0, lastNotifiedDay: '2026-09-25', acknowledged: false, escalated: false, observedValue: 2,
    };

    function build(computeForFarm: jest.Mock) {
      const cls = transactionCls({});
      const forecast = {
        resolveFarm: jest.fn(async () => ({ farmId: 'farm-a', companyId: 'co' })),
        withFarmScope: jest.fn((_f: string, _c: string, work: () => Promise<unknown>) => work()),
        computeForFarm,
        farmToday: jest.fn(async () => ({ today: '2026-09-25', timeZone: 'Africa/Harare' })),
      };
      const service = new FeedAlertService(cls, forecast as any, {} as any, { ensureDefaultRules: jest.fn() } as any);
      jest.spyOn(service as any, 'loadRules').mockResolvedValue(rules);
      jest.spyOn(service as any, 'loadSiloLevels').mockResolvedValue([
        { siloId: 's1', siloCode: 'F/SILO-1', itemId: 'i1', itemName: 'Grower', balanceKg: 500, lowLevelKg: 1000, highLevelKg: null },
      ]);
      jest.spyOn(service as any, 'loadOpenRequisitions').mockResolvedValue([
        { requisitionId: 'rq1', reqNo: 'FRQ-1', status: 'DRAFT', submissionDeadline: '2020-01-01' },
      ]);
      jest.spyOn(service as any, 'loadActive').mockResolvedValue([openDiet]);
      const apply = jest.spyOn(service as any, 'applyPlan').mockResolvedValue(undefined);
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
      return { service, apply };
    }

    it('still raises the silo and deadline alerts, leaves DIET_CHANGE alerts alone, and says why', async () => {
      const { service, apply } = build(jest.fn().mockRejectedValue(new Error('Silo F/SILO-1 holds feed in BAG, not KG.')));
      const result = await service.evaluateNow('farm-a', 't', 'COMPANY_ADMIN');

      const plan = apply.mock.calls[0][0] as AlertPlan;
      expect(plan.raise.map((c) => c.rule.notificationCode).sort()).toEqual(['FEED-BELOW-L1', 'REQ-OVERDUE']);
      // Not resolved as PASSED (an empty diet list would do that), and not RULE_OFF either.
      expect(plan.resolve).toEqual([]);
      expect(result).toEqual({ farmId: 'farm-a', raised: 2, renotified: 0, escalated: 0, resolved: 0, forecastError: 'Silo F/SILO-1 holds feed in BAG, not KG.' });
    });

    it('carries no forecastError when the forecast builds', async () => {
      const { service, apply } = build(jest.fn().mockResolvedValue({ dietChanges: [] }));
      const result = await service.evaluateNow('farm-a', 't', 'COMPANY_ADMIN');
      expect(result).not.toHaveProperty('forecastError');
      // With a real (empty) diet list the open diet alert has passed.
      expect((apply.mock.calls[0][0] as AlertPlan).resolve).toEqual([{ alertId: 'al-diet', reason: 'PASSED' }]);
    });

    it('evaluates on the farm day from farmToday, not the server day (D16)', async () => {
      const computeForFarm = jest.fn().mockResolvedValue({ dietChanges: [] });
      const { service } = build(computeForFarm);
      await service.evaluateNow('farm-a', 't', 'COMPANY_ADMIN');
      expect(computeForFarm).toHaveBeenCalledWith('farm-a', 'co', 't', expect.objectContaining({ from: '2026-09-25' }), expect.anything());
    });

    it('hands the clock it read to the forecast, so the zone is read once per evaluation (M6)', async () => {
      const computeForFarm = jest.fn().mockResolvedValue({ dietChanges: [] });
      const { service } = build(computeForFarm);
      await service.evaluateNow('farm-a', 't', 'COMPANY_ADMIN');
      expect(computeForFarm.mock.calls[0][4]).toEqual({ today: '2026-09-25', timeZone: 'Africa/Harare' });
    });
  });

  it('evaluateNow resolves the farm with the caller\'s user type, then runs a full evaluation', async () => {
    const forecast = { resolveFarm: jest.fn(async () => ({ farmId: 'farm-a', companyId: 'co' })) };
    const service = new FeedAlertService(transactionCls({}), forecast as any, {} as any, {} as any);
    const evaluate = jest.spyOn(service, 'evaluateFarm').mockResolvedValue({ raise: [{} as any], renotify: [], escalate: [{} as any, {} as any], resolve: [] });
    await expect(service.evaluateNow(undefined, 't', 'STANDARD_USER')).resolves.toEqual({ farmId: 'farm-a', raised: 1, renotified: 0, escalated: 2, resolved: 0 });
    expect(forecast.resolveFarm).toHaveBeenCalledWith(undefined, 't', 'STANDARD_USER');
    expect(evaluate).toHaveBeenCalledWith('farm-a', 'co', 't');
  });
});

describe('FeedAlertService — acknowledge (farm scope by the alert\'s own farm)', () => {
  const row = {
    alert_id: 'al-1', tenant_id: 't', company_id: 'co', farm_id: 'farm-a', status: 'ACTIVE',
    recipient_roles: ['FARM_MANAGER'], escalation_role: null, escalated_at: null, acknowledged_by: null, acknowledged_at: null,
  };

  function build(resolveFarm: jest.Mock, roles: string[] = ['FARM_MANAGER'], alert: Record<string, unknown> = row) {
    const { db } = selectDb((t) => (t === schema.feedAlert ? [alert] : roles.map((code) => ({ code }))));
    const service = new FeedAlertService(transactionCls(db), { resolveFarm } as any, {} as any, {} as any);
    return { service, db };
  }

  it('checks the alert\'s own farm against the caller before writing', async () => {
    const resolveFarm = jest.fn(async () => ({ farmId: 'farm-a', companyId: 'co' }));
    const { service, db } = build(resolveFarm);
    const result = await service.acknowledge('al-1', 't', { userId: 'u1', userType: 'STANDARD_USER' });
    expect(resolveFarm).toHaveBeenCalledWith('farm-a', 't', 'STANDARD_USER');
    expect(db.update).toHaveBeenCalled();
    expect(result).toMatchObject({ alert_id: 'al-1', acknowledged_by: 'u1' });
  });

  it('lets a FARM_MANAGER acknowledge an alert addressed to that persona without a matching RBAC role code', async () => {
    const resolveFarm = jest.fn(async () => ({ farmId: 'farm-a', companyId: 'co' }));
    const { service, db } = build(resolveFarm, []);

    await expect(service.acknowledge('al-1', 't', { userId: 'u1', userType: 'FARM_MANAGER' }))
      .resolves.toMatchObject({ alert_id: 'al-1', acknowledged_by: 'u1' });
    expect(db.update).toHaveBeenCalled();
  });

  it('answers NotFound for an alert on a farm (or company) the caller may not see, and writes nothing', async () => {
    const resolveFarm = jest.fn(async () => { throw new NotFoundException('Farm not found.'); });
    const { service, db } = build(resolveFarm);
    await expect(service.acknowledge('al-1', 't', { userId: 'u1', userType: 'COMPANY_ADMIN' })).rejects.toThrow(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers NotFound when the resolved company is not the alert\'s own', async () => {
    const resolveFarm = jest.fn(async () => ({ farmId: 'farm-a', companyId: 'other-co' }));
    const { service, db } = build(resolveFarm);
    await expect(service.acknowledge('al-1', 't', { userId: 'u1', userType: 'TENANT_ADMIN' })).rejects.toThrow(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('answers NotFound to a user holding none of the alert\'s roles', async () => {
    const resolveFarm = jest.fn(async () => ({ farmId: 'farm-a', companyId: 'co' }));
    const { service, db } = build(resolveFarm, ['OPERATOR']);
    await expect(service.acknowledge('al-1', 't', { userId: 'u1', userType: 'STANDARD_USER' })).rejects.toThrow(NotFoundException);
    expect(db.update).not.toHaveBeenCalled();
  });
});

/**
 * Task 9b fix round 1, finding 2, end to end through the service: a diet
 * change of an ANIMAL_WISE/REGISTERED stage group is evaluated and INSERTED
 * with subject_id = the real batch_header PK. Before the fix the 73-char
 * composite reached feed_alert.subject_id (varchar(36)), MySQL refused it, and
 * the safe callers swallowed the error — so the alert was never raised.
 */
describe('FeedAlertService — DIET_CHANGE for a stage group writes the real batch id', () => {
  it('inserts subject_id = the genuine batch id, never the composite', async () => {
    const real = 'a1b2c3d4-0000-4000-8000-000000000001';
    const composite = `${real}:a1b2c3d4-0000-4000-8000-0000000000ff`;
    const inserted: any[] = [];
    const db: any = { insert: jest.fn(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) })) };
    const forecast = {
      farmToday: jest.fn(async () => ({ today: '2026-09-25', timeZone: null })),
      computeForFarm: jest.fn(async () => ({ dietChanges: [{
        batchId: composite, realBatchId: real, batchNo: 'B-1 · FLUSH', shedCode: 'F/SHED-1', fromItemId: 'i1', fromItemName: 'Flushing',
        toItemId: 'i2', toItemName: 'Insemination', changeDate: '2026-09-27', nextSourceType: 'SILO', nextSourceCode: 'F/SILO-2',
      }] })),
    };
    const service = new FeedAlertService(transactionCls(db), forecast as any, {} as any, { ensureDefaultRules: jest.fn() } as any);
    jest.spyOn(service as any, 'systemFarmScope').mockImplementation((...args: any[]) => args[2]());
    jest.spyOn(service as any, 'loadRules').mockResolvedValue([{
      ruleId: 'r-diet', notificationCode: 'DIET-CHANGE', eventType: 'DIET_CHANGE', thresholdReference: 'FIXED_VALUE', thresholdValue: 3,
      priorityLevel: 'WARNING', recipientRoles: ['FARM_MANAGER'], frequency: 'ONCE', escalationAfterHours: null, escalationRole: null, farmId: null, isActive: true,
    }]);
    jest.spyOn(service as any, 'loadSiloLevels').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadOpenRequisitions').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadActive').mockResolvedValue([]);

    await service.evaluateFarm('farm-a', 'co', 't');

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ event_type: 'DIET_CHANGE', subject_type: 'BATCH', subject_id: real, item_id: 'i2' });
    expect(inserted[0].subject_id.length).toBeLessThanOrEqual(36);
  });
});

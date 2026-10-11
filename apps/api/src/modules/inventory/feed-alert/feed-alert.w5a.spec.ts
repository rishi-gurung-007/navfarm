import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from '../../procurement/feed-requisition/feed-requisition.service';
import { AlertRuleFact, ActiveAlertFact, OrderFacts, PlanAlertsInput, planAlerts } from './feed-alert.rules';
import { FeedAlertService } from './feed-alert.service';

// W5A (11 Oct): SHORTFALL, NOT_DRAFTED, TRUCK_TARGET (evaluated); AUTO_DRAFTED, STOCK_TAKE_DUE, CHANGEOVER (pushed).
const NOW = Date.UTC(2026, 9, 11, 8, 0, 0);
const rule = (eventType: string, extra: Partial<AlertRuleFact> = {}): AlertRuleFact => ({
  ruleId: `rule-${eventType}`, notificationCode: eventType, eventType, thresholdReference: 'FIXED_VALUE', thresholdValue: 0, priorityLevel: 'WARNING',
  recipientRoles: ['FARM_MANAGER'], frequency: 'ONCE', escalationAfterHours: null, escalationRole: null, farmId: null, isActive: true, ...extra,
});
const base = (over: Partial<PlanAlertsInput>): PlanAlertsInput => ({
  today: '2026-10-11', nowMs: NOW, farmId: 'farm-1', rules: [], silos: [], dietChanges: [], requisitions: [], active: [], levelsOnly: false, ...over,
});
const open = (r: AlertRuleFact, dedupKey: string, subjectType: ActiveAlertFact['subjectType'] = 'SILO'): ActiveAlertFact => ({
  alertId: 'a1', ruleId: r.ruleId, eventType: r.eventType, subjectType, dedupKey, raisedAtMs: NOW - 3_600_000,
  lastNotifiedDay: '2026-10-11', acknowledged: false, escalated: false, observedValue: 4500,
});
const silo = (id: string, shortfall: number, requisitionStatus: string | null = null) => ({
  siloId: id, siloCode: id.toUpperCase(), itemId: 'i1', itemName: 'FEED-R1', projectedShortfallKg: shortfall, recommendedOrderKg: shortfall ? 6000 : 0, requisitionStatus,
});
const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({ silos: [silo('s1', 4500), silo('s2', 0)], farmTotalOrderKg: 15000, truckTargetKg: 30000, ...over });

describe('SHORTFALL (Engine row 60)', () => {
  const r = rule('SHORTFALL');
  const key = 'rule-SHORTFALL|s1';
  it('raises for a silo with a projected shortfall, not for one without', () => {
    const plan = planAlerts(base({ rules: [r], orderFacts: facts() }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ dedupKey: key, subjectType: 'SILO', subjectId: 's1', observedValue: 4500, itemId: 'i1' });
    expect(plan.raise[0].message).toContain('4,500 kg short');
  });
  it('does not double-alert: with no requisition and a live NOT_DRAFTED rule only NOT_DRAFTED raises; with a requisition SHORTFALL raises', () => {
    const nd = rule('NOT_DRAFTED');
    const none = planAlerts(base({ rules: [r, nd], orderFacts: facts() }));
    expect(none.raise.map((a) => a.rule.eventType)).toEqual(['NOT_DRAFTED']);
    const covered = planAlerts(base({ rules: [r, nd], orderFacts: facts({ silos: [silo('s1', 4500, 'DRAFT')] }) }));
    expect(covered.raise.map((a) => a.rule.eventType)).toEqual(['SHORTFALL']);
  });
  it('dedupes while open and resolves when the shortfall clears', () => {
    expect(planAlerts(base({ rules: [r], orderFacts: facts(), active: [open(r, key)] }))).toEqual({ raise: [], renotify: [], escalate: [], resolve: [] });
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ silos: [silo('s1', 0)] }), active: [open(r, key)] })).resolve).toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
  });
  it('is left alone when the facts were not computed (levels-only pass, or the statuses failed)', () => {
    expect(planAlerts(base({ rules: [r], active: [open(r, key)] })).resolve).toEqual([]);
    expect(planAlerts(base({ rules: [r], active: [open(r, key)], levelsOnly: true })).resolve).toEqual([]);
  });
});

describe('NOT_DRAFTED (Engine row 61)', () => {
  const r = rule('NOT_DRAFTED');
  const key = 'rule-NOT_DRAFTED|s1';
  it('raises when a shortfall has no requisition, and not when one covers the silo', () => {
    const plan = planAlerts(base({ rules: [r], orderFacts: facts() }));
    expect(plan.raise[0]).toMatchObject({ dedupKey: key, subjectType: 'SILO', subjectId: 's1' });
    expect(plan.raise[0].title).toBe('No requisition drafted: S1');
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ silos: [silo('s1', 4500, 'AUTO_DRAFT')] }) })).raise).toEqual([]);
  });
  it('dedupes while open and resolves once a requisition is drafted', () => {
    expect(planAlerts(base({ rules: [r], orderFacts: facts(), active: [open(r, key)] })).raise).toEqual([]);
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ silos: [silo('s1', 4500, 'DRAFT')] }), active: [open(r, key)] })).resolve)
      .toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
  });
});

describe('TRUCK_TARGET (Engine row 62)', () => {
  const r = rule('TRUCK_TARGET');
  const key = 'rule-TRUCK_TARGET|farm-1';
  it('raises one farm-level alert when the order is above 0 and below the truck target', () => {
    const plan = planAlerts(base({ rules: [r], orderFacts: facts() }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ dedupKey: key, subjectType: 'FARM', subjectId: 'farm-1', observedValue: 15000, thresholdValue: 30000 });
  });
  it('stays quiet with no order, or at or over the target', () => {
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ farmTotalOrderKg: 0 }) })).raise).toEqual([]);
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ farmTotalOrderKg: 30000 }) })).raise).toEqual([]);
  });
  it('dedupes while open and resolves when the order reaches the target', () => {
    expect(planAlerts(base({ rules: [r], orderFacts: facts(), active: [open(r, key, 'FARM')] })).raise).toEqual([]);
    expect(planAlerts(base({ rules: [r], orderFacts: facts({ farmTotalOrderKg: 33000 }), active: [open(r, key, 'FARM')] })).resolve)
      .toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
  });
});

describe('pushed W5A events — AUTO_DRAFTED, STOCK_TAKE_DUE, CHANGEOVER', () => {
  const build = (rules: AlertRuleFact[]) => {
    const inserted: any[] = [];
    const updates: any[] = [];
    const db: any = {
      insert: jest.fn(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) })),
      update: jest.fn(() => ({ set: jest.fn((v: any) => ({ where: jest.fn(async () => { updates.push(v); }) })) })),
    };
    const alertRules: any = { ensureDefaultRules: jest.fn(async () => undefined) };
    const service = new FeedAlertService(transactionCls(db), {} as any, {} as any, alertRules);
    jest.spyOn(service as any, 'loadRules').mockResolvedValue(rules);
    return { service, inserted, updates, db };
  };
  const ctx = { farmId: 'farm-1', companyId: 'co-1', tenantId: 't1' };
  const cases: Array<[string, string, string, string]> = [
    ['AUTO_DRAFTED', 'REQUISITION', 'req-1', 'req-1'],
    ['STOCK_TAKE_DUE', 'STOCK_TAKE', 'per-1', 'per-1|farm-1'],
    ['CHANGEOVER', 'REQUISITION', 'req-1', 'req-1|silo-1'],
  ];
  describe.each(cases)('%s', (eventType, subjectType, subjectId, suffix) => {
    const r = rule(eventType, { recipientRoles: ['FARM_MANAGER'] });
    const input = { eventType: eventType as any, subjectType: subjectType as any, subjectId, dedupSuffix: suffix, title: 'T', message: 'M' };
    it('raises one in-app alert per active rule on the farm, to the rule roles', async () => {
      const { service, inserted } = build([r, rule(eventType, { ruleId: 'off', isActive: false })]);
      expect(await service.raiseEvent(ctx, input, NOW)).toEqual({ rules: 1, raised: 1 });
      expect(inserted[0]).toMatchObject({
        farm_id: 'farm-1', company_id: 'co-1', event_type: eventType, subject_type: subjectType, subject_id: subjectId,
        dedup_key: `rule-${eventType}|${suffix}`, active_key: `rule-${eventType}|${suffix}`, status: 'ACTIVE', recipient_roles: ['FARM_MANAGER'],
      });
    });
    it('dedupes on the open alert (duplicate active_key raises nothing)', async () => {
      const { service, db } = build([r]);
      db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw Object.assign(new Error('Failed query'), { cause: { code: 'ER_DUP_ENTRY' } }); }) }));
      expect(await service.raiseEvent(ctx, input)).toEqual({ rules: 1, raised: 0 });
    });
    it('resolves by the same suffix', async () => {
      const { service, updates } = build([]);
      await service.resolveEvent({ companyId: 'co-1', tenantId: 't1' }, eventType as any, [suffix], 'CLOSED', NOW);
      expect(updates).toEqual([expect.objectContaining({ status: 'RESOLVED', active_key: null, resolved_reason: 'CLOSED' })]);
    });
  });
});

describe('STOCK_TAKE_DUE evaluator (Master Setup row 45)', () => {
  const ctx = { farmId: 'farm-1', companyId: 'co-1', tenantId: 't1' };
  /** select() answers in call order: periods, mills, the farm row, then the posted takes of each place. */
  const build = (periods: any[], posted: any[][]) => {
    const queues: any[][] = [periods, [], [{ code: 'GRS' }], ...posted];
    const db: any = {
      select: jest.fn(() => {
        const result = queues.shift() ?? [];
        const chain: any = {};
        for (const m of ['from', 'where', 'limit']) chain[m] = () => chain;
        chain.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
        return chain;
      }),
    };
    const forecast: any = { farmToday: jest.fn(async () => ({ today: '2026-10-24', timeZone: null })) };
    const service = new FeedAlertService(transactionCls(db), forecast, {} as any, { ensureDefaultRules: jest.fn(async () => undefined) } as any);
    jest.spyOn(service as any, 'loadRules').mockResolvedValue([rule('STOCK_TAKE_DUE', { thresholdValue: 3 })]);
    const raise = jest.spyOn(service, 'raiseEvent').mockResolvedValue({ rules: 1, raised: 1 });
    const resolve = jest.spyOn(service, 'resolveEvent').mockResolvedValue(undefined);
    return { service, raise, resolve };
  };
  const period = (id: string, stockTakeDate: string, over: any = {}) => ({ period_id: id, period_code: id, stock_take_date: stockTakeDate, period_status: 'OPEN', ...over });

  it('raises N days before the stock take date when no monthly take is posted', async () => {
    const { service, raise } = build([period('2026-10', '2026-10-26'), period('2026-11', '2026-11-28')], [[]]);
    expect(await service.evaluateStockTakeDue(ctx, NOW)).toEqual({ raised: 1, resolved: 0 });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][1]).toMatchObject({ eventType: 'STOCK_TAKE_DUE', subjectType: 'STOCK_TAKE', subjectId: '2026-10', dedupSuffix: '2026-10|farm-1', observedValue: 2 });
  });
  it('resolves, and raises nothing, once the take is posted or the period is closed', async () => {
    const posted = build([period('2026-10', '2026-10-26')], [[{ period_id: '2026-10' }]]);
    expect(await posted.service.evaluateStockTakeDue(ctx, NOW)).toEqual({ raised: 0, resolved: 1 });
    expect(posted.raise).not.toHaveBeenCalled();
    expect(posted.resolve).toHaveBeenCalledWith({ companyId: 'co-1', tenantId: 't1' }, 'STOCK_TAKE_DUE', ['2026-10|farm-1'], 'RECOVERED', NOW);
    const closed = build([period('2026-10', '2026-10-26', { period_status: 'CLOSED' })], [[]]);
    expect(await closed.service.evaluateStockTakeDue(ctx, NOW)).toEqual({ raised: 0, resolved: 1 });
  });
});

describe('CHANGEOVER and AUTO_DRAFTED after a requisition submit (checkpoint 5, Req. row 80)', () => {
  const make = () => {
    const feedAlerts = { raiseEventSafely: jest.fn(async () => undefined), resolveEvent: jest.fn(async () => undefined) };
    const service: any = Object.create(FeedRequisitionService.prototype);
    service.feedAlerts = feedAlerts;
    service.logger = { warn: jest.fn() };
    return { service, feedAlerts };
  };
  const ctx = { farmId: 'farm-1', companyId: 'co-1', tenantId: 't1' };

  it('raises a CHANGEOVER per line whose changeover_warning is set, one per requisition and silo, and closes AUTO_DRAFTED', async () => {
    const { service, feedAlerts } = make();
    const view = { req_no: 'REQ-1', lines: [
      { destination_location_id: 'silo-1', destination_code: 'SILO-1', item_id: 'feed-b', changeover_warning: "Silo 'SILO-1' still holds 500 of 'FEED-A'." },
      { destination_location_id: 'silo-2', destination_code: 'SILO-2', item_id: 'feed-b', changeover_warning: null },
    ] };
    await service.afterSubmitAlerts(view, 'req-1', ctx);
    expect(feedAlerts.resolveEvent).toHaveBeenCalledWith({ companyId: 'co-1', tenantId: 't1' }, 'AUTO_DRAFTED', ['req-1'], 'CLOSED');
    expect(feedAlerts.raiseEventSafely).toHaveBeenCalledTimes(1);
    expect(feedAlerts.raiseEventSafely).toHaveBeenCalledWith(ctx, expect.objectContaining({
      eventType: 'CHANGEOVER', subjectType: 'REQUISITION', subjectId: 'req-1', dedupSuffix: 'req-1|silo-1', itemId: 'feed-b',
      message: expect.stringContaining('still holds 500'),
    }));
  });
  it('raises nothing when no line carries a warning', async () => {
    const { service, feedAlerts } = make();
    await service.afterSubmitAlerts({ req_no: 'REQ-1', lines: [{ destination_location_id: 'silo-2', changeover_warning: null }] }, 'req-1', ctx);
    expect(feedAlerts.raiseEventSafely).not.toHaveBeenCalled();
  });
});

describe('CHANGEOVER resolution by the evaluator', () => {
  const build = (silo: { item_id: string; on_hand_qty: number } | null, reqStatus = 'PENDING_APPROVAL') => {
    const alert = { alert_id: 'a1', dedup_key: 'rule-CHANGEOVER|req-1|silo-1', subject_id: 'req-1', item_id: 'feed-b' };
    const queues: any[][] = [[alert], [{ status: reqStatus }]];
    const updates: any[] = [];
    const db: any = {
      select: jest.fn(() => {
        const result = queues.shift() ?? [];
        const chain: any = {};
        for (const m of ['from', 'where', 'limit']) chain[m] = () => chain;
        chain.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
        return chain;
      }),
      update: jest.fn(() => ({ set: jest.fn((v: any) => ({ where: jest.fn(async () => { updates.push(v); }) })) })),
    };
    const siloFeed: any = { currentItems: jest.fn(async () => new Map([['silo-1', silo]])) };
    const service = new FeedAlertService(transactionCls(db), {} as any, siloFeed, {} as any);
    return { service, updates };
  };
  it('stays open while the silo still holds the old item', async () => {
    const { service, updates } = build({ item_id: 'feed-a', on_hand_qty: 500 });
    await (service as any).resolveClearedChangeovers('farm-1', 'co-1', 't1', NOW);
    expect(updates).toEqual([]);
  });
  it('resolves when the silo is empty or already holds the next item', async () => {
    for (const silo of [null, { item_id: 'feed-a', on_hand_qty: 0 }, { item_id: 'feed-b', on_hand_qty: 900 }]) {
      const { service, updates } = build(silo);
      await (service as any).resolveClearedChangeovers('farm-1', 'co-1', 't1', NOW);
      expect(updates).toEqual([expect.objectContaining({ status: 'RESOLVED', active_key: null, resolved_reason: 'RECOVERED' })]);
    }
  });
  it('closes when the requisition was rejected', async () => {
    const { service, updates } = build({ item_id: 'feed-a', on_hand_qty: 500 }, 'REJECTED');
    await (service as any).resolveClearedChangeovers('farm-1', 'co-1', 't1', NOW);
    expect(updates).toEqual([expect.objectContaining({ resolved_reason: 'CLOSED' })]);
  });
});

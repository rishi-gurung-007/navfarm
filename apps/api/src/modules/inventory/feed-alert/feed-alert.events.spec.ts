import { transactionCls } from '../../../test-utils/transaction-cls';
import { asBatchPk, type DietChange } from '../feed-forecast/feed-forecast.engine';
import { AlertRuleFact, ActiveAlertFact, PlanAlertsInput, planAlerts } from './feed-alert.rules';
import { FeedAlertService } from './feed-alert.service';

// W4G1 (11 Oct): the six new alert events — workbook-100-gaps A9. One raise / dedupe / resolve test each.
const NOW = Date.UTC(2026, 9, 11, 8, 0, 0);
const rule = (eventType: string, extra: Partial<AlertRuleFact> = {}): AlertRuleFact => ({
  ruleId: `rule-${eventType}`, notificationCode: eventType, eventType, thresholdReference: 'FIXED_VALUE', thresholdValue: 7, priorityLevel: 'WARNING',
  recipientRoles: ['FARM_MANAGER'], frequency: 'ONCE', escalationAfterHours: null, escalationRole: null, farmId: null, isActive: true, ...extra,
});
const base = (over: Partial<PlanAlertsInput>): PlanAlertsInput => ({
  today: '2026-10-11', nowMs: NOW, farmId: 'farm-1', rules: [], silos: [], dietChanges: [], requisitions: [], active: [], levelsOnly: false, ...over,
});
const open = (r: AlertRuleFact, dedupKey: string): ActiveAlertFact => ({
  alertId: 'a1', ruleId: r.ruleId, eventType: r.eventType, subjectType: 'BATCH', dedupKey, raisedAtMs: NOW - 3_600_000,
  lastNotifiedDay: '2026-10-11', acknowledged: false, escalated: false, observedValue: 3,
});

describe('NO_NEXT_FEED_ROW (checkpoint 8) — evaluated from the forecast', () => {
  const r = rule('NO_NEXT_FEED_ROW');
  const batch = asBatchPk('batch-1');
  const gap = (date: string) => ({ batchId: batch, batchNo: 'GRS-B1', stageCode: 'GROWER', date });
  const key = 'rule-NO_NEXT_FEED_ROW|batch-1|GROWER';

  it('raises one alert per batch and stage, dated by the first day without a row, inside the window', () => {
    const plan = planAlerts(base({ rules: [r], feedRowGaps: [gap('2026-10-16'), gap('2026-10-14'), { ...gap('2026-10-30') , stageCode: 'FINISHER' }] }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ dedupKey: key, subjectType: 'BATCH', subjectId: 'batch-1', observedValue: 3 });
    expect(plan.raise[0].title).toBe('No next feed row: GRS-B1');
  });
  it('does not raise a second time while it is open', () => {
    expect(planAlerts(base({ rules: [r], feedRowGaps: [gap('2026-10-14')], active: [open(r, key)] }))).toEqual({ raise: [], renotify: [], escalate: [], resolve: [] });
  });
  it('resolves once the next row exists (the gap is gone)', () => {
    expect(planAlerts(base({ rules: [r], feedRowGaps: [], active: [open(r, key)] })).resolve).toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
  });
});

describe('NEXT_DIET_NO_SILO (checkpoint 9) — evaluated from the forecast', () => {
  const r = rule('NEXT_DIET_NO_SILO');
  const change = (over: Partial<DietChange> = {}): DietChange => ({
    batchId: 'batch-1:g', realBatchId: asBatchPk('batch-1'), batchNo: 'GRS-B1', shedCode: 'GRS/SHED-1', fromItemId: 'i1', fromItemName: 'Starter',
    toItemId: 'i2', toItemName: 'Grower', changeDate: '2026-10-15', nextSourceType: 'NONE', nextSourceCode: null, ...over,
  });
  const key = 'rule-NEXT_DIET_NO_SILO|batch-1:g|i2|2026-10-15';

  it('raises when the next diet has nowhere to be fed from, or no silo holds it in a shed with silos', () => {
    const none = planAlerts(base({ rules: [r], dietChanges: [change()] }));
    expect(none.raise[0]).toMatchObject({ dedupKey: key, subjectType: 'BATCH', subjectId: 'batch-1', itemId: 'i2' });
    expect(none.raise[0].message).toContain('no silo at GRS/SHED-1 holds that feed type');
    const store = planAlerts(base({ rules: [r], dietChanges: [change({ nextSourceType: 'STORE' })], noSiloHolds: ['GRS/SHED-1|Grower'] }));
    expect(store.raise).toHaveLength(1);
  });
  it('stays quiet when a silo will feed it, or the shed simply has no silos', () => {
    expect(planAlerts(base({ rules: [r], dietChanges: [change({ nextSourceType: 'SILO', nextSourceCode: 'S1' })] })).raise).toEqual([]);
    expect(planAlerts(base({ rules: [r], dietChanges: [change({ nextSourceType: 'STORE' })] })).raise).toEqual([]);
  });
  it('does not raise again while open, and resolves when a silo now holds the feed', () => {
    expect(planAlerts(base({ rules: [r], dietChanges: [change()], active: [open(r, key)] })).raise).toEqual([]);
    expect(planAlerts(base({ rules: [r], dietChanges: [change({ nextSourceType: 'SILO', nextSourceCode: 'S1' })], active: [open(r, key)] })).resolve)
      .toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
  });
});

describe('pushed events are left alone by the evaluator', () => {
  it('never resolves an open MILL_DISPATCH, MILL_ADJUSTED, RECEIPT_VARIANCE or CAPACITY_EXCEEDED alert', () => {
    const active = ['MILL_DISPATCH', 'MILL_ADJUSTED', 'RECEIPT_VARIANCE', 'CAPACITY_EXCEEDED'].map((e, i) => ({ ...open(rule(e), `k${i}`), alertId: `a${i}`, subjectType: 'LOADING_SHEET' as const }));
    expect(planAlerts(base({ rules: [], active })).resolve).toEqual([]);
  });
});

describe('FeedAlertService pushed events — MILL_DISPATCH, MILL_ADJUSTED, RECEIPT_VARIANCE, CAPACITY_EXCEEDED', () => {
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
    return { service, inserted, updates, db, alertRules };
  };
  const ctx = { farmId: 'farm-1', companyId: 'co-1', tenantId: 't1' };
  const cases: Array<[string, string, string, string[]]> = [
    ['MILL_DISPATCH', 'LOADING_SHEET', 'ls-1', ['FARM_MANAGER']],
    ['MILL_ADJUSTED', 'CONSOLIDATION', 'cons-1', ['FARM_MANAGER']],
    ['RECEIPT_VARIANCE', 'RECEIPT', 'rc-1', ['HEAD_OF_FARM', 'MILL_MANAGER']],
    ['CAPACITY_EXCEEDED', 'DIET_DATE', 'item-8', ['MILL_MANAGER']],
  ];

  describe.each(cases)('%s', (eventType, subjectType, subjectId, roles) => {
    const r = rule(eventType, { recipientRoles: roles });
    it('raises one in-app alert per active rule, on the farm and company, to the rule\'s roles', async () => {
      const { service, inserted, alertRules } = build([r, rule(eventType, { ruleId: 'off', isActive: false }), rule('FEED_ABOVE')]);
      const out = await service.raiseEvent(ctx, { eventType: eventType as any, subjectType: subjectType as any, subjectId, title: 'T', message: 'M' }, NOW);
      expect(out).toEqual({ rules: 1, raised: 1 });
      expect(alertRules.ensureDefaultRules).toHaveBeenCalledWith('co-1', 't1');
      expect(inserted[0]).toMatchObject({
        tenant_id: 't1', company_id: 'co-1', farm_id: 'farm-1', event_type: eventType, subject_type: subjectType, subject_id: subjectId,
        dedup_key: `rule-${eventType}|${subjectId}`, active_key: `rule-${eventType}|${subjectId}`, status: 'ACTIVE', recipient_roles: roles,
      });
    });
    it('deduplicates: an open alert for the same subject (duplicate active_key) raises nothing and does not fail', async () => {
      const { service, db } = build([r]);
      db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw Object.assign(new Error('Failed query'), { cause: { code: 'ER_DUP_ENTRY' } }); }) }));
      expect(await service.raiseEvent(ctx, { eventType: eventType as any, subjectType: subjectType as any, subjectId, title: 'T', message: 'M' })).toEqual({ rules: 1, raised: 0 });
    });
    it('raises nothing for a company with no active rule, and the Safely form never throws', async () => {
      const none = build([]);
      expect(await none.service.raiseEvent(ctx, { eventType: eventType as any, subjectType: subjectType as any, subjectId, title: 'T', message: 'M' })).toEqual({ rules: 0, raised: 0 });
      const broken = build([r]);
      broken.db.insert.mockImplementationOnce(() => ({ values: jest.fn(async () => { throw new Error('disk full'); }) }));
      jest.spyOn((broken.service as any).logger, 'warn').mockImplementation(() => undefined);
      await expect(broken.service.raiseEventSafely(ctx, { eventType: eventType as any, subjectType: subjectType as any, subjectId, title: 'T', message: 'M' })).resolves.toBeUndefined();
    });
  });

  it('CAPACITY_EXCEEDED resolves when the condition clears, and only for the suffixes named', async () => {
    const { service, updates, db } = build([]);
    await service.resolveEvent({ companyId: 'co-1', tenantId: 't1' }, 'CAPACITY_EXCEEDED', ['item-8|2026-10-11'], 'RECOVERED', NOW);
    expect(updates).toEqual([expect.objectContaining({ status: 'RESOLVED', active_key: null, resolved_reason: 'RECOVERED', resolved_at: '2026-10-11 08:00:00' })]);
    await service.resolveEvent({ companyId: 'co-1', tenantId: 't1' }, 'CAPACITY_EXCEEDED', []);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('on an empty rule table, raising MILL_DISPATCH seeds the default rule first and then raises the alert (raiseEvent and raiseEventSafely)', async () => {
    for (const safe of [false, true]) {
      const table: AlertRuleFact[] = [];
      const inserted: any[] = [];
      const db: any = { insert: jest.fn(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) })) };
      const alertRules: any = { ensureDefaultRules: jest.fn(async () => { table.push(rule('MILL_DISPATCH', { notificationCode: 'MILL-DISPATCH' })); }) };
      const service = new FeedAlertService(transactionCls(db), {} as any, {} as any, alertRules);
      jest.spyOn(service as any, 'loadRules').mockImplementation(async () => [...table]);
      const args = [ctx, { eventType: 'MILL_DISPATCH', subjectType: 'LOADING_SHEET', subjectId: 'ls-1', title: 'T', message: 'M' }, NOW] as const;
      if (safe) await service.raiseEventSafely(...(args as any)); else expect(await service.raiseEvent(...(args as any))).toEqual({ rules: 1, raised: 1 });
      expect(alertRules.ensureDefaultRules).toHaveBeenCalledWith('co-1', 't1');
      expect(table).toHaveLength(1);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ event_type: 'MILL_DISPATCH', notification_code: 'MILL-DISPATCH', subject_id: 'ls-1', status: 'ACTIVE' });
    }
  });
});

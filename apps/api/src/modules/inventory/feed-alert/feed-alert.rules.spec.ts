import { ActiveAlertFact, AlertRuleFact, PlanAlertsInput, SiloLevelFact, planAlerts } from './feed-alert.rules';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

const lowRule: AlertRuleFact = {
  ruleId: 'rule-low', notificationCode: 'FEED-BELOW-L1', eventType: 'FEED_BELOW_L1', thresholdReference: 'SILO_BELOW', thresholdValue: null,
  priorityLevel: 'CRITICAL_FIRST_PRIORITY', recipientRoles: ['FARM_MANAGER'], frequency: 'ESCALATING', escalationAfterHours: 4,
  escalationRole: 'HEAD_OF_FARM', farmId: null, isActive: true,
};
const aboveRule: AlertRuleFact = { ...lowRule, ruleId: 'rule-above', notificationCode: 'FEED-ABOVE', eventType: 'FEED_ABOVE', thresholdReference: 'SILO_ABOVE', priorityLevel: 'INFO', frequency: 'ONCE', escalationAfterHours: null, escalationRole: null };
const dietRule: AlertRuleFact = { ...aboveRule, ruleId: 'rule-diet', notificationCode: 'DIET-CHANGE', eventType: 'DIET_CHANGE', thresholdReference: 'FIXED_VALUE', thresholdValue: 3, priorityLevel: 'WARNING' };
const reminderRule: AlertRuleFact = { ...aboveRule, ruleId: 'rule-remind', notificationCode: 'REQ-REMINDER', eventType: 'REQ_DEADLINE', thresholdReference: 'FIXED_VALUE', thresholdValue: 1, priorityLevel: 'WARNING' };
const overdueRule: AlertRuleFact = { ...reminderRule, ruleId: 'rule-overdue', notificationCode: 'REQ-OVERDUE', thresholdValue: 0, priorityLevel: 'CRITICAL', recipientRoles: ['FARM_MANAGER', 'HEAD_OF_FARM'] };

// Master Setup §1 column F: SILO1 low 1,000 KG, high 10,800 KG, capacity 12,000.
const silo1 = (balanceKg: number, extra: Partial<SiloLevelFact> = {}): SiloLevelFact => ({
  siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', itemName: 'Weaner Diet R1', balanceKg, lowLevelKg: 1000, highLevelKg: 10800, ...extra,
});
const active = (extra: Partial<ActiveAlertFact>): ActiveAlertFact => ({
  alertId: 'a1', ruleId: 'rule-low', eventType: 'FEED_BELOW_L1', subjectType: 'SILO', dedupKey: 'rule-low|s1',
  raisedAtMs: NOW - HOUR, lastNotifiedDay: '2026-09-23', acknowledged: false, escalated: false, observedValue: 900, ...extra,
});
const base = (over: Partial<PlanAlertsInput>): PlanAlertsInput => ({
  today: '2026-09-23', nowMs: NOW, farmId: 'farm-grs', rules: [lowRule, aboveRule], silos: [], dietChanges: [],
  requisitions: [], active: [], levelsOnly: false, ...over,
});

describe('planAlerts — silo levels (checkpoints 11–13)', () => {
  it('raises FEED_BELOW_L1 at exactly the low level', () => {
    const plan = planAlerts(base({ silos: [silo1(1000)] }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ dedupKey: 'rule-low|s1', subjectType: 'SILO', subjectId: 's1', itemId: 'r1', observedValue: 1000, thresholdValue: 1000 });
    expect(plan.raise[0].title).toBe('Low feed: GRS/SILO-001');
    expect(plan.raise[0].message).toBe('GRS/SILO-001 holds 1,000 kg of Weaner Diet R1 — at or below its low level of 1,000 kg.');
  });

  it('does not raise a second alert while one is active (deduplicate until recovery)', () => {
    const plan = planAlerts(base({ silos: [silo1(900)], active: [active({})] }));
    expect(plan).toEqual({ raise: [], renotify: [], escalate: [], resolve: [] });
  });

  it('resolves when the balance rises above the low level — 900 → 6,900 kg after a 6,000 kg receipt', () => {
    const plan = planAlerts(base({ silos: [silo1(6900)], active: [active({})] }));
    expect(plan.resolve).toEqual([{ alertId: 'a1', reason: 'RECOVERED' }]);
    expect(plan.raise).toEqual([]);
  });

  it('re-arms: after recovery a later downward crossing raises a new alert', () => {
    expect(planAlerts(base({ silos: [silo1(800)], active: [] })).raise).toHaveLength(1);
  });

  it('raises FEED_ABOVE at or above the high level, as INFO', () => {
    const plan = planAlerts(base({ silos: [silo1(10800)] }));
    expect(plan.raise.map((c) => c.rule.notificationCode)).toEqual(['FEED-ABOVE']);
    expect(plan.raise[0].message).toContain('Do not order.');
  });

  it('skips a silo without a level for SILO_BELOW, and uses a FIXED_VALUE instead when the rule says so', () => {
    expect(planAlerts(base({ silos: [silo1(10, { lowLevelKg: null })] })).raise).toEqual([]);
    const fixed = { ...lowRule, thresholdReference: 'FIXED_VALUE', thresholdValue: 500 };
    expect(planAlerts(base({ rules: [fixed], silos: [silo1(500, { lowLevelKg: null })] })).raise[0].thresholdValue).toBe(500);
  });

  it('alerts an empty silo with a low level set (Q7)', () => {
    const plan = planAlerts(base({ silos: [silo1(0, { itemId: null, itemName: null })] }));
    expect(plan.raise[0].message).toBe('GRS/SILO-001 holds 0 kg of no feed — at or below its low level of 1,000 kg.');
  });

  it('honours the farm filter and resolves the alerts of a deactivated rule', () => {
    expect(planAlerts(base({ rules: [{ ...lowRule, farmId: 'farm-other' }], silos: [silo1(10)] })).raise).toEqual([]);
    const plan = planAlerts(base({ rules: [{ ...lowRule, isActive: false }], silos: [silo1(10)], active: [active({})] }));
    expect(plan.resolve).toEqual([{ alertId: 'a1', reason: 'RULE_OFF' }]);
  });
});

describe('planAlerts — frequency (Master Setup §4 rows 52–54)', () => {
  it('ESCALATING: escalates to HEAD_OF_FARM once 4 hours pass unacknowledged', () => {
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 4 * HOUR })] })).escalate)
      .toEqual([{ alertId: 'a1', role: 'HEAD_OF_FARM' }]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 3 * HOUR })] })).escalate).toEqual([]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 5 * HOUR, acknowledged: true })] })).escalate).toEqual([]);
    expect(planAlerts(base({ silos: [silo1(900)], active: [active({ raisedAtMs: NOW - 5 * HOUR, escalated: true })] })).escalate).toEqual([]);
  });

  it('DAILY: re-notifies once a day while the condition holds', () => {
    const daily = { ...lowRule, frequency: 'DAILY' as const };
    expect(planAlerts(base({ rules: [daily], silos: [silo1(900)], active: [active({ lastNotifiedDay: '2026-09-22' })] })).renotify)
      .toEqual([{ alertId: 'a1', observedValue: 900 }]);
    expect(planAlerts(base({ rules: [daily], silos: [silo1(900)], active: [active({})] })).renotify).toEqual([]);
  });

  it('ON_EACH_OCCURRENCE: re-notifies when the observed value changes', () => {
    const each = { ...lowRule, frequency: 'ON_EACH_OCCURRENCE' as const };
    expect(planAlerts(base({ rules: [each], silos: [silo1(700)], active: [active({ observedValue: 900 })] })).renotify)
      .toEqual([{ alertId: 'a1', observedValue: 700 }]);
    expect(planAlerts(base({ rules: [each], silos: [silo1(900)], active: [active({ observedValue: 900 })] })).renotify).toEqual([]);
  });
});

describe('planAlerts — diet change (checkpoint 30)', () => {
  const change = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', fromItemId: 'r1', fromItemName: 'Weaner Diet R1',
    toItemId: 'r2', toItemName: 'Weaner Diet R2', changeDate: '2026-09-26', nextSourceType: 'SILO' as const, nextSourceCode: 'GRS/SILO-002',
  };

  it('warns 3 days before, naming the next diet, the days left and its silo', () => {
    const plan = planAlerts(base({ rules: [dietRule], dietChanges: [change] }));
    expect(plan.raise).toHaveLength(1);
    expect(plan.raise[0]).toMatchObject({ subjectType: 'BATCH', subjectId: 'b', itemId: 'r2', observedValue: 3, dedupKey: 'rule-diet|b|r2|2026-09-26' });
    expect(plan.raise[0].message).toBe('WG-2026-38 in GRS/SHED-003 moves from Weaner Diet R1 to Weaner Diet R2 on 2026-09-26, in 3 days. Silo for the next diet: GRS/SILO-002.');
  });

  it('says so when no silo holds the next diet', () => {
    const plan = planAlerts(base({ rules: [dietRule], dietChanges: [{ ...change, nextSourceType: 'STORE', nextSourceCode: null }] }));
    expect(plan.raise[0].message).toContain('Silo for the next diet: none holds it yet.');
  });

  it('stays quiet 4 days out and resolves once the change has passed', () => {
    expect(planAlerts(base({ rules: [dietRule], dietChanges: [{ ...change, changeDate: '2026-09-27' }] })).raise).toEqual([]);
    const passed = active({ alertId: 'd1', ruleId: 'rule-diet', eventType: 'DIET_CHANGE', subjectType: 'BATCH', dedupKey: 'rule-diet|b|r2|2026-09-22' });
    expect(planAlerts(base({ rules: [dietRule], active: [passed] })).resolve).toEqual([{ alertId: 'd1', reason: 'PASSED' }]);
  });
});

describe('planAlerts — requisition deadline (checkpoint 20)', () => {
  const draft = { requisitionId: 'req-1', reqNo: 'REQ-GRS-2026-00041', status: 'AUTO_DRAFT', submissionDeadline: '2026-09-26' };

  it('Friday reminder one day before, Saturday CRITICAL on the day', () => {
    const friday = planAlerts(base({ today: '2026-09-25', rules: [reminderRule, overdueRule], requisitions: [draft] }));
    expect(friday.raise.map((c) => c.rule.notificationCode)).toEqual(['REQ-REMINDER']);
    expect(friday.raise[0].message).toBe('REQ-GRS-2026-00041 is AUTO_DRAFT; the submission deadline is 2026-09-26, 1 day left.');
    const saturday = planAlerts(base({ today: '2026-09-26', rules: [reminderRule, overdueRule], requisitions: [draft] }));
    expect(saturday.raise.map((c) => c.rule.notificationCode).sort()).toEqual(['REQ-OVERDUE', 'REQ-REMINDER']);
  });

  it('says nothing on Thursday, and closes the alert once the requisition is approved', () => {
    expect(planAlerts(base({ today: '2026-09-24', rules: [reminderRule], requisitions: [draft] })).raise).toEqual([]);
    const open = active({ alertId: 'q1', ruleId: 'rule-remind', eventType: 'REQ_DEADLINE', subjectType: 'REQUISITION', dedupKey: 'rule-remind|req-1' });
    expect(planAlerts(base({ today: '2026-09-25', rules: [reminderRule], requisitions: [], active: [open] })).resolve)
      .toEqual([{ alertId: 'q1', reason: 'CLOSED' }]);
  });
});

describe('planAlerts — levelsOnly (evaluation after a stock posting)', () => {
  it('evaluates silo rules only and leaves other open alerts alone', () => {
    const openDiet = active({ alertId: 'd1', ruleId: 'rule-diet', eventType: 'DIET_CHANGE', subjectType: 'BATCH', dedupKey: 'rule-diet|b|r2|2026-09-26' });
    const plan = planAlerts(base({ levelsOnly: true, rules: [lowRule, dietRule], silos: [silo1(900)], active: [openDiet] }));
    expect(plan.raise.map((c) => c.rule.eventType)).toEqual(['FEED_BELOW_L1']);
    expect(plan.resolve).toEqual([]);
  });
});

import { alertRuleProblems, AlertRuleShape } from './alert-rule.rules';

const lowRule: AlertRuleShape = {
  event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', threshold_value: null,
  priority_level: 'CRITICAL_FIRST_PRIORITY', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP',
  frequency: 'ESCALATING', escalation_after_hours: 4, escalation_role: 'HEAD_OF_FARM',
};

describe('alertRuleProblems — Master Setup §4', () => {
  it('accepts the workbook FEED-BELOW-L1 example (rows 43–56, column F)', () => {
    expect(alertRuleProblems(lowRule)).toEqual([]);
  });
  it('refuses an event Plan B does not evaluate yet', () => {
    expect(alertRuleProblems({ ...lowRule, event_type: 'MILL_DISPATCH' })).toContain('Event type MILL_DISPATCH is not evaluated yet.');
  });
  it('ties the trigger entity to the event', () => {
    expect(alertRuleProblems({ ...lowRule, trigger_entity: 'REQUISITION' })).toContain('FEED_BELOW_L1 is triggered by SILO, not REQUISITION.');
  });
  it('only lets a low rule read the silo low level, and needs a value for FIXED_VALUE', () => {
    expect(alertRuleProblems({ ...lowRule, threshold_reference: 'SILO_ABOVE' })).toContain('FEED_BELOW_L1 takes its threshold from SILO_BELOW or FIXED_VALUE.');
    expect(alertRuleProblems({ ...lowRule, threshold_reference: 'FIXED_VALUE', threshold_value: null })).toContain('A FIXED_VALUE rule needs a threshold value of 0 or more.');
    expect(alertRuleProblems({ ...lowRule, event_type: 'DIET_CHANGE', trigger_entity: 'FEED_PLAN', threshold_reference: 'SILO_BELOW' }))
      .toContain('DIET_CHANGE takes its threshold from FIXED_VALUE.');
  });
  it('needs at least one well-formed recipient role code', () => {
    expect(alertRuleProblems({ ...lowRule, recipient_roles: [] })).toContain('Name at least one recipient role.');
    expect(alertRuleProblems({ ...lowRule, recipient_roles: ['farm manager'] })).toContain("Role code 'farm manager' must be upper-case letters, digits and underscores.");
  });
  it('builds only the in-app channel (Q12)', () => {
    expect(alertRuleProblems({ ...lowRule, delivery_channel: 'EMAIL' })).toContain('Only IN_APP delivery is built; EMAIL is not sent yet.');
  });
  it('needs hours and a role for ESCALATING (rows 53–54)', () => {
    expect(alertRuleProblems({ ...lowRule, escalation_after_hours: null })).toContain('An ESCALATING rule needs Escalation After Hours of 1 or more.');
    expect(alertRuleProblems({ ...lowRule, escalation_role: null })).toContain('An ESCALATING rule needs an Escalation Recipient Role.');
  });
});

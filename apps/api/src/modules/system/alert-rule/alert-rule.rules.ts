/**
 * Shape rules of an Alerts and Notifications Master row (feed workbook,
 * Master Setup §4). Pure so the form, the service and the evaluator agree on
 * one list of events and what each may reference.
 */
export const EVENT_TYPES = ['FEED_BELOW_L1', 'FEED_ABOVE', 'DIET_CHANGE', 'REQ_DEADLINE'] as const;
export type AlertEventType = (typeof EVENT_TYPES)[number];

/** §4 row 46: "SILO or REQUISITION or FEED_PLAN or STOCK_TAKE". */
export const TRIGGER_ENTITIES = ['SILO', 'REQUISITION', 'FEED_PLAN', 'STOCK_TAKE'] as const;
export const TRIGGER_FOR_EVENT: Record<AlertEventType, string> = {
  FEED_BELOW_L1: 'SILO',
  FEED_ABOVE: 'SILO',
  DIET_CHANGE: 'FEED_PLAN',
  REQ_DEADLINE: 'REQUISITION',
};

/** §4 row 48. SILO_BELOW reads location_master.low_level_kg, SILO_ABOVE high_level_kg. */
export const THRESHOLD_REFERENCES = ['SILO_BELOW', 'SILO_ABOVE', 'FIXED_VALUE'] as const;
const REFERENCES_FOR_EVENT: Record<AlertEventType, string[]> = {
  FEED_BELOW_L1: ['SILO_BELOW', 'FIXED_VALUE'],
  FEED_ABOVE: ['SILO_ABOVE', 'FIXED_VALUE'],
  DIET_CHANGE: ['FIXED_VALUE'],
  REQ_DEADLINE: ['FIXED_VALUE'],
};

/** §4 row 49. */
export const PRIORITY_LEVELS = ['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING', 'INFO'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
/** §4 row 51 lists IN_APP, EMAIL, SMS; Plan B delivers in-app only (Q12). */
export const DELIVERY_CHANNELS = ['IN_APP'] as const;
/** §4 row 52. */
export const FREQUENCIES = ['ONCE', 'DAILY', 'ON_EACH_OCCURRENCE', 'ESCALATING'] as const;
export type AlertFrequency = (typeof FREQUENCIES)[number];

const ROLE_CODE = /^[A-Z][A-Z0-9_]{0,49}$/;

export interface AlertRuleShape {
  event_type: string;
  trigger_entity: string;
  threshold_reference: string;
  threshold_value?: number | null;
  priority_level: string;
  recipient_roles: string[];
  delivery_channel: string;
  frequency: string;
  escalation_after_hours?: number | null;
  escalation_role?: string | null;
}

export function alertRuleProblems(rule: AlertRuleShape): string[] {
  const problems: string[] = [];
  if (!(EVENT_TYPES as readonly string[]).includes(rule.event_type)) {
    problems.push(`Event type ${rule.event_type} is not evaluated yet.`);
    return problems;
  }
  const event = rule.event_type as AlertEventType;
  if (rule.trigger_entity !== TRIGGER_FOR_EVENT[event]) {
    problems.push(`${event} is triggered by ${TRIGGER_FOR_EVENT[event]}, not ${rule.trigger_entity}.`);
  }
  if (!REFERENCES_FOR_EVENT[event].includes(rule.threshold_reference)) {
    problems.push(`${event} takes its threshold from ${REFERENCES_FOR_EVENT[event].join(' or ')}.`);
  }
  if (rule.threshold_reference === 'FIXED_VALUE' && (rule.threshold_value == null || rule.threshold_value < 0)) {
    problems.push('A FIXED_VALUE rule needs a threshold value of 0 or more.');
  }
  if (!(PRIORITY_LEVELS as readonly string[]).includes(rule.priority_level)) {
    problems.push(`Priority ${rule.priority_level} is not one of ${PRIORITY_LEVELS.join(', ')}.`);
  }
  if (!rule.recipient_roles?.length) problems.push('Name at least one recipient role.');
  for (const code of rule.recipient_roles ?? []) {
    if (!ROLE_CODE.test(code)) problems.push(`Role code '${code}' must be upper-case letters, digits and underscores.`);
  }
  if (!(DELIVERY_CHANNELS as readonly string[]).includes(rule.delivery_channel)) {
    problems.push(`Only IN_APP delivery is built; ${rule.delivery_channel} is not sent yet.`);
  }
  if (!(FREQUENCIES as readonly string[]).includes(rule.frequency)) {
    problems.push(`Frequency ${rule.frequency} is not one of ${FREQUENCIES.join(', ')}.`);
  }
  if (rule.frequency === 'ESCALATING') {
    if (rule.escalation_after_hours == null || rule.escalation_after_hours < 1) problems.push('An ESCALATING rule needs Escalation After Hours of 1 or more.');
    if (!rule.escalation_role) problems.push('An ESCALATING rule needs an Escalation Recipient Role.');
    else if (!ROLE_CODE.test(rule.escalation_role)) problems.push(`Role code '${rule.escalation_role}' must be upper-case letters, digits and underscores.`);
  }
  return problems;
}

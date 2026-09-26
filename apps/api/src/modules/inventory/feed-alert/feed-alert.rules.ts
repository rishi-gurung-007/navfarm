/**
 * Feed alert planning — pure (Feed Forecast Plan B). Given the Alerts and
 * Notifications Master rows that apply to one farm, today's facts (silo
 * balances, diet changes, open feed requisitions) and the alerts already
 * open, return what to raise, re-notify, escalate and resolve. The service
 * (Task 7) only loads facts and writes this plan, so every checkpoint below
 * is pinned by a unit test:
 * - 11: FEED_BELOW_L1 at or below the single low level; one open alert per
 *   rule and silo until recovery ("Only one low feed event applies per silo").
 * - 12: rising above resolves it (RECOVERED); a later fall raises a new one.
 * - 13: FEED_ABOVE at or above the high level, INFO.
 * - 30: DIET_CHANGE within the rule's days before a batch's next diet.
 * - 20: REQ_DEADLINE within the rule's days before (and after) the
 *   submission deadline while the requisition is unapproved.
 * Frequencies (§4 rows 52–54): ONCE until resolved; DAILY re-notifies on a
 * new day; ON_EACH_OCCURRENCE re-notifies when the observed value changes
 * (a new posting moved the balance); ESCALATING adds the escalation role
 * once, when unacknowledged for Escalation After Hours.
 *
 * Ruling L12: no new copy of calendar-date arithmetic — diffDaysIso is the
 * engine's diffDays, re-exported by feed-requisition.rules (Task 3).
 */
import type { DietChange } from '../feed-forecast/feed-forecast.engine';
import type { AlertFrequency, PriorityLevel } from '../../system/alert-rule/alert-rule.rules';
import { diffDaysIso } from '../../procurement/feed-requisition/feed-requisition.rules';

export const SILO_EVENTS: readonly string[] = ['FEED_BELOW_L1', 'FEED_ABOVE'];

export interface AlertRuleFact {
  ruleId: string;
  notificationCode: string;
  eventType: string;
  thresholdReference: string;
  thresholdValue: number | null;
  priorityLevel: PriorityLevel;
  recipientRoles: string[];
  frequency: AlertFrequency;
  escalationAfterHours: number | null;
  escalationRole: string | null;
  farmId: string | null;
  isActive: boolean;
}

export interface SiloLevelFact {
  siloId: string;
  siloCode: string;
  itemId: string | null;
  itemName: string | null;
  balanceKg: number;
  lowLevelKg: number | null;
  highLevelKg: number | null;
}

export interface OpenRequisitionFact {
  requisitionId: string;
  reqNo: string;
  status: string;
  submissionDeadline: string;
}

export interface ActiveAlertFact {
  alertId: string;
  ruleId: string;
  eventType: string;
  subjectType: 'SILO' | 'BATCH' | 'REQUISITION';
  dedupKey: string;
  raisedAtMs: number;
  lastNotifiedDay: string;
  acknowledged: boolean;
  escalated: boolean;
  observedValue: number | null;
}

export interface AlertCandidate {
  rule: AlertRuleFact;
  dedupKey: string;
  subjectType: 'SILO' | 'BATCH' | 'REQUISITION';
  subjectId: string;
  itemId: string | null;
  title: string;
  message: string;
  observedValue: number | null;
  thresholdValue: number | null;
}

export type ResolveReason = 'RECOVERED' | 'PASSED' | 'CLOSED' | 'RULE_OFF';

export interface AlertPlan {
  raise: AlertCandidate[];
  renotify: { alertId: string; observedValue: number | null }[];
  escalate: { alertId: string; role: string }[];
  resolve: { alertId: string; reason: ResolveReason }[];
}

export interface PlanAlertsInput {
  today: string;
  nowMs: number;
  farmId: string;
  rules: AlertRuleFact[];
  silos: SiloLevelFact[];
  dietChanges: DietChange[];
  requisitions: OpenRequisitionFact[];
  active: ActiveAlertFact[];
  levelsOnly: boolean;
}

const REASON_BY_EVENT: Record<string, ResolveReason> = {
  FEED_BELOW_L1: 'RECOVERED',
  FEED_ABOVE: 'RECOVERED',
  DIET_CHANGE: 'PASSED',
  REQ_DEADLINE: 'CLOSED',
};

const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** kg observed values come from float arithmetic upstream; compare at 3 decimals so a re-notify isn't fired by rounding noise. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function siloThreshold(rule: AlertRuleFact, silo: SiloLevelFact): number | null {
  if (rule.thresholdReference === 'FIXED_VALUE') return rule.thresholdValue;
  if (rule.eventType === 'FEED_BELOW_L1' && rule.thresholdReference === 'SILO_BELOW') return silo.lowLevelKg;
  if (rule.eventType === 'FEED_ABOVE' && rule.thresholdReference === 'SILO_ABOVE') return silo.highLevelKg;
  return null;
}

function candidatesFor(rule: AlertRuleFact, input: PlanAlertsInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  if (rule.eventType === 'FEED_BELOW_L1' || rule.eventType === 'FEED_ABOVE') {
    const low = rule.eventType === 'FEED_BELOW_L1';
    for (const silo of input.silos) {
      const threshold = siloThreshold(rule, silo);
      if (threshold === null) continue;
      if (low ? silo.balanceKg > threshold : silo.balanceKg < threshold) continue;
      const what = silo.itemName ?? 'no feed';
      out.push({
        rule, dedupKey: `${rule.ruleId}|${silo.siloId}`, subjectType: 'SILO', subjectId: silo.siloId, itemId: silo.itemId,
        title: low ? `Low feed: ${silo.siloCode}` : `Over-stock: ${silo.siloCode}`,
        message: low
          ? `${silo.siloCode} holds ${kg(silo.balanceKg)} kg of ${what} — at or below its low level of ${kg(threshold)} kg.`
          : `${silo.siloCode} holds ${kg(silo.balanceKg)} kg of ${what} — at or above its high level of ${kg(threshold)} kg. Do not order.`,
        observedValue: silo.balanceKg, thresholdValue: threshold,
      });
    }
  } else if (rule.eventType === 'DIET_CHANGE') {
    const window = rule.thresholdValue ?? 3;
    for (const dc of input.dietChanges) {
      const left = diffDaysIso(input.today, dc.changeDate);
      if (left < 0 || left > window) continue;
      const silo = dc.nextSourceType === 'SILO' && dc.nextSourceCode ? dc.nextSourceCode : 'none holds it yet';
      const whenDiet = left === 0 ? 'today' : `in ${days(left)}`;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${dc.batchId}|${dc.toItemId}|${dc.changeDate}`, subjectType: 'BATCH', subjectId: dc.batchId, itemId: dc.toItemId,
        title: `Diet change in ${days(left)}: ${dc.batchNo}`,
        message: `${dc.batchNo} in ${dc.shedCode} moves from ${dc.fromItemName} to ${dc.toItemName} on ${dc.changeDate}, ${whenDiet}. Silo for the next diet: ${silo}.`,
        observedValue: left, thresholdValue: window,
      });
    }
  } else if (rule.eventType === 'REQ_DEADLINE') {
    // The reminder window (thresholdValue > 0) means "N days before": it fires strictly ahead of the
    // deadline and steps aside once the deadline day arrives, so the overdue rule (thresholdValue 0,
    // matching on-or-past the deadline) is what stays open from that day on — no double-firing.
    const window = rule.thresholdValue ?? 0;
    for (const req of input.requisitions) {
      const left = diffDaysIso(input.today, req.submissionDeadline);
      const matches = window > 0 ? left > 0 && left <= window : left <= window;
      if (!matches) continue;
      const when = left === 0 ? 'today' : left > 0 ? `${days(left)} left` : `${days(-left)} past`;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${req.requisitionId}`, subjectType: 'REQUISITION', subjectId: req.requisitionId, itemId: null,
        title: `Requisition ${req.reqNo} not approved`,
        message: `${req.reqNo} is ${req.status}; the submission deadline is ${req.submissionDeadline}, ${when}.`,
        observedValue: left, thresholdValue: window,
      });
    }
  }
  return out;
}

export function planAlerts(input: PlanAlertsInput): AlertPlan {
  const plan: AlertPlan = { raise: [], renotify: [], escalate: [], resolve: [] };
  const rules = input.rules.filter(
    (r) => r.isActive && (r.farmId === null || r.farmId === input.farmId) && (!input.levelsOnly || SILO_EVENTS.includes(r.eventType)),
  );
  const activeByKey = new Map(input.active.map((a) => [a.dedupKey, a]));
  const wanted = new Set<string>();

  for (const rule of rules) {
    for (const c of candidatesFor(rule, input)) {
      if (wanted.has(c.dedupKey)) continue;
      wanted.add(c.dedupKey);
      const open = activeByKey.get(c.dedupKey);
      if (!open) {
        plan.raise.push(c);
        continue;
      }
      if (rule.frequency === 'DAILY' && open.lastNotifiedDay < input.today) {
        plan.renotify.push({ alertId: open.alertId, observedValue: c.observedValue });
      } else if (
        rule.frequency === 'ON_EACH_OCCURRENCE' &&
        (c.observedValue === null || open.observedValue === null ? c.observedValue !== open.observedValue : round3(c.observedValue) !== round3(open.observedValue))
      ) {
        plan.renotify.push({ alertId: open.alertId, observedValue: c.observedValue });
      } else if (
        rule.frequency === 'ESCALATING' && !open.acknowledged && !open.escalated && rule.escalationRole &&
        rule.escalationAfterHours !== null && input.nowMs - open.raisedAtMs >= rule.escalationAfterHours * 3_600_000
      ) {
        plan.escalate.push({ alertId: open.alertId, role: rule.escalationRole });
      }
    }
  }

  const liveRuleIds = new Set(rules.map((r) => r.ruleId));
  for (const open of input.active) {
    if (wanted.has(open.dedupKey)) continue;
    // After a stock posting only silo facts were loaded; anything else stays as it is until a full evaluation.
    if (input.levelsOnly && open.subjectType !== 'SILO') continue;
    plan.resolve.push({ alertId: open.alertId, reason: liveRuleIds.has(open.ruleId) ? REASON_BY_EVENT[open.eventType] ?? 'CLOSED' : 'RULE_OFF' });
  }
  return plan;
}

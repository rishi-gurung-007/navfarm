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
import { dayShort, type BatchPk, type DietChange } from '../feed-forecast/feed-forecast.engine';
import type { AlertFrequency, PriorityLevel } from '../../system/alert-rule/alert-rule.rules';
import { diffDaysIso } from '../../procurement/feed-requisition/feed-requisition.rules';

export const SILO_EVENTS: readonly string[] = ['FEED_BELOW_L1', 'FEED_ABOVE'];
/** W4G1: events read off the diet forecast; they sit out a pass whose forecast failed, with their open alerts. */
export const FORECAST_EVENTS: readonly string[] = ['DIET_CHANGE', 'NO_NEXT_FEED_ROW', 'NEXT_DIET_NO_SILO'];
/**
 * W5A: the three events read off the silo statuses (Engine rows 60-62). Like the forecast events they sit out a pass
 * whose statuses could not be computed, with their open alerts, and out of a levels-only pass.
 */
export const ORDER_EVENTS: readonly string[] = ['SHORTFALL', 'NOT_DRAFTED', 'TRUCK_TARGET'];
/** Look-ahead, in days, when a NO_NEXT_FEED_ROW or NEXT_DIET_NO_SILO rule carries no value (checkpoints 8, 9). */
export const DEFAULT_LOOKAHEAD_DAYS = 7;

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

/** One silo's order facts from the silo statuses (Engine rows 60-61). */
export interface SiloOrderFact {
  siloId: string;
  siloCode: string;
  itemId: string | null;
  itemName: string | null;
  projectedShortfallKg: number;
  recommendedOrderKg: number;
  /** Status of the farm's requisition covering this silo for the cycle; null = none drafted. */
  requisitionStatus: string | null;
}

export interface OrderFacts {
  silos: SiloOrderFact[];
  /** Sum of the recommended order across the farm's silos this cycle (Engine row 62). */
  farmTotalOrderKg: number;
  truckTargetKg: number;
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
  subjectType: 'SILO' | 'BATCH' | 'REQUISITION' | 'FARM' | 'STOCK_TAKE' | 'FEED_PLAN' | 'LOADING_SHEET' | 'CONSOLIDATION' | 'RECEIPT' | 'DIET_DATE';
  /** The silo, batch or requisition the alert is about. Optional for older callers; without it a SILO alert cannot be told apart from a recovery. */
  subjectId?: string;
  dedupKey: string;
  raisedAtMs: number;
  lastNotifiedDay: string;
  acknowledged: boolean;
  escalated: boolean;
  observedValue: number | null;
}

/**
 * What an alert is about. A BATCH subject must be a genuine batch_header PK:
 * feed_alert.subject_id is varchar(36), and the engine's composite stage-group
 * key (`<batch_id>:<stage_id>`, 73 chars) made the insert fail and DIET_CHANGE
 * alerts silently never raise (Task 9b fix round 1). Branded so passing the
 * composite fails tsc.
 */
export type AlertSubject =
  | { subjectType: 'SILO'; subjectId: string }
  | { subjectType: 'BATCH'; subjectId: BatchPk }
  | { subjectType: 'REQUISITION'; subjectId: string }
  | { subjectType: 'FARM'; subjectId: string };

export type AlertCandidate = AlertSubject & {
  rule: AlertRuleFact;
  dedupKey: string;
  itemId: string | null;
  title: string;
  message: string;
  observedValue: number | null;
  thresholdValue: number | null;
};

export type ResolveReason = 'RECOVERED' | 'PASSED' | 'CLOSED' | 'RULE_OFF' | 'SILO_INACTIVE' | 'SUPERSEDED' | 'APPROVED';

export interface AlertPlan {
  raise: AlertCandidate[];
  renotify: { alertId: string; observedValue: number | null }[];
  escalate: { alertId: string; role: string }[];
  resolve: { alertId: string; reason: ResolveReason }[];
}

/** Checkpoint 8: a batch whose current lifecycle feed row ends with no next row (the engine's NO_FEED_ROW flag, with the real batch). */
export interface FeedRowGapFact {
  batchId: BatchPk;
  batchNo: string;
  stageCode: string;
  /** The first day with no feed row. */
  date: string;
}

export interface PlanAlertsInput {
  today: string;
  nowMs: number;
  farmId: string;
  rules: AlertRuleFact[];
  silos: SiloLevelFact[];
  dietChanges: DietChange[];
  /** Checkpoint 8 facts, from the same forecast as dietChanges. */
  feedRowGaps?: FeedRowGapFact[];
  /** Checkpoint 9: `${shedCode}|${itemName}` of every shed with silos where no silo holds that item (the engine's NO_SILO_HOLDS_ITEM flags). */
  noSiloHolds?: string[];
  requisitions: OpenRequisitionFact[];
  /** W5A: Engine rows 60-62 facts. Undefined = not computed this pass (levels-only, or the statuses failed): those alerts stay as they are. */
  orderFacts?: OrderFacts;
  active: ActiveAlertFact[];
  levelsOnly: boolean;
  /** PLAN_AVAILABLE subjects (feed_plan ids) whose plan is now approved or superseded, with why. */
  closedPlans?: Record<string, 'SUPERSEDED' | 'APPROVED'>;
}

const REASON_BY_EVENT: Record<string, ResolveReason> = {
  FEED_BELOW_L1: 'RECOVERED',
  FEED_ABOVE: 'RECOVERED',
  DIET_CHANGE: 'PASSED',
  REQ_DEADLINE: 'CLOSED',
  NO_NEXT_FEED_ROW: 'RECOVERED',
  NEXT_DIET_NO_SILO: 'RECOVERED',
  SHORTFALL: 'RECOVERED',
  NOT_DRAFTED: 'RECOVERED',
  TRUCK_TARGET: 'RECOVERED',
};

const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
/** A requisition status in the words the farm uses (review A8: alert texts said "is AUTO_DRAFT"). */
const REQ_STATUS_WORDS: Record<string, string> = {
  AUTO_DRAFT: 'a draft', DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval',
};
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
          ? silo.itemName
            ? `${silo.siloCode} has ${kg(silo.balanceKg)} kg of ${silo.itemName}, at or below its low level of ${kg(threshold)} kg.`
            : `${silo.siloCode} is empty, at or below its low level of ${kg(threshold)} kg.`
          : `${silo.siloCode} has ${kg(silo.balanceKg)} kg of ${what}, at or above its high level of ${kg(threshold)} kg. No more feed needed yet.`,
        observedValue: silo.balanceKg, thresholdValue: threshold,
      });
    }
  } else if (rule.eventType === 'DIET_CHANGE') {
    const window = rule.thresholdValue ?? 3;
    for (const dc of input.dietChanges) {
      const left = diffDaysIso(input.today, dc.changeDate);
      if (left < 0 || left > window) continue;
      const silo = dc.nextSourceType === 'SILO' && dc.nextSourceCode ? dc.nextSourceCode : 'none yet';
      const whenDiet = left === 0 ? 'today' : `in ${days(left)}`;
      out.push({
        // The dedup key keeps the composite: it is what tells two stage groups' changes apart. The subject is the real batch.
        rule, dedupKey: `${rule.ruleId}|${dc.batchId}|${dc.toItemId}|${dc.changeDate}`, subjectType: 'BATCH', subjectId: dc.realBatchId, itemId: dc.toItemId,
        title: `Diet change in ${days(left)}: ${dc.batchNo}`,
        message: `${dc.batchNo} in ${dc.shedCode} changes from ${dc.fromItemName} to ${dc.toItemName} on ${dayShort(dc.changeDate)} (${whenDiet}). Next diet silo: ${silo}.`,
        observedValue: left, thresholdValue: window,
      });
    }
  } else if (rule.eventType === 'NO_NEXT_FEED_ROW') {
    const window = rule.thresholdValue && rule.thresholdValue > 0 ? rule.thresholdValue : DEFAULT_LOOKAHEAD_DAYS;
    // One alert per batch and stage, dated by the first day left without a row.
    const first = new Map<string, FeedRowGapFact>();
    for (const gap of input.feedRowGaps ?? []) {
      const left = diffDaysIso(input.today, gap.date);
      if (left < 0 || left > window) continue;
      const key = `${gap.batchId}|${gap.stageCode}`;
      const seen = first.get(key);
      if (!seen || gap.date < seen.date) first.set(key, gap);
    }
    for (const [key, gap] of first) {
      const left = diffDaysIso(input.today, gap.date);
      out.push({
        rule, dedupKey: `${rule.ruleId}|${key}`, subjectType: 'BATCH', subjectId: gap.batchId, itemId: null,
        title: `No next feed row: ${gap.batchNo}`,
        message: `${gap.batchNo} has no feed row from ${dayShort(gap.date)} (${left === 0 ? 'today' : `in ${days(left)}`}) in stage ${gap.stageCode}. Add the next feed row to the breed lifecycle.`,
        observedValue: left, thresholdValue: window,
      });
    }
  } else if (rule.eventType === 'NEXT_DIET_NO_SILO') {
    const window = rule.thresholdValue && rule.thresholdValue > 0 ? rule.thresholdValue : DEFAULT_LOOKAHEAD_DAYS;
    for (const dc of input.dietChanges) {
      const left = diffDaysIso(input.today, dc.changeDate);
      if (left < 0 || left > window) continue;
      // NONE: nowhere holds it. STORE is only a gap in a shed that has silos but none holding the item.
      const noSilo = dc.nextSourceType === 'NONE' || (dc.nextSourceType === 'STORE' && (input.noSiloHolds ?? []).includes(`${dc.shedCode}|${dc.toItemName}`));
      if (!noSilo) continue;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${dc.batchId}|${dc.toItemId}|${dc.changeDate}`, subjectType: 'BATCH', subjectId: dc.realBatchId, itemId: dc.toItemId,
        title: `No silo for next diet: ${dc.batchNo}`,
        message: `${dc.batchNo} in ${dc.shedCode} changes to ${dc.toItemName} on ${dayShort(dc.changeDate)} (${left === 0 ? 'today' : `in ${days(left)}`}), but no silo at ${dc.shedCode} holds that feed type.`,
        observedValue: left, thresholdValue: window,
      });
    }
  } else if (rule.eventType === 'SHORTFALL' || rule.eventType === 'NOT_DRAFTED') {
    // Engine row 60: notify when the projected shortfall is greater than the rule's kg (0 = any). Row 61: and no requisition covers the silo yet.
    const above = rule.thresholdValue ?? 0;
    for (const silo of input.orderFacts?.silos ?? []) {
      if (!(silo.projectedShortfallKg > above)) continue;
      const missing = rule.eventType === 'NOT_DRAFTED';
      if (missing && silo.requisitionStatus !== null) continue;
      // With no requisition on the silo, NOT_DRAFTED is the alert; SHORTFALL speaks only when a requisition exists
      // and still leaves a shortfall (unless there is no live NOT_DRAFTED rule to say it).
      if (!missing && silo.requisitionStatus === null && input.rules.some((r) => r.eventType === 'NOT_DRAFTED' && r.isActive)) continue;
      out.push({
        rule, dedupKey: `${rule.ruleId}|${silo.siloId}`, subjectType: 'SILO', subjectId: silo.siloId, itemId: silo.itemId,
        title: missing ? `No requisition drafted: ${silo.siloCode}` : `Projected shortfall: ${silo.siloCode}`,
        message: missing
          ? `${silo.siloCode} is projected ${kg(silo.projectedShortfallKg)} kg short${silo.itemName ? ` of ${silo.itemName}` : ''} and no feed requisition covers it yet. Recommended order ${kg(silo.recommendedOrderKg)} kg.`
          : `${silo.siloCode} is projected ${kg(silo.projectedShortfallKg)} kg short${silo.itemName ? ` of ${silo.itemName}` : ''}. Recommended order ${kg(silo.recommendedOrderKg)} kg.`,
        observedValue: silo.projectedShortfallKg, thresholdValue: above,
      });
    }
  } else if (rule.eventType === 'TRUCK_TARGET') {
    // Engine row 62 reads against the 30-ton truck target (checkpoint 17: a target, never a cap). A farm order that is
    // above 0 and short of it would send a part-load truck, so the farm is told; at or over the target the notice closes.
    const facts = input.orderFacts;
    if (facts && facts.farmTotalOrderKg > 0 && facts.truckTargetKg > 0 && facts.farmTotalOrderKg < facts.truckTargetKg) {
      out.push({
        rule, dedupKey: `${rule.ruleId}|${input.farmId}`, subjectType: 'FARM', subjectId: input.farmId, itemId: null,
        title: 'Farm order below the truck target',
        message: `The recommended order this cycle is ${kg(facts.farmTotalOrderKg)} kg, below the ${kg(facts.truckTargetKg)} kg truck target. Check whether to order more or wait for a full truck.`,
        observedValue: facts.farmTotalOrderKg, thresholdValue: facts.truckTargetKg,
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
        message: `${req.reqNo} is ${REQ_STATUS_WORDS[req.status] ?? 'not approved'}. Submission deadline ${dayShort(req.submissionDeadline)}, ${when}.`,
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
  // input.silos is every active silo of the farm (the caller's contract), so a
  // silo missing from it was deactivated or moved: its alert closes for that
  // reason, not as a recovery the stock never made.
  const liveSiloIds = new Set(input.silos.map((s) => s.siloId));
  for (const open of input.active) {
    if (wanted.has(open.dedupKey)) continue;
    // A pushed event (PLAN_AVAILABLE) is raised by the feed scheduler, not by these facts, so its absence
    // from `wanted` means nothing: it closes when its rule goes off or away, or when its plan is approved or superseded.
    if (open.eventType === 'PLAN_AVAILABLE') {
      if (input.levelsOnly) continue;
      const closed = open.subjectId === undefined ? undefined : input.closedPlans?.[open.subjectId];
      if (!liveRuleIds.has(open.ruleId)) plan.resolve.push({ alertId: open.alertId, reason: 'RULE_OFF' });
      else if (closed) plan.resolve.push({ alertId: open.alertId, reason: closed });
      continue;
    }
    if (!(open.eventType in REASON_BY_EVENT)) continue;
    // W5A: no order facts this pass (levels-only, or the statuses failed): SHORTFALL, NOT_DRAFTED and TRUCK_TARGET stay as they are.
    if (ORDER_EVENTS.includes(open.eventType) && !input.orderFacts) continue;
    // After a stock posting only silo facts were loaded; anything else stays as it is until a full evaluation.
    if (input.levelsOnly && open.subjectType !== 'SILO') continue;
    const reason: ResolveReason = open.subjectType === 'SILO' && open.subjectId !== undefined && !liveSiloIds.has(open.subjectId)
      ? 'SILO_INACTIVE'
      : liveRuleIds.has(open.ruleId) ? REASON_BY_EVENT[open.eventType] ?? 'CLOSED' : 'RULE_OFF';
    plan.resolve.push({ alertId: open.alertId, reason });
  }
  return plan;
}

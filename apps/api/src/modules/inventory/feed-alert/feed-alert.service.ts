import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { ADMIN_USER_TYPES } from '../../../common/permissions';
import { FARM_SCOPE_KEY, FarmScope } from '../../../common/farm-scope';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { FeedForecastService } from '../feed-forecast/feed-forecast.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { AlertRuleService } from '../../system/alert-rule/alert-rule.service';
import { addDays, parseUtcTimestamp, todayInZone, todayLocal, utcTimestamp, type DietChange } from '../feed-forecast/feed-forecast.engine';
import type { AlertFrequency, PriorityLevel } from '../../system/alert-rule/alert-rule.rules';
import {
  ActiveAlertFact, AlertPlan, AlertRuleFact, OpenRequisitionFact, SiloLevelFact, planAlerts,
} from './feed-alert.rules';

// Every feed_alert timestamp is written and read in the one Plan B convention (UTC, see utcTimestamp in the engine).
const ts = utcTimestamp;
const parseTs = parseUtcTimestamp;
const num = (v: string | null) => (v == null ? null : Number(v));

/** Feed requisitions not yet approved — the statuses a REQ_DEADLINE reminder is about (checkpoint 20). */
const OPEN_FEED_REQ_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];
/** Q1: admins see every alert of a farm in their scope; everyone else by role code. */
const SEES_ALL = [...ADMIN_USER_TYPES, 'OPERATIONAL_ADMIN'];

type AlertUser = { userId?: string; userType?: string };

export function visibleTo(
  alert: { recipient_roles: unknown; escalation_role: string | null; escalated_at: string | null },
  roleCodes: string[],
  seesAll: boolean,
): boolean {
  if (seesAll) return true;
  const recipients = Array.isArray(alert.recipient_roles) ? (alert.recipient_roles as string[]) : [];
  if (recipients.some((r) => roleCodes.includes(r))) return true;
  return !!alert.escalated_at && !!alert.escalation_role && roleCodes.includes(alert.escalation_role);
}

/**
 * In-app feed alerts (Plan B). Loads the facts planAlerts needs for one farm
 * and writes the plan. No scheduler exists in the API, so evaluation runs
 * after stock postings (silo levels only), after requisition decisions, and
 * on demand from the Feed Alerts screen. A posting's levels-only pass plans
 * the silo rules in full — raise, resolve, DAILY and ON_EACH_OCCURRENCE
 * re-notify, and escalation of an ESCALATING silo alert past its hours — so
 * silo alerts also move whenever stock does. The date-driven rules
 * (DIET_CHANGE, REQ_DEADLINE) advance only through a full evaluation: the
 * evaluate endpoint (the screen calls it on open) or a requisition decision.
 *
 * An alert belongs to the farm, not to whoever triggered the evaluation, so
 * every fact is read as system work for that farm (systemFarmScope): a
 * restricted caller's LOB bound would otherwise hide another LOB's stock in a
 * silo, read its balance as lower than it is, and raise (or resolve) a shared
 * alert on a false figure. Who may trigger it, and for which farm, is decided
 * before this — by resolveFarm for the endpoints, and by the posting itself
 * (already farm-checked) for the hooks.
 */
@Injectable()
export class FeedAlertService {
  private readonly logger = new Logger(FeedAlertService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    private readonly siloFeed: SiloFeedService,
    private readonly alertRules: AlertRuleService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** POST /feed-alert/evaluate: userType is required so resolveFarm fails closed (Task 4 fix round 1). */
  async evaluateNow(queryFarmId: string | undefined, tenantId: string, userType: string | undefined) {
    const { farmId, companyId } = await this.forecast.resolveFarm(queryFarmId, tenantId, userType);
    const plan = await this.evaluateFarm(farmId, companyId, tenantId);
    return {
      farmId, raised: plan.raise.length, renotified: plan.renotify.length, escalated: plan.escalate.length, resolved: plan.resolve.length,
      ...(plan.forecastError ? { forecastError: plan.forecastError } : {}),
    };
  }

  async evaluateFarm(
    farmId: string, companyId: string, tenantId: string, opts: { levelsOnly?: boolean } = {},
  ): Promise<AlertPlan & { forecastError?: string }> {
    const levelsOnly = !!opts.levelsOnly;
    // M8: a company created after 0118 has no rules until something ensures them.
    await this.alertRules.ensureDefaultRules(companyId, tenantId);
    return this.systemFarmScope(farmId, companyId, async () => {
      const nowMs = Date.now();
      let rules = await this.loadRules(companyId, farmId, tenantId);
      // Caller contract (a): every silo of the farm, whichever one the posting touched.
      const silos = await this.loadSiloLevels(farmId, companyId, tenantId);
      let dietChanges: DietChange[] = [];
      let requisitions: OpenRequisitionFact[] = [];
      let forecastError: string | undefined;
      // D16/M6: today in the farm's zone, read once per evaluation, and the
      // zone itself (used to read lastNotifiedDay back off a UTC timestamp).
      // A failed lookup shares the diet forecast's own try/catch below — it
      // behaves exactly like a forecast failure: logged, the server day
      // stands in for `today` so the silo and deadline rules still evaluate,
      // and only DIET_CHANGE sits this pass out.
      let today = todayLocal(nowMs);
      let timeZone: string | null = null;
      try {
        ({ today, timeZone } = await this.forecast.farmToday(companyId, tenantId, nowMs));
        if (!levelsOnly) {
          const dietRules = rules.filter((r) => r.isActive && r.eventType === 'DIET_CHANGE' && (r.farmId === null || r.farmId === farmId));
          if (dietRules.length) {
            // The forecast only needs to look as far ahead as the widest DIET_CHANGE window (checkpoint 15 caps it at 45).
            const horizon = Math.min(45, Math.max(1, ...dietRules.map((r) => r.thresholdValue ?? 3)));
            dietChanges = (await this.forecast.computeForFarm(farmId, companyId, tenantId, { from: today, to: addDays(today, horizon) }, { today, timeZone })).dietChanges;
          }
        }
      } catch (error) {
        // Final review I1: the forecast refuses a farm it cannot compute
        // (feed stocked in a unit other than KG, a broken lifecycle row) —
        // and now also a zone lookup that fails outright (ruling M6). Neither
        // must silence the silo and deadline alerts, so only the DIET_CHANGE
        // rules sit this pass out — and their open alerts with them: an
        // empty diet list would resolve those as PASSED, and a dropped rule
        // alone would resolve them as RULE_OFF.
        forecastError = (error as Error).message;
        this.logger.warn(`Diet-change alerts not evaluated for farm ${farmId}: ${forecastError}`);
        rules = rules.filter((r) => r.eventType !== 'DIET_CHANGE');
      }
      if (!levelsOnly) {
        requisitions = await this.loadOpenRequisitions(farmId, companyId, tenantId);
      }
      let active = await this.loadActive(farmId, tenantId, timeZone);
      if (forecastError) active = active.filter((a) => a.eventType !== 'DIET_CHANGE');
      const plan = planAlerts({ today, nowMs, farmId, rules, silos, dietChanges, requisitions, active, levelsOnly });
      await this.applyPlan(plan, { tenantId, companyId, farmId, nowMs });
      return forecastError ? { ...plan, forecastError } : plan;
    });
  }

  /** For the requisition decisions (Tasks 8–9): a full evaluation that never fails the decision. */
  async evaluateFarmSafely(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string): Promise<void> {
    if (!farmId || !companyId) return;
    if (this.inOpenTransaction(`farm ${farmId}`)) return;
    try {
      await this.evaluateFarm(farmId, companyId, tenantId);
    } catch (error) {
      this.logger.warn(`Feed alerts not evaluated for farm ${farmId}: ${(error as Error).message}`);
    }
  }

  /**
   * Called by the stock postings once per posting call, after they commit
   * (Ruling M6). Takes whatever locations the posting touched (silos, stores,
   * a batch's farm) and re-checks the silo levels of their farms — only those
   * farms, the posting's own. Never throws: an alert must not undo a posting.
   */
  async evaluateLevelsSafely(locationIds: Array<string | null | undefined>, tenantId: string): Promise<void> {
    if (this.inOpenTransaction('silo levels')) return;
    try {
      const ids = [...new Set(locationIds.filter((id): id is string => !!id))];
      if (!ids.length) return;
      const rows = await this.db
        .select({
          location_id: schema.locationMaster.location_id,
          location_type: schema.locationMaster.location_type,
          farm_id: schema.locationMaster.farm_id,
          company_id: schema.locationMaster.company_id,
        })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.tenant_id, tenantId), inArray(schema.locationMaster.location_id, ids)));
      const farms = new Map<string, string>();
      for (const r of rows) {
        const farmId = r.location_type === 'FARM' ? r.location_id : r.farm_id;
        if (farmId && r.company_id) farms.set(farmId, r.company_id);
      }
      for (const [farmId, companyId] of farms) await this.evaluateFarm(farmId, companyId, tenantId, { levelsOnly: true });
    } catch (error) {
      this.logger.warn(`Feed level alerts not evaluated: ${(error as Error).message}`);
    }
  }

  async list(query: { farmId?: string; status?: 'ACTIVE' | 'RESOLVED' | 'ALL' }, tenantId: string, user: AlertUser) {
    const { farmId, companyId } = await this.forecast.resolveFarm(query.farmId, tenantId, user?.userType);
    const status = query.status ?? 'ACTIVE';
    const rows = await this.db
      .select({ alert: schema.feedAlert, farm_code: schema.locationMaster.location_code })
      .from(schema.feedAlert)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.feedAlert.farm_id))
      .where(and(
        eq(schema.feedAlert.tenant_id, tenantId),
        eq(schema.feedAlert.company_id, companyId),
        eq(schema.feedAlert.farm_id, farmId),
        ...(status === 'ALL' ? [] : [eq(schema.feedAlert.status, status)]),
      ))
      .orderBy(desc(schema.feedAlert.last_notified_at))
      .limit(200);
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    const roleCodes = seesAll ? [] : await this.roleCodesOf(user?.userId, companyId);
    return rows.filter((r) => visibleTo(r.alert, roleCodes, seesAll)).map((r) => ({ ...r.alert, farm_code: r.farm_code }));
  }

  /**
   * D24 (Rishi, 27 Sep): the Alerts page evaluates every farm this user may
   * open — there is still no scheduler, so diet-change and deadline alerts
   * are only as fresh as the last evaluation. The farms are listFarms' (the
   * rules resolveFarm applies); one farm's failure is reported and the rest
   * still run, and a farm whose forecast cannot be built is named so the page
   * can say its diet-change alerts were skipped.
   */
  async evaluateScope(tenantId: string, user: AlertUser): Promise<{
    farms: number;
    failed: Array<{ farmCode: string; reason: string }>;
    forecastErrors: Array<{ farmCode: string; reason: string }>;
  }> {
    const farms = await this.forecast.listFarms(tenantId, user?.userType);
    const failed: Array<{ farmCode: string; reason: string }> = [];
    const forecastErrors: Array<{ farmCode: string; reason: string }> = [];
    for (const farm of farms) {
      try {
        const plan = await this.evaluateFarm(farm.farmId, farm.companyId, tenantId);
        if (plan.forecastError) forecastErrors.push({ farmCode: farm.code, reason: plan.forecastError });
      } catch (error) {
        this.logger.warn(`Feed alerts not evaluated for farm ${farm.code}: ${(error as Error).message}`);
        failed.push({ farmCode: farm.code, reason: (error as Error).message });
      }
    }
    return { farms: farms.length, failed, forecastErrors };
  }

  /**
   * D24: the feed alerts of every farm in scope (or the one named), for the
   * Alerts page. A farm outside the scope is not found, as on the single-farm
   * list; a row is kept only when its company is its farm's company in scope,
   * and only when it is addressed to one of the user's roles (Q1, L15 — role
   * codes are read once per company).
   */
  async listScope(query: { farmId?: string; status?: 'ACTIVE' | 'RESOLVED' | 'ALL' }, tenantId: string, user: AlertUser) {
    const farms = await this.forecast.listFarms(tenantId, user?.userType);
    const chosen = query.farmId ? farms.filter((f) => f.farmId === query.farmId) : farms;
    if (query.farmId && !chosen.length) throw new NotFoundException('Farm not found.');
    if (!chosen.length) return [];
    const companyOf = new Map(chosen.map((f) => [f.farmId, f.companyId]));
    const status = query.status ?? 'ACTIVE';
    const rows = await this.db
      .select({ alert: schema.feedAlert, farm_code: schema.locationMaster.location_code })
      .from(schema.feedAlert)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.feedAlert.farm_id))
      .where(and(
        eq(schema.feedAlert.tenant_id, tenantId),
        inArray(schema.feedAlert.farm_id, [...companyOf.keys()]),
        ...(status === 'ALL' ? [] : [eq(schema.feedAlert.status, status)]),
      ))
      .orderBy(desc(schema.feedAlert.last_notified_at))
      .limit(500);
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    const rolesByCompany = new Map<string, string[]>();
    const out: Array<typeof schema.feedAlert.$inferSelect & { farm_code: string | null }> = [];
    for (const r of rows) {
      if (companyOf.get(r.alert.farm_id) !== r.alert.company_id) continue;
      if (!seesAll && !rolesByCompany.has(r.alert.company_id)) {
        rolesByCompany.set(r.alert.company_id, await this.roleCodesOf(user?.userId, r.alert.company_id));
      }
      if (visibleTo(r.alert, rolesByCompany.get(r.alert.company_id) ?? [], seesAll)) out.push({ ...r.alert, farm_code: r.farm_code });
    }
    return out;
  }

  async acknowledge(alertId: string, tenantId: string, user: AlertUser) {
    const [row] = await this.db.select().from(schema.feedAlert)
      .where(and(eq(schema.feedAlert.alert_id, alertId), eq(schema.feedAlert.tenant_id, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Alert not found.');
    // The same farm rule as the list, applied to the alert's own farm: an
    // alert of a farm (or company) the caller may not see is not found (D13).
    const resolved = await this.forecast.resolveFarm(row.farm_id, tenantId, user?.userType);
    if (resolved.farmId !== row.farm_id || resolved.companyId !== row.company_id) throw new NotFoundException('Alert not found.');
    const seesAll = SEES_ALL.includes(user?.userType ?? '');
    if (!visibleTo(row, seesAll ? [] : await this.roleCodesOf(user?.userId, row.company_id), seesAll)) throw new NotFoundException('Alert not found.');
    const now = ts(Date.now());
    await this.db.update(schema.feedAlert).set({ acknowledged_by: user?.userId ?? null, acknowledged_at: now })
      .where(and(eq(schema.feedAlert.alert_id, alertId), eq(schema.feedAlert.tenant_id, tenantId)));
    return { ...row, acknowledged_by: user?.userId ?? null, acknowledged_at: now };
  }

  /**
   * Runs `work` for this farm with no user bound: the farm and its company
   * only (see the class comment), then through withFarmScope so the ledger
   * and silo reads see exactly that farm.
   */
  private systemFarmScope<T>(farmId: string, companyId: string, work: () => Promise<T>): Promise<T> {
    const system: FarmScope = { farmId, companyId, restricted: false, lobId: null };
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, system);
      return this.forecast.withFarmScope(farmId, companyId, work);
    });
  }

  /**
   * Ruling M6: evaluation reads balances, so it must see committed stock. A
   * hook reached inside someone else's still-open posting transaction skips
   * rather than read (and write alerts from) figures that may yet roll back;
   * the outermost posting is the one that evaluates.
   */
  private inOpenTransaction(what: string): boolean {
    if (this.cls.get('tenantPostingTransaction') !== true) return false;
    this.logger.warn(`Feed alerts for ${what} skipped: called inside an open posting transaction.`);
    return true;
  }

  /** L15: role codes are company-bound (role_master.company_id), so only the alert's company's roles count. */
  private async roleCodesOf(userId: string | undefined, companyId: string): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.db
      .select({ code: schema.roleMaster.role_code })
      .from(schema.userRoleAssignment)
      .innerJoin(schema.roleMaster, eq(schema.roleMaster.role_id, schema.userRoleAssignment.role_id))
      .where(and(
        eq(schema.userRoleAssignment.user_id, userId),
        eq(schema.userRoleAssignment.is_active, true),
        or(isNull(schema.userRoleAssignment.expires_at), gt(schema.userRoleAssignment.expires_at, sql`CURRENT_TIMESTAMP`)),
        eq(schema.roleMaster.company_id, companyId),
        eq(schema.roleMaster.is_active, true),
      ));
    return rows.map((r) => r.code);
  }

  /** Every rule of the company (or tenant-wide) that could apply to this farm — inactive ones too, so their open alerts resolve as RULE_OFF. */
  private async loadRules(companyId: string, farmId: string, tenantId: string): Promise<AlertRuleFact[]> {
    const rows = await this.db.select().from(schema.alertRule).where(and(
      eq(schema.alertRule.tenant_id, tenantId),
      or(eq(schema.alertRule.company_id, companyId), isNull(schema.alertRule.company_id)),
      or(eq(schema.alertRule.farm_id, farmId), isNull(schema.alertRule.farm_id)),
    ));
    return rows.map((r) => ({
      ruleId: r.rule_id,
      notificationCode: r.notification_code,
      eventType: r.event_type,
      thresholdReference: r.threshold_reference,
      thresholdValue: num(r.threshold_value),
      priorityLevel: r.priority_level as PriorityLevel,
      recipientRoles: (r.recipient_roles as string[]) ?? [],
      frequency: r.frequency as AlertFrequency,
      escalationAfterHours: r.escalation_after_hours,
      escalationRole: r.escalation_role,
      farmId: r.farm_id,
      isActive: r.is_active && !r.deleted_at,
    }));
  }

  /**
   * Every active silo of the farm with its levels and System Balance (the one
   * resident item's on-hand quantity, D8). Unlevelled silos are included too:
   * a FIXED_VALUE rule applies to them, and planAlerts must see every silo to
   * tell "recovered" from "not looked at" (caller contract a).
   */
  private async loadSiloLevels(farmId: string, companyId: string, tenantId: string): Promise<SiloLevelFact[]> {
    const silos = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        low_level_kg: schema.locationMaster.low_level_kg,
        high_level_kg: schema.locationMaster.high_level_kg,
      })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, companyId),
        eq(schema.locationMaster.farm_id, farmId),
        eq(schema.locationMaster.location_type, 'SILO'),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      ));
    if (!silos.length) return [];
    const residents = await this.siloFeed.currentItems(silos.map((s) => s.location_id), companyId, tenantId);
    return silos.map((s) => {
      const resident = residents.get(s.location_id) ?? null;
      return {
        siloId: s.location_id,
        siloCode: s.location_code,
        itemId: resident?.item_id ?? null,
        itemName: resident ? resident.item_description ?? resident.item_code : null,
        balanceKg: resident?.on_hand_qty ?? 0,
        lowLevelKg: num(s.low_level_kg),
        highLevelKg: num(s.high_level_kg),
      };
    });
  }

  /** Caller contract (c): unapproved feed requisitions of this farm only. */
  private async loadOpenRequisitions(farmId: string, companyId: string, tenantId: string): Promise<OpenRequisitionFact[]> {
    const rows = await this.db
      .select({
        requisition_id: schema.requisition.requisition_id,
        req_no: schema.requisition.req_no,
        status: schema.requisition.status,
        submission_deadline: schema.requisition.submission_deadline,
      })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.farm_id, farmId),
        eq(schema.requisition.company_id, companyId),
        eq(schema.requisition.doc_type, 'FEED'),
        inArray(schema.requisition.status, OPEN_FEED_REQ_STATUSES),
        isNull(schema.requisition.deleted_at),
      ));
    return rows
      .filter((r) => !!r.submission_deadline)
      .map((r) => ({ requisitionId: r.requisition_id, reqNo: r.req_no, status: r.status, submissionDeadline: r.submission_deadline! }));
  }

  /**
   * Caller contract (b): open alerts of the evaluated farm only. `timeZone`
   * is the same one farmToday just read (D16/M6) — lastNotifiedDay is a
   * calendar day, and a UTC timestamp read back in the server's zone instead
   * of the farm's could disagree with `today` about which day it names.
   */
  private async loadActive(farmId: string, tenantId: string, timeZone: string | null = null): Promise<ActiveAlertFact[]> {
    const rows = await this.db.select().from(schema.feedAlert).where(and(
      eq(schema.feedAlert.tenant_id, tenantId), eq(schema.feedAlert.farm_id, farmId), eq(schema.feedAlert.status, 'ACTIVE'),
    ));
    return rows.map((r) => ({
      alertId: r.alert_id,
      ruleId: r.rule_id,
      eventType: r.event_type,
      subjectType: r.subject_type as ActiveAlertFact['subjectType'],
      subjectId: r.subject_id,
      dedupKey: r.dedup_key,
      raisedAtMs: parseTs(r.raised_at),
      lastNotifiedDay: todayInZone(timeZone, parseTs(r.last_notified_at)),
      acknowledged: !!r.acknowledged_at,
      escalated: !!r.escalated_at,
      observedValue: num(r.observed_value),
    }));
  }

  /** Caller contract (d): raise and re-notify both stamp last_notified_at (hence lastNotifiedDay) and the observed value. */
  private async applyPlan(plan: AlertPlan, ctx: { tenantId: string; companyId: string; farmId: string; nowMs: number }): Promise<void> {
    const now = ts(ctx.nowMs);
    for (const c of plan.raise) {
      try {
        await this.db.insert(schema.feedAlert).values({
          alert_id: randomUUID(),
          tenant_id: ctx.tenantId,
          company_id: ctx.companyId,
          farm_id: ctx.farmId,
          rule_id: c.rule.ruleId,
          notification_code: c.rule.notificationCode,
          event_type: c.rule.eventType,
          priority_level: c.rule.priorityLevel,
          subject_type: c.subjectType,
          subject_id: c.subjectId,
          item_id: c.itemId,
          dedup_key: c.dedupKey,
          active_key: c.dedupKey,
          status: 'ACTIVE',
          title: c.title.slice(0, 200),
          message: c.message,
          observed_value: c.observedValue == null ? null : String(c.observedValue),
          threshold_value: c.thresholdValue == null ? null : String(c.thresholdValue),
          recipient_roles: c.rule.recipientRoles,
          raised_at: now,
          last_notified_at: now,
          notify_count: 1,
        });
      } catch (error) {
        // Two postings evaluating the same farm at once both see "no open alert"; the unique active_key lets only one in.
        if (!isDuplicateEntry(error)) throw error;
      }
    }
    for (const r of plan.renotify) {
      // A re-notification is a new notice, so it needs acknowledging afresh.
      await this.db.update(schema.feedAlert).set({
        last_notified_at: now,
        notify_count: sql`${schema.feedAlert.notify_count} + 1`,
        acknowledged_by: null,
        acknowledged_at: null,
        observed_value: r.observedValue == null ? null : String(r.observedValue),
      }).where(and(eq(schema.feedAlert.alert_id, r.alertId), eq(schema.feedAlert.status, 'ACTIVE')));
    }
    for (const e of plan.escalate) {
      await this.db.update(schema.feedAlert).set({ escalated_at: now, escalation_role: e.role })
        .where(and(eq(schema.feedAlert.alert_id, e.alertId), eq(schema.feedAlert.status, 'ACTIVE')));
    }
    for (const r of plan.resolve) {
      await this.db.update(schema.feedAlert).set({ status: 'RESOLVED', active_key: null, resolved_at: now, resolved_reason: r.reason })
        .where(and(eq(schema.feedAlert.alert_id, r.alertId), eq(schema.feedAlert.status, 'ACTIVE')));
    }
  }
}

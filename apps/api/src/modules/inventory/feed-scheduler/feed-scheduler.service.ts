import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.tokens';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { FARM_SCOPE_KEY, UNRESTRICTED_FARM_SCOPE } from '../../../common/farm-scope';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { FeedForecastService } from '../feed-forecast/feed-forecast.service';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { toFarmFeedSettings } from '../feed-settings/feed-settings.rules';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { isoProductionWeek } from '../feed-forecast/feed-plan.rules';
import { localClock, parseUtcTimestamp, utcTimestamp, type LocalClock } from '../feed-forecast/feed-forecast.engine';
import { productionCycle } from '../../procurement/feed-requisition/feed-requisition.rules';
import { FEED_JOBS, FEED_SCHEDULER_ACTOR, FeedJob, ScheduleSettings, duePeriod, runKey } from './feed-scheduler.rules';

/** A RUNNING scheduler row older than this was abandoned (crash, restart) and may be reclaimed. */
export const STALE_RUN_MS = 30 * 60_000;
/** The Feed Plan week claim is held while a plan is being made, so it is only abandoned after this (and only if the week still has no plan). */
export const STALE_PLAN_LOCK_MS = 2 * 60 * 60_000;
/** A job that failed this many times in one period stops being retried until the next period. */
export const MAX_FAILED_RUNS = 3;

type Settings = ScheduleSettings & Awaited<ReturnType<FeedSettingsService['resolveForFeedPlanning']>>;

export interface NoticeFarm {
  farmId: string;
  companyId: string;
  code: string;
}

interface FarmContext {
  settings: Settings;
  clock: LocalClock;
}

export type PlanOutcome =
  | { status: 'GENERATED' | 'EXISTS'; planId: string; planCode: string; planType: string; planWeek: string; version: number; productionDate: string }
  | { status: 'SKIPPED'; reason: string; planWeek: string; productionDate: string };

export interface JobSummary {
  plan?: PlanOutcome;
  planNotice?: { rules: number; raised: number };
  /** What the one alert evaluator did: the in-app notices are feed_alert rows, raised once per rule and document. */
  evaluated?: {
    raised: number; renotified: number; escalated: number; resolved: number;
    /** The notices raised by this run, by event type (REQ_DEADLINE: threshold > 0 is the reminder, 0 the cutoff). */
    raisedBy: Array<{ eventType: string; code: string; priority: string; roles: string[] }>;
    forecastError?: string;
  };
}

export interface FarmRunResult {
  farmId: string;
  farmCode: string;
  companyId: string;
  job: FeedJob;
  period: string;
  status: 'DONE' | 'FAILED' | 'ALREADY_RAN' | 'BACKED_OFF';
  summary?: JobSummary;
  error?: string;
}

/**
 * The feed scheduler (brief B; Feed Forecast rows 7–9, Engine rows 2 and 69,
 * Requisition rows 84–85, Master Setup rows 52–54). Every five minutes it
 * walks every active tenant and farm, reads that farm's effective Feed
 * Planning Settings and its company's time zone, and runs each job that is due
 * (duePeriod). A scheduled run claims feed_schedule_log.run_key first, so a
 * job runs once per farm and period however many ticks or API instances see
 * it. Jobs reuse what exists — the Feed Plan generator and the alert evaluator
 * (planAlerts, whose feed_alert rows are the in-app notices) — and add no
 * second calculation. Email is deferred (Rishi, 11 Oct): nothing is mailed.
 *
 * The timer is OFF unless FEED_SCHEDULER_ENABLED=true; "Run now" (runNow) works either way.
 * DIET_CHANGE and ESCALATION also wait until the company has saved Feed Planning Settings.
 */
@Injectable()
export class FeedSchedulerService {
  private readonly logger = new Logger(FeedSchedulerService.name);
  private ticking = false;
  private readonly warned = new Set<string>();

  /** A tenant that is off the DB allowlist or not yet migrated would fail every five minutes: say so once per process. */
  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }

  constructor(
    private readonly cls: ClsService,
    @Inject(MASTER_CONNECTION) private readonly masterDb: MySql2Database<typeof masterSchema>,
    private readonly connections: ConnectionManagerService,
    private readonly forecast: FeedForecastService,
    private readonly feedSettings: FeedSettingsService,
    private readonly alerts: FeedAlertService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /**
   * Off unless FEED_SCHEDULER_ENABLED is exactly 'true'. The flag is read here, at call time: a
   * decorator option would be read at module load, before ConfigModule has put .env into process.env.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'feed-scheduler' })
  async tick(nowMs: number = Date.now()): Promise<void> {
    if (process.env.FEED_SCHEDULER_ENABLED !== 'true') return;
    if (this.ticking) return; // a slow tick is still running; the next one picks up what is due
    this.ticking = true;
    try {
      const tenants = await this.masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.is_active, true));
      for (const tenant of tenants) {
        try {
          const tenantDb = await this.connections.getTenantConnection(tenant);
          await this.cls.run(async () => {
            this.cls.set('tenantId', tenant.tenant_id);
            this.cls.set('tenantDb', tenantDb);
            await this.runDue(tenant.tenant_id, nowMs);
          });
        } catch (error) {
          this.warnOnce(`tenant:${tenant.tenant_code}`, `Feed scheduler skipped tenant ${tenant.tenant_code}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Every job due now for every active farm of the tenant in context. One farm's failure never stops the rest. */
  async runDue(tenantId: string, nowMs: number = Date.now()): Promise<FarmRunResult[]> {
    const results: FarmRunResult[] = [];
    for (const farm of await this.farms(tenantId)) {
      let ctx: FarmContext;
      try {
        ctx = await this.context(farm, tenantId, nowMs);
      } catch (error) {
        this.warnOnce(`farm:${farm.farmId}`, `Feed scheduler skipped farm ${farm.code}: ${(error as Error).message}`);
        continue;
      }
      for (const job of FEED_JOBS) {
        const period = duePeriod(job, ctx.settings, ctx.clock);
        if (!period) continue;
        // The always-due jobs wait for the company to opt in by saving Feed Planning Settings: silently, no log row.
        if ((job === 'DIET_CHANGE' || job === 'ESCALATION') && ctx.settings.sources?.companySetting !== 'COMPANY') continue;
        results.push(await this.runLogged(job, farm, ctx, tenantId, nowMs, { trigger: 'SCHEDULED', period, runKey: runKey(job, farm.farmId, period) }));
      }
    }
    return results;
  }

  /**
   * "Run now" (admin, for testing): runs one job for the chosen farms
   * immediately, whatever the configured day and time. It is a MANUAL run with
   * no run_key, so it may repeat — and still never re-sends a notice or makes a
   * second plan for the week, because those are deduplicated by what exists.
   */
  async runNow(job: FeedJob, filter: { companyId?: string; farmId?: string }, tenantId: string, actorId?: string, nowMs: number = Date.now()): Promise<FarmRunResult[]> {
    const farms = (await this.farms(tenantId)).filter((f) =>
      (!filter.companyId || f.companyId === filter.companyId) && (!filter.farmId || f.farmId === filter.farmId));
    if (filter.farmId && !farms.length) throw new NotFoundException('Farm not found.');
    const results: FarmRunResult[] = [];
    for (const farm of farms) {
      const ctx = await this.context(farm, tenantId, nowMs);
      const period = duePeriod(job, ctx.settings, ctx.clock) ?? ctx.clock.date;
      results.push(await this.runLogged(job, farm, ctx, tenantId, nowMs, { trigger: 'MANUAL', period, runKey: null, actorId }));
    }
    return results;
  }

  async recentRuns(tenantId: string, limit = 50) {
    return this.db.select().from(schema.feedScheduleLog)
      .where(eq(schema.feedScheduleLog.tenant_id, tenantId))
      .orderBy(desc(schema.feedScheduleLog.started_at))
      .limit(Math.min(Math.max(limit, 1), 200));
  }

  /** Every active farm of the tenant, read as system work (no user scope). */
  private farms(tenantId: string): Promise<NoticeFarm[]> {
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, UNRESTRICTED_FARM_SCOPE);
      const farms = await this.forecast.listFarms(tenantId, 'TENANT_ADMIN');
      return farms.filter((f) => !!f.companyId).map((f) => ({ farmId: f.farmId, companyId: f.companyId, code: f.code }));
    });
  }

  /** The farm's effective settings (farm overrides, decisions 1 Oct) and the wall clock in its company's zone. */
  private async context(farm: NoticeFarm, tenantId: string, nowMs: number): Promise<FarmContext> {
    const settings = await this.feedSettings.resolveForFeedPlanning(farm.companyId, farm.farmId);
    const { timeZone } = await this.forecast.farmToday(farm.companyId, tenantId, nowMs);
    return { settings, clock: localClock(timeZone, nowMs) };
  }

  private async runLogged(
    job: FeedJob, farm: NoticeFarm, ctx: FarmContext, tenantId: string, nowMs: number,
    run: { trigger: 'SCHEDULED' | 'MANUAL'; period: string; runKey: string | null; actorId?: string },
  ): Promise<FarmRunResult> {
    const base = { farmId: farm.farmId, farmCode: farm.code, companyId: farm.companyId, job, period: run.period };
    if (run.trigger === 'SCHEDULED') {
      const F = schema.feedScheduleLog;
      const failed = await this.db.select({ run_id: F.run_id }).from(F).where(and(
        eq(F.farm_id, farm.farmId), eq(F.job_code, job), eq(F.period_key, run.period), eq(F.trigger_type, 'SCHEDULED'), eq(F.status, 'FAILED'),
      ));
      if (failed.length >= MAX_FAILED_RUNS) {
        this.warnOnce(`backoff:${job}|${farm.farmId}|${run.period}`, `Feed scheduler ${job} failed ${failed.length} times for farm ${farm.code} on ${run.period}; not retrying until the next period.`);
        return { ...base, status: 'BACKED_OFF' };
      }
    }
    const runId = await this.claim({
      tenant_id: tenantId, company_id: farm.companyId, farm_id: farm.farmId, job_code: job,
      trigger_type: run.trigger, period_key: run.period, triggered_by: run.actorId ?? null,
    }, run.runKey, nowMs);
    if (!runId) return { ...base, status: 'ALREADY_RAN' };
    try {
      const summary = await this.execute(job, farm, ctx, tenantId, nowMs);
      await this.db.update(schema.feedScheduleLog)
        .set({ status: 'DONE', summary: summary as unknown as Record<string, unknown>, finished_at: utcTimestamp() })
        .where(eq(schema.feedScheduleLog.run_id, runId));
      return { ...base, status: 'DONE', summary };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Feed scheduler ${job} failed for farm ${farm.code}: ${message}`);
      await this.db.update(schema.feedScheduleLog)
        // run_key is released so a failure never blocks the job for the rest of the period: the next tick retries.
        .set({ status: 'FAILED', error_message: message, finished_at: utcTimestamp(), run_key: null })
        .where(eq(schema.feedScheduleLog.run_id, runId));
      return { ...base, status: 'FAILED', error: message };
    }
  }

  /**
   * Claims feed_schedule_log.run_key (null = a manual run, always granted). Returns the new run_id, or null when
   * another run holds the key. A FAILED holder, or a RUNNING one older than STALE_RUN_MS (a crashed process),
   * is released and the claim retried once (staleMs: the week claim passes a longer one); the unique key still lets only one racing instance win.
   */
  private async claim(
    values: { tenant_id: string; company_id: string; farm_id: string; job_code: string; trigger_type: string; period_key: string; triggered_by: string | null },
    runKey: string | null, nowMs: number, staleMs: number = STALE_RUN_MS,
  ): Promise<string | null> {
    const attempt = async (): Promise<string | null> => {
      const runId = randomUUID();
      try {
        await this.db.insert(schema.feedScheduleLog).values({ run_id: runId, ...values, run_key: runKey, status: 'RUNNING', started_at: utcTimestamp(nowMs) });
        return runId;
      } catch (error) {
        if (isDuplicateEntry(error)) return null;
        throw error;
      }
    };
    const first = await attempt();
    if (first || !runKey) return first;
    const [holder] = await this.db.select({
      run_id: schema.feedScheduleLog.run_id, status: schema.feedScheduleLog.status, started_at: schema.feedScheduleLog.started_at,
    }).from(schema.feedScheduleLog).where(eq(schema.feedScheduleLog.run_key, runKey)).limit(1);
    const stale = holder?.status === 'RUNNING' && parseUtcTimestamp(holder.started_at) < nowMs - staleMs;
    if (!holder || !(holder.status === 'FAILED' || stale)) return null;
    await this.db.update(schema.feedScheduleLog)
      .set({ status: 'FAILED', run_key: null, finished_at: utcTimestamp(nowMs), error_message: stale ? 'Abandoned while RUNNING; released for a retry.' : undefined })
      .where(eq(schema.feedScheduleLog.run_id, holder.run_id));
    return attempt();
  }

  private async execute(job: FeedJob, farm: NoticeFarm, ctx: FarmContext, tenantId: string, nowMs: number): Promise<JobSummary> {
    if (job === 'TENTATIVE_PLAN') {
      const plan = await this.tentativePlan(farm, ctx, tenantId, nowMs);
      const planNotice = plan.status === 'SKIPPED'
        ? undefined
        : await this.alerts.raisePlanAvailable(farm.farmId, farm.companyId, tenantId, plan, nowMs);
      return { plan, planNotice };
    }
    // The date-driven notices (REQ_DEADLINE reminder and cutoff, DIET_CHANGE) and escalation are decided
    // by the one evaluator; the job brings it up to date at its configured time. Each notice is a
    // feed_alert row with one open row per rule and document, so a repeat run raises nothing new.
    const evaluation = await this.alerts.evaluateFarm(farm.farmId, farm.companyId, tenantId);
    return {
      evaluated: {
        raised: evaluation.raise.length, renotified: evaluation.renotify.length, escalated: evaluation.escalate.length, resolved: evaluation.resolve.length,
        raisedBy: evaluation.raise.map((c) => ({
          eventType: c.rule.eventType, code: c.rule.notificationCode, priority: c.rule.priorityLevel, roles: c.rule.recipientRoles,
        })),
        ...(evaluation.forecastError ? { forecastError: evaluation.forecastError } : {}),
      },
    };
  }

  /**
   * Feed Forecast row 7 / Engine row 69: the tentative Feed Plan for the coming
   * production week, through the existing generator (FeedForecastService.
   * generateFeedPlanVersion — the five-week history over the farm's saved
   * calculation). Never a second version for a week that already has one,
   * Tentative or Actual: "no Wednesday overwrite of approved quantities".
   * A farm with no saved calculation, or none covering the week, is SKIPPED
   * with the generator's own reason.
   */
  private async tentativePlan(farm: NoticeFarm, ctx: FarmContext, tenantId: string, nowMs: number): Promise<PlanOutcome> {
    const { productionWeekday } = toFarmFeedSettings(ctx.settings);
    const { productionDate } = productionCycle(ctx.clock.date, productionWeekday);
    const planWeek = isoProductionWeek(productionDate);
    const existingPlan = async (): Promise<PlanOutcome | null> => {
      const [existing] = await this.db.select().from(schema.feedPlan).where(and(
        eq(schema.feedPlan.tenant_id, tenantId), eq(schema.feedPlan.company_id, farm.companyId),
        eq(schema.feedPlan.farm_id, farm.farmId), eq(schema.feedPlan.plan_week, planWeek),
      )).orderBy(desc(schema.feedPlan.version)).limit(1);
      return existing ? {
        status: 'EXISTS', planId: existing.plan_id, planCode: existing.plan_code, planType: existing.plan_type,
        planWeek, version: existing.version, productionDate: existing.production_date,
      } : null;
    };
    const found = await existingPlan();
    if (found) return found;

    // No saved calculation means nothing can be generated: a skip, decided before the week is claimed so no
    // PLAN_LOCK row (and no failure) is written for it. Same reason the generator gives.
    const [calculation] = await this.db.select({ run_id: schema.feedForecastRun.run_id }).from(schema.feedForecastRun).where(and(
      eq(schema.feedForecastRun.tenant_id, tenantId), eq(schema.feedForecastRun.company_id, farm.companyId),
      eq(schema.feedForecastRun.farm_id, farm.farmId), isNull(schema.feedForecastRun.archived_at),
    )).limit(1);
    if (!calculation) {
      return { status: 'SKIPPED', reason: 'Save a feed forecast calculation before generating a feed plan.', planWeek, productionDate };
    }

    // The check above and the generation below must not interleave with another run (a manual "Run now"
    // racing the scheduled one): generating takes a per farm-and-week claim, whoever is running, and a run
    // that loses it re-reads the week instead of making a second version.
    const lockKey = `PLAN_WEEK|${farm.farmId}|${planWeek}`;
    const lockId = await this.claim({
      tenant_id: tenantId, company_id: farm.companyId, farm_id: farm.farmId, job_code: 'TENTATIVE_PLAN',
      trigger_type: 'PLAN_LOCK', period_key: planWeek, triggered_by: null,
    }, lockKey, nowMs, STALE_PLAN_LOCK_MS); // the week was just confirmed to have no plan, so only a very old claim is abandoned
    if (!lockId) {
      return (await existingPlan()) ?? { status: 'SKIPPED', reason: 'Another run is generating this week\'s Feed Plan.', planWeek, productionDate };
    }
    const settle = (status: 'DONE' | 'FAILED', release: boolean, note?: string) => this.db.update(schema.feedScheduleLog)
      .set({ status, finished_at: utcTimestamp(), error_message: note ?? null, ...(release ? { run_key: null } : {}) })
      .where(eq(schema.feedScheduleLog.run_id, lockId));
    try {
      const created = await this.cls.run(async () => {
        this.cls.set(FARM_SCOPE_KEY, { farmId: null, companyId: farm.companyId, restricted: false, lobId: null });
        return this.forecast.generateFeedPlanVersion(farm.farmId, productionDate, tenantId, { userId: FEED_SCHEDULER_ACTOR, userType: 'SYSTEM' });
      });
      await settle('DONE', false); // the week now has its plan; the key stays taken
      return { status: 'GENERATED', ...created, productionDate };
    } catch (error) {
      await settle('FAILED', true, (error as Error).message); // nothing was made: release the week for a retry
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        return { status: 'SKIPPED', reason: error.message, planWeek, productionDate };
      }
      throw error;
    }
  }
}

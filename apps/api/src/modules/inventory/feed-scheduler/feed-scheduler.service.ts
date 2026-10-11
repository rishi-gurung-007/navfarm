import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, desc, eq } from 'drizzle-orm';
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
import { localClock, utcTimestamp, type LocalClock } from '../feed-forecast/feed-forecast.engine';
import { productionCycle } from '../../procurement/feed-requisition/feed-requisition.rules';
import { FEED_JOBS, FEED_SCHEDULER_ACTOR, FeedJob, ScheduleSettings, duePeriod, runKey } from './feed-scheduler.rules';

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
  status: 'DONE' | 'FAILED' | 'ALREADY_RAN';
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
 * FEED_SCHEDULER_ENABLED=false turns the timer off (scripts, test servers);
 * "Run now" (runNow) works either way.
 */
@Injectable()
export class FeedSchedulerService {
  private readonly logger = new Logger(FeedSchedulerService.name);
  private ticking = false;

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

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'feed-scheduler', disabled: process.env.FEED_SCHEDULER_ENABLED === 'false' })
  async tick(nowMs: number = Date.now()): Promise<void> {
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
          this.logger.warn(`Feed scheduler skipped tenant ${tenant.tenant_code}: ${(error as Error).message}`);
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
        this.logger.warn(`Feed scheduler skipped farm ${farm.code}: ${(error as Error).message}`);
        continue;
      }
      for (const job of FEED_JOBS) {
        const period = duePeriod(job, ctx.settings, ctx.clock);
        if (!period) continue;
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
    const runId = randomUUID();
    try {
      await this.db.insert(schema.feedScheduleLog).values({
        run_id: runId, tenant_id: tenantId, company_id: farm.companyId, farm_id: farm.farmId, job_code: job,
        trigger_type: run.trigger, period_key: run.period, run_key: run.runKey, status: 'RUNNING',
        started_at: utcTimestamp(nowMs), triggered_by: run.actorId ?? null,
      });
    } catch (error) {
      if (isDuplicateEntry(error)) return { ...base, status: 'ALREADY_RAN' };
      throw error;
    }
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
        .set({ status: 'FAILED', error_message: message, finished_at: utcTimestamp() })
        .where(eq(schema.feedScheduleLog.run_id, runId));
      return { ...base, status: 'FAILED', error: message };
    }
  }

  private async execute(job: FeedJob, farm: NoticeFarm, ctx: FarmContext, tenantId: string, nowMs: number): Promise<JobSummary> {
    if (job === 'TENTATIVE_PLAN') {
      const plan = await this.tentativePlan(farm, ctx, tenantId);
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
  private async tentativePlan(farm: NoticeFarm, ctx: FarmContext, tenantId: string): Promise<PlanOutcome> {
    const { productionWeekday } = toFarmFeedSettings(ctx.settings);
    const { productionDate } = productionCycle(ctx.clock.date, productionWeekday);
    const planWeek = isoProductionWeek(productionDate);
    const [existing] = await this.db.select().from(schema.feedPlan).where(and(
      eq(schema.feedPlan.tenant_id, tenantId), eq(schema.feedPlan.company_id, farm.companyId),
      eq(schema.feedPlan.farm_id, farm.farmId), eq(schema.feedPlan.plan_week, planWeek),
    )).orderBy(desc(schema.feedPlan.version)).limit(1);
    if (existing) {
      return {
        status: 'EXISTS', planId: existing.plan_id, planCode: existing.plan_code, planType: existing.plan_type,
        planWeek, version: existing.version, productionDate: existing.production_date,
      };
    }
    try {
      const created = await this.cls.run(async () => {
        this.cls.set(FARM_SCOPE_KEY, { farmId: null, companyId: farm.companyId, restricted: false, lobId: null });
        return this.forecast.generateFeedPlanVersion(farm.farmId, productionDate, tenantId, { userId: FEED_SCHEDULER_ACTOR, userType: 'SYSTEM' });
      });
      return { status: 'GENERATED', ...created, productionDate };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        return { status: 'SKIPPED', reason: error.message, planWeek, productionDate };
      }
      throw error;
    }
  }
}

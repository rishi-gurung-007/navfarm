import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.tokens';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { BioCostingRunService } from './bio-costing-run.service';
import { duePeriods, MAX_PERIODS_PER_PASS, type Blocked, type RunFact } from './bio-costing.schedule';

type Profile = typeof schema.bioCostingProfile.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

export type ProfileOutcome =
  | { profile_code: string; outcome: 'NOTHING_DUE' }
  | { profile_code: string; outcome: 'BLOCKED'; blocked: Blocked }
  | { profile_code: string; outcome: 'CALCULATED' | 'POSTED'; runs: Array<{ run_no: string; period_key: string; status: string; charged: number; skipped: number; total: string }> }
  | { profile_code: string; outcome: 'FAILED'; period_key: string; error: string; runs: Array<{ run_no: string; period_key: string; status: string }> };

export interface DueLine {
  profile_id: string;
  profile_code: string;
  auto_post: boolean;
  due_periods: string[];
  blocked: Blocked | null;
}

/**
 * The bio-asset costing scheduler (bio-asset costing, Phase 5). Once a day it walks every active tenant and, for each costing profile
 * that has animals, works out which finished periods are owed a run (duePeriods) and Calculates them, oldest first. A profile with
 * auto_post on is then posted and the next period follows, up to a bounded number per pass; otherwise the run waits, Calculated, for a
 * person to read and post it, and the profile waits behind it. A period that cannot be run leaves a FAILED run with the reason, and after
 * three failures the scheduler stops retrying it. It uses the same service as the Finance screen: one calculation, not two.
 *
 * The timer is OFF unless BIO_COSTING_SCHEDULER_ENABLED=true (read when the timer fires, not at load); the time of day is
 * BIO_COSTING_SCHEDULER_CRON (default 02:00 server time, read at load). "Run due now" on the Finance screen works either way.
 * Safe with several API instances: a period is claimed by a unique key, so a second instance's attempt fails and is not repeated.
 */
@Injectable()
export class BioCostingSchedulerService {
  private readonly logger = new Logger(BioCostingSchedulerService.name);
  private ticking = false;

  constructor(
    private readonly cls: ClsService,
    @Inject(MASTER_CONNECTION) private readonly masterDb: MySql2Database<typeof masterSchema>,
    private readonly connections: ConnectionManagerService,
    private readonly runs: BioCostingRunService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  @Cron(process.env.BIO_COSTING_SCHEDULER_CRON || CronExpression.EVERY_DAY_AT_2AM, { name: 'bio-costing-scheduler' })
  async tick(): Promise<void> {
    if (process.env.BIO_COSTING_SCHEDULER_ENABLED !== 'true') return;
    if (this.ticking) return; // a slow pass is still running; the next one picks up what is due
    this.ticking = true;
    try {
      const tenants = await this.masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.is_active, true));
      for (const tenant of tenants) {
        try {
          const tenantDb = await this.connections.getTenantConnection(tenant);
          await this.cls.run(async () => {
            this.cls.set('tenantId', tenant.tenant_id);
            this.cls.set('tenantDb', tenantDb);
            const results = await this.runDueForTenant(tenant.tenant_id, {});
            const did = results.filter((r) => r.outcome !== 'NOTHING_DUE');
            if (did.length) this.logger.log(`Bio-asset costing, tenant ${tenant.tenant_code}: ${did.map((r) => `${r.profile_code} ${r.outcome}`).join(', ')}`);
          });
        } catch (error) {
          this.logger.warn(`Bio-asset costing scheduler skipped tenant ${tenant.tenant_code}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  /** The profiles that cost animals: active, or superseded but still holding animals, individually tracked. */
  private async profilesWithAnimals(tenantId: string, companyId?: string): Promise<Profile[]> {
    const P = schema.bioCostingProfile;
    const rows = await this.db.select().from(P).where(and(
      eq(P.tenant_id, tenantId), inArray(P.status, ['ACTIVE', 'SUPERSEDED']), eq(P.tracking, 'INDIVIDUAL'),
      ...(companyId ? [eq(P.company_id, companyId)] : []),
      sql`EXISTS (SELECT 1 FROM ${schema.animalRegister} a WHERE a.costing_profile_id = ${P.profile_id} AND a.is_active = 1)`,
    )).orderBy(P.profile_code);
    return rows;
  }

  /**
   * The runs that say which periods a profile has been run for. A whole-herd run counts as it is. Runs made for one batch count only when,
   * for a period, there is a live run for every batch the profile's animals stand in and none of its animals is outside a batch: then
   * the period is covered, and the batches' runs are read as one run (POSTED when all are posted, otherwise still waiting to be posted).
   * Without this the "due" notice kept asking for periods that a person had already costed batch by batch.
   */
  private async runFacts(profileId: string): Promise<RunFact[]> {
    const R = schema.bioCostingRun;
    const rows = await this.db.select({
      status: R.status, period_key: R.period_key, period_end: R.period_end, run_no: R.run_no, error_message: R.error_message, batch_id: R.batch_id,
    }).from(R).where(eq(R.profile_id, profileId));
    const facts: RunFact[] = rows.filter((r) => !r.batch_id).map(({ batch_id: _b, ...fact }) => fact);

    const byBatch = rows.filter((r) => r.batch_id && (r.status === 'CALCULATED' || r.status === 'POSTED'));
    if (!byBatch.length) return facts;
    const A = schema.animalRegister;
    const standing = await this.db.selectDistinct({ batch_id: A.current_batch_id, entry_date: A.entry_date, start: A.costing_start_date }).from(A)
      .where(and(eq(A.costing_profile_id, profileId), eq(A.is_active, true)));
    if (!standing.length || standing.some((x) => !x.batch_id)) return facts;
    for (const key of new Set(byBatch.map((r) => r.period_key))) {
      const inPeriod = byBatch.filter((r) => r.period_key === key);
      const periodEnd = String(inPeriod[0].period_end).slice(0, 10);
      // A batch is owed a run for the period only if one of its animals could be costed in it: she had arrived by its end, and her costing start
      // (if she has one) is not after it. Gilts selected in September, whose costing starts in 2027, have no run to make for January, and a
      // period their batch has no run for is not left "due" because of them.
      const needed = [...new Set(standing
        .filter((x) => (!x.entry_date || String(x.entry_date).slice(0, 10) <= periodEnd) && (!x.start || String(x.start).slice(0, 10) <= periodEnd))
        .map((x) => x.batch_id as string))];
      if (!needed.length || !needed.every((id) => inPeriod.some((r) => r.batch_id === id))) continue;
      const waiting = inPeriod.find((r) => r.status === 'CALCULATED');
      facts.push({ status: waiting ? 'CALCULATED' : 'POSTED', period_key: key, period_end: inPeriod[0].period_end, run_no: (waiting ?? inPeriod[0]).run_no, error_message: null });
    }
    return facts;
  }

  /** What is owed, per profile, without running anything: the Finance screen's "due" notice. */
  async dueReport(tenantId: string, companyId?: string): Promise<DueLine[]> {
    const out: DueLine[] = [];
    for (const p of await this.profilesWithAnimals(tenantId, companyId)) {
      const due = duePeriods({ frequency: p.run_frequency, effectiveFrom: p.effective_from, runs: await this.runFacts(p.profile_id), today: today() });
      if (due.periods.length || due.blocked) {
        out.push({ profile_id: p.profile_id, profile_code: p.profile_code, auto_post: p.auto_post, due_periods: due.periods.map((x) => x.key), blocked: due.blocked });
      }
    }
    return out;
  }

  /** One pass over a tenant (or one company of it): calculate, and post where the profile says so, whatever is due. */
  async runDueForTenant(tenantId: string, opts: { companyId?: string; trigger?: 'MANUAL' | 'SCHEDULED'; userId?: string }): Promise<ProfileOutcome[]> {
    const trigger = opts.trigger ?? 'SCHEDULED';
    const results: ProfileOutcome[] = [];
    for (const p of await this.profilesWithAnimals(tenantId, opts.companyId)) {
      // The retry cap is for the timer. A person pressing "Run due now" has looked, and may try again.
      const due = duePeriods({
        frequency: p.run_frequency, effectiveFrom: p.effective_from, runs: await this.runFacts(p.profile_id), today: today(), limit: MAX_PERIODS_PER_PASS,
        maxFailures: trigger === 'MANUAL' ? Number.POSITIVE_INFINITY : undefined,
      });
      if (due.blocked) { results.push({ profile_code: p.profile_code, outcome: 'BLOCKED', blocked: due.blocked }); continue; }
      if (!due.periods.length) { results.push({ profile_code: p.profile_code, outcome: 'NOTHING_DUE' }); continue; }

      const made: Array<{ run_no: string; period_key: string; status: string; charged: number; skipped: number; total: string }> = [];
      let failure: { period_key: string; error: string } | null = null;
      for (const period of due.periods) {
        try {
          let run = await this.runs.calculate({ profile_id: p.profile_id, period_key: period.key }, tenantId, opts.userId, trigger);
          // Posting is the profile's choice. Without it the run waits and so does the profile: the next period would be built on books that
          // do not yet hold this one.
          if (p.auto_post) run = await this.runs.post(run.run_id, tenantId, opts.userId);
          made.push({ run_no: run.run_no, period_key: run.period_key, status: run.status, charged: run.charged_count, skipped: run.skipped_count, total: run.total_charge });
          if (!p.auto_post) break;
        } catch (error) {
          const message = (error as Error).message || String(error);
          failure = { period_key: period.key, error: message };
          try { await this.runs.recordFailure(p, period, message, tenantId, trigger); } catch (e) { this.logger.warn(`Could not record the failed run for ${p.profile_code} ${period.key}: ${(e as Error).message}`); }
          this.logger.warn(`Bio-asset costing: ${p.profile_code} ${period.key} could not be run: ${message}`);
          break;
        }
      }
      if (failure) results.push({ profile_code: p.profile_code, outcome: 'FAILED', ...failure, runs: made.map((m) => ({ run_no: m.run_no, period_key: m.period_key, status: m.status })) });
      else results.push({ profile_code: p.profile_code, outcome: made[made.length - 1].status === 'POSTED' ? 'POSTED' : 'CALCULATED', runs: made });
    }
    return results;
  }
}

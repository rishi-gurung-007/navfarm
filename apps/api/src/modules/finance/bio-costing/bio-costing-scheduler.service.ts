import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.tokens';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { BioCostingRunService } from './bio-costing-run.service';
import { duePeriods, MAX_PERIODS_PER_PASS, type Blocked, type RunFact } from './bio-costing.schedule';
import { subjectFromItem, type CostingSubject } from './bio-costing-subject';
import { runsOfItem } from './bio-costing-history';
import { BIO_COSTING_ALERT_TYPE, dueNotices } from './bio-costing.notice';

const today = () => new Date().toISOString().slice(0, 10);
const NO_START = 'No costing-from date: set Costing From on the item\'s Bio Asset Costing tab, so the scheduler knows where to start.';
const NO_ANIMAL_DATED = 'None of its animals has a costing start date yet, so there is nothing to run. Date them (assign animals) when they should begin to be costed.';

export type ItemOutcome =
  | { item_code: string; outcome: 'NOTHING_DUE' }
  | { item_code: string; outcome: 'NOT_SCHEDULED'; reason: string }
  | { item_code: string; outcome: 'BLOCKED'; blocked: Blocked }
  | { item_code: string; outcome: 'CALCULATED' | 'POSTED'; runs: Array<{ run_no: string; period_key: string; status: string; charged: number; skipped: number; total: string }> }
  | { item_code: string; outcome: 'FAILED'; period_key: string; error: string; runs: Array<{ run_no: string; period_key: string; status: string }> };

export interface DueLine {
  item_id: string;
  item_code: string;
  auto_post: boolean;
  due_periods: string[];
  blocked: Blocked | null;
  /** Set when the subject is not scheduled at all, and why. */
  note: string | null;
}

/**
 * The bio-asset costing scheduler (bio-asset costing, Phase 5). Once a day it walks every active tenant and, for each biological item that
 * has animals, works out which finished periods are
 * owed a run (duePeriods) and Calculates them, oldest first. One with auto_post on is then posted and the next period follows, up to a bounded
 * number per pass; otherwise the run waits, Calculated, for a person to read and post it, and the item waits behind it. A period that cannot be run
 * leaves a FAILED run with the reason, and after three failures the scheduler stops retrying it. It uses the same service as the Finance screen: one
 * calculation, not two. An item without a Costing From date is not scheduled: where to start is the person's to say.
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

  /** Runs `work` for every active tenant, each in its own context; a tenant that cannot be reached is logged and skipped. */
  private async forEachTenant(work: (tenant: { tenant_id: string; tenant_code: string }) => Promise<void>): Promise<void> {
    const tenants = await this.masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.is_active, true));
    for (const tenant of tenants) {
      try {
        const tenantDb = await this.connections.getTenantConnection(tenant);
        await this.cls.run(async () => {
          this.cls.set('tenantId', tenant.tenant_id);
          this.cls.set('tenantDb', tenantDb);
          await work(tenant);
        });
      } catch (error) {
        this.logger.warn(`Bio-asset costing scheduler skipped tenant ${tenant.tenant_code}: ${(error as Error).message}`);
      }
    }
  }

  @Cron(process.env.BIO_COSTING_SCHEDULER_CRON || CronExpression.EVERY_DAY_AT_2AM, { name: 'bio-costing-scheduler' })
  async tick(): Promise<void> {
    if (process.env.BIO_COSTING_SCHEDULER_ENABLED !== 'true') return;
    if (this.ticking) return; // a slow pass is still running; the next one picks up what is due
    this.ticking = true;
    try {
      await this.forEachTenant(async (tenant) => {
        const results = await this.runDueForTenant(tenant.tenant_id, {});
        const did = results.filter((r) => r.outcome !== 'NOTHING_DUE');
        if (did.length) this.logger.log(`Bio-asset costing, tenant ${tenant.tenant_code}: ${did.map((r) => `${r.item_code} ${r.outcome}`).join(', ')}`);
      });
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The daily notice (07:00 server time, BIO_COSTING_NOTIFY_CRON): tells Finance, in the Alerts list, what is due, waiting to be posted or failing. It is ON
   * unless BIO_COSTING_NOTIFY_ENABLED=false, and independent of the costing timer: it matters most when nobody runs the costing by hand or by timer.
   */
  @Cron(process.env.BIO_COSTING_NOTIFY_CRON || '0 7 * * *', { name: 'bio-costing-notify' })
  async notifyTick(): Promise<void> {
    if (process.env.BIO_COSTING_NOTIFY_ENABLED === 'false') return;
    await this.forEachTenant(async (tenant) => {
      const raised = await this.notifyDueForTenant(tenant.tenant_id);
      if (raised) this.logger.log(`Bio-asset costing, tenant ${tenant.tenant_code}: ${raised} notice(s) raised`);
    });
  }

  /**
   * Writes a notice (an in-app alert) for what the due report shows, once for each item, set of periods and reason: one already raised, read or not, is not raised
   * again. Returns how many were raised. An item with a notice but nothing due any more is left alone: the alert is history, and reading it is the person's.
   */
  async notifyDueForTenant(tenantId: string, companyId?: string): Promise<number> {
    const report = await this.dueReport(tenantId, companyId);
    const notices = dueNotices(report);
    if (!notices.length) return 0;
    const items = await this.db.select({ id: schema.itemMaster.item_id, company_id: schema.itemMaster.company_id }).from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, notices.map((n) => n.item_id)));
    const companyOf = new Map(items.map((i) => [i.id, i.company_id]));
    const A = schema.notificationAlertLog;
    let raised = 0;
    for (const n of notices) {
      const company = companyOf.get(n.item_id);
      if (!company) continue;
      const [already] = await this.db.select({ id: A.alert_id }).from(A).where(and(eq(A.tenant_id, tenantId), eq(A.company_id, company), eq(A.alert_type, BIO_COSTING_ALERT_TYPE), eq(A.title, n.title))).limit(1);
      if (already) continue;
      await this.db.insert(A).values({ tenant_id: tenantId, company_id: company, alert_type: BIO_COSTING_ALERT_TYPE, severity: n.severity, title: n.title, message: n.message });
      raised += 1;
    }
    return raised;
  }

  /** What the scheduler costs: the active biological items that have costing terms and live animals. */
  private async subjectsWithAnimals(tenantId: string, companyId?: string): Promise<CostingSubject[]> {
    const I = schema.itemMaster;
    const items = await this.db.select().from(I).where(and(
      eq(I.tenant_id, tenantId), eq(I.is_biological_asset, true), eq(I.is_active, true), eq(I.is_blocked, false),
      sql`${I.bio_costing_method} IS NOT NULL`, sql`${I.deleted_at} IS NULL`,
      ...(companyId ? [eq(I.company_id, companyId)] : []),
      sql`EXISTS (SELECT 1 FROM ${schema.animalRegister} a WHERE a.item_id = ${I.item_id} AND a.is_active = 1)`,
    )).orderBy(I.item_code);
    return items.map(subjectFromItem);
  }

  /**
   * The runs that say which periods a subject has been run for. A whole-herd run counts as it is. Runs made for one batch count only when,
   * for a period, there is a live run for every batch its animals stand in and none of its animals is outside a batch: then
   * the period is covered, and the batches' runs are read as one run (POSTED when all are posted, otherwise still waiting to be posted).
   * Without this the "due" notice kept asking for periods that a person had already costed batch by batch.
   */
  private async runFacts(subject: CostingSubject): Promise<RunFact[]> {
    const R = schema.bioCostingRun;
    const rows = await this.db.select({
      status: R.status, period_key: R.period_key, period_end: R.period_end, run_no: R.run_no, error_message: R.error_message, batch_id: R.batch_id,
    }).from(R).where(runsOfItem(subject.id));
    const facts: RunFact[] = rows.filter((r) => !r.batch_id).map(({ batch_id: _b, ...fact }) => fact);

    const byBatch = rows.filter((r) => r.batch_id && (r.status === 'CALCULATED' || r.status === 'POSTED'));
    if (!byBatch.length) return facts;
    const A = schema.animalRegister;
    const standing = await this.db.selectDistinct({ batch_id: A.current_batch_id, entry_date: A.entry_date, start: A.costing_start_date }).from(A)
      .where(and(eq(A.item_id, subject.id), eq(A.is_active, true)));
    if (!standing.length || standing.some((x) => !x.batch_id)) return facts;
    for (const key of new Set(byBatch.map((r) => r.period_key))) {
      const inPeriod = byBatch.filter((r) => r.period_key === key);
      const periodEnd = String(inPeriod[0].period_end).slice(0, 10);
      // A batch is owed a run for the period only if one of its animals could be costed in it: she had arrived by its end, and her costing start
      // (if she has one) is not after it. Gilts selected in September, whose costing starts in 2027, have no run to make for January, and a
      // period their batch has no run for is not left "due" because of them.
      // An animal with no costing start date at all cannot be costed (the run skips her), so her batch is not owed a run on her account either.
      const needed = [...new Set(standing
        .filter((x) => (!x.entry_date || String(x.entry_date).slice(0, 10) <= periodEnd) && (x.start === null ? false : !x.start || String(x.start).slice(0, 10) <= periodEnd))
        .map((x) => x.batch_id as string))];
      if (!needed.length || !needed.every((id) => inPeriod.some((r) => r.batch_id === id))) continue;
      const waiting = inPeriod.find((r) => r.status === 'CALCULATED');
      facts.push({ status: waiting ? 'CALCULATED' : 'POSTED', period_key: key, period_end: inPeriod[0].period_end, run_no: (waiting ?? inPeriod[0]).run_no, error_message: null });
    }
    return facts;
  }

  /**
   * Where an item's periods start, or why they cannot. An item starts at its Costing From date, but never before
   * the first of its animals begins to be costed: a period before that has nothing to charge, and a run of it would only be an empty run on the books.
   */
  private async scheduleFrom(s: CostingSubject): Promise<{ from: string } | { why: string }> {
    if (!s.effective_from) return { why: NO_START };
    const [row] = await this.db.select({ first: sql<string | null>`MIN(${schema.animalRegister.costing_start_date})` }).from(schema.animalRegister).where(eq(schema.animalRegister.item_id, s.id));
    const first = row?.first ? String(row.first).slice(0, 10) : null;
    if (!first) return { why: NO_ANIMAL_DATED };
    return { from: first > s.effective_from ? first : s.effective_from };
  }

  /** What is owed, per item, without running anything: the Finance screen's "due" notice. */
  async dueReport(tenantId: string, companyId?: string): Promise<DueLine[]> {
    const out: DueLine[] = [];
    for (const s of await this.subjectsWithAnimals(tenantId, companyId)) {
      const line = { item_id: s.id, item_code: s.code, auto_post: s.auto_post };
      const start = await this.scheduleFrom(s);
      if ('why' in start) { out.push({ ...line, due_periods: [], blocked: null, note: start.why }); continue; }
      const due = duePeriods({ frequency: s.run_frequency, effectiveFrom: start.from, runs: await this.runFacts(s), today: today() });
      if (due.periods.length || due.blocked) {
        out.push({ ...line, due_periods: due.periods.map((x) => x.key), blocked: due.blocked, note: null });
      }
    }
    return out;
  }

  /** One pass over a tenant (or one company of it): calculate, and post where the item says so, whatever is due. */
  async runDueForTenant(tenantId: string, opts: { companyId?: string; trigger?: 'MANUAL' | 'SCHEDULED'; userId?: string }): Promise<ItemOutcome[]> {
    const trigger = opts.trigger ?? 'SCHEDULED';
    const results: ItemOutcome[] = [];
    for (const s of await this.subjectsWithAnimals(tenantId, opts.companyId)) {
      const start = await this.scheduleFrom(s);
      if ('why' in start) { results.push({ item_code: s.code, outcome: 'NOT_SCHEDULED', reason: start.why }); continue; }
      // The retry cap is for the timer. A person pressing "Run due now" has looked, and may try again.
      const due = duePeriods({
        frequency: s.run_frequency, effectiveFrom: start.from, runs: await this.runFacts(s), today: today(), limit: MAX_PERIODS_PER_PASS,
        maxFailures: trigger === 'MANUAL' ? Number.POSITIVE_INFINITY : undefined,
      });
      if (due.blocked) { results.push({ item_code: s.code, outcome: 'BLOCKED', blocked: due.blocked }); continue; }
      if (!due.periods.length) { results.push({ item_code: s.code, outcome: 'NOTHING_DUE' }); continue; }

      const made: Array<{ run_no: string; period_key: string; status: string; charged: number; skipped: number; total: string }> = [];
      let failure: { period_key: string; error: string } | null = null;
      for (const period of due.periods) {
        try {
          let run = await this.runs.calculate({ item_id: s.id, period_key: period.key }, tenantId, opts.userId, trigger);
          // Posting is the item's choice. Without it the run waits and so does the item: the next period would be built on books that
          // do not yet hold this one.
          if (s.auto_post) run = await this.runs.post(run.run_id, tenantId, opts.userId);
          made.push({ run_no: run.run_no, period_key: run.period_key, status: run.status, charged: run.charged_count, skipped: run.skipped_count, total: run.total_charge });
          if (!s.auto_post) break;
        } catch (error) {
          const message = (error as Error).message || String(error);
          failure = { period_key: period.key, error: message };
          try { await this.runs.recordFailure(s, period, message, tenantId, trigger); } catch (e) { this.logger.warn(`Could not record the failed run for ${s.code} ${period.key}: ${(e as Error).message}`); }
          this.logger.warn(`Bio-asset costing: ${s.code} ${period.key} could not be run: ${message}`);
          break;
        }
      }
      if (failure) results.push({ item_code: s.code, outcome: 'FAILED', ...failure, runs: made.map((m) => ({ run_no: m.run_no, period_key: m.period_key, status: m.status })) });
      else results.push({ item_code: s.code, outcome: made[made.length - 1].status === 'POSTED' ? 'POSTED' : 'CALCULATED', runs: made });
    }
    return results;
  }
}

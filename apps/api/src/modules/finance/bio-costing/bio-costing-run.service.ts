import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, gt, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertPostingPeriodOpen } from '../../../common/period-close';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { assertCompanyInScope, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { JournalService } from '../journal/journal.service';
import { GlPostingService } from '../journal/gl-posting.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import {
  amortisationLine, birthDate, daysBetween, fairValueLine, periodFor, periodOfKey, pickRate, runActiveKey, type AnimalFacts, type Period, type RunLine,
} from './bio-costing.engine';
import { REQUIRED_GL, resolveResidual, type ProfileTerms } from './bio-costing.rules';
import { BioCostingResidualService } from './bio-costing-residual.service';
import type { CalculateBatchBioCostingRunDto, CalculateBioCostingRunDto, QueryBioCostingRunDto } from './bio-costing-run.dto';

type Profile = typeof schema.bioCostingProfile.$inferSelect;
type Run = typeof schema.bioCostingRun.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

interface Candidate {
  facts: AnimalFacts;
  item_id: string;
  nob_id: string;
  lob_id: string;
  stage_id: string | null;
  batch_id: string | null;
  farm_id: string | null;
  cache_book_value: number;
}
interface BuiltLine extends RunLine { animal: Candidate }

/**
 * The bio-asset costing run: Calculate (a preview that posts nothing and can be repeated), Post (one ledger row per charged animal
 * and one journal, reconciled before it commits) and Reverse (the exact mirror). One run per profile and period; one charge per
 * animal, method and period, enforced by unique keys in the database as well as here.
 */
@Injectable()
export class BioCostingRunService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly journals: JournalService,
    private readonly gl: GlPostingService,
    private readonly animalBookValue: AnimalBookValueService,
    private readonly residuals: BioCostingResidualService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async loadProfile(id: string, tenantId: string): Promise<Profile> {
    const [p] = await this.db.select().from(schema.bioCostingProfile)
      .where(and(eq(schema.bioCostingProfile.profile_id, id), eq(schema.bioCostingProfile.tenant_id, tenantId))).limit(1);
    if (!p) throw new NotFoundException('Costing profile not found.');
    assertCompanyInScope(farmScope(this.cls), p.company_id);
    return p;
  }

  private async loadRun(id: string, tenantId: string): Promise<Run> {
    const [r] = await this.db.select().from(schema.bioCostingRun)
      .where(and(eq(schema.bioCostingRun.run_id, id), eq(schema.bioCostingRun.tenant_id, tenantId))).limit(1);
    if (!r) throw new NotFoundException('Costing run not found.');
    assertCompanyInScope(farmScope(this.cls), r.company_id);
    return r;
  }

  private async nextRunNo(tenantId: string, companyId: string): Promise<string> {
    const year = today().slice(0, 4);
    const [row] = await this.db.select({ no: schema.bioCostingRun.run_no }).from(schema.bioCostingRun)
      .where(and(eq(schema.bioCostingRun.tenant_id, tenantId), eq(schema.bioCostingRun.company_id, companyId), like(schema.bioCostingRun.run_no, `BCR-${year}-%`)))
      .orderBy(desc(schema.bioCostingRun.run_no)).limit(1);
    const last = row ? Number(row.no.split('-')[2]) || 0 : 0;
    return `BCR-${year}-${String(last + 1).padStart(5, '0')}`;
  }

  /** The period to run, and the controls that depend on it alone: it must have ended (V4) and lie in an open reporting period (V5). */
  private resolvePeriod(profile: Profile, dto: Pick<CalculateBioCostingRunDto, 'period_date' | 'period_key'>): Period {
    let period: Period | null = null;
    if (dto.period_key) {
      period = periodOfKey(profile.run_frequency, dto.period_key);
      if (!period) throw new BadRequestException(`'${dto.period_key}' is not a ${profile.run_frequency.toLowerCase()} period (expected e.g. 2026-10, 2026-W43, 2026-Q4 or 2026).`);
    } else if (dto.period_date) {
      period = periodFor(profile.run_frequency, dto.period_date);
    } else {
      throw new BadRequestException('Give the period to run: a period_key or any period_date inside it.');
    }
    if (period.end > today()) throw new BadRequestException(`Period ${period.key} ends on ${period.end}, which has not happened yet. Only a finished period can be run.`);
    return period;
  }

  /**
   * Two runs can touch the same animal when either covers the whole herd or both name the same batch. A later posted run of that kind is what
   * stops a period being run behind it; runs for two different batches share no animal, so they do not.
   */
  private sameHerd(batchId: string | null) {
    const R = schema.bioCostingRun;
    return batchId ? or(isNull(R.batch_id), eq(R.batch_id, batchId))! : sql`1 = 1`;
  }

  private async assertRunnable(profile: Profile, period: Period, tenantId: string, ignoreRunId?: string, batchId: string | null = null) {
    if (!['ACTIVE', 'SUPERSEDED'].includes(profile.status)) throw new BadRequestException(`Profile ${profile.profile_code} is ${profile.status}; only an active (or superseded, for the animals it still costs) profile can be run.`);
    if (profile.tracking !== 'INDIVIDUAL') throw new BadRequestException('Batch-tracked profiles (weaners, growers) are not run yet; this run handles individually tracked animals.');
    await assertPostingPeriodOpen(this.db, { tenantId, companyId: profile.company_id, postingDate: period.end });
    // Book values are carried period to period, so a period cannot be run behind a later one that is already posted.
    const [later] = await this.db.select({ no: schema.bioCostingRun.run_no, key: schema.bioCostingRun.period_key }).from(schema.bioCostingRun).where(and(
      eq(schema.bioCostingRun.profile_id, profile.profile_id), eq(schema.bioCostingRun.status, 'POSTED'), gt(schema.bioCostingRun.period_end, period.end),
      this.sameHerd(batchId),
      ...(ignoreRunId ? [sql`${schema.bioCostingRun.run_id} <> ${ignoreRunId}`] : []))).limit(1);
    if (later) throw new BadRequestException(`Run ${later.no} for ${later.key} is already posted after ${period.key}. Reverse it first; a period cannot be run behind a later one.`);
  }

  /** The lines of a run: every animal costed by the profile, her book value from her own ledger, and what the engine makes of it. */
  private async buildLines(profile: Profile, period: Period, daysEnforced: number | null, batchId: string | null = null): Promise<BuiltLine[]> {
    const A = schema.animalRegister;
    const rows = await this.db.select({ a: A, farm_id: schema.locationMaster.farm_id }).from(A)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, A.current_location_id))
      .where(and(eq(A.costing_profile_id, profile.profile_id), ...(batchId ? [eq(A.current_batch_id, batchId)] : []), or(eq(A.is_active, true), gt(A.disposal_date, period.start))))
      .orderBy(A.animal_code);
    // An animal already charged for this period and method by another posted run (a batch run, say, beside a whole-herd one) is left out:
    // the database allows one such charge, and a run that kept her would fail at Post.
    const taken = rows.length ? await this.db.select({ k: schema.bioCostingRunLine.active_key }).from(schema.bioCostingRunLine)
      .where(inArray(schema.bioCostingRunLine.active_key, rows.map((r) => `${r.a.animal_id}|${profile.costing_method}|${period.key}`))) : [];
    const alreadyCosted = new Set(taken.map((t) => t.k));
    for (let i = rows.length - 1; i >= 0; i--) if (alreadyCosted.has(`${rows[i].a.animal_id}|${profile.costing_method}|${period.key}`)) rows.splice(i, 1);
    const values = await this.animalBookValue.valuesFor(rows.map((r) => r.a.animal_id), period.end);
    // Animals whose exit (death, write-off) was written after the period: her book value as of the period's end does not show it.
    const exitIds = rows.map((r) => r.a.animal_id);
    const exits = exitIds.length
      ? await this.db.select({ animal_id: schema.bioAssetLedger.animal_id, date: sql<string>`MIN(${schema.bioAssetLedger.posting_date})` }).from(schema.bioAssetLedger)
          .where(and(inArray(schema.bioAssetLedger.animal_id, exitIds), inArray(schema.bioAssetLedger.entry_type, ['MORTALITY', 'WRITEOFF']), gt(schema.bioAssetLedger.posting_date, period.end)))
          .groupBy(schema.bioAssetLedger.animal_id)
      : [];
    const exitDateOf = new Map(exits.map((e) => [e.animal_id as string, String(e.date).slice(0, 10)]));
    const rates = profile.costing_method === 'FAIR_VALUE'
      ? await this.db.select().from(schema.bioCostingProfileRate).where(eq(schema.bioCostingProfileRate.profile_id, profile.profile_id))
      : [];
    if (profile.costing_method === 'FAIR_VALUE' && !rates.length) throw new BadRequestException(`Profile ${profile.profile_code} has no fair-value rate; add one before running it.`);
    const terms = profile as unknown as ProfileTerms;
    const residualSettings = profile.costing_method === 'AMORTIZATION' ? await this.residuals.settingsOf(profile.tenant_id, profile.company_id) : [];

    return rows.map(({ a, farm_id }) => {
      const v = values.get(a.animal_id);
      const bv = v?.hasRows ? v.bookValue : Number(a.book_value ?? 0);
      const cand: Candidate = {
        facts: { animal_id: a.animal_id, gender: a.gender, dob: a.dob, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks, costing_start_date: a.costing_start_date, is_active: !!a.is_active, disposal_date: a.disposal_date, exit_date: exitDateOf.get(a.animal_id) ?? null },
        item_id: a.item_id, nob_id: a.nob_id, lob_id: a.lob_id, stage_id: a.current_stage_id, batch_id: a.current_batch_id, farm_id, cache_book_value: Number(a.book_value ?? 0),
      };
      let line: RunLine;
      if (profile.costing_method === 'AMORTIZATION') {
        // Her own residual if she has one, else the company's in force at the period's end, else (a tenant with no setting yet) the profile's.
        const residual = resolveResidual({ animalOverride: a.residual_value, settings: residualSettings, profile: terms, gender: a.gender, onDate: period.end }).value;
        line = amortisationLine({ profile: terms as any, animal: cand.facts, period, bookValueBefore: bv, daysEnforced, residual });
      } else {
        const birth = birthDate(cand.facts);
        const ageWeeks = birth ? Math.floor(daysBetween(birth, period.end) / 7) : 0;
        const picked = pickRate(rates.map((r) => ({ ...r })), farm_id, ageWeeks, period.end);
        line = fairValueLine({
          animal: cand.facts, period, bookValueBefore: bv,
          rate: picked ? { expected_weight_kg: Number(picked.expected_weight_kg), price_per_kg: Number(picked.price_per_kg), costs_to_sell_pct: picked.costs_to_sell_pct == null ? null : Number(picked.costs_to_sell_pct) } : null,
        });
      }
      return { ...line, animal: cand };
    });
  }

  private async writeLines(runId: string, lines: BuiltLine[]) {
    await this.db.delete(schema.bioCostingRunLine).where(eq(schema.bioCostingRunLine.run_id, runId));
    for (const l of lines) {
      await this.db.insert(schema.bioCostingRunLine).values({
        line_id: randomUUID(), run_id: runId, animal_id: l.animal.facts.animal_id, batch_id: l.animal.batch_id, status: l.status, skip_reason: l.skip_reason,
        days: l.days?.toString() ?? null, remaining_days: l.remaining_days, book_value_before: l.book_value_before.toString(), residual: l.residual.toString(),
        charge: l.charge.toString(), book_value_after: l.book_value_after.toString(), costing_start_date: l.costing_start_date, life_end_date: l.life_end_date,
      });
    }
  }

  private totals(lines: BuiltLine[], method: string) {
    const charged = lines.filter((l) => l.status === 'CHARGED');
    return {
      animal_count: lines.length, charged_count: charged.length, skipped_count: lines.length - charged.length,
      total_charge: r4(charged.reduce((n, l) => n + l.charge, 0)),
      method,
    };
  }

  async calculate(dto: CalculateBioCostingRunDto, tenantId: string, userId?: string, trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL') {
    const profile = await this.loadProfile(dto.profile_id, tenantId);
    const batchId = dto.batch_id ?? null;
    if (batchId) await this.assertBatch(batchId, profile.company_id, tenantId);
    const period = this.resolvePeriod(profile, dto);
    await this.assertRunnable(profile, period, tenantId, undefined, batchId);
    const activeKey = runActiveKey(profile.profile_id, period.key, batchId);

    const runId = await withTenantTransaction(this.cls, async () => {
      const [existing] = await this.db.select().from(schema.bioCostingRun).where(eq(schema.bioCostingRun.active_key, activeKey)).limit(1);
      if (existing?.status === 'POSTED') throw new BadRequestException(`Period ${period.key} has already been run for ${profile.profile_code}${batchId ? ' in this batch' : ''} (${existing.run_no}). Reverse that run first to run it again.`);
      const lines = await this.buildLines(profile, period, dto.days_enforced ?? null, batchId);
      const t = this.totals(lines, profile.costing_method);
      const values = {
        animal_count: t.animal_count, charged_count: t.charged_count, skipped_count: t.skipped_count, total_charge: t.total_charge.toString(),
        days_enforced: dto.days_enforced ?? null, description: dto.description ?? null, requested_by: userId ?? null,
      };
      if (existing) { // a repeated Calculate replaces its own preview
        await this.db.update(schema.bioCostingRun).set(values).where(eq(schema.bioCostingRun.run_id, existing.run_id));
        await this.writeLines(existing.run_id, lines);
        return existing.run_id;
      }
      const id = randomUUID();
      const runNo = await this.nextRunNo(tenantId, profile.company_id);
      try {
        await this.db.insert(schema.bioCostingRun).values({
          run_id: id, tenant_id: tenantId, company_id: profile.company_id, run_no: runNo, profile_id: profile.profile_id, batch_id: batchId, method: profile.costing_method,
          frequency: profile.run_frequency, period_key: period.key, period_start: period.start, period_end: period.end, trigger, status: 'CALCULATED',
          active_key: activeKey, ...values,
        });
      } catch (error) {
        if (isDuplicateEntry(error)) throw new ConflictException('Another run for this profile and period was created at the same moment; try again.');
        throw error;
      }
      await this.writeLines(id, lines);
      return id;
    });
    return this.findOne(runId, tenantId);
  }

  private async assertBatch(batchId: string, companyId: string, tenantId: string) {
    const [b] = await this.db.select({ id: schema.batchHeader.batch_id }).from(schema.batchHeader).where(and(
      eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.company_id, companyId))).limit(1);
    if (!b) throw new BadRequestException('That batch is not a batch of this company.');
  }

  /**
   * The run screen's Calculate: cost one batch (or the whole herd). A batch holds animals of several costing profiles, and a profile fixes
   * the method, life, residual and GL accounts, so one run is made for each profile the batch's animals carry, each restricted to the batch.
   * Left without a batch, one whole-herd run is made for each active profile that has animals. A run that cannot be made does not stop
   * the others; it is reported with its reason.
   */
  async calculateBatch(dto: CalculateBatchBioCostingRunDto, tenantId: string, companyId: string, userId?: string) {
    const A = schema.animalRegister;
    const P = schema.bioCostingProfile;
    if (dto.batch_id) await this.assertBatch(dto.batch_id, companyId, tenantId);
    const profiles = await this.db.selectDistinct({ id: P.profile_id, code: P.profile_code }).from(A)
      .innerJoin(P, eq(P.profile_id, A.costing_profile_id))
      .where(and(eq(A.tenant_id, tenantId), eq(A.company_id, companyId), eq(A.is_active, true), inArray(P.status, ['ACTIVE', 'SUPERSEDED']),
        ...(dto.batch_id ? [eq(A.current_batch_id, dto.batch_id)] : [])))
      .orderBy(P.profile_code);
    if (!profiles.length) {
      throw new BadRequestException(dto.batch_id ? 'No animal of this batch is costed by a costing profile yet.' : 'No animal is costed by a costing profile yet.');
    }
    const runs: unknown[] = [];
    const failed: Array<{ profile_code: string; error: string }> = [];
    for (const p of profiles) {
      try {
        runs.push(await this.calculate({
          profile_id: p.id, batch_id: dto.batch_id, period_date: dto.period_date, period_key: dto.period_key, days_enforced: dto.days_enforced, description: dto.description,
        }, tenantId, userId));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ profile_code: p.code, error: message });
      }
    }
    if (!runs.length) throw new BadRequestException(failed.map((f) => `${f.profile_code}: ${f.error}`).join(' '));
    return { runs, failed };
  }

  /**
   * A run that could not be made, kept as a FAILED header with the reason: it claims no period (no active_key), posts nothing, and lets
   * the scheduler count its attempts so it stops retrying a period that keeps failing.
   */
  async recordFailure(
    profile: { profile_id: string; company_id: string; costing_method: string; run_frequency: string },
    period: Period, message: string, tenantId: string, trigger: 'MANUAL' | 'SCHEDULED' = 'SCHEDULED',
  ) {
    const runNo = await this.nextRunNo(tenantId, profile.company_id);
    await this.db.insert(schema.bioCostingRun).values({
      run_id: randomUUID(), tenant_id: tenantId, company_id: profile.company_id, run_no: runNo, profile_id: profile.profile_id, method: profile.costing_method,
      frequency: profile.run_frequency, period_key: period.key, period_start: period.start, period_end: period.end, trigger, status: 'FAILED',
      error_message: message.slice(0, 500),
    });
    return runNo;
  }

  async post(runId: string, tenantId: string, userId?: string) {
    const run = await this.loadRun(runId, tenantId);
    if (run.status === 'POSTED') throw new BadRequestException(`Run ${run.run_no} is already posted.`);
    if (run.status !== 'CALCULATED') throw new BadRequestException(`Run ${run.run_no} is ${run.status} and cannot be posted; calculate it again.`);
    const profile = await this.loadProfile(run.profile_id, tenantId);
    const period = periodOfKey(run.frequency, run.period_key)!;
    if (period.end > today()) throw new BadRequestException(`Period ${period.key} has not ended yet.`);
    await this.assertRunnable(profile, period, tenantId, run.run_id, run.batch_id);
    const missing = (REQUIRED_GL[profile.costing_method] ?? []).filter((g) => !(profile as Record<string, unknown>)[g.column]);
    if (missing.length) throw new BadRequestException(`Profile ${profile.profile_code} is missing GL accounts: ${missing.map((m) => m.label).join(', ')}.`);

    await withTenantTransaction(this.cls, async () => {
      // Re-run the arithmetic now: the numbers posted are the ones from this moment, not from the preview.
      const lines = await this.buildLines(profile, period, run.days_enforced, run.batch_id);
      await this.writeLines(run.run_id, lines);
      const rows = await this.db.select().from(schema.bioCostingRunLine).where(eq(schema.bioCostingRunLine.run_id, run.run_id));
      const byAnimal = new Map(lines.map((l) => [l.animal.facts.animal_id, l]));
      const isAmort = profile.costing_method === 'AMORTIZATION';

      // one ledger row per charged animal; no batch_id on it - the batch figure and the GL hold capitalised cost only (D8)
      const entryByLine = new Map<string, string>();
      for (const row of rows.filter((r) => r.status === 'CHARGED')) {
        const l = byAnimal.get(row.animal_id)!;
        const amount = isAmort ? -l.charge : l.charge;
        const entryId = randomUUID();
        await this.db.insert(schema.bioAssetLedger).values({
          entry_id: entryId, tenant_id: tenantId, company_id: run.company_id, bio_asset_item_id: l.animal.item_id, animal_id: row.animal_id, run_id: run.run_id,
          entry_type: isAmort ? 'AMORTIZATION' : 'FAIR_VALUE_ADJMT', document_type: 'BIO_COSTING_RUN', document_no: run.run_no,
          posting_date: run.period_end, stage: l.animal.stage_id, status: 'ACTIVE', uom: 'HEAD', quantity: '1.0000',
          cost_amount: amount.toString(), cost_amount_each_unit: amount.toString(), costing_method: isAmort ? 'AMORTIZED_COST' : 'FAIR_VALUE',
          nob_id: l.animal.nob_id, lob_id: l.animal.lob_id, created_by: userId ?? null,
        });
        entryByLine.set(row.line_id, entryId);
      }

      // the journal: charges grouped by business line so the dimensions stay right
      const journalLines: Array<{ glAccountId: string; debitAmount: number; creditAmount: number; nobId: string; lobId: string; description: string }> = [];
      const groups = new Map<string, { nob: string; lob: string; gain: number; loss: number }>();
      for (const row of rows.filter((r) => r.status === 'CHARGED')) {
        const l = byAnimal.get(row.animal_id)!;
        const k = `${l.animal.nob_id}|${l.animal.lob_id}`;
        const g = groups.get(k) ?? { nob: l.animal.nob_id, lob: l.animal.lob_id, gain: 0, loss: 0 };
        if (l.charge >= 0) g.gain += l.charge; else g.loss += -l.charge;
        groups.set(k, g);
      }
      for (const g of groups.values()) {
        const gain = r4(g.gain), loss = r4(g.loss);
        if (isAmort) {
          if (gain > 0) journalLines.push(
            { glAccountId: profile.amort_expense_gl_id!, debitAmount: gain, creditAmount: 0, nobId: g.nob, lobId: g.lob, description: `Amortization ${run.period_key}` },
            { glAccountId: profile.accum_amort_gl_id!, debitAmount: 0, creditAmount: gain, nobId: g.nob, lobId: g.lob, description: `Amortization ${run.period_key}` },
          );
        } else {
          if (gain > 0) journalLines.push(
            { glAccountId: profile.acquisition_gl_id!, debitAmount: gain, creditAmount: 0, nobId: g.nob, lobId: g.lob, description: `Fair value gain ${run.period_key}` },
            { glAccountId: profile.fv_gain_loss_gl_id!, debitAmount: 0, creditAmount: gain, nobId: g.nob, lobId: g.lob, description: `Fair value gain ${run.period_key}` },
          );
          if (loss > 0) journalLines.push(
            { glAccountId: profile.fv_gain_loss_gl_id!, debitAmount: loss, creditAmount: 0, nobId: g.nob, lobId: g.lob, description: `Fair value loss ${run.period_key}` },
            { glAccountId: profile.acquisition_gl_id!, debitAmount: 0, creditAmount: loss, nobId: g.nob, lobId: g.lob, description: `Fair value loss ${run.period_key}` },
          );
        }
      }
      let journalId: string | null = null;
      if (journalLines.length) {
        const journal = await this.journals.createAndPostSystemJournal({
          tenantId, companyId: run.company_id, postingDate: run.period_end, sourceDocumentType: 'BIO_COSTING_RUN', sourceDocumentNo: run.run_no,
          description: `${isAmort ? 'Amortization' : 'Fair value'} ${run.period_key} - ${profile.profile_code}`, lines: journalLines, userId,
        });
        journalId = (journal as { journal_id: string }).journal_id;
      }

      // V9: what the lines say, what the ledger holds and what the journal posted must be one number
      const charged = lines.filter((l) => l.status === 'CHARGED');
      const expectedLedger = r4(charged.reduce((n, l) => n + (isAmort ? -l.charge : l.charge), 0));
      const [ledgerSum] = await this.db.select({ total: sql<string>`COALESCE(SUM(${schema.bioAssetLedger.cost_amount}), 0)` }).from(schema.bioAssetLedger).where(eq(schema.bioAssetLedger.run_id, run.run_id));
      const journalDebit = r4(journalLines.reduce((n, l) => n + l.debitAmount, 0));
      const expectedDebit = r4(charged.reduce((n, l) => n + Math.abs(l.charge), 0));
      if (Math.abs(Number(ledgerSum?.total ?? 0) - expectedLedger) > 0.0001 || Math.abs(journalDebit - expectedDebit) > 0.0001) {
        throw new BadRequestException(`Run ${run.run_no} does not reconcile (lines ${expectedLedger}, ledger ${ledgerSum?.total}, journal ${journalDebit} against ${expectedDebit}); nothing was posted.`);
      }

      for (const row of rows) {
        const set: Record<string, unknown> = { journal_id: row.status === 'CHARGED' ? journalId : null, ledger_entry_id: entryByLine.get(row.line_id) ?? null };
        if (row.status === 'CHARGED') set.active_key = `${row.animal_id}|${run.method}|${run.period_key}`;
        try {
          await this.db.update(schema.bioCostingRunLine).set(set).where(eq(schema.bioCostingRunLine.line_id, row.line_id));
        } catch (error) {
          if (isDuplicateEntry(error)) throw new ConflictException('An animal in this run has already been charged for this period by another posted run.');
          throw error;
        }
      }
      const t = this.totals(lines, profile.costing_method);
      await this.db.update(schema.bioCostingRun).set({
        status: 'POSTED', journal_id: journalId, posted_by: userId ?? null, posted_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        animal_count: t.animal_count, charged_count: t.charged_count, skipped_count: t.skipped_count, total_charge: t.total_charge.toString(),
      }).where(eq(schema.bioCostingRun.run_id, run.run_id));
      await this.animalBookValue.refreshCache(charged.map((l) => l.animal.facts.animal_id));
      await this.audit.log({ tenantId, companyId: run.company_id, userId, action: 'POST', entityName: 'bio_costing_run', entityId: run.run_id, newValues: { run_no: run.run_no, period: run.period_key, ...t, journal_id: journalId } });
    });
    return this.findOne(runId, tenantId);
  }

  async reverse(runId: string, reason: string, tenantId: string, userId?: string) {
    const run = await this.loadRun(runId, tenantId);
    if (run.status !== 'POSTED') throw new BadRequestException(`Run ${run.run_no} is ${run.status}; only a posted run can be reversed.`);
    const [later] = await this.db.select({ no: schema.bioCostingRun.run_no }).from(schema.bioCostingRun).where(and(
      eq(schema.bioCostingRun.profile_id, run.profile_id), eq(schema.bioCostingRun.status, 'POSTED'), gt(schema.bioCostingRun.period_end, run.period_end),
      this.sameHerd(run.batch_id))).limit(1);
    if (later) throw new BadRequestException(`Run ${later.no} was posted after this one; reverse the latest run first.`);
    // An animal that has left the herd since this period had her exit written off at a value that includes this run's charge: taking
    // the charge back (and running the month again) would leave her below nil. Her exit has to be settled first.
    const charged = await this.db.select({ animal_id: schema.bioAssetLedger.animal_id }).from(schema.bioAssetLedger)
      .where(and(eq(schema.bioAssetLedger.run_id, run.run_id), isNull(schema.bioAssetLedger.source_entry_id)));
    const chargedIds = [...new Set(charged.map((c) => c.animal_id).filter((x): x is string => !!x))];
    if (chargedIds.length) {
      const [left] = await this.db.select({ code: schema.animalRegister.animal_code, date: schema.bioAssetLedger.posting_date }).from(schema.bioAssetLedger)
        .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.bioAssetLedger.animal_id))
        .where(and(inArray(schema.bioAssetLedger.animal_id, chargedIds), inArray(schema.bioAssetLedger.entry_type, ['MORTALITY', 'WRITEOFF']), gt(schema.bioAssetLedger.posting_date, run.period_end)))
        .limit(1);
      if (left) throw new BadRequestException(`${left.code} left the herd on ${String(left.date).slice(0, 10)}, after this period, and the exit was valued with this run's charge in it, so run ${run.run_no} cannot be reversed.`);
    }
    await assertPostingPeriodOpen(this.db, { tenantId, companyId: run.company_id, postingDate: run.period_end });

    await withTenantTransaction(this.cls, async () => {
      const originals = await this.db.select().from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.run_id, run.run_id), isNull(schema.bioAssetLedger.source_entry_id)));
      for (const o of originals) {
        await this.db.insert(schema.bioAssetLedger).values({
          entry_id: randomUUID(), tenant_id: tenantId, company_id: o.company_id, bio_asset_item_id: o.bio_asset_item_id, animal_id: o.animal_id, run_id: run.run_id,
          source_entry_id: o.entry_id, entry_type: o.entry_type, document_type: 'BIO_COSTING_RUN', document_no: run.run_no, posting_date: o.posting_date, stage: o.stage,
          status: 'ACTIVE', uom: o.uom, quantity: o.quantity, cost_amount: (-Number(o.cost_amount)).toString(), cost_amount_each_unit: (-Number(o.cost_amount_each_unit)).toString(),
          costing_method: o.costing_method, nob_id: o.nob_id, lob_id: o.lob_id, created_by: userId ?? null,
        });
      }
      if (run.journal_id) await this.gl.reverseJournal(run.journal_id, run.period_end, `Reversal of run ${run.run_no}`, userId);
      await this.db.update(schema.bioCostingRunLine).set({ active_key: null }).where(eq(schema.bioCostingRunLine.run_id, run.run_id));
      await this.db.update(schema.bioCostingRun).set({
        status: 'REVERSED', active_key: null, reversed_by: userId ?? null, reversed_at: new Date().toISOString().slice(0, 19).replace('T', ' '), reverse_reason: reason,
      }).where(eq(schema.bioCostingRun.run_id, run.run_id));
      await this.animalBookValue.refreshCache(originals.map((o) => o.animal_id).filter((x): x is string => !!x));
      await this.audit.log({ tenantId, companyId: run.company_id, userId, action: 'REVERSE', entityName: 'bio_costing_run', entityId: run.run_id, newValues: { run_no: run.run_no, reason } });
    });
    return this.findOne(runId, tenantId);
  }

  async findAll(query: QueryBioCostingRunDto, tenantId: string, companyId?: string) {
    const co = query.companyId ?? companyId;
    return this.db.select().from(schema.bioCostingRun).where(and(
      eq(schema.bioCostingRun.tenant_id, tenantId), ...(co ? [eq(schema.bioCostingRun.company_id, co)] : []),
      ...(query.profile_id ? [eq(schema.bioCostingRun.profile_id, query.profile_id)] : []), ...(query.batch_id ? [eq(schema.bioCostingRun.batch_id, query.batch_id)] : []), ...(query.status ? [eq(schema.bioCostingRun.status, query.status)] : []),
    )).orderBy(desc(schema.bioCostingRun.created_at));
  }

  async findOne(id: string, tenantId: string) {
    const run = await this.loadRun(id, tenantId);
    const lines = await this.db.select({ line: schema.bioCostingRunLine, animal_code: schema.animalRegister.animal_code, gender: schema.animalRegister.gender })
      .from(schema.bioCostingRunLine).innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.bioCostingRunLine.animal_id))
      .where(eq(schema.bioCostingRunLine.run_id, id)).orderBy(schema.animalRegister.animal_code);
    return { ...run, lines: lines.map((l) => ({ ...l.line, animal_code: l.animal_code, gender: l.gender })) };
  }
}

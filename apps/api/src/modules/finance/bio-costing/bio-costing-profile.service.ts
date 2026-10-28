import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { assertCompanyInScope, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import {
  changedLockedFields, costingStartDate, originOf, policyNotes, resolveProfile, scopeKey, validateActivation, validateTerms,
  type MethodFlags, type ProfileTerms,
} from './bio-costing.rules';
import type {
  AssignBioCostingDto, CreateBioCostingProfileDto, CreateBioCostingRateDto, NewBioCostingProfileVersionDto,
  QueryBioCostingProfileDto, ResolveBioCostingProfileDto, UpdateBioCostingProfileDto,
} from './bio-costing-profile.dto';
import { bioEventCondition, bioEventsCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

type Profile = typeof schema.bioCostingProfile.$inferSelect;
const GL_COLUMNS = ['acquisition_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id', 'fv_gain_loss_gl_id', 'writeoff_gl_id'] as const;
const today = () => new Date().toISOString().slice(0, 10);

/** The central bio-asset costing profile: set up, activated, versioned, and resolved for an animal. */
@Injectable()
export class BioCostingProfileService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /** The BIO_ASSET costing method's flags: what says the tenant costs biological assets, and by which methods. */
  private async methodFlags(): Promise<MethodFlags | null> {
    const [row] = await this.db
      .select({ bio_asset_support: schema.costingMethodConfig.bio_asset_support, amort_option: schema.costingMethodConfig.amort_option, fair_value_option: schema.costingMethodConfig.fair_value_option })
      .from(schema.costingMethodConfig)
      .where(and(eq(schema.costingMethodConfig.method_code, 'BIO_ASSET'), eq(schema.costingMethodConfig.is_active, true)))
      .limit(1);
    return row ?? null;
  }

  private termsOf(p: Partial<Profile> & Record<string, unknown>): ProfileTerms {
    return p as unknown as ProfileTerms;
  }

  private async load(id: string, tenantId: string): Promise<Profile> {
    const [row] = await this.db.select().from(schema.bioCostingProfile)
      .where(and(eq(schema.bioCostingProfile.profile_id, id), eq(schema.bioCostingProfile.tenant_id, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Costing profile not found.');
    assertCompanyInScope(farmScope(this.cls), row.company_id);
    return row;
  }

  private async assertCompany(companyId: string, tenantId: string) {
    const [c] = await this.db.select({ id: schema.companyMaster.company_id }).from(schema.companyMaster)
      .where(and(eq(schema.companyMaster.company_id, companyId), eq(schema.companyMaster.tenant_id, tenantId))).limit(1);
    if (!c) throw new BadRequestException('That company is not in this tenant.');
    assertCompanyInScope(farmScope(this.cls), companyId);
  }

  private async assertReferences(t: Record<string, unknown>, companyId: string, tenantId: string) {
    const ids = GL_COLUMNS.map((c) => t[c] as string | null | undefined).filter((x): x is string => !!x);
    if (ids.length) {
      const found = await this.db.select({ id: schema.glAccountMaster.gl_account_id }).from(schema.glAccountMaster).where(and(
        inArray(schema.glAccountMaster.gl_account_id, ids), eq(schema.glAccountMaster.tenant_id, tenantId),
        or(eq(schema.glAccountMaster.company_id, companyId), isNull(schema.glAccountMaster.company_id)),
        eq(schema.glAccountMaster.is_active, true),
      ));
      const ok = new Set(found.map((f) => f.id));
      const missing = ids.filter((i) => !ok.has(i));
      if (missing.length) throw new BadRequestException(`GL account ${missing[0]} is not an active account of this company.`);
    }
    if (t.item_id) {
      const [i] = await this.db.select({ id: schema.itemMaster.item_id }).from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.item_id, t.item_id as string), eq(schema.itemMaster.tenant_id, tenantId))).limit(1);
      if (!i) throw new BadRequestException('That item does not exist.');
    }
    if (t.breed_id) {
      const [b] = await this.db.select({ id: schema.breedMaster.breed_id }).from(schema.breedMaster)
        .where(and(eq(schema.breedMaster.breed_id, t.breed_id as string), eq(schema.breedMaster.tenant_id, tenantId))).limit(1);
      if (!b) throw new BadRequestException('That breed does not exist.');
    }
  }

  private async countAnimals(profileId: string): Promise<number> {
    const [r] = await this.db.select({ n: sql<string>`COUNT(*)` }).from(schema.animalRegister).where(eq(schema.animalRegister.costing_profile_id, profileId));
    return Number(r?.n ?? 0);
  }

  async findAll(query: QueryBioCostingProfileDto, tenantId: string, companyId?: string) {
    const co = query.companyId ?? companyId;
    const rows = await this.db.select().from(schema.bioCostingProfile)
      .where(and(eq(schema.bioCostingProfile.tenant_id, tenantId), ...(co ? [eq(schema.bioCostingProfile.company_id, co)] : []), ...(query.status ? [eq(schema.bioCostingProfile.status, query.status)] : [])))
      .orderBy(schema.bioCostingProfile.profile_code);
    return rows.map((p) => ({ ...p, policy_notes: policyNotes(p) }));
  }

  async findOne(id: string, tenantId: string) {
    const profile = await this.load(id, tenantId);
    const rates = await this.db.select().from(schema.bioCostingProfileRate)
      .where(eq(schema.bioCostingProfileRate.profile_id, id)).orderBy(desc(schema.bioCostingProfileRate.effective_from));
    const animals = await this.countAnimals(id);
    return { ...profile, rates, policy_notes: policyNotes(profile), in_use: { animals, locked: animals > 0 } };
  }

  async create(dto: CreateBioCostingProfileDto, tenantId: string, companyId: string, userId?: string) {
    await this.assertCompany(companyId, tenantId);
    const errors = validateTerms(this.termsOf(dto as any), await this.methodFlags());
    if (errors.length) throw new BadRequestException(errors);
    await this.assertReferences(dto as any, companyId, tenantId);
    const profile_id = randomUUID();
    try {
      await this.db.insert(schema.bioCostingProfile).values({
        profile_id, tenant_id: tenantId, company_id: companyId, profile_code: dto.profile_code, name: dto.name,
        item_id: dto.item_id ?? null, breed_id: dto.breed_id ?? null, gender: dto.gender ?? null, origin: dto.origin ?? null,
        costing_method: dto.costing_method, start_age_weeks: dto.start_age_weeks, useful_life_months: dto.useful_life_months ?? null,
        residual_rule: dto.residual_rule ?? 'NONE',
        residual_fixed_amount: dto.residual_fixed_amount?.toString() ?? null, residual_weight_kg: dto.residual_weight_kg?.toString() ?? null,
        residual_price_per_kg: dto.residual_price_per_kg?.toString() ?? null, residual_applies_gender: dto.residual_applies_gender ?? null,
        run_frequency: dto.run_frequency ?? 'MONTHLY', day_basis: dto.day_basis ?? 'FREQUENCY_DAYS', tracking: dto.tracking ?? 'INDIVIDUAL',
        auto_post: dto.auto_post ?? false,
        acquisition_gl_id: dto.acquisition_gl_id ?? null, accum_amort_gl_id: dto.accum_amort_gl_id ?? null, amort_expense_gl_id: dto.amort_expense_gl_id ?? null,
        fv_gain_loss_gl_id: dto.fv_gain_loss_gl_id ?? null, writeoff_gl_id: dto.writeoff_gl_id ?? null,
        effective_from: dto.effective_from, status: 'DRAFT', created_by: userId ?? null, updated_by: userId ?? null,
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ConflictException(`A costing profile with code '${dto.profile_code}' already exists.`);
      throw error;
    }
    const created = await this.load(profile_id, tenantId);
    await this.audit.log({ tenantId, companyId, userId, action: 'CREATE', entityName: 'bio_costing_profile', entityId: profile_id, newValues: created });
    return this.findOne(profile_id, tenantId);
  }

  async update(id: string, dto: UpdateBioCostingProfileDto, tenantId: string, userId?: string) {
    const stored = await this.load(id, tenantId);
    if (['SUPERSEDED'].includes(stored.status)) throw new BadRequestException('A superseded profile is history and cannot be changed.');
    const { company_id: _ignored, ...change } = dto as unknown as Record<string, unknown>;
    const animals = await this.countAnimals(id);
    const locked = changedLockedFields(stored as unknown as Record<string, unknown>, change);
    if (animals > 0 && locked.length) {
      throw new BadRequestException(
        `${animals} animal(s) are costed by this profile, so its terms are locked (${locked.join(', ')}). Create a new version with a new effective date instead.`,
      );
    }
    const merged = { ...stored, ...change } as unknown as Profile;
    const errors = validateTerms(this.termsOf(merged as any), await this.methodFlags());
    if (errors.length) throw new BadRequestException(errors);
    await this.assertReferences(change, stored.company_id, tenantId);

    const set: Record<string, unknown> = { updated_by: userId ?? null };
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) continue;
      set[k] = typeof v === 'number' && !['start_age_weeks', 'useful_life_months'].includes(k) ? v.toString() : v;
    }
    // An ACTIVE profile's scope key follows its scope; the unique index then refuses a clash.
    if (stored.status === 'ACTIVE') set.active_scope_key = scopeKey(stored.company_id, merged);
    try {
      await this.db.update(schema.bioCostingProfile).set(set).where(eq(schema.bioCostingProfile.profile_id, id));
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ConflictException('Another active profile already has this scope.');
      throw error;
    }
    await this.audit.log({ tenantId, companyId: stored.company_id, userId, action: 'UPDATE', entityName: 'bio_costing_profile', entityId: id, oldValues: stored, newValues: change });
    return this.findOne(id, tenantId);
  }

  private async activationErrors(p: Profile, tenantId: string): Promise<string[]> {
    const glPresent: Record<string, boolean> = {};
    const ids = GL_COLUMNS.map((c) => p[c]).filter((x): x is string => !!x);
    const found = ids.length ? await this.db.select({ id: schema.glAccountMaster.gl_account_id }).from(schema.glAccountMaster).where(and(
      inArray(schema.glAccountMaster.gl_account_id, ids), eq(schema.glAccountMaster.tenant_id, tenantId),
      or(eq(schema.glAccountMaster.company_id, p.company_id), isNull(schema.glAccountMaster.company_id)), eq(schema.glAccountMaster.is_active, true))) : [];
    const ok = new Set(found.map((f) => f.id));
    for (const c of GL_COLUMNS) glPresent[c] = !!p[c] && ok.has(p[c] as string);
    const [rates] = await this.db.select({ n: sql<string>`COUNT(*)` }).from(schema.bioCostingProfileRate).where(eq(schema.bioCostingProfileRate.profile_id, p.profile_id));
    return [...validateTerms(this.termsOf(p as any), await this.methodFlags()), ...validateActivation(this.termsOf(p as any), { glPresent, rateRows: Number(rates?.n ?? 0) })];
  }

  async activate(id: string, tenantId: string, userId?: string) {
    const p = await this.load(id, tenantId);
    if (p.status === 'ACTIVE') return this.findOne(id, tenantId);
    if (p.status === 'SUPERSEDED') throw new BadRequestException('A superseded profile cannot be activated; activate its newer version.');
    const errors = await this.activationErrors(p, tenantId);
    if (errors.length) throw new BadRequestException(errors);
    try {
      await this.db.update(schema.bioCostingProfile)
        .set({ status: 'ACTIVE', active_scope_key: scopeKey(p.company_id, p), updated_by: userId ?? null })
        .where(eq(schema.bioCostingProfile.profile_id, id));
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ConflictException('Another profile is already active for this scope. Deactivate it, or create a new version of it.');
      throw error;
    }
    await this.audit.log({ tenantId, companyId: p.company_id, userId, action: 'ACTIVATE', entityName: 'bio_costing_profile', entityId: id, oldValues: { status: p.status }, newValues: { status: 'ACTIVE' } });
    return this.findOne(id, tenantId);
  }

  async deactivate(id: string, tenantId: string, userId?: string) {
    const p = await this.load(id, tenantId);
    if (p.status !== 'ACTIVE') throw new BadRequestException('Only an active profile can be deactivated.');
    await this.db.update(schema.bioCostingProfile).set({ status: 'INACTIVE', active_scope_key: null, updated_by: userId ?? null }).where(eq(schema.bioCostingProfile.profile_id, id));
    await this.audit.log({ tenantId, companyId: p.company_id, userId, action: 'DEACTIVATE', entityName: 'bio_costing_profile', entityId: id, oldValues: { status: 'ACTIVE' }, newValues: { status: 'INACTIVE' } });
    return this.findOne(id, tenantId);
  }

  /**
   * New terms for animals not yet costed: a copy with the changes and a new effective date, the old profile marked SUPERSEDED
   * (kept, with the animals it already costs). The new one is ACTIVE if the old one was, and must pass activation like any other.
   */
  async newVersion(id: string, dto: NewBioCostingProfileVersionDto, tenantId: string, userId?: string) {
    const old = await this.load(id, tenantId);
    if (old.status === 'SUPERSEDED') throw new BadRequestException('That profile was already superseded; make the new version from its successor.');
    if (dto.effective_from <= old.effective_from) throw new BadRequestException(`The new version must take effect after ${old.effective_from}.`);
    const { company_id: _ignored, profile_code, ...change } = dto as unknown as Record<string, unknown>;
    const code = (profile_code as string | undefined) ?? `${old.profile_code}.${dto.effective_from}`.slice(0, 40);
    const merged = { ...old, ...change, profile_code: code } as unknown as Profile;
    const errors = validateTerms(this.termsOf(merged as any), await this.methodFlags());
    if (errors.length) throw new BadRequestException(errors);
    await this.assertReferences(merged as any, old.company_id, tenantId);

    const newId = randomUUID();
    await withTenantTransaction(this.cls, async () => {
      await this.db.update(schema.bioCostingProfile).set({ status: 'SUPERSEDED', active_scope_key: null, updated_by: userId ?? null }).where(eq(schema.bioCostingProfile.profile_id, id));
      const { profile_id: _p, created_at: _c, updated_at: _u, active_scope_key: _k, ...rest } = merged as any;
      try {
        await this.db.insert(schema.bioCostingProfile).values({ ...rest, profile_id: newId, status: 'DRAFT', supersedes_profile_id: id, created_by: userId ?? null, updated_by: userId ?? null });
      } catch (error) {
        if (isDuplicateEntry(error)) throw new ConflictException(`A costing profile with code '${code}' already exists.`);
        throw error;
      }
      const rates = await this.db.select().from(schema.bioCostingProfileRate).where(eq(schema.bioCostingProfileRate.profile_id, id));
      for (const r of rates) {
        const { rate_id: _r, created_at: _rc, ...rr } = r;
        await this.db.insert(schema.bioCostingProfileRate).values({ ...rr, rate_id: randomUUID(), profile_id: newId, created_by: userId ?? null });
      }
      if (old.status === 'ACTIVE') {
        const fresh = await this.load(newId, tenantId);
        const problems = await this.activationErrors(fresh, tenantId);
        if (problems.length) throw new BadRequestException(problems);
        await this.db.update(schema.bioCostingProfile).set({ status: 'ACTIVE', active_scope_key: scopeKey(old.company_id, fresh) }).where(eq(schema.bioCostingProfile.profile_id, newId));
      }
    });
    await this.audit.log({ tenantId, companyId: old.company_id, userId, action: 'NEW_VERSION', entityName: 'bio_costing_profile', entityId: newId, oldValues: { superseded: id }, newValues: change });
    return this.findOne(newId, tenantId);
  }

  async addRate(id: string, dto: CreateBioCostingRateDto, tenantId: string, userId?: string) {
    const p = await this.load(id, tenantId);
    if (p.costing_method !== 'FAIR_VALUE') throw new BadRequestException('Only a fair-value profile takes rates.');
    if (p.status === 'SUPERSEDED') throw new BadRequestException('A superseded profile takes no new rates; add it to its successor.');
    if (dto.farm_id) {
      const [farm] = await this.db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, dto.farm_id), eq(schema.locationMaster.tenant_id, tenantId), eq(schema.locationMaster.company_id, p.company_id), isNull(schema.locationMaster.parent_location_id))).limit(1);
      if (!farm) throw new BadRequestException('That farm is not a farm of this company.');
    }
    const rate_id = randomUUID();
    await this.db.insert(schema.bioCostingProfileRate).values({
      rate_id, profile_id: id, farm_id: dto.farm_id ?? null, age_week_from: dto.age_week_from ?? 0, effective_from: dto.effective_from,
      expected_weight_kg: dto.expected_weight_kg.toString(), price_per_kg: dto.price_per_kg.toString(), cdm_based: dto.cdm_based ?? false,
      costs_to_sell_pct: dto.costs_to_sell_pct?.toString() ?? null, created_by: userId ?? null,
    });
    await this.audit.log({ tenantId, companyId: p.company_id, userId, action: 'CREATE', entityName: 'bio_costing_profile_rate', entityId: rate_id, newValues: { profile_id: id, ...dto } });
    return this.findOne(id, tenantId);
  }

  /** The profile an animal with these facts is costed by today, or null; ambiguity is the setup's fault and is reported, not guessed. */
  async resolveFor(query: ResolveBioCostingProfileDto, tenantId: string, companyId: string) {
    const profiles = await this.db.select().from(schema.bioCostingProfile)
      .where(and(eq(schema.bioCostingProfile.tenant_id, tenantId), eq(schema.bioCostingProfile.company_id, companyId), inArray(schema.bioCostingProfile.status, ['ACTIVE', 'SUPERSEDED'])));
    const { profile, ambiguous } = resolveProfile(profiles as any, {
      item_id: query.item_id, breed_id: query.breed_id, gender: query.gender, origin: originOf(query.entry_type),
    }, query.on_date ?? today());
    if (ambiguous.length) throw new BadRequestException(`More than one costing profile fits equally (${ambiguous.map((a: any) => a.profile_code).join(', ')}); make one more specific.`);
    return profile as Profile | null;
  }

  /**
   * Freezes an animal to the profile that fits her now and works out the date her costing begins. An animal already assigned keeps hers.
   * No matching profile is not an error: she is simply not costed (reason NO_MATCHING_PROFILE).
   */
  async assignAnimal(animalId: string, tenantId: string, opts: { dryRun?: boolean } = {}) {
    const [a] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), eq(schema.animalRegister.tenant_id, tenantId))).limit(1);
    if (!a) throw new NotFoundException(`Animal '${animalId}' not found.`);
    if (a.costing_profile_id) return { animal_id: animalId, assigned: false, reason: 'ALREADY_ASSIGNED' as const, profile_id: a.costing_profile_id };
    if (!a.is_active) return { animal_id: animalId, assigned: false, reason: 'NOT_ACTIVE' as const };
    const profile = await this.resolveFor({ item_id: a.item_id, breed_id: a.breed_id, gender: a.gender, entry_type: a.entry_type }, tenantId, a.company_id);
    if (!profile) return { animal_id: animalId, assigned: false, reason: 'NO_MATCHING_PROFILE' as const };
    const start = costingStartDate({ dob: a.dob, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks }, profile.start_age_weeks);
    if (!opts.dryRun) {
      await this.db.update(schema.animalRegister).set({ costing_profile_id: profile.profile_id, costing_start_date: start }).where(eq(schema.animalRegister.animal_id, animalId));
    }
    return { animal_id: animalId, assigned: !opts.dryRun, would_assign: !!opts.dryRun, reason: 'OK' as const, profile_id: profile.profile_id, profile_code: profile.profile_code, costing_start_date: start };
  }

  /**
   * An animal's birth date sets when her costing starts (birth + the profile's start age, never before she arrived). Moving the birth date moves that
   * start, and with it the line between feed capitalised and feed expensed and the end of her life, so it is allowed only while nothing has been
   * booked on the old basis: no costing run line, no capitalised or amortised ledger row, no feed or overhead entry against her. Returns the new start.
   */
  async startForNewBirthDate(animalId: string, newDob: string, tenantId: string): Promise<string | null> {
    const [a] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), eq(schema.animalRegister.tenant_id, tenantId))).limit(1);
    if (!a || !a.costing_profile_id) return null;
    const [profile] = await this.db.select().from(schema.bioCostingProfile).where(eq(schema.bioCostingProfile.profile_id, a.costing_profile_id)).limit(1);
    if (!profile) return null;
    const [run] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioCostingRunLine).where(eq(schema.bioCostingRunLine.animal_id, animalId));
    const [ledger] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(
      eq(schema.bioAssetLedger.animal_id, animalId), bioEventsCondition(schema.bioAssetLedger, ['CONSUMPTION', 'OVERHEAD_COST', 'AMORTIZATION', 'FAIR_VALUE_ADJMT'])));
    const [tx] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(schema.batchTransaction).where(and(
      eq(schema.batchTransaction.animal_id, animalId), inArray(schema.batchTransaction.transaction_type, ['CONSUMPTION', 'OVERHEAD'])));
    if (Number(run?.n ?? 0) + Number(ledger?.n ?? 0) + Number(tx?.n ?? 0) > 0) {
      throw new BadRequestException(
        `${a.animal_code}'s birth date sets when her costing starts, so it cannot be changed once feed, medicine, overhead or a costing run has been booked to her. Reverse those first, or leave the birth date as recorded.`,
      );
    }
    return costingStartDate({ dob: newDob, entry_date: String(a.entry_date).slice(0, 10), age_at_entry_weeks: a.age_at_entry_weeks }, profile.start_age_weeks);
  }

  async assignAnimals(dto: AssignBioCostingDto, tenantId: string, companyId: string) {
    const rows = await this.db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(and(
      eq(schema.animalRegister.tenant_id, tenantId), eq(schema.animalRegister.company_id, companyId), eq(schema.animalRegister.is_active, true),
      isNull(schema.animalRegister.costing_profile_id), ...(dto.animal_ids?.length ? [inArray(schema.animalRegister.animal_id, dto.animal_ids)] : [])));
    const results: Array<{ animal_id: string; reason: string } & Record<string, unknown>> = [];
    for (const r of rows) {
      // One animal the setup cannot resolve must not stop the rest: it is reported, with the reason, and left uncosted.
      try {
        results.push(await this.assignAnimal(r.animal_id, tenantId, { dryRun: dto.dry_run }));
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
        results.push({ animal_id: r.animal_id, assigned: false, reason: 'AMBIGUOUS_PROFILES' as const, message: error.message });
      }
    }
    const by: Record<string, number> = {};
    for (const r of results) by[r.reason] = (by[r.reason] ?? 0) + 1;
    return { dry_run: !!dto.dry_run, considered: results.length, by_reason: by, animals: results };
  }
}

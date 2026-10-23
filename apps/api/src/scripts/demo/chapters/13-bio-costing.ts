/**
 * Chapters for the costing seed (`--volume=costing`, `pnpm seed:costing`) — bio-asset costing, Phase 6. Both do nothing on any
 * other volume profile, so the standard demo is unchanged.
 *
 *   `02b-bio-costing-profiles` — runs before the animals are registered. Gives the chart its accumulated-amortisation account
 *     (1065: the client's chart has none), then creates the client's four rules (docs: the Fixed Asset sheet) as central costing
 *     profiles through BioCostingProfileService and activates them with their five GL accounts. Because they exist before the herd
 *     is bought, registration assigns each animal her profile and costing start date by itself: the registration hook is exercised,
 *     not bypassed.
 *   `13-bio-costing-assign` — runs last. Assigns whoever the registration hook did not reach (animals created before a profile
 *     existed) and prints what each profile now costs. It runs no costing period: calculating and posting a run is what is being
 *     tested (docs/TEST-GUIDE-bio-asset-costing-full-flow.md).
 *
 * [ours], awaiting the client: monthly runs, auto-post off, the profiles' effective date (before the herd's purchase, so every
 * animal resolves one), and the fair-value rate (the sheet's 150 kg x 2.05, "CDM based: No"). The GL accounts are the starter chart's
 * 1060 (acquisition), 5100 (amortisation expense), 4020 (fair value gain/loss) and 5010 (write-off), plus the new 1065.
 *
 * Resume-safe: an existing account or profile (by code) is left alone.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BioCostingProfileService } from '../../../modules/finance/bio-costing/bio-costing-profile.service';
import { BioCostingResidualService } from '../../../modules/finance/bio-costing/bio-costing-residual.service';
import * as schema from '../../../core/database/schema';
import { CLIENT_DRAFT_PROFILES, CLIENT_RESIDUALS } from '../../seed-bio-costing-profiles.lib';
import type { DemoChapter, DemoContext } from '../chapter';
import { HERD_BOUGHT_DAYS_BEFORE_WINDOW } from '../register-breeding-stock';

const ACCUMULATED = { account_code: '1065', account_name: 'Accumulated Amortisation - Bio Assets', account_type: 'ASSET' };

const dateDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

function tenantDbOf(ctx: DemoContext, chapter: string): MySql2Database<typeof schema> {
  const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
  if (!db) throw new Error(`${chapter}: tenantDb is not set — run through the harness.`);
  return db;
}

/**
 * The demo item catalog is priced on a different scale from the client's costing sheet: a breeding sow is 28 000 and the sheet's own
 * fair value for a female is 150 kg x 2.05 = 307.50 (USD), a kilo of feed is 28. On those prices every costing run wrote an animal
 * down by tens of thousands, which proves the arithmetic and nothing else. For the costing seed every catalog price is divided by this
 * figure (sow 28 000 -> 466.67, boar 45 000 -> 750, feed 28 -> 0.47/kg), so costs sit beside the sheet's residual and fair value.
 */
export const COSTING_PRICE_DIVISOR = 60;
/** A catalog this expensive per head has not been rescaled yet (the unscaled sow is 28 000; the scaled one is 466.67). */
const UNSCALED_SOW_COST_FLOOR = 5_000;

export const costingPricesChapter: DemoChapter = {
  name: '01b-costing-prices',

  async run(ctx: DemoContext) {
    if (ctx.volume !== 'costing') {
      ctx.log('  not the costing volume — catalog prices left as they are');
      return;
    }
    const db = tenantDbOf(ctx, '01b-costing-prices');
    const [sow] = await db.select({ cost: schema.itemMaster.standard_cost }).from(schema.itemMaster).where(and(
      eq(schema.itemMaster.company_id, ctx.companyId), eq(schema.itemMaster.item_name, 'Mature Parity Breeding Sow')));
    if (!sow || Number(sow.cost ?? 0) < UNSCALED_SOW_COST_FLOOR) {
      ctx.log('  catalog prices already on the costing scale — skipped');
      return;
    }
    await db.update(schema.itemMaster)
      .set({ standard_cost: sql`ROUND(${schema.itemMaster.standard_cost} / ${COSTING_PRICE_DIVISOR}, 4)` })
      .where(and(eq(schema.itemMaster.company_id, ctx.companyId), gt(schema.itemMaster.standard_cost, '0')));
    ctx.log(`  catalog standard costs divided by ${COSTING_PRICE_DIVISOR} (USD scale of the client's costing sheet)`);
  },
};

export const bioCostingProfilesChapter: DemoChapter = {
  name: '02b-bio-costing-profiles',

  async run(ctx: DemoContext) {
    if (ctx.volume !== 'costing') {
      ctx.log('  not the costing volume — no costing profiles');
      return;
    }
    const db = tenantDbOf(ctx, '02b-bio-costing-profiles');
    const profiles = ctx.app.get(BioCostingProfileService);

    const accountOf = async (code: string) => {
      const [row] = await db.select().from(schema.glAccountMaster).where(and(
        eq(schema.glAccountMaster.company_id, ctx.companyId), eq(schema.glAccountMaster.account_code, code)));
      return row;
    };
    const asset = await accountOf('1060');
    const expense = await accountOf('5100');
    const fairValue = await accountOf('4020');
    const writeOff = await accountOf('5010');
    for (const [code, row] of [['1060', asset], ['5100', expense], ['4020', fairValue], ['5010', writeOff]] as const) {
      if (!row) throw new Error(`02b-bio-costing-profiles: the chart has no account ${code}; the starter seed should have created it.`);
    }

    let accumulated = await accountOf(ACCUMULATED.account_code);
    if (!accumulated) {
      await db.insert(schema.glAccountMaster).values({
        tenant_id: ctx.tenantId, company_id: ctx.companyId, nob_id: asset.nob_id, lob_id: asset.lob_id, ...ACCUMULATED,
      });
      accumulated = await accountOf(ACCUMULATED.account_code);
      ctx.log(`  GL ${ACCUMULATED.account_code} ${ACCUMULATED.account_name} created`);
    }

    // Before the herd's purchase (62 days of history + 24 before it), with room to spare, so registration resolves a profile.
    // ... and before the costing walkthrough's purchase (1 Mar 2026, chapter 14), so its months are costed by the settings and profiles in force.
    const effectiveFrom = [dateDaysAgo(ctx.demoFarms[0].volume.days + HERD_BOUGHT_DAYS_BEFORE_WINDOW + 60), '2026-01-01'].sort()[0];
    // The company's residual value: set once here, not on each profile.
    const residuals = ctx.app.get(BioCostingResidualService);
    const haveSex = new Set((await residuals.list(ctx.tenantId, ctx.companyId)).map((r: any) => r.gender));
    for (const r of CLIENT_RESIDUALS) {
      if (haveSex.has(r.gender)) continue;
      await residuals.add({
        gender: r.gender, residual_rule: r.residual_rule, residual_weight_kg: r.residual_weight_kg ?? undefined, residual_price_per_kg: r.residual_price_per_kg ?? undefined,
        effective_from: effectiveFrom, note: r.note,
      } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId);
      ctx.log(`  company residual (${r.gender === 'F' ? 'female' : 'male'}): ${r.residual_rule === 'NONE' ? 'none' : `${r.residual_weight_kg} kg x ${r.residual_price_per_kg}`}, from ${effectiveFrom}`);
    }

    const existing = await profiles.findAll({ companyId: ctx.companyId } as any, ctx.tenantId, ctx.companyId);
    const have = new Set((existing as any[]).map((p) => p.profile_code));
    for (const p of CLIENT_DRAFT_PROFILES) {
      if (have.has(p.profile_code)) {
        ctx.log(`  profile ${p.profile_code} already exists — skipped`);
        continue;
      }
      const made: any = await profiles.create({
        profile_code: p.profile_code, name: p.name, origin: p.origin, gender: p.gender, costing_method: p.costing_method,
        start_age_weeks: p.start_age_weeks, useful_life_months: p.useful_life_months,
        residual_rule: p.residual_rule, residual_weight_kg: p.residual_weight_kg ?? undefined, residual_price_per_kg: p.residual_price_per_kg ?? undefined,
        residual_applies_gender: p.residual_applies_gender ?? undefined,
        run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS', tracking: 'INDIVIDUAL', auto_post: false,
        acquisition_gl_id: asset.gl_account_id, accum_amort_gl_id: accumulated!.gl_account_id, amort_expense_gl_id: expense.gl_account_id,
        fv_gain_loss_gl_id: fairValue.gl_account_id, writeoff_gl_id: writeOff.gl_account_id,
        effective_from: effectiveFrom,
      } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId);
      if (p.rate) {
        await profiles.addRate(made.profile_id, { effective_from: effectiveFrom, expected_weight_kg: p.rate.expected_weight_kg, price_per_kg: p.rate.price_per_kg, cdm_based: p.rate.cdm_based } as any, ctx.tenantId, ctx.actor.userId);
      }
      await profiles.activate(made.profile_id, ctx.tenantId, ctx.actor.userId);
      ctx.log(`  profile ${p.profile_code} (${p.costing_method}, ${p.origin} ${p.gender}) created and activated, effective ${effectiveFrom}`);
    }
  },
};

export const bioCostingAssignChapter: DemoChapter = {
  name: '13-bio-costing-assign',

  async run(ctx: DemoContext) {
    if (ctx.volume !== 'costing') {
      ctx.log('  not the costing volume — nothing to assign');
      return;
    }
    const db = tenantDbOf(ctx, '13-bio-costing-assign');
    const profiles = ctx.app.get(BioCostingProfileService);
    const result: any = await profiles.assignAnimals({} as any, ctx.tenantId, ctx.companyId);
    ctx.log(`  assign sweep: ${result.considered} animal(s) without a profile — ${JSON.stringify(result.by_reason)}`);

    const rows = await db.select({
      code: schema.animalRegister.animal_code, entry: schema.animalRegister.entry_type, gender: schema.animalRegister.gender,
      profile: schema.animalRegister.costing_profile_id, start: schema.animalRegister.costing_start_date,
    }).from(schema.animalRegister).where(and(eq(schema.animalRegister.company_id, ctx.companyId), eq(schema.animalRegister.is_active, true)));
    const all = await profiles.findAll({ companyId: ctx.companyId } as any, ctx.tenantId, ctx.companyId);
    const codeOf = new Map((all as any[]).map((p) => [p.profile_id, p.profile_code]));
    const tally = new Map<string, number>();
    for (const r of rows) {
      const key = r.profile ? codeOf.get(r.profile) ?? 'unknown profile' : 'NO PROFILE';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    ctx.log(`  animals by costing profile: ${[...tally.entries()].map(([k, n]) => `${k}=${n}`).join(', ')}`);
  },
};

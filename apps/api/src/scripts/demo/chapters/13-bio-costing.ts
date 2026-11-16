/**
 * Chapters for the costing seed (`--volume=costing`, `pnpm seed:costing`) — bio-asset costing, Phase 6. Both do nothing on any
 * other volume profile, so the standard demo is unchanged.
 *
 *   `02b-bio-costing-items` — runs before the animals are registered. Gives the chart its accumulated-amortisation account
 *     (1065: the sheet names none), then puts the sheet's costing terms (docs: the Fixed Asset sheet) on the catalog's sow, gilt
 *     and boar items, with their five GL accounts. Because the terms exist before the herd is bought, registration dates each animal's
 *     costing start by itself: the registration hook is exercised, not bypassed.
 *   `13-bio-costing-assign` — runs last. Dates whoever the registration hook did not reach (animals created before the terms existed) and
 *     prints what each item now costs. It runs no costing period: calculating and posting a run is what is being
 *     tested (docs/TEST-GUIDE-bio-asset-costing-full-flow.md).
 *
 * [ours], awaiting confirmation: monthly runs, auto-post off, the items' Costing From date (before the herd's purchase). The GL accounts are
 * the starter chart's 1060 (acquisition), 5100 (amortisation expense), 4020 (fair value gain/loss) and 5010 (write-off), plus the new 1065.
 *
 * Resume-safe: an existing account is left alone, and so is an item that already has costing terms.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { storedBioCosting, validateItemBioCosting } from '../../../modules/master-data/item/item-bio-costing.rules';
import * as schema from '../../../core/database/schema';
import { SHEET_ITEM_TERMS } from '../../seed-bio-costing-items.lib';
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

export const bioCostingItemsChapter: DemoChapter = {
  name: '02b-bio-costing-items',

  async run(ctx: DemoContext) {
    if (ctx.volume !== 'costing') {
      ctx.log('  not the costing volume — no costing terms on the items');
      return;
    }
    const db = tenantDbOf(ctx, '02b-bio-costing-items');

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
      if (!row) throw new Error(`02b-bio-costing-items: the chart has no account ${code}; the starter seed should have created it.`);
    }

    let accumulated = await accountOf(ACCUMULATED.account_code);
    if (!accumulated) {
      await db.insert(schema.glAccountMaster).values({
        tenant_id: ctx.tenantId, company_id: ctx.companyId, nob_id: asset.nob_id, lob_id: asset.lob_id, ...ACCUMULATED,
      });
      accumulated = await accountOf(ACCUMULATED.account_code);
      ctx.log(`  GL ${ACCUMULATED.account_code} ${ACCUMULATED.account_name} created`);
    }

    // Before the herd's purchase (62 days of history + 24 before it), with room to spare, so every animal is already inside the item's window,
    // and before the costing walkthrough's purchase (1 Mar 2026, chapter 14), so its months are costed by the terms in force.
    const costingFrom = [dateDaysAgo(ctx.demoFarms[0].volume.days + HERD_BOUGHT_DAYS_BEFORE_WINDOW + 60), '2026-01-01'].sort()[0];
    for (const t of SHEET_ITEM_TERMS) {
      const [item] = await db.select().from(schema.itemMaster).where(and(
        eq(schema.itemMaster.company_id, ctx.companyId), eq(schema.itemMaster.item_name, t.item_name), eq(schema.itemMaster.is_biological_asset, true)));
      if (!item) throw new Error(`02b-bio-costing-items: the catalog has no biological item '${t.item_name}'.`);
      if (item.bio_costing_method) { ctx.log(`  ${item.item_code} ${t.item_name} already has costing terms — skipped`); continue; }
      const terms = {
        is_biological_asset: true, bio_costing_method: 'AMORTIZATION', bio_gender: t.bio_gender, bio_start_age_weeks: t.bio_start_age_weeks, bio_useful_life_months: t.bio_useful_life_months,
        bio_residual_rule: t.bio_residual_rule, bio_residual_weight_kg: t.bio_residual_weight_kg, bio_residual_price_per_kg: t.bio_residual_price_per_kg,
        bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_effective_from: costingFrom, bio_auto_post: false,
        bio_acquisition_gl_id: asset.gl_account_id, bio_accum_amort_gl_id: accumulated!.gl_account_id, bio_amort_expense_gl_id: expense.gl_account_id,
        bio_fv_gain_loss_gl_id: fairValue.gl_account_id, bio_writeoff_gl_id: writeOff.gl_account_id,
      };
      const problems = validateItemBioCosting(terms);
      if (problems.length) throw new Error(`02b-bio-costing-items: ${t.item_name}: ${problems.join(' ')}`);
      const stored = storedBioCosting(terms);
      await db.update(schema.itemMaster).set({
        ...stored,
        bio_residual_fixed_amount: null,
        bio_residual_weight_kg: stored.bio_residual_weight_kg == null ? null : String(stored.bio_residual_weight_kg),
        bio_residual_price_per_kg: stored.bio_residual_price_per_kg == null ? null : String(stored.bio_residual_price_per_kg),
      } as any).where(eq(schema.itemMaster.item_id, item.item_id));
      ctx.log(`  ${item.item_code} ${t.item_name}: amortised from week ${t.bio_start_age_weeks} over ${t.bio_useful_life_months} months, residual ${t.bio_residual_rule === 'NONE' ? 'none' : `${t.bio_residual_weight_kg} kg x ${t.bio_residual_price_per_kg}`}, costing from ${costingFrom}`);
    }
  },
};

export const bioCostingAssignChapter: DemoChapter = {
  name: '13-bio-costing-assign',

  async run(ctx: DemoContext) {
    if (ctx.volume !== 'costing') {
      ctx.log('  not the costing volume — nothing to date');
      return;
    }
    const db = tenantDbOf(ctx, '13-bio-costing-assign');
    const starts = ctx.app.get(BioCostingStartService);
    const result: any = await starts.assignAnimals({} as any, ctx.tenantId, ctx.companyId);
    ctx.log(`  assign sweep: ${result.considered} animal(s) without a costing start date — ${JSON.stringify(result.by_reason)}`);

    const rows = await db.select({
      item: schema.itemMaster.item_code, start: schema.animalRegister.costing_start_date,
    }).from(schema.animalRegister).innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.animalRegister.item_id))
      .where(and(eq(schema.animalRegister.company_id, ctx.companyId), eq(schema.animalRegister.is_active, true)));
    const tally = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.item}${r.start ? '' : ' (no start date)'}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    ctx.log(`  live animals by item: ${[...tally.entries()].map(([k, n]) => `${k}=${n}`).join(', ')}`);
  },
};

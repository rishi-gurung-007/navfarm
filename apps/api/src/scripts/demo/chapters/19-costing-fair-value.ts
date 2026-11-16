/**
 * Chapter `19-costing-fair-value` — the fair value costing seed (`pnpm seed:costing-fv`, or `pnpm nx run api:db-costing-fv` on an existing database). Two gilts of ONE
 * item costed by FAIR VALUE, nothing else, so every adjustment can be checked by hand. Posted through the application's own services; `verify-costing-fv.ts` reads it
 * back from MySQL against its own arithmetic.
 *
 *   FV-GILT-A  bought 500 on 6 Apr 2026      FV-GILT-B  bought 380 on 6 Apr 2026      both born 2026-01-05, costing starts on arrival (item starts at week 0)
 *
 * The item "Replacement Breeding Gilt" is given FAIR VALUE terms here (it is amortised in the other seeds). Its rate by date, for every farm:
 *   from 1 Apr 2026   120 kg x 2.05/kg, no costs to sell, not CDM-based      -> fair value 246.00 (a LOSS on both animals in April)
 *   from 1 Jul 2026   150 kg x 3.60/kg, 5% costs to sell, CDM-based          -> fair value 513.00 (a GAIN on both animals in July)
 * Whole-herd runs April to September: April loses, May and June change nothing (skipped), July gains, August and September change nothing. Then the July run is
 * REVERSED and calculated and posted again, to prove the reversal of a fair value run. Before any rate exists, a calculation is attempted and MUST be refused.
 *
 * Resume-safe: the receipt by reference, animals by RFID, rates by effective date, runs by (item, period). Prices and rates are demo facts, not real data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import { BioCostingItemService } from '../../../modules/finance/bio-costing/bio-costing-item.service';
import { storedBioCosting, validateItemBioCosting } from '../../../modules/master-data/item/item-bio-costing.rules';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createItemLookup, shedForStage } from '../batch-helpers';

const GRN_ANIMALS = 'DEMO-FV-GRN';
const ENTRY_DATE = '2026-04-06';
const GILT_ITEM = 'Replacement Breeding Gilt';
export const FV_MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
export const FV_REVERSED_MONTH = '2026-07';
export const FV_ANIMALS = [
  { tag: 'FV-GILT-A', price: 500, dob: '2026-01-05', teats: 14 },
  { tag: 'FV-GILT-B', price: 380, dob: '2026-01-05', teats: 15 },
] as const;
export const FV_RATES = [
  { effective_from: '2026-04-01', expected_weight_kg: 120, price_per_kg: 2.05, costs_to_sell_pct: undefined, cdm_based: false },
  { effective_from: '2026-07-01', expected_weight_kg: 150, price_per_kg: 3.6, costs_to_sell_pct: 5, cdm_based: true },
] as const;

const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export const costingFairValueChapter: DemoChapter = {
  name: '19-costing-fair-value',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const starts = ctx.app.get(BioCostingStartService);
    const runs = ctx.app.get(BioCostingRunService);
    const itemRates = ctx.app.get(BioCostingItemService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('19-costing-fair-value: tenantDb is not set — run through the harness.');
    const actor = ctx.actor.userId;

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('19-costing-fair-value: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    const item = createItemLookup(db, ctx.companyId);
    const gilt = await item(GILT_ITEM);

    // ── 1. Fair value terms on the gilt item (before the animals, so registration dates their costing start).
    const accountOf = async (code: string) => {
      const [row] = await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.company_id, ctx.companyId), eq(schema.glAccountMaster.account_code, code)));
      if (!row) throw new Error(`19-costing-fair-value: the chart has no account ${code}; the starter seed should have created it.`);
      return row;
    };
    const [asset, fairValue, writeOff] = [await accountOf('1060'), await accountOf('4020'), await accountOf('5010')];
    const [current] = await db.select({ method: schema.itemMaster.bio_costing_method }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, gilt.item_id));
    if (current?.method === 'FAIR_VALUE') ctx.log(`  ${GILT_ITEM} already has fair value terms — skipped`);
    else {
      if (current?.method) throw new Error(`19-costing-fair-value: ${GILT_ITEM} already has ${current.method} terms; run this on the costing-fv preset, not after another costing seed.`);
      const terms = {
        is_biological_asset: true, bio_costing_method: 'FAIR_VALUE', bio_gender: 'F', bio_start_age_weeks: 0, bio_residual_rule: 'NONE',
        bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_effective_from: '2026-04-01', bio_auto_post: false,
        bio_acquisition_gl_id: asset.gl_account_id, bio_fv_gain_loss_gl_id: fairValue.gl_account_id, bio_writeoff_gl_id: writeOff.gl_account_id,
      };
      const problems = validateItemBioCosting(terms);
      if (problems.length) throw new Error(`19-costing-fair-value: ${problems.join(' ')}`);
      await db.update(schema.itemMaster).set({ ...storedBioCosting(terms), bio_residual_fixed_amount: null, bio_residual_weight_kg: null, bio_residual_price_per_kg: null } as any).where(eq(schema.itemMaster.item_id, gilt.item_id));
      ctx.log(`  ${GILT_ITEM}: FAIR VALUE terms set, costing from 2026-04-01`);
    }

    // ── 2. Two gilts bought on one receipt.
    let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, GRN_ANIMALS)).limit(1);
    if (!receipt) {
      const created = await receipts.create({
        company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: ENTRY_DATE, external_reference_no: GRN_ANIMALS, remarks: 'DEMO fair value costing: two gilts',
        lines: FV_ANIMALS.map((a) => ({ item_id: gilt.item_id, quantity: 1, uom: 'HEAD', rate: a.price, lot_no: `${a.tag}-LOT` })),
      } as any, ctx.tenantId);
      receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
    }
    if (receipt.status === 'DRAFT') { await receipts.post(receipt.receipt_id, ctx.tenantId); ctx.log(`  goods receipt ${GRN_ANIMALS} posted (${ENTRY_DATE})`); }

    const stage = breed.lifecycleStages.get('INSEMINATION');
    if (!stage) throw new Error('19-costing-fair-value: the sow breed needs an INSEMINATION lifecycle row.');
    const pens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const ids: string[] = [];
    for (const a of FV_ANIMALS) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: 'GILT', breed_id: breed.breedId, gender: 'F', entry_type: 'PURCHASED_IMPORTED', entry_date: ENTRY_DATE, dob: a.dob,
          source_receipt_id: receipt.receipt_id, item_id: gilt.item_id, rfid_tag: a.tag, current_location_id: pens[0], current_stage_id: stage, no_of_teats: a.teats,
          notes: 'Fair value costing demo gilt',
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}), bought at ${a.price}`);
      }
      ids.push(row.animal_id);
    }
    await starts.assignAnimals({ animal_ids: ids } as any, ctx.tenantId, ctx.companyId);

    // ── 3. No rate yet: a calculation must be refused, and leave nothing behind.
    const existingRates = await itemRates.listRates(gilt.item_id, ctx.tenantId);
    if (!existingRates.length) {
      let refused = '';
      try { await runs.calculate({ item_id: gilt.item_id, period_key: FV_MONTHS[0] } as any, ctx.tenantId, actor); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
      if (!/no fair-value rate/i.test(refused)) throw new Error(`19-costing-fair-value: a calculation with no rate was NOT refused (${refused || 'it succeeded'}).`);
      ctx.log(`  no rate yet: calculation refused as it must be — "${refused}"`);
    }

    // ── 4. The rates by date.
    for (const r of FV_RATES) {
      if (existingRates.some((e) => String(e.effective_from).slice(0, 10) === r.effective_from)) continue;
      await itemRates.addRate(gilt.item_id, { ...r, costs_to_sell_pct: r.costs_to_sell_pct } as any, ctx.tenantId, actor);
      ctx.log(`  rate from ${r.effective_from}: ${r.expected_weight_kg} kg x ${r.price_per_kg}${r.costs_to_sell_pct ? `, ${r.costs_to_sell_pct}% costs to sell` : ''}${r.cdm_based ? ', CDM-based' : ''}`);
    }

    // ── 5. The months in order: calculate (whole herd) and post. Nothing in the future.
    const last = today();
    for (const month of FV_MONTHS) {
      if (monthEnd(month) > last) break;
      let result: { runs: any[]; failed: Array<{ item_code: string; error: string }> };
      try {
        result = await runs.calculateBatch({ period_key: month } as any, ctx.tenantId, ctx.companyId, actor) as any;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`  run ${month}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`);
        continue;
      }
      for (const f of result.failed) ctx.log(`  run ${month} ${f.item_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
      for (const run of result.runs) {
        if (run.status === 'POSTED') continue;
        const posted: any = await runs.post(run.run_id, ctx.tenantId, actor);
        ctx.log(`  run ${month} ${posted.run_no}: ${posted.charged_count} charged, ${posted.skipped_count} skipped, total ${posted.total_charge}`);
      }
    }

    // ── 6. Reverse the July run and make it again — only once, and only when the later months have not been run behind it.
    const R = schema.bioCostingRun;
    const julyRuns = await db.select({ id: R.run_id, no: R.run_no, status: R.status }).from(R).where(and(eq(R.item_id, gilt.item_id), eq(R.period_key, FV_REVERSED_MONTH)));
    if (julyRuns.some((r) => r.status === 'REVERSED')) ctx.log(`  ${FV_REVERSED_MONTH}: already reversed and re-run — skipped`);
    else {
      const posted = julyRuns.find((r) => r.status === 'POSTED');
      if (!posted) throw new Error(`19-costing-fair-value: no posted ${FV_REVERSED_MONTH} run to reverse.`);
      // A period cannot be reversed behind a later posted one: the later months posted nothing (no change) but are still POSTED headers, so they go first, newest first.
      const laterRuns = await db.select({ id: R.run_id, no: R.run_no, key: R.period_key }).from(R).where(and(eq(R.item_id, gilt.item_id), eq(R.status, 'POSTED'), inArray(R.period_key, FV_MONTHS.filter((m) => m > FV_REVERSED_MONTH))));
      for (const l of laterRuns.sort((a, b) => b.key.localeCompare(a.key))) { await runs.reverse(l.id, 'fair value seed: re-running July', ctx.tenantId, actor); ctx.log(`  ${l.key} ${l.no}: reversed (to re-run July)`); }
      await runs.reverse(posted.id, 'fair value seed: July rate corrected, re-run', ctx.tenantId, actor);
      ctx.log(`  ${FV_REVERSED_MONTH} ${posted.no}: reversed`);
      for (const month of FV_MONTHS.filter((m) => m >= FV_REVERSED_MONTH)) {
        if (monthEnd(month) > last) break;
        const made: any = await runs.calculateBatch({ period_key: month } as any, ctx.tenantId, ctx.companyId, actor);
        for (const run of made.runs) {
          const p: any = await runs.post(run.run_id, ctx.tenantId, actor);
          ctx.log(`  re-run ${month} ${p.run_no}: ${p.charged_count} charged, ${p.skipped_count} skipped, total ${p.total_charge}`);
        }
      }
    }

    const rows = await db.select({ tag: schema.animalRegister.rfid_tag, bv: schema.animalRegister.book_value }).from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, ids));
    ctx.log(`  fair value: ${rows.map((r) => `${r.tag} book value=${r.bv}`).join(' | ')}`);
  },
};

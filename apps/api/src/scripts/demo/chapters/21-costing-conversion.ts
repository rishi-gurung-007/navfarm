/**
 * Chapter `21-costing-conversion` — the FA to Inventory conversion seed (`pnpm seed:costing-conv`, or `pnpm nx run api:db-costing-conv` on an existing database).
 * TDD row 11 (Sale of Fixed Asset / Cull), proved end to end through the application's own services; `verify-costing-conv.ts` reads it back from MySQL.
 *
 *   CONV-LOSS  sow bought 900 on 2026-01-05, converted at a market value of 600   -> a LOSS against her book value
 *   CONV-GAIN  sow bought 400 on 2026-01-05, converted at a market value of 450   -> a GAIN against her book value
 *
 * Both are amortised by the sow item (monthly, 36 months, no residual) and costed January to September. Both are taken out of production on 2026-09-15 and converted on
 * 2026-10-05. The chapter itself asserts the refusals (it stops with an error when one is NOT refused): a direct cull of a costed breeding animal; a request before the
 * out-of-production date; approval by the person who raised the request; posting before Finance approves. Then request -> approve (a different user, with the market
 * value) -> post.
 *
 * Resume-safe: receipt by reference, animals by RFID, each step by the conversion's status. Prices and values are demo facts, not real data.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { FaConversionService } from '../../../modules/piggery/animal/fa-conversion/fa-conversion.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import { storedBioCosting, validateItemBioCosting } from '../../../modules/master-data/item/item-bio-costing.rules';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createItemLookup, shedForStage } from '../batch-helpers';

const ACCUMULATED = { account_code: '1065', account_name: 'Accumulated Amortisation - Bio Assets', account_type: 'ASSET' };
const SOW_ITEM = 'Mature Parity Breeding Sow';
const ENTRY = '2026-01-05';
const OUT_OF_PRODUCTION = '2026-09-15';
export const CONVERSION_DATE = '2026-10-05';
export const CONV_ANIMALS = [
  { tag: 'CONV-LOSS', price: 900, market: 600 },
  { tag: 'CONV-GAIN', price: 400, market: 450 },
] as const;
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export const costingConversionChapter: DemoChapter = {
  name: '21-costing-conversion',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const conversions = ctx.app.get(FaConversionService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const starts = ctx.app.get(BioCostingStartService);
    const runs = ctx.app.get(BioCostingRunService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('21-costing-conversion: tenantDb is not set — run through the harness.');
    const actor = ctx.actor.userId;
    const refused = async (what: string, expect: RegExp, work: () => Promise<unknown>) => {
      let message = '';
      try { await work(); } catch (e) { message = e instanceof Error ? e.message : String(e); }
      if (!expect.test(message)) throw new Error(`21-costing-conversion: ${what} was NOT refused as it must be (${message || 'it succeeded'}).`);
      ctx.log(`  refused as it must be — ${what}: "${message}"`);
    };

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('21-costing-conversion: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    const item = createItemLookup(db, ctx.companyId);

    // ── 1. Accounts, the conversion's GL mapping (existing tenants do not get it from the starter seed) and the sow item's terms.
    const accountOf = async (code: string) => (await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.company_id, ctx.companyId), eq(schema.glAccountMaster.account_code, code))))[0];
    const must = async (code: string) => { const r = await accountOf(code); if (!r) throw new Error(`21-costing-conversion: the chart has no account ${code}; the starter seed should have created it.`); return r; };
    const [asset, finished, expense, fairValue, writeOff] = [await must('1060'), await must('1030'), await must('5100'), await must('4020'), await must('5010')];
    let accumulated = await accountOf(ACCUMULATED.account_code);
    if (!accumulated) {
      await db.insert(schema.glAccountMaster).values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, nob_id: asset.nob_id, lob_id: asset.lob_id, ...ACCUMULATED });
      accumulated = await accountOf(ACCUMULATED.account_code);
      ctx.log(`  GL ${ACCUMULATED.account_code} created`);
    }
    const M = schema.glMappingMaster;
    const [mapped] = await db.select({ id: M.mapping_id }).from(M).where(and(eq(M.company_id, ctx.companyId), eq(M.transaction_type, 'BIO_FA_CONVERSION')));
    if (!mapped) {
      await db.insert(M).values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, transaction_type: 'BIO_FA_CONVERSION', debit_gl_account_id: finished.gl_account_id, credit_gl_account_id: asset.gl_account_id, is_active: true, status: 'ACTIVE' } as any);
      ctx.log('  GL mapping BIO_FA_CONVERSION created: Dr 1030 Finished Goods / Cr 1060 Biological Assets [ours, awaiting Finance]');
    }
    const sow = await item(SOW_ITEM);
    const [current] = await db.select({ method: schema.itemMaster.bio_costing_method }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, sow.item_id));
    if (current?.method) ctx.log(`  ${SOW_ITEM} already has its terms — skipped`);
    else {
      const terms = {
        is_biological_asset: true, bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 0, bio_useful_life_months: 36, bio_residual_rule: 'NONE',
        bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_effective_from: '2026-01-01', bio_auto_post: false,
        bio_acquisition_gl_id: asset.gl_account_id, bio_accum_amort_gl_id: accumulated!.gl_account_id, bio_amort_expense_gl_id: expense.gl_account_id,
        bio_fv_gain_loss_gl_id: fairValue.gl_account_id, bio_writeoff_gl_id: writeOff.gl_account_id,
      };
      const problems = validateItemBioCosting(terms);
      if (problems.length) throw new Error(`21-costing-conversion: ${problems.join(' ')}`);
      await db.update(schema.itemMaster).set({ ...storedBioCosting(terms), bio_residual_fixed_amount: null, bio_residual_weight_kg: null, bio_residual_price_per_kg: null } as any).where(eq(schema.itemMaster.item_id, sow.item_id));
      ctx.log(`  ${SOW_ITEM}: amortised monthly over 36 months, no residual, from 2026-01-01`);
    }

    // ── 2. Two sows on one receipt.
    const ref = 'DEMO-CONV-GRN';
    let [receipt] = await db.select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
    if (!receipt) {
      const created = await receipts.create({
        company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: ENTRY, external_reference_no: ref, remarks: 'DEMO conversion: two sows',
        lines: CONV_ANIMALS.map((a) => ({ item_id: sow.item_id, quantity: 1, uom: 'HEAD', rate: a.price, lot_no: `${a.tag}-LOT` })),
      } as any, ctx.tenantId);
      receipt = { id: created.receipt_id, status: 'DRAFT' };
    }
    if (receipt.status === 'DRAFT') { await receipts.post(receipt.id, ctx.tenantId); ctx.log(`  goods receipt ${ref} posted (${ENTRY})`); }
    const stage = breed.lifecycleStages.get('INSEMINATION');
    if (!stage) throw new Error('21-costing-conversion: the sow breed needs an INSEMINATION lifecycle row.');
    const pens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const ids = new Map<string, string>();
    for (const a of CONV_ANIMALS) {
      let [row] = await db.select({ id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: 'SOW', breed_id: breed.breedId, gender: 'F', entry_type: 'PURCHASED_IMPORTED', entry_date: ENTRY, dob: '2025-10-06',
          source_receipt_id: receipt.id, item_id: sow.item_id, rfid_tag: a.tag, current_location_id: pens[0], current_stage_id: stage, no_of_teats: 14, notes: 'Conversion demo sow',
        } as any, ctx.tenantId);
        row = { id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}), bought at ${a.price}`);
      }
      ids.set(a.tag, row.id);
    }
    await starts.assignAnimals({ animal_ids: [...ids.values()] } as any, ctx.tenantId, ctx.companyId);

    // ── 3. January to September costed and posted, the whole herd of the item each month.
    const last = new Date().toISOString().slice(0, 10);
    const stillHeld = (await db.select({ id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(and(inArray(schema.animalRegister.animal_id, [...ids.values()]), eq(schema.animalRegister.is_active, true)))).length;
    if (!stillHeld) ctx.log('  both animals already converted — the monthly runs are history, skipped');
    for (const month of stillHeld ? MONTHS : []) {
      if (monthEnd(month) > last) break;
      try {
        const made: any = await runs.calculateBatch({ period_key: month } as any, ctx.tenantId, ctx.companyId, actor);
        for (const run of made.runs) {
          if (run.status === 'POSTED') continue;
          const p: any = await runs.post(run.run_id, ctx.tenantId, actor);
          ctx.log(`  run ${month} ${p.run_no}: ${p.charged_count} charged, total ${p.total_charge}`);
        }
        for (const f of made.failed) ctx.log(`  run ${month} ${f.item_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`  run ${month}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`);
      }
    }

    // ── 4. The conversions.
    const [other] = await db.select({ id: schema.userMaster.user_id }).from(schema.userMaster).where(and(ne(schema.userMaster.user_id, actor), eq(schema.userMaster.is_active, true))).limit(1);
    if (!other) throw new Error('21-costing-conversion: a second active user is needed to approve (the requester cannot).');
    const T = schema.faInventoryConversion;
    const first = ids.get('CONV-LOSS')!;
    const [existing] = await db.select({ id: T.conversion_id }).from(T).where(eq(T.animal_id, first)).limit(1);
    if (!existing) {
      await refused('a direct cull of a costed breeding animal', /costed breeding asset/, () => animals.dispose(first, { disposal_type: 'CULLED', disposal_date: CONVERSION_DATE, exit_weight_kg: 190, disposal_destination: 'Abattoir', disposal_value: 500 } as any, ctx.tenantId, { userId: actor }));
      await refused('a conversion request before the out-of-production date', /out-of-production date first/, () => conversions.request({ animal_id: first } as any, ctx.tenantId, actor));
    }
    for (const a of CONV_ANIMALS) {
      const id = ids.get(a.tag)!;
      const [animal] = await db.select({ oop: schema.animalRegister.out_of_production_date, active: schema.animalRegister.is_active }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, id));
      if (!animal.active) { ctx.log(`  ${a.tag}: already converted — skipped`); continue; }
      if (!animal.oop) { await animals.markOutOfProduction(id, { out_of_production_date: OUT_OF_PRODUCTION } as any, ctx.tenantId, { userId: actor }); ctx.log(`  ${a.tag}: out of production on ${OUT_OF_PRODUCTION}`); }
      let [conv] = await db.select({ id: T.conversion_id, status: T.status }).from(T).where(eq(T.animal_id, id)).limit(1);
      if (!conv) {
        const made: any = await conversions.request({ animal_id: id, exit_weight_kg: 185 } as any, ctx.tenantId, actor);
        conv = { id: made.conversion_id, status: made.status };
        ctx.log(`  ${a.tag}: conversion ${made.conversion_no} requested`);
      }
      if (conv.status === 'REQUESTED') {
        await refused('approval by the person who raised the request', /another Finance user/, () => conversions.approve(conv.id, { market_value: a.market } as any, ctx.tenantId, actor));
        await refused('posting before Finance approves', /must approve it/, () => conversions.post(conv.id, { conversion_date: CONVERSION_DATE } as any, ctx.tenantId, other.id));
        const approved: any = await conversions.approve(conv.id, { market_value: a.market } as any, ctx.tenantId, other.id);
        ctx.log(`  ${a.tag}: ${approved.conversion_no} approved at market value ${a.market}`);
        conv.status = 'APPROVED';
      }
      if (conv.status === 'APPROVED') {
        const posted: any = await conversions.post(conv.id, { conversion_date: CONVERSION_DATE } as any, ctx.tenantId, other.id);
        ctx.log(`  ${a.tag}: ${posted.conversion_no} posted — book value ${posted.nbv_at_conversion}, market value ${posted.market_value}, gain/loss ${posted.gain_loss}`);
      }
    }
    const rows = await db.select({ tag: schema.animalRegister.rfid_tag, status: schema.animalRegister.status, bv: schema.animalRegister.book_value }).from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, [...ids.values()]));
    ctx.log(`  conversion: ${rows.map((r) => `${r.tag} ${r.status} book value=${r.bv}`).join(' | ')}`);
  },
};

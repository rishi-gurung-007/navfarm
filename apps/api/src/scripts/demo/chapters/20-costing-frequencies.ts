/**
 * Chapter `20-costing-frequencies` — proves the run frequencies, the day basis, auto-post and the scheduler (`pnpm seed:costing-freq`, or `pnpm nx run api:db-costing-freq` on
 * an existing database). Three animals, one per item, bought and left alone (no feed, no overhead): only the costing, so every figure can be checked by hand.
 * Nothing is calculated by hand-picked month: the SCHEDULER's own pass (`runDueForTenant`, the function its 02:00 timer calls) works out what is due and does it.
 *
 *   Q-SOW     sow item   QUARTERLY  frequency-days basis (90)  auto-post OFF   born 2025-10-06, bought 900 on 2026-01-05    -> 2026-Q1, Q2, Q3
 *   ACT-BOAR  boar item  MONTHLY    ACTUAL days                auto-post ON    born 2025-06-02, bought 1200 on 2026-04-06   -> April to September, three periods a pass
 *   Y-GILT    gilt item  YEARLY     frequency-days basis (360) auto-post OFF   born 2025-01-06, bought 600 on 2025-03-03    -> 2025 (2026 has not finished)
 *
 * What the chapter itself asserts (it stops with an error otherwise): the first pass makes one run for each item; the auto-post item's three runs are POSTED, the others
 * wait CALCULATED for a person, and nothing is posted behind a waiting run; a later pass has nothing due. A person (this chapter) posts what waits, and the passes
 * go on until nothing is due. `verify-costing-freq.ts` reads the result back from MySQL.
 *
 * The first pass goes in through `tick()`, the timer's own entry point (enabled for that call only); the later passes call the pass directly. What is NOT exercised is the
 * clock firing `tick()` at 02:00. Resume-safe: receipts by reference, animals by RFID, runs by period.
 * Prices and terms are demo facts, not real data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import { BioCostingSchedulerService } from '../../../modules/finance/bio-costing/bio-costing-scheduler.service';
import { AlertService } from '../../../modules/production/alert/alert.service';
import { BIO_COSTING_ALERT_TYPE } from '../../../modules/finance/bio-costing/bio-costing.notice';
import { FARM_SCOPE_KEY } from '../../../common/farm-scope';
import { storedBioCosting, validateItemBioCosting } from '../../../modules/master-data/item/item-bio-costing.rules';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createItemLookup, shedForStage } from '../batch-helpers';

const ACCUMULATED = { account_code: '1065', account_name: 'Accumulated Amortisation - Bio Assets', account_type: 'ASSET' };

export const FREQ_ANIMALS = [
  { tag: 'Q-SOW', kind: 'SOW', gender: 'F', item: 'Mature Parity Breeding Sow', stageKey: 'INSEMINATION', dob: '2025-10-06', entry: '2026-01-05', price: 900, teats: 14,
    terms: { run: 'QUARTERLY', basis: 'FREQUENCY_DAYS', life: 36, auto: false, from: '2026-01-01' } },
  { tag: 'ACT-BOAR', kind: 'BOAR', gender: 'M', item: 'Mature Herd Sire Boar', stageKey: 'QUARANTINE', dob: '2025-06-02', entry: '2026-04-06', price: 1200, teats: undefined,
    terms: { run: 'MONTHLY', basis: 'ACTUAL', life: 18, auto: true, from: '2026-04-01' } },
  { tag: 'Y-GILT', kind: 'GILT', gender: 'F', item: 'Replacement Breeding Gilt', stageKey: 'INSEMINATION', dob: '2025-01-06', entry: '2025-03-03', price: 600, teats: 15,
    terms: { run: 'YEARLY', basis: 'FREQUENCY_DAYS', life: 36, auto: false, from: '2025-01-01' } },
] as const;

const MAX_PASSES = 12;

export const costingFrequenciesChapter: DemoChapter = {
  name: '20-costing-frequencies',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const starts = ctx.app.get(BioCostingStartService);
    const runs = ctx.app.get(BioCostingRunService);
    const scheduler = ctx.app.get(BioCostingSchedulerService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('20-costing-frequencies: tenantDb is not set — run through the harness.');
    const actor = ctx.actor.userId;

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('20-costing-frequencies: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    const item = createItemLookup(db, ctx.companyId);

    // ── 1. The accounts, then each item's terms (before the animals, so registration dates their costing start).
    const accountOf = async (code: string) => {
      const [row] = await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.company_id, ctx.companyId), eq(schema.glAccountMaster.account_code, code)));
      return row;
    };
    const must = async (code: string) => { const row = await accountOf(code); if (!row) throw new Error(`20-costing-frequencies: the chart has no account ${code}; the starter seed should have created it.`); return row; };
    const [asset, expense, fairValue, writeOff] = [await must('1060'), await must('5100'), await must('4020'), await must('5010')];
    let accumulated = await accountOf(ACCUMULATED.account_code);
    if (!accumulated) {
      await db.insert(schema.glAccountMaster).values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, nob_id: asset.nob_id, lob_id: asset.lob_id, ...ACCUMULATED });
      accumulated = await accountOf(ACCUMULATED.account_code);
      ctx.log(`  GL ${ACCUMULATED.account_code} ${ACCUMULATED.account_name} created`);
    }
    for (const a of FREQ_ANIMALS) {
      const row = await item(a.item);
      const [current] = await db.select({ method: schema.itemMaster.bio_costing_method, run: schema.itemMaster.bio_run_frequency }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, row.item_id));
      if (current?.method) {
        if (current.run !== a.terms.run) throw new Error(`20-costing-frequencies: ${a.item} already has ${current.method} terms (${current.run}); run this on the costing-freq preset, not after another costing seed.`);
        ctx.log(`  ${a.item} already has its terms — skipped`);
        continue;
      }
      const terms = {
        is_biological_asset: true, bio_costing_method: 'AMORTIZATION', bio_gender: a.gender, bio_start_age_weeks: 0, bio_useful_life_months: a.terms.life, bio_residual_rule: 'NONE',
        bio_run_frequency: a.terms.run, bio_day_basis: a.terms.basis, bio_effective_from: a.terms.from, bio_auto_post: a.terms.auto,
        bio_acquisition_gl_id: asset.gl_account_id, bio_accum_amort_gl_id: accumulated!.gl_account_id, bio_amort_expense_gl_id: expense.gl_account_id,
        bio_fv_gain_loss_gl_id: fairValue.gl_account_id, bio_writeoff_gl_id: writeOff.gl_account_id,
      };
      const problems = validateItemBioCosting(terms);
      if (problems.length) throw new Error(`20-costing-frequencies: ${a.item}: ${problems.join(' ')}`);
      await db.update(schema.itemMaster).set({ ...storedBioCosting(terms), bio_residual_fixed_amount: null, bio_residual_weight_kg: null, bio_residual_price_per_kg: null } as any).where(eq(schema.itemMaster.item_id, row.item_id));
      ctx.log(`  ${a.item}: ${a.terms.run}, ${a.terms.basis === 'ACTUAL' ? 'actual days' : 'frequency days'}, life ${a.terms.life} months, auto-post ${a.terms.auto ? 'ON' : 'off'}, from ${a.terms.from}`);
    }

    // ── 2. Each animal on her own receipt, dated the day she arrived.
    const ids: string[] = [];
    for (const a of FREQ_ANIMALS) {
      const it = await item(a.item);
      const ref = `DEMO-FQ-GRN-${a.tag}`;
      let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      if (!receipt) {
        const created = await receipts.create({
          company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: a.entry, external_reference_no: ref, remarks: `DEMO frequencies costing: ${a.tag}`,
          lines: [{ item_id: it.item_id, quantity: 1, uom: 'HEAD', rate: a.price, lot_no: `${a.tag}-LOT` }],
        } as any, ctx.tenantId);
        receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
      }
      if (receipt.status === 'DRAFT') { await receipts.post(receipt.receipt_id, ctx.tenantId); ctx.log(`  goods receipt ${ref} posted (${a.entry})`); }
      const stage = breed.lifecycleStages.get(a.stageKey);
      if (!stage) throw new Error(`20-costing-frequencies: the sow breed needs a ${a.stageKey} lifecycle row.`);
      const pens = shedForStage(farm, a.stageKey)?.penIds ?? (a.kind === 'BOAR' ? pensForRole(farm, 'BOAR') : pensForRole(farm, 'DRY_SOW', 'GILT'));
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: a.gender, entry_type: 'PURCHASED_IMPORTED', entry_date: a.entry, dob: a.dob,
          source_receipt_id: receipt.receipt_id, item_id: it.item_id, rfid_tag: a.tag, current_location_id: pens[0], current_stage_id: stage, no_of_teats: a.teats, notes: 'Frequencies costing demo animal',
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}), born ${a.dob}, bought at ${a.price} on ${a.entry}`);
      }
      ids.push(row.animal_id);
    }
    await starts.assignAnimals({ animal_ids: ids } as any, ctx.tenantId, ctx.companyId);

    // ── 2b. The notice (Phase 4): before anything has run, each item is due; telling Finance twice must not say it twice.
    const A = schema.notificationAlertLog;
    const noticeCount = async () => (await db.select({ id: A.alert_id }).from(A).where(eq(A.alert_type, BIO_COSTING_ALERT_TYPE))).length;
    const fresh = (await noticeCount()) === 0;
    const raisedFirst = await scheduler.notifyDueForTenant(ctx.tenantId, ctx.companyId);
    const raisedAgain = await scheduler.notifyDueForTenant(ctx.tenantId, ctx.companyId);
    if (raisedAgain !== 0) throw new Error(`20-costing-frequencies: telling Finance a second time raised ${raisedAgain} more notice(s); it must raise none.`);
    if (fresh && raisedFirst !== 3) throw new Error(`20-costing-frequencies: three items are due, but ${raisedFirst} notice(s) were raised.`);
    ctx.log(`  notices: ${raisedFirst} raised for the three due items, ${raisedAgain} on telling again`);

    // ── 3. The scheduler's own pass, again and again, with a person posting what waits.
    const R = schema.bioCostingRun;
    const countRuns = async () => (await db.select({ id: R.run_id, status: R.status, key: R.period_key, item: R.item_id }).from(R));
    const before = await countRuns();
    let firstPass = before.length === 0;
    for (let pass = 1; pass <= MAX_PASSES; pass++) {
      // The first pass goes in through the timer's own entry point, tick(): it walks the active tenants and runs this same pass. Only the clock firing it is left out.
      const viaTimer = firstPass && pass === 1;
      let results: Awaited<ReturnType<typeof scheduler.runDueForTenant>> = [];
      if (viaTimer) {
        const was = process.env.BIO_COSTING_SCHEDULER_ENABLED;
        process.env.BIO_COSTING_SCHEDULER_ENABLED = 'true';
        try { await scheduler.tick(); } finally { if (was === undefined) delete process.env.BIO_COSTING_SCHEDULER_ENABLED; else process.env.BIO_COSTING_SCHEDULER_ENABLED = was; }
        ctx.log('  scheduler pass 1: through tick(), the timer\'s entry point');
      } else {
        results = await scheduler.runDueForTenant(ctx.tenantId, { companyId: ctx.companyId, trigger: 'SCHEDULED', userId: actor });
        ctx.log(`  scheduler pass ${pass}: ${results.map((r) => `${r.item_code} ${r.outcome}${'runs' in r ? ` (${r.runs.map((x) => `${x.period_key} ${x.status}`).join(', ')})` : ''}`).join(' | ')}`);
      }
      if (firstPass && pass === 1) {
        const made = await countRuns();
        const posted = made.filter((m) => m.status === 'POSTED').length;
        const waiting = made.filter((m) => m.status === 'CALCULATED').length;
        if (posted !== 3 || waiting !== 2) throw new Error(`20-costing-frequencies: the first pass should post the auto-post item's three runs and leave two waiting; it posted ${posted} and left ${waiting} waiting.`);
        ctx.log('  first pass: the auto-post item posted its three periods; the other two items calculated one run each and wait for a person — as it must');
        const raised = await scheduler.notifyDueForTenant(ctx.tenantId, ctx.companyId);
        if (raised !== 3) throw new Error(`20-costing-frequencies: after the first pass two runs wait to be posted and the boar has three more periods due: expected 3 notices, ${raised} raised.`);
        ctx.log(`  notices after the first pass: ${raised} raised (two runs waiting to be posted, the boar's next periods due)`);
      }
      const waitingRuns = await db.select({ id: R.run_id, no: R.run_no, key: R.period_key }).from(R).where(eq(R.status, 'CALCULATED'));
      for (const w of waitingRuns) { const p: any = await runs.post(w.id, ctx.tenantId, actor); ctx.log(`  a person posts ${p.run_no} (${p.period_key}): total ${p.total_charge}`); }
      if (!viaTimer && !waitingRuns.length && results.every((r) => r.outcome === 'NOTHING_DUE')) { ctx.log(`  scheduler pass ${pass}: nothing is due — done`); break; }
      if (pass === MAX_PASSES) throw new Error(`20-costing-frequencies: the scheduler still had work after ${MAX_PASSES} passes.`);
    }

    // ── 4. Who can see the notices in the Alerts list: the company's users do; a user held to one farm does not.
    const cls = ctx.app.get(ClsService);
    const alerts = ctx.app.get(AlertService);
    const seen = async (scope: object) => { cls.set(FARM_SCOPE_KEY, scope); return (await alerts.findAll({ companyId: ctx.companyId } as any, ctx.tenantId)).filter((a: any) => a.alert_type === BIO_COSTING_ALERT_TYPE).length; };
    const total = await noticeCount();
    try {
      const company = await seen({ farmId: null, restricted: false, companyId: ctx.companyId, lobId: null });
      const farmUser = await seen({ farmId: farm.farmId, restricted: true, farmBound: true, companyId: ctx.companyId, lobId: null });
      if (company !== total || farmUser !== 0) throw new Error(`20-costing-frequencies: the Alerts list showed ${company} of ${total} costing notices to the company and ${farmUser} to a farm-bound user (expected all, then none).`);
      ctx.log(`  Alerts list: the company sees all ${company} costing notices, a farm-bound user sees ${farmUser}`);
    } finally { cls.set(FARM_SCOPE_KEY, undefined); }

    const rows = await db.select({ tag: schema.animalRegister.rfid_tag, bv: schema.animalRegister.book_value }).from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, ids));
    ctx.log(`  costing: ${rows.map((r) => `${r.tag} book value=${r.bv}`).join(' | ')}`);
  },
};

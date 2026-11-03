/**
 * The whole project in one seed (`pnpm seed:project`, preset `project-full`): the twelve biological items with their terms, a store stocked by goods
 * receipt, twenty animals (14 sows and gilts, 6 boars) bought on one receipt and registered with their papers, one Animal Wise Bio Asset batch, a year and a half
 * of weekly feed and monthly overhead, health cards, monthly costing runs, semen collected from the boars, AI of every sow, pregnancy checks, TWO farrowings and
 * weanings for every sow (parity 2), and four home-bred gilts selected from the first litters, with their own batch and fair value runs. Every step is posted
 * through the application's own services (Ruling 1), in date order, nothing in the future.
 *
 *   Items      02c-project-items: the 12 items of the Fixed Asset sheet (imported = amortised, local = fair value), their GL accounts by the sheet's names
 *              (codes are ours: 11xx, 41xx, 51xx), terms and fair value rates. Accumulated amortisation = 1065 and write-off = 5010 are OURS, standing in for the
 *              two accounts the sheet does not name.
 *   Timeline   purchase 6 Jan 2025 (females 20 weeks old, boars 22) -> costing starts: boars 3 Feb 2025 (26 wk), females 7 Apr 2025 (33 wk)
 *              group A (7 sows) served 24 Mar 2025, i.e. BEFORE her costing start (feed, overhead and semen are capitalised into her)
 *              group B (7 sows) served 21 Apr 2025, AFTER it (feed and semen are expensed)
 *              farrow +116 days, wean +28 days, re-serve 5 days after weaning, farrow again: parity 2 by 14 Dec 2025 (A) and 11 Jan 2026 (B)
 *   Costing    a run for every month Jan 2025 - Sep 2026, for the sow batch and for the gilts' batch, in order; the rates: 150 kg x 2.05 from 1 Jan 2025 (the
 *              sheet) and 150 kg x 2.35 from 1 Jan 2026 (ours, to show a rate by date).
 *
 * Resume-safe by token (receipts by reference, animals by RFID, batches by remarks, matings by (sow, date), farrowings by (sow, date), lots by (boar, date),
 * runs by (item, period, batch)). Prices, ages, rations and litter sizes are demo facts, not real data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BreedingService } from '../../../modules/piggery/breeding/breeding.service';
import { AnimalMedicationLogService } from '../../../modules/piggery/animal/animal-medication-log.service';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import { ItemService } from '../../../modules/master-data/item/item.service';
import { GlAccountService } from '../../../modules/finance/gl-account/gl-account.service';
import { storedBioCosting } from '../../../modules/master-data/item/item-bio-costing.rules';
import { MatingType, PregCheckMethod, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import { FIXED_ASSET_ITEMS } from '../../fixed-asset-items.lib';
import { planSheetTerms } from '../../apply-item-terms.lib';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createAnimalWiseBatchEnsurer, createItemLookup, shedForStage } from '../batch-helpers';
import { ensureBirthJournalMapping } from './15-full-flow';

export const PROJECT_COSTING_FROM = '2025-01-01';
export const PROJECT_BATCH_REMARKS = 'PROJECT-FULL-BATCH';
export const PROJECT_GILT_BATCH_REMARKS = 'PROJECT-FULL-GILT-BATCH';
const RECEIPT_REF = 'PROJECT-FULL-GRN-ANIMALS';
const LAST_RUN_MONTH = '2026-09';
const PURCHASE_DATE = '2025-01-06'; // a Monday
const GESTATION_DAYS = 116;
const LACTATION_DAYS = 28;
const REMATE_AFTER_WEANING_DAYS = 5;
const FEMALE_AGE_WEEKS = 20;
const BOAR_AGE_WEEKS = 22;

export const PROJECT_ACCOUNTS = { accumulated: '1065', writeOff: '5010' } as const;

const FEED = { gest: 'Dry Sow Gestation Mash (14% CP)', lact: 'High-Density Lactation Diet (17.5% CP)', grower: 'Weaner Grower Mash (18% CP)' };
const PIGLET_ITEM = 'Suckling Live Piglet (0-4 Wks)';
const SEMEN_ITEM = 'BOAR semen';
const MEDICINES = { dewormer: 'Ivermectin 1% Swine Dewormer 100ml', parvo: 'Parvo-Shield L5 Swine Vaccine (50 Doses)', prrs: 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)' };
const SOW_KG_PER_DAY = 2.5;
const LACTATING_KG_PER_DAY = 6;
const BOAR_KG_PER_DAY = 2.8;
const GILT_KG_PER_DAY = 1.2;
const OVERHEAD_PER_MONTH = 12;

/** One animal of the herd: which item, which group, which tag. */
export interface HerdAnimal { tag: string; kind: 'SOW' | 'BOAR'; item: string; origin: 'IMPORTED' | 'LOCAL'; group: 'A' | 'B' | null; price: number; index: number }

const FEMALES: Array<[string, number]> = [['GP-Imp-F', 3], ['P-Imp-F', 4], ['GP-Loc-F', 3], ['P-Loc-F', 4]];
const MALES: Array<[string, number]> = [['GP-Imp-M', 1], ['P-Imp-M', 2], ['GP-Loc-M', 1], ['P-Loc-M', 2]];

/** The herd, in a fixed order. Groups alternate along the list so each group holds imported and local sows, and the sows of each item are split between groups. */
export function buildHerd(): HerdAnimal[] {
  const out: HerdAnimal[] = [];
  let f = 0; let m = 0;
  for (const [item, n] of FEMALES) for (let i = 0; i < n; i++, f++) {
    const origin = item.includes('Imp') ? 'IMPORTED' : 'LOCAL';
    out.push({ tag: `PF-SOW-${String(f + 1).padStart(2, '0')}`, kind: 'SOW', item, origin, group: f % 2 === 0 ? 'A' : 'B', price: origin === 'IMPORTED' ? 850 : 520, index: f });
  }
  for (const [item, n] of MALES) for (let i = 0; i < n; i++, m++) {
    const origin = item.includes('Imp') ? 'IMPORTED' : 'LOCAL';
    out.push({ tag: `PF-BOAR-${String(m + 1).padStart(2, '0')}`, kind: 'BOAR', item, origin, group: null, price: origin === 'IMPORTED' ? 1200 : 700, index: m });
  }
  return out;
}

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/** The mating of each group, each parity. Group A is served before the sows' costing start (33 weeks), group B after it. */
export const SERVICE = {
  A: { first: '2025-03-24' },
  B: { first: '2025-04-21' },
} as const;
export interface Cycle { mating: string; farrowing: string; weaning: string }
export function cyclesOf(group: 'A' | 'B'): [Cycle, Cycle] {
  const first = SERVICE[group].first;
  const f1 = addDays(first, GESTATION_DAYS); const w1 = addDays(f1, LACTATION_DAYS);
  const m2 = addDays(w1, REMATE_AFTER_WEANING_DAYS); const f2 = addDays(m2, GESTATION_DAYS); const w2 = addDays(f2, LACTATION_DAYS);
  return [{ mating: first, farrowing: f1, weaning: w1 }, { mating: m2, farrowing: f2, weaning: w2 }];
}
export const dobOf = (a: Pick<HerdAnimal, 'kind'>) => addDays(PURCHASE_DATE, -7 * (a.kind === 'SOW' ? FEMALE_AGE_WEEKS : BOAR_AGE_WEEKS));
export const GILT_TAGS = [['PF-GILT-01', 'PF-GILT-02'], ['PF-GILT-03', 'PF-GILT-04']] as const;

function tenantDb(ctx: DemoContext, chapter: string): MySql2Database<typeof schema> {
  const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
  if (!db) throw new Error(`${chapter}: tenantDb is not set - run through the harness.`);
  return db;
}

/** 02c: the twelve items, their accounts, terms and rates. Does nothing on a database that already holds them. */
export const projectItemsChapter: DemoChapter = {
  name: '02c-project-items',

  async run(ctx: DemoContext) {
    const db = tenantDb(ctx, '02c-project-items');
    const items = ctx.app.get(ItemService);
    const accounts = ctx.app.get(GlAccountService);
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };
    const G = schema.glAccountMaster;
    const chart = await db.select().from(G).where(eq(G.company_id, ctx.companyId));
    const byCode = new Map(chart.map((a) => [a.account_code, a]));
    const anchor = byCode.get('1050');
    if (!anchor) throw new Error('02c-project-items: the chart has no account 1050.');
    for (const code of [PROJECT_ACCOUNTS.accumulated, PROJECT_ACCOUNTS.writeOff]) {
      if (!byCode.get(code)) {
        if (code !== PROJECT_ACCOUNTS.accumulated) throw new Error(`02c-project-items: the chart has no account ${code}.`);
        await db.insert(G).values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, nob_id: anchor.nob_id, lob_id: anchor.lob_id, account_code: '1065', account_name: 'Accumulated Amortisation - Bio Assets', account_type: 'ASSET' });
        ctx.log('  GL 1065 Accumulated Amortisation - Bio Assets created');
      }
    }

    // the accounts the sheet names (codes are ours)
    const kindOf = (name: string) => (/fair value/i.test(name) ? 'fair_value' : /amortization/i.test(name) ? 'amortisation' : 'acquisition') as 'fair_value' | 'amortisation' | 'acquisition';
    const first = { acquisition: 1101, fair_value: 4101, amortisation: 5101 };
    const type = { acquisition: 'ASSET', fair_value: 'INCOME', amortisation: 'EXPENSE' } as const;
    const names = [...new Set(FIXED_ASSET_ITEMS.flatMap((i) => [i.accounts.acquisition, i.accounts.result]).filter((x): x is string => !!x))];
    const have = new Set(chart.map((a) => a.account_name.toLowerCase()));
    const used = new Set(chart.map((a) => a.account_code));
    for (const name of names) {
      if (have.has(name.toLowerCase())) continue;
      const k = kindOf(name);
      while (used.has(String(first[k]))) first[k] += 1;
      const code = String(first[k]++);
      used.add(code);
      await accounts.create({ company_id: ctx.companyId, account_code: code, account_name: name, account_type: type[k], nob_id: anchor.nob_id, lob_id: anchor.lob_id } as any, ctx.tenantId, actor);
      ctx.log(`  GL ${code} ${name} created`);
    }

    // the items
    const I = schema.itemMaster;
    const [breedingItem] = await db.select({ category_id: I.category_id }).from(I).where(and(eq(I.company_id, ctx.companyId), eq(I.item_name, 'Mature Parity Breeding Sow'))).limit(1);
    const series = await db.select({ id: schema.noSeries.id, code: schema.noSeries.code }).from(schema.noSeries).where(and(eq(schema.noSeries.company_id, ctx.companyId), inArray(schema.noSeries.code, ['ITEM_SERIAL', 'ITEM_LOT'])));
    const seriesOf = (code: string) => series.find((s) => s.code === code)?.id;
    const present = new Set((await db.select({ code: I.item_code }).from(I).where(eq(I.company_id, ctx.companyId))).map((r) => r.code.toLowerCase()));
    for (const c of FIXED_ASSET_ITEMS) {
      if (present.has(c.item_code.toLowerCase())) continue;
      const serial = c.tracking === 'INDIVIDUAL';
      await items.create({
        company_id: ctx.companyId, nob_id: anchor.nob_id, lob_id: anchor.lob_id, item_code: c.item_code, item_name: c.item_code, item_type: 'LIVING_ASSET',
        category_id: breedingItem?.category_id ?? undefined, uom_primary: 'HEAD', valuation_method: 'BIO_ASSET', is_biological_asset: true,
        is_serial_tracked: serial, is_lot_tracked: !serial, tracking_series_id: seriesOf(serial ? 'ITEM_SERIAL' : 'ITEM_LOT'),
      } as any, ctx.tenantId, actor);
      ctx.log(`  item ${c.item_code} created (${serial ? 'serial' : 'lot'} tracked)`);
    }

    // terms and rates, from the Fixed Asset sheet through the same plan the apply script uses
    const found = await db.select({ item_id: I.item_id, item_code: I.item_code, company_id: I.company_id, is_biological_asset: I.is_biological_asset, bio_costing_method: I.bio_costing_method }).from(I).where(eq(I.company_id, ctx.companyId));
    const chartNow = await db.select({ gl_account_id: G.gl_account_id, account_name: G.account_name, company_id: G.company_id }).from(G).where(eq(G.company_id, ctx.companyId));
    const plan = planSheetTerms({ items: found as any, accounts: chartNow as any, costingFrom: PROJECT_COSTING_FROM });
    const accumulated = (await db.select().from(G).where(and(eq(G.company_id, ctx.companyId), eq(G.account_code, PROJECT_ACCOUNTS.accumulated))).limit(1))[0];
    const writeOff = (await db.select().from(G).where(and(eq(G.company_id, ctx.companyId), eq(G.account_code, PROJECT_ACCOUNTS.writeOff))).limit(1))[0];
    for (const p of plan.filter((e) => e.status === 'READY' && e.terms)) {
      const terms = { ...p.terms!, bio_accum_amort_gl_id: accumulated.gl_account_id, bio_writeoff_gl_id: writeOff.gl_account_id };
      const stored = storedBioCosting(terms as any);
      await db.update(I).set({
        ...stored, bio_residual_fixed_amount: null,
        bio_residual_weight_kg: stored.bio_residual_weight_kg == null ? null : String(stored.bio_residual_weight_kg),
        bio_residual_price_per_kg: stored.bio_residual_price_per_kg == null ? null : String(stored.bio_residual_price_per_kg),
      } as any).where(eq(I.item_id, p.item_id!));
      if (p.rate) {
        const rate = (r: { effective_from: string; weight: number; price: number }) => ({ item_id: p.item_id!, farm_id: null, age_week_from: 0, effective_from: r.effective_from, expected_weight_kg: String(r.weight), price_per_kg: String(r.price), cdm_based: false, costs_to_sell_pct: null });
        await db.insert(schema.itemFairValueRate).values([
          rate({ effective_from: PROJECT_COSTING_FROM, weight: p.rate.expected_weight_kg, price: p.rate.price_per_kg }),
          rate({ effective_from: '2026-01-01', weight: 150, price: 2.35 }), // ours: a rate by date, to show a gain after the first loss
        ] as any);
      }
      ctx.log(`  ${p.item_code}: ${p.terms!.bio_costing_method} from week ${p.terms!.bio_start_age_weeks}, costing from ${PROJECT_COSTING_FROM}`);
    }
  },
};

interface Event { date: string; label: string; run: () => Promise<void> }

export const projectFullChapter: DemoChapter = {
  name: '22-project-full',

  async run(ctx: DemoContext) {
    const db = tenantDb(ctx, '22-project-full');
    const animals = ctx.app.get(AnimalService);
    const batches = ctx.app.get(BatchService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const breeding = ctx.app.get(BreedingService);
    const starts = ctx.app.get(BioCostingStartService);
    const runs = ctx.app.get(BioCostingRunService);
    const medicines = ctx.app.get(AnimalMedicationLogService);
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };
    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed || !farm.storeId) throw new Error('22-project-full: MUL100, its sow breed and its store are needed - run with the costing preset.');
    const item = createItemLookup(db, ctx.companyId);
    const last = today();
    const store = farm.storeId;
    await ensureBirthJournalMapping(ctx, db);

    // ── 1. Stock: feed and medicines are received into the farm's store before they are drawn.
    const herd = buildHerd();
    const receive = async (ref: string, lines: Array<{ name: string; qty: number; uom: string }>, date: string) => {
      const [have] = await db.select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      let id = have?.id; let status = have?.status;
      if (!id) {
        const built: Array<{ item_id: string; quantity: number; uom: string; rate: number | undefined }> = [];
        for (const l of lines) { const it = await item(l.name); built.push({ item_id: it.item_id, quantity: l.qty, uom: l.uom, rate: Number(it.standard_cost ?? 0) || undefined }); }
        const created = await receipts.create({ company_id: ctx.companyId, warehouse_id: store, posting_date: date, external_reference_no: ref, remarks: `PROJECT seed: ${lines.map((l) => l.name).join(', ')}`, lines: built } as any, ctx.tenantId);
        id = created.receipt_id; status = 'DRAFT';
      }
      if (status === 'DRAFT') { await receipts.post(id!, ctx.tenantId); ctx.log(`  receipt ${ref} (${date}): ${lines.map((l) => `${l.qty} ${l.uom} ${l.name}`).join('; ')}`); }
    };
    await receive('PROJECT-GRN-MEDICINE', [{ name: MEDICINES.dewormer, qty: 40, uom: 'VIAL' }, { name: MEDICINES.parvo, qty: 400, uom: 'DOSE' }, { name: MEDICINES.prrs, qty: 200, uom: 'DOSE' }], PURCHASE_DATE);

    // ── 2. The animals: one receipt, a line per item with a serial for each head.
    const sowStage = breed.lifecycleStages.get('INSEMINATION');
    const boarStage = breed.lifecycleStages.get('QUARANTINE');
    const lactationStage = breed.lifecycleStages.get('LACTATION');
    if (!sowStage || !boarStage || !lactationStage) throw new Error('22-project-full: the sow breed needs INSEMINATION, QUARANTINE and LACTATION lifecycle rows.');
    const sowPens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const boarPens = shedForStage(farm, 'QUARANTINE')?.penIds ?? pensForRole(farm, 'BOAR');
    const itemIds = new Map<string, string>();
    for (const c of FIXED_ASSET_ITEMS) itemIds.set(c.item_code.toLowerCase(), (await item(c.item_code)).item_id);
    const itemOf = (name: string) => itemIds.get(name.toLowerCase())!;

    let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, RECEIPT_REF)).limit(1);
    if (!receipt) {
      const lines = [...new Set(herd.map((h) => h.item))].map((name) => {
        const group = herd.filter((h) => h.item === name);
        return { item_id: itemOf(name), quantity: group.length, uom: 'HEAD', rate: group[0].price, serials: group.map((g) => g.tag) };
      });
      const created = await receipts.create({ company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: PURCHASE_DATE, external_reference_no: RECEIPT_REF, remarks: 'PROJECT seed: 14 sows and 6 boars, imported and local', lines } as any, ctx.tenantId);
      receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
    }
    if (receipt.status === 'DRAFT') { await receipts.post(receipt.receipt_id, ctx.tenantId); ctx.log(`  animal receipt ${RECEIPT_REF} posted (${PURCHASE_DATE}): ${herd.length} head`); }

    const ids = new Map<string, string>();
    for (const a of herd) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const pens = a.kind === 'SOW' ? sowPens : boarPens;
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: a.kind === 'SOW' ? 'F' : 'M',
          entry_type: a.origin === 'IMPORTED' ? 'PURCHASED_IMPORTED' : 'PURCHASED_LOCAL', entry_date: PURCHASE_DATE, dob: dobOf(a), source_receipt_id: receipt.receipt_id,
          item_id: itemOf(a.item), rfid_tag: a.tag, current_location_id: pens[a.index % pens.length], current_stage_id: a.kind === 'SOW' ? sowStage : boarStage,
          no_of_teats: a.kind === 'SOW' ? 14 + (a.index % 3) : undefined, tsi: 110 + ((a.index * 7) % 25), grading: 80 + ((a.index * 3) % 15),
          sire_serial_no: a.origin === 'IMPORTED' ? `DK-${a.tag}-S` : undefined, dam_serial_no: a.origin === 'IMPORTED' ? `DK-${a.tag}-D` : undefined,
          notes: `${a.origin === 'IMPORTED' ? 'Imported' : 'Local'} ${a.item}`, expected_cull_date: addDays(PURCHASE_DATE, 365 * 3),
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}): ${a.item}, born ${dobOf(a)}`);
      }
      ids.set(a.tag, row.animal_id);
    }
    const sows = herd.filter((h) => h.kind === 'SOW');
    const boars = herd.filter((h) => h.kind === 'BOAR');
    const idOf = (tag: string) => ids.get(tag)!;

    // ── 3. The batch.
    const ensureBatch = createAnimalWiseBatchEnsurer(db, batches, ctx);
    const batchId = await ensureBatch({ ref: PROJECT_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'INSEMINATION'), startDate: PURCHASE_DATE, animalIds: [...ids.values()] });
    await db.update(schema.schedulerHeader).set({ effective_from: PURCHASE_DATE }).where(eq(schema.schedulerHeader.batch_id, batchId));
    await starts.assignAnimals({ animal_ids: [...ids.values()] } as any, ctx.tenantId, ctx.companyId);

    // ── 4. The timeline.
    const events: Event[] = [];
    const on = (date: string, label: string, run: () => Promise<void>) => { if (date <= last) events.push({ date, label, run }); };
    const cycles = { A: cyclesOf('A'), B: cyclesOf('B') };
    const nursing = (sow: HerdAnimal, date: string) => cyclesOf(sow.group!).some((c) => date > c.farrowing && date < c.weaning);

    // stock of feed: gestation mash every quarter, the lactation diet before each round of farrowings
    const feedQuarter = (n: number) => addDays(PURCHASE_DATE, 91 * n);
    for (let n = 0; n < 7; n++) on(feedQuarter(n), `gestation feed ${n}`, () => receive(`PROJECT-GRN-GEST-${n}`, [{ name: FEED.gest, qty: 8000, uom: 'KG' }], feedQuarter(n)));
    for (const date of ['2025-07-04', '2025-12-01']) on(date, `lactation feed ${date}`, () => receive(`PROJECT-GRN-LACT-${date}`, [{ name: FEED.lact, qty: 3000, uom: 'KG' }], date));
    on('2025-08-12', 'grower feed for the gilts', () => receive('PROJECT-GRN-GROWER', [{ name: FEED.grower, qty: 2500, uom: 'KG' }], '2025-08-12'));

    // weekly feed by group: one ledger entry for all animals that took the same ration, shared out per animal
    const gest = await item(FEED.gest); const lact = await item(FEED.lact); const grower = await item(FEED.grower);
    const fed = new Set((await db.select({ d: schema.batchTransaction.transaction_date, r: schema.batchTransaction.remarks }).from(schema.batchTransaction).where(eq(schema.batchTransaction.batch_id, batchId))).map((t) => `${String(t.d).slice(0, 10)}|${t.r}`));
    const groupFeed = async (batch: string, date: string, itemId: string, shares: Array<{ tag: string; kg: number }>, remarks: string) => {
      if (!shares.length || fed.has(`${date}|${remarks}`)) return;
      await batches.postConsumptionGroup(batch, { item_id: itemId, uom: 'KG', transaction_date: date, source_warehouse_id: store, remarks, shares: shares.map((s) => ({ animal_id: idOf(s.tag), quantity: round2(s.kg) })) }, ctx.tenantId, actor);
      fed.add(`${date}|${remarks}`);
    };
    for (let d = PURCHASE_DATE; d <= '2026-09-28'; d = addDays(d, 7)) {
      const date = d;
      on(date, `feed ${date}`, async () => {
        const nursingSows = sows.filter((s) => nursing(s, date));
        const rest = [...sows.filter((s) => !nursing(s, date)).map((s) => ({ tag: s.tag, kg: SOW_KG_PER_DAY * 7 })), ...boars.map((b) => ({ tag: b.tag, kg: BOAR_KG_PER_DAY * 7 }))];
        await groupFeed(batchId, date, gest.item_id, rest, 'PROJECT weekly feed (gestation mash)');
        await groupFeed(batchId, date, lact.item_id, nursingSows.map((s) => ({ tag: s.tag, kg: LACTATING_KG_PER_DAY * 7 })), 'PROJECT weekly feed (lactation diet)');
      });
    }
    // monthly overhead per animal (housing and labour)
    for (let m = '2025-01'; m <= LAST_RUN_MONTH; m = nextMonth(m)) {
      const date = `${m}-15`;
      on(date, `overhead ${m}`, async () => {
        for (const a of herd) {
          const key = `${date}|PROJECT overhead ${a.tag}`;
          if (fed.has(key)) continue;
          await batches.addTransaction(batchId, { transaction_type: 'OVERHEAD', transaction_date: date, quantity: 1, uom: 'MONTH', rate: OVERHEAD_PER_MONTH, animal_id: idOf(a.tag), remarks: `PROJECT overhead ${a.tag}` } as any, ctx.tenantId, actor);
          fed.add(key);
        }
      });
    }

    // health cards
    const treat = async (tag: string, name: string, date: string, dose: number, note: string) => {
      const med = await item(name);
      const [done] = await db.select({ id: schema.animalMedicationLog.log_id }).from(schema.animalMedicationLog).where(and(eq(schema.animalMedicationLog.animal_id, idOf(tag)), eq(schema.animalMedicationLog.item_id, med.item_id), eq(schema.animalMedicationLog.administered_date, date))).limit(1);
      if (!done) await medicines.create(idOf(tag), { item_id: med.item_id, administered_date: date, dose_qty: dose, uom: 'ML', administered_by: 'Dr T. Moyo (vet)', notes: note } as any, ctx.tenantId, actor);
    };
    on('2025-01-08', 'dewormer', async () => { for (const a of herd) await treat(a.tag, MEDICINES.dewormer, '2025-01-08', 5, 'Arrival dewormer'); });
    on('2025-01-10', 'arrival vaccine', async () => { for (const a of herd) await treat(a.tag, MEDICINES.parvo, '2025-01-10', 2, 'Arrival vaccination'); });
    on('2025-03-10', 'PRRS vaccine', async () => { for (const s of sows) await treat(s.tag, MEDICINES.prrs, '2025-03-10', 2, 'Pre-service PRRS vaccination'); });

    // semen, AI, pregnancy check, farrowing, weaning: per round, per group
    const semenItem = await item(SEMEN_ITEM);
    const piglet = await item(PIGLET_ITEM);
    const lotOf = async (boarTag: string, date: string) => {
      const [lot] = await db.select({ id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch).where(and(eq(schema.semenBatch.boar_animal_id, idOf(boarTag)), eq(schema.semenBatch.collection_date, date))).limit(1);
      return lot?.id;
    };
    const boarFor = (sow: HerdAnimal, parity: 0 | 1) => boars[(sow.index + parity * 2) % boars.length];
    const gilts = new Map<string, readonly string[]>([['PF-SOW-01', GILT_TAGS[0]], ['PF-SOW-03', GILT_TAGS[1]]]);
    const farrowOf = async (sowTag: string, date: string) => (await db.select({ id: schema.farrowingRecord.farrow_id, weaned: schema.farrowingRecord.piglets_weaned }).from(schema.farrowingRecord)
      .where(and(eq(schema.farrowingRecord.sow_animal_id, idOf(sowTag)), eq(schema.farrowingRecord.farrowing_date, date))).limit(1))[0];
    const giltItem = await item('GP-Loc-F');

    for (const group of ['A', 'B'] as const) {
      const groupSows = sows.filter((s) => s.group === group);
      ([0, 1] as const).forEach((parity) => {
        const c = cycles[group][parity];
        const collection = addDays(c.mating, -4);
        on(collection, `semen ${group}${parity + 1}`, async () => {
          for (const b of boars) {
            if (await lotOf(b.tag, collection)) continue;
            await breeding.recordSemenCollection({ company_id: ctx.companyId, boar_animal_id: idOf(b.tag), boar_batch_id: batchId, collection_date: collection, doses_collected: 30, output_item_id: semenItem.item_id, volume_ml: 240, motility_pct: 86, concentration_m_per_ml: 310 } as any, ctx.tenantId, actor);
          }
          ctx.log(`  semen collected ${collection} from ${boars.length} boars (30 doses each)`);
        });
        on(c.mating, `AI ${group}${parity + 1}`, async () => {
          for (const s of groupSows) {
            const [have] = await db.select({ id: schema.breedingRecord.breeding_id, result: schema.breedingRecord.conception_result }).from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, idOf(s.tag)), eq(schema.breedingRecord.mating_date, c.mating))).limit(1);
            let record = have;
            if (!record) {
              const created: any = await breeding.recordMating({ company_id: ctx.companyId, sow_animal_id: idOf(s.tag), batch_id: batchId, mating_type: MatingType.AI, semen_lot_id: await lotOf(boarFor(s, parity).tag, collection), semen_dose_qty: 2, mating_date: c.mating } as any, ctx.tenantId, actor);
              record = { id: created.breeding_id, result: created.conception_result };
            }
            const check = addDays(c.mating, 28);
            if ((record.result === ConceptionResult.PENDING || record.result == null) && check <= last) {
              await breeding.recordPregnancyCheck(record.id, { preg_check_date: check, preg_check_method: PregCheckMethod.ULTRASOUND, conception_result: ConceptionResult.CONFIRMED }, ctx.tenantId, actor);
            }
          }
          ctx.log(`  ${groupSows.length} sows (group ${group}) inseminated ${c.mating}, pregnancy confirmed +28 days`);
        });
        on(c.farrowing, `farrowing ${group}${parity + 1}`, async () => {
          for (const s of groupSows) {
            if (await farrowOf(s.tag, c.farrowing)) continue;
            const [rec] = await db.select({ id: schema.breedingRecord.breeding_id }).from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, idOf(s.tag)), eq(schema.breedingRecord.mating_date, c.mating))).limit(1);
            await breeding.recordFarrowing({ company_id: ctx.companyId, sow_animal_id: idOf(s.tag), breeding_id: rec?.id, batch_id: batchId, farrowing_date: c.farrowing, piglets_born_live: 11 + ((s.index + parity) % 4), piglets_stillborn: (s.index + parity) % 2, avg_birth_weight_kg: 1.4, piglet_item_id: piglet.item_id, piglet_stage_id: lactationStage } as any, ctx.tenantId, actor);
          }
          ctx.log(`  group ${group} farrowed ${c.farrowing} (parity ${parity + 1})`);
        });
        on(c.weaning, `weaning ${group}${parity + 1}`, async () => {
          for (const s of groupSows) {
            const farrow = await farrowOf(s.tag, c.farrowing);
            if (!farrow || Number(farrow.weaned) > 0) continue;
            const tags = parity === 0 ? gilts.get(s.tag) : undefined;
            const body: any = { weaning_date: c.weaning, piglets_weaned: 11 + ((s.index + parity) % 4) - 1, avg_weaning_weight_kg: 7.2, move_to_stage_code: 'WEANER' };
            if (tags) Object.assign(body, { gilt_colour_code: 'BLUE', gilt_item_id: giltItem.item_id, gilts: tags.map((tag, i) => ({ rfid_tag: tag, no_of_teats: 15 + i })) });
            await breeding.recordWeaning(farrow.id, body, ctx.tenantId, actor);
          }
          ctx.log(`  group ${group} weaned ${c.weaning} (litter ${parity + 1})${parity === 0 && groupSows.some((s) => gilts.has(s.tag)) ? '; gilts selected from the first litters' : ''}`);
        });
      });
    }

    // the gilts' own batch, weekly grower feed, and their costing start
    const giltTags = GILT_TAGS.flat();
    const giltsWeaned = cycles.A[0].weaning;
    let giltBatchId: string | undefined;
    on(addDays(giltsWeaned, 7), 'gilt batch', async () => {
      const rows = await db.select({ animal_id: schema.animalRegister.animal_id, tag: schema.animalRegister.rfid_tag }).from(schema.animalRegister).where(inArray(schema.animalRegister.rfid_tag, [...giltTags]));
      if (rows.length !== giltTags.length) { ctx.log(`  gilt batch skipped: ${rows.length} of ${giltTags.length} gilts exist`); return; }
      for (const r of rows) ids.set(r.tag!, r.animal_id);
      giltBatchId = await ensureBatch({ ref: PROJECT_GILT_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'GILT_GROWER'), startDate: giltsWeaned, animalIds: rows.map((g) => g.animal_id) });
      await starts.assignAnimals({ animal_ids: rows.map((g) => g.animal_id) } as any, ctx.tenantId, ctx.companyId);
      ctx.log(`  gilts ${giltTags.join(', ')} joined their own batch`);
    });
    for (let d = addDays(giltsWeaned, 14); d <= '2026-09-28'; d = addDays(d, 7)) {
      const date = d;
      on(date, `gilt feed ${date}`, async () => {
        if (!giltBatchId) giltBatchId = (await db.select({ id: schema.batchHeader.batch_id }).from(schema.batchHeader).where(eq(schema.batchHeader.remarks, PROJECT_GILT_BATCH_REMARKS)).limit(1))[0]?.id;
        if (!giltBatchId) return;
        const [seen] = await db.select({ id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction).where(and(eq(schema.batchTransaction.batch_id, giltBatchId), eq(schema.batchTransaction.transaction_date, date))).limit(1);
        if (seen) return;
        await batches.postConsumptionGroup(giltBatchId, { item_id: grower.item_id, uom: 'KG', transaction_date: date, source_warehouse_id: store, remarks: 'PROJECT weekly gilt feed', shares: giltTags.map((t) => ({ animal_id: idOf(t), quantity: round2(GILT_KG_PER_DAY * 7) })) }, ctx.tenantId, actor);
      });
    }

    // ── 5. Walk the months in order: the month's events, then the month's runs.
    events.sort((a, b) => a.date.localeCompare(b.date));
    let next = 0;
    const runMonth = async (batch: string, month: string) => {
      let calculated: { runs: any[]; failed: Array<{ item_code: string; error: string }> };
      try { calculated = await runs.calculateBatch({ batch_id: batch, period_key: month } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId) as any; }
      catch (error) { const message = error instanceof Error ? error.message : String(error); ctx.log(`  run ${month}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`); return; }
      for (const f of calculated.failed) ctx.log(`  run ${month} ${f.item_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
      let total = 0; let n = 0;
      for (const run of calculated.runs) {
        if (run.status === 'POSTED') continue;
        const posted: any = await runs.post(run.run_id, ctx.tenantId, ctx.actor.userId);
        total += Number(posted.total_charge ?? 0); n += 1;
      }
      ctx.log(`  runs ${month}: ${n} posted, total ${round2(total)}`);
    };
    for (let m = '2025-01'; m <= LAST_RUN_MONTH; m = nextMonth(m)) {
      const end = monthEnd(m);
      while (next < events.length && events[next].date <= end) await events[next++].run();
      if (end > last) break;
      await runMonth(batchId, m);
      if (giltBatchId) await runMonth(giltBatchId, m);
    }
    while (next < events.length) await events[next++].run();

    const rows = await db.select({ code: schema.animalRegister.animal_code, parity: schema.animalRegister.parity_count, bv: schema.animalRegister.book_value }).from(schema.animalRegister).where(inArray(schema.animalRegister.rfid_tag, sows.map((s) => s.tag)));
    ctx.log(`  sows now: ${rows.map((r) => `${r.code} parity ${r.parity} book ${r.bv}`).join(' | ')}`);
  },
};

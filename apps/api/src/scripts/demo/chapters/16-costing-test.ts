/**
 * Chapter `16-costing-test` — the COSTING TEST seed (`pnpm seed:costing-test`, or `pnpm nx run api:db-costing-test` on an existing database). The herd is
 * 4 sows and 4 boars in 2 animal-wise batches, nothing else: every cost, run, mating and litter on screen comes from them. Everything is posted through the
 * application's own services, dated in order, nothing in the future, and every case is read back from MySQL by `verify-costing-test.ts`.
 *
 *   BATCH A  imported (GRN 5 Jan 2026, profiles IMP-F / IMP-M)             BATCH B  local (GRN 12 Jan 2026, profiles LOC-F / LOC-M)
 *   CT-A-SOW-1   born 6 Oct 2025   start by age 25 May    (capitalise -> expense; AI mated, farrows 7 Aug, 5 gilts at weaning 4 Sep)
 *   CT-A-SOW-2   born 2 Dec 2024   start = entry 5 Jan    (expensed from day one; DIES 14 Jul: settled in the exit, later runs skip her)
 *   CT-A-BOAR-1  born 4 Aug 2025   start by age 2 Feb     (semen on 10 Apr AFTER two amortisation runs: cost per dose carries them)
 *   CT-A-BOAR-2  born 1 Oct 2024   start = entry 5 Jan    (life ends 1 Apr 2026: the last run takes him to his residual, then LIFE_COMPLETE)
 *   CT-B-SOW-1   born 3 Nov 2025   start by age 22 Jun    (still capitalising when the batch's group feed reaches the others)
 *   CT-B-SOW-2   born 3 Feb 2025   start = entry 12 Jan   (own residual 400 from 25 Jun; AI mated 18 May, farrows 11 Sep, litter still on the sow: week-4 alert)
 *   CT-B-BOAR-1  born 1 Sep 2025   start by age 2 Mar
 *   CT-B-BOAR-2  born 3 Mar 2025   start = entry 12 Jan   (semen on 11 May)
 *
 * Every Monday each batch's feed is issued as ONE group (postConsumptionGroup), so on 25 May (A) and 22 Jun (B) a single issue holds animals on both sides
 * of their costing start and is split in two entries (capitalised / expensed). A monthly overhead is booked to each animal on the 15th. The company's female
 * residual changes on 1 Jul (150 -> 160 kg x 2.05). One run per batch and profile after every month, in order; the Sep run of batch B is reversed and made again.
 * Then the guards (G1-G10, R1): each rule that must refuse is tried and its refusal is recorded (PASS / FAIL), and the chapter fails if one does not.
 *
 * Resume-safe: the receipts by reference, animals by RFID, batches by remarks, transactions by (batch, animal, date, kind, remarks), matings by (sow, date),
 * semen lots by (boar, date), runs by (profile, period, batch). Prices, ages, rations and litter sizes are demo facts, not client data.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BreedingService } from '../../../modules/piggery/breeding/breeding.service';
import { GiltSelectionService } from '../../../modules/piggery/gilt-selection/gilt-selection.service';
import { AnimalMedicationLogService } from '../../../modules/piggery/animal/animal-medication-log.service';
import { BioCostingProfileService } from '../../../modules/finance/bio-costing/bio-costing-profile.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import { BioCostingResidualService } from '../../../modules/finance/bio-costing/bio-costing-residual.service';
import { MatingType, PregCheckMethod, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createAnimalWiseBatchEnsurer, createItemLookup, shedForStage } from '../batch-helpers';
import { ensureBirthJournalMapping } from './15-full-flow';

export const CT_BATCH_A = 'CT-BATCH-A';
export const CT_BATCH_B = 'CT-BATCH-B';
export const CT_GILT_BATCH = 'CT-GILT-BATCH';
const CT_LITTER_A = 'CT-A-SOW-1-LITTER';
const CT_LITTER_B = 'CT-B-SOW-2-LITTER';

const GRN_A = 'DEMO-CT-GRN-A';
const GRN_B = 'DEMO-CT-GRN-B';
const FEED_REF = 'DEMO-CT-FEED-GESTATION';
const FEED_REF_LACT = 'DEMO-CT-FEED-LACTATION';
const FEED_REF_GILT = 'DEMO-CT-FEED-GILT';
const DRUG_REF = 'DEMO-CT-DRUGS';

const DATE_A = '2026-01-05'; // Monday
const DATE_B = '2026-01-12'; // Monday
const LAST_FEED_DATE = '2026-09-28';
const FIRST_MONTH = '2026-01';
const LAST_MONTH = '2026-09';
const GESTATION_DAYS = 116;
const LACTATION_DAYS = 28;

const SOW_ITEM = 'Mature Parity Breeding Sow';
const BOAR_ITEM = 'Mature Herd Sire Boar';
const PIGLET_ITEM = 'Suckling Live Piglet (0-4 Wks)';
const SEMEN_ITEM = 'BOAR semen';
const GEST_FEED = 'Dry Sow Gestation Mash (14% CP)';
const LACT_FEED = 'High-Density Lactation Diet (17.5% CP)';
const GILT_FEED = 'Weaner Grower Mash (18% CP)';

export const SOW_KG_PER_DAY = 2.5;
export const LACTATING_KG_PER_DAY = 6;
export const BOAR_KG_PER_DAY = 2.8;
export const OVERHEAD_PER_MONTH = 12;

interface Spec {
  tag: string; kind: 'SOW' | 'BOAR'; batch: 'A' | 'B'; dob: string; teats?: number; tsi: number; grading: number; sire: string; dam: string; note: string;
}

export const ANIMALS: Spec[] = [
  { tag: 'CT-A-SOW-1', kind: 'SOW', batch: 'A', dob: '2025-10-06', teats: 14, tsi: 120, grading: 87, sire: 'DK-LR-91207', dam: 'DK-LR-80455', note: 'Imported Danish Landrace sow' },
  { tag: 'CT-A-SOW-2', kind: 'SOW', batch: 'A', dob: '2024-12-02', teats: 15, tsi: 118, grading: 85, sire: 'DK-LR-91207', dam: 'DK-LR-80471', note: 'Imported Danish Landrace sow, older' },
  { tag: 'CT-A-BOAR-1', kind: 'BOAR', batch: 'A', dob: '2025-08-04', tsi: 127, grading: 91, sire: 'DK-DU-60118', dam: 'DK-DU-59340', note: 'Imported Danish Duroc boar, semen-collection trained' },
  { tag: 'CT-A-BOAR-2', kind: 'BOAR', batch: 'A', dob: '2024-10-01', tsi: 122, grading: 88, sire: 'DK-DU-60118', dam: 'DK-DU-59402', note: 'Imported Danish Duroc boar, old: reaches the end of his life in the test' },
  { tag: 'CT-B-SOW-1', kind: 'SOW', batch: 'B', dob: '2025-11-03', teats: 16, tsi: 112, grading: 82, sire: 'LOC-LR-1101', dam: 'LOC-LR-0990', note: 'Local Landrace sow' },
  { tag: 'CT-B-SOW-2', kind: 'SOW', batch: 'B', dob: '2025-02-03', teats: 15, tsi: 114, grading: 84, sire: 'LOC-LR-1101', dam: 'LOC-LR-0991', note: 'Local Landrace sow, older' },
  { tag: 'CT-B-BOAR-1', kind: 'BOAR', batch: 'B', dob: '2025-09-01', tsi: 116, grading: 83, sire: 'LOC-DU-2201', dam: 'LOC-DU-2144', note: 'Local Duroc boar' },
  { tag: 'CT-B-BOAR-2', kind: 'BOAR', batch: 'B', dob: '2025-03-03', tsi: 118, grading: 85, sire: 'LOC-DU-2201', dam: 'LOC-DU-2150', note: 'Local Duroc boar, older' },
];

/** What each batch paid per head. */
export const PRICES = { A: { SOW: 850, BOAR: 1200 }, B: { SOW: 700, BOAR: 900 } } as const;

export const DEATH = { tag: 'CT-A-SOW-2', date: '2026-07-14' };
export const A_SOW_1_MATING = '2026-04-13';
export const A_SOW_1_FARROWING = '2026-08-07';
export const A_SOW_1_WEANING = '2026-09-04';
export const B_SOW_2_MATING = '2026-05-18';
export const B_SOW_2_FARROWING = '2026-09-11';
export const GILT_TAGS = ['CT-GILT-01', 'CT-GILT-02', 'CT-GILT-03', 'CT-GILT-04', 'CT-GILT-05'];
const GILT_TEATS = [16, 15, 16, 17, 15];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Event { date: string; label: string; run: () => Promise<void> }

export interface GuardResult { label: string; pass: boolean; detail: string }

export const costingTestChapter: DemoChapter = {
  name: '16-costing-test',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const batches = ctx.app.get(BatchService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const breeding = ctx.app.get(BreedingService);
    const profiles = ctx.app.get(BioCostingProfileService);
    const runs = ctx.app.get(BioCostingRunService);
    const residuals = ctx.app.get(BioCostingResidualService);
    const medicines = ctx.app.get(AnimalMedicationLogService);
    const selections = ctx.app.get(GiltSelectionService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('16-costing-test: tenantDb is not set — run through the harness.');
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('16-costing-test: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    if (!farm.storeId) throw new Error('16-costing-test: MUL100 has no store to receive the feed into.');
    const store = { id: farm.storeId };
    const item = createItemLookup(db, ctx.companyId);
    const last = today();

    await ensureBirthJournalMapping(ctx, db);

    // ── 1. Two goods receipts: batch A's imported animals and batch B's local ones, at what each batch paid.
    const sowItem = await item(SOW_ITEM);
    const boarItem = await item(BOAR_ITEM);
    const receiptIds: Record<'A' | 'B', string> = { A: '', B: '' };
    for (const b of ['A', 'B'] as const) {
      const ref = b === 'A' ? GRN_A : GRN_B;
      const date = b === 'A' ? DATE_A : DATE_B;
      let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      if (!receipt) {
        const created = await receipts.create({
          company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: date, external_reference_no: ref,
          remarks: `DEMO costing test: 2 ${b === 'A' ? 'imported' : 'local'} sows and 2 ${b === 'A' ? 'imported' : 'local'} boars`,
          lines: [
            { item_id: sowItem.item_id, quantity: 2, uom: 'HEAD', rate: PRICES[b].SOW, lot_no: `DEMO-CT-${b}-SOW-LOT` },
            { item_id: boarItem.item_id, quantity: 2, uom: 'HEAD', rate: PRICES[b].BOAR, lot_no: `DEMO-CT-${b}-BOAR-LOT` },
          ],
        }, ctx.tenantId);
        receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
      }
      if (receipt.status === 'DRAFT') {
        await receipts.post(receipt.receipt_id, ctx.tenantId);
        ctx.log(`  goods receipt ${ref} posted (${date}): 2 sows at ${PRICES[b].SOW}, 2 boars at ${PRICES[b].BOAR}`);
      }
      receiptIds[b] = receipt.receipt_id;
    }

    // The feed stock, in the farm's store before it is drawn (a silo holds one feed item, and the sows need two).
    const receiveFeed = async (ref: string, name: string, kg: number, date: string) => {
      const [have] = await db.select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      let id = have?.id; let status = have?.status;
      if (!id) {
        const feed = await item(name);
        const created = await receipts.create({
          company_id: ctx.companyId, warehouse_id: store.id, posting_date: date, external_reference_no: ref, remarks: `DEMO costing test: ${name}`,
          lines: [{ item_id: feed.item_id, quantity: kg, uom: 'KG', rate: Number(feed.standard_cost ?? 0) || undefined }],
        }, ctx.tenantId);
        id = created.receipt_id; status = 'DRAFT';
      }
      if (status === 'DRAFT') { await receipts.post(id!, ctx.tenantId); ctx.log(`  feed receipt ${ref} (${date}): ${kg} kg ${name}`); }
    };
    await receiveFeed(FEED_REF, GEST_FEED, 7000, DATE_A);
    // The medicines the animals are treated with, in stock before they are drawn: a health record is a record, the CONSUMPTION against the animal is what costs.
    {
      const [have] = await db.select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, DRUG_REF)).limit(1);
      let id = have?.id; let status = have?.status;
      if (!id) {
        const lines: Array<{ item_id: string; quantity: number; uom: string; rate: number | undefined }> = [];
        for (const [name, qty, uom] of [['Ivermectin 1% Swine Dewormer 100ml', 20, 'VIAL'], ['Parvo-Shield L5 Swine Vaccine (50 Doses)', 100, 'DOSE'], ['Ingelvac PRRS MLV Swine Vaccine (50 Doses)', 50, 'DOSE']] as const) {
          const m = await item(name);
          lines.push({ item_id: m.item_id, quantity: qty, uom, rate: Number(m.standard_cost ?? 0) || undefined });
        }
        const created = await receipts.create({ company_id: ctx.companyId, warehouse_id: store.id, posting_date: DATE_A, external_reference_no: DRUG_REF, remarks: 'DEMO costing test: dewormer and vaccines', lines } as any, ctx.tenantId);
        id = created.receipt_id; status = 'DRAFT';
      }
      if (status === 'DRAFT') { await receipts.post(id!, ctx.tenantId); ctx.log(`  drug receipt ${DRUG_REF} (${DATE_A}): dewormer, parvo and PRRS vaccines`); }
    }

    // ── 2. The eight animals.
    const sowStage = breed.lifecycleStages.get('INSEMINATION');
    const boarStage = breed.lifecycleStages.get('QUARANTINE');
    if (!sowStage || !boarStage) throw new Error('16-costing-test: the sow breed needs INSEMINATION and QUARANTINE lifecycle rows.');
    const sowPens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const boarPens = shedForStage(farm, 'QUARANTINE')?.penIds ?? pensForRole(farm, 'BOAR');
    const ids = new Map<string, string>();
    let n = 0;
    for (const a of ANIMALS) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const sow = a.kind === 'SOW';
        const pens = sow ? sowPens : boarPens;
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: sow ? 'F' : 'M', entry_type: a.batch === 'A' ? 'PURCHASED_IMPORTED' : 'PURCHASED_LOCAL',
          entry_date: a.batch === 'A' ? DATE_A : DATE_B, dob: a.dob, source_receipt_id: receiptIds[a.batch], item_id: sow ? sowItem.item_id : boarItem.item_id, rfid_tag: a.tag,
          sire_serial_no: a.sire, dam_serial_no: a.dam, current_location_id: pens[n % pens.length], current_stage_id: sow ? sowStage : boarStage,
          no_of_teats: a.teats, tsi: a.tsi, grading: a.grading, notes: a.note, expected_cull_date: addDays(a.batch === 'A' ? DATE_A : DATE_B, 365 * 3),
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}): ${a.kind}, batch ${a.batch}, born ${a.dob}`);
      }
      ids.set(a.tag, row.animal_id);
      n += 1;
    }
    const idOf = (tag: string) => ids.get(tag)!;

    // ── 3. The two batches.
    const ensureBatch = createAnimalWiseBatchEnsurer(db, batches, ctx);
    const batchIds: Record<'A' | 'B', string> = { A: '', B: '' };
    for (const b of ['A', 'B'] as const) {
      batchIds[b] = await ensureBatch({
        ref: b === 'A' ? CT_BATCH_A : CT_BATCH_B, farm, breedId: breed.breedId, shed: shedForStage(farm, 'INSEMINATION'), startDate: b === 'A' ? DATE_A : DATE_B,
        animalIds: ANIMALS.filter((a) => a.batch === b).map((a) => idOf(a.tag)),
      });
      await db.update(schema.schedulerHeader).set({ effective_from: b === 'A' ? DATE_A : DATE_B }).where(eq(schema.schedulerHeader.batch_id, batchIds[b]));
    }
    await profiles.assignAnimals({ animal_ids: [...ids.values()] } as any, ctx.tenantId, ctx.companyId);

    // ── 4. The timeline.
    const events: Event[] = [];
    const on = (date: string, label: string, run: () => Promise<void>) => { if (date <= last) events.push({ date, label, run }); };
    const feedItems = { gest: await item(GEST_FEED), lact: await item(LACT_FEED) };
    const doneKeys = new Set(
      (await db.select({ b: schema.batchTransaction.batch_id, d: schema.batchTransaction.transaction_date, t: schema.batchTransaction.transaction_type, r: schema.batchTransaction.remarks, a: schema.batchTransaction.animal_id })
        .from(schema.batchTransaction).where(inArray(schema.batchTransaction.batch_id, [batchIds.A, batchIds.B])))
        .map((t) => `${t.b}|${String(t.d).slice(0, 10)}|${t.t}|${t.r ?? ''}|${t.a ?? ''}`),
    );
    const isDead = (tag: string, date: string) => tag === DEATH.tag && date >= DEATH.date;
    const nursing = (tag: string, date: string) =>
      (tag === 'CT-A-SOW-1' && date > A_SOW_1_FARROWING && date < addDays(A_SOW_1_FARROWING, LACTATION_DAYS))
      || (tag === 'CT-B-SOW-2' && date > B_SOW_2_FARROWING && date < addDays(B_SOW_2_FARROWING, LACTATION_DAYS));
    const kgFor = (a: Spec, date: string) => (a.kind === 'BOAR' ? BOAR_KG_PER_DAY : nursing(a.tag, date) ? LACTATING_KG_PER_DAY : SOW_KG_PER_DAY) * 7;

    // weekly group feed: ONE issue for each batch and diet, every Monday from the batch's first day
    for (const b of ['A', 'B'] as const) {
      for (let d = b === 'A' ? DATE_A : DATE_B; d <= LAST_FEED_DATE; d = addDays(d, 7)) {
        const date = d;
        on(date, `feed ${b} ${date}`, async () => {
          for (const lactation of [false, true]) {
            const shares = ANIMALS.filter((a) => a.batch === b && !isDead(a.tag, date) && nursing(a.tag, date) === lactation)
              .map((a) => ({ animal_id: idOf(a.tag), quantity: round2(kgFor(a, date)) }));
            if (!shares.length) continue;
            const remarks = `CT weekly feed ${b}${lactation ? ' (lactation diet)' : ''}`;
            if (doneKeys.has(`${batchIds[b]}|${date}|CONSUMPTION|${remarks}|${shares[0].animal_id}`)) continue;
            await batches.postConsumptionGroup(batchIds[b], {
              item_id: (lactation ? feedItems.lact : feedItems.gest).item_id, uom: 'KG', transaction_date: date, source_warehouse_id: store.id, remarks, shares,
            }, ctx.tenantId, actor as any);
          }
        });
      }
    }
    on(addDays(A_SOW_1_FARROWING, -14), 'lactation diet received', async () => { await receiveFeed(FEED_REF_LACT, LACT_FEED, 500, addDays(A_SOW_1_FARROWING, -14)); });

    // monthly overhead per animal, on the 15th
    for (let m = FIRST_MONTH; m <= LAST_MONTH; m = nextMonth(m)) {
      const date = `${m}-15`;
      on(date, `overhead ${m}`, async () => {
        for (const a of ANIMALS) {
          if (date < (a.batch === 'A' ? DATE_A : DATE_B) || isDead(a.tag, date)) continue;
          const remarks = 'CT housing and labour allocation';
          const key = `${batchIds[a.batch]}|${date}|OVERHEAD|${remarks}|${idOf(a.tag)}`;
          if (doneKeys.has(key)) continue;
          await batches.addTransaction(batchIds[a.batch], { transaction_type: 'OVERHEAD', transaction_date: date, quantity: 1, uom: 'MONTH', rate: OVERHEAD_PER_MONTH, animal_id: idOf(a.tag), remarks } as any, ctx.tenantId, actor);
          doneKeys.add(key);
        }
      });
    }

    // health records
    const treat = async (tag: string, itemName: string, date: string, dose: number, note: string, uom: string) => {
      const med = await item(itemName);
      const [done] = await db.select({ id: schema.animalMedicationLog.log_id }).from(schema.animalMedicationLog).where(and(
        eq(schema.animalMedicationLog.animal_id, idOf(tag)), eq(schema.animalMedicationLog.item_id, med.item_id), eq(schema.animalMedicationLog.administered_date, date))).limit(1);
      if (!done) await medicines.create(idOf(tag), { item_id: med.item_id, administered_date: date, dose_qty: dose, uom: 'ML', administered_by: 'Dr T. Moyo (vet)', notes: note } as any, ctx.tenantId, actor);
      // the cost: the medicine drawn against the animal in her batch, capitalised before her costing start and expensed from it, like her feed
      const a = ANIMALS.find((x) => x.tag === tag)!;
      const remarks = `CT ${note}`;
      const key = `${batchIds[a.batch]}|${date}|CONSUMPTION|${remarks}|${idOf(tag)}`;
      if (!doneKeys.has(key)) {
        await batches.addTransaction(batchIds[a.batch], { transaction_type: 'CONSUMPTION', transaction_date: date, item_id: med.item_id, quantity: uom === 'VIAL' ? 0.2 : 2, uom, animal_id: idOf(tag), source_warehouse_id: store.id, remarks } as any, ctx.tenantId, actor);
        doneKeys.add(key);
      }
    };
    for (const b of ['A', 'B'] as const) {
      const arrival = b === 'A' ? DATE_A : DATE_B;
      on(addDays(arrival, 2), `dewormer ${b}`, async () => { for (const a of ANIMALS.filter((x) => x.batch === b)) await treat(a.tag, 'Ivermectin 1% Swine Dewormer 100ml', addDays(arrival, 2), 5, 'Arrival dewormer', 'VIAL'); });
      on(addDays(arrival, 4), `vaccine ${b}`, async () => { for (const a of ANIMALS.filter((x) => x.batch === b)) await treat(a.tag, 'Parvo-Shield L5 Swine Vaccine (50 Doses)', addDays(arrival, 4), 2, 'Arrival vaccination', 'DOSE'); });
    }
    on('2026-03-25', 'PRRS vaccine', async () => { for (const a of ANIMALS.filter((x) => x.kind === 'SOW' && x.tag !== DEATH.tag)) await treat(a.tag, 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)', '2026-03-25', 2, 'Pre-service PRRS vaccination', 'DOSE'); });

    // the company's female residual changes on 1 Jul; one sow gets her own residual before the July run
    on('2026-06-25', 'residual changes', async () => {
      const have = (await residuals.list(ctx.tenantId, ctx.companyId)).filter((r: any) => r.gender === 'F' && String(r.effective_from).slice(0, 10) === '2026-07-01');
      if (!have.length) {
        await residuals.add({ gender: 'F', residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 160, residual_price_per_kg: 2.05, effective_from: '2026-07-01', note: 'Costing test: heavier end-of-life weight from July' } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId);
        ctx.log('  company residual (female) from 2026-07-01: 160 kg x 2.05 = 328.00');
      }
      await residuals.setForAnimal(idOf('CT-B-SOW-2'), { residual_value: 400, reason: 'Costing test: heavier frame confirmed at weighing' } as any, ctx.tenantId, ctx.actor.userId);
      ctx.log('  CT-B-SOW-2: own residual 400.00');
    });

    // semen, matings, pregnancy checks
    const semenItem = await item(SEMEN_ITEM);
    const collect = (date: string, boar: string, batch: 'A' | 'B', doses: number, q: { volume_ml: number; motility_pct: number; concentration_m_per_ml: number }) => on(date, `semen ${boar}`, async () => {
      const [lot] = await db.select({ id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch).where(and(eq(schema.semenBatch.boar_animal_id, idOf(boar)), eq(schema.semenBatch.collection_date, date))).limit(1);
      if (lot) return;
      const created: any = await breeding.recordSemenCollection({ company_id: ctx.companyId, boar_animal_id: idOf(boar), boar_batch_id: batchIds[batch], collection_date: date, doses_collected: doses, output_item_id: semenItem.item_id, ...q } as any, ctx.tenantId, actor);
      ctx.log(`  ${boar}: semen collected ${date}, ${doses} doses (lot ${created.lot_no ?? '-'})`);
    });
    collect('2026-04-10', 'CT-A-BOAR-1', 'A', 30, { volume_ml: 240, motility_pct: 86, concentration_m_per_ml: 310 });
    collect('2026-05-11', 'CT-B-BOAR-2', 'B', 25, { volume_ml: 220, motility_pct: 84, concentration_m_per_ml: 290 });
    const serve = (date: string, sow: string, boar: string, batch: 'A' | 'B', semenDate: string) => on(date, `mating ${sow}`, async () => {
      const [rec] = await db.select({ id: schema.breedingRecord.breeding_id, result: schema.breedingRecord.conception_result }).from(schema.breedingRecord)
        .where(and(eq(schema.breedingRecord.sow_animal_id, idOf(sow)), eq(schema.breedingRecord.mating_date, date))).limit(1);
      let breedingId = rec?.id; let result = rec?.result;
      if (!breedingId) {
        const [lot] = await db.select({ id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch).where(and(eq(schema.semenBatch.boar_animal_id, idOf(boar)), eq(schema.semenBatch.collection_date, semenDate))).limit(1);
        const created: any = await breeding.recordMating({ company_id: ctx.companyId, sow_animal_id: idOf(sow), batch_id: batchIds[batch], mating_type: MatingType.AI, semen_lot_id: lot?.id, semen_dose_qty: 2, mating_date: date } as any, ctx.tenantId, actor);
        breedingId = created.breeding_id; result = created.conception_result;
        ctx.log(`  ${sow}: inseminated by AI ${date} - expected farrowing ${created.expected_farrowing_date}`);
      }
      const checkDate = addDays(date, 28);
      if ((result === ConceptionResult.PENDING || result == null) && checkDate <= last) {
        await breeding.recordPregnancyCheck(breedingId!, { preg_check_date: checkDate, preg_check_method: PregCheckMethod.ULTRASOUND, conception_result: ConceptionResult.CONFIRMED }, ctx.tenantId, actor);
        ctx.log(`  ${sow}: pregnancy confirmed ${checkDate}`);
      }
    });
    serve(A_SOW_1_MATING, 'CT-A-SOW-1', 'CT-A-BOAR-1', 'A', '2026-04-10');
    serve(B_SOW_2_MATING, 'CT-B-SOW-2', 'CT-B-BOAR-2', 'B', '2026-05-11');

    // farrowings and the weaning with the one gilt selection
    const lactationStage = breed.lifecycleStages.get('LACTATION');
    if (!lactationStage) throw new Error('16-costing-test: the sow breed has no LACTATION lifecycle row.');
    const piglet = await item(PIGLET_ITEM);
    const farrowOf = async (sow: string) => (await db.select({ id: schema.farrowingRecord.farrow_id, weaned: schema.farrowingRecord.piglets_weaned }).from(schema.farrowingRecord).where(eq(schema.farrowingRecord.sow_animal_id, idOf(sow))).limit(1))[0];
    const farrow = (date: string, sow: string, batch: 'A' | 'B', mating: string, live: number, still: number, litterRef: string) => on(date, `farrowing ${sow}`, async () => {
      if (await farrowOf(sow)) return;
      const [rec] = await db.select({ id: schema.breedingRecord.breeding_id }).from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, idOf(sow)), eq(schema.breedingRecord.mating_date, mating))).limit(1);
      const created: any = await breeding.recordFarrowing({
        company_id: ctx.companyId, sow_animal_id: idOf(sow), breeding_id: rec?.id, batch_id: batchIds[batch], farrowing_date: date, piglets_born_live: live, piglets_stillborn: still,
        avg_birth_weight_kg: 1.4, piglet_item_id: piglet.item_id, piglet_stage_id: lactationStage,
      } as any, ctx.tenantId, actor);
      if (created.piglet_batch_id) await db.update(schema.batchHeader).set({ remarks: litterRef }).where(eq(schema.batchHeader.batch_id, created.piglet_batch_id));
      ctx.log(`  ${sow}: farrowed ${date} - ${live} live, ${still} stillborn; cost per piglet ${created.cost_per_piglet ?? '-'}`);
    });
    farrow(A_SOW_1_FARROWING, 'CT-A-SOW-1', 'A', A_SOW_1_MATING, 13, 1, CT_LITTER_A);
    farrow(B_SOW_2_FARROWING, 'CT-B-SOW-2', 'B', B_SOW_2_MATING, 11, 1, CT_LITTER_B);
    on(A_SOW_1_WEANING, 'weaning with gilt selection', async () => {
      const f = await farrowOf('CT-A-SOW-1');
      if (!f || Number(f.weaned) > 0) return;
      await breeding.recordWeaning(f.id, {
        weaning_date: A_SOW_1_WEANING, piglets_weaned: 12, avg_weaning_weight_kg: 7.2, move_to_stage_code: 'WEANER', gilt_colour_code: 'BLUE',
        gilts: GILT_TAGS.map((tag, i) => ({ rfid_tag: tag, no_of_teats: GILT_TEATS[i] })),
      } as any, ctx.tenantId, actor);
      ctx.log(`  CT-A-SOW-1: weaned ${A_SOW_1_WEANING} - 12 piglets (1 lost before weaning), 5 selected as gilts at the weaning`);
    });
    on(A_SOW_1_WEANING, 'gilt feed received', async () => { await receiveFeed(FEED_REF_GILT, GILT_FEED, 100, A_SOW_1_WEANING); });
    on('2026-09-21', 'gilt batch and first feed', async () => {
      const rows = await db.select({ animal_id: schema.animalRegister.animal_id, code: schema.animalRegister.animal_code }).from(schema.animalRegister).where(inArray(schema.animalRegister.rfid_tag, GILT_TAGS));
      if (rows.length !== GILT_TAGS.length) { ctx.log(`  gilt batch skipped: ${rows.length} of ${GILT_TAGS.length} gilts exist`); return; }
      const giltBatch = await ensureBatch({ ref: CT_GILT_BATCH, farm, breedId: breed.breedId, shed: shedForStage(farm, 'GILT_GROWER'), startDate: A_SOW_1_WEANING, animalIds: rows.map((g) => g.animal_id) });
      const feed = await item(GILT_FEED);
      for (const g of rows) {
        const [fed] = await db.select({ id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction)
          .where(and(eq(schema.batchTransaction.batch_id, giltBatch), eq(schema.batchTransaction.animal_id, g.animal_id), eq(schema.batchTransaction.transaction_type, 'CONSUMPTION'))).limit(1);
        if (fed) continue;
        await batches.addTransaction(giltBatch, { transaction_type: 'CONSUMPTION', transaction_date: '2026-09-21', item_id: feed.item_id, quantity: 2, uom: 'KG', animal_id: g.animal_id, source_warehouse_id: store.id, remarks: 'CT first feed of the gilt (capitalised)' } as any, ctx.tenantId, actor);
      }
      await profiles.assignAnimals({ animal_ids: rows.map((g) => g.animal_id) } as any, ctx.tenantId, ctx.companyId);
      ctx.log(`  gilts ${rows.map((g) => g.code).join(', ')}: joined ${CT_GILT_BATCH}, fed 2 kg each (capitalised)`);
    });

    // a sow dies: her value is settled in the exit, and the accumulated amortisation is cleared
    on(DEATH.date, `death ${DEATH.tag}`, async () => {
      const [a] = await db.select({ active: schema.animalRegister.is_active }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, idOf(DEATH.tag))).limit(1);
      if (!a?.active) return;
      await batches.recordMortality(batchIds.A, { transaction_date: DEATH.date, animal_ids: [idOf(DEATH.tag)], remarks: 'Costing test: sow found dead', mortality_detail: { cause_of_death: 'Acute mortality' } } as any, ctx.tenantId, actor);
      ctx.log(`  ${DEATH.tag}: died ${DEATH.date}`);
    });

    // ── 5. The months in order: the month's events, then the month's runs (one per batch and profile).
    const runLog: string[] = [];
    const runMonth = async (month: string) => {
      for (const b of ['A', 'B'] as const) {
        let result: { runs: any[]; failed: Array<{ profile_code: string; error: string }> };
        try {
          result = await runs.calculateBatch({ batch_id: batchIds[b], period_key: month } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId) as any;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.log(`  run ${month} batch ${b}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`);
          continue;
        }
        for (const f of result.failed) ctx.log(`  run ${month} batch ${b} ${f.profile_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
        for (const run of result.runs) {
          if (run.status === 'POSTED') continue;
          const posted: any = await runs.post(run.run_id, ctx.tenantId, ctx.actor.userId);
          runLog.push(`${month} ${b} ${posted.run_no}`);
          ctx.log(`  run ${month} batch ${b} ${posted.run_no}: ${posted.charged_count} charged, ${posted.skipped_count} skipped, total ${posted.total_charge}`);
        }
      }
    };
    events.sort((x, y) => x.date.localeCompare(y.date));
    let next = 0;
    for (let m = FIRST_MONTH; m <= LAST_MONTH; m = nextMonth(m)) {
      const end = monthEnd(m);
      while (next < events.length && events[next].date <= end) await events[next++].run();
      if (end > last) break;
      await runMonth(m);
    }
    while (next < events.length) await events[next++].run();

    // ── 6. Guards: each rule that must refuse is tried; the refusal is the pass.
    const results: GuardResult[] = [];
    const refuses = async (label: string, pattern: RegExp, attempt: () => Promise<unknown>) => {
      try { await attempt(); results.push({ label, pass: false, detail: 'was NOT refused' }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ label, pass: pattern.test(message), detail: message.slice(0, 160) });
      }
    };
    if (last >= monthEnd(LAST_MONTH)) {
      await refuses('G1 run the same month twice', /already been run|already posted after/i, () => runs.calculateBatch({ batch_id: batchIds.A, period_key: LAST_MONTH } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId));
      await refuses('G2 run a month behind a later posted one', /already posted after|already been run/i, () => runs.calculateBatch({ batch_id: batchIds.A, period_key: '2026-08' } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId));
      await refuses('G3 run a month that has not ended', /has not happened yet/i, () => runs.calculateBatch({ batch_id: batchIds.A, period_key: nextMonth(today().slice(0, 7)) } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId));
      await refuses('G4 a period that does not fit the frequency', /not a monthly period/i, () => runs.calculateBatch({ batch_id: batchIds.A, period_key: '2026-W10' } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId));
      const [aug] = await db.select({ id: schema.bioCostingRun.run_id }).from(schema.bioCostingRun).where(and(eq(schema.bioCostingRun.batch_id, batchIds.A), eq(schema.bioCostingRun.period_key, '2026-08'), eq(schema.bioCostingRun.status, 'POSTED'))).limit(1);
      if (aug) {
        await refuses('G5 reverse a run that is not the latest', /reverse the latest run first/i, () => runs.reverse(aug.id, 'costing test', ctx.tenantId, ctx.actor.userId));
        await refuses('G6 post a run that is already posted', /already posted/i, () => runs.post(aug.id, ctx.tenantId, ctx.actor.userId));
      }
      await refuses('G10 change the birth date of an animal that has feed and runs booked to her', /cannot be changed once feed, medicine, overhead or a costing run/i, () => animals.update(idOf('CT-B-SOW-1'), { dob: '2025-06-01' } as any, ctx.tenantId, actor));
      const [thereafter] = await db.select({ dob: schema.animalRegister.dob, start: schema.animalRegister.costing_start_date }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, idOf('CT-B-SOW-1'))).limit(1);
      results.push({ label: 'G10b the refused edit left her birth date and costing start as they were', pass: String(thereafter?.dob).slice(0, 10) === '2025-11-03' && String(thereafter?.start).slice(0, 10) === '2026-06-22', detail: `${String(thereafter?.dob).slice(0, 10)} / ${String(thereafter?.start).slice(0, 10)}` });
      // gilt rules: a second selection on a weaned litter, and a gilt under 15 teats on the litter still on its sow
      const lotA = (await db.select({ id: schema.batchHeader.batch_id }).from(schema.batchHeader).where(eq(schema.batchHeader.remarks, CT_LITTER_A)).limit(1))[0];
      const fA = await farrowOf('CT-A-SOW-1');
      if (lotA && fA) await refuses('G7 select gilts again from a weaned litter', /already been weaned|already selected/i, () => selections.create({ batch_id: lotA.id, selection_date: A_SOW_1_WEANING, lines: [{ farrow_id: fA.id, gilts_selected: 1 }] } as any, ctx.tenantId, actor));
      const lotB = (await db.select({ id: schema.batchHeader.batch_id }).from(schema.batchHeader).where(eq(schema.batchHeader.remarks, CT_LITTER_B)).limit(1))[0];
      const fB = await farrowOf('CT-B-SOW-2');
      if (lotB && fB && B_SOW_2_FARROWING <= last) {
        const draft: any = await selections.create({ batch_id: lotB.id, selection_date: addDays(B_SOW_2_FARROWING, 28) <= last ? addDays(B_SOW_2_FARROWING, 28) : last, lines: [{ farrow_id: fB.id, gilts_selected: 1 }] } as any, ctx.tenantId, actor);
        await refuses('G8 a gilt with 14 teats', /at least 15/i, () => selections.createGilts(draft.selection_id, { gilts: [{ line_id: draft.lines[0].line_id, rfid_tag: 'CT-GILT-X', no_of_teats: 14 }] } as any, ctx.tenantId, actor));
        await refuses('G9 a second selection while one is open', /already selected from this litter/i, () => selections.create({ batch_id: lotB.id, selection_date: last, lines: [{ farrow_id: fB.id, gilts_selected: 1 }] } as any, ctx.tenantId, actor));
        await selections.cancel(draft.selection_id, ctx.tenantId, actor);
      }
      // reverse the September runs of batch B (the latest) and make them again: the ledger and journal are mirrored, then posted anew
      const sepB = await db.select({ id: schema.bioCostingRun.run_id, no: schema.bioCostingRun.run_no }).from(schema.bioCostingRun)
        .where(and(eq(schema.bioCostingRun.batch_id, batchIds.B), eq(schema.bioCostingRun.period_key, LAST_MONTH), eq(schema.bioCostingRun.status, 'POSTED')));
      const alreadyReversed = (await db.select({ id: schema.bioCostingRun.run_id }).from(schema.bioCostingRun).where(and(eq(schema.bioCostingRun.batch_id, batchIds.B), eq(schema.bioCostingRun.period_key, LAST_MONTH), eq(schema.bioCostingRun.status, 'REVERSED')))).length > 0;
      if (sepB.length && !alreadyReversed) {
        for (const r of sepB) await runs.reverse(r.id, 'Costing test: reverse and run again', ctx.tenantId, ctx.actor.userId);
        ctx.log(`  reversed batch B's ${LAST_MONTH} runs (${sepB.map((r) => r.no).join(', ')}); calculating them again`);
        await runMonth(LAST_MONTH);
        results.push({ label: 'R1 reverse the latest runs of a batch and run the month again', pass: true, detail: `${sepB.length} runs reversed and re-posted` });
      }
    }
    ctx.log('\n  Guard checks (a rule that must refuse is tried; the refusal is the pass):');
    for (const r of results) ctx.log(`    ${r.pass ? 'PASS' : 'FAIL'}  ${r.label} -> ${r.detail}`);
    const failed = results.filter((r) => !r.pass);
    if (failed.length) throw new Error(`16-costing-test: ${failed.length} guard check(s) failed: ${failed.map((f) => f.label).join('; ')}`);
    void sql;
  },
};

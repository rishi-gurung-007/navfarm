/**
 * Chapter `15-full-flow` — ON DEMAND ONLY (`pnpm nx run api:db-full-flow`; never part of a rebuild). ONE imported sow and ONE imported boar live
 * their whole life in the app, every step posted through the application's own services (Ruling 1), dated in order and nothing in the future,
 * so the whole costing chain can be tested on two animals you can follow by hand (docs/TEST-GUIDE-full-flow.md):
 *
 *   5 Jan 2026   Goods receipt of the sow (850) and the boar (1,200) and of the feed stock; both registered with papers, grouped in one Animal Wise
 *                batch. The sow is 13 weeks old, the boar 22: IMP-F / IMP-M are assigned and their costing start dates follow from their ages
 *                (sow 25 May = birth + 33 weeks, boar 2 Feb = birth + 26 weeks).
 *   weekly       Feed per animal, every Monday (boar: gestation mash; sow: gestation mash, then the lactation diet while she nurses) and a monthly
 *                housing/labour overhead. BEFORE an animal's costing start the cost is CAPITALISED into her book value; ON/AFTER it, it is EXPENSED.
 *   health       Dewormer, vaccines and the sow's PRRS vaccine on the cards.
 *   monthly      A costing run for the batch after each month is entered (Jan to Sep, in order): the boar is amortised from February, the sow from
 *                her May start; each run is calculated and posted (ledger rows + journal).
 *   10 Apr       Semen collected from the boar AFTER his Feb/Mar amortisation was posted, so the lot's cost per dose includes it.
 *   13 Apr       The sow (27 weeks) is inseminated by AI from that lot; pregnancy confirmed 28 days later.
 *   7 Aug        Farrowing (116 days): 13 born alive, 1 stillborn. The litter opens as a piglet lot at the sow's capitalised cost (birth cost,
 *                ledger + journal BIO_LITTER_BIRTH); her feed after 25 May was expensed, so only 13 Apr - 24 May is in the litter.
 *   4 Sep        Weaning (day 28), with the litter's ONE gilt selection (BBP: once, at week 4): 5 gilts (LOC-F, born on farm), then their own batch and a
 *                first feed (capitalised).
 *
 * Resume-safe: the receipt by its reference, animals by RFID, the batch by its remarks token, each transaction by (batch, animal, date, kind), each
 * mating by (sow, date), the semen lot by (boar, date), a run by (profile, period, batch). Prices, ages, rations and litter sizes are demo facts,
 * not client data.
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
import { GlMappingService } from '../../../modules/finance/gl-mapping/gl-mapping.service';
import { MatingType, PregCheckMethod, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createAnimalWiseBatchEnsurer, createItemLookup, shedForStage } from '../batch-helpers';

export const FLOW_BATCH_REMARKS = 'FLOW-BATCH';
export const FLOW_GILT_BATCH_REMARKS = 'FLOW-GILT-BATCH';
const FLOW_LITTER_REMARKS = 'FLOW-SOW-01-LITTER';
const RECEIPT_REF = 'DEMO-FLOW-GRN';
const FEED_REF_GEST = 'DEMO-FLOW-FEED-GESTATION';
const FEED_REF_LACT = 'DEMO-FLOW-FEED-LACTATION';
const GESTATION_DAYS = 116;
const LACTATION_DAYS = 28;

const PURCHASE_DATE = '2026-01-05'; // a Monday: the weekly feed entries fall on Mondays from here
const SOW_TAG = 'FLOW-IMP-SOW-01';
const BOAR_TAG = 'FLOW-IMP-BOAR-01';
const SOW_DOB = '2025-10-06';
const BOAR_DOB = '2025-08-04';
const SEMEN_DATE = '2026-04-10';
const MATING_DATE = '2026-04-13';
const FARROWING_DATE = '2026-08-07'; // MATING_DATE + 116
const WEANING_DATE = '2026-09-04';
const GILT_TAGS = ['FLOW-GILT-01', 'FLOW-GILT-02', 'FLOW-GILT-03', 'FLOW-GILT-04', 'FLOW-GILT-05'];
const GILT_TEATS = [16, 15, 16, 17, 15];
const GILT_FEED_DATE = '2026-09-21';
const LAST_FEED_DATE = '2026-09-28';

const SOW_ITEM = 'Mature Parity Breeding Sow';
const BOAR_ITEM = 'Mature Herd Sire Boar';
const PIGLET_ITEM = 'Suckling Live Piglet (0-4 Wks)';
const SEMEN_ITEM = 'BOAR semen';
const GEST_FEED = 'Dry Sow Gestation Mash (14% CP)';
const LACT_FEED = 'High-Density Lactation Diet (17.5% CP)';
const GILT_FEED = 'Weaner Grower Mash (18% CP)';
const FEED_REF_GILT = 'DEMO-FLOW-FEED-GILT';

const SOW_KG_PER_DAY = 2.5;
const LACTATING_KG_PER_DAY = 6;
const BOAR_KG_PER_DAY = 2.8;
const OVERHEAD_PER_MONTH = 12;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Event { date: string; label: string; run: () => Promise<void> }

export const fullFlowChapter: DemoChapter = {
  name: '15-full-flow',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const batches = ctx.app.get(BatchService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const breeding = ctx.app.get(BreedingService);
    const profiles = ctx.app.get(BioCostingProfileService);
    const runs = ctx.app.get(BioCostingRunService);
    const medicines = ctx.app.get(AnimalMedicationLogService);
    const selections = ctx.app.get(GiltSelectionService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('15-full-flow: tenantDb is not set — run through the harness.');
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('15-full-flow: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    const item = createItemLookup(db, ctx.companyId);
    const last = today();
    // A silo holds one feed item at a time, and the sow needs two, so the stock goes into the farm's store.
    if (!farm.storeId) throw new Error('15-full-flow: MUL100 has no store to receive the feed into.');
    const store = { id: farm.storeId, code: 'the MUL100 store' };

    // ── 0. The birth-cost journal needs account 1055 and its mapping; without it the litter still gets its cost in the ledger, but no journal.
    await ensureBirthJournalMapping(ctx, db);

    // ── 1. The purchase: one receipt, a line per kind, at the supplier's prices.
    const sowItem = await item(SOW_ITEM);
    const boarItem = await item(BOAR_ITEM);
    let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt)
      .where(eq(schema.goodsReceipt.external_reference_no, RECEIPT_REF)).limit(1);
    if (!receipt) {
      const created = await receipts.create({
        company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: PURCHASE_DATE, external_reference_no: RECEIPT_REF,
        remarks: 'DEMO full flow: 1 imported sow and 1 imported boar from Denmark',
        lines: [
          { item_id: sowItem.item_id, quantity: 1, uom: 'HEAD', rate: 850, lot_no: 'DEMO-FLOW-SOW-LOT' },
          { item_id: boarItem.item_id, quantity: 1, uom: 'HEAD', rate: 1200, lot_no: 'DEMO-FLOW-BOAR-LOT' },
        ],
      }, ctx.tenantId);
      receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
    }
    if (receipt.status === 'DRAFT') {
      await receipts.post(receipt.receipt_id, ctx.tenantId);
      ctx.log(`  goods receipt ${RECEIPT_REF} posted (${PURCHASE_DATE}): sow at 850, boar at 1200`);
    }

    // The feed stock, received into the farm's store before it is drawn; each feed in its own receipt, the lactation diet when she needs it.
    const receiveFeed = async (ref: string, name: string, kg: number, date: string) => {
      const [have] = await db.select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      let id = have?.id; let status = have?.status;
      if (!id) {
        const feed = await item(name);
        const created = await receipts.create({
          company_id: ctx.companyId, warehouse_id: store.id, posting_date: date, external_reference_no: ref, remarks: `DEMO full flow: ${name} for the sow and the boar`,
          lines: [{ item_id: feed.item_id, quantity: kg, uom: 'KG', rate: Number(feed.standard_cost ?? 0) || undefined }],
        }, ctx.tenantId);
        id = created.receipt_id; status = 'DRAFT';
      }
      if (status === 'DRAFT') { await receipts.post(id!, ctx.tenantId); ctx.log(`  feed receipt ${ref} (${date}): ${kg} kg ${name} into ${store.code}`); }
    };
    await receiveFeed(FEED_REF_GEST, GEST_FEED, 1600, PURCHASE_DATE);

    // ── 2. The animals, with their papers.
    const sowStage = breed.lifecycleStages.get('INSEMINATION');
    const boarStage = breed.lifecycleStages.get('QUARANTINE');
    if (!sowStage || !boarStage) throw new Error('15-full-flow: the sow breed needs INSEMINATION and QUARANTINE lifecycle rows.');
    const sowPens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const boarPens = shedForStage(farm, 'QUARANTINE')?.penIds ?? pensForRole(farm, 'BOAR');
    const registry = [
      { tag: SOW_TAG, kind: 'SOW', gender: 'F', dob: SOW_DOB, teats: 14, tsi: 120, grading: 87, sire: 'DK-LR-91207', dam: 'DK-LR-80455', itemId: sowItem.item_id, stage: sowStage, pen: sowPens[0], note: 'Imported Danish Landrace sow, health certificate on file' },
      { tag: BOAR_TAG, kind: 'BOAR', gender: 'M', dob: BOAR_DOB, teats: undefined, tsi: 127, grading: 91, sire: 'DK-DU-60118', dam: 'DK-DU-59340', itemId: boarItem.item_id, stage: boarStage, pen: boarPens[0], note: 'Imported Danish Duroc boar, semen-collection trained' },
    ];
    const ids = new Map<string, string>();
    for (const a of registry) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: a.gender, entry_type: 'PURCHASED_IMPORTED', entry_date: PURCHASE_DATE, dob: a.dob,
          source_receipt_id: receipt.receipt_id, item_id: a.itemId, rfid_tag: a.tag, sire_serial_no: a.sire, dam_serial_no: a.dam, current_location_id: a.pen, current_stage_id: a.stage,
          no_of_teats: a.teats, tsi: a.tsi, grading: a.grading, notes: a.note, expected_cull_date: addDays(PURCHASE_DATE, 365 * 3),
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}): ${a.kind}, born ${a.dob}`);
      }
      ids.set(a.tag, row.animal_id);
    }
    const sowId = ids.get(SOW_TAG)!;
    const boarId = ids.get(BOAR_TAG)!;

    // ── 3. The batch that holds them.
    const ensureBatch = createAnimalWiseBatchEnsurer(db, batches, ctx);
    const batchId = await ensureBatch({
      ref: FLOW_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'INSEMINATION'), startDate: PURCHASE_DATE, animalIds: [...ids.values()],
    });
    await db.update(schema.schedulerHeader).set({ effective_from: PURCHASE_DATE }).where(eq(schema.schedulerHeader.batch_id, batchId));
    await profiles.assignAnimals({ animal_ids: [...ids.values()] } as any, ctx.tenantId, ctx.companyId);

    // ── 4. The timeline: every event has a date; the monthly runs are interleaved so each month's run sees exactly what was entered up to its end.
    const events: Event[] = [];
    const on = (date: string, label: string, run: () => Promise<void>) => { if (date <= last) events.push({ date, label, run }); };

    const feedItems = { gest: await item(GEST_FEED), lact: await item(LACT_FEED) };
    const transactionKeys = new Set(
      (await db.select({ a: schema.batchTransaction.animal_id, d: schema.batchTransaction.transaction_date, t: schema.batchTransaction.transaction_type, r: schema.batchTransaction.remarks })
        .from(schema.batchTransaction).where(eq(schema.batchTransaction.batch_id, batchId)))
        .map((t) => `${t.a}|${String(t.d).slice(0, 10)}|${t.t}|${t.r ?? ''}`),
    );
    const post = async (tag: string, tx: Record<string, unknown>) => {
      const animalId = ids.get(tag)!;
      const key = `${animalId}|${tx.transaction_date}|${tx.transaction_type}|${tx.remarks}`;
      if (transactionKeys.has(key)) return;
      await batches.addTransaction(batchId, { ...tx, animal_id: animalId } as any, ctx.tenantId, actor);
      transactionKeys.add(key);
    };

    // weekly feed, every Monday from the purchase; the sow eats the lactation diet while she nurses
    const lactStart = FARROWING_DATE;
    const lactEnd = addDays(FARROWING_DATE, LACTATION_DAYS);
    let lactationDiet = false;
    for (let d = PURCHASE_DATE; d <= LAST_FEED_DATE; d = addDays(d, 7)) {
      const date = d;
      const nursing = date > lactStart && date < lactEnd;
      if (nursing) lactationDiet = true;
      on(date, `feed ${date}`, async () => {
        await post(BOAR_TAG, { transaction_type: 'CONSUMPTION', transaction_date: date, item_id: feedItems.gest.item_id, quantity: round2(BOAR_KG_PER_DAY * 7), uom: 'KG', source_warehouse_id: store.id, remarks: 'FLOW weekly feed (boar)' });
        await post(SOW_TAG, nursing
          ? { transaction_type: 'CONSUMPTION', transaction_date: date, item_id: feedItems.lact.item_id, quantity: round2(LACTATING_KG_PER_DAY * 7), uom: 'KG', source_warehouse_id: store.id, remarks: 'FLOW weekly feed (sow, lactation diet)' }
          : { transaction_type: 'CONSUMPTION', transaction_date: date, item_id: feedItems.gest.item_id, quantity: round2(SOW_KG_PER_DAY * 7), uom: 'KG', source_warehouse_id: store.id, remarks: 'FLOW weekly feed (sow)' });
      });
    }
    if (lactationDiet) {
      on(addDays(FARROWING_DATE, -14), 'lactation diet received', async () => { await receiveFeed(FEED_REF_LACT, LACT_FEED, 300, addDays(FARROWING_DATE, -14)); });
    }

    // a monthly overhead per animal (housing and labour allocation), capitalised before her start and expensed after
    for (let m = '2026-01'; m <= '2026-09'; m = nextMonth(m)) {
      const date = `${m}-15`;
      on(date, `overhead ${m}`, async () => {
        for (const tag of [BOAR_TAG, SOW_TAG]) await post(tag, { transaction_type: 'OVERHEAD', transaction_date: date, quantity: 1, uom: 'MONTH', rate: OVERHEAD_PER_MONTH, remarks: 'FLOW housing and labour allocation' });
      });
    }

    // health records on the cards
    const treat = async (tag: string, itemName: string, date: string, dose: number, note: string) => {
      const med = await item(itemName);
      const animalId = ids.get(tag)!;
      const [done] = await db.select({ id: schema.animalMedicationLog.log_id }).from(schema.animalMedicationLog).where(and(
        eq(schema.animalMedicationLog.animal_id, animalId), eq(schema.animalMedicationLog.item_id, med.item_id), eq(schema.animalMedicationLog.administered_date, date))).limit(1);
      if (!done) await medicines.create(animalId, { item_id: med.item_id, administered_date: date, dose_qty: dose, uom: 'ML', administered_by: 'Dr T. Moyo (vet)', notes: note } as any, ctx.tenantId, actor);
    };
    on('2026-01-07', 'dewormer', async () => { for (const tag of [SOW_TAG, BOAR_TAG]) await treat(tag, 'Ivermectin 1% Swine Dewormer 100ml', '2026-01-07', 5, 'Arrival dewormer'); });
    on('2026-01-09', 'arrival vaccine', async () => { for (const tag of [SOW_TAG, BOAR_TAG]) await treat(tag, 'Parvo-Shield L5 Swine Vaccine (50 Doses)', '2026-01-09', 2, 'Arrival vaccination'); });
    on('2026-03-25', 'PRRS vaccine', async () => { await treat(SOW_TAG, 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)', '2026-03-25', 2, 'Pre-service PRRS vaccination'); });

    // semen, insemination, pregnancy check
    const semenItem = await item(SEMEN_ITEM);
    let semenLotId: string | undefined;
    let breedingId: string | undefined;
    on(SEMEN_DATE, 'semen collected', async () => {
      let [lot] = await db.select({ semen_batch_id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch)
        .where(and(eq(schema.semenBatch.boar_animal_id, boarId), eq(schema.semenBatch.collection_date, SEMEN_DATE))).limit(1);
      if (!lot) {
        const created: any = await breeding.recordSemenCollection({
          company_id: ctx.companyId, boar_animal_id: boarId, boar_batch_id: batchId, collection_date: SEMEN_DATE, doses_collected: 30, output_item_id: semenItem.item_id,
          volume_ml: 240, motility_pct: 86, concentration_m_per_ml: 310,
        } as any, ctx.tenantId, actor);
        lot = { semen_batch_id: created.semen_batch_id };
        ctx.log(`  ${BOAR_TAG}: semen collected ${SEMEN_DATE}, 30 doses (lot ${created.lot_no ?? '-'})`);
      }
      semenLotId = lot.semen_batch_id;
    });
    on(MATING_DATE, 'AI mating', async () => {
      let [record] = await db.select({ breeding_id: schema.breedingRecord.breeding_id, conception_result: schema.breedingRecord.conception_result })
        .from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, sowId), eq(schema.breedingRecord.mating_date, MATING_DATE))).limit(1);
      if (!record) {
        if (!semenLotId) {
          const [lot] = await db.select({ semen_batch_id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch)
            .where(and(eq(schema.semenBatch.boar_animal_id, boarId), eq(schema.semenBatch.collection_date, SEMEN_DATE))).limit(1);
          semenLotId = lot?.semen_batch_id;
        }
        const created: any = await breeding.recordMating({
          company_id: ctx.companyId, sow_animal_id: sowId, batch_id: batchId, mating_type: MatingType.AI, semen_lot_id: semenLotId, semen_dose_qty: 2, mating_date: MATING_DATE,
        } as any, ctx.tenantId, actor);
        record = { breeding_id: created.breeding_id, conception_result: created.conception_result };
        ctx.log(`  ${SOW_TAG}: inseminated by AI ${MATING_DATE} - expected farrowing ${created.expected_farrowing_date}`);
      }
      breedingId = record.breeding_id;
      if (record.conception_result === ConceptionResult.PENDING || record.conception_result == null) {
        const checkDate = addDays(MATING_DATE, 28);
        if (checkDate <= last) {
          await breeding.recordPregnancyCheck(record.breeding_id, { preg_check_date: checkDate, preg_check_method: PregCheckMethod.ULTRASOUND, conception_result: ConceptionResult.CONFIRMED }, ctx.tenantId, actor);
          ctx.log(`  ${SOW_TAG}: pregnancy confirmed ${checkDate}`);
        }
      }
    });

    // farrowing
    const lactationStage = breed.lifecycleStages.get('LACTATION');
    if (!lactationStage) throw new Error('15-full-flow: the sow breed has no LACTATION lifecycle row.');
    const piglet = await item(PIGLET_ITEM);
    let farrowId: string | undefined;
    const farrowOf = async () => {
      const [row] = await db.select({ farrow_id: schema.farrowingRecord.farrow_id, weaned: schema.farrowingRecord.piglets_weaned, lot: schema.farrowingRecord.piglet_batch_id })
        .from(schema.farrowingRecord).where(eq(schema.farrowingRecord.sow_animal_id, sowId)).limit(1);
      return row;
    };
    on(FARROWING_DATE, 'farrowing', async () => {
      let farrow = await farrowOf();
      if (!farrow) {
        const [rec] = await db.select({ breeding_id: schema.breedingRecord.breeding_id }).from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, sowId), eq(schema.breedingRecord.mating_date, MATING_DATE))).limit(1);
        const created: any = await breeding.recordFarrowing({
          company_id: ctx.companyId, sow_animal_id: sowId, breeding_id: breedingId ?? rec?.breeding_id, batch_id: batchId, farrowing_date: FARROWING_DATE,
          piglets_born_live: 13, piglets_stillborn: 1, avg_birth_weight_kg: 1.4, piglet_item_id: piglet.item_id, piglet_stage_id: lactationStage,
        } as any, ctx.tenantId, actor);
        if (created.piglet_batch_id) await db.update(schema.batchHeader).set({ remarks: FLOW_LITTER_REMARKS }).where(eq(schema.batchHeader.batch_id, created.piglet_batch_id));
        ctx.log(`  ${SOW_TAG}: farrowed ${FARROWING_DATE} - 13 live, 1 stillborn; lot ${created.piglet_batch_id ? 'opened' : 'none'}, cost per piglet ${created.cost_per_piglet ?? '-'}`);
        farrow = await farrowOf();
      }
      farrowId = farrow?.farrow_id;
    });

    // gilt selection: BBP, once per litter, at week 4 - here in the weaning form, on day 28 (the Select gilts button is gone once a litter is weaned)
    const haveGilt = async (tag: string) => (await db.select({ id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, tag)).limit(1)).length > 0;
    on(WEANING_DATE, 'weaning with gilt selection', async () => {
      const farrow = await farrowOf();
      if (!farrow || Number(farrow.weaned) > 0) return;
      const body: any = {
        weaning_date: WEANING_DATE, piglets_weaned: 12, avg_weaning_weight_kg: 7.2, move_to_stage_code: 'WEANER', gilt_colour_code: 'BLUE',
        gilts: GILT_TAGS.map((tag, i) => ({ rfid_tag: tag, no_of_teats: GILT_TEATS[i] })),
      };
      if (await haveGilt(GILT_TAGS[0])) delete body.gilts;
      await breeding.recordWeaning(farrow.farrow_id, body, ctx.tenantId, actor);
      ctx.log(`  ${SOW_TAG}: weaned ${WEANING_DATE} - 12 piglets (1 lost before weaning), 5 of them selected as gilts at the weaning (the one selection the BBP allows)`);
    });

    // the gilts' own batch and first feed (capitalised: their costing start is far ahead)
    on(WEANING_DATE, 'gilt feed received', async () => { await receiveFeed(FEED_REF_GILT, GILT_FEED, 100, WEANING_DATE); });
    on(GILT_FEED_DATE, 'gilt batch and first feed', async () => {
      const tags = GILT_TAGS;
      const rows = await db.select({ animal_id: schema.animalRegister.animal_id, code: schema.animalRegister.animal_code }).from(schema.animalRegister).where(inArray(schema.animalRegister.rfid_tag, tags));
      if (rows.length !== tags.length) { ctx.log(`  gilt batch skipped: ${rows.length} of ${tags.length} gilts exist`); return; }
      const giltBatchId = await ensureBatch({ ref: FLOW_GILT_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'GILT_GROWER'), startDate: WEANING_DATE, animalIds: rows.map((g) => g.animal_id) });
      const feed = await item(GILT_FEED);
      for (const g of rows) {
        const [fed] = await db.select({ id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction)
          .where(and(eq(schema.batchTransaction.batch_id, giltBatchId), eq(schema.batchTransaction.animal_id, g.animal_id), eq(schema.batchTransaction.transaction_type, 'CONSUMPTION'))).limit(1);
        if (fed) continue;
        await batches.addTransaction(giltBatchId, { transaction_type: 'CONSUMPTION', transaction_date: GILT_FEED_DATE, item_id: feed.item_id, quantity: 2, uom: 'KG', animal_id: g.animal_id, source_warehouse_id: store.id, remarks: 'FLOW first feed of the gilt (capitalised)' } as any, ctx.tenantId, actor);
      }
      await profiles.assignAnimals({ animal_ids: rows.map((g) => g.animal_id) } as any, ctx.tenantId, ctx.companyId);
      ctx.log(`  gilts ${rows.map((g) => g.code).join(', ')}: joined batch ${FLOW_GILT_BATCH_REMARKS}, fed 2 kg each on ${GILT_FEED_DATE} (capitalised)`);
    });

    // ── 5. Walk the months in order: the month's events, then the month's run.
    events.sort((a, b) => a.date.localeCompare(b.date));
    let next = 0;
    for (let m = '2026-01'; m <= '2026-09'; m = nextMonth(m)) {
      const end = monthEnd(m);
      while (next < events.length && events[next].date <= end) {
        const e = events[next++];
        await e.run();
      }
      if (end > last) break;
      await runMonth(m);
    }
    while (next < events.length) await events[next++].run(); // events dated after the last run month (none in the plan; kept for a re-dated chapter)

    async function runMonth(month: string) {
      let calculated: { runs: any[]; failed: Array<{ profile_code: string; error: string }> };
      try {
        calculated = await runs.calculateBatch({ batch_id: batchId, period_key: month } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId) as any;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`  run ${month}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`);
        return;
      }
      for (const f of calculated.failed) ctx.log(`  run ${month} ${f.profile_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
      for (const run of calculated.runs) {
        if (run.status === 'POSTED') continue;
        const posted: any = await runs.post(run.run_id, ctx.tenantId, ctx.actor.userId);
        ctx.log(`  run ${month} ${posted.profile_code ?? ''} ${posted.run_no}: posted, ${posted.charged_count ?? '?'} charged, total ${posted.total_charge ?? '?'}`);
      }
    }

    // ── 6. What the two animals and the litter hold now.
    const rows = await db.select({ code: schema.animalRegister.animal_code, tag: schema.animalRegister.rfid_tag, profile: schema.animalRegister.costing_profile_id, start: schema.animalRegister.costing_start_date, bv: schema.animalRegister.book_value })
      .from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, [sowId, boarId]));
    ctx.log(`  costing: ${rows.map((r) => `${r.code} profile=${r.profile ? 'yes' : 'NO'} start=${r.start} book=${r.bv}`).join(' | ')}`);
    void farrowId;
  },
};

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Account 1055 and the BIO_LITTER_BIRTH mapping (Dr 1055 / Cr 1050): the birth-cost journal is opt-in, so the demo switches it on. */
export async function ensureBirthJournalMapping(ctx: DemoContext, db: MySql2Database<typeof schema>) {
  const G = schema.glAccountMaster;
  const accounts = await db.select({ id: G.gl_account_id, code: G.account_code }).from(G).where(inArray(G.account_code, ['1050', '1055']));
  const wip = accounts.find((a) => a.code === '1050');
  const inventory = accounts.find((a) => a.code === '1055');
  if (!wip || !inventory) { ctx.log('  birth-cost journal not switched on: the chart lacks account 1050 or 1055 (the litter still gets its cost in the bio-asset ledger)'); return; }
  const [mapped] = await db.select({ id: schema.glMappingMaster.mapping_id }).from(schema.glMappingMaster).where(eq(schema.glMappingMaster.transaction_type, 'BIO_LITTER_BIRTH')).limit(1);
  if (mapped) return;
  try {
    await ctx.app.get(GlMappingService).create({ company_id: ctx.companyId, transaction_type: 'BIO_LITTER_BIRTH', debit_gl_account_id: inventory.id, credit_gl_account_id: wip.id } as any, ctx.tenantId);
    ctx.log('  GL mapping BIO_LITTER_BIRTH created (Dr 1055 Piglets Inventory / Cr 1050 Biological Assets Pre-mature)');
  } catch (error) {
    ctx.log(`  birth-cost journal not switched on: ${error instanceof Error ? error.message : error}`);
  }
}

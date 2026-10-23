/**
 * Chapter `14-costing-walkthrough` — ON DEMAND ONLY (`pnpm nx run api:db-costing-walkthrough`; never part of a rebuild). One imported
 * breeding group lives its life in the app so bio-asset costing can be tested on it, every step posted through the application's own
 * services (Ruling 1) and dated in order, nothing in the future:
 *
 *   1 Mar 2026   Goods receipt of 2 imported sows and 2 imported boars (the purchase price is each animal's cost). The four are registered
 *                in the Animal Register with their papers, teats, TSI, grading and parents' serial numbers, and grouped in one Animal
 *                Wise batch that starts the same day. The registration hook gives each her costing profile (IMP-F / IMP-M).
 *   1-15 Mar     Daily entries from the batch's first day: feed consumption per animal (the stock is received first, so the inventory ledger
 *                holds both the receipt and each FIFO draw), body weights; each day posted and locked. Health records on the cards.
 *                The days after the 15th are left for the person testing to enter: a day cannot be posted until the one before it is.
 *   20 Mar       Semen collected from boar 1 (a lot of doses in the store, with its QR pack).
 *   22 Mar       Sow 1 inseminated by AI from that lot; pregnancy confirmed 28 days later.
 *   16 Jul       Sow 1 farrows (116 days): the litter is held as a piglet lot.      6 Aug  Weaned: one full parity.
 *   28 Jul, 1 Aug  Boar 2's semen; sow 2 inseminated; confirmed pregnant (farrowing is still ahead).
 *   6 Aug        (with the weaning) Gilt selection (GS-...): 3 gilts picked from sow 1's litter (RFID WALK-GILT-01..03, 15-17 teats), the one selection
 *                the BBP allows a litter, made in the weaning form; each gilt is a Local asset (LOC-F) whose costing starts at birth + 33 weeks. They join their own
 *                Animal Wise batch (WALK-GILT-BATCH) and are fed on 20 Oct: that feed is CAPITALISED, because her costing start is far ahead.
 *
 * Resume-safe: the receipt by its reference, animals by RFID, the batch by its remarks token, each mating by (sow, date), each semen lot
 * by (boar, date); the daily entries skip what is already posted. Prices, ages, doses and litter sizes are demo facts, not client data.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BreedingService } from '../../../modules/piggery/breeding/breeding.service';
import { AnimalMedicationLogService } from '../../../modules/piggery/animal/animal-medication-log.service';
import { BioCostingProfileService } from '../../../modules/finance/bio-costing/bio-costing-profile.service';
import { MatingType, PregCheckMethod, ConceptionResult } from '../../../modules/piggery/breeding/dto/breeding.dto';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createAnimalWiseBatchEnsurer, createItemLookup, shedForStage } from '../batch-helpers';
import { dailyEntriesChapter } from './04-daily-entries';

export const WALK_GILT_BATCH_REMARKS = 'WALK-GILT-BATCH';
export const WALK_BATCH_REMARKS = 'DEMO-WALK-REG-IMP'; // DEMO- so chapter 04 serves it; -REG-IMP so its days post whole
const RECEIPT_REF = 'DEMO-WALK-GRN';
const GESTATION_DAYS = 116;
const LACTATION_DAYS = 21;
const PURCHASE_DATE = '2026-03-01';
const GILT_TAGS = ['WALK-GILT-01', 'WALK-GILT-02', 'WALK-GILT-03'];
const GILT_TEATS = [16, 15, 17];

const SOW_ITEM = 'Mature Parity Breeding Sow';
const BOAR_ITEM = 'Mature Herd Sire Boar';
const PIGLET_ITEM = 'Suckling Live Piglet (0-4 Wks)';
const SEMEN_ITEM = 'BOAR semen';

/** The four imported animals. Prices are what the supplier invoiced; papers are the supplier's serial numbers for each parent. */
const ANIMALS = [
  { tag: 'WALK-IMP-SOW-01', kind: 'SOW', gender: 'F', dob: '2025-06-02', price: 850, teats: 14, tsi: 118, grading: 86, sire: 'DK-LR-88421', dam: 'DK-LR-77310', note: 'Imported Danish Landrace sow, health certificate on file' },
  { tag: 'WALK-IMP-SOW-02', kind: 'SOW', gender: 'F', dob: '2025-06-16', price: 850, teats: 15, tsi: 121, grading: 88, sire: 'DK-LR-88421', dam: 'DK-LR-77344', note: 'Imported Danish Landrace sow, health certificate on file' },
  { tag: 'WALK-IMP-BOAR-01', kind: 'BOAR', gender: 'M', dob: '2025-08-04', price: 1200, teats: undefined, tsi: 126, grading: 90, sire: 'DK-DU-55012', dam: 'DK-DU-54870', note: 'Imported Danish Duroc boar, semen-collection trained' },
  { tag: 'WALK-IMP-BOAR-02', kind: 'BOAR', gender: 'M', dob: '2025-08-18', price: 1200, teats: undefined, tsi: 124, grading: 89, sire: 'DK-DU-55012', dam: 'DK-DU-54901', note: 'Imported Danish Duroc boar, semen-collection trained' },
] as const;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const range = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const today = () => new Date().toISOString().slice(0, 10);

export const costingWalkthroughChapter: DemoChapter = {
  name: '14-costing-walkthrough',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const batches = ctx.app.get(BatchService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const breeding = ctx.app.get(BreedingService);
    const profiles = ctx.app.get(BioCostingProfileService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('14-costing-walkthrough: tenantDb is not set — run through the harness.');
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('14-costing-walkthrough: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    const item = createItemLookup(db, ctx.companyId);
    const last = today();

    // ── 1. The purchase: one receipt, a line per kind, at the supplier's prices.
    const sowItem = await item(SOW_ITEM);
    const boarItem = await item(BOAR_ITEM);
    let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt)
      .where(eq(schema.goodsReceipt.external_reference_no, RECEIPT_REF)).limit(1);
    if (!receipt) {
      const created = await receipts.create({
        company_id: ctx.companyId, warehouse_id: farm.farmId, posting_date: PURCHASE_DATE, external_reference_no: RECEIPT_REF,
        remarks: 'DEMO costing walkthrough: 2 imported sows and 2 imported boars from Denmark',
        lines: [
          { item_id: sowItem.item_id, quantity: 2, uom: 'HEAD', rate: 850, lot_no: 'DEMO-WALK-SOW-LOT' },
          { item_id: boarItem.item_id, quantity: 2, uom: 'HEAD', rate: 1200, lot_no: 'DEMO-WALK-BOAR-LOT' },
        ],
      }, ctx.tenantId);
      receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
    }
    if (receipt.status === 'DRAFT') {
      await receipts.post(receipt.receipt_id, ctx.tenantId);
      ctx.log(`  goods receipt ${RECEIPT_REF} posted (${PURCHASE_DATE}): 2 sows at 850, 2 boars at 1200`);
    }

    // ── 2. The animals, one by one, with their papers.
    const sowStage = breed.lifecycleStages.get('INSEMINATION');
    const boarStage = breed.lifecycleStages.get('QUARANTINE');
    if (!sowStage || !boarStage) throw new Error('14-costing-walkthrough: the sow breed needs INSEMINATION and QUARANTINE lifecycle rows.');
    const sowPens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const boarPens = shedForStage(farm, 'QUARANTINE')?.penIds ?? pensForRole(farm, 'BOAR');
    const ids = new Map<string, string>();
    let n = 0;
    for (const a of ANIMALS) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const isSow = a.kind === 'SOW';
        const pens = isSow ? sowPens : boarPens;
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: a.gender, entry_type: 'PURCHASED_IMPORTED', entry_date: PURCHASE_DATE, dob: a.dob,
          source_receipt_id: receipt.receipt_id, item_id: isSow ? sowItem.item_id : boarItem.item_id, rfid_tag: a.tag,
          sire_serial_no: a.sire, dam_serial_no: a.dam, current_location_id: pens[n % pens.length], current_stage_id: isSow ? sowStage : boarStage,
          no_of_teats: a.teats, tsi: a.tsi, grading: a.grading, notes: a.note, expected_cull_date: addDays(PURCHASE_DATE, 365 * 3),
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}): ${a.kind}, born ${a.dob}, ${a.price}`);
      }
      ids.set(a.tag, row.animal_id);
      n += 1;
    }

    // ── 3. The batch that holds them, starting the day they arrived.
    const ensureBatch = createAnimalWiseBatchEnsurer(db, batches, ctx);
    const batchId = await ensureBatch({
      ref: WALK_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'INSEMINATION'), startDate: PURCHASE_DATE,
      animalIds: [...ids.values()],
    });
    await db.update(schema.schedulerHeader).set({ effective_from: PURCHASE_DATE }).where(eq(schema.schedulerHeader.batch_id, batchId));

    // Whoever the registration hook did not reach (it dates a profile by the day she arrived) is given hers now.
    await profiles.assignAnimals({ animal_ids: [...ids.values()] } as any, ctx.tenantId, ctx.companyId);

    // Health & Treatments on the cards: a dewormer and a vaccine for all four, and the PRRS vaccine for the sows.
    const medicines = ctx.app.get(AnimalMedicationLogService);
    const treat = async (tag: string, itemName: string, date: string, dose: number, note: string) => {
      const med = await item(itemName);
      const animalId = ids.get(tag)!;
      const [done] = await db.select({ id: schema.animalMedicationLog.log_id }).from(schema.animalMedicationLog).where(and(
        eq(schema.animalMedicationLog.animal_id, animalId), eq(schema.animalMedicationLog.item_id, med.item_id), eq(schema.animalMedicationLog.administered_date, date))).limit(1);
      if (!done) await medicines.create(animalId, { item_id: med.item_id, administered_date: date, dose_qty: dose, uom: 'ML', administered_by: 'Dr T. Moyo (vet)', notes: note } as any, ctx.tenantId, actor);
    };
    for (const a of ANIMALS) {
      await treat(a.tag, 'Ivermectin 1% Swine Dewormer 100ml', '2026-03-03', 5, 'Arrival dewormer');
      await treat(a.tag, 'Parvo-Shield L5 Swine Vaccine (50 Doses)', '2026-03-05', 2, 'Arrival vaccination');
      if (a.kind === 'SOW') await treat(a.tag, 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)', '2026-03-10', 2, 'Pre-service PRRS vaccination');
    }
    ctx.log('  health records: dewormer and vaccine on all four animals, PRRS vaccine on the sows');

    // ── 4. First window of daily entries: feed (stock received first, then drawn), body weights, each day locked.
    // A re-run finds the window posted and locked, and the entry service refuses to post it again: leave it.
    const [window] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, batchId), eq(schema.batchDailyData.posted, true)));
    if (Number(window?.n ?? 0) > 0) {
      ctx.log(`  daily entries ${PURCHASE_DATE} - 2026-03-15 already posted - skipped`);
    } else {
      ctx.dailyEntryScope = { batchRemarks: [WALK_BATCH_REMARKS], dates: range(PURCHASE_DATE, '2026-03-15') };
      await dailyEntriesChapter.run(ctx);
      ctx.dailyEntryScope = undefined;
    }

    // ── 5. Semen, insemination, pregnancy check; farrowing and weaning for sow 1.
    const semenItem = await item(SEMEN_ITEM);
    const collect = async (boarTag: string, date: string, doses: number, q: { volume_ml: number; motility_pct: number; concentration_m_per_ml: number }) => {
      const boarId = ids.get(boarTag)!;
      let [lot] = await db.select({ semen_batch_id: schema.semenBatch.semen_batch_id }).from(schema.semenBatch)
        .where(and(eq(schema.semenBatch.boar_animal_id, boarId), eq(schema.semenBatch.collection_date, date))).limit(1);
      if (!lot) {
        const created: any = await breeding.recordSemenCollection({
          company_id: ctx.companyId, boar_animal_id: boarId, boar_batch_id: batchId, collection_date: date, doses_collected: doses, output_item_id: semenItem.item_id, ...q,
        } as any, ctx.tenantId, actor);
        lot = { semen_batch_id: created.semen_batch_id };
        ctx.log(`  ${boarTag}: semen collected ${date}, ${doses} doses (lot ${created.lot_no ?? '-'})`);
      }
      return lot.semen_batch_id;
    };
    const serve = async (sowTag: string, lotId: string, matingDate: string) => {
      const sowId = ids.get(sowTag)!;
      let [record] = await db.select({ breeding_id: schema.breedingRecord.breeding_id, conception_result: schema.breedingRecord.conception_result })
        .from(schema.breedingRecord).where(and(eq(schema.breedingRecord.sow_animal_id, sowId), eq(schema.breedingRecord.mating_date, matingDate))).limit(1);
      if (!record) {
        const created: any = await breeding.recordMating({
          company_id: ctx.companyId, sow_animal_id: sowId, batch_id: batchId, mating_type: MatingType.AI, semen_lot_id: lotId, semen_dose_qty: 2, mating_date: matingDate,
        } as any, ctx.tenantId, actor);
        record = { breeding_id: created.breeding_id, conception_result: created.conception_result };
        ctx.log(`  ${sowTag}: inseminated by AI ${matingDate} - expected farrowing ${created.expected_farrowing_date}`);
      }
      if (record.conception_result === ConceptionResult.PENDING || record.conception_result == null) {
        const checkDate = addDays(matingDate, 28);
        await breeding.recordPregnancyCheck(record.breeding_id, { preg_check_date: checkDate, preg_check_method: PregCheckMethod.ULTRASOUND, conception_result: ConceptionResult.CONFIRMED }, ctx.tenantId, actor);
        ctx.log(`  ${sowTag}: pregnancy confirmed ${checkDate}`);
      }
      return record.breeding_id;
    };

    const lot1 = await collect('WALK-IMP-BOAR-01', '2026-03-20', 30, { volume_ml: 240, motility_pct: 86, concentration_m_per_ml: 310 });
    const breeding1 = await serve('WALK-IMP-SOW-01', lot1, '2026-03-22');

    const farrowingDate = addDays('2026-03-22', GESTATION_DAYS);
    const piglet = await item(PIGLET_ITEM);
    const lactationStage = breed.lifecycleStages.get('LACTATION');
    if (!lactationStage) throw new Error('14-costing-walkthrough: the sow breed has no LACTATION lifecycle row.');
    if (farrowingDate <= last) {
      let [farrow] = await db.select({ farrow_id: schema.farrowingRecord.farrow_id, piglets_weaned: schema.farrowingRecord.piglets_weaned }).from(schema.farrowingRecord)
        .where(eq(schema.farrowingRecord.breeding_id, breeding1)).limit(1);
      if (!farrow) {
        const created: any = await breeding.recordFarrowing({
          company_id: ctx.companyId, sow_animal_id: ids.get('WALK-IMP-SOW-01')!, breeding_id: breeding1, batch_id: batchId, farrowing_date: farrowingDate,
          piglets_born_live: 13, piglets_stillborn: 1, avg_birth_weight_kg: 1.38, piglet_item_id: piglet.item_id, piglet_stage_id: lactationStage,
        } as any, ctx.tenantId, actor);
        farrow = { farrow_id: created.farrow_id, piglets_weaned: 0 };
        if (created.piglet_batch_id) await db.update(schema.batchHeader).set({ remarks: 'WALK-IMP-SOW-01-LITTER' }).where(eq(schema.batchHeader.batch_id, created.piglet_batch_id));
        ctx.log(`  WALK-IMP-SOW-01: farrowed ${farrowingDate} - 13 live, 1 stillborn`);
      }
      const weaningDate = addDays(farrowingDate, LACTATION_DAYS);
      if (Number(farrow.piglets_weaned) === 0 && weaningDate <= last) {
        // BBP: the gilts of a litter are selected once; here, in the weaning form (the Select gilts button is gone once a litter is weaned).
        await breeding.recordWeaning(farrow.farrow_id, {
          weaning_date: weaningDate, piglets_weaned: 12, avg_weaning_weight_kg: 7.0, move_to_stage_code: 'WEANER', gilt_colour_code: 'BLUE',
          gilts: GILT_TAGS.map((tag, i) => ({ rfid_tag: tag, no_of_teats: GILT_TEATS[i] })),
        } as any, ctx.tenantId, actor);
        ctx.log(`  WALK-IMP-SOW-01: weaned ${weaningDate} - 12 piglets at 7.0 kg (one full parity), ${GILT_TAGS.length} selected as gilts at the weaning`);
      }
    }

    // sow 2: served later, confirmed pregnant, farrowing still ahead
    const lot2 = await collect('WALK-IMP-BOAR-02', '2026-07-28', 30, { volume_ml: 225, motility_pct: 84, concentration_m_per_ml: 295 });
    await serve('WALK-IMP-SOW-02', lot2, '2026-08-01');

    // ── 6. The gilts were selected at sow 1's weaning (step 5); here is their own batch and first feed.
    const SELECTION_DATE = addDays(farrowingDate, LACTATION_DAYS);
    const FEED_DATE = '2026-10-20';
    const giltRows = await db.select({ animal_id: schema.animalRegister.animal_id, code: schema.animalRegister.animal_code, tag: schema.animalRegister.rfid_tag }).from(schema.animalRegister).where(inArray(schema.animalRegister.rfid_tag, GILT_TAGS));
    if (giltRows.length === GILT_TAGS.length) {
      const giltBatchId = await ensureBatch({
        ref: WALK_GILT_BATCH_REMARKS, farm, breedId: breed.breedId, shed: shedForStage(farm, 'GILT_GROWER'), startDate: SELECTION_DATE,
        animalIds: giltRows.map((g) => g.animal_id),
      });
      const feed = await item('Costing Test Feed C (Average, not tracked)');
      for (const g of giltRows) {
        const [fed] = await db.select({ id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction)
          .where(and(eq(schema.batchTransaction.batch_id, giltBatchId), eq(schema.batchTransaction.animal_id, g.animal_id), eq(schema.batchTransaction.transaction_type, 'CONSUMPTION'))).limit(1);
        if (fed) continue;
        await batches.addTransaction(giltBatchId, { transaction_type: 'CONSUMPTION', transaction_date: FEED_DATE, item_id: feed.item_id, quantity: 2, uom: 'KG', animal_id: g.animal_id, remarks: 'DEMO walkthrough: first feed of the gilt (capitalised)' } as any, ctx.tenantId, actor);
      }
      await profiles.assignAnimals({ animal_ids: giltRows.map((g) => g.animal_id) } as any, ctx.tenantId, ctx.companyId);
      ctx.log(`  gilts ${giltRows.map((g) => g.code).join(', ')}: joined batch ${WALK_GILT_BATCH_REMARKS}, fed 2 kg each on ${FEED_DATE} (capitalised)`);
    }

    const where = inArray(schema.animalRegister.animal_id, [...ids.values()]);
    const rows = await db.select({ code: schema.animalRegister.animal_code, tag: schema.animalRegister.rfid_tag, profile: schema.animalRegister.costing_profile_id, start: schema.animalRegister.costing_start_date, bv: schema.animalRegister.book_value })
      .from(schema.animalRegister).where(where);
    ctx.log(`  costing: ${rows.map((r) => `${r.code} profile=${r.profile ? 'yes' : 'NO'} start=${r.start} book=${r.bv}`).join(' | ')}`);
  },
};

/**
 * Chapter `03-batches-and-animals` — Phase 3 Task 5. Everything through the
 * services (Ruling 1):
 *
 *   Grasmere: one **Registered Animals** breeding batch (BIO_ASSET costing,
 *   Gilt Grower stage, Grasmere breed profile, `auto_generate_scheduler`)
 *   whose 9 animals (8 sows + 1 boar) are then created one by one through
 *   `AnimalService.create` with explicit demo facts — never derived from
 *   opening quantity (Ruling 3); plus one **Count Only** grower batch.
 *   Kintyre: one **Count Only** grower batch.
 *
 * Batch create leaves the batch DRAFT; `BatchService.activate` takes it
 * through BIO_ACQUISITION GL + bio-asset ledger posting. Registered animals
 * carry `entry_type: 'PURCHASED_LOCAL'` with the chapter's livestock goods
 * receipt (posted in 02-inventory) as their `source_receipt_id` — the
 * acquisition cost is read off that receipt line by the service.
 *
 * Resume semantics like 02-inventory: batches are located by their DEMO
 * remarks token; DRAFT batches are activated, absent batches are created.
 * Animals are keyed by ear_tag and skipped when already present.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}


const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

/** Demo animals — explicit facts per plan Task 5 Step 2, not client data. */
const DEMO_ANIMALS = [
  // Grasmere's only farm-bound breed profile is Z-Line-Sow (Phase 2 made
  // breeds farm-specific); all 9 animals use it.
  { ear_tag: 'DEMO-SOW-01', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 120, no_of_teats: 16 },
  { ear_tag: 'DEMO-SOW-02', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 115, no_of_teats: 14 },
  { ear_tag: 'DEMO-SOW-03', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 110, no_of_teats: 16 },
  { ear_tag: 'DEMO-SOW-04', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 105, no_of_teats: 15 },
  { ear_tag: 'DEMO-SOW-05', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 118, no_of_teats: 16 },
  { ear_tag: 'DEMO-SOW-06', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 112, no_of_teats: 15 },
  { ear_tag: 'DEMO-SOW-07', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 108, no_of_teats: 14 },
  { ear_tag: 'DEMO-SOW-08', animal_type: 'SOW', gender: 'F', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001', age_at_entry_weeks: 114, no_of_teats: 16 },
  { ear_tag: 'DEMO-BOAR-01', animal_type: 'BOAR', gender: 'M', breed_code: 'Z-Line-Sow', item_code: 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-BOAR-ITM-0001', age_at_entry_weeks: 90 },
] as const;


interface BatchRefs {
  registeredGrasmere: string;
  countOnlyGrasmere: string;
  countOnlyKintyre: string;
}

export const batchesAndAnimalsChapter: DemoChapter<BatchRefs> = {
  name: '03-batches-and-animals',

  async run(ctx: DemoContext): Promise<BatchRefs> {
    const batches = ctx.app.get(BatchService);
    const animals = ctx.app.get(AnimalService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('03-batches-and-animals: tenantDb is not set — run through the harness.');

    // Fourteen days back, so the scheduler owes a 14-day history ending
    // yesterday — what the daily-entries chapter (04) posts and what the demo
    // needs to show Missing days and a backlog on screen.
    const startDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

    /** Create-activate a batch per its DEMO remarks token, resume-safe. */
    async function ensureBatch(opts: {
      ref: string;
      farmId: string;
      farmCode: string;
      animalTracking: 'REGISTERED' | 'COUNT_ONLY';
      stageCode: 'GILT_GROWER' | 'GESTATION';
      breedId?: string;
      openingQuantity: number;
      inputLines: { item_id: string; quantity: number; uom: string; rate?: number }[];
      remarks: string;
    }): Promise<string> {
      const [stage] = await db
        .select({ stage_id: schema.stageMaster.stage_id })
        .from(schema.stageMaster)
        .where(and(
          eq(schema.stageMaster.stage_code, opts.stageCode),
          eq(schema.stageMaster.lob_id, PIGGERY_LOB_ID),
          eq(schema.stageMaster.company_id, ctx.companyId),
          eq(schema.stageMaster.is_active, true),
          isNull(schema.stageMaster.deleted_at),
        ))
        .limit(1);
      if (!stage) throw new Error(`03-batches: stage ${opts.stageCode} (company-scoped) not found.`);

      const [existing] = await db
        .select({ batch_id: schema.batchHeader.batch_id, status: schema.batchHeader.status })
        .from(schema.batchHeader)
        .where(eq(schema.batchHeader.remarks, opts.ref))
        .limit(1);
      if (existing) {
        if (existing.status === 'DRAFT') {
          await batches.activate(existing.batch_id, ctx.tenantId);
          ctx.log(`${opts.farmCode}: batch ${opts.ref} was DRAFT — activated now`);
        } else {
          ctx.log(`${opts.farmCode}: batch ${opts.ref} already ${existing.status} — skipped`);
        }
        return existing.batch_id;
      }

      const created = await batches.create(
        {
          company_id: ctx.companyId,
          lob_id: PIGGERY_LOB_ID,
          farm_id: opts.farmId,
          animal_tracking: opts.animalTracking,
          costing_method: 'BIO_ASSET',
          breed_id: opts.breedId,
          stage_id: stage.stage_id,
          auto_generate_scheduler: true,
          start_date: startDate,
          opening_quantity: opts.openingQuantity,
          uom: 'HEAD',
          remarks: opts.ref,
          input_lines: opts.inputLines,
        },
        ctx.tenantId,
      );
      await batches.activate(created.batch_id, ctx.tenantId);
      ctx.log(`${opts.farmCode}: created + activated ${opts.animalTracking} batch ${created.batch_no} (${opts.ref})`);
      return created.batch_id;
    }

    const [giltItem] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_code, 'LIVESTOCK-BIOLOGICAL_ASSETS-GROWER_FINISHER-PIGLET-ITM-0002'), eq(schema.itemMaster.is_active, true)))
      .limit(1);
    const [sowItem] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_code, 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001'), eq(schema.itemMaster.is_active, true)))
      .limit(1);
    const [boarItem] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_code, 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-BOAR-ITM-0001'), eq(schema.itemMaster.is_active, true)))
      .limit(1);

    const [grasmereBreed] = await db
      .select({ breed_id: schema.breedMaster.breed_id })
      .from(schema.breedMaster)
      .where(and(eq(schema.breedMaster.breed_code, 'Z-Line-Sow'), eq(schema.breedMaster.location_id, ctx.farms.grasmere), isNull(schema.breedMaster.deleted_at)))
      .limit(1);
    if (!grasmereBreed) throw new Error('03-batches: Grasmere breed profile Z-Line-Sow not found — the master stages must load Triple C breeds first.');

    // Kintyre's farm-bound breed (Phase 2 made breeds farm-specific).
    const [kintyreBreed] = await db
      .select({ breed_id: schema.breedMaster.breed_id })
      .from(schema.breedMaster)
      .where(and(eq(schema.breedMaster.breed_code, 'TN-70-Sow'), eq(schema.breedMaster.location_id, ctx.farms.kintyre), isNull(schema.breedMaster.deleted_at)))
      .limit(1);
    if (!kintyreBreed) throw new Error('03-batches: Kintyre breed profile TN-70-Sow not found — the master stages must load Triple C breeds first.');

    // A Grasmere pen under a grower shed for the registered animals.
    const [pen] = await db
      .select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_type, 'PEN'),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
        eq(schema.locationMaster.parent_location_id,
          db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(and(eq(schema.locationMaster.location_code, 'MUGR9'), isNull(schema.locationMaster.deleted_at))).limit(1),
        ),
      ))
      .limit(1);
    if (!pen) throw new Error('03-batches: no active pen under Grasmere MUGR9.');

    // The breeding stock's purchase document: a goods receipt of 8 sows and
    // 1 boar into the Grasmere farm. AnimalService reads each animal's
    // acquisition cost off this receipt's line rate. Resume-safe by
    // external_reference_no; a DRAFT from an interrupted run is posted.
    const livestockReceiptRef = 'DEMO-MUL100-LIVESTOCK';
    const receipts = ctx.app.get(GoodsReceiptService);
    let [livestockReceipt] = await db
      .select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
      .from(schema.goodsReceipt)
      .where(eq(schema.goodsReceipt.external_reference_no, livestockReceiptRef))
      .limit(1);
    if (!livestockReceipt) {
      const createdReceipt = await receipts.create(
        {
          company_id: ctx.companyId,
          warehouse_id: ctx.farms.grasmere,
          posting_date: startDate,
          external_reference_no: livestockReceiptRef,
          remarks: 'DEMO breeding stock purchase (8 sows, 1 boar) into Grasmere',
          lines: [
            { item_id: sowItem.item_id, quantity: 8, uom: 'HEAD', rate: rateOf(sowItem.standard_cost), lot_no: 'DEMO-SOW-LOT' },
            { item_id: boarItem.item_id, quantity: 1, uom: 'HEAD', rate: rateOf(boarItem.standard_cost), lot_no: 'DEMO-BOAR-LOT' },
          ],
        },
        ctx.tenantId,
      );
      livestockReceipt = { receipt_id: createdReceipt.receipt_id, status: 'DRAFT' };
      ctx.log('MUL100: breeding stock goods receipt created');
    }
    if (livestockReceipt.status === 'DRAFT') {
      await receipts.post(livestockReceipt.receipt_id, ctx.tenantId);
      ctx.log('MUL100: breeding stock goods receipt posted');
    }

    const registeredId = await ensureBatch({
      ref: 'DEMO-BATCH-REG-GRASMERE',
      farmId: ctx.farms.grasmere,
      farmCode: 'MUL100',
      animalTracking: 'REGISTERED',
      stageCode: 'GILT_GROWER',
      breedId: grasmereBreed.breed_id,
      openingQuantity: DEMO_ANIMALS.length,
      // Sows + the boar as the batch's opening inputs (BIO_ASSET acquisition
      // at activate). Rates read from item standard_cost.
      inputLines: [
        { item_id: sowItem.item_id, quantity: 8, uom: 'HEAD', rate: rateOf(sowItem.standard_cost) },
        { item_id: boarItem.item_id, quantity: 1, uom: 'HEAD', rate: rateOf(boarItem.standard_cost) },
      ],
      remarks: 'DEMO-BATCH-REG-GRASMERE',
    });

    const countOnlyGrasmereId = await ensureBatch({
      ref: 'DEMO-BATCH-CO-GRASMERE',
      farmId: ctx.farms.grasmere,
      farmCode: 'MUL100',
      animalTracking: 'COUNT_ONLY',
      stageCode: 'GESTATION',
      // A count-only batch still carries its farm's breed: the auto-generated
      // scheduler only grows lines from breed_lifecycle_stages, which are
      // keyed by breed — without it the scheduler is born empty.
      breedId: grasmereBreed.breed_id,
      openingQuantity: 120,
      inputLines: [{ item_id: giltItem.item_id, quantity: 120, uom: 'HEAD', rate: rateOf(giltItem.standard_cost) }],
      remarks: 'DEMO-BATCH-CO-GRASMERE',
    });

    const countOnlyKintyreId = await ensureBatch({
      ref: 'DEMO-BATCH-CO-KINTYRE',
      farmId: ctx.farms.kintyre,
      farmCode: 'POR100',
      animalTracking: 'COUNT_ONLY',
      stageCode: 'GESTATION',
      breedId: kintyreBreed.breed_id,
      openingQuantity: 100,
      inputLines: [{ item_id: giltItem.item_id, quantity: 100, uom: 'HEAD', rate: rateOf(giltItem.standard_cost) }],
      remarks: 'DEMO-BATCH-CO-KINTYRE',
    });

    // --- Registered animals, one by one (Ruling 3).
    const [registeredBatch] = await db
      .select({ stage_id: schema.batchHeader.stage_id })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, registeredId))
      .limit(1);
    if (!registeredBatch?.stage_id) throw new Error('03-batches: registered batch carries no stage_id.');

    let created = 0;
    for (const spec of DEMO_ANIMALS) {
      const [already] = await db
        .select({ animal_id: schema.animalRegister.animal_id })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.ear_tag, spec.ear_tag))
        .limit(1);
      if (already) continue;

      const [breed] = await db
        .select({ breed_id: schema.breedMaster.breed_id })
        .from(schema.breedMaster)
        .where(and(eq(schema.breedMaster.breed_code, spec.breed_code), eq(schema.breedMaster.company_id, ctx.companyId), isNull(schema.breedMaster.deleted_at)))
        .limit(1);
      if (!breed) throw new Error(`03-batches: breed ${spec.breed_code} not found for animal ${spec.ear_tag}.`);

      await animals.create(
        {
          company_id: ctx.companyId,
          animal_type: spec.animal_type,
          breed_id: breed.breed_id,
          gender: spec.gender,
          entry_type: 'PURCHASED_LOCAL',
          entry_date: startDate,
          age_at_entry_weeks: spec.age_at_entry_weeks,
          source_receipt_id: livestockReceipt.receipt_id,
          item_id: spec.animal_type === 'BOAR' ? boarItem.item_id : sowItem.item_id,
          ear_tag: spec.ear_tag,
          current_batch_id: registeredId,
          current_location_id: pen.location_id,
          current_stage_id: registeredBatch.stage_id,
          no_of_teats: 'no_of_teats' in spec ? spec.no_of_teats : undefined,
        },
        ctx.tenantId,
      );
      created += 1;
      ctx.log(`MUL100: registered ${spec.ear_tag} (${spec.animal_type}, ${spec.breed_code})`);
    }
    if (created > 0) ctx.log(`MUL100: ${created} animal(s) registered onto the batch`);

    return { registeredGrasmere: registeredId, countOnlyGrasmere: countOnlyGrasmereId, countOnlyKintyre: countOnlyKintyreId };
  },
};

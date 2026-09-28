/**
 * Seeds two new production batches for Triple C Piggery:
 * 1. One BATCH_WISE batch (e.g. BATCH-000004) in WEANER stage with rich descriptive scheduler activities.
 * 2. One ANIMAL_WISE batch (e.g. BATCH-000005) in FLUSH stage with exactly 8 animals and rich descriptive scheduler activities.
 *
 * Usage:
 *   pnpm nx run api:db-seed-piggery-two-batches            # Dry-run (prints plan)
 *   pnpm nx run api:db-seed-piggery-two-batches -- --verify # Applies inside transaction and rolls back
 *   pnpm nx run api:db-seed-piggery-two-batches -- --apply  # Commits changes
 */
import * as mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

const DB = process.env.DEV_TENANT_DATABASE || 'tenant_devco';

async function main() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');

  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only plan), --verify, or --apply.');
  }

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: DB,
  });

  try {
    await conn.beginTransaction();

    console.log(`[seed-piggery-two-batches] Connected to database: ${DB} (Mode: ${apply ? 'APPLY' : verify ? 'VERIFY (Rollback)' : 'PLAN (Read-only)'})`);

    // 1. Resolve master IDs
    const [compRows]: any = await conn.execute(`SELECT company_id, tenant_id FROM company_master LIMIT 1`);
    if (!compRows.length) throw new Error('No company found.');
    const { company_id, tenant_id } = compRows[0];

    const [nobLobRows]: any = await conn.execute(
      `SELECT nob_id, lob_id FROM lob_master WHERE lob_name LIKE '%Pig%' LIMIT 1`
    );
    const nob_id = nobLobRows[0]?.nob_id || '50000000-5000-5000-5000-000000000002';
    const lob_id = nobLobRows[0]?.lob_id || '60000000-6000-6000-6000-000000000007';

    const [opAreaRows]: any = await conn.execute(
      `SELECT area_id FROM operational_area_master WHERE is_active = 1 LIMIT 1`
    );
    const operational_area_id = opAreaRows[0]?.area_id || '2898d456-a6ae-4cbe-8b01-31444b85c36e';

    const [breedRows]: any = await conn.execute(
      `SELECT breed_id FROM breed_master WHERE is_active = 1 LIMIT 1`
    );
    const breed_id = breedRows[0]?.breed_id || '15e7a841-9f66-4d0d-b08d-071a0307e854';

    const [farmRows]: any = await conn.execute(
      `SELECT location_id FROM location_master WHERE location_type = 'FARM' AND is_active = 1 LIMIT 1`
    );
    const farm_id = farmRows[0]?.location_id || null;

    // Resolve company-scoped stage IDs
    const [weanerStage]: any = await conn.execute(
      `SELECT stage_id FROM stage_master WHERE stage_code = 'WEANER' AND (company_id = ? OR company_id IS NULL) AND is_active = 1 ORDER BY company_id DESC LIMIT 1`,
      [company_id]
    );
    const weanerStageId = weanerStage[0]?.stage_id || 'ed0a074d-6235-48be-97ad-85a657b33e7c';

    const [growerStage]: any = await conn.execute(
      `SELECT stage_id FROM stage_master WHERE stage_code = 'GROWER' AND (company_id = ? OR company_id IS NULL) AND is_active = 1 ORDER BY company_id DESC LIMIT 1`,
      [company_id]
    );
    const growerStageId = growerStage[0]?.stage_id || '4bc6f00a-7595-46db-8e9a-368b829d4c14';

    const [flushStage]: any = await conn.execute(
      `SELECT stage_id FROM stage_master WHERE stage_code = 'FLUSH' AND (company_id = ? OR company_id IS NULL) AND is_active = 1 ORDER BY company_id DESC LIMIT 1`,
      [company_id]
    );
    const flushStageId = flushStage[0]?.stage_id || 'ab02db8c-5804-4e7c-8aff-fcd3d5292b7d';

    const [insemStage]: any = await conn.execute(
      `SELECT stage_id FROM stage_master WHERE stage_code = 'INSEMINATION' AND (company_id = ? OR company_id IS NULL) AND is_active = 1 ORDER BY company_id DESC LIMIT 1`,
      [company_id]
    );
    const insemStageId = insemStage[0]?.stage_id || 'ee9cb42d-12ec-4804-856b-917158d2c2d8';

    // Resolve item IDs
    const [items]: any = await conn.execute(`SELECT item_id, item_code, item_name FROM item_master WHERE is_active = 1`);
    const findItem = (codeOrName: string) =>
      items.find((i: any) => i.item_code.includes(codeOrName) || i.item_name.toLowerCase().includes(codeOrName.toLowerCase()))?.item_id || null;

    const creepFeedId = findItem('ICAT-004-ITM-0001') || findItem('Creep');
    const growerMashId = findItem('ICAT-004-ITM-0004') || findItem('Weaner Grower');
    const drySowMashId = findItem('ICAT-004-ITM-0002') || findItem('Dry Sow');
    const soyaMealId = findItem('ICAT-002-ITM-0001') || findItem('Soya Meal');
    const maizeGrainId = findItem('ICAT-001-ITM-0001') || findItem('Maize');
    const vitaminPremixId = findItem('ICAT-003-ITM-0001') || findItem('Vitamin');
    const giltLivestockId = findItem('ICAT-007-ITM-0001') || findItem('Gilt') || items[0]?.item_id;

    // Check existing batches to determine batch numbers
    const [existingBatches]: any = await conn.execute(
      `SELECT batch_id, batch_no FROM batch_header WHERE batch_no IN ('BATCH-000004', 'BATCH-000005')`
    );
    if (existingBatches.length > 0) {
      console.log(`Batches BATCH-000004 / BATCH-000005 already exist:`, existingBatches.map((b: any) => b.batch_no));
      if (!apply && !verify) {
        await conn.rollback();
        await conn.end();
        return;
      }
    }

    const todayStr = '2026-09-24';

    // ─────────────────────────────────────────────────────────────
    // 2. BATCH 1: BATCH-WISE (BATCH-000004) - WEANER Stage
    // ─────────────────────────────────────────────────────────────
    const batch1Id = randomUUID();
    const batch1No = 'BATCH-000004';
    const batch1Qty = 25;

    console.log(`\n--- Plan: Batch 1 (BATCH_WISE) ---`);
    console.log(`Batch No: ${batch1No}`);
    console.log(`Type: BATCH_WISE (COUNT_ONLY)`);
    console.log(`Stage: WEANER (${weanerStageId})`);
    console.log(`Opening Quantity: ${batch1Qty} HEAD`);
    console.log(`Start Date: ${todayStr}`);

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO batch_header (
          batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
          costing_method, breed_id, farm_id, start_date, status,
          opening_quantity, uom, remarks, current_stage_code,
          stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'STANDARD', ?, ?, ?, 'ACTIVE',
          ?, 'HEAD', 'Commercial Weaner Cohort 2026-B4', 'WEANER',
          ?, ?, 'COUNT_ONLY', 'BATCH_WISE', NOW(), NOW()
        )`,
        [batch1Id, tenant_id, company_id, batch1No, lob_id, nob_id, breed_id, farm_id, todayStr, batch1Qty, weanerStageId, operational_area_id]
      );

      // Input line
      await conn.execute(
        `INSERT INTO batch_input_line (
          line_id, batch_id, line_no, item_id, quantity, uom, rate, amount
        ) VALUES (?, ?, 1, ?, ?, 'HEAD', 18000, ?)`,
        [randomUUID(), batch1Id, giltLivestockId, batch1Qty, batch1Qty * 18000]
      );
    }

    // Schedulers for Batch 1: WEANER stage
    const scheduler1Id = randomUUID();
    console.log(`Creating Scheduler for Batch 1 WEANER stage with 10 rich activities...`);

    const batch1WeanerActivities = [
      {
        line_seq: 1,
        line_type: 'CONSUMPTION',
        activity_name: 'Morning Weaner Creep Feed (22% CP Pre-Starter)',
        item_id: creepFeedId,
        standard_qty: 1.2,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 2,
        line_type: 'CONSUMPTION',
        activity_name: 'Afternoon Weaner Grower Mash (18% CP High-Protein)',
        item_id: growerMashId,
        standard_qty: 0.8,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 3,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Weaner Mortality & Morbidity Inspection',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 4,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Automatic Drinker & Clean Water Flow Verification',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 5,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Nursery Pen Cleanliness & Dry Bedding Audit',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 6,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Room Temperature, Humidity & Airflow Log',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 7,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Coughing, Sneezing & Respiratory Distress Scoring',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 8,
        line_type: 'CONSUMPTION',
        activity_name: 'Water-Soluble Multivitamin & Mineral Electrolyte Pack',
        item_id: vitaminPremixId,
        standard_qty: 0.05,
        qty_basis: 'PER_HEAD',
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 9,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Weekly Weaner Weight Sampling & ADG Growth Monitoring',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'WEEKLY',
        day_of_week: 4,
        start_day: 1,
      },
      {
        line_seq: 10,
        line_type: 'RESOURCE',
        activity_name: 'Weekly Veterinarian Clinical Health & Sanitation Check',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'WEEKLY',
        day_of_week: 4,
        start_day: 1,
      },
    ];

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO scheduler_header (
          scheduler_id, tenant_id, company_id, batch_id, stage_id,
          breed_id, lob_id, nob_id, data_entry_level, scheduler_status,
          effective_from, animal_count, auto_generated, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 'SHED', 'ACTIVE',
          ?, ?, 1, NOW(), NOW()
        )`,
        [scheduler1Id, tenant_id, company_id, batch1Id, weanerStageId, breed_id, lob_id, nob_id, todayStr, batch1Qty]
      );

      for (const act of batch1WeanerActivities) {
        await conn.execute(
          `INSERT INTO scheduler_line (
            line_id, scheduler_id, line_seq, line_type, activity_name,
            stage_id, occurrence, start_day, is_mandatory, source,
            item_id, standard_qty, qty_basis, allow_qty_edit, is_active
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'AUTO',
            ?, ?, ?, 1, 1
          )`,
          [
            randomUUID(),
            scheduler1Id,
            act.line_seq,
            act.line_type,
            act.activity_name,
            weanerStageId,
            act.occurrence,
            act.start_day,
            act.is_mandatory,
            act.item_id,
            act.standard_qty,
            act.qty_basis,
          ]
        );
      }
    }

    // Scheduler for Batch 1: GROWER stage (destination stage in pipeline)
    const scheduler1GrowerId = randomUUID();
    console.log(`Creating Scheduler for Batch 1 GROWER stage with 6 rich activities...`);

    const batch1GrowerActivities = [
      {
        line_seq: 1,
        line_type: 'CONSUMPTION',
        activity_name: 'Morning Grower Mash (18% CP Bulk Feed)',
        item_id: growerMashId,
        standard_qty: 2.2,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 2,
        line_type: 'CONSUMPTION',
        activity_name: 'Evening Energy Feed Supplement (Yellow Maize Grain)',
        item_id: maizeGrainId,
        standard_qty: 1.0,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 3,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Grower Pen Health & Mortality Audit',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 4,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Fresh Water Supply & Trough Cleanliness Audit',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 5,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Weekly Grower Weight Gain & Feed Conversion Evaluation',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'WEEKLY',
        day_of_week: 4,
        start_day: 1,
      },
      {
        line_seq: 6,
        line_type: 'RESOURCE',
        activity_name: 'Bi-weekly Veterinary Barn Inspection Round',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'WEEKLY',
        day_of_week: 4,
        start_day: 1,
      },
    ];

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO scheduler_header (
          scheduler_id, tenant_id, company_id, batch_id, stage_id,
          breed_id, lob_id, nob_id, data_entry_level, scheduler_status,
          effective_from, animal_count, auto_generated, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 'SHED', 'ACTIVE',
          ?, ?, 1, NOW(), NOW()
        )`,
        [scheduler1GrowerId, tenant_id, company_id, batch1Id, growerStageId, breed_id, lob_id, nob_id, todayStr, batch1Qty]
      );

      for (const act of batch1GrowerActivities) {
        await conn.execute(
          `INSERT INTO scheduler_line (
            line_id, scheduler_id, line_seq, line_type, activity_name,
            stage_id, occurrence, start_day, is_mandatory, source,
            item_id, standard_qty, qty_basis, allow_qty_edit, is_active
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'AUTO',
            ?, ?, ?, 1, 1
          )`,
          [
            randomUUID(),
            scheduler1GrowerId,
            act.line_seq,
            act.line_type,
            act.activity_name,
            growerStageId,
            act.occurrence,
            act.start_day,
            act.is_mandatory,
            act.item_id,
            act.standard_qty,
            act.qty_basis,
          ]
        );
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. BATCH 2: ANIMAL-WISE (BATCH-000005) - Exactly 8 Animals
    // ─────────────────────────────────────────────────────────────
    const batch2Id = randomUUID();
    const batch2No = 'BATCH-000005';
    const batch2AnimalCount = 8;

    // Pick exactly 8 unassigned active animals
    const [animalsToAssign]: any = await conn.execute(
      `SELECT animal_id, animal_code FROM animal_register 
       WHERE current_batch_id IS NULL AND is_active = 1 AND status = 'ACTIVE' 
       ORDER BY animal_code ASC 
       LIMIT 8`
    );

    if (animalsToAssign.length < batch2AnimalCount) {
      throw new Error(`Expected at least ${batch2AnimalCount} unassigned animals, found ${animalsToAssign.length}`);
    }

    const assignedAnimalCodes = animalsToAssign.map((a: any) => a.animal_code);
    const assignedAnimalIds = animalsToAssign.map((a: any) => a.animal_id);

    console.log(`\n--- Plan: Batch 2 (ANIMAL_WISE) ---`);
    console.log(`Batch No: ${batch2No}`);
    console.log(`Type: ANIMAL_WISE (REGISTERED)`);
    console.log(`Stage: FLUSH (${flushStageId})`);
    console.log(`Assigned Animals (${batch2AnimalCount}):`, assignedAnimalCodes.join(', '));
    console.log(`Start Date: ${todayStr}`);

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO batch_header (
          batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
          costing_method, breed_id, farm_id, start_date, status,
          opening_quantity, uom, remarks, current_stage_code,
          stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'STANDARD', ?, ?, ?, 'ACTIVE',
          ?, 'HEAD', 'Breeding Sows Cohort Batch 2026-A8 (8 Animals)', 'FLUSH',
          ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
        )`,
        [batch2Id, tenant_id, company_id, batch2No, lob_id, nob_id, breed_id, farm_id, todayStr, batch2AnimalCount, flushStageId, operational_area_id]
      );

      // Assign exactly the 8 animals to Batch 2 and set stage to FLUSH
      for (const animalId of assignedAnimalIds) {
        await conn.execute(
          `UPDATE animal_register SET current_batch_id = ?, current_stage_id = ?, updated_at = NOW() WHERE animal_id = ?`,
          [batch2Id, flushStageId, animalId]
        );
      }
    }

    // Schedulers for Batch 2: FLUSH stage
    const scheduler2FlushId = randomUUID();
    console.log(`Creating Scheduler for Batch 2 FLUSH stage with 9 rich activities...`);

    const batch2FlushActivities = [
      {
        line_seq: 1,
        line_type: 'CONSUMPTION',
        activity_name: 'Individual Morning High-Energy Flushing Feed',
        item_id: drySowMashId,
        standard_qty: 2.8,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 2,
        line_type: 'CONSUMPTION',
        activity_name: 'Individual Afternoon Soya Protein & Energy Supplement',
        item_id: soyaMealId,
        standard_qty: 0.5,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 3,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Individual Estrus Standing Heat & Vulva Inspection',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 4,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Individual Feed Intake & Appetite Observation',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 5,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Individual Body Condition Score (BCS 1-5 Evaluation)',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 6,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Daily Stall Cleanliness, Water Nipple & Dry Straw Check',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 7,
        line_type: 'CONSUMPTION',
        activity_name: 'Sow Reproductive Vitamin & Trace Mineral Daily Premix',
        item_id: vitaminPremixId,
        standard_qty: 0.05,
        qty_basis: 'PER_HEAD',
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 8,
        line_type: 'RESOURCE',
        activity_name: 'Breeding Specialist Pre-Insemination Soundness Assessment',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 9,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Weekly Individual Body Weight & Frame Scoring',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'WEEKLY',
        day_of_week: 4,
        start_day: 1,
      },
    ];

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO scheduler_header (
          scheduler_id, tenant_id, company_id, batch_id, stage_id,
          breed_id, lob_id, nob_id, data_entry_level, scheduler_status,
          effective_from, animal_count, auto_generated, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 'PEN', 'ACTIVE',
          ?, ?, 1, NOW(), NOW()
        )`,
        [scheduler2FlushId, tenant_id, company_id, batch2Id, flushStageId, breed_id, lob_id, nob_id, todayStr, batch2AnimalCount]
      );

      for (const act of batch2FlushActivities) {
        await conn.execute(
          `INSERT INTO scheduler_line (
            line_id, scheduler_id, line_seq, line_type, activity_name,
            stage_id, occurrence, start_day, is_mandatory, source,
            item_id, standard_qty, qty_basis, allow_qty_edit, is_active
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'AUTO',
            ?, ?, ?, 1, 1
          )`,
          [
            randomUUID(),
            scheduler2FlushId,
            act.line_seq,
            act.line_type,
            act.activity_name,
            flushStageId,
            act.occurrence,
            act.start_day,
            act.is_mandatory,
            act.item_id,
            act.standard_qty,
            act.qty_basis,
          ]
        );
      }
    }

    // Schedulers for Batch 2: INSEMINATION stage (pipeline destination)
    const scheduler2InsemId = randomUUID();
    console.log(`Creating Scheduler for Batch 2 INSEMINATION stage with 5 rich activities...`);

    const batch2InsemActivities = [
      {
        line_seq: 1,
        line_type: 'CONSUMPTION',
        activity_name: 'Morning Gestation & Insemination Ration (14% CP)',
        item_id: drySowMashId,
        standard_qty: 2.0,
        qty_basis: 'PER_HEAD',
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 2,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Artificial Insemination (AI) Service 1 Entry & Semen Batch Log',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 3,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Artificial Insemination (AI) Service 2 Confirmation (12h Post-AI)',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 1,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 4,
        line_type: 'DESCRIPTIVE',
        activity_name: 'Post-Insemination Rest, Quietude & Stress Prevention Audit',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
      {
        line_seq: 5,
        line_type: 'RESOURCE',
        activity_name: 'Insemination Technician Procedural Review & Quality Sign-Off',
        item_id: null,
        standard_qty: null,
        qty_basis: null,
        is_mandatory: 0,
        occurrence: 'DAILY',
        start_day: 1,
      },
    ];

    if (apply || verify) {
      await conn.execute(
        `INSERT INTO scheduler_header (
          scheduler_id, tenant_id, company_id, batch_id, stage_id,
          breed_id, lob_id, nob_id, data_entry_level, scheduler_status,
          effective_from, animal_count, auto_generated, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 'PEN', 'ACTIVE',
          ?, ?, 1, NOW(), NOW()
        )`,
        [scheduler2InsemId, tenant_id, company_id, batch2Id, insemStageId, breed_id, lob_id, nob_id, todayStr, batch2AnimalCount]
      );

      for (const act of batch2InsemActivities) {
        await conn.execute(
          `INSERT INTO scheduler_line (
            line_id, scheduler_id, line_seq, line_type, activity_name,
            stage_id, occurrence, start_day, is_mandatory, source,
            item_id, standard_qty, qty_basis, allow_qty_edit, is_active
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, 'AUTO',
            ?, ?, ?, 1, 1
          )`,
          [
            randomUUID(),
            scheduler2InsemId,
            act.line_seq,
            act.line_type,
            act.activity_name,
            insemStageId,
            act.occurrence,
            act.start_day,
            act.is_mandatory,
            act.item_id,
            act.standard_qty,
            act.qty_basis,
          ]
        );
      }
    }

    // Update number series table
    if (apply || verify) {
      await conn.execute(
        `UPDATE no_series SET current_seq = 5, last_no_used = 'BATCH-000005', updated_at = NOW() WHERE code = 'BATCH'`
      );
    }

    if (apply) {
      await conn.commit();
      console.log('\n[seed-piggery-two-batches] SUCCESS: Changes successfully committed to database!');
    } else if (verify) {
      await conn.rollback();
      console.log('\n[seed-piggery-two-batches] VERIFY COMPLETE: Transaction rolled back cleanly.');
    } else {
      await conn.rollback();
      console.log('\n[seed-piggery-two-batches] PLAN PREVIEW COMPLETE: No changes written.');
    }
  } catch (err) {
    await conn.rollback();
    console.error('[seed-piggery-two-batches] ERROR:', err);
    throw err;
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

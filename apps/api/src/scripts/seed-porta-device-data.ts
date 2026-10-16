/** Seeds the operational PORTA data entered on the development device. */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  PORTA_DEVICE_ANIMALS,
  PORTA_DEVICE_BATCHES,
  PORTA_DEVICE_CATEGORIES,
  PORTA_DEVICE_ITEMS,
  PORTA_DEVICE_KPI,
  PORTA_DEVICE_RECEIPTS,
  PORTA_DEVICE_SCHEDULERS,
} from './lib/porta-device-seed-data';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
const VERIFY_ROLLBACK = Symbol('seed-porta-device-data:verify-rollback');

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const db = await mysql.createConnection({ host, port, user, password, database });

  try {
    await db.beginTransaction();
    const [[scope]] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id FROM location_master
       WHERE location_code = 'POR100' AND company_id IS NOT NULL LIMIT 1`,
    );
    if (!scope) throw new Error('PORTA scope is missing — run the PORTA master seed first.');

    const [[actor]] = await db.query<RowDataPacket[]>(
      'SELECT user_id FROM user_master WHERE tenant_id = ? AND company_id = ? ORDER BY created_at LIMIT 1',
      [scope.tenant_id, scope.company_id],
    );
    const actorId = actor?.user_id ?? null;
    const [locations] = await db.query<RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master
       WHERE tenant_id = ? AND location_code IN ('POR100', 'PDS2', 'PFH1', 'LOC-001/STORE-001')`,
      [scope.tenant_id],
    );
    const locationIds = new Map(locations.map((r) => [r.location_code as string, r.location_id as string]));
    for (const code of ['POR100', 'PDS2', 'PFH1', 'LOC-001/STORE-001']) {
      if (!locationIds.has(code)) throw new Error(`Required PORTA location ${code} is missing.`);
    }

    const [breeds] = await db.query<RowDataPacket[]>(
      'SELECT breed_id, breed_code FROM breed_master WHERE tenant_id = ? AND company_id = ? AND is_active = 1',
      [scope.tenant_id, scope.company_id],
    );
    const breedId = breeds.find((r) => r.breed_code === 'TN-70-Sow')?.breed_id as string | undefined;
    if (!breedId) throw new Error('TN-70-Sow is missing — run db-seed-farm-masters first.');

    const [stages] = await db.query<RowDataPacket[]>(
      'SELECT stage_id, stage_code FROM stage_master WHERE tenant_id = ? AND company_id = ? AND is_active = 1',
      [scope.tenant_id, scope.company_id],
    );
    const stageIds = new Map(stages.map((r) => [r.stage_code as string, r.stage_id as string]));
    for (const code of ['PRODUCTIVE_SOW', 'GESTATION', 'WEANING']) {
      if (!stageIds.has(code)) throw new Error(`Required stage ${code} is missing.`);
    }

    const categoryIds = new Map<string, string>();
    for (const category of PORTA_DEVICE_CATEGORIES) {
      const [existing] = await db.query<RowDataPacket[]>(
        `SELECT category_id FROM item_category_master
         WHERE tenant_id = ? AND company_id = ? AND category_code = ? LIMIT 1`,
        [scope.tenant_id, scope.company_id, category.code],
      );
      const id = existing[0]?.category_id as string | undefined ?? randomUUID();
      if (!existing.length && write) {
        await db.query(
          `INSERT INTO item_category_master
             (category_id, tenant_id, company_id, nob_id, lob_id, category_code, category_name, item_type,
              is_active, status, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?, NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, category.code, category.name,
            category.itemType, actorId, actorId],
        );
      }
      categoryIds.set(category.code, id);
    }

    const itemIds = new Map<string, string>();
    for (const item of PORTA_DEVICE_ITEMS) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT item_id FROM item_master WHERE tenant_id = ? AND company_id = ? AND item_code = ? LIMIT 1',
        [scope.tenant_id, scope.company_id, item.code],
      );
      const id = existing[0]?.item_id as string | undefined ?? randomUUID();
      if (!existing.length && write) {
        await db.query(
          `INSERT INTO item_master
             (item_id, tenant_id, company_id, nob_id, lob_id, item_code, item_name, item_type, category_id,
              uom_primary, valuation_method, is_inventoriable, is_active, status, created_by, updated_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, 'ACTIVE', ?, NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, item.code, item.name, item.type,
            item.category ? categoryIds.get(item.category) : null, item.uom, actorId],
        );
      }
      itemIds.set(item.code, id);
    }

    const [existingKpi] = await db.query<RowDataPacket[]>(
      'SELECT kpi_metric_id FROM kpi_metric_master WHERE tenant_id = ? AND company_id = ? AND metric_code = ? LIMIT 1',
      [scope.tenant_id, scope.company_id, PORTA_DEVICE_KPI.code],
    );
    if (!existingKpi.length && write) {
      await db.query(
        `INSERT INTO kpi_metric_master
           (kpi_metric_id, tenant_id, company_id, nob_id, lob_id, metric_code, metric_name, default_uom,
            is_system, is_active, status, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 'ACTIVE', ?, ?, NOW(), NOW())`,
        [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, PORTA_DEVICE_KPI.code,
          PORTA_DEVICE_KPI.name, PORTA_DEVICE_KPI.uom, actorId, actorId],
      );
    }

    const receiptIds = new Map<string, string>();
    const receiptLineIds = new Map<string, string>();
    for (const receipt of PORTA_DEVICE_RECEIPTS) {
      const receiptId = randomUUID();
      const lineId = randomUUID();
      receiptIds.set(receipt.no, receiptId);
      receiptLineIds.set(receipt.no, lineId);
      if (write) {
        await db.query(
          `INSERT INTO goods_receipt
             (receipt_id, tenant_id, company_id, receipt_no, posting_date, warehouse_id, status,
              posted_at, posted_by, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'POSTED', NOW(), ?, ?, ?, NOW(), NOW())`,
          [receiptId, scope.tenant_id, scope.company_id, receipt.no, receipt.date, locationIds.get('LOC-001/STORE-001'), actorId, actorId, actorId],
        );
        await db.query(
          `INSERT INTO goods_receipt_line
             (line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount)
           VALUES (?, ?, 1, ?, ?, 'HEAD', ?, ?)`,
          [lineId, receiptId, itemIds.get(receipt.item), receipt.quantity, receipt.rate, receipt.rate],
        );
        await db.query(
          `INSERT INTO bio_asset_ledger
             (entry_id, document_type, warehouse_id, uom, remaining_quantity, document_line_id, tenant_id,
              company_id, bio_asset_item_id, entry_type, document_no, posting_date, status, quantity,
              cost_amount, cost_amount_each_unit, costing_method, nob_id, lob_id, created_by)
           VALUES (?, 'GOODS_RECEIPT', ?, 'HEAD', 0, ?, ?, ?, ?, 'PURCHASE', ?, ?, 'ACTIVE', ?, ?, ?,
                   'COST_ACCUMULATION', ?, ?, ?)`,
          [randomUUID(), locationIds.get('LOC-001/STORE-001'), lineId, scope.tenant_id, scope.company_id,
            itemIds.get(receipt.item), receipt.no, receipt.date, receipt.quantity, receipt.rate, receipt.rate,
            scope.nob_id, scope.lob_id, actorId],
        );
      }
    }

    const batchIds = new Map<string, string>();
    for (const batch of PORTA_DEVICE_BATCHES) {
      const id = randomUUID();
      batchIds.set(batch.no, id);
      if (write) {
        await db.query(
          `INSERT INTO batch_header
             (batch_id, tenant_id, company_id, batch_no, lob_id, nob_id, costing_method, breed_id, shed_id,
              farm_id, start_date, expected_end_date, status, opening_quantity, uom, animal_tracking,
              tracking_mode, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'HEAD', 'REGISTERED', 'ANIMAL_WISE', ?, ?, NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, batch.no, scope.lob_id, scope.nob_id, batch.costing, breedId,
            locationIds.get(batch.shed), locationIds.get('POR100'), batch.start, batch.expectedEnd, batch.quantity, actorId, actorId],
        );
      }
    }

    const animalIds = new Map<string, string>();
    for (const animal of PORTA_DEVICE_ANIMALS) {
      const id = randomUUID();
      animalIds.set(animal.code, id);
      if (write) {
        await db.query(
          `INSERT INTO animal_register
             (animal_id, tenant_id, company_id, nob_id, lob_id, animal_code, animal_type, breed_id, gender,
              dob, age_at_entry_weeks, entry_type, entry_date, source_receipt_id, item_id, rfid_tag,
              acquisition_cost, total_opening_asset_value, current_stage_id, current_batch_id, current_location_id,
              parity_count, total_piglets_born_live, total_piglets_weaned, current_bio_asset_value,
              total_amortised, book_value, productive_life_start, expected_cull_date, no_of_teats, tsi, grading,
              status, is_active, sire_serial_no, dam_serial_no, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'F', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?,
                   'ACTIVE', 1, NULL, ?, ?, ?, NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, animal.code, animal.type, breedId,
            animal.dob, animal.ageWeeks, animal.entryType, animal.entryDate, receiptIds.get(animal.receipt), itemIds.get(animal.item), animal.code,
            animal.cost, animal.cost, stageIds.get(animal.stage), batchIds.get(animal.batch), locationIds.get(animal.location),
            animal.cost, animal.cost, animal.productiveStart, animal.cullDate, animal.teats, animal.tsi, animal.grading,
            'damSerial' in animal ? animal.damSerial : null, actorId, actorId],
        );
        await db.query(
          `INSERT INTO bio_asset_ledger
             (entry_id, document_type, warehouse_id, uom, source_entry_id, tenant_id, company_id, bio_asset_item_id,
              entry_type, document_no, posting_date, stage, status, quantity, cost_amount, cost_amount_each_unit,
              costing_method, nob_id, lob_id, created_by, animal_id)
           VALUES (?, 'ANIMAL_REGISTRATION', ?, 'HEAD', ?, ?, ?, ?, 'ACQUISITION', ?, ?, ?, 'ACTIVE', 1, ?, ?,
                   'COST_ACCUMULATION', ?, ?, ?, ?)`,
          [randomUUID(), locationIds.get(animal.location), receiptLineIds.get(animal.receipt), scope.tenant_id, scope.company_id,
            itemIds.get(animal.item), animal.code, animal.entryDate, stageIds.get(animal.stage), animal.cost, animal.cost,
            scope.nob_id, scope.lob_id, actorId, id],
        );
      }
    }

    for (const animal of PORTA_DEVICE_ANIMALS) {
      if (!write) continue;
      await db.query(
        `INSERT INTO animal_movement_log
           (movement_id, tenant_id, company_id, animal_id, movement_type, event_date, to_batch_id, to_stage_id,
            to_location_id, created_by, created_at)
         VALUES (?, ?, ?, ?, 'ASSIGN', ?, ?, ?, ?, ?, NOW())`,
        [randomUUID(), scope.tenant_id, scope.company_id, animalIds.get(animal.code), animal.batch === 'BATCH-000001' ? '2026-03-01' : '2024-03-01',
          batchIds.get(animal.batch), stageIds.get(animal.stage), locationIds.get(animal.location), actorId],
      );
    }

    const schedulerIds = new Map<string, string>();
    for (const scheduler of PORTA_DEVICE_SCHEDULERS) {
      const id = randomUUID();
      schedulerIds.set(scheduler.no, id);
      if (write) {
        await db.query(
          `INSERT INTO scheduler_header
             (scheduler_id, scheduler_no, tenant_id, company_id, batch_id, stage_id, breed_id, lob_id, nob_id,
              location_id, data_entry_level, scheduler_status, effective_from, effective_to, animal_count,
              auto_generated, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHED', 'ACTIVE', ?, ?, ?, 1, ?, NOW(), NOW())`,
          [id, scheduler.no, scope.tenant_id, scope.company_id, batchIds.get(scheduler.batch), stageIds.get(scheduler.stage), breedId,
            scope.lob_id, scope.nob_id, locationIds.get(scheduler.shed), scheduler.from, scheduler.to, scheduler.count, actorId],
        );
      }
    }
    if (write) {
      const [lifecycle] = await db.query<RowDataPacket[]>(
        `SELECT lifecycle_id, stage_id FROM breed_lifecycle_stages
         WHERE breed_id = ? AND lifecycle_code = 'WEANING-LIFECYCLE-001' LIMIT 1`, [breedId],
      );
      await db.query(
        `INSERT INTO scheduler_line
           (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, end_day,
            is_mandatory, source, lifecycle_ref_id, nob_id, lob_id, item_id, standard_qty, qty_basis,
            allow_qty_edit, creates_inventory, output_lot_auto, item_description, auto_triggers_stage, is_active)
         VALUES (?, ?, 1, 'CONSUMPTION', 'Weaning Feed — Super Flush', ?, 'DAILY', 1, 28, 1, 'AUTO', ?, ?, ?, ?,
                 2.000000, 'PER_HEAD', 1, 0, 1, 'Super Flush', 0, 1)`,
        [randomUUID(), schedulerIds.get('SCH-000003'), stageIds.get('WEANING'), lifecycle[0]?.lifecycle_id ?? null,
          scope.nob_id, scope.lob_id, itemIds.get('FEED000022')],
      );
    }

    const plan = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      categories: PORTA_DEVICE_CATEGORIES.length,
      items: PORTA_DEVICE_ITEMS.length,
      kpis: 1,
      receipts: PORTA_DEVICE_RECEIPTS.length,
      batches: PORTA_DEVICE_BATCHES.length,
      animals: PORTA_DEVICE_ANIMALS.length,
      animalMovements: PORTA_DEVICE_ANIMALS.length,
      schedulers: PORTA_DEVICE_SCHEDULERS.length,
      schedulerLines: 1,
    };
    console.log(JSON.stringify(plan, null, 2));
    if (verify) throw VERIFY_ROLLBACK;
    if (write) await db.commit();
    console.log(apply ? 'Committed.' : 'Read-only. No changes attempted.');
  } catch (error) {
    await db.rollback();
    if (error === VERIFY_ROLLBACK) console.log('Verified and rolled back. No changes committed.');
    else throw error;
  } finally {
    await db.end();
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

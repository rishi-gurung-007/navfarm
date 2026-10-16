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
    }    const [breeds] = await db.query<RowDataPacket[]>(
      'SELECT breed_id, breed_code FROM breed_master WHERE tenant_id = ? AND company_id = ? AND is_active = 1',
      [scope.tenant_id, scope.company_id],
    );
    const breedIds = new Map(breeds.map((r) => [String(r.breed_code).toUpperCase(), r.breed_id as string]));
    const defaultBreedId = breedIds.get('TN70') ?? breedIds.get('TN-70-SOW') ?? (breeds[0]?.breed_id as string | undefined);
    if (!defaultBreedId) throw new Error('No active breed found — run db-seed-farm-masters first.');

    const [stages] = await db.query<RowDataPacket[]>(
      'SELECT stage_id, stage_code, company_id FROM stage_master WHERE tenant_id = ? AND (company_id = ? OR company_id IS NULL) AND is_active = 1',
      [scope.tenant_id, scope.company_id],
    );
    const stageIds = new Map<string, string>();
    for (const r of stages) {
      if (r.company_id || !stageIds.has(r.stage_code as string)) {
        stageIds.set(r.stage_code as string, r.stage_id as string);
      }
    }
    for (const code of ['QUARANTINE', 'GILT_REARING', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION', 'PRODUCTIVE_SOW', 'FLUSH']) {
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

    // Additional feed items needed if missing
    for (const feedCode of ['DG-001', 'DS-001']) {
      if (!itemIds.has(feedCode)) {
        const [existing] = await db.query<RowDataPacket[]>(
          'SELECT item_id FROM item_master WHERE tenant_id = ? AND company_id = ? AND item_code = ? LIMIT 1',
          [scope.tenant_id, scope.company_id, feedCode],
        );
        if (existing[0]) itemIds.set(feedCode, existing[0].item_id as string);
      }
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
      const bBreedId = ('breed' in batch && batch.breed ? breedIds.get(String(batch.breed).toUpperCase()) : undefined) ?? defaultBreedId;
      if (write) {
        await db.query(
          `INSERT INTO batch_header
             (batch_id, tenant_id, company_id, batch_no, lob_id, nob_id, costing_method, breed_id, shed_id,
              farm_id, start_date, expected_end_date, status, opening_quantity, uom, animal_tracking,
              tracking_mode, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 'HEAD', 'REGISTERED', 'ANIMAL_WISE', ?, ?, NOW(), NOW())`,
          [id, scope.tenant_id, scope.company_id, batch.no, scope.lob_id, scope.nob_id, batch.costing, bBreedId,
            locationIds.get(batch.shed), locationIds.get('POR100'), batch.start, batch.expectedEnd, batch.quantity, actorId, actorId],
        );
        if (batch.costing === 'BIO_ASSET') {
          await db.query(
            `INSERT INTO batch_bio_asset_state
               (state_id, batch_id, stage, current_quantity, nca_book_value, residual_value_per_unit, updated_at)
             VALUES (?, ?, 'PREMATURE', ?, 0.0000, 50.000000, NOW())
             ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity)`,
            [randomUUID(), id, batch.quantity],
          );
        }
      }
    }

    const animalIds = new Map<string, string>();
    for (const animal of PORTA_DEVICE_ANIMALS) {
      const id = randomUUID();
      animalIds.set(animal.code, id);
      const aBreedId = ('breed' in animal && animal.breed ? breedIds.get(String(animal.breed).toUpperCase()) : undefined) ?? defaultBreedId;
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
          [id, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, animal.code, animal.type, aBreedId,
            animal.dob, animal.ageWeeks, animal.entryType, animal.entryDate, receiptIds.get(animal.receipt), itemIds.get(animal.item), animal.code,
            animal.cost, animal.cost, stageIds.get(animal.stage), batchIds.get(animal.batch), locationIds.get(animal.location),
            animal.cost, animal.cost, animal.productiveStart, animal.cullDate, animal.teats, animal.tsi, animal.grading,
            'damSerial' in animal ? animal.damSerial : null, actorId, actorId],
        );
        await db.query(
          `INSERT INTO bio_asset_ledger
             (entry_id, document_type, warehouse_id, uom, source_entry_id, tenant_id, company_id, bio_asset_item_id,
              entry_type, document_no, posting_date, stage, status, quantity, cost_amount, cost_amount_each_unit,
              costing_method, nob_id, lob_id, created_by, animal_id, batch_id)
           VALUES (?, 'ANIMAL_REGISTRATION', ?, 'HEAD', ?, ?, ?, ?, 'ACQUISITION', ?, ?, ?, 'ACTIVE', 1, ?, ?,
                   'COST_ACCUMULATION', ?, ?, ?, ?, ?)`,
          [randomUUID(), locationIds.get(animal.location), receiptLineIds.get(animal.receipt), scope.tenant_id, scope.company_id,
            itemIds.get(animal.item), animal.code, animal.entryDate, stageIds.get(animal.stage), animal.cost, animal.cost,
            scope.nob_id, scope.lob_id, actorId, id, batchIds.get(animal.batch)],
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
    const schedulerLineIds = new Map<string, string>();
    for (const scheduler of PORTA_DEVICE_SCHEDULERS) {
      const id = randomUUID();
      schedulerIds.set(scheduler.no, id);
      const sBreedId = ('breed' in scheduler && scheduler.breed ? breedIds.get(String(scheduler.breed).toUpperCase()) : undefined) ?? defaultBreedId;
      if (write) {
        await db.query(
          `INSERT INTO scheduler_header
             (scheduler_id, scheduler_no, tenant_id, company_id, batch_id, stage_id, breed_id, lob_id, nob_id,
              location_id, data_entry_level, scheduler_status, effective_from, effective_to, animal_count,
              auto_generated, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHED', 'ACTIVE', ?, ?, ?, 1, ?, NOW(), NOW())`,
          [id, scheduler.no, scope.tenant_id, scope.company_id, batchIds.get(scheduler.batch), stageIds.get(scheduler.stage), sBreedId,
            scope.lob_id, scope.nob_id, locationIds.get(scheduler.shed), scheduler.from, scheduler.to, scheduler.count, actorId],
        );
        const lineId = randomUUID();
        schedulerLineIds.set(scheduler.no, lineId);
        const feedCode = scheduler.stage === 'GESTATION' ? 'DG-001'
          : scheduler.stage === 'PRODUCTIVE_SOW' ? 'DS-001'
          : scheduler.stage === 'GILT_REARING' ? 'DGDW-001'
          : scheduler.stage === 'LACTATION' ? 'FEED-SF'
          : 'FEED-SF';
        const feedItemId = itemIds.get(feedCode) ?? itemIds.get('FEED-SF');
        await db.query(
          `INSERT INTO scheduler_line
             (line_id, scheduler_id, line_seq, line_type, activity_name, stage_id, occurrence, start_day, end_day,
              is_mandatory, source, nob_id, lob_id, item_id, standard_qty, qty_basis,
              allow_qty_edit, creates_inventory, output_lot_auto, item_description, auto_triggers_stage, is_active)
           VALUES (?, ?, 1, 'CONSUMPTION', ?, ?, 'DAILY', 1, 30, 1, 'AUTO', ?, ?, ?,
                   2.500000, 'PER_HEAD', 1, 0, 1, ?, 0, 1)`,
          [lineId, id, `${scheduler.stage} Feed Consumption`, stageIds.get(scheduler.stage),
            scope.nob_id, scope.lob_id, feedItemId, `${feedCode} Daily Feed`],
        );
      }
    }

    // 1 Month (30 days) Data Entry hitting Inventory Ledger and Bio Asset Ledger
    const storeLocationId = locationIds.get('LOC-001/STORE-001')!;
    const openingStockLedgerIds = new Map<string, string>();
    let dailyEntriesPosted = 0;

    if (write) {
      // 1. Establish positive opening stock for consumable feed items in inventory_ledger
      for (const feedCode of ['DG-001', 'DS-001', 'DGDW-001', 'FEED-SF']) {
        const fItemId = itemIds.get(feedCode);
        if (!fItemId) continue;
        const opLedgerId = randomUUID();
        openingStockLedgerIds.set(feedCode, opLedgerId);
        await db.query(
          `INSERT INTO inventory_ledger
             (ledger_id, tenant_id, company_id, item_id, item_code, item_description,
              document_type, document_no, posting_date, entry_type, transaction_type,
              quantity, remaining_quantity, uom, rate, amount, warehouse_id, nob_id, lob_id, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-OPENING-FEED', '2026-09-01', 'POSITIVE', 'PURCHASE',
                   50000.0000, 50000.0000, 'KG', 0.500000, 25000.0000, ?, ?, ?, ?, NOW())`,
          [opLedgerId, scope.tenant_id, scope.company_id, fItemId, feedCode, `${feedCode} Opening Stock`,
           storeLocationId, scope.nob_id, scope.lob_id, actorId],
        );
        await db.query(
          `INSERT INTO inventory_ledger_line
             (line_id, tenant_id, company_id, ledger_id, line_no, item_id, warehouse_id, quantity, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, 50000.0000, NOW())`,
          [randomUUID(), scope.tenant_id, scope.company_id, opLedgerId, fItemId, storeLocationId],
        );
      }

      // 2. Generate 30 consecutive calendar days of daily entries
      const dates: string[] = [];
      const now = new Date();
      for (let offset = 30; offset >= 1; offset--) {
        const d = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
        dates.push(d.toISOString().slice(0, 10));
      }

      const activeDailyPlan = [
        { animalCode: 'DLNA8228', schedulerNo: 'SCH-000001', feedCode: 'DS-001', qty: 2.5, rate: 0.50, batchNo: 'BATCH-000001', stageCode: 'PRODUCTIVE_SOW' },
        { animalCode: 'P26302', schedulerNo: 'SCH-000002', feedCode: 'DG-001', qty: 2.5, rate: 0.50, batchNo: 'BATCH-000001', stageCode: 'GESTATION' },
        { animalCode: 'P25003', schedulerNo: 'SCH-000004', feedCode: 'DGDW-001', qty: 2.2, rate: 0.50, batchNo: 'BATCH-000001', stageCode: 'GILT_REARING' },
        { animalCode: 'P2975', schedulerNo: 'SCH-000003', feedCode: 'FEED-SF', qty: 6.5, rate: 0.50, batchNo: 'BATCH-000002', stageCode: 'LACTATION' },
      ];

      for (const date of dates) {
        for (const planItem of activeDailyPlan) {
          const aId = animalIds.get(planItem.animalCode);
          const bId = batchIds.get(planItem.batchNo);
          const sLineId = schedulerLineIds.get(planItem.schedulerNo);
          const stgId = stageIds.get(planItem.stageCode);
          const fItemId = itemIds.get(planItem.feedCode);
          const opLedgerId = openingStockLedgerIds.get(planItem.feedCode);
          if (!aId || !bId || !sLineId || !fItemId || !opLedgerId) continue;

          const dailyQty = planItem.qty;
          const costAmount = dailyQty * planItem.rate;
          const dailyLedgerId = randomUUID();
          const txId = randomUUID();
          const dailyEntryId = randomUUID();

          // 1. Inventory Ledger (Negative consumption)
          await db.query(
            `INSERT INTO inventory_ledger
               (ledger_id, tenant_id, company_id, item_id, item_code, item_description,
                document_type, document_no, posting_date, entry_type, transaction_type,
                quantity, remaining_quantity, uom, rate, amount, warehouse_id, nob_id, lob_id, batch_no, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'BATCH', ?, ?, 'NEGATIVE', 'CONSUMPTION',
                     ?, 0.0000, 'KG', ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [dailyLedgerId, scope.tenant_id, scope.company_id, fItemId, planItem.feedCode, `${planItem.feedCode} Daily Consumption`,
             planItem.batchNo, date, -dailyQty, planItem.rate, -costAmount,
             storeLocationId, scope.nob_id, scope.lob_id, planItem.batchNo, actorId],
          );

          // 2. Inventory Ledger Line
          await db.query(
            `INSERT INTO inventory_ledger_line
               (line_id, tenant_id, company_id, ledger_id, line_no, item_id, warehouse_id, quantity, created_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, NOW())`,
            [randomUUID(), scope.tenant_id, scope.company_id, dailyLedgerId, fItemId, storeLocationId, -dailyQty],
          );

          // 3. Inventory Application (FIFO application matching positive stock)
          await db.query(
            `INSERT INTO inventory_application
               (application_id, tenant_id, company_id, item_id, inbound_ledger_id, outbound_ledger_id,
                applied_qty, applied_cost_amount, application_date, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [randomUUID(), scope.tenant_id, scope.company_id, fItemId, opLedgerId, dailyLedgerId,
             dailyQty, costAmount, date, actorId],
          );

          // 4. Update remaining stock
          await db.query(
            `UPDATE inventory_ledger SET remaining_quantity = remaining_quantity - ? WHERE ledger_id = ?`,
            [dailyQty, opLedgerId],
          );

          // 5. Bio Asset Ledger (Cost accumulation)
          await db.query(
            `INSERT INTO bio_asset_ledger
               (entry_id, tenant_id, company_id, bio_asset_item_id, entry_type, document_type, document_no,
                batch_id, animal_id, stage, posting_date, status, quantity, cost_amount,
                cost_amount_each_unit, costing_method, uom, warehouse_id, nob_id, lob_id, created_by)
             VALUES (?, ?, ?, ?, 'CONSUMPTION', 'BATCH_CONSUMPTION', ?,
                     ?, ?, ?, ?, 'ACTIVE', ?, ?,
                     ?, 'COST_ACCUMULATION', 'KG', ?, ?, ?, ?)`,
            [randomUUID(), scope.tenant_id, scope.company_id, fItemId, planItem.batchNo,
             bId, aId, stgId, date, dailyQty, costAmount,
             planItem.rate, storeLocationId, scope.nob_id, scope.lob_id, actorId],
          );

          // 6. Update Batch Bio Asset State book value
          await db.query(
            `UPDATE batch_bio_asset_state SET nca_book_value = nca_book_value + ?, updated_at = NOW() WHERE batch_id = ?`,
            [costAmount, bId],
          );

          // 7. Batch Transaction
          await db.query(
            `INSERT INTO batch_transaction
               (transaction_id, batch_id, transaction_date, transaction_type, item_id,
                quantity, uom, rate, amount, ledger_id, animal_id, created_by, created_at)
             VALUES (?, ?, ?, 'CONSUMPTION', ?, ?, 'KG', ?, ?, ?, ?, ?, NOW())`,
            [txId, bId, date, fItemId, dailyQty, planItem.rate, costAmount, dailyLedgerId, aId, actorId],
          );

          // 8. Batch Daily Data
          await db.query(
            `INSERT INTO batch_daily_data
               (entry_id, tenant_id, company_id, line_id, batch_id, animal_id, entry_date,
                entered_value, item_id, posted, posting_reference, remarks, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'Scheduled daily feed entry', ?, ?, NOW(), NOW())`,
            [dailyEntryId, scope.tenant_id, scope.company_id, sLineId, bId, aId, date,
             dailyQty, fItemId, dailyLedgerId, actorId, actorId],
          );

          dailyEntriesPosted++;
        }
      }
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
      schedulerLines: PORTA_DEVICE_SCHEDULERS.length,
      dailyEntries: dailyEntriesPosted,
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

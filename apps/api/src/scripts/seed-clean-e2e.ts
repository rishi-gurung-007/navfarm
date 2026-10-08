/**
 * Clean & Deterministic E2E Seed Script for Triple C Piggery.
 *
 * Drops/truncates all operational & transactional tables, resets number series
 * counters, and ensures a clean, predictable, understandable dataset for testing:
 *   1. Master Data: Farm (MUL100), Shed (MUL100/SHED-001), Silo, Store, Breed (TN-70-Sow), Stage (GROWER).
 *   2. Tracking Number Series: LOT-AUDIT (LOT series) & SER-AUDIT (SERIAL series).
 *   3. The 4 Distinct Test Items:
 *      - Standard Untracked Feed (FIFO) -> Weaner Grower Mash (18% CP)
 *      - Lot-Tracked Vaccine (LOT)     -> Parvo-Shield Swine Vaccine (Lot Tracked)
 *      - Serial-Tracked Asset (SERIAL) -> RFID Swine Ear Tag (Serial Tracked)
 *      - Biological Asset (BIO_ASSET)  -> Suckling Live Piglet (0-4 Wks)
 *   4. Clean Operational Slate:
 *      Zero batches, zero transactions, zero inventory ledger rows, ready for Step 1 -> Step 5 testing.
 *
 * Usage:
 *   pnpm db:seed-clean
 *   pnpm nx run api:db-seed-clean
 */

import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();
const tenantDatabase = process.env.DEV_TENANT_DATABASE || `tenant_${tenantCode}`;

// Operational tables to truncate
const OPERATIONAL_TABLES = [
  'inventory_application',
  'inventory_ledger',
  'bio_asset_ledger',
  'resource_ledger',
  'goods_receipt_line',
  'goods_receipt',
  'stock_transfer_line',
  'stock_transfer',
  'stock_adjustment_line',
  'stock_adjustment',
  'journal_line',
  'journal_header',
  'batch_daily_data',
  'batch_transaction',
  'batch_stage_log',
  'batch_input_line',
  'batch_output_line',
  'batch_cost_variance',
  'batch_transfer_line',
  'batch_transfer',
  'batch_bio_asset_state',
  'batch_mortality_detail',
  'batch_treatment_detail',
  'batch_standard_consumption_line',
  'batch_standard',
  'batch_attachment',
  'batch_data_entry_lock',
  'scheduler_line_custom_days',
  'scheduler_line',
  'scheduler_header',
  'batch_header',
  'animal_movement_log',
  'animal_medication_log',
  'animal_event_log',
  'farrowing_record',
  'semen_batch',
  'breeding_record',
  'farm_record_animal',
  'farm_record',
  'animal_register',
];

export async function seedCleanE2E() {
  console.log('================================================================');
  console.log('🧹 TRIPLE C — CLEAN DATABASE RESET & PRECISE E2E SEED');
  console.log('================================================================');
  console.log(`Database:     ${tenantDatabase}`);
  console.log(`Host:         ${host}:${port}`);
  console.log('----------------------------------------------------------------');

  const conn = await mysql.createConnection({ host, port, user, password, database: tenantDatabase, ssl });

  try {
    // 1. Wipe Operational Tables
    console.log('1️⃣  Wiping all transactional and operational data...');
    const [existingTableRows] = await conn.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const dbTables = new Set(existingTableRows.map((r) => Object.values(r)[0] as string));

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    let truncatedCount = 0;
    for (const table of OPERATIONAL_TABLES) {
      if (!dbTables.has(table)) continue;
      try {
        await conn.query(`TRUNCATE TABLE \`${table}\``);
        truncatedCount++;
      } catch (err: any) {
        await conn.query(`DELETE FROM \`${table}\``);
        truncatedCount++;
      }
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`   ✔ Truncated ${truncatedCount} operational tables cleanly.`);

    // 2. Fetch Active Scope (Tenant, Company, NOB, LOB)
    const [companies] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT company_id, tenant_id FROM company_master LIMIT 1`,
    );
    if (!companies.length) {
      throw new Error('No company found in database. Run pnpm nx run api:db-fresh-setup first.');
    }
    const companyId = companies[0].company_id;
    const tenantId = companies[0].tenant_id;

    const [areas] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT nob_id, lob_id FROM operational_area_master WHERE is_active = 1 LIMIT 1`,
    );
    const nobId = areas.length ? areas[0].nob_id : null;
    const lobId = areas.length ? areas[0].lob_id : null;

    // 3. Reset Number Series Sequences for Predictable Testing
    console.log('\n2️⃣  Resetting Number Series counters to starting numbers...');
    await conn.query(
      `UPDATE no_series 
       SET current_seq = 0, last_no_used = NULL 
       WHERE code IN ('BATCH', 'ANIMAL', 'LOT-AUDIT', 'SER-AUDIT')`,
    );
    console.log('   ✔ Series BATCH, ANIMAL, LOT-AUDIT, SER-AUDIT reset to start.');

    // 4. Ensure Tracking Number Series (LOT and SERIAL)
    console.log('\n3️⃣  Verifying Lot & Serial Tracking Number Series...');
    let lotSeriesId: string;
    let serialSeriesId: string;

    const [lotRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM no_series WHERE document_type = 'LOT' AND tenant_id = ? LIMIT 1`,
      [tenantId],
    );
    if (lotRows.length) {
      lotSeriesId = lotRows[0].id;
    } else {
      lotSeriesId = randomUUID();
      await conn.query(
        `INSERT INTO no_series (id, tenant_id, company_id, code, description, document_type, prefix, seq_length, increment_by, is_default, manual_nos, current_seq)
         VALUES (?, ?, ?, 'LOT-AUDIT', 'Audit Lot Series', 'LOT', 'LOT', 5, 1, 1, 1, 0)`,
        [lotSeriesId, tenantId, companyId],
      );
    }

    const [serRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id FROM no_series WHERE document_type = 'SERIAL' AND tenant_id = ? LIMIT 1`,
      [tenantId],
    );
    if (serRows.length) {
      serialSeriesId = serRows[0].id;
    } else {
      serialSeriesId = randomUUID();
      await conn.query(
        `INSERT INTO no_series (id, tenant_id, company_id, code, description, document_type, prefix, seq_length, increment_by, is_default, manual_nos, current_seq)
         VALUES (?, ?, ?, 'SER-AUDIT', 'Audit Serial Series', 'SERIAL', 'SER', 5, 1, 1, 1, 0)`,
        [serialSeriesId, tenantId, companyId],
      );
    }
    console.log(`   ✔ LOT Series:    LOT-AUDIT (${lotSeriesId})`);
    console.log(`   ✔ SERIAL Series: SER-AUDIT (${serialSeriesId})`);

    // 5. Ensure The 4 Distinct Test Items
    console.log('\n4️⃣  Seeding 4 Distinct Test Items (Standard, Lot, Serial, Bio Asset)...');

    const testItems = [
      {
        code: 'ICAT-004-ITM-0004',
        name: 'Weaner Grower Mash (18% CP)',
        type: 'FEED',
        uom: 'KG',
        val: 'FIFO',
        cost: '35.0000',
        isBio: 0,
        isLot: 0,
        isSerial: 0,
        seriesId: null,
      },
      {
        code: 'ITM-LOT-VACCINE',
        name: 'Parvo-Shield Swine Vaccine',
        type: 'VACCINE',
        uom: 'DOSE',
        val: 'FIFO',
        cost: '85.0000',
        isBio: 0,
        isLot: 1,
        isSerial: 0,
        seriesId: lotSeriesId,
      },
      {
        code: 'ITM-SER-TAG',
        name: 'RFID Swine Ear Tag',
        type: 'RAW_MATERIAL',
        uom: 'PCS',
        val: 'FIFO',
        cost: '2.5000',
        isBio: 0,
        isLot: 0,
        isSerial: 1,
        seriesId: serialSeriesId,
      },
      {
        code: 'ICAT-008-ITM-0001',
        name: 'Suckling Live Piglet (0-4 Wks)',
        type: 'LIVESTOCK',
        uom: 'HEAD',
        val: 'BIO_ASSET',
        cost: '180.0000',
        isBio: 1,
        isLot: 0,
        isSerial: 0,
        seriesId: null,
      },
    ];

    for (const item of testItems) {
      const [existing] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT item_id FROM item_master WHERE (item_code = ? OR item_name = ?) AND tenant_id = ? LIMIT 1`,
        [item.code, item.name, tenantId],
      );

      if (existing.length) {
        await conn.query(
          `UPDATE item_master 
           SET item_name = ?, item_type = ?, uom_primary = ?, valuation_method = ?, 
               standard_cost = ?, is_biological_asset = ?, is_lot_tracked = ?, is_serial_tracked = ?, 
               tracking_series_id = ?, is_active = 1, is_inventoriable = 1, deleted_at = NULL
           WHERE item_id = ?`,
          [
            item.name,
            item.type,
            item.uom,
            item.val,
            item.cost,
            item.isBio,
            item.isLot,
            item.isSerial,
            item.seriesId,
            existing[0].item_id,
          ],
        );
        console.log(`   ✔ Updated item: ${item.code} — ${item.name}`);
      } else {
        const itemId = randomUUID();
        await conn.query(
          `INSERT INTO item_master 
             (item_id, tenant_id, company_id, nob_id, lob_id, item_code, item_name, item_type, uom_primary, 
              valuation_method, standard_cost, is_biological_asset, is_lot_tracked, is_serial_tracked, 
              tracking_series_id, is_active, is_inventoriable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [
            itemId,
            tenantId,
            companyId,
            nobId,
            lobId,
            item.code,
            item.name,
            item.type,
            item.uom,
            item.val,
            item.cost,
            item.isBio,
            item.isLot,
            item.isSerial,
            item.seriesId,
          ],
        );
        console.log(`   ✔ Created item: ${item.code} — ${item.name}`);
      }
    }

    // 6. Link Sheds to their Child Feed Silos & Verify Key Locations
    console.log('\n5️⃣  Linking Sheds to Silos & Verifying Locations...');
    await conn.query(`
      UPDATE location_master shed
      JOIN location_master silo ON silo.parent_location_id = shed.location_id AND silo.location_type = 'SILO'
      SET shed.feed_silo_id = silo.location_id
      WHERE shed.location_type = 'SHED';
    `);
    const [locations] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, location_name, location_type 
       FROM location_master 
       WHERE location_code IN ('MUL100', 'MUL100/SHED-001', 'MUL100/SHED-001/SILO-001', 'MUL100/STORE-001')
       ORDER BY location_level ASC`,
    );

    for (const loc of locations) {
      console.log(`   ✔ [${loc.location_type}] ${loc.location_code} — ${loc.location_name}`);
    }

    // 6. Seed Complete Breeding Stock (Sows, Gilts, Boars) into animal_register
    console.log('\n6️⃣  Seeding Registered Breeding Animals (SOW, GILT, BOAR)...');

    const [breedRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT breed_id, breed_code FROM breed_master WHERE is_active = 1`,
    );
    const tn70Breed = breedRows.find((b) => b.breed_code.includes('TN-70')) || breedRows[0];
    const zLineBreed = breedRows.find((b) => b.breed_code.includes('Z-Line')) || breedRows[0];

    const [bioItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT item_id, item_code, item_name FROM item_master WHERE company_id = ? AND is_biological_asset = 1`,
      [companyId],
    );
    const sowItem = bioItems.find((i) => i.item_name.includes('Sow') || i.item_code.includes('0002')) || bioItems[0];
    const giltItem = bioItems.find((i) => i.item_name.includes('Gilt') || i.item_code.includes('0001')) || bioItems[0];
    const boarItem = bioItems.find((i) => i.item_name.includes('Boar') || i.item_code.includes('0003')) || bioItems[0];

    const [stageRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT stage_id, stage_code FROM stage_master WHERE lob_id = ? AND is_active = 1`,
      [lobId],
    );
    const stageMap = new Map(stageRows.map((s) => [s.stage_code, s.stage_id]));

    const [penRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master WHERE location_code LIKE 'MUL100/%' AND location_type = 'PEN' AND is_active = 1`,
    );
    const penMap = new Map(penRows.map((p) => [p.location_code, p.location_id]));
    const defaultPenId = penRows[0]?.location_id || null;

    const animalsToSeed = [
      // SOWS (Mature Parity Breeding Sows)
      {
        code: 'PIG-2026-0001',
        type: 'SOW',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2024-03-10',
        ageWeeks: 96,
        itemId: sowItem.item_id,
        earTag: 'SOW-TN-001',
        rfidTag: '982000412880001',
        cost: 450.00,
        stageId: stageMap.get('DRY_SOW') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-002/PEN-005') || defaultPenId,
        parity: 3,
        bornLive: 38,
        weaned: 36,
        teats: 16,
        tsi: 124.50,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0002',
        type: 'SOW',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2024-05-18',
        ageWeeks: 86,
        itemId: sowItem.item_id,
        earTag: 'SOW-TN-002',
        rfidTag: '982000412880002',
        cost: 450.00,
        stageId: stageMap.get('GESTATION') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-002/PEN-007') || defaultPenId,
        parity: 2,
        bornLive: 26,
        weaned: 25,
        teats: 16,
        tsi: 122.00,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0003',
        type: 'SOW',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2023-11-05',
        ageWeeks: 112,
        itemId: sowItem.item_id,
        earTag: 'SOW-TN-003',
        rfidTag: '982000412880003',
        cost: 450.00,
        stageId: stageMap.get('FARROWING') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-009/PEN-001') || defaultPenId,
        parity: 4,
        bornLive: 52,
        weaned: 49,
        teats: 16,
        tsi: 120.50,
        grading: 'GP',
      },
      {
        code: 'PIG-2026-0004',
        type: 'SOW',
        breedId: zLineBreed.breed_id,
        gender: 'F',
        dob: '2024-08-20',
        ageWeeks: 73,
        itemId: sowItem.item_id,
        earTag: 'SOW-ZL-004',
        rfidTag: '982000412880004',
        cost: 480.00,
        stageId: stageMap.get('LACTATION') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-003/PEN-004') || defaultPenId,
        parity: 1,
        bornLive: 14,
        weaned: 13,
        teats: 16,
        tsi: 126.00,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0005',
        type: 'SOW',
        breedId: zLineBreed.breed_id,
        gender: 'F',
        dob: '2024-06-15',
        ageWeeks: 82,
        itemId: sowItem.item_id,
        earTag: 'SOW-ZL-005',
        rfidTag: '982000412880005',
        cost: 480.00,
        stageId: stageMap.get('INSEMINATION') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-002/PEN-008') || defaultPenId,
        parity: 2,
        bornLive: 25,
        weaned: 24,
        teats: 16,
        tsi: 123.80,
        grading: 'GP',
      },
      {
        code: 'PIG-2026-0006',
        type: 'SOW',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2024-04-01',
        ageWeeks: 93,
        itemId: sowItem.item_id,
        earTag: 'SOW-TN-006',
        rfidTag: '982000412880006',
        cost: 450.00,
        stageId: stageMap.get('FLUSH') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-002/PEN-005') || defaultPenId,
        parity: 3,
        bornLive: 39,
        weaned: 37,
        teats: 16,
        tsi: 121.00,
        grading: 'PS',
      },

      // GILTS (Replacement Maiden Breeding Stock)
      {
        code: 'PIG-2026-0007',
        type: 'GILT',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2025-06-10',
        ageWeeks: 31,
        itemId: giltItem.item_id,
        earTag: 'GLT-TN-007',
        rfidTag: '982000412880007',
        cost: 320.00,
        stageId: stageMap.get('GILT_GROWER') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-001/PEN-001') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 125.00,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0008',
        type: 'GILT',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2025-06-25',
        ageWeeks: 29,
        itemId: giltItem.item_id,
        earTag: 'GLT-TN-008',
        rfidTag: '982000412880008',
        cost: 320.00,
        stageId: stageMap.get('GILT_GROWER') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-001/PEN-003') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 123.50,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0009',
        type: 'GILT',
        breedId: tn70Breed.breed_id,
        gender: 'F',
        dob: '2025-07-15',
        ageWeeks: 26,
        itemId: giltItem.item_id,
        earTag: 'GLT-TN-009',
        rfidTag: '982000412880009',
        cost: 320.00,
        stageId: stageMap.get('QUARANTINE') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-005/PEN-002') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 121.00,
        grading: 'GP',
      },
      {
        code: 'PIG-2026-0010',
        type: 'GILT',
        breedId: zLineBreed.breed_id,
        gender: 'F',
        dob: '2025-07-02',
        ageWeeks: 28,
        itemId: giltItem.item_id,
        earTag: 'GLT-ZL-010',
        rfidTag: '982000412880010',
        cost: 340.00,
        stageId: stageMap.get('GILT_GROWER') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-005/PEN-006') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 127.20,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0011',
        type: 'GILT',
        breedId: zLineBreed.breed_id,
        gender: 'F',
        dob: '2025-07-20',
        ageWeeks: 25,
        itemId: giltItem.item_id,
        earTag: 'GLT-ZL-011',
        rfidTag: '982000412880011',
        cost: 340.00,
        stageId: stageMap.get('GILT_GROWER') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-011/PEN-001') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 124.00,
        grading: 'GP',
      },
      {
        code: 'PIG-2026-0012',
        type: 'GILT',
        breedId: zLineBreed.breed_id,
        gender: 'F',
        dob: '2025-08-05',
        ageWeeks: 23,
        itemId: giltItem.item_id,
        earTag: 'GLT-ZL-012',
        rfidTag: '982000412880012',
        cost: 340.00,
        stageId: stageMap.get('QUARANTINE') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-005/PEN-002') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: 16,
        tsi: 122.00,
        grading: 'PS',
      },

      // BOARS (Sire Stud Boars)
      {
        code: 'PIG-2026-0013',
        type: 'BOAR',
        breedId: zLineBreed.breed_id,
        gender: 'M',
        dob: '2024-02-15',
        ageWeeks: 100,
        itemId: boarItem.item_id,
        earTag: 'BOAR-AI-013',
        rfidTag: '982000412880013',
        cost: 650.00,
        stageId: stageMap.get('BOAR_AI') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-006/PEN-001') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: null,
        tsi: 132.00,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0014',
        type: 'BOAR',
        breedId: zLineBreed.breed_id,
        gender: 'M',
        dob: '2024-04-10',
        ageWeeks: 92,
        itemId: boarItem.item_id,
        earTag: 'BOAR-AI-014',
        rfidTag: '982000412880014',
        cost: 650.00,
        stageId: stageMap.get('BOAR_AI') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-006/PEN-001') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: null,
        tsi: 130.50,
        grading: 'GGP',
      },
      {
        code: 'PIG-2026-0015',
        type: 'BOAR',
        breedId: tn70Breed.breed_id,
        gender: 'M',
        dob: '2024-05-01',
        ageWeeks: 89,
        itemId: boarItem.item_id,
        earTag: 'BOAR-TN-015',
        rfidTag: '982000412880015',
        cost: 620.00,
        stageId: stageMap.get('BOAR_AI') || stageRows[0]?.stage_id,
        penId: penMap.get('MUL100/SHED-006/PEN-001') || defaultPenId,
        parity: 0,
        bornLive: 0,
        weaned: 0,
        teats: null,
        tsi: 128.00,
        grading: 'GP',
      },
    ];

    for (const a of animalsToSeed) {
      const animalId = randomUUID();
      await conn.query(
        `INSERT INTO animal_register (
          animal_id, tenant_id, company_id, nob_id, lob_id, operational_area_id,
          animal_code, animal_type, breed_id, gender, dob, age_at_entry_weeks,
          entry_type, entry_date, item_id, rfid_tag, acquisition_cost,
          total_opening_asset_value, current_bio_asset_value, book_value, total_amortised,
          parity_count, total_piglets_born_live, total_piglets_weaned,
          current_stage_id, current_location_id, no_of_teats, tsi, grading,
          status, is_active
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          'PURCHASED_LOCAL', '2026-01-10', ?, ?, ?,
          ?, ?, ?, 0.0000,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          'ACTIVE', 1
        )`,
        [
          animalId, tenantId, companyId, nobId, lobId, areas[0]?.area_id || null,
          a.code, a.type, a.breedId, a.gender, a.dob, a.ageWeeks,
          a.itemId, a.rfidTag, a.cost,
          a.cost, a.cost, a.cost,
          a.parity, a.bornLive, a.weaned,
          a.stageId, a.penId, a.teats, a.tsi, a.grading,
        ],
      );
      console.log(`   ✔ Seeded ${a.type.padEnd(5)} ${a.code} [${a.earTag}] — Stage: ${a.stageId ? 'Assigned' : 'Default'} | Cost: $${a.cost}`);
    }

    // Update ANIMAL series so next sequence continues cleanly from 16
    await conn.query(
      `UPDATE no_series 
       SET current_seq = 15, last_no_used = 'PIG-2026-0015' 
       WHERE code = 'ANIMAL' AND company_id = ?`,
      [companyId],
    );
    console.log('   ✔ ANIMAL series counter set to 15 (last: PIG-2026-0015)');

    // 7. Seed & Post Goods Receipts (GRN) for Feed, Vaccine, and Ear Tags
    console.log('\n7️⃣  Seeding & Posting Initial Goods Receipts (GRN)...');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const postingDate = '2026-09-28';

    const [suppliers] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT supplier_id FROM supplier_master WHERE company_id = ? LIMIT 1`,
      [companyId]
    );
    const supplierId = suppliers[0]?.supplier_id || null;

    const [silos] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id FROM location_master WHERE location_code = 'MUL100/SHED-001/SILO-001' AND company_id = ?`,
      [companyId]
    );
    const [stores] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id FROM location_master WHERE location_code = 'MUL100/STORE-001' AND company_id = ?`,
      [companyId]
    );
    const siloLocId = silos[0]?.location_id;
    const storeLocId = stores[0]?.location_id;

    const [feedItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ICAT-004-ITM-0004' AND company_id = ?`,
      [companyId]
    );
    const [vacItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ITM-LOT-VACCINE' AND company_id = ?`,
      [companyId]
    );
    const [tagItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM item_master WHERE item_code = 'ITM-SER-TAG' AND company_id = ?`,
      [companyId]
    );
    const feedItem = feedItems[0];
    const vacItem = vacItems[0];
    const tagItem = tagItems[0];

    // GR-000001: Feed into Silo
    const gr1Id = randomUUID();
    const gr1LineId = randomUUID();
    const gr1LedgerId = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-000001', ?, ?, ?, 'INV-2026-FEED-01', 'Initial Feed Silo Stock', 'POSTED', ?, ?, ?)`,
      [gr1Id, tenantId, companyId, postingDate, siloLocId, supplierId, now, now, now]
    );
    await conn.query(
      `INSERT INTO goods_receipt_line (
        line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, remarks
      ) VALUES (?, ?, 1, ?, '5000.0000', 'KG', '35.000000', '175000.0000', 'Weaner Grower Mash stock')`,
      [gr1LineId, gr1Id, feedItem.item_id]
    );
    await conn.query(
      `INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, document_line_id, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-000001', ?, ?, 'INV-2026-FEED-01',
        'POSITIVE', 'PURCHASE', '5000.0000', '5000.0000', 'KG',
        '35.000000', '175000.0000', ?, ?, ?, ?, ?)`,
      [
        gr1LedgerId, tenantId, companyId, feedItem.item_id, feedItem.item_code, feedItem.item_name,
        gr1LineId, postingDate, siloLocId, feedItem.nob_id, feedItem.lob_id, feedItem.category_id, now
      ]
    );
    console.log('   ✔ Seeded & Posted GR-000001: 5,000 KG Feed -> MUL100/SHED-001/SILO-001');

    // GR-000002: Vaccine into Store
    const gr2Id = randomUUID();
    const gr2LineId = randomUUID();
    const gr2LedgerId = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-000002', ?, ?, ?, 'INV-2026-MED-02', 'Parvo-Shield Vaccine Stock', 'POSTED', ?, ?, ?)`,
      [gr2Id, tenantId, companyId, postingDate, storeLocId, supplierId, now, now, now]
    );
    await conn.query(
      `INSERT INTO goods_receipt_line (
        line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, lot_no, expiry_date, remarks
      ) VALUES (?, ?, 1, ?, '100.0000', 'DOSE', '85.000000', '8500.0000', 'LOT-2026-X1', '2027-09-28', 'Lot Tracked Vaccine')`,
      [gr2LineId, gr2Id, vacItem.item_id]
    );
    await conn.query(
      `INSERT INTO inventory_ledger (
        ledger_id, tenant_id, company_id, item_id, item_code, item_description,
        document_type, document_no, document_line_id, posting_date, external_reference_no,
        entry_type, transaction_type, quantity, remaining_quantity, uom,
        rate, amount, lot_no, expiry_date, warehouse_id, nob_id, lob_id, category_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-000002', ?, ?, 'INV-2026-MED-02',
        'POSITIVE', 'PURCHASE', '100.0000', '100.0000', 'DOSE',
        '85.000000', '8500.0000', 'LOT-2026-X1', '2027-09-28', ?, ?, ?, ?, ?)`,
      [
        gr2LedgerId, tenantId, companyId, vacItem.item_id, vacItem.item_code, vacItem.item_name,
        gr2LineId, postingDate, storeLocId, vacItem.nob_id, vacItem.lob_id, vacItem.category_id, now
      ]
    );
    console.log('   ✔ Seeded & Posted GR-000002: 100 DOSE Vaccine (LOT-2026-X1) -> MUL100/STORE-001');

    // GR-000003: RFID Ear Tags into Store
    const gr3Id = randomUUID();
    await conn.query(
      `INSERT INTO goods_receipt (
        receipt_id, tenant_id, company_id, receipt_no, posting_date,
        warehouse_id, supplier_id, external_reference_no, remarks,
        status, posted_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'GR-000003', ?, ?, ?, 'INV-2026-TAG-03', 'RFID Ear Tag Stock', 'POSTED', ?, ?, ?)`,
      [gr3Id, tenantId, companyId, postingDate, storeLocId, supplierId, now, now, now]
    );

    const tagSerials = ['SER-2026-0001', 'SER-2026-0002', 'SER-2026-0003', 'SER-2026-0004', 'SER-2026-0005'];
    for (let i = 0; i < tagSerials.length; i++) {
      const lineId = randomUUID();
      const ledgerId = randomUUID();
      const sn = tagSerials[i];
      await conn.query(
        `INSERT INTO goods_receipt_line (
          line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, serial_no, remarks
        ) VALUES (?, ?, ?, ?, '1.0000', 'PCS', '2.500000', '2.5000', ?, 'Serial tracked tag')`,
        [lineId, gr3Id, i + 1, tagItem.item_id, sn]
      );
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date, external_reference_no,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, serial_no, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-000003', ?, ?, 'INV-2026-TAG-03',
          'POSITIVE', 'PURCHASE', '1.0000', '1.0000', 'PCS',
          '2.500000', '2.5000', ?, ?, ?, ?, ?, ?)`,
        [
          ledgerId, tenantId, companyId, tagItem.item_id, tagItem.item_code, tagItem.item_name,
          lineId, postingDate, sn, storeLocId, tagItem.nob_id, tagItem.lob_id, tagItem.category_id, now
        ]
      );
    }
    console.log('   ✔ Seeded & Posted GR-000003: 5 PCS RFID Ear Tags (SER-2026-0001..0005) -> MUL100/STORE-001');

    console.log('\n================================================================');
    console.log('🎉 CLEAN SEED COMPLETED SUCCESSFULLY!');
    console.log('================================================================');
    console.log('All operational tables are 0 rows. You can now run the complete E2E test:');
    console.log('');
    console.log('1. Standard Item Receipt:');
    console.log('   - Item: ITM-FEED-GROW (Weaner Grower Mash)');
    console.log('   - Warehouse: MUL100/SHED-001/SILO-001');
    console.log('   - Qty: 5000 KG @ $35.00');
    console.log('');
    console.log('2. Lot-Tracked Item Receipt:');
    console.log('   - Item: ITM-LOT-VACCINE (Parvo-Shield Vaccine)');
    console.log('   - Warehouse: MUL100/STORE-001');
    console.log('   - Qty: 100 DOSE @ $85.00');
    console.log('   - Lot No: Type custom lot (e.g. LOT-2026-X1) OR leave blank for auto-generation');
    console.log('');
    console.log('3. Serial-Tracked Item Receipt:');
    console.log('   - Item: ITM-SER-TAG (RFID Ear Tag)');
    console.log('   - Warehouse: MUL100/STORE-001');
    console.log('   - Qty: 5 PCS @ $2.50');
    console.log('   - Serial No: Type 5 serials OR leave blank for auto-generation');
    console.log('');
    console.log('4. Create Batch & Post Operational Data:');
    console.log('   - Shed: MUL100/SHED-001 | Breed: TN-70-Sow | Stage: GROWER');
    console.log('   - Opening Item: ITM-BIO-PIGLET (200 HEAD @ $180.00)');
    console.log('   - Daily Entry: Post 100 KG feed consumption from attached silo');
    console.log('================================================================\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seedCleanE2E().catch((err) => {
    console.error('❌ Clean seed failed:', err.message || err);
    process.exitCode = 1;
  });
}

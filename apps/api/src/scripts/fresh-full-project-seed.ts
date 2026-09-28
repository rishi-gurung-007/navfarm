/**
 * NAVFarm ERP — Fresh Full Database Drop & Seed Script
 *
 * Fully drops all linked databases and performs an end-to-end rebuild:
 *   1. Drops navfarm_master, tenant_system, tenant_devco (and nf_* variants).
 *   2. Bootstraps platform databases (migrations + system seeds).
 *   3. Syncs taxonomy, locales, reference masters (UOMs, breeds, stages).
 *   4. Provisions dev tenant (Triple C), company, administrators, roles, permissions.
 *   5. Seeds complete real piggery masters (Farms, Sheds, attached Silos, Stores, Pens, Item Catalog).
 *   6. Seeds 20 registered breeding pigs (Sows, Gilts, Boars with ear tags, RFIDs, parities, genetics).
 *   7. Creates exactly 4 Batches:
 *      - 2 ANIMAL_WISE (REGISTERED) batches with registered breeding stock assigned.
 *      - 2 BATCH_WISE (COUNT_ONLY) commercial grow-out batches (headcount only, no animal rows).
 *   8. Seeds initial inventory stock via Goods Receipts (GRN) into ALL shed silos & farm store.
 *
 * Usage:
 *   pnpm nx run api:db-fresh-full-seed
 *   pnpm db:fresh-full-seed
 */

import * as mysql from 'mysql2/promise';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';
const systemDatabase = process.env.SYSTEM_TENANT_DATABASE || 'tenant_system';
const tenantDatabase = process.env.DEV_TENANT_DATABASE || 'nf_devco';

function runStep(title: string, scriptFileWithArgs: string) {
  console.log(`\n⏳ ${title}...`);
  try {
    execSync(`node --env-file-if-exists=.env --import tsx src/scripts/${scriptFileWithArgs}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (err: any) {
    console.error(`❌ Failed during step: ${title}`);
    throw err;
  }
}

async function dropAllDatabases() {
  console.log('🧹 Step 1: Dropping all previous database instances...');
  const conn = await mysql.createConnection({ host, port, user, password, ssl });
  try {
    const dbsToDrop = [
      masterDatabase,
      systemDatabase,
      tenantDatabase,
      'nf_master',
      'nf_system',
      'nf_devco',
    ];
    for (const db of Array.from(new Set(dbsToDrop))) {
      console.log(`   - Dropping \`${db}\`...`);
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    }
  } finally {
    await conn.end();
  }
}

async function seedOperationalDataAndBatches() {
  console.log('\n================================================================');
  console.log('📦 SEEDING 4 BATCHES (2 ANIMAL_WISE, 2 BATCH_WISE), ANIMALS & STOCK');
  console.log('================================================================');

  const conn = await mysql.createConnection({ host, port, user, password, database: tenantDatabase, ssl });

  try {
    // 1. Fetch Company & Tenant Context
    const [companies] = await conn.query<mysql.RowDataPacket[]>('SELECT company_id, tenant_id FROM company_master LIMIT 1');
    if (!companies.length) throw new Error('No company found in database.');
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    const [nobRows] = await conn.query<mysql.RowDataPacket[]>("SELECT nob_id FROM nob_master WHERE nob_code = 'LIVESTOCK' LIMIT 1");
    const [lobRows] = await conn.query<mysql.RowDataPacket[]>("SELECT lob_id FROM lob_master WHERE lob_code = 'LVS_PIGGERY' LIMIT 1");
    const nobId = nobRows[0]?.nob_id;
    const lobId = lobRows[0]?.lob_id;

    const [areas] = await conn.query<mysql.RowDataPacket[]>('SELECT area_id FROM operational_area_master WHERE is_active = 1 LIMIT 1');
    const operationalAreaId = areas[0]?.area_id || null;

    // 2. Fetch Farms, Sheds, Pens, Silos, Store
    const [farms] = await conn.query<mysql.RowDataPacket[]>("SELECT location_id, location_code FROM location_master WHERE location_type = 'FARM' AND location_code = 'MUL100' LIMIT 1");
    const farmId = farms[0]?.location_id;

    // Link all sheds under MUL100 to their respective silos
    await conn.query(`
      UPDATE location_master shed
      JOIN location_master silo ON silo.parent_location_id = shed.location_id AND silo.location_type = 'SILO'
      SET shed.feed_silo_id = silo.location_id
      WHERE shed.location_type = 'SHED';
    `);

    const [sheds] = await conn.query<mysql.RowDataPacket[]>("SELECT location_id, location_code, feed_silo_id FROM location_master WHERE location_type = 'SHED' AND location_code LIKE 'MUL100/%' ORDER BY location_code");
    const shedMap = new Map(sheds.map((s) => [s.location_code, s]));

    const shed1 = shedMap.get('MUL100/SHED-001'); // Gilt House
    const shed2 = shedMap.get('MUL100/SHED-002'); // Dry Sow House
    const shed4 = shedMap.get('MUL100/SHED-004'); // Weaner House
    const shed5 = shedMap.get('MUL100/SHED-005') || shedMap.get('MUL100/SHED-006') || shedMap.get('MUL100/SHED-004'); // Finisher House

    const [pens] = await conn.query<mysql.RowDataPacket[]>("SELECT location_id, location_code FROM location_master WHERE location_type = 'PEN' AND location_code LIKE 'MUL100/%'");
    const penMap = new Map(pens.map((p) => [p.location_code, p.location_id]));
    const defaultPenId = pens[0]?.location_id || null;

    const [stores] = await conn.query<mysql.RowDataPacket[]>("SELECT location_id, location_code FROM location_master WHERE location_code = 'MUL100/STORE-001' LIMIT 1");
    const storeLocId = stores[0]?.location_id;

    // 3. Breeds & Stages
    const [breeds] = await conn.query<mysql.RowDataPacket[]>("SELECT breed_id, breed_code, breed_name FROM breed_master WHERE is_active = 1");
    const tn70 = breeds.find((b) => b.breed_code.includes('TN-70')) || breeds[0];
    const zLine = breeds.find((b) => b.breed_code.includes('Z-Line')) || breeds[1] || breeds[0];

    const [stages] = await conn.query<mysql.RowDataPacket[]>("SELECT stage_id, stage_code FROM stage_master WHERE is_active = 1");
    const stageMap = new Map(stages.map((s) => [s.stage_code, s.stage_id]));

    const drySowStageId = stageMap.get('DRY_SOW') || stages[0].stage_id;
    const giltGrowerStageId = stageMap.get('GILT_GROWER') || stages[0].stage_id;
    const weanerStageId = stageMap.get('WEANER') || stages[0].stage_id;
    const finisherStageId = stageMap.get('FINISHER') || stages[0].stage_id;

    // 4. Test Items (Feed, Vaccine, Ear Tag, Bio Asset Piglets, Breeding Sows/Gilts/Boars)
    const [items] = await conn.query<mysql.RowDataPacket[]>("SELECT * FROM item_master WHERE is_active = 1");
    const findItem = (code: string, fallbackName: string) =>
      items.find((i) => i.item_code === code || i.item_name.toLowerCase().includes(fallbackName.toLowerCase()));

    const feedItem = findItem('ICAT-004-ITM-0004', 'Weaner Grower Mash') || items[0];
    const drySowFeed = findItem('ICAT-004-ITM-0002', 'Dry Sow Gestation Mash') || feedItem;
    const giltGrowerFeed = findItem('ICAT-004-ITM-0004', 'Weaner Grower Mash') || feedItem;
    const weanerFeed = findItem('ICAT-004-ITM-0001', 'Creep Feed Pre-Starter') || feedItem;
    const finisherFeed = findItem('ICAT-004-ITM-0005', 'Finisher High-Gain Porker Feed') || feedItem;
    const premixItem = findItem('ICAT-003-ITM-0001', 'Premix') || feedItem;
    const dewormItem = findItem('ICAT-005-ITM-0004', 'Ivermectin') || items[0];
    const ironItem = findItem('ICAT-005-ITM-0001', 'Iron') || items[0];
    const vacItem = findItem('ITM-LOT-VACCINE', 'Vaccine') || findItem('ICAT-006-ITM-0001', 'Parvo-Shield') || items[0];
    const tagItem = findItem('ITM-SER-TAG', 'Ear Tag') || items[0];
    const pigletItem = findItem('ICAT-008-ITM-0001', 'Piglet') || items[0];
    const sowItem = items.find((i) => i.item_name.toLowerCase().includes('sow') && i.is_biological_asset) || pigletItem;
    const giltItem = items.find((i) => i.item_name.toLowerCase().includes('gilt') && i.is_biological_asset) || pigletItem;
    const boarItem = items.find((i) => i.item_name.toLowerCase().includes('boar') && i.is_biological_asset) || pigletItem;

    // 5. Seed 20 Registered Breeding Animals into animal_register
    console.log('🐖 Seeding 20 Registered Breeding Animals (SOW, GILT, BOAR)...');
    const animalDefs = [
      // SOWS (6 Registered Sows for Batch 1)
      { code: 'PIG-2026-0001', type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-03-10', age: 96, itemId: sowItem.item_id, tag: 'SOW-TN-001', rfid: '982000412880001', cost: 450, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-001') || defaultPenId, parity: 3, live: 38, wean: 36, teats: 16, tsi: 124.5, grading: 'GGP' },
      { code: 'PIG-2026-0002', type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-05-18', age: 86, itemId: sowItem.item_id, tag: 'SOW-TN-002', rfid: '982000412880002', cost: 450, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-002') || defaultPenId, parity: 2, live: 26, wean: 25, teats: 16, tsi: 122.0, grading: 'GGP' },
      { code: 'PIG-2026-0003', type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2023-11-05', age: 112, itemId: sowItem.item_id, tag: 'SOW-TN-003', rfid: '982000412880003', cost: 450, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-003') || defaultPenId, parity: 4, live: 52, wean: 49, teats: 16, tsi: 120.5, grading: 'GP' },
      { code: 'PIG-2026-0004', type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-08-20', age: 73, itemId: sowItem.item_id, tag: 'SOW-ZL-004', rfid: '982000412880004', cost: 480, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-004') || defaultPenId, parity: 1, live: 14, wean: 13, teats: 16, tsi: 126.0, grading: 'GGP' },
      { code: 'PIG-2026-0005', type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-06-15', age: 82, itemId: sowItem.item_id, tag: 'SOW-ZL-005', rfid: '982000412880005', cost: 480, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-005') || defaultPenId, parity: 2, live: 25, wean: 24, teats: 16, tsi: 123.8, grading: 'GP' },
      { code: 'PIG-2026-0006', type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-04-01', age: 93, itemId: sowItem.item_id, tag: 'SOW-TN-006', rfid: '982000412880006', cost: 450, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-006') || defaultPenId, parity: 3, live: 39, wean: 37, teats: 16, tsi: 121.0, grading: 'PS' },

      // GILTS (6 Registered Gilts for Batch 2)
      { code: 'PIG-2026-0007', type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-06-10', age: 31, itemId: giltItem.item_id, tag: 'GLT-TN-007', rfid: '982000412880007', cost: 320, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-001') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 125.0, grading: 'GGP' },
      { code: 'PIG-2026-0008', type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-06-25', age: 29, itemId: giltItem.item_id, tag: 'GLT-TN-008', rfid: '982000412880008', cost: 320, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-002') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 123.5, grading: 'GGP' },
      { code: 'PIG-2026-0009', type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-07-15', age: 26, itemId: giltItem.item_id, tag: 'GLT-TN-009', rfid: '982000412880009', cost: 320, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-003') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 121.0, grading: 'GP' },
      { code: 'PIG-2026-0010', type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-07-02', age: 28, itemId: giltItem.item_id, tag: 'GLT-ZL-010', rfid: '982000412880010', cost: 340, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-004') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 127.2, grading: 'GGP' },
      { code: 'PIG-2026-0011', type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-07-20', age: 25, itemId: giltItem.item_id, tag: 'GLT-ZL-011', rfid: '982000412880011', cost: 340, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-005') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 124.0, grading: 'GP' },
      { code: 'PIG-2026-0012', type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-05', age: 23, itemId: giltItem.item_id, tag: 'GLT-ZL-012', rfid: '982000412880012', cost: 340, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-006') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 122.0, grading: 'PS' },

      // BOARS (4 Stud Boars)
      { code: 'PIG-2026-0013', type: 'BOAR', breedId: zLine.breed_id, gender: 'M', dob: '2024-02-15', age: 100, itemId: boarItem.item_id, tag: 'BOAR-AI-013', rfid: '982000412880013', cost: 650, stage: stageMap.get('BOAR_AI') || drySowStageId, pen: penMap.get('MUL100/SHED-006/PEN-001') || defaultPenId, parity: 0, live: 0, wean: 0, teats: null, tsi: 132.0, grading: 'GGP' },
      { code: 'PIG-2026-0014', type: 'BOAR', breedId: zLine.breed_id, gender: 'M', dob: '2024-04-10', age: 92, itemId: boarItem.item_id, tag: 'BOAR-AI-014', rfid: '982000412880014', cost: 650, stage: stageMap.get('BOAR_AI') || drySowStageId, pen: penMap.get('MUL100/SHED-006/PEN-002') || defaultPenId, parity: 0, live: 0, wean: 0, teats: null, tsi: 130.5, grading: 'GGP' },
      { code: 'PIG-2026-0015', type: 'BOAR', breedId: tn70.breed_id, gender: 'M', dob: '2024-05-01', age: 89, itemId: boarItem.item_id, tag: 'BOAR-TN-015', rfid: '982000412880015', cost: 620, stage: stageMap.get('BOAR_AI') || drySowStageId, pen: penMap.get('MUL100/SHED-006/PEN-003') || defaultPenId, parity: 0, live: 0, wean: 0, teats: null, tsi: 128.0, grading: 'GP' },
      { code: 'PIG-2026-0016', type: 'BOAR', breedId: tn70.breed_id, gender: 'M', dob: '2024-05-20', age: 86, itemId: boarItem.item_id, tag: 'BOAR-TN-016', rfid: '982000412880016', cost: 620, stage: stageMap.get('BOAR_AI') || drySowStageId, pen: penMap.get('MUL100/SHED-006/PEN-004') || defaultPenId, parity: 0, live: 0, wean: 0, teats: null, tsi: 127.0, grading: 'GP' },

      // UNASSIGNED RESERVE GILTS & SOWS (For testing manual assignment on /batches/animals)
      { code: 'PIG-2026-0017', type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-08-10', age: 22, itemId: giltItem.item_id, tag: 'GLT-RES-017', rfid: '982000412880017', cost: 320, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-001') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 123.0, grading: 'GGP' },
      { code: 'PIG-2026-0018', type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-15', age: 22, itemId: giltItem.item_id, tag: 'GLT-RES-018', rfid: '982000412880018', cost: 340, stage: giltGrowerStageId, pen: penMap.get('MUL100/SHED-001/PEN-002') || defaultPenId, parity: 0, live: 0, wean: 0, teats: 16, tsi: 124.5, grading: 'GP' },
      { code: 'PIG-2026-0019', type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-06-01', age: 84, itemId: sowItem.item_id, tag: 'SOW-RES-019', rfid: '982000412880019', cost: 450, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-001') || defaultPenId, parity: 2, live: 24, wean: 23, teats: 16, tsi: 121.5, grading: 'GP' },
      { code: 'PIG-2026-0020', type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-07-01', age: 80, itemId: sowItem.item_id, tag: 'SOW-RES-020', rfid: '982000412880020', cost: 480, stage: drySowStageId, pen: penMap.get('MUL100/SHED-002/PEN-002') || defaultPenId, parity: 1, live: 13, wean: 12, teats: 16, tsi: 125.0, grading: 'GGP' },
    ];

    const animalIdMap = new Map<string, string>();
    for (const a of animalDefs) {
      const animalId = randomUUID();
      animalIdMap.set(a.code, animalId);
      await conn.query(
        `INSERT INTO animal_register (
          animal_id, tenant_id, company_id, nob_id, lob_id, operational_area_id,
          animal_code, animal_type, breed_id, gender, dob, age_at_entry_weeks,
          entry_type, entry_date, item_id, ear_tag, rfid_tag, acquisition_cost,
          total_opening_asset_value, current_bio_asset_value, book_value, total_amortised,
          parity_count, total_piglets_born_live, total_piglets_weaned,
          current_stage_id, current_location_id, no_of_teats, tsi, grading,
          status, is_active, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          'PURCHASED_LOCAL', '2026-01-10', ?, ?, ?, ?,
          ?, ?, ?, 0.0000,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          'ACTIVE', 1, NOW(), NOW()
        )`,
        [
          animalId, tenantId, companyId, nobId, lobId, operationalAreaId,
          a.code, a.type, a.breedId, a.gender, a.dob, a.age,
          a.itemId, a.tag, a.rfid, a.cost,
          a.cost, a.cost, a.cost,
          a.parity, a.live, a.wean,
          a.stage, a.pen, a.teats, a.tsi, a.grading,
        ]
      );
    }
    console.log(`   ✔ Seeded 20 registered animals (PIG-2026-0001..0020).`);

    // 6. SEED EXACTLY 4 BATCHES (2 ANIMAL_WISE, 2 BATCH_WISE)
    console.log('\n🐖 Seeding Exactly 4 Batches (2 Animal-Wise, 2 Batch-Wise)...');
    const startDate = '2026-09-01';

    // ── Batch 1: ANIMAL_WISE (BATCH-000001) ──
    const b1Id = randomUUID();
    const b1Animals = ['PIG-2026-0001', 'PIG-2026-0002', 'PIG-2026-0003', 'PIG-2026-0004', 'PIG-2026-0005', 'PIG-2026-0006'];
    await conn.query(
      `INSERT INTO batch_header (
        batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
        costing_method, breed_id, farm_id, shed_id, start_date, status,
        opening_quantity, uom, remarks, current_stage_code,
        stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'BATCH-000001', ?, ?,
        'STANDARD', ?, ?, ?, ?, 'ACTIVE',
        '6', 'HEAD', 'TN-70 Elite Breeding GGP Sow Batch 1', 'DRY_SOW',
        ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
      )`,
      [b1Id, tenantId, companyId, lobId, nobId, tn70.breed_id, farmId, shed2?.location_id, startDate, drySowStageId, operationalAreaId]
    );
    // Link Batch 1 animals
    for (const code of b1Animals) {
      const aId = animalIdMap.get(code);
      await conn.query(`UPDATE animal_register SET current_batch_id = ? WHERE animal_id = ?`, [b1Id, aId]);
    }
    console.log('   ✔ Seeded BATCH-000001: ANIMAL_WISE (REGISTERED) | Shed 2 (Dry Sow House) | 6 Registered Sows Assigned');

    // ── Batch 2: ANIMAL_WISE (BATCH-000002) ──
    const b2Id = randomUUID();
    const b2Animals = ['PIG-2026-0007', 'PIG-2026-0008', 'PIG-2026-0009', 'PIG-2026-0010', 'PIG-2026-0011', 'PIG-2026-0012'];
    await conn.query(
      `INSERT INTO batch_header (
        batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
        costing_method, breed_id, farm_id, shed_id, start_date, status,
        opening_quantity, uom, remarks, current_stage_code,
        stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'BATCH-000002', ?, ?,
        'STANDARD', ?, ?, ?, ?, 'ACTIVE',
        '6', 'HEAD', 'Z-Line Replacement Gilt Rearing Batch 2', 'GILT_GROWER',
        ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
      )`,
      [b2Id, tenantId, companyId, lobId, nobId, zLine.breed_id, farmId, shed1?.location_id, startDate, giltGrowerStageId, operationalAreaId]
    );
    // Link Batch 2 animals
    for (const code of b2Animals) {
      const aId = animalIdMap.get(code);
      await conn.query(`UPDATE animal_register SET current_batch_id = ? WHERE animal_id = ?`, [b2Id, aId]);
    }
    console.log('   ✔ Seeded BATCH-000002: ANIMAL_WISE (REGISTERED) | Shed 1 (Gilt House) | 6 Registered Gilts Assigned');

    // ── Batch 3: BATCH_WISE (BATCH-000003) ──
    const b3Id = randomUUID();
    await conn.query(
      `INSERT INTO batch_header (
        batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
        costing_method, breed_id, farm_id, shed_id, start_date, status,
        opening_quantity, uom, remarks, current_stage_code,
        stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'BATCH-000003', ?, ?,
        'STANDARD', ?, ?, ?, ?, 'ACTIVE',
        '200', 'HEAD', 'Commercial Weaner Grower Group Batch A', 'WEANER',
        ?, ?, 'COUNT_ONLY', 'BATCH_WISE', NOW(), NOW()
      )`,
      [b3Id, tenantId, companyId, lobId, nobId, tn70.breed_id, farmId, shed4?.location_id, startDate, weanerStageId, operationalAreaId]
    );
    console.log('   ✔ Seeded BATCH-000003: BATCH_WISE (COUNT_ONLY) | Shed 4 (Weaner House) | 200 Head Headcount');

    // ── Batch 4: BATCH_WISE (BATCH-000004) ──
    const b4Id = randomUUID();
    await conn.query(
      `INSERT INTO batch_header (
        batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
        costing_method, breed_id, farm_id, shed_id, start_date, status,
        opening_quantity, uom, remarks, current_stage_code,
        stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'BATCH-000004', ?, ?,
        'STANDARD', ?, ?, ?, ?, 'ACTIVE',
        '180', 'HEAD', 'Commercial Grower Finisher Group Batch B', 'FINISHER',
        ?, ?, 'COUNT_ONLY', 'BATCH_WISE', NOW(), NOW()
      )`,
      [b4Id, tenantId, companyId, lobId, nobId, tn70.breed_id, farmId, shed5?.location_id, startDate, finisherStageId, operationalAreaId]
    );
    console.log('   ✔ Seeded BATCH-000004: BATCH_WISE (COUNT_ONLY) | Shed 5 (Finisher House) | 180 Head Headcount');

    // Update number series counters
    await conn.query(
      `UPDATE no_series SET current_seq = 4, last_no_used = 'BATCH-000004' WHERE code = 'BATCH' AND company_id = ?`,
      [companyId]
    );
    await conn.query(
      `UPDATE no_series SET current_seq = 20, last_no_used = 'PIG-2026-0020' WHERE code = 'ANIMAL' AND company_id = ?`,
      [companyId]
    );
    console.log('   ✔ Number series updated (BATCH -> 4, ANIMAL -> 20).');

    // 7. SEED SCHEDULERS FOR ALL 4 BATCHES (FROM ACTIVITY_MASTER)
    console.log('\n📅 Seeding Schedulers for all 4 Batches (Activities from activity_master)...');

    // Ensure labor resources exist in resource_master
    const laborWorkerId = randomUUID();
    const laborVetId = randomUUID();
    const laborSanId = randomUUID();
    const laborMidwifeId = randomUUID();

    await conn.query(
      `INSERT INTO resource_master (
        resource_id, tenant_id, company_id, nob_id, lob_id, resource_code,
        resource_name, resource_type, unit, cost_rate, department, designation,
        is_active, status, created_at, updated_at
      ) VALUES 
      (?, ?, ?, ?, ?, 'RES-WORKER-01', 'General Farm Worker', 'LABOR', 'HRS', 5.0000, 'Farm Operations', 'Attendant', 1, 'ACTIVE', NOW(), NOW()),
      (?, ?, ?, ?, ?, 'RES-VET-01', 'Farm Veterinarian', 'LABOR', 'HRS', 25.0000, 'Veterinary Services', 'Veterinary Officer', 1, 'ACTIVE', NOW(), NOW()),
      (?, ?, ?, ?, ?, 'RES-DISINFECT-01', 'Sanitation Crew', 'LABOR', 'HRS', 8.0000, 'Biosecurity', 'Crew Member', 1, 'ACTIVE', NOW(), NOW()),
      (?, ?, ?, ?, ?, 'RES-MIDWIFE-01', 'Farrowing Technician', 'LABOR', 'HRS', 10.0000, 'Breeding', 'Midwife', 1, 'ACTIVE', NOW(), NOW())
      ON DUPLICATE KEY UPDATE updated_at = NOW()`,
      [
        laborWorkerId, tenantId, companyId, nobId, lobId,
        laborVetId, tenantId, companyId, nobId, lobId,
        laborSanId, tenantId, companyId, nobId, lobId,
        laborMidwifeId, tenantId, companyId, nobId, lobId,
      ]
    );

    const [workerRows] = await conn.query<mysql.RowDataPacket[]>("SELECT resource_id FROM resource_master WHERE resource_code = 'RES-WORKER-01' LIMIT 1");
    const [vetRows] = await conn.query<mysql.RowDataPacket[]>("SELECT resource_id FROM resource_master WHERE resource_code = 'RES-VET-01' LIMIT 1");
    const [disRows] = await conn.query<mysql.RowDataPacket[]>("SELECT resource_id FROM resource_master WHERE resource_code = 'RES-DISINFECT-01' LIMIT 1");
    const [midRows] = await conn.query<mysql.RowDataPacket[]>("SELECT resource_id FROM resource_master WHERE resource_code = 'RES-MIDWIFE-01' LIMIT 1");
    const resWorkerId = workerRows[0]?.resource_id || laborWorkerId;
    const resVetId = vetRows[0]?.resource_id || laborVetId;
    const resDisId = disRows[0]?.resource_id || laborSanId;
    const resMidId = midRows[0]?.resource_id || laborMidwifeId;

    await conn.query("UPDATE activity_master SET default_resource_id = ? WHERE activity_code = 'FARM_WORKER_ROUND'", [resWorkerId]);
    await conn.query("UPDATE activity_master SET default_resource_id = ? WHERE activity_code = 'VET_VISIT'", [resVetId]);
    await conn.query("UPDATE activity_master SET default_resource_id = ? WHERE activity_code = 'DISINFECT_CREW'", [resDisId]);
    await conn.query("UPDATE activity_master SET default_resource_id = ? WHERE activity_code = 'FARROW_ATTEND'", [resMidId]);

    const [actRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT activity_id, activity_code, activity_name, line_type, default_occurrence, default_is_mandatory, default_resource_id FROM activity_master WHERE is_active = 1'
    );
    const actByCode = new Map(actRows.map((a) => [a.activity_code, a]));

    const buildLine = (
      code: string,
      seq: number,
      overrides?: {
        itemId?: string | null;
        resourceId?: string | null;
        qty?: number | null;
        basis?: string | null;
        occurrence?: string;
        mandatory?: number;
        startDay?: number;
        endDay?: number | null;
      }
    ) => {
      const act = actByCode.get(code);
      if (!act) throw new Error(`Activity '${code}' not found in activity_master.`);
      return {
        seq,
        type: act.line_type,
        name: act.activity_name,
        occurrence: overrides?.occurrence || act.default_occurrence || 'DAILY',
        startDay: overrides?.startDay || 1,
        endDay: overrides?.endDay ?? null,
        mandatory: overrides?.mandatory ?? (act.default_is_mandatory ? 1 : 0),
        itemId: overrides?.itemId ?? null,
        resourceId: overrides?.resourceId ?? act.default_resource_id ?? null,
        qty: overrides?.qty ?? null,
        basis: overrides?.basis ?? (act.line_type === 'CONSUMPTION' ? 'PER_HEAD' : null),
      };
    };

    const seedBatchScheduler = async (
      batchNo: string,
      batchId: string,
      stageId: string,
      breedId: string,
      headcount: number,
      locationId: string | null | undefined,
      activities: Array<{
        seq: number;
        type: string;
        name: string;
        occurrence: string;
        startDay: number;
        endDay: number | null;
        mandatory: number;
        itemId?: string | null;
        resourceId?: string | null;
        qty?: number | null;
        basis?: string | null;
      }>
    ) => {
      const schedulerId = randomUUID();
      await conn.query(
        `INSERT INTO scheduler_header (
          scheduler_id, tenant_id, company_id, batch_id, stage_id,
          breed_id, lob_id, nob_id, location_id, data_entry_level, scheduler_status,
          effective_from, animal_count, auto_generated, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, 'SHED', 'ACTIVE',
          ?, ?, 1, NOW(), NOW()
        )`,
        [schedulerId, tenantId, companyId, batchId, stageId, breedId, lobId, nobId, locationId || null, startDate, headcount]
      );

      for (const act of activities) {
        await conn.query(
          `INSERT INTO scheduler_line (
            line_id, scheduler_id, line_seq, line_type, activity_name,
            stage_id, occurrence, start_day, end_day, is_mandatory, source,
            item_id, resource_id, standard_qty, qty_basis, allow_qty_edit, is_active
          ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, 'AUTO',
            ?, ?, ?, ?, 1, 1
          )`,
          [
            randomUUID(), schedulerId, act.seq, act.type, act.name,
            stageId, act.occurrence, act.startDay || 1, act.endDay ?? null, act.mandatory,
            act.itemId || null, act.resourceId || null, act.qty || null, act.basis || null
          ]
        );
      }
      console.log(`   ✔ Seeded Scheduler for ${batchNo} with ${activities.length} activities from activity_master.`);
    };

    // Batch 1 (Dry Sow) Activities
    await seedBatchScheduler('BATCH-000001', b1Id, drySowStageId, tn70.breed_id, 6, shed2?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: drySowFeed.item_id, qty: 2.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: drySowFeed.item_id, qty: 1.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('HEAT_CHECK', 3, { mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 4, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 5, { mandatory: 0 }),
      buildLine('PREG_CHECK', 6, { occurrence: 'ONCE', startDay: 28, endDay: 28, mandatory: 1 }),
      buildLine('VET_VISIT', 7, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('WEEKLY_BODY_WEIGHT', 8, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 9, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.05, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 10, { mandatory: 0 }),
    ]);

    // Batch 2 (Gilt Grower) Activities
    await seedBatchScheduler('BATCH-000002', b2Id, giltGrowerStageId, zLine.breed_id, 6, shed1?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: giltGrowerFeed.item_id, qty: 2.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: giltGrowerFeed.item_id, qty: 1.2, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('HEAT_CHECK', 3, { mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 4, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 5, { mandatory: 0 }),
      buildLine('WEEKLY_BODY_WEIGHT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VET_VISIT', 7, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 8, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.05, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('DEWORM_DOSE', 9, { occurrence: 'MONTHLY', itemId: dewormItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 10, { mandatory: 0 }),
    ]);

    // Batch 3 (Weaner) Activities
    await seedBatchScheduler('BATCH-000003', b3Id, weanerStageId, tn70.breed_id, 200, shed4?.location_id, [
      buildLine('CREEP_FEED', 1, { itemId: weanerFeed.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: weanerFeed.item_id, qty: 0.8, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 3, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 4, { mandatory: 0 }),
      buildLine('IRON_INJ', 5, { occurrence: 'ONCE', startDay: 3, endDay: 3, itemId: ironItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('WEEKLY_BODY_WEIGHT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VET_VISIT', 7, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 8, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.02, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 9, { mandatory: 0 }),
      buildLine('GROW_TRANSFER', 10, { occurrence: 'ONCE', startDay: 42, endDay: 42, mandatory: 1 }),
    ]);

    // Batch 4 (Finisher) Activities
    await seedBatchScheduler('BATCH-000004', b4Id, finisherStageId, tn70.breed_id, 180, shed5?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: finisherFeed.item_id, qty: 2.8, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: finisherFeed.item_id, qty: 1.8, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 3, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 4, { mandatory: 0 }),
      buildLine('WEEKLY_BODY_WEIGHT', 5, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VET_VISIT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 7, { mandatory: 0 }),
      buildLine('DEWORM_DOSE', 8, { occurrence: 'MONTHLY', itemId: dewormItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FINISHER_OUTPUT', 9, { occurrence: 'ONCE', startDay: 90, endDay: 90, mandatory: 1 }),
      buildLine('MANURE_OUTPUT', 10, { occurrence: 'MONTHLY', mandatory: 0 }),
    ]);

    // 8. SEED INVENTORY GOODS RECEIPTS & STOCK
    console.log('\n📦 Seeding Goods Receipts (GRN) & Stock for ALL Shed Silos & Store...');
    const postingDate = '2026-09-01';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const [suppliers] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT supplier_id FROM supplier_master WHERE company_id = ? LIMIT 1`,
      [companyId]
    );
    const supplierId = suppliers[0]?.supplier_id || null;

    // Seed 5,000 KG of feed into every silo matched to its shed's stage
    const [silos] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, location_name FROM location_master WHERE location_type = 'SILO' AND location_code LIKE 'MUL100/%'`
    );

    const getSiloFeed = (code: string) => {
      if (code.includes('SILO-001')) return giltGrowerFeed;
      if (code.includes('SILO-002') || code.includes('SILO-003')) return drySowFeed;
      if (code.includes('SILO-004')) return weanerFeed;
      if (code.includes('SILO-005') || code.includes('SILO-006')) return finisherFeed;
      return feedItem;
    };

    for (let sIdx = 0; sIdx < silos.length; sIdx++) {
      const silo = silos[sIdx];
      const targetFeed = getSiloFeed(silo.location_code);
      const grId = randomUUID();
      const lineId = randomUUID();
      const ledgerId = randomUUID();
      const grNo = `GR-FEED-${String(sIdx + 1).padStart(4, '0')}`;

      await conn.query(
        `INSERT INTO goods_receipt (
          receipt_id, tenant_id, company_id, receipt_no, posting_date,
          warehouse_id, supplier_id, external_reference_no, remarks,
          status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-FEED', 'Initial Feed Silo Stock', 'POSTED', ?, ?, ?)`,
        [grId, tenantId, companyId, grNo, postingDate, silo.location_id, supplierId, now, now, now]
      );
      await conn.query(
        `INSERT INTO goods_receipt_line (
          line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, remarks
        ) VALUES (?, ?, 1, ?, '5000.0000', 'KG', '35.000000', '175000.0000', ?)`,
        [lineId, grId, targetFeed.item_id, `${targetFeed.item_name} Silo Stock`]
      );
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date, external_reference_no,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-2026-FEED',
          'POSITIVE', 'PURCHASE', '5000.0000', '5000.0000', 'KG',
          '35.000000', '175000.0000', ?, ?, ?, ?, ?)`,
        [
          ledgerId, tenantId, companyId, targetFeed.item_id, targetFeed.item_code, targetFeed.item_name,
          grNo, lineId, postingDate, silo.location_id, targetFeed.nob_id, targetFeed.lob_id, targetFeed.category_id, now
        ]
      );
      console.log(`   ✔ Seeded 5,000 KG ${targetFeed.item_name} into ${silo.location_code}`);
    }

    // Seed 5,000 KG of all 4 feeds into Farm Store
    if (storeLocId) {
      const storeFeeds = [drySowFeed, giltGrowerFeed, weanerFeed, finisherFeed, premixItem];
      for (let fIdx = 0; fIdx < storeFeeds.length; fIdx++) {
        const item = storeFeeds[fIdx];
        const grStoreFeedId = randomUUID();
        const lineId = randomUUID();
        const ledgerId = randomUUID();
        const grNo = `GR-STORE-${String(fIdx + 1).padStart(3, '0')}`;
        const qty = item === premixItem ? '500.0000' : '5000.0000';
        const rate = item === premixItem ? '12.000000' : '35.000000';
        const amt = item === premixItem ? '6000.0000' : '175000.0000';
        await conn.query(
          `INSERT INTO goods_receipt (
            receipt_id, tenant_id, company_id, receipt_no, posting_date,
            warehouse_id, supplier_id, external_reference_no, remarks,
            status, posted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-STORE', 'Farm Store Inventory Stock', 'POSTED', ?, ?, ?)`,
          [grStoreFeedId, tenantId, companyId, grNo, postingDate, storeLocId, supplierId, now, now, now]
        );
        await conn.query(
          `INSERT INTO goods_receipt_line (
            line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, remarks
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
          [lineId, grStoreFeedId, item.item_id, qty, item.uom_primary || 'KG', rate, amt, `${item.item_name} in Store`]
        );
        await conn.query(
          `INSERT INTO inventory_ledger (
            ledger_id, tenant_id, company_id, item_id, item_code, item_description,
            document_type, document_no, document_line_id, posting_date, external_reference_no,
            entry_type, transaction_type, quantity, remaining_quantity, uom,
            rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-2026-STORE',
            'POSITIVE', 'PURCHASE', ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?)`,
          [
            ledgerId, tenantId, companyId, item.item_id, item.item_code, item.item_name,
            grNo, lineId, postingDate, qty, qty, item.uom_primary || 'KG',
            rate, amt, storeLocId, item.nob_id, item.lob_id, item.category_id, now
          ]
        );
      }
      console.log('   ✔ Seeded 5,000 KG of all 4 Stage Feeds + 500 KG Premix into MUL100/STORE-001.');
    }

    // Seed Vaccine into Store
    if (storeLocId && vacItem) {
      const grVacId = randomUUID();
      const lineId = randomUUID();
      const ledgerId = randomUUID();
      await conn.query(
        `INSERT INTO goods_receipt (
          receipt_id, tenant_id, company_id, receipt_no, posting_date,
          warehouse_id, supplier_id, external_reference_no, remarks,
          status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'GR-MED-0001', ?, ?, ?, 'INV-2026-MED', 'Parvo-Shield Vaccine Stock', 'POSTED', ?, ?, ?)`,
        [grVacId, tenantId, companyId, postingDate, storeLocId, supplierId, now, now, now]
      );
      await conn.query(
        `INSERT INTO goods_receipt_line (
          line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, lot_no, expiry_date, remarks
        ) VALUES (?, ?, 1, ?, '200.0000', 'DOSE', '85.000000', '17000.0000', 'LOT-2026-X1', '2027-09-28', 'Lot Tracked Vaccine')`,
        [lineId, grVacId, vacItem.item_id]
      );
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date, external_reference_no,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, lot_no, expiry_date, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-MED-0001', ?, ?, 'INV-2026-MED',
          'POSITIVE', 'PURCHASE', '200.0000', '200.0000', 'DOSE',
          '85.000000', '17000.0000', 'LOT-2026-X1', '2027-09-28', ?, ?, ?, ?, ?)`,
        [
          ledgerId, tenantId, companyId, vacItem.item_id, vacItem.item_code, vacItem.item_name,
          lineId, postingDate, storeLocId, vacItem.nob_id, vacItem.lob_id, vacItem.category_id, now
        ]
      );
      console.log('   ✔ Seeded 200 DOSE Parvo-Shield Vaccine (LOT-2026-X1) into MUL100/STORE-001.');
    }

    // Seed RFID Ear Tags into Store
    if (storeLocId && tagItem) {
      const grTagId = randomUUID();
      await conn.query(
        `INSERT INTO goods_receipt (
          receipt_id, tenant_id, company_id, receipt_no, posting_date,
          warehouse_id, supplier_id, external_reference_no, remarks,
          status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'GR-TAG-0001', ?, ?, ?, 'INV-2026-TAG', 'RFID Swine Ear Tag Stock', 'POSTED', ?, ?, ?)`,
        [grTagId, tenantId, companyId, postingDate, storeLocId, supplierId, now, now, now]
      );
      for (let i = 1; i <= 20; i++) {
        const lineId = randomUUID();
        const ledgerId = randomUUID();
        const serialNo = `SER-2026-${String(i).padStart(4, '0')}`;
        await conn.query(
          `INSERT INTO goods_receipt_line (
            line_id, receipt_id, line_no, item_id, quantity, uom, rate, amount, serial_no, remarks
          ) VALUES (?, ?, ?, ?, '1.0000', 'PCS', '2.500000', '2.5000', ?, 'Serial tracked tag')`,
          [lineId, grTagId, i, tagItem.item_id, serialNo]
        );
        await conn.query(
          `INSERT INTO inventory_ledger (
            ledger_id, tenant_id, company_id, item_id, item_code, item_description,
            document_type, document_no, document_line_id, posting_date, external_reference_no,
            entry_type, transaction_type, quantity, remaining_quantity, uom,
            rate, amount, serial_no, warehouse_id, nob_id, lob_id, category_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', 'GR-TAG-0001', ?, ?, 'INV-2026-TAG',
            'POSITIVE', 'PURCHASE', '1.0000', '1.0000', 'PCS',
            '2.500000', '2.5000', ?, ?, ?, ?, ?, ?)`,
          [
            ledgerId, tenantId, companyId, tagItem.item_id, tagItem.item_code, tagItem.item_name,
            lineId, postingDate, serialNo, storeLocId, tagItem.nob_id, tagItem.lob_id, tagItem.category_id, now
          ]
        );
      }
      console.log('   ✔ Seeded 20 Serial-Tracked RFID Ear Tags (SER-2026-0001..0020) into MUL100/STORE-001.');
    }

  } finally {
    await conn.end();
  }
}

export async function runFullFreshSetup() {
  console.log('================================================================');
  console.log('🚀 NAVFARM ERP — FULL FRESH DATABASE RESET & COMPLETE PROJECT SEED');
  console.log('================================================================');
  console.log(`Database Host:    ${host}:${port}`);
  console.log(`Master Database:  ${masterDatabase}`);
  console.log(`Tenant Database:  ${tenantDatabase}`);
  console.log('----------------------------------------------------------------');

  // 1. Drop old databases
  await dropAllDatabases();

  // 2. Platform bootstrap & taxonomy
  runStep('Step 2: Bootstrapping Master & System Databases', 'bootstrap-database.ts');
  runStep('Step 3: Syncing NOB & LOB Taxonomy (Livestock, Piggery)', 'sync-nob-lob.ts');
  runStep('Step 4: Syncing Locales, Timezones & Countries', 'sync-locale-master.ts');
  runStep('Step 5: Seeding Reference Masters (UOM, Species, Breeds, Stages)', 'seed-system-master-data.ts');

  // 3. Dev Tenant & Company
  runStep('Step 6: Provisioning Dev Tenant (Triple C), Users & Roles', 'seed-dev-tenant.ts');
  runStep('Step 7: Applying Pending Tenant Migrations', 'migrate-all-tenants.ts');
  runStep('Step 8: Seeding Activity Master Catalog', 'seed-activity-master.ts');
  runStep('Step 9: Adopting Company Master Templates', 'seed-company-master-templates.ts --apply');

  // 4. Real Estate & Locations
  runStep("Step 10: Seeding Triple C's Real Estate & Locations", 'seed-farm-locations.ts --apply');
  runStep("Step 11: Seeding Triple C's Real Resource and Breed Masters", 'seed-farm-masters.ts --apply');
  runStep("Step 12: Seeding Complete Item Catalog (Feed, Vaccines, Assets)", 'seed-demo-item-catalog.ts --apply');
  runStep('Step 13: Seeding Nine-Farm Demo Masters & Attached Silos', 'seed-nine-farm-demo.ts --apply');
  runStep('Step 14: Stamping NOB & LOB Taxonomy on Masters', 'stamp-master-nob-lob.ts --apply');
  runStep('Step 15: Aligning Production Role Permissions', 'align-production-permissions.ts --apply');

  // 5. Seed 4 Batches, Animals, and Stock
  await seedOperationalDataAndBatches();

  console.log('\n================================================================');
  console.log('🎉 FULL FRESH RESET & PROJECT SEED COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
  console.log('Summary of Seeded Data:');
  console.log('  1. Master Data: Complete Farms (MUL100..), Sheds, Silos, Stores, Breeds, Stages, Items, Suppliers.');
  console.log('  2. Animals:     20 Registered Breeding Pigs in animal_register.');
  console.log('  3. Batches (4 Total):');
  console.log('     • BATCH-000001: ANIMAL_WISE (REGISTERED) | Shed 2 (Dry Sow) | 6 Sows Assigned');
  console.log('     • BATCH-000002: ANIMAL_WISE (REGISTERED) | Shed 1 (Gilt House) | 6 Gilts Assigned');
  console.log('     • BATCH-000003: BATCH_WISE  (COUNT_ONLY) | Shed 4 (Weaner House) | 200 Head');
  console.log('     • BATCH-000004: BATCH_WISE  (COUNT_ONLY) | Shed 7 (Finisher House) | 180 Head');
  console.log('  4. Stock (GRN): 5,000 KG Feed in EVERY shed silo, 200 Dose Vaccine, 20 RFID Tags.');
  console.log('  5. Login:       http://localhost:3002/login?tenant=devco');
  console.log('     User:        tenant.admin@triplec.local / 12345678');
  console.log('================================================================\n');
}

if (require.main === module) {
  runFullFreshSetup().catch((err) => {
    console.error('❌ Fresh full setup failed:', err.message || err);
    process.exitCode = 1;
  });
}

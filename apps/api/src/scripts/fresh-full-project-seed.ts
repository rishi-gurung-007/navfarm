/**
 * NAVFarm ERP — Fresh Full Database Drop & Seed Script
 *
 * Fully drops all linked databases and performs an end-to-end rebuild:
 *   1. Drops navfarm_master, tenant_system, tenant_devco (and nf_* variants).
 *   2. Bootstraps platform databases (migrations + system seeds).
 *   3. Syncs taxonomy, locales, reference masters (UOMs, breeds, stages).
 *   4. Provisions dev tenant (Triple C), company, administrators, roles, permissions.
 *   5. Seeds complete real piggery masters (Farms, Sheds, attached Silos, Stores, Pens, Item Catalog).
 *   6. Multi-farm layout with 3 active farms (MUL100, GRA100, POR100):
 *      - MUL100 (Multiplier): 2 ANIMAL_WISE batches with multi-stage distribution:
 *        • BATCH-000001: Dry Sow, Insemination, and Farrowing stages with live animals.
 *        • BATCH-000002: Gilt Grower and Insemination stages with live gilts.
 *        • Stud boars and unallocated reserve animals.
 *      - GRA100 (Grasmere): 2 BATCH_WISE commercial growout batches with multi-stage schedulers:
 *        • BATCH-000003: Weaner, Grower, and Finisher stages.
 *        • BATCH-000004: Grower and Finisher stages.
 *        • Unallocated reserve animals.
 *      - POR100 (Porta): 1 ANIMAL_WISE batch with Dry Sow and Farrowing stages + reserve stock.
 *   7. Strict placement integrity: All animals are stationed in pens strictly on their assigned farm.
 *   8. Complete schedulers (scheduler_header & scheduler_line) for ALL stages across all 5 batches.
 *   9. Stock GRN into all farm silos & stores (Feeds, Premix, Vaccines, Serial-tracked Ear Tags).
 *  10. Real Stock Transfers (posted transfers with dual inventory ledger legs + draft transfer).
 *  11. User role assignments: Farm managers (MANAGER) & operators (OPERATOR) properly linked.
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
  console.log('📦 SEEDING MULTI-FARM & MULTI-STAGE BATCHES, SCHEDULERS & STOCK');
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

    // 2. Fetch Farms (MUL100, GRA100, POR100)
    const [farms] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT location_id, location_code, location_name FROM location_master WHERE location_type = 'FARM' AND location_code IN ('MUL100', 'GRA100', 'POR100')"
    );
    const farmByCode = new Map(farms.map((f) => [f.location_code, f]));
    const mulFarm = farmByCode.get('MUL100');
    const graFarm = farmByCode.get('GRA100');
    const porFarm = farmByCode.get('POR100');

    if (!mulFarm || !graFarm || !porFarm) {
      throw new Error(`One or more required farms missing: MUL100=${!!mulFarm}, GRA100=${!!graFarm}, POR100=${!!porFarm}`);
    }

    // 3. Ensure all sheds under all farms have their attached feed_silo_id linked
    await conn.query(`
      UPDATE location_master shed
      JOIN location_master silo ON (silo.parent_location_id = shed.parent_location_id OR silo.parent_location_id = shed.location_id) AND silo.location_type = 'SILO'
      SET shed.feed_silo_id = silo.location_id
      WHERE shed.location_type = 'SHED' AND shed.feed_silo_id IS NULL;
    `);

    // Fetch all sheds, pens, silos, and stores grouped by farm
    const [allSheds] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT location_id, location_code, location_name, farm_id, feed_silo_id FROM location_master WHERE location_type = 'SHED' ORDER BY location_code"
    );
    const shedsByFarm = new Map<string, mysql.RowDataPacket[]>();
    for (const shed of allSheds) {
      const fId = shed.farm_id;
      if (!shedsByFarm.has(fId)) shedsByFarm.set(fId, []);
      shedsByFarm.get(fId)!.push(shed);
    }

    const [allPens] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT location_id, location_code, farm_id, shed_id FROM location_master WHERE location_type = 'PEN' ORDER BY location_code"
    );
    const pensByShed = new Map<string, string[]>();
    const pensByFarm = new Map<string, string[]>();
    for (const pen of allPens) {
      if (pen.shed_id) {
        if (!pensByShed.has(pen.shed_id)) pensByShed.set(pen.shed_id, []);
        pensByShed.get(pen.shed_id)!.push(pen.location_id);
      }
      if (pen.farm_id) {
        if (!pensByFarm.has(pen.farm_id)) pensByFarm.set(pen.farm_id, []);
        pensByFarm.get(pen.farm_id)!.push(pen.location_id);
      }
    }

    const [allSilos] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT location_id, location_code, location_name, farm_id, parent_location_id FROM location_master WHERE location_type = 'SILO' ORDER BY location_code"
    );
    const silosByFarm = new Map<string, mysql.RowDataPacket[]>();
    for (const silo of allSilos) {
      const fId = silo.farm_id || silo.parent_location_id;
      if (!silosByFarm.has(fId)) silosByFarm.set(fId, []);
      silosByFarm.get(fId)!.push(silo);
    }

    const [allStores] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT location_id, location_code, location_name, farm_id, parent_location_id FROM location_master WHERE location_type = 'STORE' ORDER BY location_code"
    );
    const storesByFarm = new Map<string, mysql.RowDataPacket>();
    for (const store of allStores) {
      const fId = store.farm_id || store.parent_location_id;
      if (!storesByFarm.has(fId)) storesByFarm.set(fId, store);
    }

    // Helper to get shed by index or code snippet
    const getFarmShed = (farmId: string, search: string) => {
      const list = shedsByFarm.get(farmId) || [];
      return list.find((s) => s.location_code.includes(search) || s.location_name.toLowerCase().includes(search.toLowerCase())) || list[0];
    };

    // Helper to get a pen safely on a specific farm and shed
    const getPenOnFarm = (farmId: string, shedId?: string, penIndex = 0): string => {
      if (shedId && pensByShed.has(shedId) && pensByShed.get(shedId)!.length > 0) {
        const list = pensByShed.get(shedId)!;
        return list[penIndex % list.length];
      }
      const farmList = pensByFarm.get(farmId) || [];
      if (!farmList.length) throw new Error(`No pens found on farm ID ${farmId}`);
      return farmList[penIndex % farmList.length];
    };

    // 4. Breeds & Stages (Strictly Prefer Company Scope)
    const [breeds] = await conn.query<mysql.RowDataPacket[]>('SELECT breed_id, breed_code, breed_name FROM breed_master WHERE is_active = 1');
    const tn70 = breeds.find((b) => b.breed_code.includes('TN-70')) || breeds[0];
    const zLine = breeds.find((b) => b.breed_code.includes('Z-Line')) || breeds[1] || breeds[0];

    const [stages] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT stage_id, stage_code, stage_name, company_id FROM stage_master WHERE is_active = 1 AND (company_id = ? OR company_id IS NULL) ORDER BY company_id DESC',
      [companyId]
    );

    const getStageId = (code: string) => {
      const found = stages.find((s) => s.stage_code === code && s.company_id === companyId) ||
                    stages.find((s) => s.stage_code === code);
      return found?.stage_id || stages[0]?.stage_id;
    };

    const drySowStageId = getStageId('DRY_SOW');
    const inseminationStageId = getStageId('INSEMINATION');
    const farrowingStageId = getStageId('FARROWING');
    const giltGrowerStageId = getStageId('GILT_GROWER');
    const weanerStageId = getStageId('WEANER');
    const growerStageId = getStageId('GROWER');
    const finisherStageId = getStageId('FINISHER');
    const boarAiStageId = getStageId('BOAR_AI');

    // 5. Item Catalog
    const [items] = await conn.query<mysql.RowDataPacket[]>('SELECT * FROM item_master WHERE is_active = 1');
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

    // 6. Shed References
    const mulShed1 = getFarmShed(mulFarm.location_id, 'SHED-001'); // Gilt House
    const mulShed2 = getFarmShed(mulFarm.location_id, 'SHED-002'); // Dry Sow House
    const mulShed3 = getFarmShed(mulFarm.location_id, 'SHED-003'); // Farrowing House
    const mulShed4 = getFarmShed(mulFarm.location_id, 'SHED-004'); // Weaner House
    const mulShed5 = getFarmShed(mulFarm.location_id, 'SHED-005'); // Grower/Rearing House
    const mulShed6 = getFarmShed(mulFarm.location_id, 'SHED-006'); // Boar House

    const graShed1 = getFarmShed(graFarm.location_id, 'SHED-001');
    const graShed2 = getFarmShed(graFarm.location_id, 'SHED-002');
    const graShed4 = getFarmShed(graFarm.location_id, 'SHED-004'); // Weaner House
    const graShed5 = getFarmShed(graFarm.location_id, 'SHED-005'); // Grower House
    const graShed6 = getFarmShed(graFarm.location_id, 'SHED-006'); // Finisher House

    const porShed1 = getFarmShed(porFarm.location_id, 'SHED-001');
    const porShed2 = getFarmShed(porFarm.location_id, 'SHED-002'); // Dry Sow House
    const porShed3 = getFarmShed(porFarm.location_id, 'SHED-003'); // Farrowing House

    // 7. Seed 30 Registered Breeding & Commercial Animals with Multi-Stage Assignment
    console.log('🐖 Seeding 30 Registered Animals with Multi-Stage Allocation...');

    const animalDefs = [
      // ── MUL100 SOWS (Batch 1: 2 Dry Sow, 2 Insemination, 2 Farrowing) ──
      { code: 'PIG-2026-0001', farmId: mulFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-03-10', age: 96, itemId: sowItem.item_id, tag: 'SOW-TN-001', rfid: '982000412880001', cost: 450, stage: drySowStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 0), parity: 3, live: 38, wean: 36, teats: 16, tsi: 124.5, grading: 'GGP' },
      { code: 'PIG-2026-0002', farmId: mulFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-05-18', age: 86, itemId: sowItem.item_id, tag: 'SOW-TN-002', rfid: '982000412880002', cost: 450, stage: drySowStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 1), parity: 2, live: 26, wean: 25, teats: 16, tsi: 122.0, grading: 'GGP' },
      { code: 'PIG-2026-0003', farmId: mulFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2023-11-05', age: 112, itemId: sowItem.item_id, tag: 'SOW-TN-003', rfid: '982000412880003', cost: 450, stage: inseminationStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 2), parity: 4, live: 52, wean: 49, teats: 16, tsi: 120.5, grading: 'GP' },
      { code: 'PIG-2026-0004', farmId: mulFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-08-20', age: 73, itemId: sowItem.item_id, tag: 'SOW-ZL-004', rfid: '982000412880004', cost: 480, stage: inseminationStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 3), parity: 1, live: 14, wean: 13, teats: 16, tsi: 126.0, grading: 'GGP' },
      { code: 'PIG-2026-0005', farmId: mulFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-06-15', age: 82, itemId: sowItem.item_id, tag: 'SOW-ZL-005', rfid: '982000412880005', cost: 480, stage: farrowingStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed3?.location_id, 0), parity: 2, live: 25, wean: 24, teats: 16, tsi: 123.8, grading: 'GP' },
      { code: 'PIG-2026-0006', farmId: mulFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-04-01', age: 93, itemId: sowItem.item_id, tag: 'SOW-TN-006', rfid: '982000412880006', cost: 450, stage: farrowingStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed3?.location_id, 1), parity: 3, live: 39, wean: 37, teats: 16, tsi: 121.0, grading: 'PS' },

      // ── MUL100 GILTS (Batch 2: 3 Gilt Grower, 3 Insemination) ──
      { code: 'PIG-2026-0007', farmId: mulFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-06-10', age: 31, itemId: giltItem.item_id, tag: 'GLT-TN-007', rfid: '982000412880007', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 0), parity: 0, live: 0, wean: 0, teats: 16, tsi: 125.0, grading: 'GGP' },
      { code: 'PIG-2026-0008', farmId: mulFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-06-25', age: 29, itemId: giltItem.item_id, tag: 'GLT-TN-008', rfid: '982000412880008', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 1), parity: 0, live: 0, wean: 0, teats: 16, tsi: 123.5, grading: 'GGP' },
      { code: 'PIG-2026-0009', farmId: mulFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-07-15', age: 26, itemId: giltItem.item_id, tag: 'GLT-TN-009', rfid: '982000412880009', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 2), parity: 0, live: 0, wean: 0, teats: 16, tsi: 121.0, grading: 'GP' },
      { code: 'PIG-2026-0010', farmId: mulFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-07-02', age: 28, itemId: giltItem.item_id, tag: 'GLT-ZL-010', rfid: '982000412880010', cost: 340, stage: inseminationStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 3), parity: 0, live: 0, wean: 0, teats: 16, tsi: 127.2, grading: 'GGP' },
      { code: 'PIG-2026-0011', farmId: mulFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-07-20', age: 25, itemId: giltItem.item_id, tag: 'GLT-ZL-011', rfid: '982000412880011', cost: 340, stage: inseminationStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 4), parity: 0, live: 0, wean: 0, teats: 16, tsi: 124.0, grading: 'GP' },
      { code: 'PIG-2026-0012', farmId: mulFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-05', age: 23, itemId: giltItem.item_id, tag: 'GLT-ZL-012', rfid: '982000412880012', cost: 340, stage: inseminationStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 5), parity: 0, live: 0, wean: 0, teats: 16, tsi: 122.0, grading: 'PS' },

      // ── MUL100 BOARS (4 Stud Boars) ──
      { code: 'PIG-2026-0013', farmId: mulFarm.location_id, type: 'BOAR', breedId: zLine.breed_id, gender: 'M', dob: '2024-02-15', age: 100, itemId: boarItem.item_id, tag: 'BOAR-AI-013', rfid: '982000412880013', cost: 650, stage: boarAiStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed6?.location_id, 0), parity: 0, live: 0, wean: 0, teats: null, tsi: 132.0, grading: 'GGP' },
      { code: 'PIG-2026-0014', farmId: mulFarm.location_id, type: 'BOAR', breedId: zLine.breed_id, gender: 'M', dob: '2024-04-10', age: 92, itemId: boarItem.item_id, tag: 'BOAR-AI-014', rfid: '982000412880014', cost: 650, stage: boarAiStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed6?.location_id, 1), parity: 0, live: 0, wean: 0, teats: null, tsi: 130.5, grading: 'GGP' },
      { code: 'PIG-2026-0015', farmId: mulFarm.location_id, type: 'BOAR', breedId: tn70.breed_id, gender: 'M', dob: '2024-05-01', age: 89, itemId: boarItem.item_id, tag: 'BOAR-TN-015', rfid: '982000412880015', cost: 620, stage: boarAiStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed6?.location_id, 2), parity: 0, live: 0, wean: 0, teats: null, tsi: 128.0, grading: 'GP' },
      { code: 'PIG-2026-0016', farmId: mulFarm.location_id, type: 'BOAR', breedId: tn70.breed_id, gender: 'M', dob: '2024-05-20', age: 86, itemId: boarItem.item_id, tag: 'BOAR-TN-016', rfid: '982000412880016', cost: 620, stage: boarAiStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed6?.location_id, 3), parity: 0, live: 0, wean: 0, teats: null, tsi: 127.0, grading: 'GP' },

      // ── MUL100 UNASSIGNED RESERVE STOCK (4 Animals) ──
      { code: 'PIG-2026-0017', farmId: mulFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-08-10', age: 22, itemId: giltItem.item_id, tag: 'GLT-RES-017', rfid: '982000412880017', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 0), parity: 0, live: 0, wean: 0, teats: 16, tsi: 123.0, grading: 'GGP' },
      { code: 'PIG-2026-0018', farmId: mulFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-15', age: 22, itemId: giltItem.item_id, tag: 'GLT-RES-018', rfid: '982000412880018', cost: 340, stage: giltGrowerStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed1?.location_id, 1), parity: 0, live: 0, wean: 0, teats: 16, tsi: 124.5, grading: 'GP' },
      { code: 'PIG-2026-0019', farmId: mulFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-06-01', age: 84, itemId: sowItem.item_id, tag: 'SOW-RES-019', rfid: '982000412880019', cost: 450, stage: drySowStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 0), parity: 2, live: 24, wean: 23, teats: 16, tsi: 121.5, grading: 'GP' },
      { code: 'PIG-2026-0020', farmId: mulFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-07-01', age: 80, itemId: sowItem.item_id, tag: 'SOW-RES-020', rfid: '982000412880020', cost: 480, stage: drySowStageId, pen: getPenOnFarm(mulFarm.location_id, mulShed2?.location_id, 1), parity: 1, live: 13, wean: 12, teats: 16, tsi: 125.0, grading: 'GGP' },

      // ── GRA100 UNASSIGNED RESERVE ANIMALS (4 Animals) ──
      { code: 'PIG-2026-0021', farmId: graFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-08-01', age: 24, itemId: giltItem.item_id, tag: 'GRA-GLT-021', rfid: '982000412880021', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(graFarm.location_id, graShed1?.location_id, 0), parity: 0, live: 0, wean: 0, teats: 16, tsi: 122.0, grading: 'GGP' },
      { code: 'PIG-2026-0022', farmId: graFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-10', age: 22, itemId: giltItem.item_id, tag: 'GRA-GLT-022', rfid: '982000412880022', cost: 340, stage: giltGrowerStageId, pen: getPenOnFarm(graFarm.location_id, graShed1?.location_id, 1), parity: 0, live: 0, wean: 0, teats: 16, tsi: 125.0, grading: 'GP' },
      { code: 'PIG-2026-0023', farmId: graFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-05-10', age: 88, itemId: sowItem.item_id, tag: 'GRA-SOW-023', rfid: '982000412880023', cost: 450, stage: drySowStageId, pen: getPenOnFarm(graFarm.location_id, graShed2?.location_id, 0), parity: 2, live: 24, wean: 22, teats: 16, tsi: 121.0, grading: 'GP' },
      { code: 'PIG-2026-0024', farmId: graFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-06-01', age: 84, itemId: sowItem.item_id, tag: 'GRA-SOW-024', rfid: '982000412880024', cost: 480, stage: drySowStageId, pen: getPenOnFarm(graFarm.location_id, graShed2?.location_id, 1), parity: 1, live: 12, wean: 12, teats: 16, tsi: 123.5, grading: 'GGP' },

      // ── POR100 SOWS (Batch 5: 2 Dry Sow, 2 Farrowing) ──
      { code: 'PIG-2026-0025', farmId: porFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-04-15', age: 91, itemId: sowItem.item_id, tag: 'POR-SOW-025', rfid: '982000412880025', cost: 450, stage: drySowStageId, pen: getPenOnFarm(porFarm.location_id, porShed2?.location_id, 0), parity: 2, live: 25, wean: 24, teats: 16, tsi: 123.0, grading: 'GGP' },
      { code: 'PIG-2026-0026', farmId: porFarm.location_id, type: 'SOW', breedId: tn70.breed_id, gender: 'F', dob: '2024-05-20', age: 86, itemId: sowItem.item_id, tag: 'POR-SOW-026', rfid: '982000412880026', cost: 450, stage: drySowStageId, pen: getPenOnFarm(porFarm.location_id, porShed2?.location_id, 1), parity: 2, live: 26, wean: 25, teats: 16, tsi: 121.5, grading: 'GP' },
      { code: 'PIG-2026-0027', farmId: porFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-07-10', age: 79, itemId: sowItem.item_id, tag: 'POR-SOW-027', rfid: '982000412880027', cost: 480, stage: farrowingStageId, pen: getPenOnFarm(porFarm.location_id, porShed3?.location_id, 0), parity: 1, live: 13, wean: 13, teats: 16, tsi: 125.5, grading: 'GGP' },
      { code: 'PIG-2026-0028', farmId: porFarm.location_id, type: 'SOW', breedId: zLine.breed_id, gender: 'F', dob: '2024-08-01', age: 76, itemId: sowItem.item_id, tag: 'POR-SOW-028', rfid: '982000412880028', cost: 480, stage: farrowingStageId, pen: getPenOnFarm(porFarm.location_id, porShed3?.location_id, 1), parity: 1, live: 14, wean: 13, teats: 16, tsi: 124.0, grading: 'GP' },

      // ── POR100 UNASSIGNED RESERVE GILTS (2 Reserve Animals) ──
      { code: 'PIG-2026-0029', farmId: porFarm.location_id, type: 'GILT', breedId: tn70.breed_id, gender: 'F', dob: '2025-08-05', age: 23, itemId: giltItem.item_id, tag: 'POR-GLT-029', rfid: '982000412880029', cost: 320, stage: giltGrowerStageId, pen: getPenOnFarm(porFarm.location_id, porShed1?.location_id, 0), parity: 0, live: 0, wean: 0, teats: 16, tsi: 122.5, grading: 'GP' },
      { code: 'PIG-2026-0030', farmId: porFarm.location_id, type: 'GILT', breedId: zLine.breed_id, gender: 'F', dob: '2025-08-12', age: 22, itemId: giltItem.item_id, tag: 'POR-GLT-030', rfid: '982000412880030', cost: 340, stage: giltGrowerStageId, pen: getPenOnFarm(porFarm.location_id, porShed1?.location_id, 1), parity: 0, live: 0, wean: 0, teats: 16, tsi: 124.0, grading: 'GGP' },
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
    console.log(`   ✔ Seeded 30 registered animals across multiple stages with strict farm-placement.`);

    // 8. SEED 5 BATCHES ACROSS 3 FARMS
    console.log('\n🐖 Seeding 5 Batches (3 Animal-Wise, 2 Batch-Wise)...');
    const startDate = '2026-09-01';

    // ── Batch 1: MUL100 ANIMAL_WISE (BATCH-000001) ──
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
        '6', 'HEAD', 'MUL100 Elite TN-70 Breeding GGP Sow Batch 1', 'DRY_SOW',
        ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
      )`,
      [b1Id, tenantId, companyId, lobId, nobId, tn70.breed_id, mulFarm.location_id, mulShed2?.location_id, startDate, drySowStageId, operationalAreaId]
    );
    for (const code of b1Animals) {
      const aId = animalIdMap.get(code);
      await conn.query(`UPDATE animal_register SET current_batch_id = ? WHERE animal_id = ?`, [b1Id, aId]);
    }
    console.log('   ✔ Seeded BATCH-000001: ANIMAL_WISE on MUL100 (6 Sows across Dry Sow, Insemination, Farrowing)');

    // ── Batch 2: MUL100 ANIMAL_WISE (BATCH-000002) ──
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
        '6', 'HEAD', 'MUL100 Z-Line Replacement Gilt Batch 2', 'GILT_GROWER',
        ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
      )`,
      [b2Id, tenantId, companyId, lobId, nobId, zLine.breed_id, mulFarm.location_id, mulShed1?.location_id, startDate, giltGrowerStageId, operationalAreaId]
    );
    for (const code of b2Animals) {
      const aId = animalIdMap.get(code);
      await conn.query(`UPDATE animal_register SET current_batch_id = ? WHERE animal_id = ?`, [b2Id, aId]);
    }
    console.log('   ✔ Seeded BATCH-000002: ANIMAL_WISE on MUL100 (6 Gilts across Gilt Grower & Insemination)');

    // ── Batch 3: GRA100 BATCH_WISE (BATCH-000003) ──
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
        '150', 'HEAD', 'GRA100 Commercial Weaner Grower Group Batch A', 'WEANER',
        ?, ?, 'COUNT_ONLY', 'BATCH_WISE', NOW(), NOW()
      )`,
      [b3Id, tenantId, companyId, lobId, nobId, tn70.breed_id, graFarm.location_id, graShed4?.location_id, startDate, weanerStageId, operationalAreaId]
    );
    console.log('   ✔ Seeded BATCH-000003: BATCH_WISE on GRA100 (150 Head, Weaner -> Grower -> Finisher)');

    // ── Batch 4: GRA100 BATCH_WISE (BATCH-000004) ──
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
        '120', 'HEAD', 'GRA100 Commercial Finisher Group Batch B', 'FINISHER',
        ?, ?, 'COUNT_ONLY', 'BATCH_WISE', NOW(), NOW()
      )`,
      [b4Id, tenantId, companyId, lobId, nobId, tn70.breed_id, graFarm.location_id, graShed6?.location_id, startDate, finisherStageId, operationalAreaId]
    );
    console.log('   ✔ Seeded BATCH-000004: BATCH_WISE on GRA100 (120 Head, Grower -> Finisher)');

    // ── Batch 5: POR100 ANIMAL_WISE (BATCH-000005) ──
    const b5Id = randomUUID();
    const b5Animals = ['PIG-2026-0025', 'PIG-2026-0026', 'PIG-2026-0027', 'PIG-2026-0028'];
    await conn.query(
      `INSERT INTO batch_header (
        batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
        costing_method, breed_id, farm_id, shed_id, start_date, status,
        opening_quantity, uom, remarks, current_stage_code,
        stage_id, operational_area_id, animal_tracking, tracking_mode, created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'BATCH-000005', ?, ?,
        'STANDARD', ?, ?, ?, ?, 'ACTIVE',
        '4', 'HEAD', 'POR100 Commercial Breeding Sow Batch 1', 'DRY_SOW',
        ?, ?, 'REGISTERED', 'ANIMAL_WISE', NOW(), NOW()
      )`,
      [b5Id, tenantId, companyId, lobId, nobId, tn70.breed_id, porFarm.location_id, porShed2?.location_id, startDate, drySowStageId, operationalAreaId]
    );
    for (const code of b5Animals) {
      const aId = animalIdMap.get(code);
      await conn.query(`UPDATE animal_register SET current_batch_id = ? WHERE animal_id = ?`, [b5Id, aId]);
    }
    console.log('   ✔ Seeded BATCH-000005: ANIMAL_WISE on POR100 (4 Sows across Dry Sow & Farrowing)');

    // Update number series counters
    await conn.query(
      `UPDATE no_series SET current_seq = 5, last_no_used = 'BATCH-000005' WHERE code = 'BATCH' AND company_id = ?`,
      [companyId]
    );
    await conn.query(
      `UPDATE no_series SET current_seq = 30, last_no_used = 'PIG-2026-0030' WHERE code = 'ANIMAL' AND company_id = ?`,
      [companyId]
    );
    console.log('   ✔ Number series updated (BATCH -> 5, ANIMAL -> 30).');

    // 9. SEED MULTI-STAGE SCHEDULERS FOR ALL BATCHES
    console.log('\n📅 Seeding Multi-Stage Batch Schedulers (scheduler_header & scheduler_line)...');

    // Ensure labor resources exist
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
      stageLabel: string,
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
        )
        ON DUPLICATE KEY UPDATE updated_at = NOW()`,
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
      console.log(`   ✔ Seeded Scheduler for ${batchNo} [${stageLabel}] with ${activities.length} activities.`);
    };

    // ── BATCH-000001 (MUL100 Sows: Dry Sow, Insemination, Farrowing) ──
    // 1. Dry Sow Stage
    await seedBatchScheduler('BATCH-000001', b1Id, drySowStageId, 'DRY_SOW', tn70.breed_id, 2, mulShed2?.location_id, [
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

    // 2. Insemination Stage
    await seedBatchScheduler('BATCH-000001', b1Id, inseminationStageId, 'INSEMINATION', tn70.breed_id, 2, mulShed2?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: drySowFeed.item_id, qty: 2.2, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: drySowFeed.item_id, qty: 1.4, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('HEAT_CHECK', 3, { mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 4, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 5, { mandatory: 0 }),
      buildLine('VET_VISIT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('BCS_EVAL', 7, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 8, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.05, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 9, { mandatory: 0 }),
    ]);

    // 3. Farrowing Stage
    await seedBatchScheduler('BATCH-000001', b1Id, farrowingStageId, 'FARROWING', tn70.breed_id, 2, mulShed3?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: drySowFeed.item_id, qty: 3.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: drySowFeed.item_id, qty: 2.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('FARROW_ATTEND', 3, { mandatory: 1 }),
      buildLine('PIGLET_OUTPUT', 4, { occurrence: 'ONCE', startDay: 1, endDay: 1, mandatory: 1 }),
      buildLine('IRON_INJ', 5, { occurrence: 'ONCE', startDay: 3, endDay: 3, itemId: ironItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 6, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 7, { mandatory: 0 }),
      buildLine('VET_VISIT', 8, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('WEAN_OUTPUT', 9, { occurrence: 'ONCE', startDay: 28, endDay: 28, mandatory: 1 }),
      buildLine('FARM_WORKER_ROUND', 10, { mandatory: 0 }),
    ]);

    // ── BATCH-000002 (MUL100 Gilts: Gilt Grower, Insemination) ──
    // 1. Gilt Grower Stage
    await seedBatchScheduler('BATCH-000002', b2Id, giltGrowerStageId, 'GILT_GROWER', zLine.breed_id, 3, mulShed1?.location_id, [
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

    // 2. Insemination Stage
    await seedBatchScheduler('BATCH-000002', b2Id, inseminationStageId, 'INSEMINATION', zLine.breed_id, 3, mulShed1?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: giltGrowerFeed.item_id, qty: 2.2, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: giltGrowerFeed.item_id, qty: 1.3, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('HEAT_CHECK', 3, { mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 4, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 5, { mandatory: 0 }),
      buildLine('VET_VISIT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('BCS_EVAL', 7, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 8, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.05, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 9, { mandatory: 0 }),
    ]);

    // ── BATCH-000003 (GRA100 Commercial Growout: Weaner, Grower, Finisher) ──
    // 1. Weaner Stage
    await seedBatchScheduler('BATCH-000003', b3Id, weanerStageId, 'WEANER', tn70.breed_id, 150, graShed4?.location_id, [
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

    // 2. Grower Stage
    await seedBatchScheduler('BATCH-000003', b3Id, growerStageId, 'GROWER', tn70.breed_id, 150, graShed5?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: feedItem.item_id, qty: 2.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: feedItem.item_id, qty: 1.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 3, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 4, { mandatory: 0 }),
      buildLine('WEEKLY_BODY_WEIGHT', 5, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VET_VISIT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VIT_SUPPL', 7, { occurrence: 'WEEKLY', itemId: premixItem.item_id, qty: 0.03, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('DEWORM_DOSE', 8, { occurrence: 'MONTHLY', itemId: dewormItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 9, { mandatory: 0 }),
      buildLine('GROW_TRANSFER', 10, { occurrence: 'ONCE', startDay: 45, endDay: 45, mandatory: 1 }),
    ]);

    // 3. Finisher Stage
    await seedBatchScheduler('BATCH-000003', b3Id, finisherStageId, 'FINISHER', tn70.breed_id, 150, graShed6?.location_id, [
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

    // ── BATCH-000004 (GRA100 Finisher Group: Grower, Finisher) ──
    // 1. Grower Stage
    await seedBatchScheduler('BATCH-000004', b4Id, growerStageId, 'GROWER', tn70.breed_id, 120, graShed5?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: feedItem.item_id, qty: 2.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: feedItem.item_id, qty: 1.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 3, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 4, { mandatory: 0 }),
      buildLine('WEEKLY_BODY_WEIGHT', 5, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('VET_VISIT', 6, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('FARM_WORKER_ROUND', 7, { mandatory: 0 }),
      buildLine('GROW_TRANSFER', 8, { occurrence: 'ONCE', startDay: 45, endDay: 45, mandatory: 1 }),
    ]);

    // 2. Finisher Stage
    await seedBatchScheduler('BATCH-000004', b4Id, finisherStageId, 'FINISHER', tn70.breed_id, 120, graShed6?.location_id, [
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

    // ── BATCH-000005 (POR100 Sows: Dry Sow, Farrowing) ──
    // 1. Dry Sow Stage
    await seedBatchScheduler('BATCH-000005', b5Id, drySowStageId, 'DRY_SOW', tn70.breed_id, 2, porShed2?.location_id, [
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

    // 2. Farrowing Stage
    await seedBatchScheduler('BATCH-000005', b5Id, farrowingStageId, 'FARROWING', tn70.breed_id, 2, porShed3?.location_id, [
      buildLine('MORN_FEED', 1, { itemId: drySowFeed.item_id, qty: 3.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('EVE_FEED', 2, { itemId: drySowFeed.item_id, qty: 2.5, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('FARROW_ATTEND', 3, { mandatory: 1 }),
      buildLine('PIGLET_OUTPUT', 4, { occurrence: 'ONCE', startDay: 1, endDay: 1, mandatory: 1 }),
      buildLine('IRON_INJ', 5, { occurrence: 'ONCE', startDay: 3, endDay: 3, itemId: ironItem.item_id, qty: 1.0, basis: 'PER_HEAD', mandatory: 1 }),
      buildLine('DAILY_MORTALITY_CHECK', 6, { mandatory: 1 }),
      buildLine('TEMP_HUMID_LOG', 7, { mandatory: 0 }),
      buildLine('VET_VISIT', 8, { occurrence: 'WEEKLY', mandatory: 0 }),
      buildLine('WEAN_OUTPUT', 9, { occurrence: 'ONCE', startDay: 28, endDay: 28, mandatory: 1 }),
      buildLine('FARM_WORKER_ROUND', 10, { mandatory: 0 }),
    ]);

    // 10. SEED INVENTORY GOODS RECEIPTS (GRN) & STOCK ACROSS ALL 3 FARMS
    console.log('\n📦 Seeding Goods Receipts (GRN) & Stock for Silos & Stores across MUL100, GRA100, POR100...');
    const postingDate = '2026-09-01';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const [suppliers] = await conn.query<mysql.RowDataPacket[]>('SELECT supplier_id FROM supplier_master WHERE company_id = ? LIMIT 1', [companyId]);
    const supplierId = suppliers[0]?.supplier_id || null;

    const getSiloFeed = (code: string) => {
      if (code.includes('SILO-001')) return giltGrowerFeed;
      if (code.includes('SILO-002') || code.includes('SILO-003')) return drySowFeed;
      if (code.includes('SILO-004')) return weanerFeed;
      if (code.includes('SILO-005') || code.includes('SILO-006')) return finisherFeed;
      return feedItem;
    };

    let grCounter = 1;
    const storeFeedLedgerLayerMap = new Map<string, string>(); // key: `${storeId}:${itemId}` -> ledgerId

    const activeFarms = [mulFarm, graFarm, porFarm];
    for (const farm of activeFarms) {
      const farmSilos = silosByFarm.get(farm.location_id) || [];
      const farmStore = storesByFarm.get(farm.location_id);

      // Seed Feed in each silo of this farm
      for (const silo of farmSilos) {
        const targetFeed = getSiloFeed(silo.location_code);
        const grId = randomUUID();
        const lineId = randomUUID();
        const ledgerId = randomUUID();
        const grNo = `GR-${String(grCounter++).padStart(6, '0')}`;

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
      }
      console.log(`   ✔ Seeded Feed into ${farmSilos.length} Silos on ${farm.location_code}`);

      // Seed Farm Store (Feeds, Premix, Vaccines, Ear Tags)
      if (farmStore) {
        const storeFeeds = [drySowFeed, giltGrowerFeed, weanerFeed, finisherFeed, premixItem];
        for (const item of storeFeeds) {
          const grStoreFeedId = randomUUID();
          const lineId = randomUUID();
          const ledgerId = randomUUID();
          const grNo = `GR-${String(grCounter++).padStart(6, '0')}`;
          const qty = item === premixItem ? '500.0000' : '5000.0000';
          const rate = item === premixItem ? '12.000000' : '35.000000';
          const amt = item === premixItem ? '6000.0000' : '175000.0000';

          await conn.query(
            `INSERT INTO goods_receipt (
              receipt_id, tenant_id, company_id, receipt_no, posting_date,
              warehouse_id, supplier_id, external_reference_no, remarks,
              status, posted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-STORE', 'Farm Store Inventory Stock', 'POSTED', ?, ?, ?)`,
            [grStoreFeedId, tenantId, companyId, grNo, postingDate, farmStore.location_id, supplierId, now, now, now]
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
              rate, amt, farmStore.location_id, item.nob_id, item.lob_id, item.category_id, now
            ]
          );
          storeFeedLedgerLayerMap.set(`${farmStore.location_id}:${item.item_id}`, ledgerId);
        }

        // Seed Vaccine into Store
        if (vacItem) {
          const grVacId = randomUUID();
          const lineId = randomUUID();
          const ledgerId = randomUUID();
          const grNo = `GR-${String(grCounter++).padStart(6, '0')}`;
          await conn.query(
            `INSERT INTO goods_receipt (
              receipt_id, tenant_id, company_id, receipt_no, posting_date,
              warehouse_id, supplier_id, external_reference_no, remarks,
              status, posted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-MED', 'Parvo-Shield Vaccine Stock', 'POSTED', ?, ?, ?)`,
            [grVacId, tenantId, companyId, grNo, postingDate, farmStore.location_id, supplierId, now, now, now]
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
            ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-2026-MED',
              'POSITIVE', 'PURCHASE', '200.0000', '200.0000', 'DOSE',
              '85.000000', '17000.0000', 'LOT-2026-X1', '2027-09-28', ?, ?, ?, ?, ?)`,
            [
              ledgerId, tenantId, companyId, vacItem.item_id, vacItem.item_code, vacItem.item_name,
              grNo, lineId, postingDate, farmStore.location_id, vacItem.nob_id, vacItem.lob_id, vacItem.category_id, now
            ]
          );
        }

        // Seed RFID Ear Tags into Store
        if (tagItem) {
          const grTagId = randomUUID();
          const grNo = `GR-${String(grCounter++).padStart(6, '0')}`;
          await conn.query(
            `INSERT INTO goods_receipt (
              receipt_id, tenant_id, company_id, receipt_no, posting_date,
              warehouse_id, supplier_id, external_reference_no, remarks,
              status, posted_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INV-2026-TAG', 'RFID Swine Ear Tag Stock', 'POSTED', ?, ?, ?)`,
            [grTagId, tenantId, companyId, grNo, postingDate, farmStore.location_id, supplierId, now, now, now]
          );
          for (let i = 1; i <= 20; i++) {
            const lineId = randomUUID();
            const ledgerId = randomUUID();
            const serialNo = `SER-${farm.location_code}-${String(i).padStart(4, '0')}`;
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
              ) VALUES (?, ?, ?, ?, ?, ?, 'GOODS_RECEIPT', ?, ?, ?, 'INV-2026-TAG',
                'POSITIVE', 'PURCHASE', '1.0000', '1.0000', 'PCS',
                '2.500000', '2.5000', ?, ?, ?, ?, ?, ?)`,
              [
                ledgerId, tenantId, companyId, tagItem.item_id, tagItem.item_code, tagItem.item_name,
                grNo, lineId, postingDate, serialNo, farmStore.location_id, tagItem.nob_id, tagItem.lob_id, tagItem.category_id, now
              ]
            );
          }
        }
        console.log(`   ✔ Seeded Feeds, Premix, Vaccines & RFID Tags into Store on ${farm.location_code}`);
      }
    }

    // 11. SEED REAL STOCK TRANSFERS (Store -> Shed Silos)
    console.log('\n🔄 Seeding Real Stock Transfers (stock_transfer, stock_transfer_line, inventory_ledger)...');

    // Transfer 1: POSTED on MUL100 (Store -> Gilt Silo, 1000 KG Gilt Grower Mash)
    const mulStore = storesByFarm.get(mulFarm.location_id);
    const mulSilos = silosByFarm.get(mulFarm.location_id) || [];
    const mulGiltSilo = mulSilos.find((s) => s.location_code.includes('SILO-001')) || mulSilos[0];

    if (mulStore && mulGiltSilo) {
      const trf1Id = randomUUID();
      const trf1LineId = randomUUID();
      const trf1No = 'TR-000001';
      const trf1Date = '2026-09-02';
      const trfQty = '1000.0000';
      const trfRate = '35.000000';
      const trfAmt = '35000.0000';

      await conn.query(
        `INSERT INTO stock_transfer (
          transfer_id, tenant_id, company_id, transfer_no, posting_date,
          from_warehouse_id, to_warehouse_id, remarks, status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Routine Feed Replenishment Store to Gilt Silo', 'POSTED', ?, ?, ?)`,
        [trf1Id, tenantId, companyId, trf1No, trf1Date, mulStore.location_id, mulGiltSilo.location_id, now, now, now]
      );
      await conn.query(
        `INSERT INTO stock_transfer_line (
          line_id, transfer_id, line_no, item_id, quantity, uom, remarks
        ) VALUES (?, ?, 1, ?, ?, 'KG', 'Gilt Grower Mash 1,000 KG')`,
        [trf1LineId, trf1Id, giltGrowerFeed.item_id, trfQty]
      );

      // Ledger: Outbound leg (TRANSFER_SHIPMENT, NEGATIVE)
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?,
          'NEGATIVE', 'TRANSFER_SHIPMENT', ?, NULL, 'KG',
          ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), tenantId, companyId, giltGrowerFeed.item_id, giltGrowerFeed.item_code, giltGrowerFeed.item_name,
          trf1No, trf1LineId, trf1Date, `-${trfQty}`,
          trfRate, `-${trfAmt}`, mulStore.location_id, giltGrowerFeed.nob_id, giltGrowerFeed.lob_id, giltGrowerFeed.category_id, now
        ]
      );

      // Ledger: Inbound leg (TRANSFER_RECEIPT, POSITIVE)
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?,
          'POSITIVE', 'TRANSFER_RECEIPT', ?, ?, 'KG',
          ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), tenantId, companyId, giltGrowerFeed.item_id, giltGrowerFeed.item_code, giltGrowerFeed.item_name,
          trf1No, trf1LineId, trf1Date, trfQty, trfQty,
          trfRate, trfAmt, mulGiltSilo.location_id, giltGrowerFeed.nob_id, giltGrowerFeed.lob_id, giltGrowerFeed.category_id, now
        ]
      );

      const srcLayerId = storeFeedLedgerLayerMap.get(`${mulStore.location_id}:${giltGrowerFeed.item_id}`);
      if (srcLayerId) {
        await conn.query(`UPDATE inventory_ledger SET remaining_quantity = remaining_quantity - 1000.0000 WHERE ledger_id = ?`, [srcLayerId]);
      }
      console.log(`   ✔ Seeded POSTED Stock Transfer TR-000001: 1,000 KG from ${mulStore.location_code} -> ${mulGiltSilo.location_code}`);
    }

    // Transfer 2: POSTED on GRA100 (Store -> Weaner Silo, 1000 KG Weaner Creep Feed)
    const graStore = storesByFarm.get(graFarm.location_id);
    const graSilos = silosByFarm.get(graFarm.location_id) || [];
    const graWeanerSilo = graSilos.find((s) => s.location_code.includes('SILO-004')) || graSilos[0];

    if (graStore && graWeanerSilo) {
      const trf2Id = randomUUID();
      const trf2LineId = randomUUID();
      const trf2No = 'TR-000002';
      const trf2Date = '2026-09-02';
      const trfQty = '1000.0000';
      const trfRate = '35.000000';
      const trfAmt = '35000.0000';

      await conn.query(
        `INSERT INTO stock_transfer (
          transfer_id, tenant_id, company_id, transfer_no, posting_date,
          from_warehouse_id, to_warehouse_id, remarks, status, posted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Weaner Feed Replenishment Store to Silo', 'POSTED', ?, ?, ?)`,
        [trf2Id, tenantId, companyId, trf2No, trf2Date, graStore.location_id, graWeanerSilo.location_id, now, now, now]
      );
      await conn.query(
        `INSERT INTO stock_transfer_line (
          line_id, transfer_id, line_no, item_id, quantity, uom, remarks
        ) VALUES (?, ?, 1, ?, ?, 'KG', 'Creep Feed 1,000 KG')`,
        [trf2LineId, trf2Id, weanerFeed.item_id, trfQty]
      );

      // Ledger: Outbound leg
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?,
          'NEGATIVE', 'TRANSFER_SHIPMENT', ?, NULL, 'KG',
          ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), tenantId, companyId, weanerFeed.item_id, weanerFeed.item_code, weanerFeed.item_name,
          trf2No, trf2LineId, trf2Date, `-${trfQty}`,
          trfRate, `-${trfAmt}`, graStore.location_id, weanerFeed.nob_id, weanerFeed.lob_id, weanerFeed.category_id, now
        ]
      );

      // Ledger: Inbound leg
      await conn.query(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, document_line_id, posting_date,
          entry_type, transaction_type, quantity, remaining_quantity, uom,
          rate, amount, warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'STOCK_TRANSFER', ?, ?, ?,
          'POSITIVE', 'TRANSFER_RECEIPT', ?, ?, 'KG',
          ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), tenantId, companyId, weanerFeed.item_id, weanerFeed.item_code, weanerFeed.item_name,
          trf2No, trf2LineId, trf2Date, trfQty, trfQty,
          trfRate, trfAmt, graWeanerSilo.location_id, weanerFeed.nob_id, weanerFeed.lob_id, weanerFeed.category_id, now
        ]
      );

      const srcLayerId = storeFeedLedgerLayerMap.get(`${graStore.location_id}:${weanerFeed.item_id}`);
      if (srcLayerId) {
        await conn.query(`UPDATE inventory_ledger SET remaining_quantity = remaining_quantity - 1000.0000 WHERE ledger_id = ?`, [srcLayerId]);
      }
      console.log(`   ✔ Seeded POSTED Stock Transfer TR-000002: 1,000 KG from ${graStore.location_code} -> ${graWeanerSilo.location_code}`);
    }

    // Transfer 3: DRAFT on POR100 (Store -> Dry Sow Silo, 800 KG Dry Sow Feed)
    const porStore = storesByFarm.get(porFarm.location_id);
    const porSilos = silosByFarm.get(porFarm.location_id) || [];
    const porDrySowSilo = porSilos.find((s) => s.location_code.includes('SILO-002')) || porSilos[0];

    if (porStore && porDrySowSilo) {
      const trf3Id = randomUUID();
      const trf3LineId = randomUUID();
      const trf3No = 'TR-000003';
      const trf3Date = '2026-09-03';

      await conn.query(
        `INSERT INTO stock_transfer (
          transfer_id, tenant_id, company_id, transfer_no, posting_date,
          from_warehouse_id, to_warehouse_id, remarks, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft Feed Transfer for Porta Gestation Silo', 'DRAFT', ?, ?)`,
        [trf3Id, tenantId, companyId, trf3No, trf3Date, porStore.location_id, porDrySowSilo.location_id, now, now]
      );
      await conn.query(
        `INSERT INTO stock_transfer_line (
          line_id, transfer_id, line_no, item_id, quantity, uom, remarks
        ) VALUES (?, ?, 1, ?, '800.0000', 'KG', 'Gestation Mash Draft Transfer 800 KG')`,
        [trf3LineId, trf3Id, drySowFeed.item_id]
      );
      console.log(`   ✔ Seeded DRAFT Stock Transfer TR-000003: 800 KG from ${porStore.location_code} -> ${porDrySowSilo.location_code}`);
    }

    // 12. USER ROLE ASSIGNMENTS & OPERATIONAL AREA GRANTS
    console.log('\n👥 Aligning User Role Assignments (MANAGER & OPERATOR) for all Farm Staff...');
    const [roles] = await conn.query<mysql.RowDataPacket[]>('SELECT role_id, role_code FROM role_master WHERE company_id = ?', [companyId]);
    const managerRole = roles.find((r) => r.role_code === 'MANAGER');
    const operatorRole = roles.find((r) => r.role_code === 'OPERATOR');

    const [adminUser] = await conn.query<mysql.RowDataPacket[]>("SELECT user_id FROM user_master WHERE user_type = 'TENANT_ADMIN' LIMIT 1");
    const assignedBy = adminUser[0]?.user_id || 'SYSTEM';

    const [users] = await conn.query<mysql.RowDataPacket[]>('SELECT user_id, email FROM user_master WHERE email LIKE "%@triplec.local"');

    for (const u of users) {
      let targetRoleId: string | undefined;
      if (u.email.includes('.manager@')) {
        targetRoleId = managerRole?.role_id;
      } else if (u.email.includes('.entry@')) {
        targetRoleId = operatorRole?.role_id;
      }

      if (targetRoleId) {
        const [existingURA] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT assign_id FROM user_role_assignment WHERE user_id = ? AND role_id = ?',
          [u.user_id, targetRoleId]
        );
        if (!existingURA.length) {
          await conn.query(
            `INSERT INTO user_role_assignment (assign_id, user_id, role_id, assigned_by, assigned_at, is_active)
             VALUES (?, ?, ?, ?, NOW(), 1)`,
            [randomUUID(), u.user_id, targetRoleId, assignedBy]
          );
        }
      }

      // Operational Area Assignment
      if (operationalAreaId) {
        const [existingArea] = await conn.query<mysql.RowDataPacket[]>(
          'SELECT assignment_id FROM user_operational_area_assignment WHERE user_id = ? AND area_id = ?',
          [u.user_id, operationalAreaId]
        );
        if (!existingArea.length) {
          await conn.query(
            `INSERT INTO user_operational_area_assignment (assignment_id, user_id, area_id, company_id, is_primary, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [randomUUID(), u.user_id, operationalAreaId, companyId]
          );
        }
      }
    }
    console.log(`   ✔ Assigned MANAGER & OPERATOR roles and operational areas to ${users.length} farm users.`);

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

  // 5. Seed Multi-Farm & Multi-Stage Batches, Schedulers, GRN & Transfers
  await seedOperationalDataAndBatches();

  console.log('\n================================================================');
  console.log('🎉 FULL FRESH RESET & PROJECT SEED COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
  console.log('Summary of Seeded Data:');
  console.log('  1. Farms (3 Active): MUL100 (Multiplier), GRA100 (Grasmere), POR100 (Porta).');
  console.log('  2. Locations:        Sheds, Silos, Stores, and Pens with strict farm-placement integrity.');
  console.log('  3. Animals (30):     All animals placed in pens strictly matching their own farm.');
  console.log('                       Multi-stage allocation across Dry Sow, Insemination, Farrowing, Gilt Grower.');
  console.log('  4. Batches (5):      • BATCH-000001: ANIMAL_WISE on MUL100 [Dry Sow, Insemination, Farrowing]');
  console.log('                       • BATCH-000002: ANIMAL_WISE on MUL100 [Gilt Grower, Insemination]');
  console.log('                       • BATCH-000003: BATCH_WISE on GRA100  [Weaner, Grower, Finisher]');
  console.log('                       • BATCH-000004: BATCH_WISE on GRA100  [Grower, Finisher]');
  console.log('                       • BATCH-000005: ANIMAL_WISE on POR100 [Dry Sow, Farrowing]');
  console.log('  5. Schedulers (12):  Full auto-scheduled headers & lines for every batch stage.');
  console.log('  6. Stock (GRN):      5,000 KG Feed in ALL shed silos; Feeds, Premix, Vaccines & Tags in Stores.');
  console.log('  7. Transfers (3):    • TR-000001 (POSTED): MUL100 Store -> Silo 1 (1,000 KG Feed)');
  console.log('                       • TR-000002 (POSTED): GRA100 Store -> Silo 4 (1,000 KG Feed)');
  console.log('                       • TR-000003 (DRAFT):  POR100 Store -> Silo 2 (800 KG Feed)');
  console.log('  8. Security/Roles:   MANAGER & OPERATOR roles assigned to all farm staff logins.');
  console.log('  9. Login:            http://localhost:3002/login?tenant=devco');
  console.log('     Tenant Admin:     tenant.admin@triplec.local / 12345678');
  console.log('     Farm Managers:    mul100.manager@triplec.local / gra100.manager@triplec.local');
  console.log('================================================================\n');
}

if (require.main === module) {
  runFullFreshSetup().catch((err) => {
    console.error('❌ Fresh full setup failed:', err.message || err);
    process.exitCode = 1;
  });
}

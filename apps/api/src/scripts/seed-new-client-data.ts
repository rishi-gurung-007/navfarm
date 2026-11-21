/**
 * Imports a new client's real farm/breeding master data — Location Master,
 * Sows, Boars — from NAVFarm's standard workbook templates into any
 * registered tenant. Nothing in this file is specific to one farm, breed, or
 * company: only the workbook paths and farm codes below are, and those come
 * entirely from configuration.
 *
 * cccshow's sales-demo embellishments (synthetic grower batches, invented
 * feed stock, silo/shed links reverse-engineered from a reference tenant)
 * live separately in seed-cccshow-demo-extras.ts and must never be run
 * against a real client's tenant.
 *
 * Configuration (environment variables):
 *   TARGET_TENANT_CODE   tenant_code to import into (required). SHOWCASE_TENANT_CODE
 *                        is accepted as an older alias.
 *   LOCATION_WORKBOOKS   one or more Location Master Template workbook paths,
 *                        semicolon-separated. At least one is required.
 *   SOW_WORKBOOKS        one or more "FARM_CODE=path" pairs, semicolon-separated.
 *                        A farm with several sow workbooks (e.g. inseminated /
 *                        not-inseminated) repeats its farm code with a
 *                        different path. At least one is required; FARM_CODE
 *                        must match a Location Code the location workbook(s)
 *                        import as a FARM row.
 *   BOAR_WORKBOOK        one boar workbook path (optional — boars are not
 *                        assigned to a single farm).
 *   BREED_CODE_HINT      a substring matched against breed_code/breed_name
 *                        (optional; required only when the company has more
 *                        than one active breed, since there is then no
 *                        unambiguous default).
 *
 * Default: read-only plan.
 * --verify: run the writes in a transaction and roll them back.
 * --apply: commit the writes.
 *
 * Bash:
 *   TARGET_TENANT_CODE=acme \
 *   LOCATION_WORKBOOKS="/path/Location Master.xlsx" \
 *   SOW_WORKBOOKS="FARM01=/path/Farm1 Sows.xlsx;FARM02=/path/Farm2 Sows.xlsx" \
 *     pnpm nx run api:db-seed-new-client-data -- --verify
 *
 * PowerShell:
 *   $env:TARGET_TENANT_CODE = "acme"
 *   $env:LOCATION_WORKBOOKS = "C:\path\Location Master.xlsx"
 *   $env:SOW_WORKBOOKS = "FARM01=C:\path\Farm1 Sows.xlsx;FARM02=C:\path\Farm2 Sows.xlsx"
 *   pnpm nx run api:db-seed-new-client-data -- --verify
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import * as mysql from 'mysql2/promise';
import * as XLSX from 'xlsx';

const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
const TENANT_CODE = process.env.TARGET_TENANT_CODE || process.env.SHOWCASE_TENANT_CODE;

const workbookPath = (value: string) => {
  const candidates = [
    resolve(process.cwd(), value),
    resolve(process.cwd(), '../..', value),
  ];
  const found = candidates.find((path) => fs.existsSync(path));
  if (!found) throw new Error(`Workbook not found: ${value}`);
  return found;
};

function parsePathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(workbookPath);
}

interface FarmWorkbook {
  farmCode: string;
  path: string;
}

function parseFarmWorkbooks(value: string | undefined): FarmWorkbook[] {
  if (!value) return [];
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf('=');
      if (idx < 0) throw new Error(`Malformed entry "${entry}" in SOW_WORKBOOKS — expected FARM_CODE=path.`);
      const farmCode = entry.slice(0, idx).trim();
      const path = entry.slice(idx + 1).trim();
      if (!farmCode || !path) throw new Error(`Malformed entry "${entry}" in SOW_WORKBOOKS — expected FARM_CODE=path.`);
      return { farmCode, path: workbookPath(path) };
    });
}

const LOCATION_WORKBOOKS = parsePathList(process.env.LOCATION_WORKBOOKS);
const SOW_WORKBOOKS = parseFarmWorkbooks(process.env.SOW_WORKBOOKS);
const BOAR_WORKBOOK = process.env.BOAR_WORKBOOK ? workbookPath(process.env.BOAR_WORKBOOK) : null;
const BREED_CODE_HINT = process.env.BREED_CODE_HINT?.trim() || null;

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  }
  return null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function sowRows(path: string): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
  const ws = wb.Sheets.Sows;
  if (!ws) throw new Error(`Workbook ${path} has no Sows sheet.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
  });
}

function boarRows(path: string): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
  const ws = wb.Sheets.Sheet1;
  if (!ws) throw new Error(`Workbook ${path} has no Sheet1 sheet.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
  });
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (
    process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) ||
    (apply && verify)
  )
    throw new Error('Use no flags (read-only), --verify, or --apply.');

  if (!TENANT_CODE)
    throw new Error('Set TARGET_TENANT_CODE to the tenant you are importing into.');
  if (!LOCATION_WORKBOOKS.length)
    throw new Error('Set LOCATION_WORKBOOKS to at least one Location Master Template workbook path.');
  if (!SOW_WORKBOOKS.length)
    throw new Error('Set SOW_WORKBOOKS to at least one "FARM_CODE=path" pair.');

  const master = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: MASTER_DB,
    ssl,
  });
  const [[tenant]] = await master.query<mysql.RowDataPacket[]>(
    'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ? LIMIT 1',
    [TENANT_CODE],
  );
  await master.end();
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} is not registered.`);

  const database =
    process.env.DEV_TENANT_DATABASE || (tenant.db_name as string);
  const db = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl,
  });

  try {
    await db.beginTransaction();
    const [[scopeRow]] = await db.query<mysql.RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id
       FROM location_master
       WHERE tenant_id = ? OR tenant_id IS NOT NULL
       LIMIT 1`,
      [tenant.tenant_id],
    );
    let scope = scopeRow;
    if (!scope) {
      // A brand-new tenant has no location rows yet. Fall back to the
      // company's own record and NAVFarm's fixed system taxonomy — "Livestock"
      // (NOB) / "Piggery" (LOB) are global rows seeded identically in every
      // tenant (nob_master/lob_master carry no tenant_id or company_id at
      // all), not anything specific to this client.
      const [[companyScope]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT c.tenant_id, c.company_id,
          '50000000-5000-5000-5000-000000000002' nob_id,
          '60000000-6000-6000-6000-000000000007' lob_id
         FROM company_master c LIMIT 1`,
      );
      if (!companyScope) throw new Error(`No company scope found in ${database}.`);
      scope = companyScope;
    }

    const write = apply || verify;
    const plan: Record<string, unknown> = {
      database,
      tenantCode: TENANT_CODE,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
    };

    // ---- Location Master ---------------------------------------------------
    const level: Record<string, number> = {
      FARM: 1,
      SHED: 2,
      PEN: 3,
      CRATE: 3,
      CAGE: 3,
      STORE: 2,
      SILO: 2,
      MILL: 2,
      BIN: 3,
    };
    let locationsInserted = 0;
    let locationsUpdated = 0;
    let locationWorkbookRows = 0;

    for (const locationFile of LOCATION_WORKBOOKS) {
      const wb = XLSX.readFile(locationFile, { type: 'file', cellDates: true });
      const ws = wb.Sheets['Location Master Template'];
      if (!ws)
        throw new Error(
          `Workbook ${locationFile} has no Location Master Template sheet.`,
        );
      const locationRows = XLSX.utils.sheet_to_json<Array<unknown>>(ws, {
        header: 1,
        defval: null,
        range: 5,
      });
      locationWorkbookRows += locationRows.filter((r) => r[2]).length;

      // Each workbook's own farm/shed chain — a farm or shed in one workbook
      // never becomes the implicit parent of a farm/shed in another.
      let lastFarmId: string | null = null;
      let lastShedId: string | null = null;

      for (const row of locationRows) {
        const code = String(row[2] ?? '').trim();
        if (!code) continue;
        const rawType = String(row[1] ?? '').trim().toUpperCase();
        if (!rawType) continue;
        const type =
          rawType === 'MAIN FARM'
            ? 'FARM'
            : rawType === 'SHED/HOUSE'
              ? 'SHED'
              : rawType;
        if (!level[type]) continue;

        const mainName = String(row[3] ?? '').trim();
        const subLoc = String(row[5] ?? '').trim();
        const subSubLoc = String(row[6] ?? '').trim();
        const name =
          subSubLoc || subLoc
            ? `${mainName}${subLoc ? ` - ${subLoc}` : ''}${subSubLoc ? ` - ${subSubLoc}` : ''}`
            : mainName || code;

        let parentId: string | null = null;
        if (type === 'FARM') {
          parentId = null;
        } else if (['SILO', 'STORE', 'MILL'].includes(type)) {
          parentId = lastFarmId;
        } else if (['SHED'].includes(type)) {
          parentId = lastFarmId;
        } else {
          parentId = lastShedId || lastFarmId;
        }
        if (type !== 'FARM' && !parentId)
          throw new Error(`Location ${code} has no resolvable parent.`);

        const [existing] = await db.query<mysql.RowDataPacket[]>(
          'SELECT location_id FROM location_master WHERE tenant_id = ? AND location_code = ? LIMIT 1',
          [scope.tenant_id, code],
        );
        const id =
          (existing[0]?.location_id as string | undefined) || randomUUID();

        const address = String(row[4] ?? '').trim() || null;
        const areaSize = num(row[7]);
        const rawAreaUnit = String(row[8] ?? '').trim();
        const areaUnit =
          rawAreaUnit === 'M2-Square Meter'
            ? 'M2'
            : rawAreaUnit === 'HECTARE'
              ? 'HECTARE'
              : rawAreaUnit.slice(0, 10) || null;
        const maxCapacity = num(row[9]);
        const capacityUom = String(row[10] ?? '').trim() || null;
        const storageType = String(row[11] ?? '').trim() || null;
        const storageName = String(row[12] ?? '').trim() || null;
        const siloCapacity = num(row[13]);
        const siloReorderDays = num(row[14]) === null ? null : Math.trunc(num(row[14])!);
        const downtime = num(row[15]) === null ? null : Math.trunc(num(row[15])!);
        const feedInBags =
          String(row[16] ?? '').toUpperCase().trim() === 'YES' ? 1 : 0;

        if (existing.length) {
          if (write) {
            await db.query(
              `UPDATE location_master SET company_id=?, nob_id=?, lob_id=?, location_name=?,
                 location_address=?, location_type=?, parent_location_id=?, location_level=?,
                 area_size=?, area_unit=?, max_capacity=?, capacity_uom=?, storage_type=?,
                 storage_name=?, silo_capacity_kg=?, silo_capacity_uom=?,
                 silo_reorder_days=?, downtime_days_required=?, feed_in_bags=?,
                 farm_id=?, shed_id=?, is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
               WHERE location_id=?`,
              [
                scope.company_id,
                scope.nob_id,
                scope.lob_id,
                name,
                address,
                type,
                parentId,
                level[type],
                areaSize,
                areaUnit,
                maxCapacity,
                capacityUom,
                storageType,
                storageName,
                siloCapacity,
                siloCapacity ? 'KG' : null,
                siloReorderDays,
                downtime,
                feedInBags,
                type === 'FARM' ? null : lastFarmId,
                type === 'SHED' ? id : lastShedId,
                id,
              ],
            );
          }
          locationsUpdated++;
        } else if (write) {
          await db.query(
            `INSERT INTO location_master
               (location_id, tenant_id, company_id, nob_id, lob_id, location_code,
                location_name, location_address, location_type, parent_location_id,
                location_level, area_size, area_unit, max_capacity, capacity_uom,
                storage_type, storage_name, silo_capacity_kg, silo_capacity_uom,
                silo_reorder_days, downtime_days_required, feed_in_bags,
                farm_id, shed_id, is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
            [
              id,
              scope.tenant_id,
              scope.company_id,
              scope.nob_id,
              scope.lob_id,
              code,
              name,
              address,
              type,
              parentId,
              level[type],
              areaSize,
              areaUnit,
              maxCapacity,
              capacityUom,
              storageType,
              storageName,
              siloCapacity,
              siloCapacity ? 'KG' : null,
              siloReorderDays,
              downtime,
              feedInBags,
              type === 'FARM' ? null : lastFarmId,
              type === 'SHED' ? id : lastShedId,
            ],
          );
          locationsInserted++;
        }

        if (type === 'FARM') {
          lastFarmId = id;
          lastShedId = null;
        } else if (type === 'SHED') {
          lastShedId = id;
        }
      }
    }
    plan.locations = {
      workbooks: LOCATION_WORKBOOKS,
      workbookRows: locationWorkbookRows,
      inserted: locationsInserted,
      updated: locationsUpdated,
      retainedExistingCodes: true,
    };

    // ---- Item and breed lookups ---------------------------------------------
    // NAVFarm's standard biological Item Master records — BIO-SWINE-SOW,
    // BIO-SWINE-BOAR, BIO-SWINE-GILT — not anything specific to this client.
    const standardItems = [
      {
        code: 'BIO-SWINE-SOW',
        name: 'Mature Parity Breeding Sow',
        subCategory: 'SOW_LIVESTOCK',
        standardCost: '28000.0000',
      },
      {
        code: 'BIO-SWINE-BOAR',
        name: 'Mature Herd Sire Boar',
        subCategory: 'BOAR_LIVESTOCK',
        standardCost: '45000.0000',
      },
      {
        code: 'BIO-SWINE-GILT',
        name: 'Replacement Breeding Gilt',
        subCategory: 'GILT_LIVESTOCK',
        standardCost: '18000.0000',
      },
    ];

    const itemStatus: Record<string, 'created' | 'already-existed' | 'failed-validation'> = {};
    const ensureStandardItem = async (spec: (typeof standardItems)[number]) => {
      const [[existing]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT item_id FROM item_master
         WHERE tenant_id=? AND company_id=? AND item_code=? LIMIT 1`,
        [scope.tenant_id, scope.company_id, spec.code],
      );
      if (existing) {
        itemStatus[spec.code] = 'already-existed';
        return existing;
      }

      const [[itemType]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT item_type_id FROM item_type_master
         WHERE tenant_id=? AND company_id=? AND type_code='LIVING_ASSET'
           AND is_active=1 AND deleted_at IS NULL LIMIT 1`,
        [scope.tenant_id, scope.company_id],
      );
      const [[uom]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT uom_id FROM uom_master
         WHERE tenant_id=? AND company_id=? AND uom_code='HEAD'
           AND is_active=1 LIMIT 1`,
        [scope.tenant_id, scope.company_id],
      );
      const [[category]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT category_id FROM item_category_master
         WHERE tenant_id=? AND company_id=? AND category_name='Breeding Stock'
           AND is_active=1 LIMIT 1`,
        [scope.tenant_id, scope.company_id],
      );

      if (!itemType || !uom || !category) {
        itemStatus[spec.code] = 'failed-validation';
        throw new Error(
          `Cannot initialize ${spec.code}: required LIVING_ASSET type, HEAD UOM, or Breeding Stock category is missing for company ${scope.company_id}.`,
        );
      }

      if (!write) {
        itemStatus[spec.code] = 'failed-validation';
        return undefined;
      }

      const itemId = randomUUID();
      await db.query(
        `INSERT INTO item_master
           (item_id, tenant_id, company_id, category_id, item_code, item_name,
            item_type, sub_category, nob_id, lob_id, uom_primary,
            valuation_method, standard_cost, is_lot_tracked, is_serial_tracked,
            is_biological_asset, is_inventoriable, is_qc_required,
            is_active, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'LIVING_ASSET', ?, ?, ?, 'HEAD',
                 'BIO_ASSET', ?, 0, 0, 1, 1, 0, 1, 'ACTIVE', NOW(), NOW())`,
        [
          itemId,
          scope.tenant_id,
          scope.company_id,
          category.category_id,
          spec.code,
          spec.name,
          spec.subCategory,
          scope.nob_id,
          scope.lob_id,
          spec.standardCost,
        ],
      );
      itemStatus[spec.code] = 'created';
      return { item_id: itemId };
    };

    const sowItem = await ensureStandardItem(standardItems[0]);
    const boarItem = await ensureStandardItem(standardItems[1]);
    const giltItem = await ensureStandardItem(standardItems[2]);
    plan.itemDependencies = {
      'BIO-SWINE-SOW': itemStatus['BIO-SWINE-SOW'],
      'BIO-SWINE-BOAR': itemStatus['BIO-SWINE-BOAR'],
      'BIO-SWINE-GILT': itemStatus['BIO-SWINE-GILT'],
    };

    const [breeds] = await db.query<mysql.RowDataPacket[]>(
      `SELECT breed_id, breed_code, breed_name FROM breed_master
       WHERE tenant_id=? AND company_id=? AND is_active=1`,
      [scope.tenant_id, scope.company_id],
    );
    const normalize = (v: unknown) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    let breed: mysql.RowDataPacket | undefined;
    if (BREED_CODE_HINT) {
      const needle = normalize(BREED_CODE_HINT);
      breed =
        breeds.find((r) => normalize(r.breed_code).includes(needle)) ||
        breeds.find((r) => normalize(r.breed_name).includes(needle));
      if (!breed) throw new Error(`No active breed matches BREED_CODE_HINT "${BREED_CODE_HINT}".`);
    } else if (breeds.length === 1) {
      breed = breeds[0];
    } else {
      throw new Error(
        breeds.length === 0
          ? 'No active breed exists for this company; seed the breed master first.'
          : `Company has ${breeds.length} active breeds; set BREED_CODE_HINT to pick one (matched against breed_code or breed_name).`,
      );
    }

    // ---- Farms referenced by SOW_WORKBOOKS -----------------------------------
    const [farmRows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, company_id FROM location_master
       WHERE tenant_id=? AND location_type='FARM' AND is_active=1`,
      [scope.tenant_id],
    );
    const farmIdByCode = new Map(farmRows.map((r) => [r.location_code as string, r.location_id as string]));
    for (const { farmCode } of SOW_WORKBOOKS) {
      if (!farmIdByCode.has(farmCode))
        throw new Error(
          `Farm "${farmCode}" (from SOW_WORKBOOKS) was not found among imported locations — check it matches a FARM row's Location Code in LOCATION_WORKBOOKS.`,
        );
    }

    const sourceBatches = new Map<string, string>();
    for (const farmCode of new Set(SOW_WORKBOOKS.map((f) => f.farmCode))) {
      const farmId = farmIdByCode.get(farmCode)!;
      const batchNo = `${farmCode}-IMPORT-SOURCE`;
      const [existing] = await db.query<mysql.RowDataPacket[]>(
        'SELECT batch_id FROM batch_header WHERE tenant_id=? AND batch_no=? LIMIT 1',
        [scope.tenant_id, batchNo],
      );
      if (existing.length) {
        sourceBatches.set(farmCode, existing[0].batch_id as string);
        continue;
      }
      if (!write) continue;
      const batchId = randomUUID();
      await db.query(
        `INSERT INTO batch_header
           (batch_id, tenant_id, company_id, batch_no, lob_id, nob_id,
            costing_method, breed_id, farm_id, start_date, status,
            opening_quantity, uom, animal_tracking, tracking_mode,
            is_litter_lot, remarks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'BIO_ASSET', ?, ?, CURDATE(),
                 'ACTIVE', 0, 'HEAD', 'REGISTERED', 'ANIMAL_WISE',
                 0, 'Workbook import synthetic source batch; no real acquisition/purchase traceability available from the import.', NOW(), NOW())`,
        [
          batchId,
          scope.tenant_id,
          scope.company_id,
          batchNo,
          scope.lob_id,
          scope.nob_id,
          breed.breed_id,
          farmId,
        ],
      );
      sourceBatches.set(farmCode, batchId);
    }

    let sowsInserted = 0;
    let sowsUpdated = 0;
    let giltsInserted = 0;
    let giltsUpdated = 0;
    let boarsInserted = 0;
    let boarsUpdated = 0;

    const importSows = async (path: string, farmCode: string) => {
      const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
      const cyclesSheet = wb.Sheets.Cycles;
      const cycleIds = new Set<string>();
      if (cyclesSheet) {
        const cycleRows = XLSX.utils.sheet_to_json<Array<unknown>>(cyclesSheet, {
          header: 1,
          defval: null,
          range: 1,
        });
        for (const cycle of cycleRows) {
          const id = String(cycle[0] ?? '').trim();
          if (id) cycleIds.add(id);
        }
      }

      const farmId = farmIdByCode.get(farmCode)!;
      for (const row of sowRows(path)) {
        const code = String(row['Sow ID'] ?? '').trim();
        if (!code) continue;
        const dob = dateValue(row['Date of Birth']);
        const productiveStart =
          dateValue(row['Production Start Date']) || dob;
        const teats = num(row['Teats']);
        const damSerial = String(row['Dam'] ?? '').trim() || null;
        const sireSerial = String(row['Sire'] ?? '').trim() || null;
        if (!sowItem) continue;
        // A gilt is a young female with no recorded breeding cycle yet —
        // true regardless of which farm she is on.
        const isGilt = !cycleIds.has(code);
        if (isGilt && !giltItem) continue;
        // sowItem is checked above; giltItem is checked just above when isGilt.
        const animalItem = (isGilt ? giltItem : sowItem)!;
        const animalType = isGilt ? 'GILT' : 'SOW';
        const sourceBatchId = sourceBatches.get(farmCode) || null;

        const [existing] = await db.query<mysql.RowDataPacket[]>(
          'SELECT animal_id FROM animal_register WHERE tenant_id=? AND animal_code=? LIMIT 1',
          [scope.tenant_id, code],
        );
        if (existing.length) {
          if (write) {
            await db.query(
              `UPDATE animal_register SET company_id=?, nob_id=?, lob_id=?, breed_id=?,
                 animal_type=?, dob=?, entry_date=?, entry_type='BORN_ON_FARM',
                 source_batch_id=?, item_id=?, current_batch_id=?,
                 current_location_id=?, sire_serial_no=?, dam_serial_no=?,
                 productive_life_start=?, no_of_teats=?, is_active=1,
                 status='ACTIVE', updated_at=NOW(), updated_by=NULL
               WHERE animal_id=?`,
              [
                scope.company_id,
                scope.nob_id,
                scope.lob_id,
                breed.breed_id,
                animalType,
                dob,
                productiveStart,
                sourceBatchId,
                animalItem.item_id,
                sourceBatchId,
                farmId,
                sireSerial,
                damSerial,
                productiveStart,
                teats === null ? null : Math.trunc(teats),
                existing[0].animal_id,
              ],
            );
          }
          if (isGilt) giltsUpdated++;
          else sowsUpdated++;
        } else if (write) {
          await db.query(
            `INSERT INTO animal_register
               (animal_id, tenant_id, company_id, nob_id, lob_id, animal_code,
                animal_type, breed_id, gender, dob, entry_type, entry_date,
                source_batch_id, item_id, sire_serial_no, dam_serial_no,
                acquisition_cost, total_opening_asset_value,
                current_batch_id, current_location_id,
                productive_life_start, no_of_teats, parity_count,
                total_piglets_born_live, total_piglets_weaned, status,
                is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              randomUUID(),
              scope.tenant_id,
              scope.company_id,
              scope.nob_id,
              scope.lob_id,
              code,
              animalType,
              breed.breed_id,
              'F',
              dob,
              'BORN_ON_FARM',
              productiveStart || dob || new Date().toISOString().slice(0, 10),
              sourceBatchId,
              animalItem.item_id,
              sireSerial,
              damSerial,
              0,
              0,
              sourceBatchId,
              farmId,
              productiveStart,
              teats === null ? null : Math.trunc(teats),
              0,
              0,
              0,
              'ACTIVE',
              1,
            ],
          );
          if (isGilt) giltsInserted++;
          else sowsInserted++;
        }
      }
    };

    for (const { farmCode, path } of SOW_WORKBOOKS) await importSows(path, farmCode);

    plan.sows = {
      inserted: sowsInserted,
      updated: sowsUpdated,
      entryType: 'BORN_ON_FARM',
      itemCode: 'BIO-SWINE-SOW',
      itemName: 'Mature Parity Breeding Sow',
      blocker: sowItem ? null : 'BIO-SWINE-SOW item master row could not be validated',
      gilts: {
        inserted: giltsInserted,
        updated: giltsUpdated,
        itemCode: 'BIO-SWINE-GILT',
      },
    };

    // ---- Boars ---------------------------------------------------------------
    // Boars are not assigned to a single farm (AI semen typically serves
    // several); they land on the first configured farm and source batch.
    const anyFarmCode = SOW_WORKBOOKS[0]?.farmCode;
    const anyFarmId = anyFarmCode ? farmIdByCode.get(anyFarmCode) ?? null : null;
    const anySourceBatchId = anyFarmCode ? sourceBatches.get(anyFarmCode) ?? null : null;
    if (BOAR_WORKBOOK) {
      for (const row of boarRows(BOAR_WORKBOOK)) {
        const code = String(row['Boar'] ?? '').trim();
        if (!code || code.startsWith('#')) continue;
        if (!boarItem) continue;
        const dob = dateValue(row['DoB']);
        const tsi = num(row['TSI']);
        const [existing] = await db.query<mysql.RowDataPacket[]>(
          'SELECT animal_id FROM animal_register WHERE tenant_id=? AND animal_code=? LIMIT 1',
          [scope.tenant_id, code],
        );
        if (existing.length) {
          if (write) {
            await db.query(
              `UPDATE animal_register SET company_id=?, nob_id=?, lob_id=?, breed_id=?,
                 dob=?, entry_type='BORN_ON_FARM',
                 source_batch_id=?, item_id=?, current_batch_id=?,
                 tsi=?, current_location_id=?, is_active=1, status='ACTIVE', updated_at=NOW()
               WHERE animal_id=?`,
              [
                scope.company_id,
                scope.nob_id,
                scope.lob_id,
                breed.breed_id,
                dob,
                anySourceBatchId,
                boarItem.item_id,
                anySourceBatchId,
                tsi,
                anyFarmId,
                existing[0].animal_id,
              ],
            );
          }
          boarsUpdated++;
        } else if (write) {
          await db.query(
            `INSERT INTO animal_register
               (animal_id, tenant_id, company_id, nob_id, lob_id, animal_code,
                animal_type, breed_id, gender, dob, entry_type, entry_date,
                source_batch_id, item_id, acquisition_cost, total_opening_asset_value,
                current_batch_id, current_location_id, tsi, parity_count,
                total_piglets_born_live, total_piglets_weaned, status,
                is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              randomUUID(),
              scope.tenant_id,
              scope.company_id,
              scope.nob_id,
              scope.lob_id,
              code,
              'BOAR',
              breed.breed_id,
              'M',
              dob,
              'BORN_ON_FARM',
              dob || new Date().toISOString().slice(0, 10),
              anySourceBatchId,
              boarItem.item_id,
              0,
              0,
              anySourceBatchId,
              anyFarmId,
              tsi,
              0,
              0,
              0,
              'ACTIVE',
              1,
            ],
          );
          boarsInserted++;
        }
      }
    }
    plan.boars = {
      inserted: boarsInserted,
      updated: boarsUpdated,
      entryType: 'BORN_ON_FARM',
      itemCode: 'BIO-SWINE-BOAR',
      itemName: 'Mature Herd Sire Boar',
      blocker: boarItem ? null : 'BIO-SWINE-BOAR item master row could not be validated',
      skipped: BOAR_WORKBOOK ? null : 'BOAR_WORKBOOK not set',
    };

    // ---- Breeding cycles, matings, farrowings and weaning --------------------
    let breedingInserted = 0;
    let breedingUpdated = 0;
    let farrowingInserted = 0;
    let farrowingUpdated = 0;
    let pigletDeathRowsSeen = 0;
    let sowIndicatorsSeen = 0;

    for (const { farmCode, path } of SOW_WORKBOOKS) {
      const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
      const cyclesSheet = wb.Sheets.Cycles;
      const deathsSheet = wb.Sheets['Piglet Deaths'];
      const indicatorsSheet =
        wb.Sheets['Sow Indicators'] || wb.Sheets['Sow Indicators '] || null;
      if (!cyclesSheet) continue;
      const deathNotes = new Map<string, string[]>();
      if (deathsSheet) {
        const deathRows = XLSX.utils.sheet_to_json<Array<unknown>>(deathsSheet, {
          header: 1,
          defval: null,
          range: 1,
        });
        pigletDeathRowsSeen += deathRows.length;
        for (const death of deathRows) {
          const sowCode = String(death[0] ?? '').trim();
          const cycleNo = String(death[1] ?? '').trim();
          if (!sowCode || !cycleNo) continue;
          const key = `${sowCode}|${cycleNo}`;
          const reason = String(death[2] ?? 'UNSPECIFIED').trim();
          const piglets = num(death[3]);
          const ageDays = num(death[4]);
          const note =
            `Piglet death: ${reason}; Count=${piglets === null ? 'unknown' : Math.trunc(piglets)}; Age=${ageDays === null ? 'unknown' : Math.trunc(ageDays)} day(s)`;
          deathNotes.set(key, [...(deathNotes.get(key) || []), note]);
        }
      }
      if (indicatorsSheet) {
        const indicatorRows = XLSX.utils.sheet_to_json<Array<unknown>>(indicatorsSheet, {
          header: 1,
          defval: null,
          range: 1,
        });
        sowIndicatorsSeen += indicatorRows.length;
        for (const indicator of indicatorRows) {
          const sowCode = String(indicator[0] ?? '').trim();
          if (!sowCode) continue;
          const [animal] = await db.query<mysql.RowDataPacket[]>(
            'SELECT animal_id FROM animal_register WHERE tenant_id=? AND animal_code=? LIMIT 1',
            [scope.tenant_id, sowCode],
          );
          if (!animal.length || !write) continue;
          const fields = [
            ['AgeFirstMatingDays', indicator[1]],
            ['AvgWeanToFirstMatingDays', indicator[2]],
            ['AvgPregnancyDays', indicator[3]],
            ['CycleIndex', indicator[4]],
            ['BAperYear', indicator[6]],
            ['WeanedPerYear', indicator[8]],
            ['ProductionIndex', indicator[10]],
            ['TSI', indicator[12]],
            ['MotheringAbility', indicator[13]],
            ['EBVTeats', indicator[14]],
            ['EBVStillborn', indicator[15]],
            ['EBVLongevity', indicator[16]],
            ['EBVLitterSize', indicator[17]],
            ['EBVBackfat', indicator[18]],
            ['EBVLoinDepth', indicator[19]],
            ['EBVVitality', indicator[20]],
            ['EBVTDG', indicator[21]],
          ]
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
          await db.query(
            `UPDATE animal_register SET
               notes=?,
               updated_at=NOW()
             WHERE animal_id=?`,
            [
              `Workbook sow indicators: ${fields}`,
              animal[0].animal_id,
            ],
          );
        }
      }
      const cycleRows = XLSX.utils.sheet_to_json<Array<unknown>>(cyclesSheet, {
        header: 1,
        defval: null,
        range: 1,
      });
      const sourceBatchId = sourceBatches.get(farmCode) || null;

      for (const cycle of cycleRows) {
        const sowCode = String(cycle[0] ?? '').trim();
        const cycleNo = num(cycle[1]);
        const matingDate = dateValue(cycle[3]);
        if (!sowCode || !matingDate || !cycleNo) continue;
        const [sow] = await db.query<mysql.RowDataPacket[]>(
          'SELECT animal_id,parity_count FROM animal_register WHERE tenant_id=? AND animal_code=? LIMIT 1',
          [scope.tenant_id, sowCode],
        );
        if (!sow.length) continue;

        const farrowingDate = dateValue(cycle[8]);
        const expectedDate =
          dateValue(cycle[24]) || (farrowingDate ? farrowingDate : addDays(matingDate, 115));
        const gestationLength = num(cycle[29]);
        const pregCheckDate =
          farrowingDate && gestationLength !== null
            ? addDays(farrowingDate, -Math.trunc(gestationLength))
            : null;
        const pregnancyConfirmed =
          farrowingDate != null || !String(cycle[27] ?? '').includes('Abortion');
        const [existingBreeding] = await db.query<mysql.RowDataPacket[]>(
          `SELECT breeding_id FROM breeding_record
           WHERE tenant_id=? AND sow_animal_id=? AND mating_date=? LIMIT 1`,
          [scope.tenant_id, sow[0].animal_id, matingDate],
        );
        const breedingId =
          (existingBreeding[0]?.breeding_id as string | undefined) ||
          randomUUID();

        if (existingBreeding.length) {
          if (write) {
            await db.query(
              `UPDATE breeding_record SET batch_id=?, mating_type='AI',
                 second_mating_date=?, expected_farrowing_date=?,
                 preg_check_date=?, preg_check_method='ULTRASOUND',
                 pregnancy_confirmed=?, conception_result=?,
                 parity_number=?, notes=?, updated_at=NOW()
               WHERE breeding_id=?`,
              [
                sourceBatchId,
                null,
                expectedDate,
                pregCheckDate,
                pregnancyConfirmed ? 1 : 0,
                pregnancyConfirmed ? 'CONFIRMED' : 'PENDING',
                Math.trunc(cycleNo),
                `Workbook cycle ${Math.trunc(cycleNo)}; Boar 1=${String(cycle[4] ?? '') || 'N/A'}; Boar 2=${String(cycle[6] ?? '') || 'N/A'}`,
                breedingId,
              ],
            );
          }
          breedingUpdated++;
        } else if (write) {
          await db.query(
            `INSERT INTO breeding_record
               (breeding_id, tenant_id, company_id, sow_animal_id, batch_id,
                mating_type, mating_date, second_mating_date,
                expected_farrowing_date, preg_check_date, preg_check_method,
                pregnancy_confirmed, conception_result, parity_number,
                semen_dose_qty, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'AI', ?, NULL, ?, NULL, 'ULTRASOUND',
                     ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              breedingId,
              scope.tenant_id,
              scope.company_id,
              sow[0].animal_id,
              sourceBatchId,
              matingDate,
              expectedDate,
              pregnancyConfirmed ? 1 : 0,
              pregnancyConfirmed ? 'CONFIRMED' : 'PENDING',
              Math.trunc(cycleNo),
              `Workbook cycle ${Math.trunc(cycleNo)}; Boar 1=${String(cycle[4] ?? '') || 'N/A'}; Boar 2=${String(cycle[6] ?? '') || 'N/A'}`,
            ],
          );
          breedingInserted++;
        }

        if (!farrowingDate) continue;
        const bornTotal = num(cycle[9]);
        const bornLive = num(cycle[10]);
        const stillborn = num(cycle[11]);
        const mummified = num(cycle[12]);
        const weaningDate = dateValue(cycle[15]);
        const pigletsWeaned = num(cycle[16]);
        const avgWeanWeight = num(cycle[20]);
        const farrowingNote =
          `Workbook cycle ${Math.trunc(cycleNo)}${
            deathNotes.get(`${sowCode}|${Math.trunc(cycleNo)}`)?.length
              ? `\n${deathNotes.get(`${sowCode}|${Math.trunc(cycleNo)}`)!.join('\n')}`
              : ''
          }`;

        const [existingFarrowing] = await db.query<mysql.RowDataPacket[]>(
          `SELECT farrow_id FROM farrowing_record
           WHERE tenant_id=? AND sow_animal_id=? AND farrowing_date=? LIMIT 1`,
          [scope.tenant_id, sow[0].animal_id, farrowingDate],
        );
        const farrowId =
          (existingFarrowing[0]?.farrow_id as string | undefined) ||
          randomUUID();
        if (existingFarrowing.length) {
          if (write) {
            await db.query(
              `UPDATE farrowing_record SET breeding_id=?, batch_id=?,
                 piglets_born_total=?, piglets_born_live=?,
                 piglets_stillborn=?, piglets_mummified=?,
                 weaning_date=?, piglets_weaned=?,
                 avg_weaning_weight_kg=?, parity_number=?,
                 notes=?, updated_at=NOW()
               WHERE farrow_id=?`,
              [
                breedingId,
                sourceBatchId,
                bornTotal === null ? (bornLive ?? 0) + (stillborn ?? 0) + (mummified ?? 0) : Math.trunc(bornTotal),
                bornLive === null ? 0 : Math.trunc(bornLive),
                stillborn === null ? 0 : Math.trunc(stillborn),
                mummified === null ? 0 : Math.trunc(mummified),
                weaningDate,
                pigletsWeaned === null ? 0 : Math.trunc(pigletsWeaned),
                avgWeanWeight,
                Math.trunc(cycleNo),
                farrowingNote,
                farrowId,
              ],
            );
          }
          farrowingUpdated++;
        } else if (write) {
          await db.query(
            `INSERT INTO farrowing_record
               (farrow_id, tenant_id, company_id, sow_animal_id, breeding_id,
                batch_id, farrowing_date, piglets_born_total,
                piglets_born_live, piglets_stillborn, piglets_mummified,
                weaning_date, piglets_weaned, avg_weaning_weight_kg,
                parity_number, farrowing_status, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NORMAL', ?, NOW(), NOW())`,
            [
              farrowId,
              scope.tenant_id,
              scope.company_id,
              sow[0].animal_id,
              breedingId,
              sourceBatchId,
              farrowingDate,
              bornTotal === null ? (bornLive ?? 0) + (stillborn ?? 0) + (mummified ?? 0) : Math.trunc(bornTotal),
              bornLive === null ? 0 : Math.trunc(bornLive),
              stillborn === null ? 0 : Math.trunc(stillborn),
              mummified === null ? 0 : Math.trunc(mummified),
              weaningDate,
              pigletsWeaned === null ? 0 : Math.trunc(pigletsWeaned),
              avgWeanWeight,
              Math.trunc(cycleNo),
              farrowingNote,
            ],
          );
          farrowingInserted++;
        }
      }
    }

    plan.breedingRecords = {
      inserted: breedingInserted,
      updated: breedingUpdated,
      matingType: 'AI',
      source: 'Cycles + Matings sheets of each configured sow workbook',
    };
    plan.farrowingRecords = {
      inserted: farrowingInserted,
      updated: farrowingUpdated,
      source: 'Cycles sheet of each configured sow workbook',
    };
    plan.pigletDeathRowsSeen = pigletDeathRowsSeen;
    plan.sowIndicatorRowsSeen = sowIndicatorsSeen;

    console.log(JSON.stringify(plan, null, 2));
    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(
        verify
          ? 'Verified and rolled back. No changes committed.'
          : 'Read-only. No changes attempted.',
      );
    }
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

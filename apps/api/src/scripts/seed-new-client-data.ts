/**
 * Imports the 20 Nov 2026 CCC showcase workbooks into nf_cccshow only.
 *
 * Default: read-only plan.
 * --verify: run the writes in a transaction and roll them back.
 * --apply: commit the writes.
 *
 *   pnpm nx run api:db-seed-new-client-data
 *   pnpm nx run api:db-seed-new-client-data -- --verify
 *   pnpm nx run api:db-seed-new-client-data -- --apply
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import * as mysql from 'mysql2/promise';
import * as XLSX from 'xlsx';

const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
const TENANT_CODE = process.env.SHOWCASE_TENANT_CODE || 'cccshow';
const workbookPath = (value: string) => {
  const candidates = [
    resolve(process.cwd(), value),
    resolve(process.cwd(), '../..', value),
  ];
  const found = candidates.find((path) => fs.existsSync(path));
  if (!found)
    throw new Error(`Workbook not found: ${value}`);
  return found;
};
const LOCATION_FILE = workbookPath(
  process.env.NEW_LOCATION_WORKBOOK ||
    'scripts/new data to seed/PORTA Location Master Template11Nov2026..xlsx',
);
const PORTA_SOW_FILE = workbookPath(
  process.env.NEW_PORTA_SOW_WORKBOOK ||
    'scripts/new data to seed/Fw__UPDATED_FILES_FOR_YOUR_ACTION/PORTA PRESENT SOWS19112026 - UPDATED.xlsx',
);
const MULTIPLIER_1_SOW_FILE = workbookPath(
  process.env.NEW_MULTIPLIER_1_WORKBOOK ||
    'scripts/new data to seed/Fw__UPDATED_FILES_FOR_YOUR_ACTION/MULTIPLIER_1 PRESENT SOWS19112026-UPDATED INSEMINATED.xlsx',
);
const MULTIPLIER_2_SOW_FILE = workbookPath(
  process.env.NEW_MULTIPLIER_2_WORKBOOK ||
    'scripts/new data to seed/Fw__UPDATED_FILES_FOR_YOUR_ACTION/MULTIPLIER_2 PRESENT SOWS19112026-UPDATED NOT INSEMINATED.xlsx',
);
const BOAR_FILE = workbookPath(
  process.env.NEW_BOAR_WORKBOOK ||
    'scripts/new data to seed/Fw__UPDATED_FILES_FOR_YOUR_ACTION/BOARS.xlsx',
);

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

function workbookRows(path: string, sheetName: string): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Workbook ${path} has no sheet ${sheetName}.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    range: 5,
  });
}

function sowRows(path: string): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(path, { type: 'file', cellDates: true });
  const ws = wb.Sheets.Sows;
  if (!ws) throw new Error(`Workbook ${path} has no Sows sheet.`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
  });
}

function boarRows(): Array<Record<string, unknown>> {
  const wb = XLSX.readFile(BOAR_FILE, { type: 'file', cellDates: true });
  const ws = wb.Sheets.Sheet1;
  if (!ws) throw new Error(`Workbook ${BOAR_FILE} has no Sheet1 sheet.`);
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

    // ---- Location Master -------------------------------------------------
    const wb = XLSX.readFile(LOCATION_FILE, { type: 'file', cellDates: true });
    const ws = wb.Sheets['Location Master Template'];
    if (!ws)
      throw new Error(
        `Workbook ${LOCATION_FILE} has no Location Master Template sheet.`,
      );
    const locationRows = XLSX.utils.sheet_to_json<Array<unknown>>(ws, {
      header: 1,
      defval: null,
      range: 5,
    });

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
    let lastFarmId: string | null = null;
    let lastShedId: string | null = null;
    const idByCode = new Map<string, string>();
    let locationsInserted = 0;
    let locationsUpdated = 0;

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
      idByCode.set(code, id);

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
    plan.locations = {
      workbookRows: locationRows.filter((r) => r[2]).length,
      inserted: locationsInserted,
      updated: locationsUpdated,
      retainedExistingCodes: true,
    };

    // ---- Silo <-> Shed links -----------------------------------------------
    // Neither workbook encodes a clean, unambiguous silo-to-shed mapping (the
    // "Storage Location"/"Storage Name" columns are inconsistent: e.g. every
    // Porta dry-sow shed lists the same literal silo name, and the Multiplier
    // workbook was never imported as locations at all). Pairs below are taken
    // from the working `nf_ccc` ("Triple C") tenant's own silo_shed_link table,
    // which uses the same standardised silo code set, as the ground truth for
    // which silo feeds which shed. Porta's 11 Nov workbook import also created
    // a second, differently-coded set of shed rows for sheds that already
    // existed under an older code (e.g. PGH1 alongside PGH 01... / PWH1
    // alongside PWH01): both code variants are linked so either one works.
    // Dry-sow/double-stock/farrowing groups with no confident match in the
    // reference tenant (Multiplier dry sow and double stock) are left
    // unlinked rather than guessed.
    const siloShedPairs: Array<[string, string]> = [
      // Porta grower: 1:1
      ...Array.from({ length: 10 }, (_, i) => [`PG${i + 1}`, `PGH${i + 1}`] as [string, string]),
      // Porta weaner: one silo feeds all weaner houses (both code variants)
      ...['PWH1', 'PWH2', 'PWH3', 'PWH4', 'PWH5', 'PWH6', 'PWH01', 'PWH02', 'PWH03', 'PWH04', 'PWH05', 'PWH06']
        .map((shed) => ['PW-1', shed] as [string, string]),
      // Porta double stock: one silo feeds all double-stock sheds (both code variants)
      ...['PGDST-1', 'PGDST-2', 'PGDST-3', 'PGDST-4', 'PDST01', 'PDST02', 'PDST03', 'PDST04']
        .map((shed) => ['PDST -1', shed] as [string, string]),
      // Porta service line
      ['PSL FS - 01', 'PSL'],
      // Porta dry sow (both code variants; PD2/PDS-02 have no confident match)
      ['PDGD-01', 'PD1'], ['PDGD-01', 'PDS1'],
      ['PDSD-01', 'PD1'], ['PDSD-01', 'PDS1'],
      ['PDSD-03', 'PD3'], ['PDSD-03', 'PDS3'],
      ['PDSD-04', 'PD4'], ['PDSD-04', 'PDS4'],
      ['PDSD-05', 'PD5'], ['PDSD-05', 'PDS5'],
      ['PDSD-06', 'PD6'], ['PDSD-06', 'PDS6'],
      // Porta farrowing: lactation + transition silo per house pair (both code variants)
      ['PFHLG - 1&2', 'PFH1'], ['PFHLG - 1&2', 'PFH2'], ['PFHLG - 1&2', 'PDFH1'], ['PFHLG - 1&2', 'PDFH2'],
      ['PFHLG - 3 & 4', 'PFH3'], ['PFHLG - 3 & 4', 'PFH4'], ['PFHLG - 3 & 4', 'PDFH3'], ['PFHLG - 3 & 4', 'PDFH4'],
      ['PFHLG - 5', 'PFH5'], ['PFHLG - 5', 'PDFH5'],
      ['PFHTRANS - 1&2', 'PFH1'], ['PFHTRANS - 1&2', 'PFH2'], ['PFHTRANS - 1&2', 'PDFH1'], ['PFHTRANS - 1&2', 'PDFH2'],
      ['PFHTRANS - 3 & 4', 'PFH3'], ['PFHTRANS - 3 & 4', 'PFH4'], ['PFHTRANS - 3 & 4', 'PDFH3'], ['PFHTRANS - 3 & 4', 'PDFH4'],
      ['PFHTRANS - 5', 'PFH5'], ['PFHTRANS - 5', 'PDFH5'],
      // Multiplier grower: 1:1
      ...Array.from({ length: 10 }, (_, i) => [`MGH${i + 1}`, `MUGR${i + 1}`] as [string, string]),
      // Multiplier weaner: 1:1
      ...Array.from({ length: 6 }, (_, i) => [`MWH${i + 1}`, `MUWN${i + 1}`] as [string, string]),
      // Multiplier service line
      ['MSL1', 'MU1'],
      // Multiplier farrowing: two silos feed all three farrowing houses
      ...['MUFHE1', 'MUFHE2', 'MUFHE3'].flatMap((shed) => [
        ['MFH TRANS - 1', shed] as [string, string],
        ['MFHLZ - 1 & 2', shed] as [string, string],
      ]),
      // Multiplier double stock: 1:1, with the 3rd silo also covering the 4th shed (one more shed than silo)
      ['MDST1', 'MUDST1P1'], ['MDST2', 'MUDST2P1'], ['MDST3', 'MUDST3P1'], ['MDST3', 'MUDST4P1'],
    ];

    const [allLocations] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code, location_type, company_id FROM location_master WHERE tenant_id = ?`,
      [scope.tenant_id],
    );
    const locationByCode = new Map(allLocations.map((r) => [r.location_code as string, r]));
    const [existingLinks] = await db.query<mysql.RowDataPacket[]>(
      `SELECT silo_id, shed_id FROM silo_shed_link WHERE tenant_id = ?`,
      [scope.tenant_id],
    );
    const existingLinkKeys = new Set(existingLinks.map((r) => `${r.silo_id}|${r.shed_id}`));
    let siloShedLinksInserted = 0;
    let siloShedLinksSkippedExisting = 0;
    const siloShedUnresolved: string[] = [];

    for (const [siloCode, shedCode] of siloShedPairs) {
      const silo = locationByCode.get(siloCode);
      const shed = locationByCode.get(shedCode);
      if (!silo || silo.location_type !== 'SILO' || !shed || shed.location_type !== 'SHED') {
        siloShedUnresolved.push(`${siloCode} -> ${shedCode}`);
        continue;
      }
      const key = `${silo.location_id}|${shed.location_id}`;
      if (existingLinkKeys.has(key)) {
        siloShedLinksSkippedExisting++;
        continue;
      }
      existingLinkKeys.add(key);
      if (write) {
        await db.query(
          `INSERT INTO silo_shed_link (link_id, tenant_id, company_id, silo_id, shed_id, created_at)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), scope.tenant_id, shed.company_id ?? scope.company_id, silo.location_id, shed.location_id],
        );
      }
      siloShedLinksInserted++;
    }
    plan.siloShedLinks = {
      pairsDefined: siloShedPairs.length,
      inserted: siloShedLinksInserted,
      alreadyLinked: siloShedLinksSkippedExisting,
      unresolved: siloShedUnresolved,
    };

    // ---- Item and breed lookups ------------------------------------------
    // NAVFarm's standard biological Item Master records are BIO-SWINE-SOW and
    // BIO-SWINE-BOAR. TN70 is a breed/line identity, not an item code.
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
    const tn70 =
      breeds.find((r) =>
        String(r.breed_code).toUpperCase().replace(/[^A-Z0-9]/g, '').includes('TN70'),
      ) ||
      breeds.find((r) =>
        String(r.breed_name).toUpperCase().replace(/[^A-Z0-9]/g, '').includes('TN70'),
      );
    if (!tn70)
      throw new Error('Required TN70 breed is missing; seed the breed master first.');

    const [farms] = await db.query<mysql.RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master
       WHERE tenant_id=? AND location_type='FARM' AND is_active=1`,
      [scope.tenant_id],
    );
    const portaFarm =
      farms.find((r) => r.location_code === 'POR100')?.location_id || null;
    const multiplierFarm =
      farms.find((r) => r.location_code === 'MUL100')?.location_id || null;

    const sourceBatches = new Map<string, string>();
    for (const [farmName, farmId] of [
      ['MULTIPLIER', multiplierFarm],
      ['PORTA', portaFarm],
    ] as const) {
      if (!farmId) continue;
      const batchNo = `SHOWCASE-${farmName}-SOURCE`;
      const [existing] = await db.query<mysql.RowDataPacket[]>(
        'SELECT batch_id FROM batch_header WHERE tenant_id=? AND batch_no=? LIMIT 1',
        [scope.tenant_id, batchNo],
      );
      if (existing.length) {
        sourceBatches.set(farmName, existing[0].batch_id as string);
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
         VALUES (?, ?, ?, ?, ?, ?, 'BIO_ASSET', ?, ?, '2026-11-20',
                 'ACTIVE', 0, 'HEAD', 'REGISTERED', 'ANIMAL_WISE',
                 0, 'SHOWCASE SYNTHETIC SOURCE BATCH - workbook import; no real purchase traceability', NOW(), NOW())`,
        [
          batchId,
          scope.tenant_id,
          scope.company_id,
          batchNo,
          scope.lob_id,
          scope.nob_id,
          tn70.breed_id,
          farmId,
        ],
      );
      sourceBatches.set(farmName, batchId);
    }

    let sowsInserted = 0;
    let sowsUpdated = 0;
    let giltsInserted = 0;
    let giltsUpdated = 0;
    let boarsInserted = 0;
    let boarsUpdated = 0;

    const importSows = async (
      path: string,
      farmName: 'Porta' | 'Multiplier',
    ) => {
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

      for (const row of sowRows(path)) {
        const code = String(row['Sow ID'] ?? '').trim();
        if (!code) continue;
        const dob = dateValue(row['Date of Birth']);
        const productiveStart =
          dateValue(row['Production Start Date']) || dob;
        const teats = num(row['Teats']);
        const damSerial = String(row['Dam'] ?? '').trim() || null;
        const sireSerial = String(row['Sire'] ?? '').trim() || null;
        const farmId =
          farmName === 'Porta' ? portaFarm : multiplierFarm;
        if (!farmId) {
          if (write)
            throw new Error(`Required ${farmName.toUpperCase()} farm location is missing.`);
          continue;
        }
        if (!sowItem) continue;
        const isGilt = farmName === 'Porta' && !cycleIds.has(code);
        if (isGilt && !giltItem) continue;
        const animalItem = isGilt ? giltItem : sowItem;
        const animalType = isGilt ? 'GILT' : 'SOW';
        const sourceBatchId =
          sourceBatches.get(farmName.toUpperCase()) || null;

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
                tn70.breed_id,
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
              tn70.breed_id,
              'F',
              dob,
              'BORN_ON_FARM',
              productiveStart || dob || '2026-11-20',
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

    await importSows(PORTA_SOW_FILE, 'Porta');
    await importSows(MULTIPLIER_1_SOW_FILE, 'Multiplier');
    await importSows(MULTIPLIER_2_SOW_FILE, 'Multiplier');

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

    // ---- Boars -----------------------------------------------------------
    for (const row of boarRows()) {
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
              tn70.breed_id,
              dob,
              sourceBatches.get('MULTIPLIER') || sourceBatches.get('PORTA') || null,
              boarItem.item_id,
              sourceBatches.get('MULTIPLIER') || sourceBatches.get('PORTA') || null,
              tsi,
              multiplierFarm || portaFarm,
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
            tn70.breed_id,
            'M',
            dob,
            'BORN_ON_FARM',
            dob || '2026-11-20',
            sourceBatches.get('MULTIPLIER') || sourceBatches.get('PORTA') || null,
            boarItem.item_id,
            0,
            0,
            sourceBatches.get('MULTIPLIER') || sourceBatches.get('PORTA') || null,
            multiplierFarm || portaFarm,
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
    plan.boars = {
      inserted: boarsInserted,
      updated: boarsUpdated,
      entryType: 'BORN_ON_FARM',
      itemCode: 'BIO-SWINE-BOAR',
      itemName: 'Mature Herd Sire Boar',
      blocker: boarItem ? null : 'BIO-SWINE-BOAR item master row could not be validated',
    };

    // ---- Breeding cycles, matings, farrowings and weaning ----------------
    let breedingInserted = 0;
    let breedingUpdated = 0;
    let farrowingInserted = 0;
    let farrowingUpdated = 0;
    let pigletDeathRowsSeen = 0;
    let sowIndicatorsSeen = 0;

    const cycleFiles = [
      ['Multiplier', MULTIPLIER_1_SOW_FILE],
      ['Multiplier', MULTIPLIER_2_SOW_FILE],
      ['Porta', PORTA_SOW_FILE],
    ] as const;

    for (const [farmName, path] of cycleFiles) {
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
              `SHOWCASE sow indicators: ${fields}`,
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
      const sourceBatchId =
        sourceBatches.get(farmName.toUpperCase()) || null;

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
                `SHOWCASE workbook cycle ${Math.trunc(cycleNo)}; Boar 1=${String(cycle[4] ?? '') || 'N/A'}; Boar 2=${String(cycle[6] ?? '') || 'N/A'}`,
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
              `SHOWCASE workbook cycle ${Math.trunc(cycleNo)}; Boar 1=${String(cycle[4] ?? '') || 'N/A'}; Boar 2=${String(cycle[6] ?? '') || 'N/A'}`,
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
          `SHOWCASE workbook cycle ${Math.trunc(cycleNo)}${
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
      source: 'updated workbook Cycles + Matings sheets',
    };
    plan.farrowingRecords = {
      inserted: farrowingInserted,
      updated: farrowingUpdated,
      source: 'updated workbook Cycles sheet',
    };
    plan.pigletDeathRowsSeen = pigletDeathRowsSeen;
    plan.sowIndicatorRowsSeen = sowIndicatorsSeen;

    // ---- Porta commercial grower batch -------------------------------------
    // Porta had no weaner/grower/finisher lot at all (only the breeding-stock
    // placeholder batch), so it could never appear on a Slaughter Transfer
    // Order or in the Feed Forecast. Mirrors the existing Multiplier demo
    // batch BATCH-000012 (COUNT_ONLY/BATCH_WISE — this tenant's grower stock
    // is tracked by head count, not individual animal_register rows).
    const PORTA_GROWER_BATCH_NO = 'BATCH-000014';
    const PORTA_GROWER_HEAD_COUNT = 187; // matches the Porta kill sheet's headcount
    const PORTA_GROWER_SHED_CODE = 'PGH1';
    const GROWER_STAGE_ID = '1cf0587c-a1e5-48c5-93f3-0aee7927665c';
    let portaGrowerBatchId: string | null = null;
    const [[existingPortaGrower]] = await db.query<mysql.RowDataPacket[]>(
      'SELECT batch_id FROM batch_header WHERE tenant_id = ? AND batch_no = ? LIMIT 1',
      [scope.tenant_id, PORTA_GROWER_BATCH_NO],
    );
    if (existingPortaGrower) {
      portaGrowerBatchId = existingPortaGrower.batch_id as string;
      plan.portaGrowerBatch = { batchNo: PORTA_GROWER_BATCH_NO, action: 'already-exists', batchId: portaGrowerBatchId };
    } else {
      const [[template]] = await db.query<mysql.RowDataPacket[]>(
        `SELECT * FROM batch_header WHERE tenant_id = ? AND batch_no = 'BATCH-000012' LIMIT 1`,
        [scope.tenant_id],
      );
      const shed = locationByCode.get(PORTA_GROWER_SHED_CODE);
      const growerItemRow = (
        await db.query<mysql.RowDataPacket[]>(
          `SELECT item_id FROM item_master WHERE tenant_id = ? AND item_code = 'BIO-SWINE-GROWER' LIMIT 1`,
          [scope.tenant_id],
        )
      )[0][0];
      if (!template || !shed || shed.location_type !== 'SHED' || !growerItemRow) {
        plan.portaGrowerBatch = {
          batchNo: PORTA_GROWER_BATCH_NO,
          action: 'skipped',
          reason: !template
            ? 'template batch BATCH-000012 not found'
            : !shed
              ? `shed ${PORTA_GROWER_SHED_CODE} not found`
              : 'BIO-SWINE-GROWER item not found',
        };
      } else {
        portaGrowerBatchId = randomUUID();
        const portaFarmRow = locationByCode.get('POR100');
        if (write) {
          await db.query(
            `INSERT INTO batch_header
               (batch_id, tenant_id, company_id, batch_no, lob_id, nob_id, costing_method, breed_id,
                shed_id, location_id, start_date, expected_end_date, status, opening_quantity, uom,
                closing_quantity, current_stage_code, stage_id, operational_area_id, animal_tracking,
                farm_id, tracking_mode, is_litter_lot, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-08-01', '2026-11-15', 'ACTIVE', ?, 'HEAD',
                     ?, ?, ?, ?, ?, ?, ?, 0, NOW(), NOW())`,
            [
              portaGrowerBatchId, scope.tenant_id, portaFarmRow?.company_id ?? scope.company_id, PORTA_GROWER_BATCH_NO,
              template.lob_id, template.nob_id, template.costing_method, template.breed_id, shed.location_id,
              shed.location_id, PORTA_GROWER_HEAD_COUNT, PORTA_GROWER_HEAD_COUNT, template.current_stage_code,
              template.stage_id, template.operational_area_id, template.animal_tracking,
              portaFarmRow?.location_id, template.tracking_mode,
            ],
          );
          await db.query(
            `INSERT INTO batch_bio_asset_state (state_id, batch_id, stage, current_quantity, nca_book_value, updated_at)
             VALUES (?, ?, 'PREMATURE', ?, 0, NOW())`,
            [randomUUID(), portaGrowerBatchId, PORTA_GROWER_HEAD_COUNT],
          );
          await db.query(
            `INSERT INTO batch_input_line (line_id, batch_id, line_no, item_id, quantity, uom, rate)
             VALUES (?, ?, 1, ?, ?, 'HEAD', 0)`,
            [randomUUID(), portaGrowerBatchId, growerItemRow.item_id, PORTA_GROWER_HEAD_COUNT],
          );
        }
        plan.portaGrowerBatch = { batchNo: PORTA_GROWER_BATCH_NO, action: 'insert', batchId: portaGrowerBatchId };
      }
    }

    // ---- Demo batch lifecycle freshness ------------------------------------
    // The Feed Forecast engine computes each batch's day-of-stage from its
    // scheduler_header.effective_from (or batch_header.start_date when no
    // scheduler row exists). Hardcoded past dates age out of the breed
    // lifecycle's feed-rate coverage (a few weeks per stage), so the showcase
    // batches go dateless-looking and the Calculation page shows nothing.
    // Re-anchor them relative to "today" every time this script runs, so a
    // reseed on any date still lands inside a covered diet window.
    const todayDate = new Date();
    const daysAgo = (n: number) => {
      const d = new Date(todayDate);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const daysAhead = (n: number) => daysAgo(-n);
    const WEANER_STAGE_ID = 'ac910233-061c-4ec6-a3fa-acf77f21d7ab';
    const DOUBLE_STOCK_STAGE_ID = '0520d561-05ef-4665-a3fc-677b701d2e53';
    const freshness: Array<{ batchId: string; stageId: string; daysAgoCount: number }> = [
      { batchId: '24363faf-345a-44bd-aa35-8b56b2ce5028', stageId: WEANER_STAGE_ID, daysAgoCount: 19 }, // BATCH-000009
      { batchId: 'c36576c6-ba9d-4ecd-8266-31584a3a5256', stageId: WEANER_STAGE_ID, daysAgoCount: 15 }, // BATCH-000011
      { batchId: '6dc992db-8177-42a9-ae06-1b2f739965a6', stageId: GROWER_STAGE_ID, daysAgoCount: 19 }, // BATCH-000012
      { batchId: 'f3052ec9-4d71-477c-9afb-6dd47bfeb778', stageId: DOUBLE_STOCK_STAGE_ID, daysAgoCount: 5 }, // BATCH-000010
    ];
    if (portaGrowerBatchId) freshness.push({ batchId: portaGrowerBatchId, stageId: GROWER_STAGE_ID, daysAgoCount: 19 });
    let freshnessUpdated = 0;
    let freshnessCreated = 0;
    for (const f of freshness) {
      const effectiveFrom = daysAgo(f.daysAgoCount);
      const [[scheduler]] = await db.query<mysql.RowDataPacket[]>(
        'SELECT scheduler_id FROM scheduler_header WHERE batch_id = ? AND stage_id = ? LIMIT 1',
        [f.batchId, f.stageId],
      );
      if (scheduler) {
        if (write) {
          await db.query(
            'UPDATE scheduler_header SET effective_from = ?, updated_at = NOW() WHERE scheduler_id = ?',
            [effectiveFrom, scheduler.scheduler_id],
          );
        }
        freshnessUpdated++;
      } else if (f.batchId === portaGrowerBatchId) {
        const [[batch]] = await db.query<mysql.RowDataPacket[]>(
          'SELECT batch_id, company_id, lob_id, nob_id, breed_id, shed_id, operational_area_id FROM batch_header WHERE batch_id = ?',
          [f.batchId],
        );
        const [[headCount]] = await db.query<mysql.RowDataPacket[]>(
          'SELECT current_quantity FROM batch_bio_asset_state WHERE batch_id = ?',
          [f.batchId],
        );
        if (batch && write) {
          await db.query(
            `INSERT INTO scheduler_header
               (scheduler_id, tenant_id, company_id, batch_id, stage_id, breed_id, lob_id, nob_id, location_id,
                data_entry_level, scheduler_status, effective_from, effective_to, animal_count, auto_generated,
                created_by, created_at, updated_at, scheduler_no)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SHED', 'ACTIVE', ?, ?, ?, 1, NULL, NOW(), NOW(), ?)`,
            [
              randomUUID(), scope.tenant_id, batch.company_id, batch.batch_id, f.stageId, batch.breed_id,
              batch.lob_id, batch.nob_id, batch.shed_id, effectiveFrom, daysAhead(75),
              headCount?.current_quantity ?? PORTA_GROWER_HEAD_COUNT, `SCH-SHOWCASE-${PORTA_GROWER_BATCH_NO}`,
            ],
          );
        }
        freshnessCreated++;
      }
    }
    plan.batchLifecycleFreshness = { batchesUpdated: freshnessUpdated, batchesCreated: freshnessCreated };

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

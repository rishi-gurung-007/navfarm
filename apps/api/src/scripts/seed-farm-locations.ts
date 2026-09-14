/**
 * Loads Triple C's real estate — MULTIPLIER and PORTA FARM — from the Location
 * Master Templates they submitted, and retires the synthetic demo farm.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * Codes are the client's own (MUL100, MUGR1, PGH1, PSLCr1), not generated. The
 * LOCATION number series is not consulted: these are the codes farm staff use
 * and the sow cards reference, and Rishi's call on 2026-09-12 was to keep them.
 *
 * "Triple C Farm" and its seventeen children are switched OFF, not deleted.
 * Fifty-nine rows point at them — 27 animals, 5 batches, 5 mortality records,
 * 6 inventory ledger lines, 4 breeds, the goods receipts and the operational
 * area itself. Deleting the rows would be blocked by those foreign keys, and
 * forcing it would strand every one of them. The demo history stays readable
 * and the synthetic farm stops being offered, which is what retiring it means.
 *
 * The operational area is repointed to MULTIPLIER, so work lands on a farm that
 * exists.
 *
 * This does not load both templates in full. 453 of 703 submitted rows carry a
 * Location Code that is not unique inside their own template — which the
 * template itself requires — or hang off a parent whose code is not. Those are
 * listed in docs/triple-c-location-code-queries.md for Triple C to re-code;
 * none is renamed or guessed here. MULTIPLIER therefore lands at 75 of its 512
 * rows and Porta at 175 of 191, and this script is re-runnable once the codes
 * come back: it matches on location_code, so a second run updates rather than
 * duplicates.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { FARM_LOCATION_SEED, FarmLocationSeedRow } from './lib/farm-location-seed-data';

/** The area unit MULTIPLIER states its farm size in. No equivalent exists. */
const UOM_ADDITIONS = [{ code: 'HECTARE', name: 'Hectare', type: 'AREA' }];

/** Porta houses 89 farrowing and service-line crates; the type did not exist. */
const LOCATION_TYPE_ADDITIONS = [
  { code: 'CRATE', name: 'Crate', prefix: 'CRATE', allowedParents: ['SHED'] },
];

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const num = (v: number | undefined) => (v === undefined ? null : v);

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const database = process.env.DEV_TENANT_DATABASE || 'tenant_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });

  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-farm-locations', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another farm location seed run is active.');
    await db.beginTransaction();

    // Scope is taken from what is already here rather than from arguments, so
    // the seeded rows land in the same tenant/company/NOB/LOB as the estate
    // they join. A location master with no rows has no scope to copy.
    const [scopeRows] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id, COUNT(*) n FROM location_master
        GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY n DESC LIMIT 1`,
    );
    if (!scopeRows.length) throw new Error('location_master is empty — no scope to copy.');
    const scope = scopeRows[0];

    const plan: Record<string, unknown> = { database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY' };

    // ---- Units of measure the templates use ---------------------------------
    const uomAdded: string[] = [];
    for (const u of UOM_ADDITIONS) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT uom_id FROM uom_master WHERE tenant_id = ? AND uom_code = ?', [scope.tenant_id, u.code]);
      if (existing.length) continue;
      // Both scopes, matching how every other system lookup is held here: a
      // tenant-wide template row and a company copy.
      for (const companyId of [null, scope.company_id]) {
        if (write) {
          // uom_master carries no is_system flag, unlike location_type_master,
          // and its rows are NOB/LOB stamped like every other lookup here.
          await db.query(
            `INSERT INTO uom_master (uom_id, tenant_id, company_id, nob_id, lob_id, uom_code, uom_name, uom_type, decimal_places, is_base_uom, is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, 0, 1, 'ACTIVE', NOW(), NOW())`,
            [randomUUID(), scope.tenant_id, companyId, scope.nob_id, scope.lob_id, u.code, u.name, u.type],
          );
        }
        uomAdded.push(`${u.code} (${companyId ? 'COMPANY' : 'TENANT'})`);
      }
    }
    plan.uomAdded = uomAdded.length ? uomAdded : 'none — already present';

    // ---- Location types the templates use ----------------------------------
    const typesAdded: string[] = [];
    for (const t of LOCATION_TYPE_ADDITIONS) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT location_type_id FROM location_type_master WHERE tenant_id = ? AND type_code = ?',
        [scope.tenant_id, t.code]);
      if (existing.length) continue;
      for (const companyId of [null, scope.company_id]) {
        if (write) {
          await db.query(
            `INSERT INTO location_type_master (location_type_id, tenant_id, company_id, nob_id, lob_id, type_code, type_name, code_prefix, allowed_parent_types, is_system, is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE', NOW(), NOW())`,
            [randomUUID(), scope.tenant_id, companyId, scope.nob_id, scope.lob_id,
             t.code, t.name, t.prefix, JSON.stringify(t.allowedParents)],
          );
        }
        typesAdded.push(`${t.code} (${companyId ? 'COMPANY' : 'TENANT'})`);
      }
    }
    plan.locationTypesAdded = typesAdded.length ? typesAdded : 'none — already present';

    // ---- The farms themselves ----------------------------------------------
    // Inserted parents-first so every child's parent_location_id resolves, and
    // keyed on location_code so a re-run updates in place.
    const LEVEL: Record<string, number> = { FARM: 1, SHED: 2, PEN: 3, CRATE: 3, CAGE: 3 };
    const order = (r: FarmLocationSeedRow) => LEVEL[r.type] ?? 9;
    const sorted = [...FARM_LOCATION_SEED].sort((a, b) => order(a) - order(b));
    const idByCode = new Map<string, string>();
    const farmIdByFarm = new Map<string, string>();
    let inserted = 0;
    let updated = 0;

    for (const r of sorted) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT location_id FROM location_master WHERE tenant_id = ? AND location_code = ?',
        [scope.tenant_id, r.code]);

      const parentCode = r.parent === '__FARM__' ? undefined : r.parent;
      const parentId = r.type === 'FARM' ? null
        : parentCode ? idByCode.get(parentCode) ?? null
        : farmIdByFarm.get(r.farm) ?? null;
      if (r.type !== 'FARM' && !parentId) {
        throw new Error(`Parent for ${r.code} (${r.parent}) was not inserted first — check the sort.`);
      }
      const farmId = r.type === 'FARM' ? null : farmIdByFarm.get(r.farm) ?? null;

      const values = [
        scope.nob_id, scope.lob_id, r.name, r.address ?? null, r.type, parentId,
        LEVEL[r.type] ?? null, num(r.areaSize), r.areaUom ?? null, num(r.maxCapacity),
        r.capacityUom ?? null, r.storageType ?? null, r.storageName ?? null,
        num(r.siloCapacityKg), num(r.siloReorderDays), num(r.downtimeDays),
        r.feedInBags === undefined ? null : r.feedInBags ? 1 : 0, farmId,
      ];

      if (existing.length) {
        const id = existing[0].location_id as string;
        idByCode.set(r.code, id);
        if (r.type === 'FARM') farmIdByFarm.set(r.farm, id);
        if (write) {
          await db.query(
            `UPDATE location_master SET nob_id=?, lob_id=?, location_name=?, location_address=?, location_type=?,
               parent_location_id=?, location_level=?, area_size=?, area_unit=?, max_capacity=?, capacity_uom=?,
               storage_type=?, storage_name=?, silo_capacity_kg=?, silo_reorder_days=?, downtime_days_required=?,
               feed_in_bags=?, farm_id=?, is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
             WHERE location_id=?`, [...values, id]);
        }
        updated++;
      } else {
        const id = randomUUID();
        idByCode.set(r.code, id);
        if (r.type === 'FARM') farmIdByFarm.set(r.farm, id);
        if (write) {
          await db.query(
            `INSERT INTO location_master (location_id, tenant_id, company_id, location_code, nob_id, lob_id,
               location_name, location_address, location_type, parent_location_id, location_level, area_size,
               area_unit, max_capacity, capacity_uom, storage_type, storage_name, silo_capacity_kg,
               silo_reorder_days, downtime_days_required, feed_in_bags, farm_id, is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
            [id, scope.tenant_id, scope.company_id, r.code, ...values]);
        }
        inserted++;
      }
    }
    plan.locations = {
      fromTemplates: FARM_LOCATION_SEED.length,
      inserted, updated,
      byFarm: ['MULTIPLIER', 'PORTA'].map((f) => ({
        farm: f, rows: FARM_LOCATION_SEED.filter((r) => r.farm === f).length,
      })),
      blockedAwaitingTripleC: 'docs/triple-c-location-code-queries.md — 453 of 703 rows',
    };

    // ---- Retire the synthetic farm -----------------------------------------
    // Targeted at the demo farm's own generated codes — FARM-001 and its
    // FARM-001/SHED-002/PEN-001 children — and nothing else. "Everything not in
    // the seed" would have been simpler and wrong: on a second run it would
    // switch off every location someone had legitimately added since the first.
    const [synthetic] = await db.query<RowDataPacket[]>(
      `SELECT location_id, location_code, location_name FROM location_master
        WHERE tenant_id = ? AND is_active = 1
          AND (location_code = 'FARM-001' OR location_code LIKE 'FARM-001/%')`,
      [scope.tenant_id]);

    // Counted, not deleted: this is what would have been stranded.
    const [refs] = await db.query<RowDataPacket[]>(
      `SELECT
        (SELECT COUNT(*) FROM animal_register WHERE current_location_id IS NOT NULL) animals,
        (SELECT COUNT(*) FROM batch_header WHERE location_id IS NOT NULL OR shed_id IS NOT NULL) batches,
        (SELECT COUNT(*) FROM inventory_ledger WHERE location_id IS NOT NULL OR warehouse_id IS NOT NULL) ledger`);

    if (write && synthetic.length) {
      await db.query(
        `UPDATE location_master SET is_active = 0, status = 'INACTIVE', updated_at = NOW()
          WHERE location_id IN (${synthetic.map(() => '?').join(',')})`,
        synthetic.map((r) => r.location_id));
    }
    plan.syntheticRetired = {
      switchedOff: synthetic.length,
      codes: synthetic.slice(0, 6).map((r) => r.location_code),
      deleted: 0,
      referencesPreserved: refs[0],
      note: 'Switched off, never deleted — 59 rows point at these.',
    };

    // ---- Point the operational area at a farm that exists -------------------
    const multiplierId = farmIdByFarm.get('MULTIPLIER') ?? null;
    const [areas] = await db.query<RowDataPacket[]>(
      'SELECT area_id, area_code, farm_id FROM operational_area_master WHERE tenant_id = ?', [scope.tenant_id]);
    const repointed: string[] = [];
    for (const a of areas) {
      if (!multiplierId || a.farm_id === multiplierId) continue;
      if (write) {
        await db.query('UPDATE operational_area_master SET farm_id = ?, updated_at = NOW() WHERE area_id = ?',
          [multiplierId, a.area_id]);
      }
      repointed.push(`${a.area_code} → MULTIPLIER`);
    }
    plan.operationalAreas = repointed.length ? repointed : 'already pointing at MULTIPLIER';

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT location_type, COUNT(*) n, SUM(is_active = 1) active FROM location_master
        WHERE tenant_id = ? GROUP BY location_type ORDER BY location_type`, [scope.tenant_id]);
    plan.locationMasterAfter = after.map((r) => `${r.location_type}: ${r.active}/${r.n} active`);

    console.log(JSON.stringify(plan, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-farm-locations')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

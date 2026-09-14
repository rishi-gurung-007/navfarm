/**
 * Loads Triple C's submitted Resource and Breed masters for MULTIPLIER and
 * PORTA FARM, and retires the synthetic demo rows they replace.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * Companion to seed-farm-locations.ts, which must run first: a breed is linked
 * to the farm it belongs to, and that farm is a location.
 *
 * Partial by necessity. 28 of 44 resource rows and 2 of 4 breed rows are
 * missing a value their own template marks mandatory — a Resource Code, a
 * Resource Type, a Breed Code. MULTIPLIER's resource sheet has no codes at all.
 * Every omission is listed in docs/triple-c-location-code-queries.md; nothing
 * is invented here.
 *
 * The synthetic rows are switched OFF, never deleted. 27 animals and 72
 * lifecycle-stage rows point at the demo breeds, and four tables carry a
 * foreign key to resource_master. Deleting would be blocked by those keys, and
 * forcing it would strand the demo history that makes the app demonstrable.
 *
 * Keyed on resource_code / breed_code, so a re-run updates rather than
 * duplicates — this reloads cleanly once Triple C returns the missing values.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { FARM_RESOURCE_SEED, FARM_BREED_SEED } from './lib/farm-master-seed-data';

/**
 * breed_master.breed_type is NOT NULL and neither template supplies it. Every
 * piggery breed already in this database carries MEAT, so the seeded rows match
 * their neighbours rather than introducing a value on a guess. It is arguably
 * wrong — Z-Line-Sow and TN-70-Sow are maternal lines and BREEDER exists as a
 * value — so it is raised as a question rather than settled here.
 */
const BREED_TYPE = 'MEAT';

/** The farm each seeded row belongs to, by its location_code. */
const FARM_CODE: Record<string, string> = { MULTIPLIER: 'MUL100', PORTA: 'POR100' };

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const n = <T>(v: T | undefined) => (v === undefined ? null : v);

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
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-farm-masters', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another farm master seed run is active.');
    await db.beginTransaction();

    const [scopeRows] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id, COUNT(*) c FROM location_master
        WHERE company_id IS NOT NULL GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY c DESC LIMIT 1`);
    if (!scopeRows.length) throw new Error('No company-scoped locations — run db-seed-farm-locations first.');
    const scope = scopeRows[0];

    // The farms must already exist: a breed points at one.
    const [farms] = await db.query<RowDataPacket[]>(
      `SELECT location_id, location_code FROM location_master
        WHERE tenant_id = ? AND location_code IN (?, ?)`,
      [scope.tenant_id, FARM_CODE.MULTIPLIER, FARM_CODE.PORTA]);
    const farmId = new Map(farms.map((r) => [r.location_code as string, r.location_id as string]));
    for (const code of Object.values(FARM_CODE)) {
      if (!farmId.has(code)) throw new Error(`Farm ${code} not found — run db-seed-farm-locations first.`);
    }

    const plan: Record<string, unknown> = { database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY' };

    // ---- Resources ---------------------------------------------------------
    let resInserted = 0, resUpdated = 0;
    for (const r of FARM_RESOURCE_SEED) {
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT resource_id FROM resource_master WHERE tenant_id = ? AND resource_code = ?',
        [scope.tenant_id, r.code]);
      // `capacity` is the equipment's rating (2 HP), not how many of them the
      // farm has. The template's "Number" column has no home in
      // resource_master; every row seeded here is a Porta row with Number = 1,
      // each already listed individually as PWP-01..PWP-05, so nothing is lost.
      // MULTIPLIER's "Heaters x6" would lose the 6 — but those rows have no
      // code and are blocked regardless.
      if (existing.length) {
        if (write) {
          await db.query(
            `UPDATE resource_master SET resource_name=?, resource_type=?, capacity=?, cost_element=?,
               gl_cost_account=?, department=?, designation=?, asset_code=?, capacity_uom=?, unit=?,
               next_maintenance_date=?, license_expiry=?, is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
             WHERE resource_id=?`,
            [r.name, r.type, n(r.capacity), n(r.costElement), n(r.glCostAccount), n(r.department),
             n(r.designation), n(r.assetCode), n(r.capacityUom), n(r.capacityUom),
             n(r.nextServiceDate), n(r.licenseExpiry), existing[0].resource_id]);
        }
        resUpdated++;
      } else {
        if (write) {
          await db.query(
            `INSERT INTO resource_master (resource_id, tenant_id, company_id, nob_id, lob_id, resource_code,
               resource_name, resource_type, capacity, unit, cost_element, gl_cost_account, department,
               designation, asset_code, capacity_uom, next_maintenance_date, license_expiry,
               is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
            [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, r.code,
             r.name, r.type, n(r.capacity), n(r.capacityUom), n(r.costElement), n(r.glCostAccount),
             n(r.department), n(r.designation), n(r.assetCode), n(r.capacityUom),
             n(r.nextServiceDate), n(r.licenseExpiry)]);
        }
        resInserted++;
      }
    }

    // The demo resources carry the generated RES-00n codes; nothing the client
    // submitted looks like that, so the pattern identifies them exactly.
    const [synthRes] = await db.query<RowDataPacket[]>(
      `SELECT resource_id, resource_code FROM resource_master
        WHERE tenant_id = ? AND is_active = 1 AND resource_code REGEXP '^RES-[0-9]+$'`,
      [scope.tenant_id]);
    if (write && synthRes.length) {
      await db.query(
        `UPDATE resource_master SET is_active = 0, status = 'INACTIVE', updated_at = NOW()
          WHERE resource_id IN (${synthRes.map(() => '?').join(',')})`,
        synthRes.map((r) => r.resource_id));
    }
    plan.resources = {
      fromTemplates: FARM_RESOURCE_SEED.length, inserted: resInserted, updated: resUpdated,
      byFarm: ['MULTIPLIER', 'PORTA'].map((f) => ({
        farm: f, rows: FARM_RESOURCE_SEED.filter((x) => x.farm === f).length })),
      syntheticSwitchedOff: synthRes.map((r) => r.resource_code),
      blockedAwaitingTripleC: '28 of 44 rows — missing Resource Code or Resource Type',
    };

    // ---- Breeds ------------------------------------------------------------
    // Company-scoped only. These are farm-specific breeds with a location, not
    // tenant-wide templates, so they get one row rather than the tenant/company
    // pair the system lookups are held as.
    let brdInserted = 0, brdUpdated = 0;
    for (const b of FARM_BREED_SEED) {
      const loc = farmId.get(FARM_CODE[b.farm])!;
      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT breed_id FROM breed_master WHERE tenant_id = ? AND breed_code = ? AND company_id IS NOT NULL',
        [scope.tenant_id, b.code]);
      const vals = [
        b.name, n(b.gestationDays), n(b.lactationDays), n(b.productiveLifeMonths),
        n(b.productiveLifeCycles), n(b.avgLitterSizeBorn), n(b.avgLitterSizeWeaned),
        n(b.avgWeaningWeightKg), n(b.boarProductiveLifeMonths), n(b.residualValuePct), loc,
      ];
      if (existing.length) {
        if (write) {
          await db.query(
            `UPDATE breed_master SET breed_name=?, gestation_days=?, lactation_days=?, productive_life_months=?,
               productive_life_cycles=?, avg_litter_size_born=?, avg_litter_size_weaned=?, avg_weaning_weight_kg=?,
               boar_productive_life_months=?, residual_value_pct=?, location_id=?,
               is_active=1, status='ACTIVE', deleted_at=NULL, updated_at=NOW()
             WHERE breed_id=?`, [...vals, existing[0].breed_id]);
        }
        brdUpdated++;
      } else {
        if (write) {
          await db.query(
            `INSERT INTO breed_master (breed_id, tenant_id, company_id, nob_id, lob_id, breed_code, breed_name,
               gestation_days, lactation_days, productive_life_months, productive_life_cycles,
               avg_litter_size_born, avg_litter_size_weaned, avg_weaning_weight_kg,
               boar_productive_life_months, residual_value_pct, location_id, breed_type,
               is_active, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', NOW(), NOW())`,
            [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, b.code, ...vals, BREED_TYPE]);
        }
        brdInserted++;
      }
    }

    const seededBreeds = FARM_BREED_SEED.map((b) => b.code);
    const [synthBreeds] = await db.query<RowDataPacket[]>(
      `SELECT breed_id, breed_code, company_id FROM breed_master
        WHERE tenant_id = ? AND is_active = 1
          AND breed_code NOT IN (${seededBreeds.map(() => '?').join(',')})`,
      [scope.tenant_id, ...seededBreeds]);
    const [breedRefs] = await db.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM animal_register WHERE breed_id IS NOT NULL) animals,
              (SELECT COUNT(*) FROM breed_lifecycle_stages WHERE breed_id IS NOT NULL) lifecycleStages`);
    if (write && synthBreeds.length) {
      await db.query(
        `UPDATE breed_master SET is_active = 0, status = 'INACTIVE', updated_at = NOW()
          WHERE breed_id IN (${synthBreeds.map(() => '?').join(',')})`,
        synthBreeds.map((r) => r.breed_id));
    }
    plan.breeds = {
      fromTemplates: FARM_BREED_SEED.length, inserted: brdInserted, updated: brdUpdated,
      seeded: FARM_BREED_SEED.map((b) => `${b.code} → ${FARM_CODE[b.farm]}`),
      syntheticSwitchedOff: [...new Set(synthBreeds.map((r) => r.breed_code))],
      deleted: 0,
      referencesPreserved: breedRefs[0],
      blockedAwaitingTripleC: '2 of 4 rows — "Teaser Boar" has no Breed Code on either farm',
      notCarried: 'Farrowing Rate % and Boar Doses Per Week — fractions in a percent column, unit unconfirmed',
      breedTypeAssumed: `${BREED_TYPE} — not in either template; matches every piggery breed already here`,
    };

    console.log(JSON.stringify(plan, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-farm-masters')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

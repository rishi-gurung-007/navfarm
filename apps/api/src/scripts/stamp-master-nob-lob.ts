/**
 * Stamps NOB/LOB onto every master row that has not got one.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * All 23 masters carry company_id, nob_id and lob_id as of migrations 0084/0085.
 * The columns are nullable and NULL means "shared across every business
 * vertical" — `masterScopeConditions` filters them as `nob_id = X OR nob_id IS
 * NULL`, so a NULL row stays visible everywhere.
 *
 * Piggery is the only operational area and one LOB is one area, so every
 * existing row belongs to NOB Livestock / LOB Piggery. Stamping them says that
 * explicitly instead of leaving it implied by there being nothing else.
 *
 * Idempotent: only ever fills a NULL, never overwrites a value someone chose.
 * Run it again after adding a master and it touches only the new rows.
 *
 * Used two ways: as the last stage of db-seed-demo (via stampMasterNobLob), and
 * standalone against a tenant seeded before the columns existed.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

/**
 * Every master that takes a NOB/LOB. no_series_master is deliberately absent:
 * a series is classified by the master it codes, and the ANIMAL series already
 * carries its own NOB/LOB on purpose — stamping the rest would bind
 * tenant-wide series like UOM or ITEM to piggery for no reason.
 */
export const NOB_LOB_MASTERS = [
  'uom_master', 'species_master', 'breed_master', 'item_type_master', 'location_type_master',
  'item_category_master', 'item_master', 'item_attribute_master', 'location_master', 'stage_master',
  'supplier_master', 'customer_master', 'resource_master', 'reason_master', 'disease_master',
  'feed_formula_master', 'gl_account_master', 'gl_mapping_master', 'cost_center_master',
  'uom_conversion_master', 'breed_lifecycle_stages', 'animal_register',
];

export interface StampResult { table: string; stamped: number }

/** Fills NULL nob_id/lob_id on every master. Returns what it changed. */
export async function stampMasterNobLob(
  conn: mysql.Connection,
  tenantId: string,
  nobId: string,
  lobId: string,
  dryRun = false,
): Promise<StampResult[]> {
  const results: StampResult[] = [];
  for (const table of NOB_LOB_MASTERS) {
    const [[{ n }]] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) n FROM \`${table}\` WHERE tenant_id = ? AND (nob_id IS NULL OR lob_id IS NULL)`,
      [tenantId],
    );
    if (!Number(n)) continue;
    if (!dryRun) {
      await conn.query(
        `UPDATE \`${table}\` SET nob_id = COALESCE(nob_id, ?), lob_id = COALESCE(lob_id, ?) WHERE tenant_id = ?`,
        [nobId, lobId, tenantId],
      );
    }
    results.push({ table, stamped: Number(n) });
  }
  return results;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const database = process.env.DEV_TENANT_DATABASE || `nf_${(process.env.DEV_TENANT_CODE || 'devco').toLowerCase()}`;
  const conn = await mysql.createConnection({ host, port, user, password, database, ssl });
  try {
    const [[lock]] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-stamp-nob-lob', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another stamping run is active.');
    await conn.beginTransaction();

    const [[tenant]] = await conn.query<RowDataPacket[]>('SELECT tenant_id FROM company_master LIMIT 1');
    if (!tenant) throw new Error('No company found — run db-seed-demo first.');

    // The area says which NOB/LOB it is, rather than matching on names that move.
    const [[area]] = await conn.query<RowDataPacket[]>(
      'SELECT nob_id, lob_id FROM operational_area_master WHERE deleted_at IS NULL AND is_active = 1 LIMIT 1',
    );
    if (!area) throw new Error('No operational area — nothing to take a NOB/LOB from.');

    const stamped = await stampMasterNobLob(conn, tenant.tenant_id, area.nob_id, area.lob_id, !apply && !verify);

    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      nob_id: area.nob_id,
      lob_id: area.lob_id,
      stamped,
      total: stamped.reduce((sum, r) => sum + r.stamped, 0),
      note: 'NULL stays legal and means "shared across every vertical"; only NULLs were filled.',
    }, null, 2));

    if (apply) { await conn.commit(); console.log('Committed.'); }
    else { await conn.rollback(); console.log(verify ? 'Verified and rolled back.' : 'Read-only. No changes attempted.'); }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('navfarm-stamp-nob-lob')");
    await conn.end();
  }
}

if (process.argv[1]?.includes('stamp-master-nob-lob')) {
  run().catch((err) => { console.error(err.message); process.exit(1); });
}

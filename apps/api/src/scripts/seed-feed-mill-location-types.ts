/**
 * Seeds or aligns MILL and BIN location types in location_type_master,
 * resolving any placeholder LTYP-001 code previously minted by the number series.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const TARGET_TYPES = [
  { code: 'MILL', name: 'Feed Mill', prefix: 'MILL', allowedParents: [] as string[] },
  { code: 'BIN', name: 'Bin', prefix: 'BIN', allowedParents: ['MILL'] },
];

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });

  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-feed-mill-location-types', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another seed run is active.');
    await db.beginTransaction();

    const [scopeRows] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id, COUNT(*) n FROM location_master
        GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY n DESC LIMIT 1`,
    );
    if (!scopeRows.length) throw new Error('location_master is empty — no scope to copy.');
    const scope = scopeRows[0];

    const plan: Record<string, unknown> = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
    };

    // 1. Correct any legacy / user-created LTYP-001 placeholder row to MILL
    const [placeholderRows] = await db.query<RowDataPacket[]>(
      `SELECT location_type_id, tenant_id, company_id, type_code, type_name, code_prefix
         FROM location_type_master
        WHERE tenant_id = ? AND (type_code = 'LTYP-001' OR code_prefix = 'MILL') AND type_code != 'MILL'`,
      [scope.tenant_id],
    );

    const updatedPlaceholders: string[] = [];
    for (const row of placeholderRows) {
      if (write) {
        await db.query(
          `UPDATE location_type_master
              SET type_code = 'MILL',
                  type_name = 'Feed Mill',
                  code_prefix = 'MILL',
                  allowed_parent_types = '[]',
                  is_system = 1,
                  is_active = 1,
                  status = 'ACTIVE',
                  updated_at = NOW()
            WHERE location_type_id = ?`,
          [row.location_type_id],
        );
      }
      updatedPlaceholders.push(`[${row.location_type_id}] ${row.type_code} -> MILL (${row.company_id ? 'COMPANY' : 'TENANT'})`);
    }
    plan.realignedPlaceholders = updatedPlaceholders.length ? updatedPlaceholders : 'none';

    // 2. Ensure MILL and BIN exist for both tenant (company_id = NULL) and active company
    const typesAdded: string[] = [];
    for (const t of TARGET_TYPES) {
      for (const companyId of [null, scope.company_id]) {
        const [existing] = await db.query<RowDataPacket[]>(
          `SELECT location_type_id FROM location_type_master
            WHERE tenant_id = ? AND type_code = ? AND (company_id <=> ?) AND deleted_at IS NULL`,
          [scope.tenant_id, t.code, companyId],
        );
        if (existing.length) continue;

        if (write) {
          await db.query(
            `INSERT INTO location_type_master (
               location_type_id, tenant_id, company_id, nob_id, lob_id,
               type_code, type_name, code_prefix, allowed_parent_types,
               is_system, is_active, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE', NOW(), NOW())`,
            [
              randomUUID(), scope.tenant_id, companyId, scope.nob_id, scope.lob_id,
              t.code, t.name, t.prefix, JSON.stringify(t.allowedParents),
            ],
          );
        }
        typesAdded.push(`${t.code} (${companyId ? 'COMPANY' : 'TENANT'})`);
      }
    }
    plan.locationTypesAdded = typesAdded.length ? typesAdded : 'none — already present';

    // 3. If LOCATION_TYPE series was advanced, reset if no LTYP-* records remain
    const [remainingLtyp] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) n FROM location_type_master WHERE tenant_id = ? AND type_code LIKE 'LTYP%'`,
      [scope.tenant_id],
    );
    if (Number(remainingLtyp[0].n) === 0) {
      if (write) {
        await db.query(
          `UPDATE no_series SET current_seq = 0, last_no_used = NULL WHERE tenant_id = ? AND code = 'LOCATION_TYPE'`,
          [scope.tenant_id],
        );
      }
      plan.locationTypeNumberSeriesReset = 'Reset LOCATION_TYPE current_seq to 0';
    }

    // 4. Query current state of MILL & BIN in location_type_master
    const [finalRows] = await db.query<RowDataPacket[]>(
      `SELECT location_type_id, company_id, type_code, type_name, code_prefix, allowed_parent_types, is_system
         FROM location_type_master
        WHERE tenant_id = ? AND type_code IN ('MILL', 'BIN')
        ORDER BY type_code, company_id IS NULL`,
      [scope.tenant_id],
    );
    plan.finalTypes = finalRows.map((r) => ({
      type_code: r.type_code,
      type_name: r.type_name,
      code_prefix: r.code_prefix,
      company: r.company_id ? 'COMPANY' : 'TENANT',
      allowed_parent_types: r.allowed_parent_types,
      is_system: r.is_system,
    }));

    console.log(JSON.stringify(plan, null, 2));

    if (apply) {
      await db.commit();
      console.log('\n✔ Applied changes committed to database.');
    } else {
      await db.rollback();
      console.log(`\n✔ ${verify ? 'Verification run rolled back' : 'Read-only plan, no changes made'}.`);
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-feed-mill-location-types')");
    await db.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

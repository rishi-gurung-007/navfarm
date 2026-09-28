/**
 * Seeds the 57 Reason Master Template catalog rows from DOCUMENTED_REASONS
 * into reason_master for active companies.
 *
 *   pnpm nx run api:db-seed-documented-reasons            # read-only plan
 *   pnpm nx run api:db-seed-documented-reasons --args="--verify"  # apply in rolled-back tx
 *   pnpm nx run api:db-seed-documented-reasons --args="--apply"   # commit
 */
import * as mysql from 'mysql2/promise';
import { DOCUMENTED_REASONS } from '../core/database/reason-code-seed';
import { seedDocumentedReasons } from './lib/seed-demo-detail';

const DB = process.env.TENANT_DB_NAME || 'tenant_devco';

async function main() {
  const mode = process.argv[2] || 'READ_ONLY';
  if (!['READ_ONLY', '--verify', '--apply'].includes(mode)) {
    throw new Error('Use no flags (read-only plan), --verify (rolled back), or --apply (commit).');
  }

  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: DB,
  });

  try {
    const [[tenant]] = await conn.query<any[]>('SELECT tenant_id FROM company_master LIMIT 1');
    if (!tenant) throw new Error(`No tenant found in ${DB}.`);

    const [existing] = await conn.query<any[]>(
      'SELECT reason_code, category FROM reason_master WHERE tenant_id = ?',
      [tenant.tenant_id],
    );
    const existingCodes = new Set(existing.map((r) => r.reason_code));
    const toCreate = DOCUMENTED_REASONS.filter((r) => !existingCodes.has(r.reason_code));

    console.log(`[seed-documented-reasons] Database: ${DB}`);
    console.log(`[seed-documented-reasons] Existing reasons: ${existing.length}`);
    console.log(`[seed-documented-reasons] Reasons to add: ${toCreate.length} (total template catalog: ${DOCUMENTED_REASONS.length})`);

    if (toCreate.length === 0) {
      console.log('All documented reasons are already present.');
      return;
    }

    if (mode === 'READ_ONLY') {
      console.log('\n--- PLAN ---');
      for (const r of toCreate) {
        console.log(`  + ${r.reason_code} [${r.category}] ${r.reason_name}`);
      }
      console.log('\nRun with --verify or --apply to execute.');
      return;
    }

    await conn.beginTransaction();
    const created = await seedDocumentedReasons(conn, tenant.tenant_id, DOCUMENTED_REASONS);
    console.log(`Inserted ${created} reason rows.`);

    if (mode === '--apply') {
      await conn.commit();
      console.log('Successfully committed documented reasons to database.');
    } else {
      await conn.rollback();
      console.log('Transaction verified and rolled back.');
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

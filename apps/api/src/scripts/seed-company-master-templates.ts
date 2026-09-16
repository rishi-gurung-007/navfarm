/**
 * Adopts the tenant's master templates into every company that does not yet
 * have its own company-scoped copy.
 *
 * company.service.ts calls copyCompanyMasterTemplates inside the same
 * transaction that creates a company (company.service.ts:182). seed-dev-tenant.ts
 * raw-inserts the Triple C company row directly and never calls it — so a
 * rebuild from empty leaves every nullable-company_id master (no_series_master
 * included) sitting at tenant scope only. masterScopeConditions requires an
 * EXACT company_id match once a request carries a COMPANY scope (unlike
 * nob_id/lob_id, a NULL company_id row is not a visible fallback) — so without
 * this step the company can see none of them, and generating its first
 * document number fails before Task 2 ever posts a chapter.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 * Idempotent, same rule as seed-demo.ts's own adoptCompanyTemplates: a company
 * already holding at least one company-scoped no_series_master row is left
 * alone — copyCompanyMasterTemplates is a one-time snapshot, not a repeated
 * sync (see its own docstring), so re-running it against an already-adopted
 * company would duplicate every template row.
 *
 * Do not confuse this with adopt-company-master-templates.ts, which is an
 * unrelated one-time migration for companies that used to share tenant
 * records and requires a verified --backup= file. This script only fills the
 * gap seed-dev-tenant.ts leaves for a freshly created company.
 */
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { RowDataPacket } from 'mysql2/promise';
import * as schema from '../core/database/schema';
import { copyCompanyMasterTemplates } from '../modules/core/company/copy-master-templates';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const database = process.env.DEV_TENANT_DATABASE || `tenant_${(process.env.DEV_TENANT_CODE || 'devco').toLowerCase()}`;

// Thrown from inside db.transaction() to force a rollback in --verify mode
// without treating the run itself as a failure.
const VERIFY_ROLLBACK = Symbol('seed-company-master-templates:verify-rollback');

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const mutating = apply || verify;

  const pool = mysql.createPool({ host, port, user, password, database, ssl });
  try {
    const [[lock]] = await pool.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-adopt-company-templates', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another template adoption run is active.');

    const db = drizzle(pool, { schema, mode: 'default' });
    const companies = await db.select().from(schema.companyMaster);
    const plan: Array<Record<string, unknown>> = [];

    for (const company of companies) {
      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT series_id FROM no_series_master WHERE company_id = ? LIMIT 1',
        [company.company_id],
      );
      if (existing.length) {
        plan.push({ company: company.company_code, action: 'SKIP', reason: 'already adopted' });
        continue;
      }
      if (!mutating) {
        plan.push({ company: company.company_code, action: 'WOULD_ADOPT' });
        continue;
      }
      try {
        await db.transaction(async (tx) => {
          const copied = await copyCompanyMasterTemplates(tx, company.tenant_id, company.company_id);
          plan.push({ company: company.company_code, action: 'ADOPTED', rows: copied });
          if (verify) throw VERIFY_ROLLBACK;
        });
      } catch (err) {
        if (err !== VERIFY_ROLLBACK) throw err;
      }
    }

    console.log(JSON.stringify({ database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY', plan }, null, 2));
    console.log(apply ? 'Committed.' : verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
  } finally {
    await pool.query("SELECT RELEASE_LOCK('navfarm-adopt-company-templates')");
    await pool.end();
  }
}

run().catch((err) => {
  // Drizzle's error.message carries only the failed query text, not the
  // driver's errno/SQLSTATE — print the underlying cause too, or a duplicate
  // key and a foreign-key violation look identical here.
  console.error(err instanceof Error ? err.message : err);
  const cause = (err as any)?.cause;
  if (cause) console.error('Caused by:', cause instanceof Error ? cause.message : cause);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

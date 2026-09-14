import * as mysql from 'mysql2/promise';
import { bootstrap } from './bootstrap-database';
import { seedDevTenant } from './seed-dev-tenant';
import { seedPiggeryData } from './seed-piggery-complete-data';
import { seedFullCoverage } from './seed-demo-full-coverage';
import { seedDemoGaps } from './seed-demo-gaps';
import { stampMasterNobLob } from './stamp-master-nob-lob';
import { enrichDemoMasters, seedDocumentedReasons } from './lib/seed-demo-detail';
import { DOCUMENTED_REASONS } from '../core/database/reason-code-seed';
import { drizzle } from 'drizzle-orm/mysql2';
import * as tenantSchema from '../core/database/schema';
import { copyCompanyMasterTemplates } from '../modules/core/company/copy-master-templates';

/**
 * One command to build the entire demo environment.
 *
 * Runs the whole chain in dependency order — platform bootstrap, tenant and its
 * two companies, the piggery operational dataset, the cross-module coverage
 * pass, then the master-data/configuration gap fill — so a presentation
 * environment is reproducible from nothing with a single target instead of four
 * scripts run by hand in the right order.
 *
 *   pnpm nx run api:db-seed-demo             # build (safe to re-run)
 *   pnpm nx run api:db-seed-demo --fresh     # drop the databases first
 *
 * Every stage is idempotent, so re-running only fills what is missing. Pass
 * --fresh (or SEED_FRESH=true) to drop navfarm_master, tenant_system and the
 * dev tenant database first and rebuild from empty.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';
const systemDatabase = process.env.SYSTEM_TENANT_DATABASE || 'tenant_system';
const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();

const wantsFresh = process.argv.includes('--fresh') || process.env.SEED_FRESH === 'true';

function assertDatabaseName(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Unsafe database name: ${value}`);
  return value;
}

async function dropDatabases() {
  // Only ever the three NAVFarm databases, named explicitly. Anything else on
  // this server — another project sharing the same local MySQL — is untouched.
  const targets = [masterDatabase, systemDatabase, `tenant_${tenantCode}`].map(assertDatabaseName);
  const conn = await mysql.createConnection({ host, port, user, password, ssl });
  try {
    for (const dbName of targets) {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      console.log(`  dropped ${dbName}`);
    }
  } finally {
    await conn.end();
  }
}

const stages: Array<{ label: string; fn: () => Promise<unknown> }> = [
  { label: 'Platform bootstrap (master + system tenant)', fn: bootstrap },
  { label: 'Tenant, companies, users, starter master data', fn: seedDevTenant },
  // Between the tenant's masters and any company data: the tenant rows are the
  // draft, and a company works from its own copy. copyCompanyMasterTemplates is
  // what makes that copy — including no_series_master, which is why a series
  // resolved to nothing at company scope until this ran.
  { label: 'Adopt tenant master templates into the company', fn: adoptCompanyTemplates },
  { label: 'Piggery operational dataset (both companies)', fn: seedPiggeryData },
  { label: 'Cross-module coverage (inventory, finance, QC, approvals)', fn: seedFullCoverage },
  { label: 'Master-data & configuration gap fill', fn: seedDemoGaps },
  // Last, because it stamps whatever the stages above created. Every master
  // carries nob_id/lob_id now; piggery is the only area, so every seeded row
  // belongs to it. Only NULLs are filled, so it is safe to re-run.
  { label: 'Stamp NOB/LOB on every master', fn: stampSeededMasters },
  // Last: the optional fields the core seeds leave NULL, so a master's edit form
  // shows a filled record instead of a page of blanks. Demo values only — see
  // lib/seed-demo-detail.ts for what is deliberately left for the client.
  { label: 'Demo detail: reasons + optional master fields', fn: fillDemoDetail },
];

async function fillDemoDetail() {
  const conn = await mysql.createConnection({
    host, port, user, password, ssl, database: assertDatabaseName(`tenant_${tenantCode}`),
  });
  try {
    const [[tenant]] = await conn.query<any[]>('SELECT tenant_id FROM company_master LIMIT 1');
    if (!tenant) return;
    const reasons = await seedDocumentedReasons(conn, tenant.tenant_id, DOCUMENTED_REASONS);
    const filled = await enrichDemoMasters(conn, tenant.tenant_id);
    const total = filled.reduce((sum, r) => sum + r.rows, 0);
    console.log(`  seeded ${reasons} documented reasons; filled ${total} optional field values across ${filled.length} passes.`);
  } finally {
    await conn.end();
  }
}

async function adoptCompanyTemplates() {
  const pool = mysql.createPool({
    host, port, user, password, ssl, database: assertDatabaseName(`tenant_${tenantCode}`),
  });
  try {
    const db = drizzle(pool, { schema: tenantSchema, mode: 'default' });
    const companies = await db.select().from(tenantSchema.companyMaster);
    for (const company of companies) {
      // Template adoption is a one-time snapshot, not a repeated sync. The
      // seed command is idempotent, so do not attempt to insert the same
      // company-scoped master codes again on its second run.
      const [existing] = await pool.query<any[]>(
        'SELECT series_id FROM no_series_master WHERE company_id = ? LIMIT 1',
        [company.company_id],
      );
      if (existing.length) {
        console.log(`  ${company.company_code}: master templates already adopted.`);
        continue;
      }
      const copied = await db.transaction((tx) =>
        copyCompanyMasterTemplates(tx, company.tenant_id, company.company_id));
      console.log(`  ${company.company_code}: adopted ${copied} master template rows.`);
    }
  } finally {
    await pool.end();
  }
}

async function stampSeededMasters() {
  const conn = await mysql.createConnection({
    host, port, user, password, ssl, database: assertDatabaseName(`tenant_${tenantCode}`),
  });
  try {
    const [[tenant]] = await conn.query<any[]>('SELECT tenant_id FROM company_master LIMIT 1');
    const [[area]] = await conn.query<any[]>(
      'SELECT nob_id, lob_id FROM operational_area_master WHERE deleted_at IS NULL AND is_active = 1 LIMIT 1',
    );
    if (!tenant || !area) return;
    const stamped = await stampMasterNobLob(conn, tenant.tenant_id, area.nob_id, area.lob_id);
    const total = stamped.reduce((sum, r) => sum + r.stamped, 0);
    console.log(`  stamped NOB/LOB on ${total} rows across ${stamped.length} masters.`);
  } finally {
    await conn.end();
  }
}

export async function seedDemo() {
  const started = Date.now();

  if (wantsFresh) {
    console.log('\n🗑️  Dropping NAVFarm databases (--fresh)...');
    await dropDatabases();
  }

  for (const [i, stage] of stages.entries()) {
    console.log(`\n━━ ${i + 1}/${stages.length} ${stage.label} ${'━'.repeat(Math.max(0, 46 - stage.label.length))}`);
    await stage.fn();
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`\n✅ Demo environment ready in ${seconds}s.`);
  console.log('════════════════════════════════════════════════════');
  // Read back what was actually created rather than repeating a list written
  // by hand. The summary used to name six users on two companies, none of which
  // survived the rename to Triple C — it told you to sign in as addresses that
  // did not exist.
  const summaryPool = mysql.createPool({ host, port, user, password, database: assertDatabaseName(`tenant_${tenantCode}`), ssl });
  try {
    const [companies] = await summaryPool.query<any[]>('SELECT company_code, company_name FROM company_master WHERE deleted_at IS NULL');
    const [areas] = await summaryPool.query<any[]>('SELECT area_code, area_name FROM operational_area_master WHERE deleted_at IS NULL');
    const [users] = await summaryPool.query<any[]>(
      "SELECT email, user_type FROM user_master ORDER BY FIELD(user_type,'TENANT_ADMIN','COMPANY_ADMIN','OPERATIONAL_ADMIN','STANDARD_USER'), email"
    );

    console.log(`Tenant:            ${tenantCode}`);
    for (const c of companies) console.log(`Company:           ${c.company_name} (${c.company_code})`);
    for (const a of areas) console.log(`Operational area:  ${a.area_name} (${a.area_code})`);
    console.log('');
    console.log('Sign in at http://localhost:3002/login — password 12345678 for all:');
    for (const u of users) console.log(`  ${String(u.email).padEnd(32)} ${u.user_type}`);
  } finally {
    await summaryPool.end();
  }
  console.log('');
}

if (require.main === module) {
  void seedDemo().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

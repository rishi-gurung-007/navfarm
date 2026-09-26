import * as mysql from 'mysql2/promise';
import { execSync } from 'node:child_process';
import { DEFAULT_MASTER_DATABASE, DEFAULT_SYSTEM_DATABASE, NAVFARM_DB_PREFIX } from '../core/database/database-names';

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || DEFAULT_MASTER_DATABASE;
const isPiggeryIsolated = masterDatabase.startsWith('piggery_');
const tenantPrefix = isPiggeryIsolated ? 'piggery_tenant_' : NAVFARM_DB_PREFIX;
const systemDatabase = process.env.SYSTEM_TENANT_DATABASE || (isPiggeryIsolated ? 'piggery_tenant_system' : DEFAULT_SYSTEM_DATABASE);

function assertDbName(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe database name: ${value}`);
  }
  return value;
}

function runStep(title: string, scriptFile: string) {
  console.log(`\n⏳ ${title}...`);
  try {
    execSync(`node --env-file-if-exists=.env --import tsx src/scripts/${scriptFile}`, {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
  } catch (err: any) {
    console.error(`❌ Failed during step: ${title}`);
    throw err;
  }
}

async function runFreshSetup() {
  console.log('================================================================');
  console.log('🚀 NAVFARM ERP — UNIFIED FRESH DATABASE MIGRATION & SEED ENGINE');
  console.log('================================================================');
  console.log(`Master Database:    ${masterDatabase}`);
  console.log(`System Database:    ${systemDatabase}`);
  console.log(`Tenant DB Prefix:   ${tenantPrefix}*`);
  console.log('----------------------------------------------------------------');

  // 1. DROP ALL LINKED DATABASES
  console.log('🧹 Step 1: Dropping all linked databases...');
  const server = await mysql.createConnection({ host, port, user, password, ssl });
  try {
    const [dbRows] = await server.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    const targetDbs = (dbRows as Array<{ Database: string }>)
      .map((r) => r.Database)
      .filter((d) => d === masterDatabase || d === systemDatabase || d.startsWith(tenantPrefix));

    for (const dbName of targetDbs) {
      assertDbName(dbName);
      console.log(`   - Dropping database \`${dbName}\`...`);
      await server.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    }
  } finally {
    await server.end();
  }

  // 2. RUN BOOTSTRAP (Master & System DB migrations + Core seeds)
  runStep('Step 2: Bootstrapping Master & System Databases', 'bootstrap-database.ts');

  // 3. SYNC TAXONOMY & REFERENCE MASTERS
  runStep('Step 3: Syncing NOB & LOB Taxonomy (Livestock, Piggery, Poultry, etc.)', 'sync-nob-lob.ts');
  runStep('Step 4: Syncing Locales, Timezones & Countries', 'sync-locale-master.ts');
  runStep('Step 5: Seeding Reference Masters (UOMs, Species, Breeds, Stages, Items)', 'seed-system-master-data.ts');

  console.log('\n================================================================');
  console.log('🎉 PLATFORM DATABASE READY — NO TENANTS PROVISIONED');
  console.log('================================================================');
  console.log('Migrations ran and reference/master data is seeded, but no demo');
  console.log('or dev tenant was created. Sign up through the app to create a');
  console.log('real tenant/company, or run one of the standalone dev seed');
  console.log('scripts manually (e.g. `pnpm nx run api:db-seed-dev-tenant`) if');
  console.log('you want fixture data for local development.');
  console.log('');
  console.log('  Platform Super Administrator:');
  console.log('     URL:      http://localhost:3002/login  (or /admin)');
  console.log(`     Email:    ${process.env.SYSTEM_ADMIN_EMAIL || 'admin@navfarm.local'}`);
  console.log('     Password: value of SYSTEM_ADMIN_PASSWORD in your .env');
  console.log('================================================================\n');
}

void runFreshSetup().catch((err) => {
  console.error('Setup failed:', err.message || err);
  process.exitCode = 1;
});

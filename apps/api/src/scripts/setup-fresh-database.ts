import * as mysql from 'mysql2/promise';
import { execSync } from 'node:child_process';
import { DEFAULT_MASTER_DATABASE, DEFAULT_SYSTEM_DATABASE, NAVFARM_DB_PREFIX, NEVER_DROP_DATABASES } from '../core/database/database-names';

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || DEFAULT_MASTER_DATABASE;
const isPiggeryIsolated = masterDatabase.startsWith('piggery_');
const systemDatabase = process.env.SYSTEM_TENANT_DATABASE || (isPiggeryIsolated ? 'piggery_tenant_system' : DEFAULT_SYSTEM_DATABASE);
const demoTenantDatabase = process.env.DEMO_TENANT_DATABASE || `${NAVFARM_DB_PREFIX}devco`;
const PROTECTED_TENANT_DATABASE = NEVER_DROP_DATABASES[0];

type PreservedTenantState = {
  tenant: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  authIndex: Array<Record<string, unknown>>;
};

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

async function captureProtectedTenantState(server: Awaited<ReturnType<typeof mysql.createConnection>>): Promise<PreservedTenantState> {
  const [masterDbRows] = await server.query<mysql.RowDataPacket[]>(
    'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
    [masterDatabase],
  );
  if (masterDbRows.length === 0) {
    return { tenant: null, subscription: null, authIndex: [] };
  }

  const [tenantRows] = await server.query<mysql.RowDataPacket[]>(
    `SELECT * FROM \`${masterDatabase}\`.tenant_master WHERE db_name = ? LIMIT 1`,
    [PROTECTED_TENANT_DATABASE],
  );
  const tenant = (tenantRows as Array<Record<string, unknown>>)[0] || null;
  if (!tenant) {
    const [databaseRows] = await server.query<mysql.RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [PROTECTED_TENANT_DATABASE],
    );
    if (databaseRows.length > 0) {
      throw new Error(
        `Protected tenant database \`${PROTECTED_TENANT_DATABASE}\` exists, but nf_master.tenant_master has no registry row for it. ` +
        'Refusing to reset until that tenant is re-registered; otherwise login would remain broken.',
      );
    }
    return { tenant: null, subscription: null, authIndex: [] };
  }

  const [subscriptionRows] = await server.query<mysql.RowDataPacket[]>(
    `SELECT * FROM \`${masterDatabase}\`.tenant_subscription WHERE tenant_id = ? LIMIT 1`,
    [tenant.tenant_id],
  );
  const [authIndexRows] = await server.query<mysql.RowDataPacket[]>(
    `SELECT * FROM \`${masterDatabase}\`.user_auth_index WHERE tenant_id = ?`,
    [tenant.tenant_id],
  );
  return {
    tenant,
    subscription: (subscriptionRows as Array<Record<string, unknown>>)[0] || null,
    authIndex: authIndexRows as Array<Record<string, unknown>>,
  };
}

async function restoreProtectedTenantState(state: PreservedTenantState): Promise<void> {
  if (!state.tenant) {
    console.log(`   Protected tenant registry not found for \`${PROTECTED_TENANT_DATABASE}\`; nothing to restore.`);
    return;
  }

  const master = await mysql.createConnection({ host, port, user, password, database: masterDatabase, ssl });
  try {
    await master.beginTransaction();
    const insertRow = async (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      const quotedColumns = columns.map((column) => `\`${column}\``).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      await master.query(
        `INSERT INTO \`${table}\` (${quotedColumns}) VALUES (${placeholders})`,
        columns.map((column) => {
          const value = row[column];
          return value !== null && typeof value === 'object' && !(value instanceof Date)
            ? JSON.stringify(value)
            : value;
        }),
      );
    };

    await insertRow('tenant_master', state.tenant);
    if (state.subscription) await insertRow('tenant_subscription', state.subscription);
    for (const row of state.authIndex) await insertRow('user_auth_index', row);
    await master.commit();
    console.log(`   Restored protected tenant registry, subscription, and ${state.authIndex.length} auth index row(s) for \`${PROTECTED_TENANT_DATABASE}\`.`);
  } catch (error) {
    await master.rollback();
    throw error;
  } finally {
    await master.end();
  }
}

async function runFreshSetup() {
  console.log('================================================================');
  console.log('🚀 NAVFARM ERP — UNIFIED FRESH DATABASE MIGRATION & SEED ENGINE');
  console.log('================================================================');
  console.log(`Master Database:    ${masterDatabase}`);
  console.log(`System Database:    ${systemDatabase}`);
  console.log(`Demo Tenant DB:     ${demoTenantDatabase}`);
  console.log('----------------------------------------------------------------');

  // Validate every configured target before dropping any database. This keeps
  // a malformed DEMO_TENANT_DATABASE from failing halfway through the reset.
  assertDbName(masterDatabase);
  assertDbName(systemDatabase);
  assertDbName(demoTenantDatabase);

  // 1. DROP ONLY THE DEMO DATABASES
  console.log('🧹 Step 1: Dropping demo databases...');
  const server = await mysql.createConnection({ host, port, user, password, ssl });
  let preservedProtectedTenant: PreservedTenantState | null = null;
  try {
    preservedProtectedTenant = await captureProtectedTenantState(server);
    const [dbRows] = await server.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    const targetNames = new Set([masterDatabase, systemDatabase, demoTenantDatabase]);
    const targetDbs = (dbRows as Array<{ Database: string }>)
      .map((r) => r.Database)
      .filter((d) => targetNames.has(d) && !NEVER_DROP_DATABASES.includes(d as (typeof NEVER_DROP_DATABASES)[number]));

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
  if (!preservedProtectedTenant) throw new Error('Protected tenant snapshot was not captured before reset.');
  await restoreProtectedTenantState(preservedProtectedTenant);

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

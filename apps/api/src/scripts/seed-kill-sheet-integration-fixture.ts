/**
 * Creates the non-destructive identity half of the isolated Kill Sheet HTTP
 * fixture. It deliberately refuses every environment except the named local
 * integration topology. It never invokes the all-tenant migrator, deletes
 * rows, or edits an existing identity/directory mapping.
 */
import { JwtService } from '@nestjs/jwt';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as masterSchema from '../core/database/master-schema';
import * as tenantSchema from '../core/database/schema';

const MASTER = 'nf_killsheet_it_master_20261117';
const TENANTS = [
  { code: 'killsheetita', db: 'nf_killsheetita', email: 'killsheet-admin-a@integration.test', name: 'Kill Sheet Integration Admin A' },
  { code: 'killsheetitb', db: 'nf_killsheetitb', email: 'killsheet-admin-b@integration.test', name: 'Kill Sheet Integration Admin B' },
] as const;
const EXPECTED = [MASTER, 'nf_killsheet_it_system_20261117', ...TENANTS.map((tenant) => tenant.db)].sort();

function assertIsolation() {
  const host = process.env.DATABASE_HOST;
  if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Refusing: DATABASE_HOST must be an exact local host.');
  if (process.env.DATABASE_NAME !== MASTER) throw new Error(`Refusing: DATABASE_NAME must be ${MASTER}.`);
  const supplied = (process.env.NAVFARM_DB_ALLOWLIST || '').split(',').map((name) => name.trim()).filter(Boolean).sort();
  if (supplied.length !== EXPECTED.length || supplied.some((name, index) => name !== EXPECTED[index])) throw new Error(`Refusing: NAVFARM_DB_ALLOWLIST must contain exactly ${EXPECTED.join(',')}.`);
}

export async function planKillSheetIntegrationFixture() {
  assertIsolation();
  const connection = await mysql.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: MASTER });
  try {
    const [registered] = await connection.query<any[]>('SELECT tenant_id, tenant_code, db_name FROM tenant_master WHERE tenant_code IN (?, ?) ORDER BY tenant_code', TENANTS.map((tenant) => tenant.code));
    if (registered.length !== TENANTS.length || registered.some((row, index) => row.tenant_code !== TENANTS[index].code || row.db_name !== TENANTS[index].db)) throw new Error('Refusing: isolated tenant registry is missing or does not have the expected database mapping.');
    const identities = [] as Array<Record<string, unknown>>;
    for (const tenant of TENANTS) {
      const row = registered.find((entry) => entry.tenant_code === tenant.code)!;
      const tenantConnection = await mysql.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: tenant.db });
      try {
        const [users] = await tenantConnection.query<any[]>('SELECT user_id, tenant_id, email FROM user_master WHERE email = ?', [tenant.email]);
        const [directory] = await connection.query<any[]>('SELECT user_id, tenant_id, email FROM user_auth_index WHERE email = ?', [tenant.email]);
        if (users.length > 1 || directory.length > 1) throw new Error(`Refusing: ambiguous identity state for ${tenant.email}.`);
        if ((users.length === 1) !== (directory.length === 1)) throw new Error(`Refusing: user/directory conflict for ${tenant.email}; this fixture never repairs mappings.`);
        if (users.length && (users[0].tenant_id !== row.tenant_id || directory[0].tenant_id !== row.tenant_id || directory[0].user_id !== users[0].user_id)) throw new Error(`Refusing: conflicting identity mapping for ${tenant.email}.`);
        identities.push({ tenant: tenant.code, database: tenant.db, email: tenant.email, action: users.length ? 'UNCHANGED' : 'CREATE_VIA_AUTH_SERVICE' });
      } finally { await tenantConnection.end(); }
    }
    return { master: MASTER, allowlist: EXPECTED, identities, operations: 'PENDING: requires existing Company/Farm/Batch service fixture wiring' };
  } finally { await connection.end(); }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plan = await planKillSheetIntegrationFixture();
  console.log(JSON.stringify(plan, null, 2));
  if (!apply) return;
  const masterPool = mysql.createPool({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: MASTER });
  const masterDb = drizzle(masterPool, { schema: masterSchema, mode: 'default' });
  try {
    for (const target of TENANTS) {
      const [tenant] = await masterDb.select().from(masterSchema.tenantMaster).where((await import('drizzle-orm')).eq(masterSchema.tenantMaster.tenant_code, target.code)).limit(1);
      if (!tenant) throw new Error(`Refusing: tenant ${target.code} disappeared after planning.`);
      const pool = mysql.createPool({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: target.db });
      const tenantDb = drizzle(pool, { schema: tenantSchema, mode: 'default' });
      const [existing] = await tenantDb.select().from(tenantSchema.userMaster).where((await import('drizzle-orm')).eq(tenantSchema.userMaster.email, target.email)).limit(1);
      if (!existing) {
        const [bootstrapUser] = await tenantDb.select().from(tenantSchema.userMaster).where((await import('drizzle-orm')).eq(tenantSchema.userMaster.user_type, 'TENANT_ADMIN')).limit(1);
        const [company] = await tenantDb.select().from(tenantSchema.companyMaster).limit(1);
        if (!bootstrapUser || !company) throw new Error(`Refusing: ${target.code} lacks its seeded admin or company.`);
        const jwt = new JwtService({ secret: process.env.JWT_SECRET || 'navfarm-local-development-jwt-secret-change-before-sharing' });
        const bearer = `Bearer ${jwt.sign({ sub: bootstrapUser.user_id, tenantId: tenant.tenant_id, type: 'access' })}`;
        const apiUrl = process.env.API_URL || 'http://localhost:2877/api/v1';
        const res = await fetch(`${apiUrl}/auth/register-admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: bearer },
          body: JSON.stringify({
            email: target.email,
            password_hash: 'KillSheetFixture!2026',
            full_name: target.name,
            tenant_id: tenant.tenant_id,
            company_id: company.company_id,
            timezone_pref_id: company.default_timezone_id,
            user_type: 'TENANT_ADMIN',
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Failed to register admin via API: ${res.status} ${body}`);
        }
      }
      await pool.end();
    }
  } finally { await masterPool.end(); }
}
if (process.argv[1]?.includes('seed-kill-sheet-integration-fixture')) void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

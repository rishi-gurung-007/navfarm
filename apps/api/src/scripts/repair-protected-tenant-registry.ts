/**
 * Rebuilds the common-database registry for the protected Porta test tenant
 * when nf_master was reset but nf_portatestnavfarm was retained.
 *
 * Read-only by default:
 *   pnpm nx run api:db-repair-protected-tenant
 *   pnpm nx run api:db-repair-protected-tenant -- --verify  # rolls back
 *   pnpm nx run api:db-repair-protected-tenant -- --apply   # commits
 */
import * as mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const masterDatabase = process.env.DATABASE_NAME || 'nf_master';
const protectedDatabase = 'nf_portatestnavfarm';
const tenantCode = 'portatestnavfarm';
const mode = process.argv.includes('--apply') ? 'APPLY' : process.argv.includes('--verify') ? 'VERIFY' : 'PLAN';

function requireLocalHost() {
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    throw new Error(`Protected tenant repair only runs against local MySQL; DATABASE_HOST is ${host}.`);
  }
}

async function main() {
  requireLocalHost();
  const conn = await mysql.createConnection({ host, port, user, password });
  try {
    const [tenantRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT tenant_id, tenant_code, tenant_name, db_name FROM \`${masterDatabase}\`.tenant_master WHERE db_name = ? OR tenant_code = ? LIMIT 1`,
      [protectedDatabase, tenantCode],
    );
    const existingRegistry = tenantRows[0] as Record<string, unknown> | undefined;
    if (existingRegistry && (existingRegistry.db_name !== protectedDatabase || existingRegistry.tenant_code !== tenantCode)) {
      throw new Error('A conflicting tenant registry row already uses the protected database or tenant code.');
    }

    const [protectedUsers] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT user_id, tenant_id, email FROM \`${protectedDatabase}\`.user_master WHERE is_active = 1 AND deleted_at IS NULL ORDER BY email`,
    );
    if (!protectedUsers.length) throw new Error(`No active users found in ${protectedDatabase}.`);
    const tenantIds = [...new Set(protectedUsers.map((row) => String(row.tenant_id)))];
    if (tenantIds.length !== 1) throw new Error(`Expected one tenant_id in ${protectedDatabase}, found ${tenantIds.length}.`);
    const tenantId = tenantIds[0];
    const admin = protectedUsers.find((row) => row.email === 'paul.young@navfarm.com') || protectedUsers[0];

    const [companyRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT company_name FROM \`${protectedDatabase}\`.company_master WHERE tenant_id = ? AND is_active = 1 ORDER BY company_id LIMIT 1`,
      [tenantId],
    );
    const tenantName = String(companyRows[0]?.company_name || tenantCode);
    const [plans] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT plan_id, billing_cycle, max_companies, max_users, storage_limit_gb, feature_flags FROM \`${masterDatabase}\`.plan_master WHERE plan_id = 'PLAN_BASIC' LIMIT 1`,
    );
    if (!plans[0]) throw new Error('PLAN_BASIC is missing from nf_master.');
    const plan = plans[0];
    const featureFlags = typeof plan.feature_flags === 'string'
      ? plan.feature_flags
      : JSON.stringify(plan.feature_flags);

    console.log('================================================================');
    console.log('PROTECTED TENANT REGISTRY REPAIR');
    console.log('================================================================');
    console.log(`Tenant database: ${protectedDatabase}`);
    console.log(`Tenant ID:       ${tenantId}`);
    console.log(`Tenant name:     ${tenantName}`);
    console.log(`Login index rows: ${protectedUsers.length}`);
    console.log(`Mode:            ${mode}`);
    if (existingRegistry) {
      console.log('Registry:        already present; no tenant_master insert needed.');
    } else {
      console.log('Registry:        insert tenant_master + tenant_subscription.');
    }

    if (mode === 'PLAN') return;

    await conn.beginTransaction();
    if (!existingRegistry) {
      await conn.query(
        `INSERT INTO \`${masterDatabase}\`.tenant_master
          (tenant_id, tenant_code, tenant_name, tenant_type, plan_id, plan_start_date, billing_email, billing_cycle,
           max_companies, max_users, api_rate_limit, db_host, db_port, db_name, db_user, db_password)
         VALUES (?, ?, ?, 'SME', ?, CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId, tenantCode, tenantName, plan.plan_id, admin.email, plan.billing_cycle,
          plan.max_companies, plan.max_users, 1000, host, port,
          protectedDatabase, user, password,
        ],
      );
      await conn.query(
        `INSERT INTO \`${masterDatabase}\`.tenant_subscription
          (sub_id, tenant_id, plan_code, storage_limit_gb, support_tier, sla_uptime_pct, renewal_auto, feature_flags, is_active)
         VALUES (?, ?, ?, ?, 'STANDARD', '99.50', 1, ?, 1)`,
        [randomUUID(), tenantId, plan.plan_id, plan.storage_limit_gb, featureFlags],
      );
    }

    for (const protectedUser of protectedUsers) {
      await conn.query(
        `INSERT INTO \`${masterDatabase}\`.user_auth_index (email, user_id, tenant_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), tenant_id = VALUES(tenant_id), updated_at = CURRENT_TIMESTAMP`,
        [protectedUser.email, protectedUser.user_id, tenantId],
      );
    }

    if (mode === 'VERIFY') {
      await conn.rollback();
      console.log('Verified; transaction rolled back.');
    } else {
      await conn.commit();
      console.log('Applied successfully.');
    }
  } catch (error) {
    try { await conn.rollback(); } catch { /* no transaction was open */ }
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

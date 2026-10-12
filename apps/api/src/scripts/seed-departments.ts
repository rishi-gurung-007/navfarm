/**
 * Departments (Rishi, 12 Oct). Per company in the tenant database:
 *  a. creates, only where no equivalent exists, the departments Stores,
 *     Farm Operations and Feed Mill as DEPARTMENT cost centres (an existing
 *     department matching by code, ignoring case and a DEPT- prefix, or by
 *     name, ignoring a trailing "(note)", is reused, never renamed);
 *  b. gives each existing user with NO department one: Mill Manager role ->
 *     Feed Mill; Farm Manager / Standard User -> Farm Operations; admin types
 *     -> Stores. A Tenant Admin counts as the admin of the tenant's only
 *     company, and is skipped when there are several. A department already on
 *     a user is never changed.
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a second run plans nothing.
 * The database is DEV_TENANT_DATABASE (default nf_devco). Run once per tenant
 * database on a server, pointing DEV_TENANT_DATABASE at each.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { DEPARTMENT_COST_CENTER_TYPE } from '../common/department-identity';
import {
  isEmptyPlan, MILL_MANAGER_ROLE_CODE, planDepartmentSeed,
  type CompanyRow, type DepartmentRow, type MillRoleHolder, type UserRow,
} from './seed-departments.lib';

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local databases.`);
  }
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  try {
    await db.beginTransaction();
    const [companies] = await db.query<RowDataPacket[]>(
      'SELECT company_id, tenant_id FROM company_master WHERE deleted_at IS NULL AND is_active = 1 ORDER BY company_code FOR UPDATE');
    const [depts] = await db.query<RowDataPacket[]>(
      `SELECT cost_center_id, company_id, cost_center_code, cost_center_name, is_active, deleted_at
         FROM cost_center_master WHERE cost_center_type = ?`, [DEPARTMENT_COST_CENTER_TYPE]);
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT user_id, email, user_type, company_id, department_id FROM user_master WHERE deleted_at IS NULL AND is_active = 1 ORDER BY email FOR UPDATE');
    const [mill] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT a.user_id, r.company_id FROM user_role_assignment a
         JOIN role_master r ON r.role_id = a.role_id
        WHERE r.role_code = ? AND a.is_active = 1 AND (a.expires_at IS NULL OR a.expires_at > NOW())`, [MILL_MANAGER_ROLE_CODE]);

    const plan = planDepartmentSeed(
      companies as unknown as CompanyRow[], depts as unknown as DepartmentRow[],
      users as unknown as UserRow[], mill as unknown as MillRoleHolder[],
    );

    let created = 0;
    let assigned = 0;
    if (verify || apply) {
      const ids = new Map<string, string>(); // company|code -> cost_center_id
      for (const d of plan.departments) {
        let id = d.existing_id;
        if (d.action === 'create') {
          const tenantId = (companies as RowDataPacket[]).find((c) => c.company_id === d.company_id)!.tenant_id;
          id = randomUUID();
          await db.query(
            `INSERT INTO cost_center_master (cost_center_id, tenant_id, company_id, cost_center_code, cost_center_name, cost_center_type, is_active, status)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE')`,
            [id, tenantId, d.company_id, d.code, d.name, DEPARTMENT_COST_CENTER_TYPE],
          );
          created += 1;
        }
        if (id) ids.set(`${d.company_id}|${d.code}`, id);
      }
      for (const u of plan.users) {
        if (u.action !== 'assign') continue;
        const [res] = await db.query<mysql.ResultSetHeader>(
          'UPDATE user_master SET department_id = ? WHERE user_id = ? AND department_id IS NULL',
          [ids.get(`${u.company_id}|${u.department}`), u.user_id],
        );
        assigned += res.affectedRows;
      }
    }

    const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY';
    console.log(`Database: ${database}   Mode: ${mode}   Plan empty: ${isEmptyPlan(plan)}`);
    console.log('\nDepartments');
    console.table(plan.departments.map((d) => ({
      company: d.company_id, department: `${d.code} "${d.name}"`, action: d.action,
      existing: d.existing_code ?? '', note: d.note ?? '',
    })));
    console.log('Users without a department');
    console.table(plan.users.map((u) => ({
      company: u.company_id ?? '(none)', email: u.email, department: u.department ?? '', action: u.action, reason: u.reason,
    })));
    console.log(`Written: ${created} department(s), ${assigned} user(s).`);

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message); process.exit(1); });
}

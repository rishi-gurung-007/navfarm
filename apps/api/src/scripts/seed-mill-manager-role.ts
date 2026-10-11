/**
 * Adds the Feed Mill Manager role (MILL_MANAGER, Rishi 11 Oct) and its
 * permission rows to every existing company that lacks them. New companies get
 * it from default-role-seed.ts; this is the same definition (role/mill-manager-role.ts)
 * for companies seeded before it existed.
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a second run plans nothing.
 * The database is DEV_TENANT_DATABASE (default nf_devco). Run once per tenant
 * database on a server, pointing DEV_TENANT_DATABASE at each.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { MILL_MANAGER_GRANTS, MILL_MANAGER_ROLE } from '../modules/core/role/mill-manager-role';
import { planMillManagerRole, type CompanyRow, type PermRow, type RoleRow } from './seed-mill-manager-role.lib';

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
    const [companies] = await db.query<RowDataPacket[]>('SELECT company_id FROM company_master WHERE deleted_at IS NULL FOR UPDATE');
    const [roles] = await db.query<RowDataPacket[]>('SELECT role_id, company_id, role_code FROM role_master');
    const [perms] = await db.query<RowDataPacket[]>(
      `SELECT p.role_id, p.module_code, p.resource FROM role_permissions p
         JOIN role_master r USING (role_id) WHERE r.role_code = ?`, [MILL_MANAGER_ROLE.role_code],
    );
    const plan = planMillManagerRole(companies as unknown as CompanyRow[], roles as unknown as RoleRow[], perms as unknown as PermRow[]);

    let rolesWritten = 0;
    let permsWritten = 0;
    if (verify || apply) {
      for (const p of plan) {
        let roleId = (roles as unknown as RoleRow[]).find((r) => r.company_id === p.company_id && r.role_code === MILL_MANAGER_ROLE.role_code)?.role_id;
        if (p.createRole) {
          roleId = randomUUID();
          await db.query(
            'INSERT INTO role_master (role_id, company_id, role_code, role_name, role_description, is_system_role) VALUES (?, ?, ?, ?, ?, 1)',
            [roleId, p.company_id, MILL_MANAGER_ROLE.role_code, MILL_MANAGER_ROLE.role_name, MILL_MANAGER_ROLE.role_description],
          );
          rolesWritten += 1;
        }
        for (const g of MILL_MANAGER_GRANTS.filter((x) => p.missingGrants.includes(`${x.module}/${x.resource}`))) {
          await db.query(
            `INSERT INTO role_permissions
               (perm_id, role_id, module_code, resource, can_view, can_create, can_edit, can_delete, can_approve, can_export, can_print)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), roleId, g.module, g.resource, +!!g.view, +!!g.create, +!!g.edit, +!!g.del, +!!g.approve, +!!g.view, +!!g.view],
          );
          permsWritten += 1;
        }
      }
    }

    console.log(JSON.stringify({
      database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      role: MILL_MANAGER_ROLE.role_code,
      plan: plan.map((p) => ({ company_id: p.company_id, createRole: p.createRole, grantRowsToInsert: p.missingGrants.length })),
      rolesWritten, permissionRowsWritten: permsWritten,
    }, null, 2));

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

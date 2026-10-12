/**
 * Grants PROCUREMENT/REQUISITION permissions to the seeded demo roles (WP1f —
 * decisions.md 2026-10-05, "Demo roles get requisition permissions").
 *
 * Until now MANAGER and OPERATOR held no PROCUREMENT rows at all, so the demo
 * Farm Manager, Head of Farms and Standard User were refused on every
 * requisition route by the permission guard before any scope logic ran (found
 * during WP1e's live check, where the check needed a temporary SUPER_ADMIN
 * grant purely to reach the code under test).
 *
 * Rishi's grant, exactly:
 *   - Farm Manager and Head of Farms (OPERATIONAL_ADMIN) roles:
 *       view, create, edit, submit, approve.
 *   - Standard User / Operator roles: view, create, edit, submit — NOT approve.
 *   - Release, shipment, receipt and Direct Transfer stay as configured; they
 *     are not part of this grant (release/link-po read REQUISITION 'approve',
 *     shipment/receipt read INVENTORY/STOCK_TRANSFER 'edit').
 *
 * There is no can_submit column: the submit route is guarded by the same
 * 'create' action as drafting, so "submit" rides on can_create.
 *
 * In this demo database the OPERATIONAL_ADMIN ("Head of Farms") persona holds
 * the MANAGER role and the STANDARD_USER persona holds OPERATOR (verified in
 * user_role_assignment on 5 Oct); the grant therefore targets those two role
 * codes and invents nothing for the others (ACCOUNTANT, SUPER_ADMIN, and any
 * code the decision does not name).
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only — a non-local host is refused.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

export interface RoleRow { role_id: string; role_code: string; is_active: number }
export interface PermRow {
  role_id: string; module_code: string; resource: string;
  can_view: number; can_create: number; can_edit: number; can_delete: number; can_approve: number;
}

export interface RequisitionGrant {
  role_id: string; role_code: string;
  view: number; create: number; edit: number; approve: number;
  submitNote: 'submit rides on create';
}

/** The roles the decision names, by code, in the live nf_devco demo data. */
const APPROVING_ROLE_CODES = ['MANAGER']; // Farm Manager; demo OPERATIONAL_ADMIN (Head of Farms) users hold MANAGER
const SUBMITTING_ROLE_CODES = ['OPERATOR']; // Standard User / Operator

export function planRequisitionPermissionGrants(roles: RoleRow[], perms: PermRow[]): { grants: RequisitionGrant[]; skipped: Array<{ role_code: string; why: string }> } {
  const grants: RequisitionGrant[] = [];
  const skipped: Array<{ role_code: string; why: string }> = [];
  for (const r of roles) {
    if (!r.is_active) {
      skipped.push({ role_code: r.role_code, why: 'role is inactive' });
      continue;
    }
    if (!APPROVING_ROLE_CODES.includes(r.role_code) && !SUBMITTING_ROLE_CODES.includes(r.role_code)) {
      skipped.push({ role_code: r.role_code, why: 'the decision does not name this role' });
      continue;
    }
    if (perms.some((p) => p.role_id === r.role_id && p.module_code === 'ALL' && p.resource === 'ALL')) {
      skipped.push({ role_code: r.role_code, why: 'holds ALL/ALL' });
      continue;
    }
    if (perms.some((p) => p.role_id === r.role_id && p.module_code === 'PROCUREMENT' && p.resource === 'REQUISITION')) {
      skipped.push({ role_code: r.role_code, why: 'already holds PROCUREMENT/REQUISITION' });
      continue;
    }
    const approving = APPROVING_ROLE_CODES.includes(r.role_code);
    grants.push({ role_id: r.role_id, role_code: r.role_code, view: 1, create: 1, edit: 1, approve: approving ? 1 : 0, submitNote: 'submit rides on create' });
  }
  return { grants, skipped };
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local demo databases.`);
  }

  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '',
    database, ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-requisition-perms', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another requisition-permission alignment run is active.');
    await db.beginTransaction();

    const [roles] = await db.query<RowDataPacket[]>('SELECT role_id, role_code, is_active FROM role_master');
    const [perms] = await db.query<RowDataPacket[]>(
      `SELECT role_id, module_code, resource, can_view, can_create, can_edit, can_delete, can_approve
         FROM role_permissions WHERE module_code IN ('PROCUREMENT','ALL')`,
    );

    const { grants, skipped } = planRequisitionPermissionGrants(roles as unknown as RoleRow[], perms as unknown as PermRow[]);

    if (verify || apply) {
      for (const g of grants) {
        await db.query(
          `INSERT INTO role_permissions
             (perm_id, role_id, module_code, resource, can_view, can_create, can_edit, can_delete, can_approve, can_export, can_print)
           VALUES (?, ?, 'PROCUREMENT', 'REQUISITION', ?, ?, ?, 0, ?, 0, 0)`,
          [randomUUID(), g.role_id, g.view, g.create, g.edit, g.approve],
        );
      }
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT r.role_code, p.can_view v, p.can_create c, p.can_edit e, p.can_approve a
         FROM role_master r JOIN role_permissions p USING (role_id)
        WHERE p.module_code = 'PROCUREMENT' AND p.resource = 'REQUISITION'
        ORDER BY r.role_code`,
    );

    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      grant: 'PROCUREMENT/REQUISITION — view, create, edit, submit (rides on create), approve per role',
      grants,
      skipped,
      grantsAfter: after.map((r) =>
        `${r.role_code}: ${[r.v && 'view', r.c && 'create', r.e && 'edit', r.a && 'approve'].filter(Boolean).join(',') || 'none'}`),
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-requisition-perms')");
    await db.end();
  }
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message); process.exit(1); });
}

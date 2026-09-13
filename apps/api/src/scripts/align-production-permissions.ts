/**
 * Reconciles the PRODUCTION grants in role_permissions with the resources the
 * API actually checks, and gives daily data entry its own resource.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * Two things are wrong in the live data:
 *
 * 1. Every role holds PRODUCTION/SCHEDULER, which no endpoint has ever asked
 *    for — the guard checks BATCH_SCHEDULE. The grant reads as if the farm
 *    supervisor can see the schedulers; in fact nobody below an admin can open
 *    one. Renamed rather than re-inserted so the perm_id survives.
 *
 * 2. Recording a day was guarded by BATCH_SCHEDULE, which conflates designing
 *    a schedule with entering against one. It is now PRODUCTION/BATCH_ENTRY,
 *    and no existing role holds it.
 *
 * The action set for BATCH_ENTRY is derived from what each role already holds
 * on PRODUCTION/BATCH rather than from role names:
 *
 *   view    ← already sees batches
 *   create  ← already records against them
 *   edit    ← already approves them, i.e. is supervisory
 *   approve ← same
 *
 * edit is the one that matters: on this resource it does not mean "may record"
 * — create covers that — it means "may change a day that is not today". A farm
 * that renames its roles, or adds a fifth, gets the right answer without
 * anyone editing a list of role names.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const database = process.env.DEV_TENANT_DATABASE || 'tenant_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-prod-perms', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another permission alignment run is active.');
    await db.beginTransaction();

    const [roles] = await db.query<RowDataPacket[]>(
      `SELECT r.role_id, r.role_code, r.is_active FROM role_master r WHERE r.is_active = 1`,
    );
    const [perms] = await db.query<RowDataPacket[]>(
      `SELECT perm_id, role_id, module_code, resource, can_view, can_create, can_edit, can_approve
         FROM role_permissions WHERE module_code IN ('PRODUCTION','ALL')`,
    );

    const renamed: any[] = [];
    const granted: any[] = [];
    const skipped: any[] = [];

    /* ── 1. SCHEDULER → BATCH_SCHEDULE ──────────────────────────────────── */
    for (const perm of perms.filter((p) => p.module_code === 'PRODUCTION' && p.resource === 'SCHEDULER')) {
      const role = roles.find((r) => r.role_id === perm.role_id);
      if (perms.some((p) => p.role_id === perm.role_id && p.resource === 'BATCH_SCHEDULE')) {
        skipped.push({ rename: 'SCHEDULER → BATCH_SCHEDULE', role: role?.role_code, why: 'already holds BATCH_SCHEDULE' });
        continue;
      }
      if (apply || verify) {
        await db.query(`UPDATE role_permissions SET resource = 'BATCH_SCHEDULE' WHERE perm_id = ?`, [perm.perm_id]);
      }
      renamed.push({ role: role?.role_code ?? perm.role_id, from: 'SCHEDULER', to: 'BATCH_SCHEDULE' });
    }

    /* ── 2. BATCH_ENTRY, derived from each role's own BATCH grant ───────── */
    for (const role of roles) {
      if (perms.some((p) => p.role_id === role.role_id && p.module_code === 'ALL' && p.resource === 'ALL')) {
        skipped.push({ grant: 'BATCH_ENTRY', role: role.role_code, why: 'holds ALL/ALL' });
        continue;
      }
      if (perms.some((p) => p.role_id === role.role_id && p.resource === 'BATCH_ENTRY')) {
        skipped.push({ grant: 'BATCH_ENTRY', role: role.role_code, why: 'already granted' });
        continue;
      }
      const batch = perms.find((p) => p.role_id === role.role_id && p.module_code === 'PRODUCTION' && p.resource === 'BATCH');
      if (!batch || !batch.can_view) {
        skipped.push({ grant: 'BATCH_ENTRY', role: role.role_code, why: 'role does not see batches' });
        continue;
      }

      const supervisory = !!batch.can_approve;
      const grant = {
        view: true,
        create: !!batch.can_create,
        // Not "may record" — that is create. This is "may change a day that is
        // not today", which is why only a supervisory role receives it.
        edit: supervisory,
        approve: supervisory,
      };
      if (apply || verify) {
        await db.query(
          `INSERT INTO role_permissions
             (perm_id, role_id, module_code, resource, can_view, can_create, can_edit, can_delete, can_approve, can_export, can_print)
           VALUES (?, ?, 'PRODUCTION', 'BATCH_ENTRY', ?, ?, ?, 0, ?, 1, 1)`,
          [randomUUID(), role.role_id, grant.view, grant.create, grant.edit, grant.approve],
        );
      }
      granted.push({ role: role.role_code, ...grant });
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT r.role_code, p.resource, p.can_view v, p.can_create c, p.can_edit e, p.can_approve a
         FROM role_master r JOIN role_permissions p USING (role_id)
        WHERE p.module_code = 'PRODUCTION' AND p.resource IN ('BATCH_ENTRY','BATCH_SCHEDULE','SCHEDULER')
        ORDER BY r.role_code, p.resource`,
    );

    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      renamed,
      granted,
      skipped,
      productionEntryGrantsAfter: after.map((r) =>
        `${r.role_code}/${r.resource}: ${[r.v && 'view', r.c && 'create', r.e && 'edit', r.a && 'approve'].filter(Boolean).join(',') || 'none'}`),
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-prod-perms')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

/** Give the seeded standard user an operational area.
 * Read-only by default; --verify writes and rolls back; --apply commits.
 *
 * The seeds assign areas to the tenant, company and operational admins but never
 * to user@triplec.local, so with correct scope headers every operational call as
 * the operator is refused "Not authorized for this operational area". Requested
 * by Rishi on 2026-09-14. This is an existing-row repair, not a seed.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

const TENANT_DB = 'tenant_devco';
const OPERATOR_EMAIL = 'user@triplec.local';
const AREA_CODE = 'PIGGERY-01';

async function run() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(f => !['--verify', '--apply'].includes(f))) throw new Error('Use --verify, --apply, or no flags.');
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '',
    database: TENANT_DB,
  });
  try {
    await db.beginTransaction();
    const [users] = await db.query<RowDataPacket[]>(
      'SELECT user_id, user_type, company_id FROM user_master WHERE email=? AND deleted_at IS NULL', [OPERATOR_EMAIL]);
    if (users.length !== 1) throw new Error(`Expected exactly one ${OPERATOR_EMAIL}, found ${users.length}.`);
    const user = users[0];
    if (user.user_type !== 'STANDARD_USER') throw new Error(`${OPERATOR_EMAIL} is ${user.user_type}, not STANDARD_USER; review before assigning.`);

    const [areas] = await db.query<RowDataPacket[]>(
      'SELECT area_id, company_id, area_name FROM operational_area_master WHERE area_code=?', [AREA_CODE]);
    if (areas.length !== 1) throw new Error(`Expected exactly one ${AREA_CODE}, found ${areas.length}.`);
    const area = areas[0];
    // RolesGuard requires the area to belong to the user's company; assigning across companies would still 403.
    if (area.company_id !== user.company_id) throw new Error(`${AREA_CODE} belongs to company ${area.company_id}, the operator to ${user.company_id}.`);

    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT assignment_id, is_primary FROM user_operational_area_assignment WHERE user_id=? FOR UPDATE', [user.user_id]);
    const [sameArea] = await db.query<RowDataPacket[]>(
      'SELECT assignment_id FROM user_operational_area_assignment WHERE user_id=? AND area_id=?', [user.user_id, area.area_id]);

    const plan = sameArea.length
      ? { action: 'NONE', reason: `${OPERATOR_EMAIL} is already assigned to ${AREA_CODE}.` }
      : { action: 'INSERT', user_id: user.user_id, area_id: area.area_id, area_name: area.area_name,
          company_id: area.company_id, is_primary: existing.length === 0, existing_assignments: existing.length };
    console.log(JSON.stringify({ mode: flags[0] || 'READ-ONLY', plan }, null, 2));

    if (flags.length && plan.action === 'INSERT') {
      await db.execute(
        'INSERT INTO user_operational_area_assignment (assignment_id, user_id, area_id, company_id, is_primary) VALUES (?,?,?,?,?)',
        [randomUUID(), user.user_id, area.area_id, area.company_id, existing.length === 0 ? 1 : 0]);
    }
    if (flags[0] === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

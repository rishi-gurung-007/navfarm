/**
 * Prepare the two explicitly labelled users and two batches used by the Phase 1
 * live farm-scope gate. Read-only by default; --verify writes and rolls back;
 * --apply commits. Phase 3's demo rebuild removes this verification fixture.
 */
import { randomUUID } from 'crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const TENANT_DB = 'tenant_devco';
const AREA_CODE = 'PIGGERY-01';
const SOURCE_EMAIL = 'user@triplec.local';
const POR_EMAIL = 'verification.por100@triplec.local';
const MARKER = 'DEMO VERIFICATION';
const FARM_BATCHES = [
  { farmCode: 'MUL100', batchNo: 'PIG-BAT-2026-0001', name: `${MARKER} — Grasmere Worker` },
  { farmCode: 'POR100', batchNo: 'PIG-BAT-2026-0002', name: `${MARKER} — Kintyre Worker` },
] as const;

async function run() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some((flag) => !['--verify', '--apply'].includes(flag))) {
    throw new Error('Use --verify, --apply, or no flags.');
  }
  const mutating = flags[0] === '--verify' || flags[0] === '--apply';
  const lock = mutating ? ' FOR UPDATE' : '';

  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: TENANT_DB,
  });

  try {
    if (mutating) await db.beginTransaction();
    const [sources] = await db.query<RowDataPacket[]>(
      `SELECT user_id, tenant_id, company_id, password_hash
         FROM user_master
        WHERE email=? AND user_type='STANDARD_USER' AND deleted_at IS NULL
        ${lock}`,
      [SOURCE_EMAIL],
    );
    if (sources.length !== 1) throw new Error(`Expected exactly one active standard user ${SOURCE_EMAIL}, found ${sources.length}.`);
    const source = sources[0];

    const [areas] = await db.query<RowDataPacket[]>(
      `SELECT area_id, company_id, lob_id
         FROM operational_area_master
        WHERE area_code=? AND is_active=1 AND deleted_at IS NULL`,
      [AREA_CODE],
    );
    if (areas.length !== 1) throw new Error(`Expected exactly one active ${AREA_CODE}, found ${areas.length}.`);
    const area = areas[0];
    if (area.company_id !== source.company_id) throw new Error(`${AREA_CODE} and ${SOURCE_EMAIL} belong to different companies.`);

    const [sourceRoles] = await db.query<RowDataPacket[]>(
      `SELECT role_id, assigned_by
         FROM user_role_assignment
        WHERE user_id=? AND is_active=1`,
      [source.user_id],
    );
    if (sourceRoles.length !== 1) throw new Error(`Expected exactly one active role for ${SOURCE_EMAIL}, found ${sourceRoles.length}.`);

    const plan: Record<string, unknown>[] = [];
    const users: Record<string, string> = {};
    for (const fixture of FARM_BATCHES) {
      const [farms] = await db.query<RowDataPacket[]>(
        `SELECT location_id, location_code
           FROM location_master
          WHERE location_code=? AND company_id=? AND parent_location_id IS NULL
            AND is_active=1 AND deleted_at IS NULL`,
        [fixture.farmCode, source.company_id],
      );
      if (farms.length !== 1) throw new Error(`Expected exactly one active farm ${fixture.farmCode}, found ${farms.length}.`);
      const farm = farms[0];

      const [locations] = await db.query<RowDataPacket[]>(
        `SELECT location_id, location_code
           FROM location_master
          WHERE farm_id=? AND location_id<>? AND is_active=1 AND deleted_at IS NULL
          ORDER BY location_code LIMIT 1`,
        [farm.location_id, farm.location_id],
      );
      if (locations.length !== 1) throw new Error(`No active child location exists on ${fixture.farmCode}.`);
      const location = locations[0];

      const isMul = fixture.farmCode === 'MUL100';
      let userId = source.user_id as string;
      if (!isMul) {
        const [existing] = await db.query<RowDataPacket[]>(
          `SELECT user_id, full_name FROM user_master WHERE email=? AND deleted_at IS NULL${lock}`,
          [POR_EMAIL],
        );
        if (existing.length > 1) throw new Error(`Expected at most one ${POR_EMAIL}, found ${existing.length}.`);
        if (existing[0] && !String(existing[0].full_name).startsWith(MARKER)) {
          throw new Error(`${POR_EMAIL} exists without the ${MARKER} label; refusing to repurpose it.`);
        }
        userId = (existing[0]?.user_id as string | undefined) ?? randomUUID();
        if (!existing[0]) {
          if (mutating) await db.execute(
            `INSERT INTO user_master
              (user_id, company_id, tenant_id, full_name, email, password_hash, user_type, is_active, farm_id)
             VALUES (?,?,?,?,?,?,'STANDARD_USER',1,?)`,
            [userId, source.company_id, source.tenant_id, fixture.name, POR_EMAIL, source.password_hash, farm.location_id],
          );
          plan.push({ action: 'INSERT USER', email: POR_EMAIL, name: fixture.name, farm: fixture.farmCode });
        } else {
          if (mutating) await db.execute('UPDATE user_master SET full_name=?, farm_id=?, is_active=1 WHERE user_id=?', [fixture.name, farm.location_id, userId]);
          plan.push({ action: 'UPDATE USER', email: POR_EMAIL, name: fixture.name, farm: fixture.farmCode });
        }
      } else {
        if (mutating) await db.execute('UPDATE user_master SET full_name=?, farm_id=? WHERE user_id=?', [fixture.name, farm.location_id, userId]);
        plan.push({ action: 'UPDATE USER', email: SOURCE_EMAIL, name: fixture.name, farm: fixture.farmCode });
      }
      users[fixture.farmCode] = userId;

      const [assignment] = await db.query<RowDataPacket[]>(
        'SELECT assignment_id FROM user_operational_area_assignment WHERE user_id=? AND area_id=?',
        [userId, area.area_id],
      );
      if (!assignment.length) {
        if (mutating) await db.execute(
          'INSERT INTO user_operational_area_assignment (assignment_id,user_id,area_id,company_id,is_primary) VALUES (?,?,?,?,1)',
          [randomUUID(), userId, area.area_id, source.company_id],
        );
        plan.push({ action: 'INSERT AREA ASSIGNMENT', user: fixture.name, area: AREA_CODE });
      }

      if (!isMul) {
        const [role] = await db.query<RowDataPacket[]>(
          'SELECT assign_id FROM user_role_assignment WHERE user_id=? AND role_id=? AND is_active=1',
          [userId, sourceRoles[0].role_id],
        );
        if (!role.length) {
          if (mutating) await db.execute(
            'INSERT INTO user_role_assignment (assign_id,user_id,role_id,assigned_by,is_active) VALUES (?,?,?,?,1)',
            [randomUUID(), userId, sourceRoles[0].role_id, sourceRoles[0].assigned_by],
          );
          plan.push({ action: 'INSERT ROLE ASSIGNMENT', user: fixture.name, role_id: sourceRoles[0].role_id });
        }
      }

      const [batches] = await db.query<RowDataPacket[]>(
        `SELECT batch_id, lob_id FROM batch_header WHERE batch_no=? AND deleted_at IS NULL${lock}`,
        [fixture.batchNo],
      );
      if (batches.length !== 1) throw new Error(`Expected exactly one batch ${fixture.batchNo}, found ${batches.length}.`);
      if (batches[0].lob_id !== area.lob_id) throw new Error(`${fixture.batchNo} is not in the ${AREA_CODE} LOB.`);
      if (mutating) await db.execute(
        'UPDATE batch_header SET farm_id=?, location_id=?, updated_by=? WHERE batch_id=?',
        [farm.location_id, location.location_id, userId, batches[0].batch_id],
      );
      plan.push({ action: 'PLACE BATCH', batch: fixture.batchNo, farm: fixture.farmCode, location: location.location_code });
    }

    console.log(JSON.stringify({ mode: flags[0] || 'READ-ONLY', plan, users }, null, 2));
    if (flags[0] === '--apply') {
      await db.commit();
      console.log('Committed.');
    } else if (flags[0] === '--verify') {
      await db.rollback();
      console.log('Rolled back; no changes committed.');
    } else {
      console.log('Read-only; no transaction or write statements executed.');
    }
  } catch (error) {
    if (mutating) await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

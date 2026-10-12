/**
 * Fill requisition.farm_id from the Main / Farm Location where it is NULL
 * (P1 follow-up item 5) by the shared farmOfLocation (common/farm-scope.ts).
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a second run plans
 * nothing. Only rows with farm_id NULL are written, and each UPDATE repeats
 * that condition. The database is DEV_TENANT_DATABASE (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { farmOfLocation } from '../common/farm-scope';
import { planRequisitionFarms, type RequisitionFarmRow } from './fix-requisition-farm.lib';

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
    const [rows] = await db.query<RowDataPacket[]>(
      'SELECT requisition_id, req_no, main_location_id, farm_id FROM requisition WHERE deleted_at IS NULL ORDER BY req_no FOR UPDATE',
    );
    const [locations] = await db.query<RowDataPacket[]>('SELECT location_id, location_code FROM location_master');
    const code = new Map(locations.map((l) => [l.location_id as string, l.location_code as string]));
    // The one shared rule (review p1f, I2), read through the same connection
    // and transaction as the writes below.
    const orm = drizzle(db, { schema, mode: 'default' });
    const plan = await planRequisitionFarms(
      rows as unknown as RequisitionFarmRow[],
      (id) => farmOfLocation(orm as never, id),
      (id) => code.get(id) ?? id,
    );
    let written = 0;
    if (verify || apply) {
      for (const s of plan.set) {
        const [res] = await db.query<mysql.ResultSetHeader>(
          'UPDATE requisition SET farm_id = ? WHERE requisition_id = ? AND farm_id IS NULL', [s.farm_id, s.requisition_id],
        );
        written += res.affectedRows;
      }
    }
    const [[after]] = await db.query<RowDataPacket[]>(
      'SELECT COUNT(*) total, SUM(farm_id IS NULL) farm_null FROM requisition WHERE deleted_at IS NULL',
    );
    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      requisitions: rows.length,
      farmNullBefore: rows.filter((r) => !r.farm_id).length,
      set: plan.set.map((s) => `${s.req_no} -> ${s.farm_code}`),
      unresolved: plan.unresolved,
      mismatchedReportedOnly: plan.mismatched,
      rowsWritten: written,
      after,
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

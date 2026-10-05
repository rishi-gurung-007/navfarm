/**
 * Copy the Resource name into an empty description on Service requisition
 * lines (review p1f, concern 1; the rule is in
 * fill-service-line-descriptions.lib.ts).
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a filled description is
 * never touched again, and each UPDATE repeats the "empty" condition. The
 * database is DEV_TENANT_DATABASE (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { planServiceDescriptions, type ServiceLineRow } from './fill-service-line-descriptions.lib';

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
      `SELECT l.line_id, r.req_no, l.line_seq, r.doc_type, l.description, l.resource_id, rm.resource_code, rm.resource_name
         FROM requisition_line l
         JOIN requisition r ON r.requisition_id = l.requisition_id
         LEFT JOIN resource_master rm ON rm.resource_id = l.resource_id
        WHERE r.doc_type = 'SERVICE' AND l.resource_id IS NOT NULL
        ORDER BY r.req_no, l.line_seq
        FOR UPDATE`,
    );
    const plan = planServiceDescriptions(rows as unknown as ServiceLineRow[]);
    let written = 0;
    if (verify || apply) {
      for (const s of plan.set) {
        const [res] = await db.query<mysql.ResultSetHeader>(
          "UPDATE requisition_line SET description = ? WHERE line_id = ? AND (description IS NULL OR TRIM(description) = '')",
          [s.description, s.line_id],
        );
        written += res.affectedRows;
      }
    }
    const [[after]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) service_lines_with_resource,
              SUM(l.description IS NULL OR TRIM(l.description) = '') still_empty
         FROM requisition_line l JOIN requisition r ON r.requisition_id = l.requisition_id
        WHERE r.doc_type = 'SERVICE' AND l.resource_id IS NOT NULL`,
    );
    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      serviceLinesWithResource: rows.length,
      set: plan.set.map((s) => `${s.at} -> "${s.description}"`),
      skipped: plan.skipped,
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

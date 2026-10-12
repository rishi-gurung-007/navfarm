/**
 * A fully received feed requisition's document Status is RECEIVED (Rishi, 11 Oct).
 * Rows received before that rule still read RELEASED. This sets document_status
 * to RECEIVED on feed requisitions (those with a feed_requisition_transfer link)
 * whose fulfilment_status is RECEIVED and document_status is RELEASED.
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a second run plans nothing.
 * The database is DEV_TENANT_DATABASE (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

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
      `SELECT r.requisition_id, r.req_no FROM requisition r
       WHERE r.deleted_at IS NULL AND r.fulfilment_status = 'RECEIVED' AND r.document_status = 'RELEASED'
         AND EXISTS (SELECT 1 FROM feed_requisition_transfer t WHERE t.requisition_id = r.requisition_id)
       ORDER BY r.req_no FOR UPDATE`,
    );
    let written = 0;
    if (verify || apply) {
      for (const row of rows) {
        const [res] = await db.query<mysql.ResultSetHeader>(
          "UPDATE requisition SET document_status = 'RECEIVED' WHERE requisition_id = ? AND document_status = 'RELEASED'", [row.requisition_id],
        );
        written += res.affectedRows;
      }
    }
    console.log(JSON.stringify({
      database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      set: rows.map((r) => r.req_no), rowsWritten: written,
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

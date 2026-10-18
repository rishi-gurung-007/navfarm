/**
 * Closes BIO_ASSET batches that were emptied by transfer before batch-transfer.service closed them itself.
 *
 * Disposing a batch's last head has always closed it. Transferring the last head out did not, so every sow
 * group whose sows moved on, and every piglet lot weaned into a grower group, stayed ACTIVE at nil head — the
 * batch lists, Animal Allocation and Data Entry open on them. The posting now closes such a batch; this closes
 * the ones left behind.
 *
 * A batch qualifies only if it is ACTIVE, BIO_ASSET, holds no head (closing_quantity; for a batch-wise batch also
 * its batch_bio_asset_state), has no live animal assigned to it, and its last movement was a posted transfer out. Its actual_end_date is that
 * transfer's date — the day it was emptied — not today.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 * DEV_TENANT_DATABASE picks the tenant database (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

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
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl, dateStrings: true });
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT b.batch_id, b.batch_no, b.tracking_mode,
              (SELECT MAX(t.transfer_date) FROM batch_transfer t
                WHERE t.from_batch_id = b.batch_id AND t.status = 'POSTED') AS emptied_on
         FROM batch_header b
         LEFT JOIN batch_bio_asset_state s ON s.batch_id = b.batch_id
        WHERE b.status = 'ACTIVE' AND b.costing_method = 'BIO_ASSET' AND b.deleted_at IS NULL
          AND COALESCE(b.closing_quantity, 0) <= 0
          -- An animal-wise batch's head is its live animals; its state row may be stale (re-created from the
          -- opening figure by a late consumption). A batch-wise batch's head is the state row.
          AND (b.tracking_mode = 'ANIMAL_WISE' OR COALESCE(s.current_quantity, 0) <= 0)
          AND NOT EXISTS (SELECT 1 FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1)
        ORDER BY b.batch_no`,
    );
    const plan = rows.filter((r) => r.emptied_on);
    const skipped = rows.filter((r) => !r.emptied_on);

    console.log(JSON.stringify({
      database,
      toClose: plan.map((r) => `${r.batch_no} (${r.tracking_mode}, emptied ${String(r.emptied_on).slice(0, 10)})`),
      // Never had head moved out — a batch set up and not yet stocked. Not this script's business.
      leftAlone: skipped.map((r) => r.batch_no),
    }, null, 2));

    if (!apply && !verify) {
      console.log('Read-only. No changes attempted.');
      return;
    }
    await db.beginTransaction();
    for (const r of plan) {
      await db.query(
        `UPDATE batch_header SET status = 'CLOSED', actual_end_date = ?, closing_quantity = 0,
                closed_at = NOW(), updated_at = NOW()
          WHERE batch_id = ? AND status = 'ACTIVE'`,
        [r.emptied_on, r.batch_id],
      );
      await db.query('UPDATE batch_bio_asset_state SET current_quantity = 0, updated_at = NOW() WHERE batch_id = ?', [r.batch_id]);
    }
    const [[after]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS still_active FROM batch_header WHERE batch_id IN (?) AND status = 'ACTIVE'`,
      [plan.length ? plan.map((r) => r.batch_id) : ['']],
    );
    console.log(`Closed ${plan.length}; still ACTIVE among them: ${after.still_active}.`);
    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log('Verified and rolled back. No changes committed.');
    }
  } finally {
    await db.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

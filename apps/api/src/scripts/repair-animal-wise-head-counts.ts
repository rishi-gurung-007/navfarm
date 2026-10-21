/**
 * Brings ACTIVE animal-wise batches' head count back to their live animals, for animals registered straight into
 * them (POST /animal with current_batch_id) before AnimalService.create told the batch.
 *
 * Such an animal joined the batch with no movement, no head on batch_header.closing_quantity or the bio-asset
 * state, and none of her value on the state — so BATCH-000171 read 11 head over 17 live sows. Every animal whose
 * batch is an ACTIVE animal-wise one, and who has no ASSIGN or TRANSFER movement into it, is taken in as the
 * posting now does: an ASSIGN movement on her entry date, +1 head and her book value on the state, her
 * ACQUISITION ledger row given the batch. That includes one already sold or culled out of it — her exit took a
 * head off the batch that had never been added, and repair-bio-asset-residual-value relieves her value, so run
 * this first. closing_quantity is then set to the live animals.
 *
 * Afterwards run db-resync-animal-wise-scheduler-counts for the stage counts.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 * DEV_TENANT_DATABASE picks the tenant database (default nf_devco).
 */
import { randomUUID } from 'crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const LIVE = `(SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1)`;

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl, dateStrings: true });
  try {
    const [orphans] = await db.query<RowDataPacket[]>(
      `SELECT a.animal_id, a.animal_code, a.tenant_id, a.company_id, a.entry_date, a.current_stage_id, a.current_location_id,
              a.is_active, COALESCE(a.book_value, 0) AS book_value, b.batch_id, b.batch_no, b.costing_method
         FROM animal_register a
         JOIN batch_header b ON b.batch_id = a.current_batch_id
        WHERE b.tracking_mode = 'ANIMAL_WISE' AND b.status = 'ACTIVE' AND b.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM animal_movement_log m
                           WHERE m.animal_id = a.animal_id AND m.to_batch_id = b.batch_id
                             AND m.movement_type IN ('ASSIGN', 'TRANSFER'))
        ORDER BY b.batch_no, a.animal_code`,
    );
    const driftQuery = `SELECT b.batch_id, b.batch_no, b.closing_quantity, ${LIVE} AS live
                          FROM batch_header b
                         WHERE b.tracking_mode = 'ANIMAL_WISE' AND b.status = 'ACTIVE' AND b.deleted_at IS NULL
                        HAVING live <> COALESCE(b.closing_quantity, -1)
                         ORDER BY b.batch_no`;
    const [drift] = await db.query<RowDataPacket[]>(driftQuery);

    console.log(JSON.stringify({
      database,
      registeredStraightIn: orphans.map((o) => `${o.batch_no} ${o.animal_code}${o.is_active ? '' : ' (since left)'} ${Number(o.book_value).toFixed(4)}`),
      closingVsLive: drift.map((d) => `${d.batch_no} closing ${Number(d.closing_quantity)} live ${d.live}`),
    }, null, 2));

    if (!apply && !verify) {
      console.log('Read-only. No changes attempted.');
      return;
    }
    await db.beginTransaction();

    for (const o of orphans) {
      await db.query('INSERT INTO animal_movement_log SET ?', [{
        movement_id: randomUUID(),
        tenant_id: o.tenant_id,
        company_id: o.company_id,
        animal_id: o.animal_id,
        movement_type: 'ASSIGN',
        event_date: o.entry_date,
        to_batch_id: o.batch_id,
        to_stage_id: o.current_stage_id,
        to_location_id: o.current_location_id,
        entry_no: o.batch_no,
        remarks: 'Registered straight into the batch; movement added by repair-animal-wise-head-counts',
      }]);
      if (o.costing_method === 'BIO_ASSET') {
        const [res] = await db.query<any>(
          `UPDATE batch_bio_asset_state SET current_quantity = current_quantity + 1, nca_book_value = nca_book_value + ?,
                  updated_at = NOW() WHERE batch_id = ?`,
          [Number(o.book_value).toFixed(4), o.batch_id],
        );
        if (!res.affectedRows) {
          await db.query(
            `INSERT INTO batch_bio_asset_state (state_id, batch_id, stage, current_quantity, nca_book_value) VALUES (?, ?, 'PREMATURE', 1, ?)`,
            [randomUUID(), o.batch_id, Number(o.book_value).toFixed(4)],
          );
        }
      }
      await db.query(
        `UPDATE bio_asset_ledger SET batch_id = ?, batch_no = ?
          WHERE animal_id = ? AND entry_type = 'ACQUISITION' AND batch_id IS NULL`,
        [o.batch_id, o.batch_no, o.animal_id],
      );
    }
    // An exit under the old code took a head off a state that never had hers; the state's head is what is live.
    for (const batchId of new Set(orphans.filter((o) => o.costing_method === 'BIO_ASSET').map((o) => o.batch_id))) {
      await db.query(
        `UPDATE batch_bio_asset_state s SET s.current_quantity = (SELECT COUNT(*) FROM animal_register a
            WHERE a.current_batch_id = s.batch_id AND a.is_active = 1), s.updated_at = NOW()
          WHERE s.batch_id = ? AND s.current_quantity > (SELECT COUNT(*) FROM animal_register a
            WHERE a.current_batch_id = s.batch_id AND a.is_active = 1)`,
        [batchId],
      );
    }
    for (const d of drift) {
      await db.query('UPDATE batch_header SET closing_quantity = ?, updated_at = NOW() WHERE batch_id = ?', [d.live, d.batch_id]);
    }

    const [after] = await db.query<RowDataPacket[]>(driftQuery);
    console.log(`Took in ${orphans.length} animal(s); set ${drift.length} closing quantities; still off: ${after.map((d) => d.batch_no).join(', ') || 'none'}.`);
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

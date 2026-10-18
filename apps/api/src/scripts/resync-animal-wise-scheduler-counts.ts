/**
 * Recounts the head on every open scheduler of an animal-wise batch from the animal register — the count
 * SchedulerHeaderService.syncAnimalWiseCounts keeps when an animal moves. A scheduler created over animals
 * already at its stage took the count typed into the form instead, and kept it until the next move (a
 * Gestation scheduler over eight pregnant sows read 1). The create path now counts the register; this puts
 * the existing ones right.
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
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });
  try {
    // The same count syncAnimalWiseCounts writes: live animals of the batch whose stage has this stage code.
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT h.scheduler_id, b.batch_no, s.stage_code, h.animal_count AS stored_count,
              (SELECT COUNT(*) FROM animal_register a
                 JOIN stage_master sa ON sa.stage_id = a.current_stage_id
                WHERE a.current_batch_id = b.batch_id AND a.is_active = 1 AND sa.stage_code = s.stage_code) AS live
         FROM scheduler_header h
         JOIN batch_header b ON b.batch_id = h.batch_id
         JOIN stage_master s ON s.stage_id = h.stage_id
        WHERE b.tracking_mode = 'ANIMAL_WISE' AND b.status = 'ACTIVE'
          AND h.scheduler_status IN ('ACTIVE', 'DRAFT')
        ORDER BY b.batch_no, s.stage_code`,
    );
    const plan = rows.filter((r) => Number(r.stored_count) !== Number(r.live));
    console.log(JSON.stringify({
      database,
      toRecount: plan.map((r) => `${r.batch_no} ${r.stage_code}: ${Number(r.stored_count)} → ${Number(r.live)}`),
    }, null, 2));

    if (!apply && !verify) {
      console.log('Read-only. No changes attempted.');
      return;
    }
    await db.beginTransaction();
    for (const r of plan) {
      await db.query('UPDATE scheduler_header SET animal_count = ?, updated_at = NOW() WHERE scheduler_id = ?', [r.live, r.scheduler_id]);
    }
    console.log(`Recounted ${plan.length}.`);
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

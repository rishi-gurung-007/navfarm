/**
 * One-off reset ahead of the BATCH_WISE / ANIMAL_WISE tracking-mode rebuild.
 *
 * Wipes every batch- and scheduler-transactional table so the new
 * tracking_mode column, animal_movement_log table, and batch_daily_data.animal_id
 * column can be introduced without a migration path for old rows — this
 * project's dev/reset environment, per the explicit instruction that existing
 * Batch/Scheduler data does not need to survive.
 *
 * animal_register is NEVER touched beyond nulling current_batch_id (which must
 * happen first — every batch_header row it points at is about to disappear).
 * current_stage_id and current_location_id are explicitly preserved: those are
 * the animal's own state, not the batch's, and the whole point of this rebuild
 * is that an animal's history must outlive the batches it passed through.
 *
 * breeding_record, farrowing_record, semen_batch and approval_request all
 * declare their batch FK as ON DELETE SET NULL — they are animal-linked
 * history, not batch data, so they are deliberately left alone here. Deleting
 * the batches they reference will null out the now-meaningless batch pointer
 * automatically; the breeding/farrowing/semen/approval rows themselves survive
 * untouched. This script does not touch them directly.
 *
 * Default is read-only; --verify applies inside a transaction and rolls back;
 * --apply commits. Same shape as align-stages-to-tdd.ts — read that first if
 * this one looks unfamiliar.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;
const database = process.env.DEV_TENANT_DATABASE || 'tenant_navfarmdev';

// Children before parents. Every table here holds a real, non-nullable-in-
// practice dependency on batch_header (directly or via scheduler_header /
// batch_transaction) — this list was built by querying
// information_schema.KEY_COLUMN_USAGE for every FK that actually references
// batch_header in this database, not assumed from the schema file.
const DELETE_ORDER = [
  'scheduler_line_custom_days',
  'notification_alert_log',
  'batch_daily_data',
  'scheduler_line',
  'scheduler_header',
  'batch_mortality_detail',
  'batch_treatment_detail',
  'batch_transaction',
  'batch_input_line',
  'batch_output_line',
  'batch_stage_log',
  'batch_standard_consumption_line',
  'batch_standard',
  'batch_bio_asset_state',
  'batch_cost_variance',
  'batch_attachment',
  'batch_transfer_line',
  'batch_transfer',
  'bio_asset_ledger',
  'qr_code_master',
  'qc_batch_detail',
  'batch_header',
];

// Left alone deliberately — animal-linked history, ON DELETE SET NULL on their
// batch FK, reported here so a reviewer can see they were considered and not
// just missed.
const PRESERVED_TABLES = [
  'breeding_record',
  'farrowing_record',
  'semen_batch',
  'approval_request',
];

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (
    process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) ||
    (apply && verify)
  ) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const db = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    ssl,
  });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>(
      "SELECT GET_LOCK('navfarm-batch-scheduler-reset', 5) acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error('Another reset run is active.');
    await db.beginTransaction();

    const before: Record<string, number> = {};
    for (const table of [...DELETE_ORDER, ...PRESERVED_TABLES]) {
      const [[row]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) c FROM \`${table}\``,
      );
      before[table] = Number(row.c);
    }

    const [[animalBefore]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) total, SUM(current_batch_id IS NOT NULL) with_batch,
              SUM(current_stage_id IS NOT NULL) with_stage, SUM(current_location_id IS NOT NULL) with_location
       FROM animal_register`,
    );

    let unassigned = 0;
    if (apply || verify) {
      const [result] = (await db.query(
        'UPDATE animal_register SET current_batch_id = NULL WHERE current_batch_id IS NOT NULL',
      )) as any;
      unassigned = result.affectedRows;
    }

    const deleted: Record<string, number> = {};
    if (apply || verify) {
      for (const table of DELETE_ORDER) {
        const [result] = (await db.query(`DELETE FROM \`${table}\``)) as any;
        deleted[table] = result.affectedRows;
      }
    }

    const [[animalAfter]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) total, SUM(current_batch_id IS NOT NULL) with_batch,
              SUM(current_stage_id IS NOT NULL) with_stage, SUM(current_location_id IS NOT NULL) with_location
       FROM animal_register`,
    );

    console.log(
      JSON.stringify(
        {
          database,
          mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
          rowCountsBeforeReset: before,
          animalRegisterBefore: animalBefore,
          animalRegisterAfterUnassignOnly:
            apply || verify ? animalAfter : '(not run — read-only mode)',
          animalsUnassignedFromBatch:
            apply || verify ? unassigned : '(not run — read-only mode)',
          rowsDeleted: apply || verify ? deleted : '(not run — read-only mode)',
          preservedUntouched: PRESERVED_TABLES,
          note: 'animal_register.current_stage_id and current_location_id are never modified by this script.',
        },
        null,
        2,
      ),
    );

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(
        verify
          ? 'Verified and rolled back. No changes committed.'
          : 'Read-only. No changes attempted.',
      );
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-batch-scheduler-reset')");
    await db.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

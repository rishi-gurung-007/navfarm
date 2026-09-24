/**
 * Fills animal_register.age_at_entry_weeks for animals registered before the
 * column existed (TDD tracker Excel row 12 / S.No. 11).
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * The rule is the one Rishi settled on 2026-09-08 and the one the service
 * enforces on every write from now on: the age is computed from dob and
 * entry_date whenever a dob exists, and typed by hand only when it does not.
 * So this script computes, and nothing else. An animal with no dob is left
 * NULL and reported — its age is a fact only the farm holds, and inventing a
 * "typical" figure for it would put a number the client never said onto the
 * client's own register.
 *
 * Rows that already carry a value are never overwritten. If a value is there,
 * either a human typed it for a dob-less import or a previous run computed it;
 * neither is this script's to revise.
 *
 * The arithmetic is duplicated from resolveAgeAtEntryWeeks() in
 * animal.service.ts rather than imported, because that module pulls in the
 * whole Nest injector graph for a subtraction. The behaviour is pinned on both
 * sides: animal.service.spec.ts covers the service copy, and this script
 * reports any row where the two would disagree by refusing to write a negative
 * age.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Same flooring as the service: six days into a week is not a week lived. */
function weeksBetween(dob: Date, entryDate: Date): number {
  return Math.floor((entryDate.getTime() - dob.getTime()) / MS_PER_WEEK);
}

/** MySQL DATE columns come back as Date at local midnight; compare as UTC days. */
function toUtcMidnight(value: Date | string): Date {
  const iso = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
  return new Date(`${iso}T00:00:00Z`);
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const db = await mysql.createConnection({ host: '127.0.0.1', user: 'root', database: 'nf_devco' });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-age-at-entry', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another age-at-entry backfill is active.');
    await db.beginTransaction();

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT animal_id, animal_code, entry_type, dob, entry_date, age_at_entry_weeks
         FROM animal_register
        ORDER BY animal_code`,
    );
    if (!rows.length) throw new Error('No animals found — nothing to backfill.');

    const computed: any[] = [];
    const skipped: any[] = [];
    const refused: any[] = [];

    for (const r of rows) {
      if (r.age_at_entry_weeks !== null) {
        skipped.push({ animal: r.animal_code, why: `already set to ${r.age_at_entry_weeks}` });
        continue;
      }
      if (!r.dob) {
        skipped.push({
          animal: r.animal_code,
          entry_type: r.entry_type,
          why: 'no date of birth — age must be entered by hand, not guessed',
        });
        continue;
      }
      if (!r.entry_date) {
        skipped.push({ animal: r.animal_code, why: 'no entry date' });
        continue;
      }

      const dob = toUtcMidnight(r.dob);
      const entry = toUtcMidnight(r.entry_date);
      if (dob > entry) {
        // Real bad data, not a rounding question: the register says the animal
        // arrived before it was born. Reported for the farm to correct rather
        // than papered over with a zero.
        refused.push({ animal: r.animal_code, dob: fmt(dob), entry_date: fmt(entry), why: 'dob falls after entry date' });
        continue;
      }

      const weeks = weeksBetween(dob, entry);
      if (apply || verify) {
        await db.query('UPDATE animal_register SET age_at_entry_weeks = ? WHERE animal_id = ?', [weeks, r.animal_id]);
      }
      computed.push({ animal: r.animal_code, entry_type: r.entry_type, dob: fmt(dob), entry_date: fmt(entry), weeks });
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) total, COUNT(dob) with_dob, COUNT(age_at_entry_weeks) with_age
         FROM animal_register`,
    );

    console.log(JSON.stringify({
      database: 'nf_devco',
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      rule: 'computed from dob and entry_date; never invented where dob is absent',
      computed,
      skipped,
      refusedAsBadData: refused,
      countsAfter: after[0],
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-age-at-entry')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

/**
 * Backfill for three demo-data gaps surfaced by the ANIMAL_WISE batch-creation
 * screen's animal picker and its schedulers, where several original seeded
 * animals showed "—" for Breed/Age/Stage or got no scheduler activities:
 *
 * 1. breed_id pointing at a TEMPLATE breed (breed_master.company_id IS NULL)
 *    instead of that animal's own company-adopted copy. The template/adopt
 *    model already exists in this codebase (see adopt-company-master-
 *    templates.ts) — every template breed used here already has a matching
 *    company-scoped row with the same breed_code + lob_id. Any company-scoped
 *    request (which is the normal, non-tenant-admin path — see
 *    masterScopeConditions() in master-data-scope.ts) can never resolve a
 *    template row, by design: "Templates are never unioned into a company's
 *    independently owned catalog." The seed script linked animals to the raw
 *    template row instead of the adopted one, so every company-scoped lookup
 *    of that animal's breed silently comes back empty. Fixed by repointing
 *    animal_register.breed_id to the matching adopted breed — same
 *    breed_code/lob_id, this animal's own company_id. Animals whose breed has
 *    no adopted copy in their company are left untouched and reported.
 *
 * 2. dob AND age_at_entry_weeks both NULL — the seed script recorded no age
 *    at all for the original demo animals. Backfilled with a species/type-
 *    typical age_at_entry_weeks (industry-standard swine ages, not any real
 *    client's data — this is synthetic demo/dev data end to end). dob is
 *    deliberately left NULL: age_at_entry_weeks is exactly the column this
 *    schema reserves for "age known, birth date not" (see the comment on
 *    animal_register.age_at_entry_weeks in schema.ts).
 *
 * 3. current_stage_id not pointing at this animal's OWN company's stage_master
 *    row — two variants of the same underlying bug, both caught by one query:
 *    (a) a DIFFERENT company's adopted stage (company_id set, just the wrong
 *    one), and (b) the shared TEMPLATE stage itself (company_id IS NULL),
 *    same class of bug as gap #1 but for stage_id instead of breed_id.
 *    stage_master follows the same template/adopt pattern as breed_master, so
 *    every stage_code that exists for one company (or as a template) also
 *    exists as that animal's own company's adopted copy — the seed script's
 *    per-code lookup evidently wasn't scoped by company and grabbed whichever
 *    row (template or another company's) it built/cached last. This is worse
 *    than gap #1: scheduler_header/scheduler_line generation (createForStage()
 *    / generateLinesFromLifecycle()) reads stage_master and breed_lifecycle_
 *    stages by raw stage_id with no company check, so it silently "succeeds"
 *    against the wrong stage — for variant (b) specifically, breed_lifecycle_
 *    stages has no row at all keyed to a template stage_id (lifecycle data is
 *    only ever seeded against adopted stages), so the auto-generated
 *    scheduler comes back with zero activity lines and no error. Fixed the
 *    same way as #1: repoint to this animal's own company's row with the same
 *    stage_code + lob_id.
 *
 * Default is read-only; --verify applies inside a transaction and rolls back;
 * --apply commits. Same shape as align-stages-to-tdd.ts / reset-batch-
 * scheduler-for-tracking-mode.ts — read one of those first if this looks
 * unfamiliar.
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

// Typical age at entry, in weeks, by animal_type — only PIGGERY types appear
// in this tenant's data today; extend if another NOB's animals ever need this.
const TYPICAL_AGE_WEEKS: Record<string, number> = {
  PIGLET: 4, // weaned feeder piglet
  GILT: 24, // replacement breeding gilt, pre-first-service age
  COMMERCIAL_PIG: 16, // grower/finisher stage
  SOW: 130, // mature breeding sow (~2.5 yrs)
  BOAR: 150, // mature herd sire (~3 yrs)
};

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
      "SELECT GET_LOCK('navfarm-fix-animal-breed-age', 5) acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error('Another run of this script is active.');
    await db.beginTransaction();

    // --- 1. breed_id: template -> this animal's own company-adopted copy ---
    const [breedMismatches] = await db.query<RowDataPacket[]>(`
      SELECT ar.animal_id, ar.animal_code, ar.company_id, ar.breed_id AS old_breed_id,
             adopted.breed_id AS new_breed_id, tmpl.breed_code
      FROM animal_register ar
      JOIN breed_master tmpl ON tmpl.breed_id = ar.breed_id AND tmpl.company_id IS NULL
      LEFT JOIN breed_master adopted
        ON adopted.breed_code = tmpl.breed_code
        AND adopted.lob_id = tmpl.lob_id
        AND adopted.company_id = ar.company_id
    `);
    const resolvableBreedFixes = breedMismatches.filter((r) => r.new_breed_id);
    const unresolvableBreedMismatches = breedMismatches.filter(
      (r) => !r.new_breed_id,
    );

    let breedRowsUpdated = 0;
    if (apply || verify) {
      for (const row of resolvableBreedFixes) {
        const [result] = (await db.query(
          'UPDATE animal_register SET breed_id = ? WHERE animal_id = ?',
          [row.new_breed_id, row.animal_id],
        )) as any;
        breedRowsUpdated += result.affectedRows;
      }
    }

    // --- 2. age_at_entry_weeks: backfill where both dob and age are unknown ---
    const [ageGaps] = await db.query<RowDataPacket[]>(`
      SELECT animal_id, animal_code, animal_type
      FROM animal_register
      WHERE dob IS NULL AND age_at_entry_weeks IS NULL
    `);
    const resolvableAgeFixes = ageGaps.filter(
      (r) => TYPICAL_AGE_WEEKS[r.animal_type] != null,
    );
    const unresolvableAgeGaps = ageGaps.filter(
      (r) => TYPICAL_AGE_WEEKS[r.animal_type] == null,
    );

    let ageRowsUpdated = 0;
    if (apply || verify) {
      for (const row of resolvableAgeFixes) {
        const [result] = (await db.query(
          'UPDATE animal_register SET age_at_entry_weeks = ? WHERE animal_id = ?',
          [TYPICAL_AGE_WEEKS[row.animal_type], row.animal_id],
        )) as any;
        ageRowsUpdated += result.affectedRows;
      }
    }

    // --- 3. current_stage_id: another company's stage row -> this animal's own ---
    const [stageMismatches] = await db.query<RowDataPacket[]>(`
      SELECT ar.animal_id, ar.animal_code, ar.company_id, wrong.stage_id AS old_stage_id,
             own.stage_id AS new_stage_id, wrong.stage_code, wrong.company_id AS wrong_company_id
      FROM animal_register ar
      JOIN stage_master wrong ON wrong.stage_id = ar.current_stage_id AND (wrong.company_id IS NULL OR wrong.company_id != ar.company_id)
      LEFT JOIN stage_master own
        ON own.stage_code = wrong.stage_code
        AND own.lob_id = wrong.lob_id
        AND own.company_id = ar.company_id
    `);
    const resolvableStageFixes = stageMismatches.filter((r) => r.new_stage_id);
    const unresolvableStageMismatches = stageMismatches.filter(
      (r) => !r.new_stage_id,
    );

    let stageRowsUpdated = 0;
    if (apply || verify) {
      for (const row of resolvableStageFixes) {
        const [result] = (await db.query(
          'UPDATE animal_register SET current_stage_id = ? WHERE animal_id = ?',
          [row.new_stage_id, row.animal_id],
        )) as any;
        stageRowsUpdated += result.affectedRows;
      }
    }

    console.log(
      JSON.stringify(
        {
          database,
          mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
          breedFix: {
            templateLinkedAnimalsFound: breedMismatches.length,
            resolvedByAdoptedCopy: resolvableBreedFixes.length,
            rowsUpdated:
              apply || verify ? breedRowsUpdated : '(not run — read-only mode)',
            unresolvable: unresolvableBreedMismatches.map((r) => ({
              animal_code: r.animal_code,
              breed_code: r.breed_code,
              company_id: r.company_id,
            })),
          },
          ageFix: {
            animalsWithNoDobOrAge: ageGaps.length,
            resolvedByTypicalAge: resolvableAgeFixes.length,
            rowsUpdated:
              apply || verify ? ageRowsUpdated : '(not run — read-only mode)',
            unresolvable: unresolvableAgeGaps.map((r) => ({
              animal_code: r.animal_code,
              animal_type: r.animal_type,
            })),
          },
          stageFix: {
            crossCompanyStageAnimalsFound: stageMismatches.length,
            resolvedByOwnCompanyStage: resolvableStageFixes.length,
            rowsUpdated:
              apply || verify ? stageRowsUpdated : '(not run — read-only mode)',
            unresolvable: unresolvableStageMismatches.map((r) => ({
              animal_code: r.animal_code,
              stage_code: r.stage_code,
              wrong_company_id: r.wrong_company_id,
            })),
          },
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
    await db.query("SELECT RELEASE_LOCK('navfarm-fix-animal-breed-age')");
    await db.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

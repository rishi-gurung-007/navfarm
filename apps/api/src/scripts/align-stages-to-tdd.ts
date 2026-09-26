/**
 * Brings the Stage Master in line with the TDD tracker's Current Stage list
 * (row 24): QUARANTINE / GILT_GROWER / FLUSH / DRY_SOW / GESTATION / FARROWING
 * / WEANING / PRODUCTIVE_SOW / BOAR_AI / CULLED / DEAD / SOLD / SLAUGHTERED.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * Renames are UPDATEs, never delete-and-insert. breed_lifecycle_stages holds 24
 * rows pointing at stage_id, and gl_mapping_master, batch_header and
 * animal_register all carry the same foreign key — recreating a stage would
 * hand it a new id and strand every one of them. Renaming in place keeps the
 * id, so nothing downstream notices.
 *
 * INSEMINATION is deliberately kept although the TDD's list omits it: BBP-1
 * §1.7 specifies it as one of the eight stages, lifecycle rows may reference
 * it, and dropping a stage is destructive in a way adding one is not. Flagged
 * for the client rather than deleted.
 *
 * Categories follow the TDD's own vocabulary (row 140): PRE_PRODUCTIVE /
 * PRODUCTIVE / OUTPUT / DISPOSAL. A renamed stage keeps the category it
 * already had, so no judgement is imported where the client has not asked for
 * a change.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

/**
 * [current code, new code, new display name]
 *
 * LACTATION is NOT renamed to WEANING. The master already holds both, and they
 * are different kinds of thing: lactation is a ~28-day period the BBP gives a
 * duration and feed standards to, weaning is the event that ends it. Rishi's
 * call is to keep lactation and switch weaning on beside it.
 *
 * SLAUGHTER and DISPOSED are renamed rather than left beside new rows, so the
 * master does not end up holding SLAUGHTER and SLAUGHTERED, DISPOSED and DEAD.
 */
const RENAMES: [string, string, string][] = [
  ['GILT_REARING', 'GILT_GROWER', 'Gilt Grower'],
  ['DRY_PERIOD', 'DRY_SOW', 'Dry Sow'],
  ['SLAUGHTER', 'SLAUGHTERED', 'Slaughtered'],
  ['DISPOSED', 'DEAD', 'Dead'],
];

/**
 * Stages the TDD names that already exist but were switched off. Activating
 * beats inserting: the row keeps its id, so anything that ever referenced it
 * still resolves.
 */
const ACTIVATE = ['WEANING', 'BOAR_AI', 'SLAUGHTERED', 'DEAD'];

/** [code, name, category, sequence, typical days] — genuinely absent. */
const ADDITIONS: [string, string, string, number, number | null][] = [
  ['PRODUCTIVE_SOW', 'Productive Sow', 'PRODUCTIVE', 90, null],
  ['CULLED', 'Culled', 'DISPOSAL', 95, null],
  ['SOLD', 'Sold', 'DISPOSAL', 97, null],
];

/**
 * Named in neither the TDD's stage list nor BBP §1.7. Left switched off rather
 * than deleted — a disabled stage costs nothing, and deleting one is
 * irreversible if anything ever pointed at it. Reported so the client can say
 * whether the farm actually runs them.
 */
const LEFT_INACTIVE = ['FLUSH_SERVICE', 'CB_GROWER'];

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

  const db = await mysql.createConnection({ host, port, user, password, database: process.env.DEV_TENANT_DATABASE || 'nf_devco', ssl });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-stage-tdd', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another stage alignment run is active.');
    await db.beginTransaction();

    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT stage_id, tenant_id, company_id, nob_id, lob_id, stage_code, stage_category FROM stage_master WHERE deleted_at IS NULL',
    );
    if (!existing.length) throw new Error('No stages found — nothing to align.');

    const renamed: any[] = [];
    const added: any[] = [];
    const skipped: any[] = [];

    for (const [from, to, name] of RENAMES) {
      const rows = existing.filter((r) => r.stage_code === from);
      if (!rows.length) { skipped.push({ rename: `${from} → ${to}`, why: 'not present' }); continue; }
      if (existing.some((r) => r.stage_code === to)) {
        skipped.push({ rename: `${from} → ${to}`, why: `${to} already exists` });
        continue;
      }
      for (const r of rows) {
        if (apply || verify) {
          await db.query('UPDATE stage_master SET stage_code = ?, stage_name = ? WHERE stage_id = ?', [to, name, r.stage_id]);
        }
        renamed.push({ from, to, scope: r.company_id ? 'COMPANY' : 'TENANT' });
      }
    }

    const activated: any[] = [];
    for (const code of ACTIVATE) {
      // Read fresh: SLAUGHTERED and DEAD only exist under those names because
      // the rename above just ran inside this transaction.
      const [rows] = await db.query<RowDataPacket[]>(
        'SELECT stage_id, company_id, is_active FROM stage_master WHERE stage_code = ? AND deleted_at IS NULL', [code]);
      for (const r of rows as RowDataPacket[]) {
        if (r.is_active) { skipped.push({ activate: code, why: 'already active' }); continue; }
        if (apply || verify) {
          await db.query('UPDATE stage_master SET is_active = 1 WHERE stage_id = ?', [r.stage_id]);
        }
        activated.push({ code, scope: r.company_id ? 'COMPANY' : 'TENANT' });
      }
    }

    // Every scope that already carries stages gets the additions, so a company
    // copy and the tenant template stay in step.
    const scopes = [...new Map(existing.map((r) => [
      `${r.tenant_id}|${r.company_id ?? ''}|${r.nob_id}|${r.lob_id}`,
      r,
    ])).values()];

    for (const scope of scopes) {
      for (const [code, name, category, sequence, days] of ADDITIONS) {
        const present = existing.some((r) =>
          r.stage_code === code && r.tenant_id === scope.tenant_id &&
          (r.company_id ?? null) === (scope.company_id ?? null));
        if (present) { skipped.push({ add: code, why: 'already exists', scope: scope.company_id ? 'COMPANY' : 'TENANT' }); continue; }
        if (apply || verify) {
          await db.query(
            `INSERT INTO stage_master (stage_id,tenant_id,company_id,nob_id,lob_id,stage_code,stage_name,
               stage_category,stage_sequence,typical_duration_days,min_days_before_move,transition_trigger,
               data_entry_form,scheduler_auto_create,show_on_animal_card,is_system,is_active)
             VALUES (?,?,?,?,?,?,?,?,?,?,0,'MANUAL','STANDARD',1,1,0,1)`,
            [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id,
             code, name, category, sequence, days],
          );
        }
        added.push({ code, name, category, scope: scope.company_id ? 'COMPANY' : 'TENANT' });
      }
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT stage_code, stage_name, stage_category FROM stage_master
        WHERE deleted_at IS NULL AND company_id IS NULL ORDER BY stage_sequence, stage_code`,
    );

    console.log(JSON.stringify({
      database: 'nf_devco',
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      renamed, activated, added, skipped,
      leftInactive: LEFT_INACTIVE,
      keptDespiteNotBeingInTheTddList: ['INSEMINATION'],
      tenantStagesAfter: after.map((r) => `${r.stage_code} (${r.stage_category})`),
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-stage-tdd')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

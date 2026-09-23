/**
 * Backfills the widened no_series table (migration 0111) from no_series_master,
 * which stays authoritative and untouched until every code reference has moved
 * off it (docs/decisions.md, 2026-09-23 — consolidating the two number-series
 * systems into one, keeping no_series_master's feature set under the no_series
 * name/table, because item_template.no_series_id/item_tracking_no_series_id
 * already reference no_series.id and would otherwise all need rewriting).
 *
 * no_series_master keeps two rows per series_code: one company_id IS NULL
 * "template" row and one real-company "copy" row, per master — the documented
 * tenant-is-the-draft/company-is-what's-used pattern every other of the 22
 * template-copy masters follows. This backfill preserves that split rather than
 * collapsing it:
 *
 *   1. The matching NULL-company no_series row is UPDATEd in place from its
 *      NULL-company no_series_master row — no_series.id never changes, so
 *      item_template's existing FKs into it stay valid.
 *   2. One no_series row is INSERTed per company-scoped no_series_master row,
 *      reusing no_series_master.series_id as the new row's id (the two UUID
 *      spaces have never collided) — idempotent via INSERT ... ON DUPLICATE
 *      KEY UPDATE on that id.
 *
 * no_series_master's own mirrored fields (current_seq, last_generated_code)
 * are the reliable ones — no_series's existing last_no_used has already
 * drifted stale for at least ITEM and GL_MAPPING (confirmed live) — so this
 * backfill is one-directional: no_series_master -> no_series, never the
 * reverse.
 *
 * The 5 item-type sub-series (NS-FEED, NS-LVS, NS-MED, NS-RAW, NS-VAC) exist
 * only in no_series (seed-demo-item-catalog.ts) and have no no_series_master
 * counterpart — this script iterates no_series_master rows, so those 5 are
 * never touched.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

// mysql2 expands a JS array `?` param into a comma-separated IN()-style list
// rather than a JSON string, so JSON columns need explicit stringification.
function jsonParam(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const database = process.env.DEV_TENANT_DATABASE || 'tenant_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-merge-no-series', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another merge run is active.');
    await db.beginTransaction();

    const [masterRows] = await db.query<RowDataPacket[]>('SELECT * FROM no_series_master');
    if (!masterRows.length) {
      console.log(JSON.stringify({ database, mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY', note: 'no_series_master is empty — nothing to merge.' }, null, 2));
      await db.rollback();
      return;
    }

    const updatedTemplates: unknown[] = [];
    const insertedCopies: unknown[] = [];
    const skipped: unknown[] = [];

    const templates = masterRows.filter((r) => r.company_id === null);
    const copies = masterRows.filter((r) => r.company_id !== null);

    // 1. Template rows (company_id IS NULL): update the matching existing
    // no_series row in place, by (tenant_id, code), never touching its id.
    for (const nsm of templates) {
      const [[target]] = await db.query<RowDataPacket[]>(
        'SELECT id FROM no_series WHERE tenant_id = ? AND code = ? AND company_id IS NULL LIMIT 1',
        [nsm.tenant_id, nsm.series_code],
      );
      if (!target) {
        skipped.push({ series_code: nsm.series_code, company_id: null, why: 'no matching no_series template row — not expected, left untouched' });
        continue;
      }
      if (apply || verify) {
        await db.query(
          `UPDATE no_series SET
             nob_id = ?, lob_id = ?, prefix = ?, \`separator\` = ?, current_seq = ?,
             reset_frequency = ?, code_segments = ?, prefix_position = ?, seq_separator = ?,
             created_by = ?, updated_by = ?, deleted_at = ?, extension_config = ?,
             blocked = ?, manual_nos = ?,
             last_no_used = COALESCE(?, last_no_used),
             description = COALESCE(?, description)
           WHERE id = ?`,
          [
            nsm.nob_id, nsm.lob_id, nsm.prefix, nsm.separator, nsm.current_seq,
            nsm.reset_frequency, jsonParam(nsm.code_segments), nsm.prefix_position, nsm.seq_separator,
            nsm.created_by, nsm.updated_by, nsm.deleted_at, jsonParam(nsm.extension_config),
            nsm.is_active ? 0 : 1, nsm.allow_manual ? 1 : 0,
            nsm.last_generated_code,
            nsm.series_name,
            target.id,
          ],
        );
      }
      updatedTemplates.push({ series_code: nsm.series_code, no_series_id: target.id });
    }

    // 2. Company-scoped copy rows: insert one no_series row per row, reusing
    // series_id as id. master_type/no_series_code/is_default have no
    // no_series_master equivalent, so they're carried over from the matching
    // template no_series row (same series, same display conventions).
    for (const nsm of copies) {
      const [[tmpl]] = await db.query<RowDataPacket[]>(
        'SELECT master_type, no_series_code, is_default, seq_length AS tmpl_seq_length FROM no_series WHERE tenant_id = ? AND code = ? AND company_id IS NULL LIMIT 1',
        [nsm.tenant_id, nsm.series_code],
      );
      if (apply || verify) {
        await db.query(
          `INSERT INTO no_series (
             id, tenant_id, company_id, nob_id, lob_id, code, description, document_type,
             master_type, no_series_code, prefix, \`separator\`, seq_length, starting_no,
             increment_by, current_seq, reset_frequency, code_segments, prefix_position,
             seq_separator, is_default, manual_nos, last_no_used, blocked,
             created_by, updated_by, created_at, updated_at, deleted_at, extension_config
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             nob_id = VALUES(nob_id), lob_id = VALUES(lob_id), prefix = VALUES(prefix),
             \`separator\` = VALUES(\`separator\`), seq_length = VALUES(seq_length),
             current_seq = VALUES(current_seq), reset_frequency = VALUES(reset_frequency),
             code_segments = VALUES(code_segments), prefix_position = VALUES(prefix_position),
             seq_separator = VALUES(seq_separator), manual_nos = VALUES(manual_nos),
             blocked = VALUES(blocked), last_no_used = COALESCE(VALUES(last_no_used), last_no_used),
             description = COALESCE(VALUES(description), description),
             created_by = VALUES(created_by), updated_by = VALUES(updated_by),
             deleted_at = VALUES(deleted_at), extension_config = VALUES(extension_config)`,
          [
            nsm.series_id, nsm.tenant_id, nsm.company_id, nsm.nob_id, nsm.lob_id,
            nsm.series_code, nsm.series_name, nsm.document_type,
            tmpl?.master_type ?? null, tmpl?.no_series_code ?? null, nsm.prefix, nsm.separator,
            nsm.seq_length ?? tmpl?.tmpl_seq_length ?? 4, null,
            1, nsm.current_seq, nsm.reset_frequency, jsonParam(nsm.code_segments), nsm.prefix_position,
            nsm.seq_separator, tmpl?.is_default ?? true, nsm.allow_manual ? 1 : 0,
            nsm.last_generated_code, nsm.is_active ? 0 : 1,
            nsm.created_by, nsm.updated_by, nsm.created_at, nsm.updated_at, nsm.deleted_at, jsonParam(nsm.extension_config),
          ],
        );
      }
      insertedCopies.push({ series_code: nsm.series_code, company_id: nsm.company_id, no_series_id: nsm.series_id });
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT count(*) AS total,
              sum(case when company_id is null then 1 else 0 end) AS templates,
              sum(case when company_id is not null then 1 else 0 end) AS copies
         FROM no_series`,
    );

    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      updatedTemplates,
      insertedCopies,
      skipped,
      no_series_after: after[0],
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-merge-no-series')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

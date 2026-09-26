/**
 * Drops every SYSTEM_NO_SERIES_SEED-defined number series row and reseeds it.
 *
 * The table had drifted a long way from its own seed: a row per variant rather
 * than per master (six LOCATION_* rows, one more with every location type
 * anyone added), an ANIMAL_PIGGERY still carrying the removed date_format, and
 * a dozen masters configured only by later patch scripts. The seed is now the
 * one description of what the table should hold; this makes the table match it.
 *
 * Scoped to `code IN (SYSTEM_NO_SERIES_SEED codes)`, not a blind DELETE FROM
 * no_series: since the no_series_master/no_series merge (2026-09-23), no_series
 * also carries rows this script never owned (the NS-FEED/NS-LVS/etc item-type
 * sub-series from seed-demo-item-catalog.ts) and item_template.no_series_id now
 * holds a real FK (ON DELETE RESTRICT) into this table. A row still referenced
 * by an item template fails the DELETE with a normal FK error and aborts the
 * whole transaction uncommitted — deliberately: recreating a still-referenced
 * row under a new id would silently orphan that template.
 *
 * current_seq is carried over per document_type — the highest any of a master's
 * variants had reached — so numbering continues rather than restarting into
 * codes that already exist. Existing master codes are never touched.
 *
 * Seeds tenant scope and every company that had rows, since resolveSeriesFor
 * matches scope exactly: a company-scoped record cannot see a tenant-scoped
 * series.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { SYSTEM_NO_SERIES_SEED } from '../core/database/system-master-data-seed';

const TENANT_DB = process.env.RESEED_SERIES_TENANT_DB || 'nf_devco';

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database: TENANT_DB,
  });
  try {
    await db.beginTransaction();

    const seededCodes = SYSTEM_NO_SERIES_SEED.map((s) => s.series_code);
    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT id, code, document_type, tenant_id, company_id, nob_id, lob_id, current_seq FROM no_series WHERE code IN (?)',
      [seededCodes],
    );
    if (!existing.length) throw new Error('No series rows found — refusing to seed into an unknown state.');

    // How far each master had counted, across all of its variants.
    const reached = new Map<string, number>();
    const scopes = new Map<string, RowDataPacket>();
    for (const r of existing) {
      const k = `${r.document_type}::${r.tenant_id}::${r.company_id ?? 'GLOBAL'}`;
      reached.set(k, Math.max(reached.get(k) ?? 0, r.current_seq ?? 0));
      scopes.set(`${r.tenant_id}::${r.company_id ?? 'GLOBAL'}`, r);
    }

    console.log(`\n${TENANT_DB}.no_series — dropping ${existing.length} seeded rows, reseeding ${SYSTEM_NO_SERIES_SEED.length} per scope across ${scopes.size} scope(s)\n`);

    if (apply || verify) await db.query('DELETE FROM no_series WHERE code IN (?)', [seededCodes]);

    let created = 0;
    for (const [, scope] of scopes) {
      for (const s of SYSTEM_NO_SERIES_SEED) {
        const carried = reached.get(`${s.document_type}::${scope.tenant_id}::${scope.company_id ?? 'GLOBAL'}`) ?? 0;
        if (scope.company_id === null) {
          const shape = s.code_segments ? `[${s.code_segments.join(', ')}]` : `prefix ${s.prefix ?? '(none)'}`;
          console.log(`  ${s.series_code.padEnd(23)} ${shape.padEnd(46)} seq ${String(s.seq_length).padEnd(2)} from ${carried}`);
        }
        created++;
        if (apply || verify) {
          await db.execute(
            'INSERT INTO no_series (id, tenant_id, company_id, nob_id, lob_id, code, description, document_type,' +
            ' prefix, `separator`, seq_separator, seq_length, current_seq, reset_frequency, manual_nos, blocked, code_segments, prefix_position)' +
            ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
            [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, s.series_code, s.series_name, s.document_type,
             s.prefix ?? null, s.separator, s.seq_separator ?? null, s.seq_length, carried, s.reset_frequency,
             s.allow_manual ?? false, s.code_segments ? JSON.stringify(s.code_segments) : null, s.prefix_position ?? 'END']
          );
        }
      }
    }

    console.log(`\nmode: ${apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY'}   dropped: ${existing.length}   seeded: ${created}`);
    console.log('Master codes untouched; counters carried over so numbering continues.');
    if (apply) { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log(verify ? 'Verified and rolled back.' : 'Read-only. No changes attempted.'); }
  } finally {
    await db.end();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });

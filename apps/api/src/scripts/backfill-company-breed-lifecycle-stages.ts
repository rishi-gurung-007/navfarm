/**
 * Backfill for a demo-data gap surfaced while asking for a "rich" set of
 * required activities on a new ANIMAL_WISE batch's auto-generated scheduler:
 * SchedulerHeaderService.generateLinesFromLifecycle() reads breed_lifecycle_
 * stages by (breed_id, stage_id) — and for two of this tenant's three swine
 * breeds (Duroc, Yorkshire), the company-adopted copy of breed_lifecycle_
 * stages has NO ROWS AT ALL. Every stage for those two breeds silently
 * produces zero auto-generated activities under any company-scoped request
 * (the normal, non-tenant-admin path), even though the TEMPLATE rows
 * (company_id IS NULL) are fully populated for every stage. The third breed
 * (Landrace) does have adopted rows for every stage, but two columns —
 * medication_protocol and vaccination_protocol — are NULL on every one of
 * them despite the template carrying real dosing schedules; every other
 * column (feed qty, mortality %, output qty, body weight standards) was
 * correctly copied, confirming this is a narrow, mechanical gap in whatever
 * process adopted these templates, not an intentional per-company override.
 *
 * Fixed the same way as the two earlier animal_register backfills this
 * session (breed_id/current_stage_id template-vs-adopted mismatches): for
 * every real company, for every template breed_lifecycle_stages row, ensure
 * a matching company-scoped row exists —
 *   - if none exists at all for that (company, breed_code, stage_code): a
 *     full copy is inserted, remapping only company_id/breed_id/stage_id to
 *     that company's own adopted breed/stage (and lifecycle_id to a fresh
 *     UUID) — every other column, including medication/vaccination
 *     protocols, comes straight from the template;
 *   - if a row already exists but medication_protocol and/or
 *     vaccination_protocol are NULL while the template has real values: only
 *     those two columns are backfilled — every other column (which the
 *     comparison above confirms already matches the template) is left
 *     completely untouched, so nothing already-correct or intentionally
 *     customized is at risk of being overwritten.
 *
 * Default is read-only; --verify applies inside a transaction and rolls back;
 * --apply commits. Same shape as the other db-*.ts scripts in this folder.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;
const database = process.env.DEV_TENANT_DATABASE || 'tenant_navfarmdev';

// mysql2 returns JSON columns already parsed into JS objects/arrays — passing
// one straight back through another `?` placeholder for a JSON column fails
// ("Invalid JSON text"), so every JSON-typed value read from `tmpl` needs to
// be re-stringified before going into an INSERT/UPDATE.
const toJsonParam = (value: unknown): string | null =>
  value == null ? null : JSON.stringify(value);

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
      "SELECT GET_LOCK('navfarm-backfill-breed-lifecycle', 5) acquired",
    );
    if (Number(lock.acquired) !== 1)
      throw new Error('Another run of this script is active.');
    await db.beginTransaction();

    const [companies] = await db.query<RowDataPacket[]>(
      "SELECT company_id, company_code FROM company_master WHERE company_code <> 'PLACEHOLDER'",
    );

    const [templateRows] = await db.query<RowDataPacket[]>(`
      SELECT bls.*, tmplBreed.breed_code, tmplStage.stage_code
      FROM breed_lifecycle_stages bls
      JOIN breed_master tmplBreed ON tmplBreed.breed_id = bls.breed_id AND tmplBreed.company_id IS NULL
      JOIN stage_master tmplStage ON tmplStage.stage_id = bls.stage_id AND tmplStage.company_id IS NULL
      WHERE bls.company_id IS NULL
    `);

    const inserted: Array<{
      company: string;
      breed_code: string;
      stage_code: string;
    }> = [];
    const protocolsBackfilled: Array<{
      company: string;
      breed_code: string;
      stage_code: string;
    }> = [];
    const unresolved: Array<{
      company: string;
      breed_code: string;
      stage_code: string;
      reason: string;
    }> = [];

    for (const company of companies) {
      for (const tmpl of templateRows) {
        const [[ownBreed]] = await db.query<RowDataPacket[]>(
          'SELECT breed_id FROM breed_master WHERE company_id = ? AND breed_code = ?',
          [company.company_id, tmpl.breed_code],
        );
        if (!ownBreed) {
          unresolved.push({
            company: company.company_code,
            breed_code: tmpl.breed_code,
            stage_code: tmpl.stage_code,
            reason: 'no adopted breed',
          });
          continue;
        }
        const [[ownStage]] = await db.query<RowDataPacket[]>(
          'SELECT stage_id FROM stage_master WHERE company_id = ? AND stage_code = ?',
          [company.company_id, tmpl.stage_code],
        );
        if (!ownStage) {
          unresolved.push({
            company: company.company_code,
            breed_code: tmpl.breed_code,
            stage_code: tmpl.stage_code,
            reason: 'no adopted stage',
          });
          continue;
        }

        // Matched by breed_id + stage_id alone, deliberately not also
        // requiring bls.company_id = this company: SchedulerHeaderService.
        // generateLinesFromLifecycle() (scheduler-header.service.ts) queries
        // this table the same way — breed_id + stage_id + is_active only —
        // and this tenant's own adopted Landrace rows already carry the
        // correct adopted breed_id with bls.company_id left NULL, proving
        // that column isn't consulted anywhere the app actually reads this
        // table. Requiring it here would insert duplicate rows on top of
        // ones the app already finds and uses correctly.
        const [[existing]] = await db.query<RowDataPacket[]>(
          'SELECT lifecycle_id, medication_protocol, vaccination_protocol FROM breed_lifecycle_stages WHERE breed_id = ? AND stage_id = ?',
          [ownBreed.breed_id, ownStage.stage_id],
        );

        if (!existing) {
          inserted.push({
            company: company.company_code,
            breed_code: tmpl.breed_code,
            stage_code: tmpl.stage_code,
          });
          if (apply || verify) {
            await db.query(
              `INSERT INTO breed_lifecycle_stages (
                lifecycle_id, tenant_id, company_id, nob_id, lob_id, lifecycle_code, breed_id, stage_id, category,
                calc_unit, period_from, period_to, std_teats, season_type, feed_item_id, feed_qty_per_head_per_day_kg,
                feed_wastage_pct, std_body_weight_kg, std_adg_gpd, std_fcr, std_mortality_rate_pct, output_item_id,
                output_uom, std_output_qty, medication_protocol, vaccination_protocol, resource_requirements,
                kpi_lower_limit, kpi_upper_limit, kpi_thresholds, alert_severity, notes, is_active, created_by
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                randomUUID(),
                tmpl.tenant_id,
                company.company_id,
                tmpl.nob_id,
                tmpl.lob_id,
                tmpl.lifecycle_code,
                ownBreed.breed_id,
                ownStage.stage_id,
                tmpl.category,
                tmpl.calc_unit,
                tmpl.period_from,
                tmpl.period_to,
                tmpl.std_teats,
                tmpl.season_type,
                tmpl.feed_item_id,
                tmpl.feed_qty_per_head_per_day_kg,
                tmpl.feed_wastage_pct,
                tmpl.std_body_weight_kg,
                tmpl.std_adg_gpd,
                tmpl.std_fcr,
                tmpl.std_mortality_rate_pct,
                tmpl.output_item_id,
                tmpl.output_uom,
                tmpl.std_output_qty,
                toJsonParam(tmpl.medication_protocol),
                toJsonParam(tmpl.vaccination_protocol),
                toJsonParam(tmpl.resource_requirements),
                tmpl.kpi_lower_limit,
                tmpl.kpi_upper_limit,
                toJsonParam(tmpl.kpi_thresholds),
                tmpl.alert_severity,
                tmpl.notes,
                tmpl.is_active,
                tmpl.created_by,
              ],
            );
          }
          continue;
        }

        const needsMedication =
          !existing.medication_protocol && !!tmpl.medication_protocol;
        const needsVaccination =
          !existing.vaccination_protocol && !!tmpl.vaccination_protocol;
        if (needsMedication || needsVaccination) {
          protocolsBackfilled.push({
            company: company.company_code,
            breed_code: tmpl.breed_code,
            stage_code: tmpl.stage_code,
          });
          if (apply || verify) {
            await db.query(
              `UPDATE breed_lifecycle_stages SET
                medication_protocol = COALESCE(medication_protocol, ?),
                vaccination_protocol = COALESCE(vaccination_protocol, ?)
               WHERE lifecycle_id = ?`,
              [
                toJsonParam(tmpl.medication_protocol),
                toJsonParam(tmpl.vaccination_protocol),
                existing.lifecycle_id,
              ],
            );
          }
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          database,
          mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
          companiesChecked: companies.map((c) => c.company_code),
          templateRowsChecked: templateRows.length,
          fullRowsInserted: inserted.length,
          fullRowsInsertedDetail: inserted,
          protocolsBackfilledCount: protocolsBackfilled.length,
          protocolsBackfilledDetail: protocolsBackfilled,
          unresolved,
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
    await db.query("SELECT RELEASE_LOCK('navfarm-backfill-breed-lifecycle')");
    await db.end();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

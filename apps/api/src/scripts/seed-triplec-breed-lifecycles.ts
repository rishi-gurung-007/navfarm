/**
 * The two Triple C farm breeds (Z-Line-Sow on Grasmere, TN-70-Sow on
 * Kintyre) carry no breed_lifecycle_stages rows, so BatchService's
 * auto-generated schedulers come out with zero lines and the daily-entry
 * demo has nothing to post against. The tenant-generic breeds (YORKSHIRE,
 * LANDRACE, ...) DO carry a full nine-stage lifecycle set, seeded by
 * seed-breed-lifecycle-stages.ts as "illustrative demo benchmarks".
 *
 * This script copies that benchmark set onto the two Triple C farm breeds.
 * The lifecycle feed/output rows point at the legacy tenant "Pig Feed"
 * synthetic item; the copies remap feed_item_id (and any output_item_id) to
 * the real company-scoped Triple C feed items so the demo's daily feed
 * postings draw company FIFO stock, not the synthetic row.
 *
 * Masters are config, not postings, so raw inserts here respect Ruling 1.
 *
 *   pnpm nx run api:db-seed-triplec-breed-lifecycles            # print the plan
 *   pnpm nx run api:db-seed-triplec-breed-lifecycles -- --verify  # apply in a rolled-back tx
 *   pnpm nx run api:db-seed-triplec-breed-lifecycles -- --apply   # commit
 */
import * as mysql from 'mysql2/promise';

const DB = process.env.TENANT_DB_NAME || 'nf_devco';

const FARM_BREED_CODES = ['Z-Line-Sow', 'TN-70-Sow'];
/** Template breed whose lifecycle rows are copied. */
const TEMPLATE_BREED_CODE = 'LANDRACE';

/** The legacy synthetic feed item the template rows point at. */
const LEGACY_FEED_CODES = ['RAW_MATERIAL-ITM-0002'];
/** Real company feed items to use instead, by stage family. */
const REMAP: Record<string, string> = {
  // Lactation/farrowing stages feed the high-density lactation diet.
  FARROWING: 'FEED-FINISHED_SWINE_FEEDS_DIETS-LACTATION-ITM-0001',
  LACTATION: 'FEED-FINISHED_SWINE_FEEDS_DIETS-LACTATION-ITM-0001',
  // Everything else (quarantine, gilt grower, gestation, boar AI) feeds the
  // dry sow gestation mash.
  DEFAULT: 'FEED-FINISHED_SWINE_FEEDS_DIETS-GESTATION-ITM-0001',
};

async function connect() {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: DB,
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (!apply && !verify) {
    console.log('Read-only plan. Pass --verify (rolled-back tx) or --apply.');
  }

  const conn = await connect();
  try {
    const [template] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT breed_id FROM breed_master WHERE breed_code=? AND location_id IS NULL AND deleted_at IS NULL LIMIT 1',
      [TEMPLATE_BREED_CODE],
    );
    if (!template.length) throw new Error(`Template breed ${TEMPLATE_BREED_CODE} (tenant row) not found.`);
    const templateId = template[0].breed_id as string;

    const [legacyFeed] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT item_id FROM item_master WHERE item_code IN (?) AND is_active=1 ORDER BY company_id DESC LIMIT 1`,
      [LEGACY_FEED_CODES],
    );
    const legacyFeedId = legacyFeed.length ? (legacyFeed[0].item_id as string) : null;

    const [stages] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT stage_id, stage_code FROM stage_master WHERE lob_id="60000000-6000-6000-6000-000000000007" AND is_active=1 AND deleted_at IS NULL',
    );
    const stageByCode = new Map(stages.map((s) => [s.stage_code as string, s.stage_id as string]));

    // Company-scoped feed items for the remap.
    const [companyFeeds] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT item_id, item_code FROM item_master WHERE item_code LIKE 'FEED-%' AND company_id IS NOT NULL AND is_active=1 AND deleted_at IS NULL`,
    );
    const feedByCode = new Map((companyFeeds as mysql.RowDataPacket[]).map((f) => [f.item_code as string, f.item_id as string]));

    for (const breedCode of FARM_BREED_CODES) {
      const [breed] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT breed_id, location_id FROM breed_master WHERE breed_code=? AND location_id IS NOT NULL AND deleted_at IS NULL',
        [breedCode],
      );
      if (!breed.length) {
        console.log(`SKIP: farm breed ${breedCode} not found`);
        continue;
      }
      const breedId = breed[0].breed_id as string;

      const [existing] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM breed_lifecycle_stages WHERE breed_id=?',
        [breedId],
      );
      const replace = (apply || verify) && process.argv.includes('--replace');
      if (Number(existing[0].n) > 0 && !replace) {
        console.log(`SKIP: ${breedCode} already holds ${existing[0].n} lifecycle rows`);
        continue;
      }

      const [tmpl] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT l.*, s.stage_code FROM breed_lifecycle_stages l
         JOIN stage_master s ON s.stage_id=l.stage_id
         WHERE l.breed_id=?`,
        [templateId],
      );

      // The template rows point at the TENANT-scoped stage ids, but batches
      // (and therefore their schedulers) use the COMPANY-scoped stage with the
      // same stage_code — generateLinesFromLifecycle matches stage_id exactly.
      // Remap every copy to the company-scoped stage.
      const [coStages] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT stage_id, stage_code FROM stage_master
         WHERE lob_id="60000000-6000-6000-6000-000000000007" AND company_id IS NOT NULL AND is_active=1 AND deleted_at IS NULL`,
      );
      const coStageByCode = new Map((coStages as mysql.RowDataPacket[]).map((s) => [s.stage_code as string, s.stage_id as string]));

      // --replace: drop previously-copied rows (they carry the wrong stage ids)
      // inside the same transaction as the reinsert. Idempotent reseed.
      const deleteCopied = async () => {
        await conn.query('DELETE FROM breed_lifecycle_stages WHERE breed_id=?', [breedId]);
        console.log(`REPLACED: removed existing lifecycle rows for ${breedCode}`);
      };

      console.log(`PLAN: ${breedCode} <- ${tmpl.length} lifecycle row(s) from ${TEMPLATE_BREED_CODE} (company stages, feed remapped to Triple C company items)`);
      for (const row of tmpl) {
        const stageCode = row.stage_code as string;
        const remapCode = REMAP[stageCode] ?? REMAP.DEFAULT;
        const newFeedId = feedByCode.get(remapCode) ?? null;
        const feedNote = row.feed_item_id && newFeedId ? `feed ${remapCode}` : row.feed_item_id && !newFeedId ? 'FEED REMAP FAILED' : 'no feed';
        console.log(`  ${row.lifecycle_code} ${stageCode} [${feedNote}]`);
      }

      if (!apply && !verify) continue;

      const run = async (commit: boolean) => {
        await conn.beginTransaction();
        try {
          if (replace && Number(existing[0].n) > 0) await deleteCopied();
          for (const row of tmpl) {
            const stageCode = row.stage_code as string;
            const remapCode = REMAP[stageCode] ?? REMAP.DEFAULT;
            const newFeedId = feedByCode.get(remapCode) ?? null;
            const newOutputId = row.output_item_id === legacyFeedId && newFeedId ? newFeedId : row.output_item_id;
            const coStageId = coStageByCode.get(stageCode);
            if (!coStageId) throw new Error(`No company-scoped stage for ${stageCode} — cannot remap.`);
            await conn.query(
              `INSERT INTO breed_lifecycle_stages
               (lifecycle_id, tenant_id, company_id, nob_id, lob_id, lifecycle_code, breed_id, stage_id,
                category, calc_unit, period_from, period_to, std_teats, season_type,
                feed_item_id, feed_qty_per_head_per_day_kg, feed_wastage_pct,
                std_body_weight_kg, std_adg_gpd, std_fcr, std_mortality_rate_pct,
                output_item_id, output_uom, std_output_qty,
                medication_protocol, vaccination_protocol, resource_requirements,
                kpi_thresholds, kpi_lower_limit, kpi_upper_limit, alert_severity, notes)
               VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.tenant_id, row.company_id, row.nob_id, row.lob_id,
                `${breedCode}-${stageCode}-001`, breedId, coStageId,
                row.category, row.calc_unit, row.period_from, row.period_to, row.std_teats, row.season_type,
                newFeedId, row.feed_qty_per_head_per_day_kg, row.feed_wastage_pct,
                row.std_body_weight_kg, row.std_adg_gpd, row.std_fcr, row.std_mortality_rate_pct,
                newOutputId, row.output_uom, row.std_output_qty,
                JSON.stringify(row.medication_protocol ?? null), JSON.stringify(row.vaccination_protocol ?? null),
                JSON.stringify(row.resource_requirements ?? null),
                JSON.stringify(row.kpi_thresholds ?? null), row.kpi_lower_limit ?? null, row.kpi_upper_limit ?? null,
                row.alert_severity, row.notes,
              ],
            );
          }
          if (!commit) throw new Error('ROLLBACK — verify only');
          await conn.commit();
          console.log(`APPLIED: ${breedCode} lifecycle rows inserted`);
        } catch (err) {
          await conn.rollback();
          if (!commit) console.log(`VERIFY OK: ${breedCode} inserts rolled back`);
          else throw err;
        }
      };

      if (verify) await run(false);
      if (apply) await run(true);
    }
  } finally {
    await conn.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

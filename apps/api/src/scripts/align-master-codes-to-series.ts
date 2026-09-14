/**
 * Makes the number series and the master codes in an existing tenant database
 * agree with each other, the way SYSTEM_NO_SERIES_SEED now seeds them.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * The series and the data had never described the same thing. Every series in
 * the tenant read current_seq = 0 and last_generated_code = NULL — not one code
 * in the database had come out of the mechanism that claims to issue them —
 * and the definitions said things the data flatly contradicted: SPECIES said
 * SPC-001 over twelve rows coded CHICKEN, PIG, GOAT; STAGE said STG-001 over
 * fifteen coded GESTATION, FARROWING, QUARANTINE, which twelve other files
 * match on as string literals.
 *
 * Three fixes, in the direction that is right for each master rather than one
 * blanket rewrite:
 *
 *   1. SPECIES and STAGE become "named" series — the code IS the name, seq 0 —
 *      which reproduces the codes already in the database exactly. The
 *      definition changes; no stage or species code moves, so nothing matching
 *      on GESTATION breaks.
 *   2. GL_ACCOUNT and COST_CENTER are deactivated: defined, so the master is
 *      not reported as lacking a series, but never generating. A GL account's
 *      number IS the chart of accounts (1000s assets, 4000s revenue, 5000s
 *      expenses) and BBP-1 §1.6 puts that catalog in D365BC. GL-001 would
 *      throw away the only information the number carries.
 *   3. Location and item-category codes ARE regenerated, because theirs are the
 *      cases where the hand-written code carries nothing the series does not:
 *      PEN-AI-B2 says no more than FARM-001/SHED-001/PEN-002, and CAT-RAW-GRAINS
 *      no more than RAW_GRAINS_CEREALS. The LOCATION series' whole shape — "/"
 *      between levels, "-" before the number — exists to express that path.
 *
 * Item categories were blocked until migration 0082. Conforming them produces
 * BIOLOGICAL_ASSETS-BREEDING_STOCK, which the ITEM series composes into a
 * 57-character item code — against an item_code column that was varchar(50), so
 * assertCodeFits would have rejected it and item creation for the
 * biological-asset categories would have stopped working. 0082 widens
 * item_master.item_code and its inventory_ledger snapshot (plus uom_code and the
 * two type_code columns, all now name-derived) to 255, which is what the five
 * masters already at 255 have carried all along.
 *
 * Nothing references a category by its code — item_master.sub_category is the
 * only column that could, and it is NULL on every row; everything else joins on
 * category_id.
 *
 * Deliberately NOT touched:
 *
 *   - ITEM. Its codes cascade into batch, inventory and goods-receipt fixtures.
 *     Existing item codes stay as they are; only newly created items take a
 *     series code, now that one fits.
 *   - UOM and LOCATION_TYPE. KG, ML and SHED are the standard symbols; no rule
 *     derives them from "Kilogram", "Millilitre" or "Shed/House", which is what
 *     allow_manual is for and what SYSTEM_NO_SERIES_SEED already documents.
 *   - current_seq. It reads 0 on every series and that is correct: the masters
 *     that hold codes (location, animal, item, breed lifecycle) all use
 *     segmented series, which count within a stem via nextSequenceInStem and
 *     never consult current_seq — and every flat series' master is either empty
 *     or holds NULL codes. There is no counter here that is behind.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  formatSeriesCode,
  formatSeriesStem,
  nextSequenceInStem,
} from '../modules/system/number-series/code-format.util';

/** [series_code, the field its code is built from] — serial becomes named. */
const TO_NAMED: [string, string][] = [
  ['SPECIES', 'species_name'],
  ['STAGE', 'stage_name'],
];

/** Series that stay defined but stop generating. */
const TO_INACTIVE = ['GL_ACCOUNT', 'COST_CENTER'];

/**
 * The one master code that has to move for its series to describe it: eleven of
 * the twelve species codes are already their own name, and this was the twelfth.
 */
const SPECIES_RENAME: [string, string] = ['BEE', 'HONEY_BEE'];

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

  const database = process.env.DEV_TENANT_DATABASE || 'tenant_devco';
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-master-codes', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another master-code alignment run is active.');
    await db.beginTransaction();

    const [allSeries] = await db.query<RowDataPacket[]>(
      'SELECT * FROM no_series_master WHERE deleted_at IS NULL',
    );
    if (!allSeries.length) throw new Error('No number series found — run db-seed-dev-tenant first.');

    const reshaped: unknown[] = [];
    const deactivated: unknown[] = [];
    const renamedSpecies: unknown[] = [];
    const recodedLocations: unknown[] = [];
    const skipped: unknown[] = [];

    // 1. SPECIES and STAGE: serial -> named.
    for (const [code, field] of TO_NAMED) {
      const rows = allSeries.filter((r) => r.series_code === code);
      if (!rows.length) { skipped.push({ series: code, why: 'not present' }); continue; }
      for (const row of rows) {
        const already = row.seq_length === 0 && JSON.stringify(row.code_segments ?? null).includes(field);
        if (already) { skipped.push({ series: code, why: 'already named' }); continue; }
        if (apply || verify) {
          await db.query(
            'UPDATE no_series_master SET prefix = NULL, seq_length = 0, code_segments = ?, allow_manual = 1 WHERE series_id = ?',
            [JSON.stringify([field]), row.series_id],
          );
        }
        reshaped.push({
          series: code,
          from: `${row.prefix}${row.separator}${'0'.repeat(row.seq_length)}`,
          to: `<${field}>`,
        });
      }
    }

    // 2. GL_ACCOUNT and COST_CENTER: defined but never generating.
    for (const code of TO_INACTIVE) {
      const rows = allSeries.filter((r) => r.series_code === code);
      if (!rows.length) { skipped.push({ series: code, why: 'not present' }); continue; }
      for (const row of rows) {
        if (!row.is_active) { skipped.push({ series: code, why: 'already inactive' }); continue; }
        if (apply || verify) {
          await db.query('UPDATE no_series_master SET is_active = 0 WHERE series_id = ?', [row.series_id]);
        }
        deactivated.push({ series: code, reason: 'codes are typed, not generated' });
      }
    }

    // 3. BEE -> HONEY_BEE, so the SPECIES series describes every row.
    const [from, to] = SPECIES_RENAME;
    const [speciesRows] = await db.query<RowDataPacket[]>(
      'SELECT species_id, species_code, species_name, company_id FROM species_master WHERE deleted_at IS NULL',
    );
    for (const row of speciesRows.filter((r) => r.species_code === from)) {
      if (speciesRows.some((r) => r.species_code === to)) {
        skipped.push({ rename: `${from} → ${to}`, why: `${to} already exists` });
        continue;
      }
      if (apply || verify) {
        await db.query('UPDATE species_master SET species_code = ? WHERE species_id = ?', [to, row.species_id]);
      }
      renamedSpecies.push({ from, to, name: row.species_name });
    }

    // 4. Item category codes from the ITEM_CATEGORY series.
    //
    // A named series: the code IS the category's own name, no number. Two
    // categories with the same name would therefore collide, and the second is
    // reported rather than silently numbered — the same rule every named series
    // follows. Widened to 255 by migration 0082, so the longest of these
    // (BIOLOGICAL_ASSETS-GROWER_FINISHER, 33) has room.
    const [categorySeries] = await db.query<RowDataPacket[]>(
      "SELECT * FROM no_series_master WHERE series_code = 'ITEM_CATEGORY' AND is_active = 1 AND deleted_at IS NULL LIMIT 1",
    );
    const recodedCategories: unknown[] = [];
    if (!categorySeries[0]) {
      skipped.push({ categories: 'skipped', why: 'no active ITEM_CATEGORY series' });
    } else {
      const [categories] = await db.query<RowDataPacket[]>(
        'SELECT category_id, company_id, category_code, category_name FROM item_category_master WHERE deleted_at IS NULL',
      );
      const now = new Date();
      const claimed = new Map<string, Set<string>>();
      for (const row of categories) {
        const key = String(row.company_id);
        if (!claimed.has(key)) claimed.set(key, new Set());
      }
      for (const row of categories) {
        const code = formatSeriesCode(categorySeries[0] as never, 1, now, row);
        const taken = claimed.get(String(row.company_id))!;
        if (code === row.category_code) {
          taken.add(code);
          skipped.push({ category: row.category_name, why: 'already matches the series' });
          continue;
        }
        if (taken.has(code)) {
          skipped.push({ category: row.category_name, why: `would collide with ${code}` });
          continue;
        }
        if (apply || verify) {
          await db.query('UPDATE item_category_master SET category_code = ? WHERE category_id = ?', [code, row.category_id]);
        }
        taken.add(code);
        recodedCategories.push({ name: row.category_name, from: row.category_code, to: code });
      }
    }

    // 5. Location codes from the LOCATION series.
    //
    // Parents before children, ordered by location_level, because a child's
    // code embeds its parent's — and the parent's may itself have just changed.
    // The new code is written back into the working map as each row is done, so
    // a pen composes against the shed's NEW code, never its old one.
    const [locationSeries] = await db.query<RowDataPacket[]>(
      "SELECT * FROM no_series_master WHERE series_code = 'LOCATION' AND deleted_at IS NULL LIMIT 1",
    );
    const series = locationSeries[0];
    if (!series) {
      skipped.push({ locations: 'skipped', why: 'no LOCATION series' });
    } else {
      const [typeRows] = await db.query<RowDataPacket[]>(
        'SELECT type_code, code_prefix FROM location_type_master WHERE deleted_at IS NULL',
      );
      const prefixByType = new Map(typeRows.map((r) => [r.type_code, r.code_prefix]));

      const [locations] = await db.query<RowDataPacket[]>(
        `SELECT location_id, company_id, location_code, location_name, location_type,
                parent_location_id, location_level
           FROM location_master WHERE deleted_at IS NULL
          ORDER BY location_level, location_name`,
      );

      const now = new Date();
      // Codes as they will stand after this run — seeded with the current ones
      // so a location left alone still contributes its code to its children,
      // and so sibling numbering counts against the new codes, not the old.
      const codeById = new Map(locations.map((r) => [r.location_id, r.location_code as string]));
      const issued = new Map<string, string[]>();
      for (const row of locations) {
        issued.set(row.company_id, [...(issued.get(row.company_id) ?? []), row.location_code]);
      }

      for (const row of locations) {
        const segments = {
          parent_location_id: row.parent_location_id ? codeById.get(row.parent_location_id) ?? null : null,
          location_type: prefixByType.get(row.location_type) ?? row.location_type,
        };
        const stem = formatSeriesStem(series as never, now, segments);
        const sequenceSeparator = series.seq_separator || series.separator || '-';
        const sequenceText = String(row.location_code).startsWith(`${stem}${sequenceSeparator}`)
          ? String(row.location_code).slice(`${stem}${sequenceSeparator}`.length)
          : '';
        const existingSequence = /^\d+$/.test(sequenceText) ? Number(sequenceText) : null;

        // A valid code is already aligned. The previous algorithm removed the
        // row from the occupied set first and always asked for MAX + 1, so a
        // perfectly valid FARM-001 was proposed as FARM-002 on every run. A
        // second run then proposed FARM-003. Compare the current code against
        // the formatter before allocating anything; only malformed/outdated
        // paths need a new sequence.
        if (existingSequence !== null
          && formatSeriesCode(series as never, existingSequence, now, segments) === row.location_code) {
          skipped.push({ location: row.location_name, why: 'already matches the series' });
          continue;
        }

        const siblings = (issued.get(row.company_id) ?? []).filter((c) => c !== row.location_code);
        const sequence = nextSequenceInStem(
          stem,
          sequenceSeparator,
          siblings,
        );
        const code = formatSeriesCode(series as never, sequence, now, segments);
        if (apply || verify) {
          await db.query('UPDATE location_master SET location_code = ? WHERE location_id = ?', [code, row.location_id]);
        }
        recodedLocations.push({ name: row.location_name, type: row.location_type, from: row.location_code, to: code });
        codeById.set(row.location_id, code);
        issued.set(row.company_id, [
          ...(issued.get(row.company_id) ?? []).filter((c) => c !== row.location_code),
          code,
        ]);
      }
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT series_code, prefix, seq_length, is_active, code_segments
         FROM no_series_master WHERE deleted_at IS NULL
          AND series_code IN ('SPECIES','STAGE','GL_ACCOUNT','COST_CENTER','LOCATION')
        ORDER BY series_code`,
    );

    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      reshaped,
      deactivated,
      renamedSpecies,
      recodedCategories,
      recodedLocations,
      skipped,
      notTouched: {
        ITEM: 'existing codes cascade into batch, inventory and goods-receipt fixtures; new items now take a series code',
        UOM_LOCATION_TYPE: 'KG / SHED are standard symbols, not derivable from the name — allow_manual covers it',
        current_seq: 'reads 0 correctly: coded masters use per-stem counters, flat series have no codes yet',
      },
      seriesAfter: after,
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-master-codes')");
    await db.end();
  }
}

run().catch((err) => { console.error(err.message); process.exit(1); });

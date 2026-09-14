import * as mysql from 'mysql2/promise';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { CURRENCY_SEED_ROWS, DEFAULT_CURRENCY_BY_COUNTRY, CURRENCY_ID_BY_ISO } from './lib/currency-seed-data';

/**
 * Brings the currency reference list, and each country's default currency, up
 * to date in the master database and every tenant database.
 *
 * bootstrap-database.ts already seeds both from lib/currency-seed-data.ts, but
 * only on a fresh database. Databases that already exist held three currencies
 * (INR, USD, ZWL) and had a default currency on just three of their 25
 * countries, so a company trading with any of the other 22 had no currency to
 * default to. This is what rolls the new rows out to them.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * Two things it deliberately will not do:
 *   - overwrite a country's existing default_currency_id. A non-null value that
 *     disagrees with the table is reported as `differs` and left alone, because
 *     it may be a deliberate client choice; only nulls are filled.
 *   - touch is_system_default or is_active on a currency that already exists.
 *     There is no system-wide default currency by design (Rishi, 2026-09-09),
 *     and a currency someone deactivated should stay deactivated.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';

interface Plan {
  database: string;
  currenciesInserted: string[];
  currenciesUpdated: string[];
  currenciesUnchanged: number;
  countryDefaultsSet: string[];
  countryDefaultsDiffer: Array<{ iso2: string; existing: string; expected: string }>;
  countriesAbsent: string[];
}

async function syncOne(database: string, apply: boolean, verify: boolean): Promise<Plan> {
  const db = await mysql.createConnection({ host, port, user, password, database, ssl });
  const plan: Plan = {
    database,
    currenciesInserted: [],
    currenciesUpdated: [],
    currenciesUnchanged: 0,
    countryDefaultsSet: [],
    countryDefaultsDiffer: [],
    countriesAbsent: [],
  };

  try {
    await db.beginTransaction();

    const [existing] = await db.query<RowDataPacket[]>(
      'SELECT currency_id, iso_code, currency_name, symbol, decimal_places, country_codes FROM currency_master',
    );
    const byIso = new Map(existing.map((r) => [r.iso_code as string, r]));

    for (const row of CURRENCY_SEED_ROWS) {
      const current = byIso.get(row.iso_code);
      const codes = JSON.stringify(row.country_codes);
      if (!current) {
        plan.currenciesInserted.push(row.iso_code);
      } else {
        // country_codes comes back parsed from a json column on some driver
        // versions and as a string on others; compare both the same way.
        const currentCodes = JSON.stringify(
          typeof current.country_codes === 'string'
            ? JSON.parse(current.country_codes)
            : current.country_codes ?? null,
        );
        const same = current.currency_name === row.currency_name
          && current.symbol === row.symbol
          && Number(current.decimal_places) === row.decimal_places
          && currentCodes === codes;
        if (same) { plan.currenciesUnchanged += 1; continue; }
        plan.currenciesUpdated.push(row.iso_code);
      }

      if (apply || verify) {
        await db.query(
          `INSERT INTO currency_master
             (currency_id, iso_code, currency_name, symbol, symbol_position, decimal_places, country_codes, is_system_default, is_active)
           VALUES (?, ?, ?, ?, 'PREFIX', ?, CAST(? AS JSON), 0, 1)
           ON DUPLICATE KEY UPDATE
             currency_name = VALUES(currency_name),
             symbol = VALUES(symbol),
             decimal_places = VALUES(decimal_places),
             country_codes = VALUES(country_codes)`,
          [row.currency_id, row.iso_code, row.currency_name, row.symbol, row.decimal_places, codes],
        );
      }
    }

    const [countries] = await db.query<RowDataPacket[]>(
      'SELECT iso2, default_currency_id FROM country_master',
    );
    const countryByIso = new Map(countries.map((r) => [r.iso2 as string, r]));
    // Re-read: an insert above may have just created the row this points at.
    const [afterCurrencies] = await db.query<RowDataPacket[]>('SELECT currency_id, iso_code FROM currency_master');
    const liveIdByIso = new Map(afterCurrencies.map((r) => [r.iso_code as string, r.currency_id as string]));

    for (const [iso2, currencyIso] of Object.entries(DEFAULT_CURRENCY_BY_COUNTRY)) {
      const country = countryByIso.get(iso2);
      if (!country) { plan.countriesAbsent.push(iso2); continue; }
      const expected = liveIdByIso.get(currencyIso) ?? CURRENCY_ID_BY_ISO.get(currencyIso)!;
      if (country.default_currency_id && country.default_currency_id !== expected) {
        plan.countryDefaultsDiffer.push({ iso2, existing: String(country.default_currency_id), expected });
        continue;
      }
      if (country.default_currency_id === expected) continue;
      plan.countryDefaultsSet.push(`${iso2}->${currencyIso}`);
      if (apply || verify) {
        await db.query<ResultSetHeader>(
          'UPDATE country_master SET default_currency_id = ? WHERE iso2 = ? AND default_currency_id IS NULL',
          [expected, iso2],
        );
      }
    }

    if (apply) await db.commit();
    else await db.rollback();
    return plan;
  } catch (err) {
    await db.rollback().catch(() => undefined);
    throw new Error(`[${database}] ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await db.end();
  }
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }

  const masterConn = await mysql.createConnection({ host, port, user, password, database: masterDatabase, ssl });
  let databases: string[];
  try {
    const [tenants] = await masterConn.query<RowDataPacket[]>('SELECT db_name FROM tenant_master');
    databases = [masterDatabase, ...tenants.map((t) => t.db_name as string)];
  } finally {
    await masterConn.end();
  }

  const plans: Plan[] = [];
  for (const database of databases) plans.push(await syncOne(database, apply, verify));

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
    seedCurrencies: CURRENCY_SEED_ROWS.length,
    databases: plans,
  }, null, 2));

  console.log(
    apply
      ? 'Committed.'
      : verify
        ? 'Verified and rolled back. No changes committed.'
        : 'Read-only. No changes attempted.',
  );
}

run().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });

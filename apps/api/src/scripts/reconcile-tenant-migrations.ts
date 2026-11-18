import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mysql from 'mysql2/promise';
import { assertDatabaseAllowed } from '../core/database/database-allowlist';
import {
  alreadyThere,
  migrationHash,
  missingMigrations,
  statementsOf,
  type JournalEntry,
} from './migration-reconcile';

/**
 * Brings every tenant database to the full tenant migration journal, whatever order its migrations ran in.
 *
 *   pnpm nx run api:db-reconcile-tenant-migrations                     # read-only: says what each database lacks
 *   pnpm nx run api:db-reconcile-tenant-migrations -- --apply          # applies what is lacking
 *   pnpm nx run api:db-reconcile-tenant-migrations -- --tenant ccc     # one tenant only (the registry's tenant_code)
 *   pnpm nx run api:db-reconcile-tenant-migrations -- --database nf_x  # one database by name, registry or not (a copy to try it on)
 *
 * Use it when `db-migrate-all-tenants` cannot: a database that ran this branch's migrations before another branch's
 * earlier-dated ones were merged (drizzle skips anything dated before the newest it has run, and would re-run the
 * ones it has under new numbers). Here each migration is matched by the hash of its SQL file, applied in journal
 * order if the database has not recorded it, and then recorded with the journal's `when`. A statement whose object
 * already exists is reported and counted as done; any other error stops that database, leaving the migrations
 * before it recorded. Safe to run twice. Honours NAVFARM_DB_ALLOWLIST like db-migrate-all-tenants.
 */
const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'nf_master';
const folder = resolve(__dirname, '../drizzle/tenant');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.includes('--tenant')
  ? args[args.indexOf('--tenant') + 1]
  : null;
const byName = args.includes('--database')
  ? args[args.indexOf('--database') + 1]
  : null;
// An option this script does not know is an error, not a silent no-op: --apply must never run wider than asked.
const known = new Set(['--apply', '--tenant', '--database']);
const unknown = args.filter((a) => a.startsWith('--') && !known.has(a));
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(' ')}`);
  process.exit(2);
}

async function run() {
  const journal = (
    JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'))
      .entries as JournalEntry[]
  ).map((e) => ({
    ...e,
    hash: migrationHash(readFileSync(resolve(folder, `${e.tag}.sql`), 'utf8')),
  }));
  console.log(
    `Journal: ${journal.length} migrations, last ${journal.at(-1)?.tag}. ${apply ? 'APPLYING' : 'Read-only (pass --apply to change anything)'}.`,
  );

  assertDatabaseAllowed(masterDatabase, 'reconcile-tenant-migrations master');
  const master = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database: masterDatabase,
    ssl,
  });
  const [registered] = (await master.query(
    'SELECT tenant_code, db_name, db_host, db_port, db_user, db_password FROM tenant_master ORDER BY tenant_code',
  )) as unknown as [Array<Record<string, any>>, unknown];
  await master.end();
  // --database names one database directly (the default login), so a copy can be reconciled before the real one.
  const tenants = byName
    ? [{ tenant_code: byName, db_name: byName } as Record<string, any>]
    : registered;

  const failed: string[] = [];
  for (const t of tenants) {
    if (only && t.tenant_code !== only) continue;
    try {
      assertDatabaseAllowed(
        t.db_name,
        `reconcile-tenant-migrations tenant ${t.tenant_code}`,
      );
    } catch (err) {
      console.error(
        `[${t.tenant_code}] REFUSED: ${err instanceof Error ? err.message : err}`,
      );
      failed.push(t.tenant_code);
      continue;
    }
    const conn = await mysql.createConnection({
      host: t.db_host || host,
      port: t.db_port || port,
      user: t.db_user || user,
      password: t.db_password || password,
      database: t.db_name,
      ssl,
    });
    try {
      const [rows] = (await conn.query(
        'SELECT hash FROM __drizzle_migrations',
      )) as unknown as [Array<{ hash: string }>, unknown];
      const missing = missingMigrations(
        journal,
        rows.map((r) => r.hash),
      );
      if (!missing.length) {
        console.log(
          `[${t.tenant_code}] ${t.db_name}: complete (${rows.length} recorded)`,
        );
        continue;
      }
      console.log(
        `[${t.tenant_code}] ${t.db_name}: ${rows.length} recorded, ${missing.length} missing: ${missing.map((m) => m.tag).join(', ')}`,
      );
      if (!apply) continue;
      for (const m of missing) {
        const statements = statementsOf(
          readFileSync(resolve(folder, `${m.tag}.sql`), 'utf8'),
        );
        for (const sql of statements) {
          try {
            await conn.query(sql);
          } catch (err) {
            if (!alreadyThere(err))
              throw new Error(
                `${m.tag}: ${err instanceof Error ? err.message : err}`,
              );
            console.log(
              `  ${m.tag}: already there (${(err as Error).message.slice(0, 80)})`,
            );
          }
        }
        await conn.query(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
          [m.hash, m.when],
        );
        console.log(`  ${m.tag}: applied and recorded`);
      }
    } catch (err) {
      console.error(
        `[${t.tenant_code}] STOPPED: ${err instanceof Error ? err.message : err}`,
      );
      failed.push(t.tenant_code);
    } finally {
      await conn.end();
    }
  }
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Import a showcase tenant exported by seed-triplec-export.ts — minutes instead
 * of the hour it takes to play the farm forward again.
 *
 * Replaces the tenant if it exists: its database is dropped and recreated from
 * the file, and its master registry rows (tenant_master, tenant_subscription,
 * user_auth_index) are swapped for the exported ones, so the same logins work.
 * A tenant with the same code but another id (one signed up on this machine) is
 * removed first, the way seed-triplec.ts --recreate removes it.
 *
 * Afterwards the schema is compared with this machine's: the file carries the
 * tenant's __drizzle_migrations. Older than here -> run db-migrate-all-tenants.
 * Newer than here -> this machine's code is behind the export; update it first.
 * Then top up the days since the export:
 *   seed-triplec-history.ts --apply --resume
 *
 *   node --env-file-if-exists=.env --import tsx src/scripts/seed-triplec-import.ts <file.sql.gz> --apply
 */
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import * as readline from 'node:readline';
import * as mysql from 'mysql2/promise';

const MASTER_DB = process.env.DATABASE_NAME || 'nf_master';
const END_MARK = '-- @@end';

function connect(database?: string) {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database,
    ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  });
}

/** The file's statements in order, each tagged with the database it belongs to. */
async function* statements(path: string): AsyncGenerator<{ target: 'tenant' | 'master' | 'meta'; sql: string }> {
  const lines = readline.createInterface({ input: fs.createReadStream(path).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let target: 'tenant' | 'master' = 'tenant';
  let buffer: string[] = [];
  for await (const line of lines) {
    if (line.startsWith('-- @@meta ')) { yield { target: 'meta', sql: line.slice('-- @@meta '.length) }; continue; }
    if (line === '-- @@master') { target = 'master'; continue; }
    if (line.startsWith('-- @@table ')) continue;
    if (line === END_MARK) {
      const sql = buffer.join('\n').trim();
      buffer = [];
      if (sql) yield { target, sql };
      continue;
    }
    buffer.push(line);
  }
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file || !fs.existsSync(file)) throw new Error('Name the exported .sql.gz file.');
  const apply = process.argv.includes('--apply');

  const it = statements(file);
  const first = await it.next();
  if (first.done || first.value.target !== 'meta') throw new Error('Not a showcase export: the first line carries no @@meta.');
  const meta = JSON.parse(first.value.sql);
  console.log(`Export of ${meta.tenant_code} (${meta.db_name}) taken ${meta.exported_on}, posted to ${meta.last_posted_day}.`);
  if (!apply) {
    console.log(`Plan only. --apply DROPS database ${meta.db_name} on ${process.env.DATABASE_HOST || 'localhost'} if it exists and replaces tenant ${meta.tenant_code}.`);
    return;
  }

  const master = await connect(MASTER_DB);
  // Remove whatever tenant holds this code or id now, database and registry rows both.
  const [present] = await master.query<any[]>('SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ? OR tenant_id = ?', [meta.tenant_code, meta.tenant_id]);
  for (const t of present) {
    await master.query(`DROP DATABASE IF EXISTS \`${t.db_name}\``);
    for (const table of ['user_auth_index', 'tenant_subscription', 'audit_log', 'tenant_master']) {
      await master.query(`DELETE FROM \`${table}\` WHERE tenant_id = ?`, [t.tenant_id]);
    }
  }
  await master.query(`DROP DATABASE IF EXISTS \`${meta.db_name}\``);
  await master.query(`CREATE DATABASE \`${meta.db_name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`  ${present.length ? `replaced tenant ${meta.tenant_code}` : `no tenant ${meta.tenant_code} here before`}; ${meta.db_name} created empty`);

  const tenantDb = await connect(meta.db_name);
  await tenantDb.query('SET FOREIGN_KEY_CHECKS = 0');
  let tenantStatements = 0;
  let masterStatements = 0;
  const t0 = Date.now();
  for await (const s of it) {
    if (s.target === 'master') {
      if (masterStatements === 0) {
        // The exported logins replace any left from an earlier tenant under these emails.
        await master.query(`DELETE FROM user_auth_index WHERE email IN (SELECT LOWER(email) FROM \`${meta.db_name}\`.user_master)`);
      }
      await master.query(s.sql);
      masterStatements += 1;
    } else {
      await tenantDb.query(s.sql);
      tenantStatements += 1;
      if (tenantStatements % 200 === 0) process.stdout.write(`  ${tenantStatements} statements, ${((Date.now() - t0) / 1000).toFixed(0)} s\r`);
    }
  }
  await tenantDb.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log(`  ${tenantStatements} tenant statements and ${masterStatements} registry statements loaded in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // Is the imported schema the one this machine's code expects? Compared with the platform tenant's.
  const latest = async (db: string) => {
    const [[row]] = await master.query<any[]>(`SELECT COUNT(*) n, MAX(created_at) last FROM \`${db}\`.__drizzle_migrations`);
    return { n: Number(row.n), last: Number(row.last) };
  };
  const [ref] = await master.query<any[]>(`SELECT db_name FROM tenant_master WHERE tenant_code = 'system' LIMIT 1`);
  const mine = await latest(meta.db_name);
  if (ref[0]?.db_name) {
    const theirs = await latest(ref[0].db_name);
    if (mine.last === theirs.last) console.log(`  schema matches this machine (${mine.n} tenant migrations)`);
    else if (mine.last < theirs.last) console.log(`  SCHEMA OLDER than this machine (${mine.n} vs ${theirs.n} migrations): run db-migrate-all-tenants before using it`);
    else console.log(`  SCHEMA NEWER than this machine (${mine.n} vs ${theirs.n} migrations): update this machine's code before using it`);
  }
  const [[users]] = await tenantDb.query<any[]>('SELECT COUNT(*) n FROM user_master WHERE deleted_at IS NULL');
  const [[batches]] = await tenantDb.query<any[]>('SELECT COUNT(*) n FROM batch_header');
  console.log(`  read back: ${users.n} users, ${batches.n} batches. Next: seed-triplec-history.ts --apply --resume to post the days since ${meta.last_posted_day}.`);
  await tenantDb.end();
  await master.end();
}

main().then(() => process.exit(0), (error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

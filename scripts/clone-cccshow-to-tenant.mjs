#!/usr/bin/env node
/**
 * Copies cccshow's DATA into an existing tenant, keeping that tenant's own
 * identity: its company, its operational area and its users stay exactly as
 * they are. Nothing about login, roles or the company/area rows is copied.
 *
 *   node scripts/clone-cccshow-to-tenant.mjs --target-code <tenant_code>            (plan only)
 *   node scripts/clone-cccshow-to-tenant.mjs --target-code <code> --apply --confirm-db <db_name>
 *
 * Works for any registered tenant. If the target has several companies or areas,
 * pick with --company <company_id> and/or --area <area_code>; without them the
 * plan lists the choices and stops. A target that is behind on migrations is
 * reported in the plan (missing tables or columns) and refused on apply: migrate it first.
 *
 * What it does
 *  1. Looks up the target tenant in nf_master and, inside the target database,
 *     its tenant_id, company_id, Piggery operational area (area_id) and users.
 *  2. mysqldumps nf_cccshow DATA ONLY (INSERT IGNORE), leaving out identity
 *     tables: users, user assignments, sessions, roles, role permissions,
 *     company/area rows and settings, audit log, notifications, migrations.
 *  3. Rewrites cccshow's tenant_id, company_id, area_id and the 4 cccshow
 *     user ids (matched by e-mail prefix: tenant.admin / company.admin /
 *     area.admin / user; anything unmatched goes to the target's tenant admin)
 *     to the target's own ids, then restores into the target database.
 *
 * INSERT IGNORE: rows whose primary key already exists in the target are
 * skipped, never overwritten. Back up the target first; this is not reversible.
 *
 * --clear-first (for a target that already holds operational data)
 *   Without it, a target that shares codes with cccshow (items, animals, ...)
 *   keeps its own parent rows and gets cccshow's child rows pointing at ids that
 *   do not exist. --clear-first empties the target's operational tables first
 *   (every table cccshow has with a tenant_id, plus the line/child tables that
 *   hang off them) so the copy lands clean. Identity tables (the SKIP list) and
 *   global reference tables (countries, currencies, languages, LOB/NOB) are
 *   never cleared. The plan lists row counts that would be deleted. On apply it
 *   writes a full mysqldump of the target first, then deletes and loads in ONE
 *   transaction (any error rolls everything back), and it refuses to run if a
 *   tenant table holds rows for another tenant_id.
 *
 * Env: DB_HOST (127.0.0.1) DB_PORT (3306) DB_USER (root) MYSQL_PWD (password),
 *      --db-override <db> rehearses against a copy of the target database.
 *      MASTER_DB (nf_master), SOURCE_DB (nf_cccshow).
 * Needs mysqldump and mysql on PATH.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const mysql = require('mysql2/promise');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const flag = (name) => process.argv.includes(`--${name}`);

const HOST = process.env.DB_HOST || '127.0.0.1';
const PORT = process.env.DB_PORT || '3306';
const USER = process.env.DB_USER || 'root';
const PASSWORD = process.env.MYSQL_PWD || '';
const MASTER_DB = process.env.MASTER_DB || 'nf_master';
const SOURCE_DB = process.env.SOURCE_DB || 'nf_cccshow';
const SOURCE_CODE = 'cccshow';

const targetCode = arg('target-code');
if (!targetCode) {
  console.error('Usage: clone-cccshow-to-tenant.mjs --target-code <tenant_code> [--apply --confirm-db <db_name>]');
  process.exit(1);
}
if (targetCode === SOURCE_CODE) {
  console.error('Target cannot be the source tenant.');
  process.exit(1);
}

const connect = (database) =>
  mysql.createConnection({ host: HOST, port: Number(PORT), user: USER, password: PASSWORD, database });
const one = async (conn, sql, params = []) => (await conn.query(sql, params))[0];

const master = await connect(MASTER_DB);
const [src] = await one(master, 'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ?', [SOURCE_CODE]);
const [tgt] = await one(master, 'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ?', [targetCode]);
await master.end();
// Rehearsal: point at a copy of the target's database (same tenant ids).
if (tgt && arg('db-override')) tgt.db_name = arg('db-override');
if (!src) throw new Error(`Source tenant '${SOURCE_CODE}' is not registered in ${MASTER_DB}.`);
if (!tgt) throw new Error(`Target tenant '${targetCode}' is not registered in ${MASTER_DB}.`);
if (src.db_name !== SOURCE_DB) throw new Error(`SOURCE_DB (${SOURCE_DB}) does not match registered ${src.db_name}.`);

const read = async (db, tenantId) => {
  const c = await connect(db);
  const companies = await one(c, 'SELECT company_id FROM company_master WHERE tenant_id = ? AND deleted_at IS NULL', [tenantId]);
  const areas = await one(c, "SELECT area_id, area_code, area_name FROM operational_area_master WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (area_code = 'PIGAREA') DESC, created_at", [tenantId]);
  const users = await one(c, 'SELECT user_id, email FROM user_master WHERE tenant_id = ?', [tenantId]);
  await c.end();
  return { companies, areas, users };
};
const S = await read(src.db_name, src.tenant_id);
const T = await read(tgt.db_name, tgt.tenant_id);

const pickCompany = arg('company');
const pickArea = arg('area');
if (pickCompany) T.companies = T.companies.filter((c) => c.company_id === pickCompany);
if (pickArea) T.areas = T.areas.filter((a) => a.area_code === pickArea || a.area_id === pickArea);
if (T.companies.length !== 1) {
  const all = (await read(tgt.db_name, tgt.tenant_id)).companies;
  throw new Error(`Target needs exactly one company${pickCompany ? ` matching --company ${pickCompany}` : ''}, found ${T.companies.length}. Pass --company <company_id>. Companies: ${all.map((c) => c.company_id).join(', ')}`);
}
if (T.areas.length < 1) throw new Error('Target has no matching operational area; create it first or pass --area <area_code>.');
if (S.companies.length !== 1 || S.areas.length !== 1) throw new Error('Unexpected source shape (expected 1 company, 1 area).');
if (T.users.length < 1) throw new Error('Target has no users.');

const prefix = (e) => String(e).split('@')[0].toLowerCase();
const fallback = T.users.find((u) => prefix(u.email) === 'tenant.admin') || T.users[0];
const map = new Map();
map.set(src.tenant_id, tgt.tenant_id);
map.set(S.companies[0].company_id, T.companies[0].company_id);
map.set(S.areas[0].area_id, T.areas[0].area_id);
for (const u of S.users) {
  const hit = T.users.find((t) => prefix(t.email) === prefix(u.email));
  map.set(u.user_id, (hit || fallback).user_id);
}

console.log(`Source ${SOURCE_CODE} (${src.db_name})  ->  target ${targetCode} (${tgt.db_name})`);
console.log(`  tenant  ${src.tenant_id} -> ${tgt.tenant_id}`);
console.log(`  company ${S.companies[0].company_id} -> ${T.companies[0].company_id}`);
console.log(`  area    ${S.areas[0].area_id} -> ${T.areas[0].area_id} (${T.areas[0].area_name})`);
for (const u of S.users) console.log(`  user    ${u.email} -> ${(T.users.find((t) => prefix(t.email) === prefix(u.email)) || fallback).email}`);
if (T.areas.length > 1) console.log(`  note: target has ${T.areas.length} areas; using ${T.areas[0].area_code}. Pass --area <area_code> to choose.`);

// Identity / per-tenant-login tables stay as the target has them.
const SKIP = [
  '__drizzle_migrations', 'audit_log', 'role_master', 'role_permissions',
  'user_master', 'user_session', 'user_company_assignments', 'user_language_pref',
  'user_notification_pref', 'user_operational_area_assignment', 'user_role_assignment',
  'company_master', 'company_address', 'company_contacts', 'company_currency_config',
  'company_fiscal', 'company_language_config', 'company_modules',
  'operational_area_master', 'operational_area_settings',
  'notification_alert_log', 'notification_config', 'notification_log',
];
// Schema readiness: the target must already have every cccshow table and column.
let notReady = false;
{
  const sc = await connect(SOURCE_DB);
  const tc = await connect(tgt.db_name);
  const grab = async (c, db) => {
    const rows = await one(c, "SELECT c.table_name AS t, c.column_name AS col FROM information_schema.columns c JOIN information_schema.tables x ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE' WHERE c.table_schema = ?", [db]);
    const m = new Map();
    for (const r of rows) (m.get(r.t) || m.set(r.t, new Set()).get(r.t)).add(r.col);
    return m;
  };
  const sm = await grab(sc, SOURCE_DB);
  const tm = await grab(tc, tgt.db_name);
  await sc.end(); await tc.end();
  const gapTables = [...sm.keys()].filter((t) => !SKIP.includes(t) && !tm.has(t));
  const gapCols = [];
  for (const [t, cols] of sm) if (!SKIP.includes(t) && tm.has(t)) for (const col of cols) if (!tm.get(t).has(col)) gapCols.push(`${t}.${col}`);
  if (gapTables.length || gapCols.length) {
    notReady = true;
    console.log(`\nNOT READY: ${tgt.db_name} is behind cccshow's schema.`);
    if (gapTables.length) console.log(`  missing tables (${gapTables.length}): ${gapTables.join(', ')}`);
    if (gapCols.length) console.log(`  missing columns (${gapCols.length}): ${gapCols.slice(0, 20).join(', ')}`);
    console.log('  Migrate this tenant first (pnpm nx run api:db-migrate-all-tenants, after checking the migration journal), then re-run. Apply will refuse until then.');
  } else console.log('\nSchema: target has every cccshow table and column. Ready.');
}

const CLEAR_FIRST = flag('clear-first');
const q = (n) => '`' + String(n).replace(/`/g, '``') + '`';

// Which tables --clear-first empties: tenant_id tables not in SKIP, then (to a
// fixpoint) tenant-less tables with a foreign key to one already in the set.
const planClear = async () => {
  const c = await connect(SOURCE_DB);
  const cols = await one(c, "SELECT table_name AS t FROM information_schema.columns WHERE table_schema = ? AND column_name = 'tenant_id'", [SOURCE_DB]);
  const all = await one(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", [SOURCE_DB]);
  const fks = await one(c, 'SELECT DISTINCT table_name AS t, referenced_table_name AS r FROM information_schema.key_column_usage WHERE table_schema = ? AND referenced_table_name IS NOT NULL', [SOURCE_DB]);
  await c.end();
  const hasTenant = new Set(cols.map((r) => r.t));
  const clear = new Set(all.map((r) => r.t).filter((t) => hasTenant.has(t) && !SKIP.includes(t)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const { t, r } of fks) {
      if (!clear.has(t) && !SKIP.includes(t) && !hasTenant.has(t) && clear.has(r)) { clear.add(t); grew = true; }
    }
  }
  return { clear: [...clear].sort(), hasTenant };
};
let clearPlan = null;
if (CLEAR_FIRST) {
  clearPlan = await planClear();
  const c = await connect(tgt.db_name);
  const present = new Set((await one(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", [tgt.db_name])).map((r) => r.t));
  const foreign = [];
  const counts = [];
  for (const t of clearPlan.clear) {
    if (!present.has(t)) continue;
    const [{ n }] = await one(c, `SELECT COUNT(*) AS n FROM ${q(t)}`);
    if (clearPlan.hasTenant.has(t)) {
      const [{ f }] = await one(c, `SELECT COUNT(*) AS f FROM ${q(t)} WHERE tenant_id IS NOT NULL AND tenant_id <> ?`, [tgt.tenant_id]);
      if (f > 0) foreign.push(`${t} (${f})`);
    }
    if (n > 0) counts.push([t, n]);
  }
  await c.end();
  console.log(`\n--clear-first: ${clearPlan.clear.length} tables would be emptied in ${tgt.db_name}; ${counts.length} hold rows:`);
  for (const [t, n] of counts) console.log(`  delete ${String(n).padStart(8)}  ${t}`);
  if (foreign.length) {
    console.error(`\nRefusing: these tables hold rows for another tenant_id, so the database is not single-tenant: ${foreign.join(', ')}`);
    process.exit(1);
  }
}

if (!flag('apply')) {
  console.log('\nPlan only. Add --apply --confirm-db <db_name> to run.');
  process.exit(0);
}
if (arg('confirm-db') !== tgt.db_name) {
  console.error(`--confirm-db must equal ${tgt.db_name}. Nothing restored.`);
  process.exit(1);
}

if (notReady) {
  console.error('Target schema is behind cccshow. Nothing restored.');
  process.exit(1);
}
const tableSet = async (db) => {
  const c = await connect(db);
  const rows = await one(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", [db]);
  await c.end();
  return new Set(rows.map((r) => r.t));
};
const srcTables = await tableSet(SOURCE_DB);
const tgtTables = await tableSet(tgt.db_name);
const missing = [...srcTables].filter((t) => !SKIP.includes(t) && !tgtTables.has(t));
if (missing.length) {
  console.error(`Target ${tgt.db_name} lacks ${missing.length} table(s) cccshow has (${missing.slice(0, 8).join(', ')}). Migrate it first. Nothing restored.`);
  process.exit(1);
}
const common = [`-h${HOST}`, `-P${PORT}`, `-u${USER}`];
const dir = mkdtempSync(join(tmpdir(), 'clone-ccc-'));
const dump = join(dir, 'dump.sql');
const env = { ...process.env, MYSQL_PWD: PASSWORD };

const d = spawnSync('mysqldump', [
  ...common, '--no-create-info', '--complete-insert', '--insert-ignore', '--single-transaction',
  '--set-gtid-purged=OFF', '--skip-triggers', '--skip-add-locks', '--skip-disable-keys', '--result-file', dump,
  ...SKIP.map((t) => `--ignore-table=${SOURCE_DB}.${t}`), SOURCE_DB,
], { env, stdio: 'inherit' });
if (d.status !== 0) throw new Error('mysqldump failed.');

let sql = readFileSync(dump, 'utf8');
for (const [from, to] of map) if (from !== to) sql = sql.split(from).join(to);
const out = join(dir, 'rewritten.sql');
if (CLEAR_FIRST) {
  // Full backup of the target before anything is deleted; abort if it fails.
  const backup = join(dir, `backup-${tgt.db_name}.sql`);
  const b = spawnSync('mysqldump', [...common, '--single-transaction', '--set-gtid-purged=OFF', '--routines', '--result-file', backup, tgt.db_name], { env, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('Backup of the target failed. Nothing deleted.');
  console.log('Target backup written to', backup);
  // One transaction: the client stops at the first error and the open transaction rolls back.
  const dels = clearPlan.clear.map((t) => `DELETE FROM ${q(t)};`).join('\n');
  sql = `SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSTART TRANSACTION;\n${dels}\n${sql}\nCOMMIT;\n`;
}
writeFileSync(out, sql);

const r = spawnSync('mysql', [...common, tgt.db_name], { env, input: readFileSync(out), stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error('Restore failed; target may be partly loaded.');
console.log('Restore complete. Working files in', dir);

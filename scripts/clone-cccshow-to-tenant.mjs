#!/usr/bin/env node
/**
 * Copies cccshow's DATA into an existing tenant, keeping that tenant's own
 * identity: its company, its operational area and its users stay exactly as
 * they are. Nothing about login, roles or the company/area rows is copied.
 *
 *   node scripts/clone-cccshow-to-tenant.mjs --target-code <tenant_code>            (plan only)
 *   node scripts/clone-cccshow-to-tenant.mjs --target-code <code> --apply --confirm-db <db_name>
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

if (T.companies.length !== 1) throw new Error(`Target needs exactly one company, found ${T.companies.length}.`);
if (T.areas.length < 1) throw new Error('Target has no operational area; create it first.');
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
if (T.areas.length > 1) console.log(`  note: target has ${T.areas.length} areas; using ${T.areas[0].area_code}`);

if (!flag('apply')) {
  console.log('\nPlan only. Add --apply --confirm-db <db_name> to run.');
  process.exit(0);
}
if (arg('confirm-db') !== tgt.db_name) {
  console.error(`--confirm-db must equal ${tgt.db_name}. Nothing restored.`);
  process.exit(1);
}

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
  '--set-gtid-purged=OFF', '--skip-triggers', '--result-file', dump,
  ...SKIP.map((t) => `--ignore-table=${SOURCE_DB}.${t}`), SOURCE_DB,
], { env, stdio: 'inherit' });
if (d.status !== 0) throw new Error('mysqldump failed.');

let sql = readFileSync(dump, 'utf8');
for (const [from, to] of map) if (from !== to) sql = sql.split(from).join(to);
const out = join(dir, 'rewritten.sql');
writeFileSync(out, sql);

const r = spawnSync('mysql', [...common, tgt.db_name], { env, input: readFileSync(out), stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error('Restore failed; target may be partly loaded.');
console.log('Restore complete. Working files in', dir);

/**
 * Replace one company's data with a clean, realistic TEST dataset (Rishi, 13 Oct), so a test company can be reseeded
 * locally and checked by hand.
 *
 *   pnpm nx run api:db-seed-test-company -- --tenant <code|db> --company <code|id> \
 *        [--source-tenant devco] [--source-company TRIPLEC] [--days 14] [--verify | --apply]
 *
 * What it does to the TARGET company (never the source):
 *   1. WIPE   every row with the company's company_id in every tenant table, child tables first (the foreign-key order
 *             is computed from information_schema), plus the rows of tables with no company_id that hang off them.
 *             Kept: company_master and the company's profile rows, users, roles, user<->company/role/area links, the
 *             operational area(s), audit_log, __drizzle_migrations, tenant-level templates (company_id IS NULL) and
 *             every other company. Never DROP, never TRUNCATE.
 *   2. MASTERS copied from the source company (items, categories, UOM, breeds, lifecycle stages with KPIs, stages,
 *             activities, reasons, number series restarted at 0, KPI metrics, DEPARTMENT cost centres, alert rules,
 *             planning settings ...) with seed-test-masters.lib.ts. The source's farms, batches, animals and
 *             transactions are NOT copied. MORTALITY reasons are topped up to Respiratory disease / Crushed by sow /
 *             Heat stress through ReasonService.
 *   3. STRUCTURE through lib/seed-location.ts (codes from the LOCATION series): TEST FARM 1..4 with 4/5/6/5 sheds, 4-6
 *             pens a shed, silos in the four approved topologies (1:1, shared silo, many-to-many, mixed) linked with
 *             silo_shed_link, a store per farm, a Farm Cost Centre and a Department on each farm.
 *   4. BATCHES & ANIMALS through BatchService / AnimalService: per farm A (ANIMAL_WISE, 20 sows spread over
 *             Gestation/Farrowing/Lactation), B (BATCH_WISE, 20 registered weaners), C and D (BATCH_WISE count-only,
 *             80-120 head). 16 batches, 160 registered animals. Schedulers are generated from the breed lifecycle.
 *   5. STOCK   opening goods receipts (create + post) into every store and silo for the feed the schedulers draw.
 *   6. HISTORY --days (14) days ending YESTERDAY, each day saved as drafts and then posted exactly as the Data Entry
 *             Post button does (BatchService.postBatchDay / postStageDay, which write batch_data_entry_lock). A few
 *             deaths on every batch. Today stays unposted: it is the pending day.
 *   7. FEED PLANNING by running seed-feed-mill-demo.ts for the company (mill, bins, bin diet assignments).
 *   8. VERIFICATION read from MySQL and printed.
 *
 * Modes. Default is read-only: it prints what would be deleted per table and what would be created. --verify runs the
 * WIPE and the MASTER COPY inside one transaction and rolls it back (proving the foreign-key order and the copy).
 * The Nest services in steps 3-7 open their own connections and their own transactions, so they CANNOT be rolled
 * back: --verify therefore prints their plan and does not run them. --apply commits everything.
 *
 * Guard: the same as seed-test-masters.ts - local MySQL hosts only (127.0.0.1, localhost, ::1), no override. Refuses
 * without --tenant and --company, and when the target is the source company.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { and, eq, getTableColumns, getTableName, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { RowDataPacket, Connection } from 'mysql2/promise';
import * as schema from '../core/database/schema';
import * as masterSchema from '../core/database/master-schema';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import { companyTemplateTables, planTemplateCopies, writeTemplateCopies } from '../modules/core/company/copy-master-templates';
import { bootApp } from './demo/harness';
import { collectExternalRefs, prepareSeedSets, resolveCompanyId, resolveTenantDb, summarize, type RefLookup, type SourceSet } from './seed-test-masters.lib';
import {
  KEEP_TABLES, assertTargetIsNotSource, buildChildDeleteSql, buildTestCompanyPlan, dateOffset, parseTestCompanyArgs, planChildPaths,
  planCounts, planDeleteOrder, planKeptReferences, placeBatchesInSheds, batchesForFarm, deathSchedule, historyDates, type ChildPath, type FkEdge, type TestCompanyArgs,
} from './seed-test-company.lib';
import { ensureMortalityReasons, postHistory, runInTenant, seedBatches, seedStock, seedStructure, type Actor, type ServiceRun } from './seed-test-company.services';

const ident = /^[a-zA-Z0-9_]+$/;
const rowsOf = async (c: Connection, sql: string, params: unknown[] = []) => (await c.query<RowDataPacket[]>(sql, params))[0] as any[];

// ---------------------------------------------------------------------------
// The wipe
// ---------------------------------------------------------------------------
interface WipePlan {
  order: string[];
  nullify: Array<{ table: string; column: string }>;
  keptRefs: FkEdge[];
  companyTables: Set<string>;
  childPaths: ChildPath[];
  untouched: string[];
}

async function planWipe(c: Connection, database: string): Promise<WipePlan> {
  const tables = (await rowsOf(c, "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", [database])).map((r) => r.t as string);
  const withCompany = new Set((await rowsOf(c, "SELECT DISTINCT table_name AS t FROM information_schema.columns WHERE table_schema = ? AND column_name = 'company_id'", [database])).map((r) => r.t as string));
  const edges: FkEdge[] = (await rowsOf(c,
    `SELECT k.table_name AS t, k.column_name AS c, k.referenced_table_name AS rt, k.referenced_column_name AS rc, (col.is_nullable = 'YES') AS nullable
       FROM information_schema.key_column_usage k
       JOIN information_schema.columns col ON col.table_schema = k.table_schema AND col.table_name = k.table_name AND col.column_name = k.column_name
      WHERE k.table_schema = ? AND k.referenced_table_name IS NOT NULL`, [database]))
    .map((r) => ({ table: r.t, column: r.c, refTable: r.rt, refColumn: r.rc, nullable: !!Number(r.nullable) }));
  const companyTables = new Set([...withCompany].filter((t) => tables.includes(t) && !KEEP_TABLES.has(t)));
  const childPaths = planChildPaths(companyTables, tables.filter((t) => !withCompany.has(t) && !KEEP_TABLES.has(t)), edges);
  const deleteSet = new Set([...companyTables, ...childPaths.map((p) => p.table)]);
  const { order, nullify } = planDeleteOrder([...deleteSet], edges);
  const keepSet = new Set(tables.filter((t) => !deleteSet.has(t)));
  const keptRefs = planKeptReferences(deleteSet, keepSet, edges);
  const untouched = tables.filter((t) => !deleteSet.has(t)).sort();
  return { order, nullify, keptRefs, companyTables, childPaths, untouched };
}

async function countWipe(c: Connection, plan: WipePlan, companyId: string): Promise<Array<{ table: string; rows: number }>> {
  const out: Array<{ table: string; rows: number }> = [];
  for (const t of plan.order) {
    let n = 0;
    if (plan.companyTables.has(t)) n += Number((await rowsOf(c, `SELECT COUNT(*) AS n FROM \`${t}\` WHERE company_id = ?`, [companyId]))[0].n);
    for (const p of plan.childPaths.filter((x) => x.table === t)) {
      n += Number((await rowsOf(c, buildChildDeleteSql(p).replace(/^DELETE t0 FROM/, 'SELECT COUNT(*) AS n FROM'), [companyId]))[0].n);
    }
    out.push({ table: t, rows: n });
  }
  return out;
}

async function runWipe(c: Connection, plan: WipePlan, companyId: string, log: (s: string) => void): Promise<Array<{ table: string; deleted: number }>> {
  for (const n of plan.nullify) {
    const [res] = await c.query(`UPDATE \`${n.table}\` SET \`${n.column}\` = NULL WHERE company_id = ? AND \`${n.column}\` IS NOT NULL`, [companyId]) as any;
    if (res.affectedRows) log(`  unlinked ${res.affectedRows} ${n.table}.${n.column} (cycle/self reference)`);
  }
  for (const e of plan.keptRefs) {
    if (!plan.companyTables.has(e.refTable)) { log(`  WARNING: kept table ${e.table}.${e.column} references ${e.refTable}, which has no company_id; not unlinked`); continue; }
    if (!e.nullable) {
      const [bad] = await rowsOf(c, `SELECT COUNT(*) AS n FROM \`${e.table}\` WHERE \`${e.column}\` IN (SELECT \`${e.refColumn}\` FROM \`${e.refTable}\` WHERE company_id = ?)`, [companyId]);
      if (Number(bad.n) > 0) throw new Error(`Kept table ${e.table}.${e.column} (NOT NULL) points at ${bad.n} ${e.refTable} row(s) being wiped.`);
      continue;
    }
    const [res] = await c.query(`UPDATE \`${e.table}\` SET \`${e.column}\` = NULL WHERE \`${e.column}\` IN (SELECT \`${e.refColumn}\` FROM \`${e.refTable}\` WHERE company_id = ?)`, [companyId]) as any;
    if (res.affectedRows) log(`  unlinked ${res.affectedRows} kept ${e.table}.${e.column} -> ${e.refTable}`);
  }
  const out: Array<{ table: string; deleted: number }> = [];
  for (const t of plan.order) {
    let n = 0;
    for (const p of plan.childPaths.filter((x) => x.table === t)) n += ((await c.query(buildChildDeleteSql(p), [companyId]))[0] as any).affectedRows;
    if (plan.companyTables.has(t)) n += ((await c.query(`DELETE FROM \`${t}\` WHERE company_id = ?`, [companyId]))[0] as any).affectedRows;
    out.push({ table: t, deleted: n });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Masters (the non-operational branch of seed-test-masters.ts)
// ---------------------------------------------------------------------------
async function planMasters(src: Connection, tgt: Connection, sourceCompany: string, targetCompany: string, tenantId: string) {
  const sdb = drizzle(src, { schema, mode: 'default' });
  const tdb = drizzle(tgt, { schema, mode: 'default' });
  const sets: SourceSet[] = [];
  for (const table of companyTemplateTables) {
    // The source's farms, sheds, pens and silos are not copied: the test structure is built through the location series.
    if (table === schema.locationMaster) continue;
    const c = getTableColumns(table);
    const conditions = [eq(c.company_id, sourceCompany)];
    if (c.is_active) conditions.push(eq(c.is_active, true));
    if (c.deleted_at) conditions.push(isNull(c.deleted_at));
    // Cost centres: only the DEPARTMENT ones; the test farms get cost centres of their own.
    if (table === schema.costCenterMaster) conditions.push(eq(schema.costCenterMaster.cost_center_type, 'DEPARTMENT'));
    sets.push({ table, rows: await sdb.select().from(table).where(and(...conditions)) });
  }
  for (const [table, parent, key] of [
    [schema.itemAttributeValues, schema.itemMaster, 'item_id'],
    [schema.feedFormulaIngredients, schema.feedFormulaMaster, 'formula_id'],
  ] as const) {
    const ids = sets.find((x) => x.table === parent)?.rows.map((r) => r[key]) || [];
    if (ids.length) sets.push({ table, rows: await sdb.select().from(table).where(inArray(getTableColumns(table)[key], ids)) });
  }
  const lookup: RefLookup = { exists: new Set(), remap: new Map() };
  const refs = collectExternalRefs(sets, companyTemplateTables, new Set());
  const byTable = new Map<string, typeof refs>();
  for (const r of refs) byTable.set(r.foreignTable, [...(byTable.get(r.foreignTable) || []), r]);
  for (const [ft, list] of byTable) {
    const table = (Object.values(schema) as unknown[]).find((v): v is any => { try { return getTableName(v as any) === ft; } catch { return false; } });
    if (!table || companyTemplateTables.includes(table)) continue; // the target company is empty after the wipe: nothing of its own to map to
    const cols = getTableColumns(table);
    for (const column of new Set(list.map((r) => r.foreignColumn))) {
      const values = list.filter((r) => r.foreignColumn === column).map((r) => r.value);
      for (const f of await tdb.select({ v: cols[column] }).from(table).where(inArray(cols[column], values))) lookup.exists.add(`${ft}:${f.v}`);
    }
  }
  const prepared = prepareSeedSets(sets, tenantId, lookup, companyTemplateTables, new Set());
  const copies = planTemplateCopies(prepared.sets, targetCompany);
  const copiedByTable = new Map<string, number>();
  for (const c of copies) copiedByTable.set(getTableName(c.table), (copiedByTable.get(getTableName(c.table)) || 0) + 1);

  // Company-level feed planning settings (safety stock, bag size ...). The generated active_scope_key is left to MySQL.
  const planning = await sdb.select().from(schema.feedPlanningSetting).where(and(eq(schema.feedPlanningSetting.company_id, sourceCompany), isNull(schema.feedPlanningSetting.farm_id)));
  return { copies, prepared, summary: summarize(prepared.reports, copiedByTable, new Map()), planning, tdb };
}

// ---------------------------------------------------------------------------
// Verification, read from MySQL
// ---------------------------------------------------------------------------
async function verification(c: Connection, companyId: string, today: string, days: number, log: (s: string) => void) {
  const one = async (sql: string) => Number((await rowsOf(c, sql, [companyId]))[0].n);
  const loc = (type: string) => one(`SELECT COUNT(*) AS n FROM location_master WHERE company_id = ? AND location_type = '${type}' AND deleted_at IS NULL`);
  const counts = {
    farms: await loc('FARM'), sheds: await loc('SHED'), pens: await loc('PEN'), silos: await loc('SILO'), stores: await loc('STORE'),
    silo_shed_links: await one('SELECT COUNT(*) AS n FROM silo_shed_link WHERE company_id = ?'),
    batches: await one('SELECT COUNT(*) AS n FROM batch_header WHERE company_id = ?'),
    batches_active: await one("SELECT COUNT(*) AS n FROM batch_header WHERE company_id = ? AND status = 'ACTIVE'"),
    registered_animals: await one('SELECT COUNT(*) AS n FROM animal_register WHERE company_id = ?'),
    animals_alive: await one("SELECT COUNT(*) AS n FROM animal_register WHERE company_id = ? AND is_active = 1 AND status NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')"),
    animals_dead: await one("SELECT COUNT(*) AS n FROM animal_register WHERE company_id = ? AND status = 'DEAD'"),
    mortality_rows: await one('SELECT COUNT(*) AS n FROM batch_mortality_animal WHERE company_id = ? AND posted = 1'),
    receipts_posted: await one("SELECT COUNT(*) AS n FROM goods_receipt WHERE company_id = ? AND status = 'POSTED'"),
    ledger_rows: await one('SELECT COUNT(*) AS n FROM inventory_ledger WHERE company_id = ?'),
    scheduler_headers: await one('SELECT COUNT(*) AS n FROM scheduler_header WHERE company_id = ?'),
    scheduler_lines: await one('SELECT COUNT(*) AS n FROM scheduler_line l JOIN scheduler_header h ON h.scheduler_id = l.scheduler_id WHERE h.company_id = ?'),
  };
  console.log('\nCounts (from MySQL):'); console.table([counts]);

  const batches = await rowsOf(c, 'SELECT batch_id, batch_no, remarks, tracking_mode, costing_method, status, farm_id, start_date, opening_quantity, closing_quantity FROM batch_header WHERE company_id = ? ORDER BY remarks', [companyId]);
  const rows: any[] = [];
  const problems: string[] = [];
  for (const b of batches) {
    const locks = await rowsOf(c, "SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS d, COUNT(DISTINCT stage_id) AS stages FROM batch_data_entry_lock WHERE batch_id = ? AND status = 'LOCKED' GROUP BY entry_date ORDER BY entry_date", [b.batch_id]);
    // Animal-wise: a day is done when every stage holding live animals is locked (as getNextPendingDate decides);
    // a stage whose scheduler has no animals in it needs no lock.
    const occupiedStages = Number((await rowsOf(c, "SELECT COUNT(DISTINCT current_stage_id) AS n FROM animal_register WHERE current_batch_id = ? AND is_active = 1", [b.batch_id]))[0].n);
    const need = b.tracking_mode === 'ANIMAL_WISE' ? Math.max(1, occupiedStages) : 1;
    const doneDates = new Set(locks.filter((l) => Number(l.stages) >= need).map((l) => l.d));
    const start = String(b.start_date).slice(0, 10);
    let next = start;
    while (doneDates.has(next)) next = dateOffset(next, -1);
    const row: any = {
      batch: b.batch_no, ref: b.remarks, mode: b.tracking_mode, status: b.status, locked_days: doneDates.size, last_locked: [...doneDates].pop() ?? '-', next_pending: next,
      opening: Number(b.opening_quantity ?? 0), closing: Number(b.closing_quantity ?? 0),
    };
    if (next !== today) problems.push(`${b.remarks}: next pending date is ${next}, expected ${today}`);
    if (doneDates.size !== days) problems.push(`${b.remarks}: ${doneDates.size} locked day(s), expected ${days}`);
    if (b.tracking_mode === 'BATCH_WISE' && b.costing_method === 'BIO_ASSET') {
      const [state] = await rowsOf(c, 'SELECT current_quantity FROM batch_bio_asset_state WHERE batch_id = ?', [b.batch_id]);
      const [sched] = await rowsOf(c, 'SELECT animal_count FROM scheduler_header WHERE batch_id = ? AND stage_id = (SELECT stage_id FROM batch_header WHERE batch_id = ?)', [b.batch_id, b.batch_id]);
      row.bio_asset_herd = Number(state?.current_quantity ?? NaN); row.scheduler_count = Number(sched?.animal_count ?? NaN);
      const [reg] = await rowsOf(c, "SELECT COUNT(*) AS n FROM animal_register WHERE current_batch_id = ? AND is_active = 1 AND status NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')", [b.batch_id]);
      row.registered_alive = Number(reg.n);
      if (!(row.bio_asset_herd === row.closing && row.closing === row.scheduler_count)) problems.push(`${b.remarks}: bio-asset herd ${row.bio_asset_herd} / closing ${row.closing} / scheduler ${row.scheduler_count} do not agree`);
    }
    if (b.tracking_mode === 'ANIMAL_WISE') {
      const per = await rowsOf(c, `SELECT h.stage_id, h.animal_count, (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = h.batch_id AND a.current_stage_id = h.stage_id AND a.is_active = 1 AND a.status NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')) AS live FROM scheduler_header h WHERE h.batch_id = ?`, [b.batch_id]);
      row.stage_counts = per.map((p) => `${Number(p.animal_count)}/${p.live}`).join(' ');
      for (const p of per) if (Number(p.animal_count) !== Number(p.live)) problems.push(`${b.remarks}: scheduler animal_count ${Number(p.animal_count)} != live registered ${p.live} in a stage`);
    }
    rows.push(row);
  }
  console.log('\nPer batch (locked days = batch_data_entry_lock rows, next pending recomputed from them):'); console.table(rows);
  if (problems.length) { console.log('\nMISMATCHES:'); problems.forEach((p) => console.log(`  - ${p}`)); } else log('\nNo mismatches: every batch has all days locked, next pending date is today, and the herd numbers agree.');
  return { counts, rows, problems };
}

// ---------------------------------------------------------------------------
async function run() {
  const args: TestCompanyArgs = parseTestCompanyArgs(process.argv.slice(2));
  const apply = args.mode === 'apply';
  const verify = args.mode === 'verify';
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' - this script may only touch local databases.`);
  }
  const connect = (database: string) => mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
    // Dates as 'YYYY-MM-DD' text: a JS Date printed as "Tue Sep 29 ..." and never matched a locked day.
    dateStrings: true,
  });
  const master = await connect(process.env.DATABASE_NAME || 'nf_master');
  let tenants: { tenant_code: string; db_name: string }[];
  try { tenants = await rowsOf(master, 'SELECT tenant_code, db_name FROM tenant_master') as any; } finally { await master.end(); }
  const sourceDb = resolveTenantDb(args.sourceTenant, tenants);
  const targetDb = resolveTenantDb(args.tenant, tenants);
  if (!ident.test(sourceDb) || !ident.test(targetDb)) throw new Error('Database names may only contain letters, digits and underscores.');
  const companiesOf = async (database: string) => { const c = await connect(database); try { return await rowsOf(c, 'SELECT company_id, company_code, deleted_at, is_active FROM company_master'); } finally { await c.end(); } };
  const sourceCompany = resolveCompanyId(args.sourceCompany, sourceDb, await companiesOf(sourceDb));
  const targetCompanies = await companiesOf(targetDb);
  const targetCompany = resolveCompanyId(args.company, targetDb, targetCompanies);
  const targetRow = targetCompanies.find((c) => c.company_id === targetCompany)!;
  const targetUnusable = targetRow.deleted_at || !targetRow.is_active
    ? `Target company ${targetRow.company_code} is ${targetRow.deleted_at ? 'deleted' : 'inactive'} in ${targetDb}.company_master. The services refuse a deleted company; restore it (deleted_at NULL, is_active 1) first - this script keeps the company row as it finds it.`
    : null;
  if (targetUnusable && apply) throw new Error(targetUnusable);
  assertTargetIsNotSource({ db: sourceDb, companyId: sourceCompany }, { db: targetDb, companyId: targetCompany });

  const src = await connect(sourceDb);
  const tgt = await connect(targetDb);
  const today = new Date().toISOString().slice(0, 10);
  const log = (s: string) => console.log(s);
  try {
    const [t] = await rowsOf(tgt, 'SELECT tenant_id, company_code, company_name FROM company_master WHERE company_id = ?', [targetCompany]);
    const [s] = await rowsOf(src, 'SELECT company_code FROM company_master WHERE company_id = ?', [sourceCompany]);
    if (!t) throw new Error(`Target company ${targetCompany} not found in ${targetDb}.company_master.`);
    const tenantId: string = t.tenant_id;
    const area = (await rowsOf(tgt, 'SELECT area_id, area_code, nob_id, lob_id, is_active FROM operational_area_master WHERE company_id = ? ORDER BY is_active DESC LIMIT 1', [targetCompany]))[0];
    if (!area) throw new Error(`Company ${t.company_code} has no operational area. The seed reuses an existing one; create it first.`);
    const sourceBefore = async () => {
      const n = async (sql: string) => Number((await rowsOf(src, sql, [sourceCompany]))[0].n);
      return { batch_header: await n('SELECT COUNT(*) AS n FROM batch_header WHERE company_id = ?'), location_master: await n('SELECT COUNT(*) AS n FROM location_master WHERE company_id = ?'), animal_register: await n('SELECT COUNT(*) AS n FROM animal_register WHERE company_id = ?'), inventory_ledger: await n('SELECT COUNT(*) AS n FROM inventory_ledger WHERE company_id = ?') };
    };
    const before = await sourceBefore();

    console.log(`Source: ${sourceDb} / ${s?.company_code} (${sourceCompany})   [read only]`);
    console.log(`Target: ${targetDb} / ${t.company_code} "${t.company_name}" (${targetCompany})   Mode: ${apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY'}   days=${args.days}   today=${today}`);
    if (targetUnusable) console.log(`WARNING: ${targetUnusable} (--apply would refuse.)`);
    console.log(`Operational area kept and reused: ${area.area_code}${area.is_active ? '' : ' (inactive - left as it is)'}`);

    // ---- 1. wipe plan
    const wipe = await planWipe(tgt, targetDb);
    const counts = await countWipe(tgt, wipe, targetCompany);
    console.log('\n== 1. WIPE: rows that belong to the target company, in the order they are deleted (children first) ==');
    console.table(counts.filter((c) => c.rows > 0));
    console.log(`Total rows to delete: ${counts.reduce((n, c) => n + c.rows, 0)} across ${counts.filter((c) => c.rows > 0).length} table(s) (of ${wipe.order.length} in the delete set).`);
    if (wipe.nullify.length) console.log(`Cycle/self references unlinked first: ${wipe.nullify.map((n) => `${n.table}.${n.column}`).join(', ')}`);
    if (wipe.keptRefs.length) console.log(`Kept tables whose links into wiped rows are cleared: ${wipe.keptRefs.map((e) => `${e.table}.${e.column}`).join(', ')}`);
    console.log(`Never touched (${wipe.untouched.length}): ${wipe.untouched.join(', ')}`);
    console.log(`Plus company-scoped tables kept on purpose: ${[...KEEP_TABLES].join(', ')}`);

    // ---- 2. masters plan
    const masters = await planMasters(src, tgt, sourceCompany, targetCompany, tenantId);
    console.log('\n== 2. MASTERS copied from the source company (number series restart at 0; cost centres: DEPARTMENT only) ==');
    console.table(masters.summary.rows.filter((r) => r.copy > 0 || r.rows_skipped > 0));
    console.log(`Totals: ${masters.summary.totals.copy} row(s) to copy, ${masters.summary.totals.rows_skipped} skipped, + ${masters.planning.length} company feed-planning setting row(s).`);

    // ---- 3-6 structure plan
    const plan = buildTestCompanyPlan();
    const pc = planCounts(plan);
    console.log('\n== 3-6. CREATED through the application services ==');
    console.table([pc]);
    for (const farm of plan.fixture.farms) {
      const f = Number(farm.key.replace('FARM', ''));
      const place = placeBatchesInSheds(f, batchesForFarm(f));
      console.log(`  ${farm.name}: ${farm.sheds.length} sheds [pens ${farm.sheds.map((x) => x.pens.length).join('/')}], silos ${Object.entries(farm.links).map(([k, v]) => `${k.split('-')[1]}->sheds ${v.map((x) => x.split('SHED')[1]).join(',')}`).join('; ')}, store; batches A..D in sheds ${[...place.values()].join('/')}`);
    }
    const dates = historyDates(today, args.days);
    console.log(`  history ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length} days, today ${today} left unposted); deaths per batch kind on window days:`);
    console.log(`    A ${JSON.stringify(deathSchedule('A', 1, args.days))}  B ${JSON.stringify(deathSchedule('B', 1, args.days))}  C ${JSON.stringify(deathSchedule('C', 1, args.days))}  D ${JSON.stringify(deathSchedule('D', 1, args.days))}`);
    console.log('  feed planning: seed-feed-mill-demo.ts is run for the company (mill, 4 bins, bin diet assignments) after the history.');

    if (!apply && !verify) { console.log('\nRead-only. No changes attempted.'); return; }

    // ---- wipe + masters in one transaction
    const tdb = masters.tdb;
    await tgt.beginTransaction();
    try {
      console.log('\nWiping ...');
      const deleted = await runWipe(tgt, wipe, targetCompany, log);
      console.table(deleted.filter((d) => d.deleted > 0));
      console.log('Copying masters ...');
      await writeTemplateCopies(tdb, masters.copies);
      for (const p of masters.planning) {
        const { active_scope_key: _generated, ...rest } = p as any;
        await tdb.insert(schema.feedPlanningSetting).values({ ...rest, setting_id: crypto.randomUUID(), company_id: targetCompany, tenant_id: tenantId, created_by: null, updated_by: null });
      }
      console.log(`  ${masters.copies.length} master row(s) written.`);
      // A company whose setup wizard is unfinished opens on the wizard, not the console (Rishi, 13 Oct): the seeded
      // test company is marked set up so it can be used straight away. Only the target company row changes.
      await tdb.update(schema.companyMaster).set({ onboarding_status: 'COMPLETED' }).where(eq(schema.companyMaster.company_id, targetCompany));
      // Feed planning needs a feed item's form (Bulk/Bagged) as well as its Diet No; the source's feed items carry no
      // form, so the test company's FEED items without one are set to BULK (silos hold bulk feed). Target company only.
      await tdb.update(schema.itemMaster).set({ feed_form: 'BULK' }).where(and(
        eq(schema.itemMaster.company_id, targetCompany), eq(schema.itemMaster.item_type, 'FEED'), isNull(schema.itemMaster.feed_form),
      ));
      console.log('  feed items without a form set to BULK (needed for bin diet assignments).');
      console.log('  company setup marked COMPLETED (opens in the console, not the setup wizard).');
    } catch (err) { await tgt.rollback(); throw err; }
    if (verify) {
      await tgt.rollback();
      console.log('\nVerified and rolled back. The wipe and the master copy ran against the real tables and changed nothing.');
      console.log('NOT run in --verify: steps 3-7 (structure, batches, stock, history, feed planning). The Nest services open their own connections and');
      console.log('transactions, so they cannot be rolled back; run --apply to execute them.');
      return;
    }
    await tgt.commit();
    console.log('Committed wipe + masters.');

    // ---- 3-6 through the services
    const app = await bootApp();
    try {
      const masterDb = app.get<any>(MASTER_CONNECTION);
      const [tenant] = await masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.db_name, targetDb)).limit(1);
      if (!tenant) throw new Error(`Tenant for ${targetDb} not found in nf_master.`);
      const tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);
      const [user] = await rowsOf(tgt,
        `SELECT u.user_id, u.email, u.user_type FROM user_master u
          WHERE u.deleted_at IS NULL AND u.is_active = 1 AND (
            (u.company_id = ? AND u.user_type = 'COMPANY_ADMIN')
            OR u.user_id IN (SELECT user_id FROM user_company_assignments WHERE company_id = ? AND is_active = 1)
            OR (u.tenant_id = ? AND u.user_type = 'TENANT_ADMIN'))
          ORDER BY (u.company_id = ? AND u.user_type = 'COMPANY_ADMIN') DESC, (u.user_type = 'TENANT_ADMIN') DESC, u.created_at LIMIT 1`, [targetCompany, targetCompany, tenantId, targetCompany]);
      if (!user) throw new Error(`No COMPANY_ADMIN or TENANT_ADMIN user found for ${t.company_code}; the services need an actor.`);
      const actor: Actor = { userId: user.user_id, userType: user.user_type, tenantId, email: user.email };
      const sr: ServiceRun = { app, tenantId, companyId: targetCompany, nobId: area.nob_id, lobId: area.lob_id, actor, today, days: args.days, log };
      console.log(`\nActor: ${actor.email} (${actor.userType})`);
      await runInTenant(app, tenantDb as any, tenantId, async () => {
        console.log('\n-- mortality reasons');
        const reasonIds = await ensureMortalityReasons(sr);
        console.log('-- structure');
        const farms = await seedStructure(sr, plan);
        console.log('-- batches and animals');
        const batches = await seedBatches(sr, farms);
        console.log('-- opening stock');
        const lots = await seedStock(sr, farms, batches);
        console.log(`-- history (${dates[0]} .. ${dates[dates.length - 1]})`);
        const results = await postHistory(sr, farms, batches, lots, reasonIds);
        console.table(results);
      });
    } finally {
      await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }

    // ---- 7. feed planning, by the existing script
    console.log('\n-- feed planning (seed-feed-mill-demo.ts)');
    try {
      const out = execFileSync(process.execPath, [
        '--env-file-if-exists=.env', '--import', 'tsx', path.resolve(__dirname, 'seed-feed-mill-demo.ts'),
        '--tenant', targetDb, '--company', targetCompany, '--from', dates[0], '--days', String(args.days + 28), '--apply',
      ], { cwd: process.cwd(), env: { ...process.env, NX_WORKSPACE_ROOT_PATH: undefined } as any, encoding: 'utf8', timeout: 300_000 });
      console.log(out.trim().split('\n').slice(-12).join('\n'));
    } catch (err: any) {
      console.log(`feed planning skipped: ${(err.stdout || '').toString().slice(-400)} ${(err.stderr || err.message).toString().slice(-400)}`);
    }

    // ---- 8. verification
    const ver = await connect(targetDb);
    try {
      await verification(ver, targetCompany, today, args.days, log);
      const feedRows = await rowsOf(ver, "SELECT (SELECT COUNT(*) FROM location_master WHERE company_id = ? AND location_type IN ('MILL','BIN')) AS mill_locations, (SELECT COUNT(*) FROM bin_diet_assignment WHERE company_id = ?) AS bin_diet_assignments", [targetCompany, targetCompany]);
      console.log('\nFeed planning rows:'); console.table(feedRows);
    } finally { await ver.end(); }
    const after = await sourceBefore();
    const same = JSON.stringify(before) === JSON.stringify(after);
    console.log(`\nSource company ${s?.company_code} before: ${JSON.stringify(before)}\n                    after:  ${JSON.stringify(after)}  -> ${same ? 'UNCHANGED' : 'CHANGED (!)'}`);
  } finally {
    await src.end().catch(() => undefined);
    await tgt.end().catch(() => undefined);
  }
}

if (require.main === module) {
  run().then(
    () => process.exit(0),
    (err) => { console.error(String(err?.message ?? err).slice(0, 600)); if (err?.cause?.message) console.error(`Cause: ${err.cause.message}`); process.exit(1); },
  );
}

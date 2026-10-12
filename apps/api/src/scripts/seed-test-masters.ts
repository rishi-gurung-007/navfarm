/**
 * Seed test master data (Rishi, 12 Oct). New companies start with BLANK master
 * data; for testing this copies every company-owned master table of a SOURCE
 * company into one TARGET company, which may live in another tenant database on
 * the same MySQL server. Reuses the copy machinery of
 * modules/core/company/copy-master-templates.ts (fresh UUIDs, FKs remapped
 * between copied rows, number series restarted at 0, child tables).
 *
 * Args: --source-tenant <tenant_code|db> (default devco), --source-company
 *      <company_code|id>, --tenant <tenant_code|db>, --company <company_code|id>;
 *      tenant codes resolve through nf_master.tenant_master, company codes
 *      through the tenant database's company_master.
 * Masters only by default. With --with-operational (optionally --as-user <email>)
 * the WHOLE company is cloned: masters plus every operational table (batches,
 * stock, feed, finance, approvals ...), history included, number series keep
 * their counters, user ids become the target company's admin. The target must
 * have no operations yet (batch_header, inventory_ledger, journal_header empty).
 * See seed-operational.lib.ts.
 * Default is read-only (prints the plan); --verify writes and rolls back;
 * --apply commits. Local databases only. A table in which the target company
 * already has rows is skipped, so a second run plans nothing. References to
 * rows outside the copied set are kept if they exist in the target database,
 * mapped by code, else nulled (nullable) or the row skipped. Never touches
 * transactions, users, roles or other companies.
 */
import { and, eq, getTableColumns, getTableName, inArray, isNull, count, is, or } from 'drizzle-orm';
import { AnyMySqlTable, MySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { RowDataPacket } from 'mysql2/promise';
import * as schema from '../core/database/schema';
import { companyTemplateTables, planTemplateCopies, writeTemplateCopies } from '../modules/core/company/copy-master-templates';
import { planFullCopies, selectTables, unkeyable, type OpCopy } from './seed-operational.lib';
import { collectExternalRefs, links, parseSeedArgs, registerDbForeignKeys, prepareSeedSets, resolveCompanyId, resolveTenantDb, summarize, type RefLookup, type SourceSet } from './seed-test-masters.lib';

const ident = /^[a-zA-Z0-9_]+$/;

async function writeFullCopies(tx: any, copies: OpCopy[]): Promise<void> {
  for (let i = 0; i < copies.length;) {
    let j = i;
    while (j < copies.length && copies[j].table === copies[i].table && j - i < 200) j += 1;
    await tx.insert(copies[i].table).values(copies.slice(i, j).map((c) => c.row));
    i = j;
  }
  for (const copy of copies) {
    if (!Object.keys(copy.deferred).length) continue;
    const primary = getTableColumns(copy.table)[copy.pk];
    await tx.update(copy.table).set(copy.deferred).where(eq(primary, copy.row[copy.pk]));
  }
}

async function run() {
  const args = parseSeedArgs(process.argv.slice(2));
  const apply = args.mode === 'apply';
  const verify = args.mode === 'verify';
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local databases.`);
  }
  const connect = (database: string) => mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  const master = await connect(process.env.DATABASE_NAME || 'nf_master');
  let tenants: { tenant_code: string; db_name: string }[];
  try {
    [tenants] = await master.query<RowDataPacket[]>('SELECT tenant_code, db_name FROM tenant_master') as any;
  } finally { await master.end(); }
  const sourceDb = resolveTenantDb(args.sourceTenant, tenants);
  const targetDb = resolveTenantDb(args.tenant, tenants);
  if (!ident.test(sourceDb) || !ident.test(targetDb)) throw new Error('Database names may only contain letters, digits and underscores.');
  const companiesOf = async (database: string) => {
    const c = await connect(database);
    try { return (await c.query<RowDataPacket[]>('SELECT company_id, company_code FROM company_master WHERE deleted_at IS NULL'))[0] as any[]; } finally { await c.end(); }
  };
  const sourceCompany = resolveCompanyId(args.sourceCompany, sourceDb, await companiesOf(sourceDb));
  const targetCompany = resolveCompanyId(args.company, targetDb, await companiesOf(targetDb));
  if (sourceDb === targetDb && sourceCompany === targetCompany) throw new Error('Source and target are the same company.');

  const src = await connect(sourceDb);
  const tgt = await connect(targetDb);
  try {
    const sdb = drizzle(src, { schema, mode: 'default' });
    const tdb = drizzle(tgt, { schema, mode: 'default' });

    const [[s]] = await src.query<RowDataPacket[]>('SELECT company_code, tenant_id FROM company_master WHERE company_id = ?', [sourceCompany]) as any;
    if (!s) throw new Error(`Source company ${sourceCompany} not found in ${sourceDb}.company_master.`);
    const [[t]] = await tgt.query<RowDataPacket[]>('SELECT tenant_id, company_code FROM company_master WHERE company_id = ? AND deleted_at IS NULL', [targetCompany]) as any;
    if (!t) throw new Error(`Target company ${targetCompany} not found in ${targetDb}.company_master.`);
    const tenantId: string = t.tenant_id;
    const ops = args.withOperational;
    const allTables = [...new Set((Object.values(schema) as unknown[]).filter((v): v is MySqlTable => is(v as any, MySqlTable)))] as AnyMySqlTable[];
    if (ops) {
      const [fks] = await src.query<RowDataPacket[]>('SELECT table_name AS t, column_name AS c, referenced_table_name AS rt, referenced_column_name AS rc FROM information_schema.key_column_usage WHERE table_schema = ? AND referenced_table_name IS NOT NULL', [sourceDb]) as any;
      registerDbForeignKeys(fks.map((f: any) => ({ table: f.t, column: f.c, refTable: f.rt, refColumn: f.rc })), allTables);
    }
    const sel = selectTables(allTables, companyTemplateTables);
    let adminUserId = '';
    if (ops) {
      for (const n of ['batch_header', 'inventory_ledger', 'journal_header']) {
        const table = allTables.find((x) => getTableName(x) === n)!;
        const [{ k }] = await tdb.select({ k: count() }).from(table).where(eq(getTableColumns(table).company_id, targetCompany));
        if (Number(k) > 0) throw new Error(`Refusing --with-operational: target company already has ${k} ${n} row(s). Operational clone only goes into a company with no operations.`);
      }
      const [admins] = await tgt.query<RowDataPacket[]>(
        args.asUser
          ? 'SELECT user_id FROM user_master WHERE email = ? AND (company_id = ? OR tenant_id = ?) AND deleted_at IS NULL LIMIT 1'
          : "SELECT user_id FROM user_master WHERE deleted_at IS NULL AND ((company_id = ? AND user_type = 'COMPANY_ADMIN') OR (tenant_id = ? AND user_type = 'TENANT_ADMIN')) ORDER BY (user_type = 'COMPANY_ADMIN' AND company_id = ?) DESC, created_at LIMIT 1",
        args.asUser ? [args.asUser, targetCompany, tenantId] : [targetCompany, tenantId, targetCompany]) as any;
      if (!admins[0]) throw new Error(args.asUser ? `User '${args.asUser}' not found in ${targetDb}.` : `No COMPANY_ADMIN (or TENANT_ADMIN) user found for the target company in ${targetDb}; create one or pass --as-user <email>.`);
      adminUserId = admins[0].user_id;
    }

    // 1. Load the source rows, table by table, skipping tables the target already owns.
    const skippedTables = new Map<string, string>();
    const sets: SourceSet[] = [];
    for (const table of companyTemplateTables) {
      const c = getTableColumns(table);
      const name = getTableName(table);
      const [{ n }] = await tdb.select({ n: count() }).from(table).where(eq(c.company_id, targetCompany));
      if (Number(n) > 0) { skippedTables.set(name, `target company already has ${n} row(s)`); continue; }
      const conditions = [eq(c.company_id, sourceCompany)];
      if (c.is_active) conditions.push(eq(c.is_active, true));
      if (c.deleted_at) conditions.push(isNull(c.deleted_at));
      sets.push({ table, rows: await sdb.select().from(table).where(and(...conditions)) });
    }
    // Child tables without a company_id of their own: found through the parent.
    // (--with-operational finds them generically, below.)
    if (!ops) for (const [table, parent, key] of [
      [schema.itemAttributeValues, schema.itemMaster, 'item_id'],
      [schema.feedFormulaIngredients, schema.feedFormulaMaster, 'formula_id'],
    ] as const) {
      if (skippedTables.has(getTableName(parent))) continue;
      const ids = sets.find((x) => x.table === parent)?.rows.map((r) => r[key]) || [];
      if (ids.length) sets.push({ table, rows: await sdb.select().from(table).where(inArray(getTableColumns(table)[key], ids)) });
    }

    // 1b. --with-operational: every other company table (all rows, history and inactive included), then
    //     the line/child tables without company_id (found through their parents), then any master a row refers to.
    const pk = (tb: AnyMySqlTable) => Object.entries(getTableColumns(tb)).find(([, c]) => c.primary)![0];
    const loaded = new Map<string, SourceSet>(sets.map((x) => [getTableName(x.table), x]));
    const universe = new Set([...sel.masters, ...sel.company, ...sel.children].map(getTableName));
    const addRows = (tb: AnyMySqlTable, rows: Record<string, any>[]) => {
      const n = getTableName(tb);
      const cur = loaded.get(n);
      if (cur) { const have = new Set(cur.rows.map((r) => r[pk(tb)])); cur.rows.push(...rows.filter((r) => !have.has(r[pk(tb)]))); }
      else { const set = { table: tb, rows: [...rows] }; loaded.set(n, set); sets.push(set); }
    };
    const chunks = <T,>(a: T[], n = 500) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    const pullReferencedMasters = async () => {
      const tried = new Set<string>();
      for (;;) {
        const have = new Set<string>();
        for (const x of loaded.values()) for (const r of x.rows) have.add(`${getTableName(x.table)}:${r[pk(x.table)]}`);
        const need = new Map<string, Set<string>>();
        for (const x of [...loaded.values()]) for (const l of links(x.table, sel.passthrough)) {
          const ft = getTableName(l.foreignTable);
          if (!sel.masters.includes(l.foreignTable) || skippedTables.has(ft) || l.foreignColumn !== pk(l.foreignTable)) continue;
          for (const r of x.rows) { const v = r[l.column]; if (v && !have.has(`${ft}:${v}`) && !tried.has(`${ft}:${v}`)) { tried.add(`${ft}:${v}`); (need.get(ft) || need.set(ft, new Set()).get(ft)!).add(String(v)); } }
        }
        if (!need.size) return;
        for (const [ft, ids] of need) {
          const tb = sel.masters.find((m) => getTableName(m) === ft)!;
          const c = getTableColumns(tb);
          for (const part of chunks([...ids])) addRows(tb, await sdb.select().from(tb).where(and(inArray(c[pk(tb)], part), or(eq(c.company_id, sourceCompany), isNull(c.company_id)))));
        }
      }
    };
    if (ops) {
      const keyed = (tb: AnyMySqlTable) => { const why = unkeyable(tb); if (why) skippedTables.set(getTableName(tb), why); return !why; };
      for (const tb of sel.masters) keyed(tb) || (skippedTables.has(getTableName(tb)) && loaded.delete(getTableName(tb)));
      for (const tb of sel.company) {
        if (!keyed(tb)) continue;
        const c = getTableColumns(tb);
        const [{ n }] = await tdb.select({ n: count() }).from(tb).where(eq(c.company_id, targetCompany));
        if (Number(n) > 0) { skippedTables.set(getTableName(tb), `target company already has ${n} row(s)`); continue; }
        addRows(tb, await sdb.select().from(tb).where(eq(c.company_id, sourceCompany)));
      }
      for (const n of skippedTables.keys()) { const i = sets.findIndex((x) => getTableName(x.table) === n); if (i >= 0) sets.splice(i, 1); loaded.delete(n); }
      await pullReferencedMasters();
      const doneChildren = new Set<string>();
      const children = sel.children.filter(keyed);
      for (let pass = 0; pass < 6 && doneChildren.size < children.length; pass += 1) {
        for (const tb of children) {
          const n = getTableName(tb);
          if (doneChildren.has(n)) continue;
          const parents = getTableConfig(tb).foreignKeys.map((fk) => fk.reference()).filter((r) => universe.has(getTableName(r.foreignTable)) && r.foreignTable !== tb);
          if (parents.some((r) => sel.children.includes(r.foreignTable) && !doneChildren.has(getTableName(r.foreignTable)) && !skippedTables.has(getTableName(r.foreignTable)))) continue;
          const found = new Map<string, Record<string, any>>();
          for (const r of parents) {
            const ps = loaded.get(getTableName(r.foreignTable));
            const col = r.columns[0]; const fcol = r.foreignColumns[0].name;
            const ids = ps ? ps.rows.map((x) => x[fcol]).filter(Boolean) : [];
            for (const part of chunks(ids)) for (const row of await sdb.select().from(tb).where(inArray(getTableColumns(tb)[col.name], part))) found.set(String(row[pk(tb)]), row);
          }
          doneChildren.add(n);
          if (found.size) addRows(tb, [...found.values()]);
        }
      }
      await pullReferencedMasters();
    }

    // 2. Resolve references that point outside the copied set.
    const lookup: RefLookup = { exists: new Set(), remap: new Map() };
    const companyScoped = allTables.filter((x) => !!getTableColumns(x).company_id);
    const refs = collectExternalRefs(sets, ops ? companyScoped : companyTemplateTables, ops ? sel.passthrough : new Set());
    const byTable = new Map<string, typeof refs>();
    for (const r of refs) byTable.set(r.foreignTable, [...(byTable.get(r.foreignTable) || []), r]);
    for (const [ft, list] of byTable) {
      const table = (Object.values(schema) as unknown[]).find((v): v is AnyMySqlTable => { try { return getTableName(v as AnyMySqlTable) === ft; } catch { return false; } });
      if (!table) continue;
      const cols = getTableColumns(table);
      const isCompany = ops ? !!cols.company_id : companyTemplateTables.includes(table);
      const codeKey = Object.keys(cols).find((k) => k.endsWith('_code'));
      for (const column of new Set(list.map((r) => r.foreignColumn))) {
        const values = list.filter((r) => r.foreignColumn === column).map((r) => r.value);
        // Tables owned per company can only be mapped to the target company's own rows.
        if (!isCompany) {
          const found = await tdb.select({ v: cols[column] }).from(table).where(inArray(cols[column], values));
          for (const f of found) lookup.exists.add(`${ft}:${f.v}`);
        }
        if (!codeKey) continue;
        const srcRows = await sdb.select({ v: cols[column], code: cols[codeKey] }).from(table).where(inArray(cols[column], values));
        const codes = srcRows.map((r) => r.code).filter(Boolean) as string[];
        if (!codes.length) continue;
        const where = [inArray(cols[codeKey], codes)];
        if (isCompany) where.push(eq(cols.company_id, targetCompany));
        const tgtRows = await tdb.select({ v: cols[column], code: cols[codeKey] }).from(table).where(and(...where));
        for (const sr of srcRows) {
          if (lookup.exists.has(`${ft}:${sr.v}`)) continue;
          const hit = tgtRows.find((r) => r.code === sr.code);
          if (hit) lookup.remap.set(`${ft}:${sr.v}`, String(hit.v));
        }
      }
    }

    // 3. Plan.
    const prepared = prepareSeedSets(sets, tenantId, lookup, ops ? companyScoped : companyTemplateTables, ops ? sel.passthrough : new Set());
    const copiedByTable = new Map<string, number>();
    let copies: ReturnType<typeof planTemplateCopies> = [];
    let full: ReturnType<typeof planFullCopies> | undefined;
    if (ops) {
      full = planFullCopies(prepared.sets, { tenantId, companyId: targetCompany, adminUserId });
      for (const c of full.copies) copiedByTable.set(getTableName(c.table), (copiedByTable.get(getTableName(c.table)) || 0) + 1);
    } else {
      copies = planTemplateCopies(prepared.sets, targetCompany);
      for (const c of copies) copiedByTable.set(getTableName(c.table), (copiedByTable.get(getTableName(c.table)) || 0) + 1);
    }
    const summary = summarize(prepared.reports, copiedByTable, skippedTables);

    let written = 0;
    if (verify || apply) {
      await tgt.beginTransaction();
      try {
        if (full) {
          await writeFullCopies(tdb, full.copies); written = full.copies.length;
          // Tenant-wide entry-number counter (not a drizzle table): never let new postings reuse a copied entry_no.
          const [[counter]] = await src.query<RowDataPacket[]>('SELECT last_entry_no FROM inventory_entry_counter WHERE tenant_id = ?', [s.tenant_id]) as any;
          if (counter) {
            await tgt.query('INSERT INTO inventory_entry_counter (tenant_id, last_entry_no) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_entry_no = GREATEST(last_entry_no, VALUES(last_entry_no))', [tenantId, counter.last_entry_no]);
            console.log(`inventory_entry_counter: target tenant set to at least ${counter.last_entry_no}.`);
          }
        }
        else { await writeTemplateCopies(tdb, copies); written = copies.length; }
      } catch (err) { await tgt.rollback(); throw err; }
    }

    const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY';
    console.log(`Source: ${sourceDb} / ${s.company_code} (${sourceCompany})`);
    console.log(`Target: ${targetDb} / ${t.company_code} (${targetCompany})   Mode: ${mode}`);
    console.table(summary.rows);
    console.log(`Totals: ${summary.totals.copy} row(s) to copy, ${summary.totals.rows_skipped} row(s) skipped, ${summary.totals.tables_skipped} table(s) skipped (target already populated).`);
    for (const r of prepared.reports.values()) {
      const grouped = new Map<string, number>();
      for (const why of r.skipped) grouped.set(why.slice(why.indexOf(': ') + 2), (grouped.get(why.slice(why.indexOf(': ') + 2)) || 0) + 1);
      for (const [why, n] of grouped) console.log(`  skipped ${n} ${r.table} row(s): ${why}`);
    }
    if (full) {
      console.log(`\nTable set: ${sel.masters.length} master + ${sel.company.length} operational company tables + ${sel.children.length} child tables with no company_id; ${full.tableOrder.length} actually carry rows.`);
      console.log(`Insert order: ${full.tableOrder.join(', ')}`);
      console.log(`Excluded (${sel.excluded.length}): ${sel.excluded.map((e) => e.table).sort().join(', ')}`);
      console.log(`Global reference tables, not cloned (${sel.globalTables.length}): ${sel.globalTables.join(', ')}`);
      console.log(`User columns replaced by the admin user: ${[...full.userCols].map(([t, c]) => `${t}(${c.join(',')})`).join('; ')}`);
      if (full.deferredCols.length) console.log(`Cyclic/self references inserted empty then updated: ${full.deferredCols.join(', ')}`);
      const json = [...full.jsonIds].filter(([, v]) => v.replaced || v.stale).map(([k, v]) => `${k} (ids remapped ${v.replaced}, left as is ${v.stale})`);
      console.log(`JSON columns holding ids: ${json.join('; ') || 'none'}`);
    }
    console.log(`Written: ${written} row(s).`);

    if (apply) { await tgt.commit(); console.log('Committed.'); }
    else if (verify) { await tgt.rollback(); console.log('Verified and rolled back. No changes committed.'); }
    else console.log('Read-only. No changes attempted.');
  } finally {
    await src.end();
    await tgt.end();
  }
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message.slice(0, 300)); if (err.cause?.message) console.error(`Cause: ${err.cause.message}`); process.exit(1); });
}

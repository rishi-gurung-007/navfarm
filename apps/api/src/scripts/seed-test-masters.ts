/**
 * Seed test master data (Rishi, 12 Oct). New companies start with BLANK master
 * data; for testing this copies every company-owned master table of a SOURCE
 * company into one TARGET company, which may live in another tenant database on
 * the same MySQL server. Reuses the copy machinery of
 * modules/core/company/copy-master-templates.ts (fresh UUIDs, FKs remapped
 * between copied rows, number series restarted at 0, child tables).
 *
 * Env: SOURCE_TENANT_DATABASE (default nf_devco), SOURCE_COMPANY_ID,
 *      TARGET_TENANT_DATABASE, TARGET_COMPANY_ID (all but the first required).
 * Default is read-only (prints the plan); --verify writes and rolls back;
 * --apply commits. Local databases only. A table in which the target company
 * already has rows is skipped, so a second run plans nothing. References to
 * rows outside the copied set are kept if they exist in the target database,
 * mapped by code, else nulled (nullable) or the row skipped. Never touches
 * transactions, users, roles or other companies.
 */
import { and, eq, getTableColumns, getTableName, inArray, isNull, count } from 'drizzle-orm';
import { AnyMySqlTable } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { RowDataPacket } from 'mysql2/promise';
import * as schema from '../core/database/schema';
import { companyTemplateTables, planTemplateCopies, writeTemplateCopies } from '../modules/core/company/copy-master-templates';
import { collectExternalRefs, prepareSeedSets, summarize, type RefLookup, type SourceSet } from './seed-test-masters.lib';

const ident = /^[a-zA-Z0-9_]+$/;
const need = (name: string, fallback?: string) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`${name} is required.`);
  return v;
};

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local databases.`);
  }
  const sourceDb = need('SOURCE_TENANT_DATABASE', 'nf_devco');
  const sourceCompany = need('SOURCE_COMPANY_ID');
  const targetDb = need('TARGET_TENANT_DATABASE');
  const targetCompany = need('TARGET_COMPANY_ID');
  if (!ident.test(sourceDb) || !ident.test(targetDb)) throw new Error('Database names may only contain letters, digits and underscores.');
  if (sourceDb === targetDb && sourceCompany === targetCompany) throw new Error('Source and target are the same company.');

  const connect = (database: string) => mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  const src = await connect(sourceDb);
  const tgt = await connect(targetDb);
  try {
    const sdb = drizzle(src, { schema, mode: 'default' });
    const tdb = drizzle(tgt, { schema, mode: 'default' });

    const [[s]] = await src.query<RowDataPacket[]>('SELECT company_code FROM company_master WHERE company_id = ?', [sourceCompany]) as any;
    if (!s) throw new Error(`Source company ${sourceCompany} not found in ${sourceDb}.company_master.`);
    const [[t]] = await tgt.query<RowDataPacket[]>('SELECT tenant_id, company_code FROM company_master WHERE company_id = ? AND deleted_at IS NULL', [targetCompany]) as any;
    if (!t) throw new Error(`Target company ${targetCompany} not found in ${targetDb}.company_master.`);
    const tenantId: string = t.tenant_id;

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
    for (const [table, parent, key] of [
      [schema.itemAttributeValues, schema.itemMaster, 'item_id'],
      [schema.feedFormulaIngredients, schema.feedFormulaMaster, 'formula_id'],
    ] as const) {
      if (skippedTables.has(getTableName(parent))) continue;
      const ids = sets.find((x) => x.table === parent)?.rows.map((r) => r[key]) || [];
      if (ids.length) sets.push({ table, rows: await sdb.select().from(table).where(inArray(getTableColumns(table)[key], ids)) });
    }

    // 2. Resolve references that point outside the copied set.
    const lookup: RefLookup = { exists: new Set(), remap: new Map() };
    const refs = collectExternalRefs(sets, companyTemplateTables);
    const byTable = new Map<string, typeof refs>();
    for (const r of refs) byTable.set(r.foreignTable, [...(byTable.get(r.foreignTable) || []), r]);
    for (const [ft, list] of byTable) {
      const table = (Object.values(schema) as unknown[]).find((v): v is AnyMySqlTable => { try { return getTableName(v as AnyMySqlTable) === ft; } catch { return false; } });
      if (!table) continue;
      const cols = getTableColumns(table);
      const isCompany = companyTemplateTables.includes(table);
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
    const prepared = prepareSeedSets(sets, tenantId, lookup, companyTemplateTables);
    const copies = planTemplateCopies(prepared.sets, targetCompany);
    const copiedByTable = new Map<string, number>();
    for (const c of copies) copiedByTable.set(getTableName(c.table), (copiedByTable.get(getTableName(c.table)) || 0) + 1);
    const summary = summarize(prepared.reports, copiedByTable, skippedTables);

    let written = 0;
    if (verify || apply) {
      await tgt.beginTransaction();
      try {
        await writeTemplateCopies(tdb, copies);
        written = copies.length;
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
  run().catch((err) => { console.error(err.message); process.exit(1); });
}

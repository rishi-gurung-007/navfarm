/** One-time migration for companies that previously shared tenant records.
 * Default is a read-only dry run. Apply requires a fresh database backup path.
 * It never renumbers codes, overwrites company catalog values or deletes rows. */
import { and, eq, getTableColumns, getTableName, inArray, sql, SQL } from 'drizzle-orm';
import { AnyMySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { statSync } from 'node:fs';
import * as schema from '../core/database/schema';
import { companyTemplateTables, loadCompanyTemplateCopies, writeTemplateCopies } from '../modules/core/company/copy-master-templates';

const apply = process.argv.includes('--apply');
const database = process.argv.find((arg) => arg.startsWith('--database='))?.split('=')[1];
const backup = process.argv.find((arg) => arg.startsWith('--backup='))?.slice('--backup='.length);
if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Supply the exact NAVFarm tenant database with --database=.');
if (apply && (!backup || !statSync(backup).isFile() || statSync(backup).size === 0)) throw new Error('Apply requires a verified nonempty --backup= file.');

async function run() {
  const pool = mysql.createPool({ host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database });
  const db = drizzle(pool, { schema, mode: 'default' });
  const tables = (Object.values(schema) as unknown[]).filter((value): value is AnyMySqlTable => { try { return !!getTableConfig(value as AnyMySqlTable).name; } catch { return false; } });
  const codeKeys: Record<string, string> = { item_category_master: 'category_code', location_type_master: 'type_code', item_type_master: 'type_code', no_series: 'code' };
  const primary = (table: AnyMySqlTable) => Object.values(getTableColumns(table)).find((c) => c.primary)!;
  const ownerCondition = (table: AnyMySqlTable, companyId: string): SQL | undefined => {
    const c = getTableColumns(table);
    if (c.company_id) return eq(c.company_id, companyId);
    const explicit = table === schema.itemAttributeValues ? schema.itemMaster : table === schema.breedLifecycleStages ? schema.breedMaster : undefined;
    const ref = getTableConfig(table).foreignKeys.map((fk) => fk.reference()).find((ref) =>
      ref.columns.length === 1 && getTableColumns(ref.foreignTable).company_id && (explicit ? ref.foreignTable === explicit : !companyTemplateTables.includes(ref.foreignTable)));
    if (!ref) return;
    return inArray(ref.columns[0], db.select({ id: ref.foreignColumns[0] }).from(ref.foreignTable).where(eq(getTableColumns(ref.foreignTable).company_id, companyId)));
  };
  try {
    const companies = await db.select().from(schema.companyMaster).where(sql`${schema.companyMaster.company_code} <> 'PLACEHOLDER'`);
    for (const company of companies) {
      await db.transaction(async (tx) => {
        const copies = await loadCompanyTemplateCopies(tx, company.tenant_id, company.company_id);
        const redirects = new Map<string, string>();
        const skip = new Set<string>();
        // Reuse an existing company record with the same business code, keeping
        // all its own settings. Match before inserting any fresh template rows.
        for (const table of companyTemplateTables) {
          const c = getTableColumns(table);
          const codeKey = codeKeys[getTableName(table)] || Object.keys(c).find((key) => key.endsWith('_code'));
          if (!codeKey) continue;
          const existing = await tx.select().from(table).where(eq(c.company_id, company.company_id));
          for (const copy of copies.filter((copy) => copy.table === table)) {
            const matches = existing.filter((row) => String(row[codeKey]).toLowerCase() === String(copy.row[codeKey]).toLowerCase());
            if (matches.length > 1) throw new Error(`Ambiguous existing ${getTableName(table)} code; resolve duplicates before adoption.`);
            if (matches.length) { redirects.set(copy.row[primary(table).name], String(matches[0][primary(table).name])); skip.add(copy.row[primary(table).name]); }
          }
        }
        for (const copy of copies) {
          for (const values of [copy.row, copy.deferred]) {
            for (const fk of getTableConfig(copy.table).foreignKeys) for (const column of fk.reference().columns) {
              if (redirects.has(values[column.name])) values[column.name] = redirects.get(values[column.name]);
            }
          }
        }
        // Detail natural keys prevent repeated runs adding another standards/
        // attribute row when its parent had already been adopted.
        for (const copy of copies.filter((copy) => !getTableColumns(copy.table).company_id || copy.table === schema.feedFormulaIngredients)) {
          const c = getTableColumns(copy.table);
          const keys = copy.table === schema.itemAttributeValues ? ['item_id', 'attribute_id'] : copy.table === schema.feedFormulaIngredients ? ['formula_id', 'item_id'] : ['breed_id', 'stage_id', 'calc_unit', 'period_from', 'period_to'];
          const [existing] = await tx.select().from(copy.table).where(and(...keys.map((key) => eq(c[key], copy.row[key])))).limit(1);
          if (existing) skip.add(copy.row[primary(copy.table).name]);
        }
        const inserts = copies.filter((copy) => !skip.has(copy.row[primary(copy.table).name]));
        if (apply) await writeTemplateCopies(tx, inserts);
        let references = 0;
        for (const table of tables) {
          const ownership = ownerCondition(table, company.company_id);
          if (!ownership) continue;
          for (const fk of getTableConfig(table).foreignKeys) {
            const ref = fk.reference();
            if (ref.columns.length !== 1) continue;
            for (const copy of copies.filter((copy) => copy.table === ref.foreignTable)) {
              const where = and(ownership, eq(ref.columns[0], copy.originalId));
              const [count] = await tx.select({ count: sql<number>`count(*)` }).from(table).where(where);
              const total = Number(count.count);
              if (!total) continue;
              const newId = redirects.get(copy.row[primary(copy.table).name]) || copy.row[primary(copy.table).name];
              if (apply) await tx.update(table).set({ [ref.columns[0].name]: newId }).where(where);
              references += total;
              console.log(`${company.company_code}: ${getTableName(table)}.${ref.columns[0].name}: ${total} reference(s)`);
            }
          }
        }
        console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'DRY RUN', company: company.company_code, copies: inserts.length, reused: skip.size, references }));
      });
    }
  } finally { await pool.end(); }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });

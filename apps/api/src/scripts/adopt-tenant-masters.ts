/**
 * One-off adoption of tenant template masters into each existing company (Rishi, 20 Oct, option a).
 *
 * A company now reads only its own master rows — no tenant template, no other company's. Companies created before
 * that relied on tenant rows (frtest ran on the tenant's 28 production parameters; tcdemo's batches stood on a tenant
 * QUARANTINE stage), so before the fallbacks go each company is given its own copy, once:
 *   1. every tenant row the company already has (same natural key — code, plus line of business for a stage) is
 *      matched; every other non-deleted tenant row is copied as the company's own (planTemplateAdoption);
 *   2. the company's records that point at a tenant row — through any declared foreign key, on a row of the company
 *      or a child of one — are moved onto the matched or copied row.
 * New companies still start blank (12 Oct). Tenant rows are left in place for the tenant workspace.
 *
 *   no flag    read-only: the plan per tenant and company
 *   --verify   writes everything inside a transaction, reports, rolls back
 *   --apply    writes and commits
 *   --tenant=<code>   only that tenant
 *
 * Local databases only.
 */
import { and, eq, getTableColumns, getTableName, inArray, isNull, sql, SQL } from 'drizzle-orm';
import { AnyMySqlTable, getTableConfig, MySqlTable } from 'drizzle-orm/mysql-core';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as schema from '../core/database/schema';
import { assertDatabaseAllowed } from '../core/database/database-allowlist';
import { companyTemplateTables, planTemplateAdoption, TemplateRows, writeTemplateCopies } from '../modules/core/company/copy-master-templates';

type Db = MySql2Database<typeof schema>;

const ROLLBACK = Symbol('rollback');

const allTables: AnyMySqlTable[] = Object.values(schema).filter((value): value is AnyMySqlTable => value instanceof MySqlTable);
const templateNames = new Set(companyTemplateTables.map((table) => getTableName(table)));
const columnKey = (table: AnyMySqlTable, name: string) => Object.entries(getTableColumns(table)).find(([, c]) => c.name === name)?.[0];

/** Every declared foreign key that points at a template master: the references a company's records hold. */
const templateReferences = allTables.flatMap((child) => getTableConfig(child).foreignKeys.flatMap((fk) => {
  const ref = fk.reference();
  const parent = getTableName(ref.foreignTable);
  if (!templateNames.has(parent) || ref.columns.length !== 1) return [];
  return [{ child, column: ref.columns[0], parent }];
}));

/** Rows of `child` that belong to the company: its own company_id, or a parent row's (batch lines, scheduler lines). */
function belongsTo(child: AnyMySqlTable, companyId: string): SQL | null {
  const columns = getTableColumns(child);
  if (columns.company_id) return eq(columns.company_id, companyId);
  for (const fk of getTableConfig(child).foreignKeys) {
    const ref = fk.reference();
    const parentColumns = getTableColumns(ref.foreignTable);
    if (ref.columns.length !== 1 || !parentColumns.company_id || templateNames.has(getTableName(ref.foreignTable))) continue;
    const parentKey = ref.foreignColumns[0];
    return sql`${ref.columns[0]} IN (SELECT ${parentKey} FROM ${ref.foreignTable} WHERE ${parentColumns.company_id} = ${companyId})`;
  }
  return null;
}

async function adoptCompany(db: Db, tenantId: string, company: { company_id: string; company_code: string }) {
  const tenantSets: TemplateRows[] = [];
  const companySets: TemplateRows[] = [];
  for (const table of companyTemplateTables) {
    const c = getTableColumns(table);
    const live = c.deleted_at ? [isNull(c.deleted_at)] : [];
    tenantSets.push({ table, rows: await db.select().from(table).where(and(eq(c.tenant_id, tenantId), isNull(c.company_id), ...live)) });
    // Deleted company rows still hold their code, so they count as "already has it".
    companySets.push({ table, rows: await db.select().from(table).where(and(eq(c.tenant_id, tenantId), eq(c.company_id, company.company_id))) });
  }
  // Children without a company of their own travel with their copied parent.
  const plan0 = planTemplateAdoption(tenantSets, companySets, company.company_id);
  const copiedIds = (table: AnyMySqlTable) => plan0.copies.filter((copy) => copy.table === table).map((copy) => copy.originalId);
  for (const [table, parent, key] of [
    [schema.itemAttributeValues, schema.itemMaster, 'item_id'],
    [schema.feedFormulaIngredients, schema.feedFormulaMaster, 'formula_id'],
  ] as const) {
    const ids = copiedIds(parent);
    if (ids.length) tenantSets.push({ table, rows: await db.select().from(table).where(inArray(getTableColumns(table)[key], ids)) });
  }
  const plan = planTemplateAdoption(tenantSets, companySets, company.company_id);
  await writeTemplateCopies(db, plan.copies);

  const copied = new Map<string, number>();
  for (const copy of plan.copies) copied.set(getTableName(copy.table), (copied.get(getTableName(copy.table)) ?? 0) + 1);

  const moved = new Map<string, number>();
  const unreachable = new Map<string, number>();
  for (const { child, column, parent } of templateReferences) {
    const mapping = [...plan.identities].filter(([key]) => key.startsWith(`${parent}:`))
      .map(([key, to]) => [key.slice(parent.length + 1), to] as const)
      .filter(([from, to]) => from !== to);
    if (!mapping.length) continue;
    const scope = belongsTo(child, company.company_id);
    const from = mapping.map(([id]) => id);
    if (!scope) {
      const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(child).where(inArray(column, from));
      if (Number(n)) unreachable.set(`${getTableName(child)}.${column.name}`, Number(n));
      continue;
    }
    const key = columnKey(child, column.name)!;
    const present = await db.selectDistinct({ id: column }).from(child).where(and(inArray(column, from), scope));
    const to = new Map(mapping);
    for (const { id } of present) {
      const [result] = await db.update(child).set({ [key]: to.get(String(id)) } as any).where(and(eq(column, id), scope)) as any;
      moved.set(`${getTableName(child)}.${column.name}`, (moved.get(`${getTableName(child)}.${column.name}`) ?? 0) + Number(result?.affectedRows ?? 0));
    }
  }
  return { copied, moved, unreachable };
}

async function run() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const only = args.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
  if (args.some((a) => !['--apply', '--verify'].includes(a) && !a.startsWith('--tenant=')) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify or --apply, optionally --tenant=<code>.');
  }
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`Refusing non-local host '${host}'.`);
  const port = Number(process.env.DATABASE_PORT || 3306);
  const user = process.env.DATABASE_USERNAME || 'root';
  const password = process.env.DATABASE_PASSWORD || '';
  const masterDatabase = process.env.DATABASE_NAME || 'nf_master';
  assertDatabaseAllowed(masterDatabase, 'adopt-tenant-masters master');
  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase });
  try {
    const tenants = (await drizzle(masterPool, { schema: master, mode: 'default' }).select().from(master.tenantMaster))
      .filter((t) => !only || t.tenant_code === only);
    for (const t of tenants) {
      assertDatabaseAllowed(t.db_name, `adopt-tenant-masters ${t.tenant_code}`);
      const pool = mysql.createPool({ host, port, user, password, database: t.db_name });
      const db = drizzle(pool, { schema, mode: 'default' });
      try {
        const companies = await db.select({ company_id: schema.companyMaster.company_id, company_code: schema.companyMaster.company_code, tenant_id: schema.companyMaster.tenant_id })
          .from(schema.companyMaster).where(isNull(schema.companyMaster.deleted_at));
        console.log(`[${t.tenant_code}] ${companies.length} company(ies)`);
        try {
          await db.transaction(async (tx) => {
            for (const company of companies) {
              const { copied, moved, unreachable } = await adoptCompany(tx as unknown as Db, company.tenant_id, company);
              console.log(`  ${company.company_code}: copied ${JSON.stringify(Object.fromEntries(copied))}`);
              console.log(`  ${company.company_code}: moved   ${JSON.stringify(Object.fromEntries(moved))}`);
              if (unreachable.size) console.log(`  ${company.company_code}: NOT MOVED (no company path) ${JSON.stringify(Object.fromEntries(unreachable))}`);
            }
            if (!apply) throw ROLLBACK;
          });
          console.log(`  [${t.tenant_code}] committed.`);
        } catch (error) {
          if (error !== ROLLBACK) throw error;
          console.log(`  [${t.tenant_code}] ${verify ? 'verified and rolled back' : 'read-only: rolled back'}.`);
        }
      } finally {
        await pool.end();
      }
    }
  } finally {
    await masterPool.end();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

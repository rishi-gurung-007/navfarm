import { BadRequestException } from '@nestjs/common';
import { and, count, eq, getTableColumns, getTableName, inArray, isNull } from 'drizzle-orm';
import { AnyMySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'crypto';
import * as schema from '../../../core/database/schema';
import { MASTER_TABLES } from '../../../common/master-data-scope';

type Row = Record<string, any>;
export interface TemplateRows { table: AnyMySqlTable; rows: Row[] }
export interface TemplateCopy { table: AnyMySqlTable; originalId: string; row: Row; deferred: Row }

// Actual animals are operational records, not template livestock to duplicate.
// Company-only tables cannot contain tenant drafts; only nullable company
// catalogs participate, together with their dependent detail records below.
export const companyTemplateTables = [...new Set(Object.values(MASTER_TABLES))].filter((table) => {
  const columns = getTableColumns(table);
  return columns.company_id && !columns.company_id.notNull;
});

/** Pure planning phase: allocate every identity before remapping references.
 * Nullable links are deferred so stage transition cycles and category/location
 * trees can be inserted without disabling foreign-key checks. */
export function planTemplateCopies(sets: TemplateRows[], companyId: string): TemplateCopy[] {
  const identities = new Map<string, string>();
  const pending: TemplateCopy[] = [];
  const primaryKey = (table: AnyMySqlTable) => Object.entries(getTableColumns(table)).find(([, c]) => c.primary)?.[0];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const { table, rows } of sets) {
    const key = primaryKey(table);
    if (!key) throw new BadRequestException(`Template table ${getTableName(table)} has no primary key.`);
    for (const original of rows) {
      const id = randomUUID();
      identities.set(`${getTableName(table)}:${original[key]}`, id);
      const row = { ...original, [key]: id };
      const columns = getTableColumns(table);
      if (columns.company_id) row.company_id = companyId;
      for (const timestamp of ['created_at', 'updated_at']) if (columns[timestamp]) row[timestamp] = now;
      for (const user of ['created_by', 'updated_by']) if (columns[user]) row[user] = null;
      if (table === schema.noSeriesMaster) {
        row.current_seq = 0;
        row.last_generated_code = null;
      }
      pending.push({ table, originalId: original[key], row, deferred: {} });
    }
  }
  for (const copy of pending) {
    // These legacy account fields carry UUIDs but do not yet declare SQL FKs.
    // Remap them too; otherwise company Items/Resources point at tenant GLs.
    const accountFields = copy.table === schema.itemMaster ? ['inventory_gl_account', 'cogs_gl_account'] : copy.table === schema.resourceMaster ? ['gl_cost_account'] : [];
    for (const field of accountFields) {
      const mapped = identities.get(`gl_account_master:${copy.row[field]}`);
      if (mapped) copy.row[field] = mapped;
    }
    for (const fk of getTableConfig(copy.table).foreignKeys) {
      const ref = fk.reference();
      for (const column of ref.columns) {
        const value = copy.row[column.name];
        const mapped = identities.get(`${getTableName(ref.foreignTable)}:${value}`);
        if (value && !mapped && companyTemplateTables.includes(ref.foreignTable)) {
          throw new BadRequestException(`Template ${getTableName(copy.table)}.${column.name} must reference an active tenant template before it can be copied.`);
        }
        if (!mapped) continue;
        copy.row[column.name] = mapped;
        if (!column.notNull) { copy.deferred[column.name] = mapped; copy.row[column.name] = null; }
      }
    }
  }
  const ordered: TemplateCopy[] = [];
  const inserted = new Set<string>();
  const generated = new Set(identities.values());
  while (pending.length) {
    const index = pending.findIndex((copy) => getTableConfig(copy.table).foreignKeys.every((fk) =>
      fk.reference().columns.every((column) => !generated.has(copy.row[column.name]) || inserted.has(copy.row[column.name]))));
    if (index < 0) throw new BadRequestException('Tenant templates contain a required circular dependency.');
    const [copy] = pending.splice(index, 1);
    ordered.push(copy);
    inserted.add(copy.row[primaryKey(copy.table)!]);
  }
  return ordered;
}

/** Must be called inside the same transaction that creates the company.
 * Never call this as a repeated sync: subsequent template edits are independent. */
export async function copyCompanyMasterTemplates(tx: Pick<MySql2Database<typeof schema>, 'select' | 'insert' | 'update'>, tenantId: string, companyId: string): Promise<number> {
  const copies = await loadCompanyTemplateCopies(tx, tenantId, companyId);
  await writeTemplateCopies(tx, copies);
  return copies.length;
}

export async function loadCompanyTemplateCopies(tx: Pick<MySql2Database<typeof schema>, 'select'>, tenantId: string, companyId: string): Promise<TemplateCopy[]> {
  const sets: TemplateRows[] = [];
  // Per-table idempotency, not a single probe on no_series_master: company
  // creation and seed-activity-master.ts (called from seed-dev-tenant.ts)
  // both write company-scoped master rows, so a fresh company can already
  // hold rows in one template table (activity_master) while another
  // (no_series_master) is still empty. Gating the whole run on one table
  // assumed a rowless company and died on uq_activity_scope_code the moment
  // that assumption broke. Snapshot, not sync, still holds — per table:
  // adopt only the tables the company has none of, never merge copies into
  // rows it already owns.
  const skipped = new Set<AnyMySqlTable>();
  for (const table of companyTemplateTables) {
    const c = getTableColumns(table);
    const [{ n }] = await tx.select({ n: count() }).from(table)
      .where(and(eq(c.tenant_id, tenantId), eq(c.company_id, companyId)));
    if (Number(n) > 0) {
      skipped.add(table);
      continue;
    }
    const conditions = [eq(c.tenant_id, tenantId), isNull(c.company_id)];
    if (c.is_active) conditions.push(eq(c.is_active, true));
    if (c.deleted_at) conditions.push(isNull(c.deleted_at));
    sets.push({ table, rows: await tx.select().from(table).where(and(...conditions)) });
  }
  // Child tables that carry no company_id of their own, so they can only be
  // found through the parent that does.
  //
  // breed_lifecycle_stages used to be one of these. It has a company_id now, so
  // companyTemplateTables above already picks it up — listing it here as well
  // planned every row twice and the second insert died on
  // uq_breed_lifecycle_stages_scope_code.
  for (const [table, parent, key] of [
    [schema.itemAttributeValues, schema.itemMaster, 'item_id'],
    [schema.feedFormulaIngredients, schema.feedFormulaMaster, 'formula_id'],
  ] as const) {
    if (skipped.has(parent)) continue; // children exist only through their parent
    const ids = sets.find((s) => s.table === parent)?.rows.map((r) => r[key]) || [];
    if (ids.length) sets.push({ table, rows: await tx.select().from(table).where(inArray(getTableColumns(table)[key], ids)) });
  }
  return planTemplateCopies(sets, companyId);
}

export async function writeTemplateCopies(tx: Pick<MySql2Database<typeof schema>, 'insert' | 'update'>, copies: TemplateCopy[]): Promise<void> {
  for (const copy of copies) await tx.insert(copy.table).values(copy.row);
  for (const copy of copies) {
    if (!Object.keys(copy.deferred).length) continue;
    const primary = Object.values(getTableColumns(copy.table)).find((c) => c.primary)!;
    await tx.update(copy.table).set(copy.deferred).where(eq(primary, copy.row[primary.name]));
  }
}

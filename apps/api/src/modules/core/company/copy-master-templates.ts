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
export function planTemplateCopies(sets: TemplateRows[], companyId: string, preset?: Map<string, string>): TemplateCopy[] {
  // preset: tenant rows the company already has (adoption) — referenced through, never copied.
  const identities = new Map<string, string>(preset ?? []);
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
      if (table === schema.noSeries) {
        row.current_seq = 0;
        row.last_no_used = null;
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
    // A lifecycle stage's lists name items and resources by id inside JSON (14 Oct): a copied stage must point at the
    // copied company's vaccine, drug and resource, not the source company's, which it cannot see.
    if (copy.table === schema.breedLifecycleStages) {
      const remapList = (value: unknown, key: string, table: string) => Array.isArray(value)
        ? value.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const id = (entry as Row)[key];
          const mapped = id ? identities.get(`${table}:${id}`) : undefined;
          return mapped ? { ...(entry as Row), [key]: mapped } : entry;
        })
        : value;
      copy.row.vaccination_protocol = remapList(copy.row.vaccination_protocol, 'vaccine_item_id', 'item_master');
      copy.row.medication_protocol = remapList(copy.row.medication_protocol, 'medicine_item_id', 'item_master');
      copy.row.resource_requirements = remapList(copy.row.resource_requirements, 'resource_id', 'resource_master');
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
  const presetIds = new Set(preset?.values() ?? []);
  const generated = new Set([...identities.values()].filter((id) => !presetIds.has(id)));
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

/** Tables without a unique code index, keyed by hand. */
const NATURAL_KEY_OVERRIDES = new Map<AnyMySqlTable, string[]>([
  [schema.breedMaster, ['breed_code']],
  [schema.parameterMaster, ['parameter_code']],
  [schema.qcParameterMaster, ['param_code']],
]);

/**
 * The columns that identify a master row within its company: the scope unique index's columns other than the
 * tenant, the company and the computed COALESCE(company_id) expression (a stage's line of business stays: two
 * lines of business may each have a QUARANTINE).
 */
export function naturalKey(table: AnyMySqlTable): string[] {
  const override = NATURAL_KEY_OVERRIDES.get(table);
  if (override) return override;
  const unique = getTableConfig(table).indexes.filter((index) => index.config.unique);
  const scoped = unique.find((index) => /scope/.test(index.config.name)) ?? unique[0];
  const columns = (scoped?.config.columns ?? [])
    .map((column: any) => column?.name as string | undefined)
    .filter((name): name is string => Boolean(name) && name !== 'tenant_id' && name !== 'company_id');
  if (!columns.length) throw new BadRequestException(`Master ${getTableName(table)} has no code to match a company's own rows by.`);
  return columns;
}

export interface TemplateAdoption {
  copies: TemplateCopy[];
  /** `table:tenantRowId` -> the company's row: the one it already had, or its new copy. */
  identities: Map<string, string>;
}

/**
 * Adoption into an existing company (Rishi, 20 Oct, option a): each tenant row the company already has — same
 * natural key — is matched and referenced through; every other active tenant row is copied as the company's own.
 * The identities are what moves the company's records off tenant rows afterwards.
 */
export function planTemplateAdoption(tenantSets: TemplateRows[], companySets: TemplateRows[], companyId: string): TemplateAdoption {
  const primaryKey = (table: AnyMySqlTable): string => {
    const key = Object.entries(getTableColumns(table)).find(([, c]) => c.primary)?.[0];
    if (!key) throw new BadRequestException(`Template table ${getTableName(table)} has no primary key.`);
    return key;
  };
  const matched = new Map<string, string>();
  const toCopy: TemplateRows[] = [];
  for (const { table, rows } of tenantSets) {
    // A child without a company of its own (an item's attribute values, a formula's ingredients) has no code: it is
    // copied with its parent.
    if (!getTableColumns(table).company_id) {
      toCopy.push({ table, rows });
      continue;
    }
    const key = naturalKey(table);
    const pk = primaryKey(table);
    const keyOf = (row: Row) => key.map((column) => String(row[column] ?? '')).join('\u0000');
    const own = new Map<string, Row[]>();
    for (const row of companySets.find((set) => set.table === table)?.rows ?? []) {
      own.set(keyOf(row), [...(own.get(keyOf(row)) ?? []), row]);
    }
    const unmatched: Row[] = [];
    for (const row of rows) {
      const same = own.get(keyOf(row));
      if (same?.length === 1) matched.set(`${getTableName(table)}:${row[pk]}`, same[0][pk]);
      else unmatched.push(row);
    }
    toCopy.push({ table, rows: unmatched });
  }
  const copies = planTemplateCopies(toCopy, companyId, matched);
  const identities = new Map(matched);
  for (const copy of copies) identities.set(`${getTableName(copy.table)}:${copy.originalId}`, copy.row[primaryKey(copy.table)]);
  return { copies, identities };
}

/** NOT called on company creation any more (client ruling, 12 Oct: new companies
 * and areas start with blank master data). Kept for the seed/repair scripts.
 * Must be called inside the same transaction that creates the company.
 * Never call this as a repeated sync: subsequent template edits are independent. */
export async function copyCompanyMasterTemplates(tx: Pick<MySql2Database<typeof schema>, 'select' | 'insert' | 'update'>, tenantId: string, companyId: string): Promise<number> {
  const copies = await loadCompanyTemplateCopies(tx, tenantId, companyId);
  await writeTemplateCopies(tx, copies);
  return copies.length;
}

export async function loadCompanyTemplateCopies(tx: Pick<MySql2Database<typeof schema>, 'select'>, tenantId: string, companyId: string): Promise<TemplateCopy[]> {
  const sets: TemplateRows[] = [];
  // Per-table idempotency, not a single probe on no_series: company
  // creation and seed-activity-master.ts (called from seed-dev-tenant.ts)
  // both write company-scoped master rows, so a fresh company can already
  // hold rows in one template table (activity_master) while another
  // (no_series) is still empty. Gating the whole run on one table
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

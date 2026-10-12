/**
 * Pure planning for seed-test-masters.ts: copy one company's master data into
 * another company (possibly in another tenant database). The row copying itself
 * (fresh UUIDs, FK remapping between copied rows, number-series reset, deferred
 * cycles) is planTemplateCopies; this file only prepares its input: stamps the
 * target tenant, and decides what happens to references that point outside the
 * copied set (keep / map by code / null / skip the row).
 */
import { getTableColumns, getTableName } from 'drizzle-orm';
import { AnyMySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';

type Row = Record<string, any>;
export interface SourceSet { table: AnyMySqlTable; rows: Row[] }

/** `${foreignTable}:${value}` -> present in the target database (kept as is). */
export interface RefLookup { exists: Set<string>; remap: Map<string, string> }
export interface ExternalRef { foreignTable: string; foreignColumn: string; value: string; viaCompanyTable: boolean }
export interface TableReport { table: string; copied: number; skipped: string[]; nulled: number }

// created_by / updated_by are nulled by planTemplateCopies, so never resolved here.
const OWNER_COLUMNS = ['tenant_id', 'company_id', 'created_by', 'updated_by'];
const key = (table: string, value: unknown) => `${table}:${value}`;
const primaryName = (table: AnyMySqlTable) => Object.entries(getTableColumns(table)).find(([, c]) => c.primary)![0];

interface Link { column: string; notNull: boolean; foreignTable: AnyMySqlTable; foreignColumn: string }
function links(table: AnyMySqlTable): Link[] {
  const out: Link[] = [];
  for (const fk of getTableConfig(table).foreignKeys) {
    const ref = fk.reference();
    ref.columns.forEach((c, i) => {
      if (OWNER_COLUMNS.includes(c.name)) return;
      out.push({ column: c.name, notNull: c.notNull, foreignTable: ref.foreignTable, foreignColumn: ref.foreignColumns[i].name });
    });
  }
  return out;
}

const internalIds = (sets: SourceSet[]) => {
  const ids = new Set<string>();
  for (const { table, rows } of sets) for (const r of rows) ids.add(key(getTableName(table), r[primaryName(table)]));
  return ids;
};

/** Every reference whose target is not one of the copied rows. */
export function collectExternalRefs(sets: SourceSet[], companyTables: AnyMySqlTable[]): ExternalRef[] {
  const internal = internalIds(sets);
  const seen = new Map<string, ExternalRef>();
  for (const { table, rows } of sets) {
    for (const l of links(table)) {
      const ft = getTableName(l.foreignTable);
      for (const r of rows) {
        const v = r[l.column];
        if (!v || internal.has(key(ft, v))) continue;
        seen.set(`${ft}.${l.foreignColumn}:${v}`, { foreignTable: ft, foreignColumn: l.foreignColumn, value: String(v), viaCompanyTable: companyTables.includes(l.foreignTable) });
      }
    }
  }
  return [...seen.values()];
}

/** Stamps the target tenant and resolves external references. Returns the rows
 * to hand to planTemplateCopies plus a per-table report of what was dropped. */
export function prepareSeedSets(
  input: SourceSet[], targetTenantId: string, lookup: RefLookup, companyTables: AnyMySqlTable[],
): { sets: SourceSet[]; reports: Map<string, TableReport> } {
  const reports = new Map<string, TableReport>();
  const report = (t: string) => { if (!reports.has(t)) reports.set(t, { table: t, copied: 0, skipped: [], nulled: 0 }); return reports.get(t)!; };
  let sets: SourceSet[] = input.map(({ table, rows }) => ({
    table, rows: rows.map((r) => (getTableColumns(table).tenant_id ? { ...r, tenant_id: targetTenantId } : { ...r })),
  }));
  for (const s of sets) report(getTableName(s.table));
  let changed = true;
  while (changed) {
    changed = false;
    const internal = internalIds(sets);
    sets = sets.map(({ table, rows }) => {
      const name = getTableName(table);
      const pk = primaryName(table);
      const kept: Row[] = [];
      for (const row of rows) {
        let drop: string | undefined;
        const next = { ...row };
        for (const l of links(table)) {
          const v = row[l.column];
          if (!v) continue;
          const ft = getTableName(l.foreignTable);
          if (internal.has(key(ft, v))) continue;
          const k = key(ft, v);
          const mapped = lookup.remap.get(k);
          // A reference into a company catalog may only be kept when it was
          // mapped to the target company's own row (planTemplateCopies rejects
          // anything else); other tables keep ids that exist in the target.
          if (mapped) next[l.column] = mapped;
          else if (lookup.exists.has(k) && !companyTables.includes(l.foreignTable)) continue;
          else if (!l.notNull) { next[l.column] = null; }
          else drop = `${l.column} -> ${ft} ${v} not copied (inactive, deleted or absent in source) and not in target`;
        }
        if (drop) { report(name).skipped.push(`${row[pk]}: ${drop}`); changed = true; continue; }
        kept.push(next);
      }
      return { table, rows: kept };
    });
  }
  // Count references nulled: present in the source row, absent in the kept row.
  const original = new Map<string, Row>();
  for (const { table, rows } of input) for (const r of rows) original.set(key(getTableName(table), r[primaryName(table)]), r);
  for (const { table, rows } of sets) {
    const name = getTableName(table);
    for (const row of rows) {
      const src = original.get(key(name, row[primaryName(table)]))!;
      for (const l of links(table)) if (src[l.column] && !row[l.column]) report(name).nulled += 1;
    }
  }
  return { sets, reports };
}

export function summarize(reports: Map<string, TableReport>, copiedByTable: Map<string, number>, skippedTables: Map<string, string>) {
  const names = new Set([...reports.keys(), ...skippedTables.keys(), ...copiedByTable.keys()]);
  const rows = [...names].sort().map((table) => {
    const r = reports.get(table);
    const reason = skippedTables.get(table);
    return {
      table,
      copy: copiedByTable.get(table) ?? 0,
      rows_skipped: r?.skipped.length ?? 0,
      refs_nulled: r?.nulled ?? 0,
      note: reason ?? (r?.skipped.length ? r.skipped[0] : ''),
    };
  });
  return {
    rows,
    totals: {
      copy: rows.reduce((n, r) => n + r.copy, 0),
      rows_skipped: rows.reduce((n, r) => n + r.rows_skipped, 0),
      tables_skipped: skippedTables.size,
    },
  };
}

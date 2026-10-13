/**
 * Pure planning for `seed-test-masters.ts --with-operational`: clone a whole
 * company (masters AND operational data) into another company. Unlike
 * planTemplateCopies (templates: timestamps reset, created_by nulled, number
 * series restarted) this keeps history exactly as it was and only re-keys it:
 * fresh UUID per row, every reference remapped, user ids replaced by the target
 * company's admin, tenant/company stamped. Rows are keyed by drizzle column key,
 * which equals the SQL column name throughout this schema.
 */
import { getTableColumns, getTableName } from 'drizzle-orm';
import { AnyMySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';
import { randomUUID } from 'crypto';
import { links, type SourceSet } from './seed-test-masters.lib';

type Row = Record<string, any>;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXCLUDED_NAMES = new Set([
  'company_master', 'role_master', 'role_permissions', 'user_role_assignment', 'user_session', 'audit_log',
  'notification_log', 'notification_alert_log', 'setup_wizard_log',
]);
// Link tables keyed by a pair of columns: there is no single id to replace with a fresh UUID. A cloned parent
// simply has none of these rows (a pooled semen lot reads as a single-boar lot).
const COMPOSITE_KEY_LINKS = new Set(['semen_batch_boar']);
export const excludedReason = (name: string): string | undefined => {
  if (COMPOSITE_KEY_LINKS.has(name)) return 'composite-key link table, cannot be re-keyed with a fresh UUID';
  if (name.startsWith('user_') || name === 'role_master' || name === 'role_permissions') return 'users / roles / sessions are never cloned';
  if (name.startsWith('company_')) return 'company configuration (target company keeps its own)';
  if (EXCLUDED_NAMES.has(name)) return 'audit / notification / wizard log, not business data';
  return undefined;
};

const hasCompany = (t: AnyMySqlTable) => !!getTableColumns(t).company_id;
export interface TableSelection {
  masters: AnyMySqlTable[]; company: AnyMySqlTable[]; children: AnyMySqlTable[];
  excluded: { table: string; reason: string }[]; globalTables: string[]; passthrough: Set<string>;
}

/** Splits every schema table: masters (the existing masters-only set), other tables with company_id,
 * tables without company_id that reference those (children), the excluded and the global ones. */
export function selectTables(all: AnyMySqlTable[], masterTables: AnyMySqlTable[]): TableSelection {
  const excluded: TableSelection['excluded'] = [];
  const base: AnyMySqlTable[] = [];
  const rest: AnyMySqlTable[] = [];
  for (const t of all) {
    const name = getTableName(t);
    const why = excludedReason(name);
    if (why) { excluded.push({ table: name, reason: why }); continue; }
    (hasCompany(t) ? base : rest).push(t);
  }
  const inSet = new Set(base.map(getTableName));
  const children: AnyMySqlTable[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of rest) {
      const name = getTableName(t);
      if (inSet.has(name)) continue;
      if (getTableConfig(t).foreignKeys.some((fk) => inSet.has(getTableName(fk.reference().foreignTable)))) {
        inSet.add(name); children.push(t); changed = true;
      }
    }
  }
  const masters = masterTables.filter((t) => base.includes(t));
  return {
    masters, company: base.filter((t) => !masters.includes(t)), children, excluded,
    globalTables: rest.filter((t) => !inSet.has(getTableName(t))).map(getTableName).sort(),
    passthrough: new Set(excluded.map((e) => e.table)),
  };
}

/** undefined = can be keyed with a fresh UUID; otherwise the reason it is skipped. */
export function unkeyable(table: AnyMySqlTable): string | undefined {
  const pks = Object.values(getTableColumns(table)).filter((c) => c.primary);
  if (getTableConfig(table).primaryKeys.length || pks.length !== 1) return 'no single-column primary key';
  const col = pks[0] as any;
  if (!['MySqlVarChar', 'MySqlChar'].includes(col.columnType)) return `primary key ${col.name} is ${col.columnType}, not a UUID string`;
  if ((col.length ?? 255) < 36) return `primary key ${col.name} is shorter than a UUID`;
  return undefined;
}

const USER_NAME = /(_by|user_id)$/;
const NOT_USER = new Set(['increment_by']);
/** column key -> what to do with it: the target admin ('admin') or empty ('null'). */
export function userColumns(table: AnyMySqlTable): Map<string, 'admin' | 'null'> {
  const fkTables = new Map<string, string>();
  for (const l of links(table)) fkTables.set(l.column, getTableName(l.foreignTable));
  // links() skips nothing here, so FKs into the user tables are visible.
  const out = new Map<string, 'admin' | 'null'>();
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    if (col.primary || col.name === 'tenant_id' || col.name === 'company_id') continue;
    const fk = fkTables.get(col.name);
    if (fk) {
      if (fk === 'user_master') out.set(key, 'admin');
      else if (excludedReason(fk)) out.set(key, col.notNull ? 'admin' : 'null');
    } else if (USER_NAME.test(col.name) && !NOT_USER.has(col.name)) out.set(key, 'admin');
  }
  return out;
}

export interface OpCopy { table: AnyMySqlTable; pk: string; row: Row; deferred: Row }
export interface UniqueIndex { name: string; columns: string[]; coalesced?: string[] } // coalesced: unique on COALESCE(col,'')
/** Existing rows of the target database for the given key tuples: normalised tuple -> primary key. */
export type UniqueFinder = (table: AnyMySqlTable, index: UniqueIndex, tuples: unknown[][]) => Promise<Map<string, string>>;
export interface PlanContext {
  tenantId: string; companyId: string; adminUserId: string;
  /** target database unique indexes by table name (PRIMARY excluded) + a finder; both optional (tests). */
  uniqueIndexes?: Map<string, UniqueIndex[]>; find?: UniqueFinder;
}
export const tupleKey = (values: unknown[]) => values.map((v) => String(v).toLowerCase().trimEnd()).join('\u0001');

export interface FullPlan {
  reused: Map<string, Map<string, number>>; // table -> unique index -> rows mapped onto an existing row
  copies: OpCopy[]; tableOrder: string[];
  jsonIds: Map<string, { replaced: number; stale: number }>;
  userCols: Map<string, string[]>; deferredCols: string[];
}

const pkOf = (t: AnyMySqlTable) => Object.entries(getTableColumns(t)).find(([, c]) => c.primary)![0];

/** `sets` must already have gone through prepareSeedSets (unresolvable references nulled / rows dropped). */
export function planFullCopies(sets: SourceSet[], ctx: PlanContext): Promise<FullPlan> {
  return planFull(sets, ctx);
}

async function planFull(sets: SourceSet[], ctx: PlanContext): Promise<FullPlan> {
  const live = sets.filter((s) => s.rows.length);
  const byName = new Map(live.map((s) => [getTableName(s.table), s]));
  // 1. identities
  const scoped = new Map<string, string>();   // `${table}:${old}` -> new
  const global = new Map<string, string>();   // uuid-shaped old -> new
  for (const { table, rows } of live) {
    const name = getTableName(table); const pk = pkOf(table);
    for (const r of rows) {
      const id = randomUUID();
      scoped.set(`${name}:${r[pk]}`, id);
      if (typeof r[pk] === 'string' && UUID_EXACT.test(r[pk])) global.set(r[pk].toLowerCase(), id);
    }
  }
  // 2. table order (deferring nullable references that sit on a cycle)
  const edges = new Map<string, { col: string; to: string; nullable: boolean }[]>();
  for (const { table } of live) {
    const name = getTableName(table); const list: { col: string; to: string; nullable: boolean }[] = [];
    for (const l of links(table)) {
      const to = getTableName(l.foreignTable);
      if (byName.has(to)) list.push({ col: l.column, to, nullable: !l.notNull });
    }
    edges.set(name, list);
  }
  const deferred = new Map<string, Set<string>>();
  const defer = (t: string, c: string) => { if (!deferred.has(t)) deferred.set(t, new Set()); deferred.get(t)!.add(c); };
  for (const [t, list] of edges) for (const e of list) if (e.to === t) { if (!e.nullable) throw new Error(`${t}.${e.col} is a required self reference.`); defer(t, e.col); }
  const order: string[] = [];
  const remaining = new Set(byName.keys());
  const pending = (t: string) => (edges.get(t) || []).filter((e) => e.to !== t && remaining.has(e.to) && !deferred.get(t)?.has(e.col));
  while (remaining.size) {
    const ready = [...remaining].filter((t) => pending(t).length === 0);
    if (ready.length) { for (const t of ready) { order.push(t); remaining.delete(t); } continue; }
    let marked = 0;
    for (const t of remaining) for (const e of pending(t)) if (e.nullable) { defer(t, e.col); marked += 1; }
    if (!marked) throw new Error(`Required circular dependency between: ${[...remaining].join(', ')}`);
  }
  // 3. rows
  const jsonIds = new Map<string, { replaced: number; stale: number }>();
  const userCols = new Map<string, string[]>();
  const reused = new Map<string, Map<string, number>>();
  const deepReplace = (v: unknown, tally: { replaced: number; stale: number }): unknown => {
    const text = JSON.stringify(v);
    const out = text.replace(UUID_RE, (m) => {
      const hit = global.get(m.toLowerCase());
      if (hit) { tally.replaced += 1; return hit; }
      tally.stale += 1; return m;
    });
    return JSON.parse(out);
  };
  const fresh = new Set(scoped.values());
  const copies: OpCopy[] = [];
  const finalFix: { copy: OpCopy; original: Row; fk: Map<string, string> }[] = [];
  for (const name of order) {
    const { table, rows } = byName.get(name)!;
    const cols = getTableColumns(table); const pk = pkOf(table);
    const users = userColumns(table);
    if (users.size) userCols.set(name, [...users.keys()]);
    const fkCols = new Map<string, string>();
    for (const l of links(table)) fkCols.set(l.column, getTableName(l.foreignTable));
    const defCols = deferred.get(name) || new Set<string>();
    const staged = rows.map((original) => {
      const row: Row = { ...original };
      for (const [key, col] of Object.entries(cols)) {
        const v = original[key];
        if (col.name === 'company_id') { row[key] = ctx.companyId; continue; } // tenant-level templates pulled in as dependencies become the company's own
        if (v === null || v === undefined) continue;
        if (col.name === 'tenant_id') row[key] = ctx.tenantId;
        else if (col.primary) row[key] = scoped.get(`${name}:${v}`)!;
        else if (users.has(key) && (typeof v === 'string' && UUID_EXACT.test(v))) row[key] = users.get(key) === 'admin' ? ctx.adminUserId : null;
        else if (fkCols.has(col.name) && scoped.has(`${fkCols.get(col.name)}:${v}`)) row[key] = scoped.get(`${fkCols.get(col.name)}:${v}`);
        else if ((col as any).columnType === 'MySqlJson') {
          const tally = jsonIds.get(`${name}.${key}`) || { replaced: 0, stale: 0 };
          row[key] = deepReplace(v, tally); jsonIds.set(`${name}.${key}`, tally);
        } else if (typeof v === 'string' && UUID_EXACT.test(v) && global.has(v.toLowerCase())) row[key] = global.get(v.toLowerCase());
      }
      return { original, row, reuse: undefined as string | undefined };
    });
    // Unique keys of the target (e.g. tenant-level rows seeded by signup): a row whose key already exists is not
    // inserted; everything that referred to it is pointed at the existing row. Same for two copied rows with one key.
    const indexes = (ctx.uniqueIndexes?.get(name) || []).filter((ix) => !ix.columns.some((c) => cols[c]?.primary || defCols.has(c)));
    const inSet = new Map<string, string>(); // `${index}|${key}` -> id used
    for (const ix of indexes) {
      const keyOf = (r: Row) => {
        const vals = ix.columns.map((c) => (ix.coalesced?.includes(c) ? (r[c] ?? '') : r[c]));
        // null never collides; a value that is a freshly created id can only collide with a sibling copy.
        return vals.some((v) => v === null || v === undefined) ? undefined : vals;
      };
      const checkable = staged.filter((x) => !x.reuse).map((x) => ({ x, vals: keyOf(x.row) })).filter((e) => e.vals && !e.vals.some((v) => typeof v === 'string' && fresh.has(v)));
      const hits = ctx.find && checkable.length ? await ctx.find(table, ix, checkable.map((e) => e.vals!)) : new Map<string, string>();
      for (const x of staged) {
        if (x.reuse) continue;
        const vals = keyOf(x.row);
        if (!vals) continue;
        const k = tupleKey(vals);
        const existing = hits.get(k);
        const hit = existing ?? inSet.get(`${ix.name}|${k}`);
        if (hit) {
          x.reuse = hit;
          const m = reused.get(name) || new Map<string, number>(); const label = existing ? ix.name : `${ix.name} (within the copy set)`; m.set(label, (m.get(label) || 0) + 1); reused.set(name, m);
          fresh.delete(x.row[pk]);
          scoped.set(`${name}:${x.original[pk]}`, hit);
          if (typeof x.original[pk] === 'string' && UUID_EXACT.test(x.original[pk])) global.set(x.original[pk].toLowerCase(), hit);
        } else inSet.set(`${ix.name}|${k}`, x.row[pk]);
      }
    }
    for (const x of staged) {
      if (x.reuse) continue;
      const later: Row = {};
      for (const c of defCols) if (x.row[c] !== null && x.row[c] !== undefined) { later[c] = x.row[c]; x.row[c] = null; }
      const copy: OpCopy = { table, pk, row: x.row, deferred: later };
      copies.push(copy);
      if (Object.keys(later).length) finalFix.push({ copy, original: x.original, fk: fkCols });
    }
  }
  // A deferred reference may point at a row that was reused after this one was staged: resolve it now.
  for (const f of finalFix) for (const c of Object.keys(f.copy.deferred)) {
    const t = f.fk.get(c); const v = f.original[c];
    const mapped = t ? scoped.get(`${t}:${v}`) : undefined;
    if (mapped) f.copy.deferred[c] = mapped;
  }
  return {
    copies, tableOrder: order, jsonIds, userCols, reused,
    deferredCols: [...deferred].flatMap(([t, cs]) => [...cs].map((c) => `${t}.${c}`)),
  };
}

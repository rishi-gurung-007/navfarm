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
export const excludedReason = (name: string): string | undefined => {
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
export interface FullPlan {
  copies: OpCopy[]; tableOrder: string[];
  jsonIds: Map<string, { replaced: number; stale: number }>;
  userCols: Map<string, string[]>; deferredCols: string[];
}

const pkOf = (t: AnyMySqlTable) => Object.entries(getTableColumns(t)).find(([, c]) => c.primary)![0];

/** `sets` must already have gone through prepareSeedSets (unresolvable references nulled / rows dropped). */
export function planFullCopies(sets: SourceSet[], ctx: { tenantId: string; companyId: string; adminUserId: string }): FullPlan {
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
  const deepReplace = (v: unknown, tally: { replaced: number; stale: number }): unknown => {
    const text = JSON.stringify(v);
    const out = text.replace(UUID_RE, (m) => {
      const hit = global.get(m.toLowerCase());
      if (hit) { tally.replaced += 1; return hit; }
      tally.stale += 1; return m;
    });
    return JSON.parse(out);
  };
  const copies: OpCopy[] = [];
  for (const name of order) {
    const { table, rows } = byName.get(name)!;
    const cols = getTableColumns(table); const pk = pkOf(table);
    const users = userColumns(table);
    if (users.size) userCols.set(name, [...users.keys()]);
    const fkCols = new Map<string, string>();
    for (const l of links(table)) fkCols.set(l.column, getTableName(l.foreignTable));
    const defCols = deferred.get(name) || new Set<string>();
    for (const original of rows) {
      const row: Row = { ...original }; const later: Row = {};
      for (const [key, col] of Object.entries(cols)) {
        const v = original[key];
        if (v === null || v === undefined) continue;
        if (col.name === 'tenant_id') row[key] = ctx.tenantId;
        else if (col.name === 'company_id') row[key] = ctx.companyId;
        else if (col.primary) row[key] = scoped.get(`${name}:${v}`)!;
        else if (users.has(key) && (typeof v === 'string' && UUID_EXACT.test(v))) row[key] = users.get(key) === 'admin' ? ctx.adminUserId : null;
        else if (fkCols.has(col.name) && scoped.has(`${fkCols.get(col.name)}:${v}`)) row[key] = scoped.get(`${fkCols.get(col.name)}:${v}`);
        else if ((col as any).columnType === 'MySqlJson') {
          const tally = jsonIds.get(`${name}.${key}`) || { replaced: 0, stale: 0 };
          row[key] = deepReplace(v, tally); jsonIds.set(`${name}.${key}`, tally);
        } else if (typeof v === 'string' && UUID_EXACT.test(v) && global.has(v.toLowerCase())) row[key] = global.get(v.toLowerCase());
      }
      for (const c of defCols) if (row[c] !== null && row[c] !== undefined) { later[c] = row[c]; row[c] = null; }
      copies.push({ table, pk, row, deferred: later });
    }
  }
  return {
    copies, tableOrder: order, jsonIds, userCols,
    deferredCols: [...deferred].flatMap(([t, cs]) => [...cs].map((c) => `${t}.${c}`)),
  };
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, like, ne, or, SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../core/database/schema';
import { companyCondition, masterScopeConditions, MasterScope } from '../../common/master-data-scope';
import { listFilterConditions, MasterListQueryDto, runMasterList } from '../../common/master-list-query';
import { AuditLogService } from '../system/audit-log/audit-log.service';
import { assertCodeUnchanged } from '../../common/master-code';
import { datesOverlap } from './logistics.rules';
import type { LogisticsMaster } from './logistics-masters';

type Row = Record<string, any>;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const col = (m: { table: unknown }, name: string) => (m.table as Record<string, any>)[name];

/**
 * One service for every Logistics Phase 1 master (logistics-masters.ts describes each): company-scoped like every
 * other master (master-data-scope.ts), never deleted — only made inactive — and every change audited. A vehicle's
 * status is the system's, so it is never written from a request.
 */
@Injectable()
export class LogisticsMasterService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private companyOf(requested?: string | null): string | null {
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    return scope?.kind ? scope.companyId : requested ?? null;
  }

  /** The request's own fields, typed as the column stores them; a blank clears the field. */
  private values(m: LogisticsMaster, dto: Row, partial: boolean): Row {
    const out: Row = {};
    for (const [key, kind] of Object.entries(m.fields)) {
      if (!(key in dto)) {
        if (!partial && kind === 'bool') out[key] = false;
        continue;
      }
      const raw = dto[key];
      const blank = raw === undefined || raw === null || raw === '';
      if (kind === 'bool') out[key] = raw === true || raw === 'true' || raw === 1;
      else if (blank) out[key] = null;
      else if (kind === 'int') out[key] = Math.trunc(Number(raw));
      else if (kind === 'decimal') out[key] = String(Number(raw));
      else out[key] = String(raw).trim();
    }
    return out;
  }

  private async assertReferences(m: LogisticsMaster, values: Row, companyId: string | null, tenantId: string) {
    for (const ref of m.references ?? []) {
      const id = values[ref.field];
      if (!id) continue;
      const t = ref.table as Record<string, any>;
      const conditions: SQL[] = [eq(t[ref.idColumn], id)];
      if (t.tenant_id) conditions.push(eq(t.tenant_id, tenantId));
      if (t.deleted_at) conditions.push(isNull(t.deleted_at));
      if (t.company_id && companyId) conditions.push(companyCondition(t.company_id, companyId));
      for (const [k, v] of Object.entries(ref.where ?? {})) conditions.push(eq(t[k], v));
      const [found] = await this.db.select({ id: t[ref.idColumn] }).from(ref.table).where(and(...conditions)).limit(1);
      if (!found) throw new BadRequestException(`${ref.label} is not available in this company.`);
    }
  }

  private async assertUnique(m: LogisticsMaster, values: Row, companyId: string | null, tenantId: string, exceptId?: string) {
    if (!m.unique) return;
    const conditions: SQL[] = [eq(col(m, 'tenant_id'), tenantId), companyCondition(col(m, 'company_id'), companyId), isNull(col(m, 'deleted_at'))];
    for (const c of m.unique.columns) {
      if (values[c] === null || values[c] === undefined) return;
      conditions.push(eq(col(m, c), values[c]));
    }
    if (exceptId) conditions.push(ne(col(m, m.idKey), exceptId));
    const [clash] = await this.db.select({ id: col(m, m.idKey) }).from(m.table).where(and(...conditions)).limit(1);
    if (clash) throw new ConflictException(m.unique.message);
  }

  /** Rates of one carrier, route and basis may not share a day (TDD item 5). */
  private async assertNoRateOverlap(m: LogisticsMaster, values: Row, companyId: string | null, tenantId: string, exceptId?: string) {
    if (m.path !== 'freight-rate') return;
    const conditions: SQL[] = [
      eq(col(m, 'tenant_id'), tenantId), companyCondition(col(m, 'company_id'), companyId), isNull(col(m, 'deleted_at')),
      eq(col(m, 'is_active'), true), eq(col(m, 'carrier_supplier_id'), values.carrier_supplier_id), eq(col(m, 'rate_basis'), values.rate_basis),
      values.route_id ? eq(col(m, 'route_id'), values.route_id) : isNull(col(m, 'route_id')),
    ];
    if (exceptId) conditions.push(ne(col(m, m.idKey), exceptId));
    const others = await this.db.select({ valid_from: col(m, 'valid_from'), valid_to: col(m, 'valid_to') }).from(m.table).where(and(...conditions));
    const clash = others.find((o: Row) => datesOverlap({ valid_from: String(o.valid_from).slice(0, 10), valid_to: o.valid_to ? String(o.valid_to).slice(0, 10) : null }, values as never));
    if (clash) throw new ConflictException(`This carrier already has a ${values.rate_basis} rate for that route from ${String(clash.valid_from).slice(0, 10)}${clash.valid_to ? ` to ${String(clash.valid_to).slice(0, 10)}` : ''}; rates may not overlap.`);
  }

  private async withNames(m: LogisticsMaster, rows: Row[]): Promise<Row[]> {
    if (!rows.length) return rows;
    const out = rows.map((r) => ({ ...r }));
    for (const d of m.display ?? []) {
      const ids = [...new Set(rows.map((r) => r[d.field]).filter(Boolean))];
      const t = d.table as Record<string, any>;
      const picked = ids.length
        ? await this.db.select({ id: t[d.idColumn], ...Object.fromEntries(Object.entries(d.columns).map(([k, c]) => [k, t[c]])) }).from(d.table).where(inArray(t[d.idColumn], ids))
        : [];
      const byId = new Map(picked.map((p: Row) => [p.id, p]));
      for (const r of out) for (const k of Object.keys(d.columns)) r[k] = byId.get(r[d.field])?.[k] ?? null;
    }
    return out;
  }

  async findOne(m: LogisticsMaster, id: string, tenantId: string): Promise<Row> {
    const [row] = await this.db.select().from(m.table)
      .where(and(eq(col(m, m.idKey), id), eq(col(m, 'tenant_id'), tenantId), isNull(col(m, 'deleted_at')), ...masterScopeConditions(this.cls, m.table)))
      .limit(1);
    if (!row) throw new NotFoundException(`${m.label} is not available in this workspace.`);
    return (await this.withNames(m, [row]))[0];
  }

  async findAll(m: LogisticsMaster, query: MasterListQueryDto & Row, tenantId: string) {
    const conditions: SQL[] = [eq(col(m, 'tenant_id'), tenantId), isNull(col(m, 'deleted_at')), ...masterScopeConditions(this.cls, m.table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(col(m, 'is_active'), query.isActive === true || query.isActive === 'true'));
    for (const [param, column] of Object.entries(m.filters ?? {})) if (query[param]) conditions.push(eq(col(m, column), query[param]));
    conditions.push(...listFilterConditions(m.table, query.filter));
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search && m.search?.length) conditions.push(or(...m.search.map((c) => like(col(m, c), `%${search}%`)))!);
    const page = await runMasterList<Row>(this.db, m.table, conditions, { ...query, sort: query.sort ?? m.defaultSort }, col(m, m.defaultSort));
    return { ...page, data: await this.withNames(m, page.data) };
  }

  private async log(m: LogisticsMaster, action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: `logistics_${m.path.replace(/-/g, '_')}`, entityId: row[m.idKey], oldValues, newValues: row });
    return row;
  }

  async create(m: LogisticsMaster, dto: Row, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto.company_id);
    const values = this.values(m, dto, false);
    const problems = m.problems(values);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    await this.assertReferences(m, values, companyId, tenantId);
    await this.assertUnique(m, values, companyId, tenantId);
    await this.assertNoRateOverlap(m, values, companyId, tenantId);
    const id = randomUUID();
    await this.db.insert(m.table).values({ [m.idKey]: id, tenant_id: tenantId, company_id: companyId, ...values, created_by: user?.userId, updated_by: user?.userId } as never);
    return this.log(m, 'CREATE', await this.findOne(m, id, tenantId), user);
  }

  async update(m: LogisticsMaster, id: string, dto: Row, tenantId: string, user?: any) {
    const before = await this.findOne(m, id, tenantId);
    if (m.code) assertCodeUnchanged(m.label, before[m.code], dto[m.code]);
    // The code stays exactly as created: a request repeating it in other case or spacing changes nothing.
    const changes = this.values(m, m.code ? Object.fromEntries(Object.entries(dto).filter(([k]) => k !== m.code)) : dto, true);
    const merged = { ...Object.fromEntries(Object.keys(m.fields).map((k) => [k, before[k] instanceof Date ? before[k] : before[k] == null ? null : typeof before[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(before[k]) && m.fields[k] === 'date' ? before[k].slice(0, 10) : before[k]])), ...changes };
    const problems = m.problems(merged);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    await this.assertReferences(m, changes, before.company_id, tenantId);
    await this.assertUnique(m, merged, before.company_id, tenantId, id);
    await this.assertNoRateOverlap(m, merged, before.company_id, tenantId, id);
    await this.db.update(m.table).set({ ...changes, updated_by: user?.userId, updated_at: nowTs() } as never).where(eq(col(m, m.idKey), id));
    return this.log(m, 'UPDATE', await this.findOne(m, id, tenantId), user, before);
  }

  async setActive(m: LogisticsMaster, id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(m, id, tenantId);
    await this.db.update(m.table).set({ is_active: active, updated_by: user?.userId, updated_at: nowTs() } as never).where(eq(col(m, m.idKey), id));
    return this.log(m, active ? 'RESTORE' : 'DEACTIVATE', await this.findOne(m, id, tenantId), user, before);
  }
}

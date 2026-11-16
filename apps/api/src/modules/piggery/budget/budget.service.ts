import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, getTableColumns, isNull, ne, or, SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationReferenceScopeConditions } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BUDGET_METRICS, budgetMetric, budgetProblems } from './budget-metrics';

type Row = Record<string, any>;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const ZERO_COMPANY = '00000000-0000-0000-0000-000000000000';
/** A missing company and the all-zero company are the same "no company" when a period is matched to a farm. */
const companyKey = (c: unknown) => (!c || c === ZERO_COMPANY ? null : String(c));
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const LOCKED = ['period_id', 'farm_id', 'metric_code'] as const;
const B = schema.gmBudget;

export interface BudgetListQuery {
  companyId?: string;
  periodId?: string;
  farmId?: string;
  metricCode?: string;
  isActive?: string;
  search?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  filter?: Record<string, string | string[]>;
  limit?: string | number;
  offset?: string | number;
}

/** Row fields the list may be sorted and filtered by (the screen's columns and the line's own fields). */
const LIST_KEYS = [
  'period_code', 'farm_code', 'farm_name', 'metric_code', 'metric_label', 'unit', 'amount', 'amount_type', 'tolerance_pct',
  'notes', 'is_active', 'period_id', 'farm_id', 'created_at', 'updated_at',
];
const NUMERIC_KEYS = ['amount', 'tolerance_pct'];
/** What the search box looks through. */
const SEARCH_KEYS = ['period_code', 'farm_code', 'farm_name', 'metric_label'];
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).toLowerCase();

/** One `filter[column]=value` against a row, read the way master-list-query.ts reads it: `*` is a wildcard, else exact. */
function matchesFilter(row: Row, key: string, raw: string | string[]): boolean {
  if (Array.isArray(raw)) {
    const values = raw.filter((v) => v !== '');
    return !values.length || values.some((v) => matchesFilter(row, key, v));
  }
  const value = String(raw);
  if (value === '') return true;
  if (value === 'true' || value === 'false') return Boolean(row[key]) === (value === 'true');
  if (value.includes('*')) {
    const pattern = value.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}$`, 'i').test(String(row[key] ?? ''));
  }
  if (NUMERIC_KEYS.includes(key) && row[key] !== null && row[key] !== undefined && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(row[key]) === Number(value);
  }
  return text(row[key]) === value.toLowerCase();
}

/**
 * GM Dashboard Budget master: one budget figure per company, period, farm and metric. The line's company is its
 * farm's. The table has no unique key and no foreign keys, so this service keeps "one live line per key" and the
 * period/farm references itself. Period, farm and metric are fixed once saved; a line is deactivated, never deleted.
 */
@Injectable()
export class BudgetService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  /** The catalogue for the screen: a bound that does not exist is null, never the catalogue's stand-in number. */
  metrics() {
    return BUDGET_METRICS.map((m) => ({
      ...m,
      min: m.min <= Number.MIN_SAFE_INTEGER ? null : m.min,
      max: m.max ?? null,
    }));
  }

  private decorate(r: Row): Row {
    const m = budgetMetric(r.metric_code);
    return { ...r, metric_label: m?.label ?? r.metric_code, unit: m?.unit ?? '' };
  }

  private baseSelect() {
    return this.db
      .select({
        ...getTableColumns(B),
        period_code: schema.reportingPeriod.period_code,
        farm_code: schema.locationMaster.location_code,
        farm_name: schema.locationMaster.location_name,
      })
      .from(B)
      .leftJoin(schema.reportingPeriod, eq(schema.reportingPeriod.period_id, B.period_id))
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, B.farm_id));
  }

  private scopeConditions(): SQL[] {
    return locationReferenceScopeConditions(farmScope(this.cls), B.farm_id);
  }

  async findOne(id: string, tenantId: string): Promise<Row> {
    const [row] = await this.baseSelect()
      .where(and(eq(B.budget_id, id), eq(B.tenant_id, tenantId), isNull(B.deleted_at), ...this.scopeConditions()))
      .limit(1);
    if (!row) throw new NotFoundException('That budget line is not available in this workspace.');
    return this.decorate(row);
  }

  async findAll(query: BudgetListQuery, tenantId: string) {
    for (const key of Object.keys(query.filter ?? {})) {
      if (key === 'tenant_id' || key === 'company_id') throw new BadRequestException(`Cannot filter by '${key}' — it is set by the active workspace.`);
      if (!LIST_KEYS.includes(key)) throw new BadRequestException(`Cannot filter by '${key}' — it is not a column on this master.`);
    }
    if (query.sort && !LIST_KEYS.includes(query.sort)) {
      throw new BadRequestException(`Cannot sort by '${query.sort}' — it is not a column on this master.`);
    }
    const conditions: SQL[] = [eq(B.tenant_id, tenantId), isNull(B.deleted_at), ...this.scopeConditions()];
    if (query.companyId) {
      // A missing company and the all-zero company are the same "no company" (companyKey).
      const company = companyKey(query.companyId);
      conditions.push(company ? eq(B.company_id, company) : or(isNull(B.company_id), eq(B.company_id, ZERO_COMPANY))!);
    }
    if (query.periodId) conditions.push(eq(B.period_id, query.periodId));
    if (query.farmId) conditions.push(eq(B.farm_id, query.farmId));
    if (query.metricCode) conditions.push(eq(B.metric_code, query.metricCode));
    if (query.isActive !== undefined && query.isActive !== '') conditions.push(eq(B.is_active, String(query.isActive) === 'true'));
    const fetched = await this.baseSelect().where(and(...conditions)).orderBy(asc(B.period_id), asc(B.farm_id), asc(B.metric_code));
    let all = fetched.map((r: Row) => this.decorate(r));
    const search = text(query.search).trim();
    if (search) all = all.filter((r) => SEARCH_KEYS.some((k) => text(r[k]).includes(search)));
    for (const [key, raw] of Object.entries(query.filter ?? {})) all = all.filter((r) => matchesFilter(r, key, raw));
    if (query.sort) {
      const key = query.sort;
      const sign = query.dir === 'desc' ? -1 : 1;
      const numeric = NUMERIC_KEYS.includes(key);
      all = [...all].sort((a, b) => {
        const av = a[key], bv = b[key];
        const aBlank = av === null || av === undefined, bBlank = bv === null || bv === undefined;
        if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1; // blanks last either way
        const c = numeric ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        return c * sign;
      });
    }
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return { data: all.slice(offset, offset + limit), total: all.length, limit, offset };
  }

  /** Amount, tolerance and notes as the table stores them, or the plain-words problems with the request. */
  private checked(values: Row): { amount: string; tolerance_pct: string | null; notes: string | null } {
    const problems = budgetProblems(values);
    if (!problems.length && Math.abs(Number(values.amount)) >= 1e14) problems.push('The budget amount is too large.');
    const notes = blank(values.notes) ? null : String(values.notes).trim();
    if (notes && notes.length > 500) problems.push('Notes can be at most 500 characters.');
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return {
      amount: String(Number(values.amount)),
      tolerance_pct: blank(values.tolerance_pct) ? null : String(Number(values.tolerance_pct)),
      notes,
    };
  }

  /** A farm that is an active, top-level FARM of this workspace and inside the caller's scope. */
  private async farmOf(farmId: unknown, tenantId: string): Promise<Row> {
    const L = schema.locationMaster;
    const [farm] = typeof farmId === 'string' && farmId
      ? await this.db.select({ location_id: L.location_id, company_id: L.company_id }).from(L).where(and(
          eq(L.location_id, farmId), eq(L.tenant_id, tenantId), eq(L.location_type, 'FARM'), isNull(L.parent_location_id),
          eq(L.is_active, true), isNull(L.deleted_at), ...locationReferenceScopeConditions(farmScope(this.cls), L.location_id),
        )).limit(1)
      : [];
    if (!farm) throw new BadRequestException('Choose an active farm that you can work with.');
    if (farm.company_id) assertCompanyInScope(farmScope(this.cls), farm.company_id);
    return farm;
  }

  private async assertNoLiveLine(key: { company_id: string | null; period_id: string; farm_id: string; metric_code: string }, tenantId: string, exceptId?: string) {
    const conditions: SQL[] = [
      eq(B.tenant_id, tenantId), key.company_id ? eq(B.company_id, key.company_id) : isNull(B.company_id),
      eq(B.period_id, key.period_id), eq(B.farm_id, key.farm_id), eq(B.metric_code, key.metric_code),
      eq(B.is_active, true), isNull(B.deleted_at),
    ];
    if (exceptId) conditions.push(ne(B.budget_id, exceptId));
    const [clash] = await this.db.select({ id: B.budget_id }).from(B).where(and(...conditions)).limit(1);
    if (clash) {
      const label = budgetMetric(key.metric_code)?.label ?? key.metric_code;
      throw new ConflictException(`This farm already has a budget for ${label} in that period; change that line instead.`);
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action,
      entityName: 'gm_budget', entityId: row.budget_id, oldValues, newValues: row,
    });
    return row;
  }

  async create(dto: Row, tenantId: string, user?: any) {
    const metric = budgetMetric(String(dto.metric_code ?? ''));
    const stored = this.checked(dto);
    if (!metric) throw new BadRequestException('Choose a metric.'); // unreachable: checked() names it
    const farm = await this.farmOf(dto.farm_id, tenantId);
    const P = schema.reportingPeriod;
    const [period] = typeof dto.period_id === 'string' && dto.period_id
      ? await this.db.select({ period_id: P.period_id, company_id: P.company_id }).from(P)
          .where(and(eq(P.period_id, dto.period_id), eq(P.tenant_id, tenantId))).limit(1)
      : [];
    if (!period) throw new BadRequestException('That reporting period does not exist in this workspace.');
    if (companyKey(period.company_id) !== companyKey(farm.company_id)) {
      throw new BadRequestException('That period belongs to another company than the farm.');
    }
    const id = randomUUID();
    await withTenantTransaction(this.cls, async () => {
      const key = { company_id: farm.company_id ?? null, period_id: period.period_id, farm_id: farm.location_id, metric_code: metric.code };
      await this.assertNoLiveLine(key, tenantId);
      await this.db.insert(B).values({
        budget_id: id, tenant_id: tenantId, ...key, amount_type: metric.amountType, ...stored,
        created_by: user?.userId, updated_by: user?.userId,
      } as never);
    });
    return this.log('CREATE', await this.findOne(id, tenantId), user);
  }

  async update(id: string, dto: Row, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    for (const k of LOCKED) {
      if (k in dto && !blank(dto[k]) && dto[k] !== before[k]) {
        throw new BadRequestException('Period, farm and metric cannot be changed once saved; deactivate this line and add a new one.');
      }
    }
    const stored = this.checked({
      metric_code: before.metric_code,
      amount: 'amount' in dto ? dto.amount : before.amount,
      tolerance_pct: 'tolerance_pct' in dto ? dto.tolerance_pct : before.tolerance_pct,
      notes: 'notes' in dto ? dto.notes : before.notes,
    });
    await this.db.update(B).set({ ...stored, updated_by: user?.userId, updated_at: nowTs() } as never).where(eq(B.budget_id, id));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async deactivate(id: string, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    await this.db.update(B).set({ is_active: false, updated_by: user?.userId, updated_at: nowTs() } as never).where(eq(B.budget_id, id));
    return this.log('DEACTIVATE', await this.findOne(id, tenantId), user, before);
  }

  async restore(id: string, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    await withTenantTransaction(this.cls, async () => {
      await this.assertNoLiveLine(before as never, tenantId, id);
      await this.db.update(B).set({ is_active: true, updated_by: user?.userId, updated_at: nowTs() } as never).where(eq(B.budget_id, id));
    });
    return this.log('RESTORE', await this.findOne(id, tenantId), user, before);
  }
}

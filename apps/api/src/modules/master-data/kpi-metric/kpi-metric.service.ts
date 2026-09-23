import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { MasterScope } from '../../../common/master-data-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { CreateKpiMetricDto, QueryKpiMetricDto, UpdateKpiMetricDto } from './kpi-metric.dto';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const table = schema.kpiMetricMaster;

@Injectable()
export class KpiMetricService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService, private readonly numbering: NumberSeriesService) {}
  private get db() { return this.cls.get<MySql2Database<typeof schema>>('tenantDb'); }

  /**
   * Deliberately not masterScopeConditions: that helper swaps a company-scoped
   * read to company_id = X, excluding NULL — right for a company's own
   * independently owned catalog, wrong here. The seeded system metrics are
   * all company_id NULL, meant to be visible from every company in the
   * tenant (the same "shared until a company overrides it" reading Location's
   * own template rows use), so a company in scope ORs rather than swaps.
   */
  private scope(tenantId: string, requestedCompany?: string | null) {
    const scope = this.cls.get<MasterScope>('masterScope');
    const conditions = [eq(table.tenant_id, tenantId)];
    const companyId = scope?.kind ? scope.companyId : requestedCompany;
    if (companyId) conditions.push(or(eq(table.company_id, companyId), isNull(table.company_id))!);
    if (scope?.kind === 'OPERATIONAL') {
      if (scope.nobId) conditions.push(or(eq(table.nob_id, scope.nobId), isNull(table.nob_id))!);
      if (scope.lobId) conditions.push(or(eq(table.lob_id, scope.lobId), isNull(table.lob_id))!);
    }
    return conditions;
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.kpi_metric_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('KPI Metric is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryKpiMetricDto, tenantId: string) {
    const conditions = this.scope(tenantId, query.companyId);
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.search) conditions.push(or(like(table.metric_code, `%${query.search}%`), like(table.metric_name, `%${query.search}%`))!);
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions)).orderBy(listOrderBy(table, query, table.metric_name)).limit(query.limit || 50).offset(query.offset || 0);
  }

  private async log(action: string, row: typeof table.$inferSelect, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'kpi_metric_master', entityId: row.kpi_metric_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateKpiMetricDto, tenantId: string, user?: any) {
    // No series configured for KPI_METRIC (nor does one need to be — a metric
    // name is not a sequence) — manualCode alone, for the width/uniqueness
    // check every master's code gets, not resolveNewCode's series-or-manual
    // branch, which refuses a master with no series at all when no code was
    // supplied. metric_code is required in the DTO, so there's always one.
    const metric_code = await this.numbering.manualCode('KPI_METRIC', dto.metric_code, tenantId, dto.company_id);
    const kpi_metric_id = randomUUID();
    await this.db.insert(table).values({
      ...dto, metric_code, kpi_metric_id, tenant_id: tenantId, metric_name: dto.metric_name.trim(),
      created_by: user?.userId, updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(kpi_metric_id, tenantId), user);
  }

  async update(id: string, dto: UpdateKpiMetricDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const updates = { ...dto, metric_name: dto.metric_name?.trim() ?? before.metric_name, updated_by: user?.userId, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    await this.db.update(table).set(updates).where(and(eq(table.kpi_metric_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId }).where(and(eq(table.kpi_metric_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}

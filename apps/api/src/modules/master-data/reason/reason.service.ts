import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { CreateReasonDto, QueryReasonDto, UpdateReasonDto } from './reason.dto';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const table = schema.reasonMaster;
@Injectable()
export class ReasonService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService, private readonly numbering: NumberSeriesService) {}
  private get db() { return this.cls.get<MySql2Database<typeof schema>>('tenantDb'); }
  private scope(tenantId: string) { return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)]; }
  private async assertStages(codes: string[] | null | undefined, tenantId: string, companyId?: string | null) {
    if (!codes?.length) return;
    const rows = await this.db.select({ code: schema.stageMaster.stage_code }).from(schema.stageMaster).where(and(
      eq(schema.stageMaster.tenant_id, tenantId), eq(schema.stageMaster.is_active, true), inArray(schema.stageMaster.stage_code, codes),
      ...masterScopeConditions(this.cls, schema.stageMaster, companyId || undefined),
    ));
    if (codes.some((code) => !rows.some((row) => row.code === code))) throw new BadRequestException('Select active stages from this workspace.');
  }
  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.reason_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Reason is not available in this workspace.');
    return row;
  }
  async findAll(query: QueryReasonDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.category) conditions.push(eq(table.category, query.category));
    if (query.stageCode) conditions.push(sql`(${table.applicable_stages} IS NULL OR JSON_LENGTH(${table.applicable_stages}) = 0 OR JSON_CONTAINS(${table.applicable_stages}, ${JSON.stringify(query.stageCode)}))`);
    if (query.search) conditions.push(or(like(table.reason_code, `%${query.search}%`), like(table.reason_name, `%${query.search}%`))!);
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions)).orderBy(listOrderBy(table, query, table.reason_code)).limit(query.limit || 50).offset(query.offset || 0);
  }
  private async log(action: string, row: typeof table.$inferSelect, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'reason_master', entityId: row.reason_id, oldValues, newValues: row });
    return row;
  }
  async create(dto: CreateReasonDto, tenantId: string, user?: any) {
    await this.assertStages(dto.applicable_stages, tenantId, dto.company_id);
    const reason_code = await this.numbering.resolveNewCode('REASON', dto.reason_code, tenantId, dto.company_id, undefined, dto as unknown as Record<string, unknown>);
    const reason_id = randomUUID();
    await this.db.insert(table).values({ ...dto, reason_code, reason_id, tenant_id: tenantId, reason_name: dto.reason_name.trim(), applicable_stages: dto.applicable_stages?.length ? dto.applicable_stages : null, created_by: user?.userId, updated_by: user?.userId });
    return this.log('CREATE', await this.findOne(reason_id, tenantId), user);
  }
  async update(id: string, dto: UpdateReasonDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.applicable_stages !== undefined) await this.assertStages(dto.applicable_stages, tenantId, before.company_id);
    // Renaming a code used in posting logic would silently change its meaning.
    if (dto.reason_code !== undefined && dto.reason_code.trim().toUpperCase() !== before.reason_code) throw new BadRequestException('Reason codes cannot be renamed. Deactivate the old reason and create a new one.');
    const updates = { ...dto, reason_code: before.reason_code, reason_name: dto.reason_name?.trim() ?? before.reason_name, updated_by: user?.userId, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    await this.db.update(table).set(updates).where(and(eq(table.reason_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }
  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId }).where(and(eq(table.reason_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}

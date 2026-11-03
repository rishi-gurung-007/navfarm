import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { assertCodeUnchanged } from '../../../common/master-code';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateSemenCollectorDto, QuerySemenCollectorDto, UpdateSemenCollectorDto } from './semen-collector.dto';

const table = schema.semenCollector;
type Row = typeof table.$inferSelect;

@Injectable()
export class SemenCollectorService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
  ) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private scope(tenantId: string) {
    return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)];
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.collector_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Collector is not available in this workspace.');
    return row;
  }

  async findAll(query: QuerySemenCollectorDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.search) {
      conditions.push(or(like(table.collector_code, `%${query.search}%`), like(table.collector_name, `%${query.search}%`))!);
    }
    conditions.push(...listFilterConditions(table, query.filter));
    return runMasterList(this.db, table, conditions, query, table.collector_code);
  }

  private async assertCodeFree(code: string, tenantId: string, companyId: string | null, exceptId?: string) {
    const rows = await this.db
      .select({ id: table.collector_id })
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), companyId ? eq(table.company_id, companyId) : isNull(table.company_id), eq(table.collector_code, code)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException(`Collector code '${code}' is already in use.`);
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id,
      companyId: row.company_id || undefined,
      userId: user?.userId,
      action,
      entityName: 'semen_collector',
      entityId: row.collector_id,
      oldValues,
      newValues: row,
    });
    return row;
  }

  async create(dto: CreateSemenCollectorDto, tenantId: string, user?: any) {
    const collector_code = dto.collector_code.trim().toUpperCase();
    await this.assertCodeFree(collector_code, tenantId, dto.company_id ?? null);
    const collector_id = randomUUID();
    await this.db.insert(table).values({
      ...dto,
      collector_code,
      collector_name: dto.collector_name.trim(),
      collector_id,
      tenant_id: tenantId,
      created_by: user?.userId,
      updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(collector_id, tenantId), user);
  }

  async update(id: string, dto: UpdateSemenCollectorDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    assertCodeUnchanged('Collector', before.collector_code, dto.collector_code);
    const { collector_code: _code, ...changes } = dto;
    await this.db
      .update(table)
      .set({
        ...changes,
        collector_name: dto.collector_name?.trim() ?? before.collector_name,
        updated_by: user?.userId,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(and(eq(table.collector_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db
      .update(table)
      .set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId })
      .where(and(eq(table.collector_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}

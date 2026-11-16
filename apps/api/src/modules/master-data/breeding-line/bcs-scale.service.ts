import { withLineLabels } from './line-label';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateBcsScaleDto, QueryBcsScaleDto, UpdateBcsScaleDto } from './bcs-scale.dto';

const table = schema.bcsScale;
type Row = typeof table.$inferSelect;
const dec = (v: number | null | undefined) => (v === undefined ? undefined : v == null ? null : String(v));

/** The body condition scale (SOP 21): one row per score of a breeding line, or of the company as the default. */
@Injectable()
export class BcsScaleService {
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
    const [row] = await this.db.select().from(table).where(and(eq(table.scale_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Scale row is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryBcsScaleDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.breedId) conditions.push(eq(table.breed_id, query.breedId));
    conditions.push(...listFilterConditions(table, query.filter));
    const list = await runMasterList(this.db, table, conditions, query, table.score);
    return { ...list, data: await withLineLabels(this.db, list.data as { breed_id: string | null }[]) as any };
  }

  /** Every active scale row of a company, for the rules to pick the line's (or the default's) from. */
  async activeRows(tenantId: string, companyId: string | null) {
    const rows = await this.db
      .select()
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), companyId ? eq(table.company_id, companyId) : isNull(table.company_id), eq(table.is_active, true), isNull(table.deleted_at)))
      .orderBy(asc(table.score));
    return rows.map((r) => ({ ...r, feed_kg_per_day: r.feed_kg_per_day == null ? null : Number(r.feed_kg_per_day) }));
  }

  private async assertScoreFree(breedId: string | null, score: number, tenantId: string, companyId: string | null, exceptId?: string) {
    const rows = await this.db
      .select({ id: table.scale_id })
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), companyId ? eq(table.company_id, companyId) : isNull(table.company_id), breedId ? eq(table.breed_id, breedId) : isNull(table.breed_id), eq(table.score, score)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException(`Score ${score} is already on this scale. Edit it, or restore it if it was switched off.`);
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'bcs_scale', entityId: row.scale_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateBcsScaleDto, tenantId: string, user?: any) {
    await this.assertScoreFree(dto.breed_id ?? null, dto.score, tenantId, dto.company_id ?? null);
    const scale_id = randomUUID();
    await this.db.insert(table).values({ ...dto, feed_kg_per_day: dec(dto.feed_kg_per_day) as string | null | undefined, scale_id, tenant_id: tenantId, created_by: user?.userId, updated_by: user?.userId });
    return this.log('CREATE', await this.findOne(scale_id, tenantId), user);
  }

  async update(id: string, dto: UpdateBcsScaleDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.breed_id !== undefined && (dto.breed_id ?? null) !== (before.breed_id ?? null)) throw new BadRequestException('The line of a scale row cannot be changed. Add a row for the other line instead.');
    if (dto.score !== undefined && dto.score !== before.score) throw new BadRequestException('The score of a row cannot be changed. Add a row for the other score instead.');
    const { breed_id: _b, score: _s, ...changes } = dto;
    await this.db
      .update(table)
      .set({ ...changes, feed_kg_per_day: dec(changes.feed_kg_per_day) as string | null | undefined, updated_by: user?.userId, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
      .where(and(eq(table.scale_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId }).where(and(eq(table.scale_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}

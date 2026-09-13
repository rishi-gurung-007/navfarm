import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { CreateActivityDto, QueryActivityDto, UpdateActivityDto } from './activity.dto';

const table = schema.activityMaster;
const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class ActivityService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) {}
  private get db() { return this.cls.get<MySql2Database<typeof schema>>('tenantDb'); }
  private scope(tenantId: string) { return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)]; }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.activity_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Activity is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryActivityDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    // NULL nob_id/lob_id means "shared across all business verticals" (same
    // convention as masterScopeConditions) — a strict eq() here would exclude
    // shared activities from every NOB/LOB-scoped query.
    if (query.nobId) conditions.push(or(eq(table.nob_id, query.nobId), isNull(table.nob_id))!);
    if (query.lobId) conditions.push(or(eq(table.lob_id, query.lobId), isNull(table.lob_id))!);
    if (query.lineType) conditions.push(eq(table.line_type, query.lineType));
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.search) conditions.push(or(like(table.activity_code, `%${query.search}%`), like(table.activity_name, `%${query.search}%`))!);
    return this.db.select().from(table).where(and(...conditions)).orderBy(table.activity_name).limit(query.limit || 100).offset(query.offset || 0);
  }

  private async log(action: string, row: typeof table.$inferSelect, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'activity_master', entityId: row.activity_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateActivityDto, tenantId: string, user?: any) {
    // Auto-detect company/nob/lob from the caller's workspace scope and NobLobResolutionService,
    // same as every other master here. If caller is in an active operational area, it resolves
    // from it. If in a company workspace, NobLobResolutionService derives the single active NOB/LOB,
    // or falls back to template/explicit values.
    const masterScope = this.cls.get<MasterScope>('masterScope');
    const companyId = masterScope?.companyId ?? dto.company_id ?? null;
    const resolvedNobLob = await this.nobLobResolution.resolve(tenantId, companyId, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });
    const nobId = resolvedNobLob.nob_id;
    const lobId = resolvedNobLob.lob_id;

    const code = dto.activity_code.trim().toUpperCase();
    const [dup] = await this.db.select({ activity_id: table.activity_id }).from(table)
      .where(and(eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, companyId || undefined), eq(table.activity_code, code)))
      .limit(1);
    if (dup) throw new ConflictException(`Activity code '${code}' already exists in this workspace.`);

    const activity_id = randomUUID();
    await this.db.insert(table).values({
      ...dto,
      activity_id,
      tenant_id: tenantId,
      company_id: companyId,
      nob_id: nobId,
      lob_id: lobId,
      activity_code: code,
      activity_name: dto.activity_name.trim(),
      created_by: user?.userId,
      updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(activity_id, tenantId), user);
  }

  async update(id: string, dto: UpdateActivityDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const updates = {
      ...dto,
      activity_name: dto.activity_name?.trim() ?? before.activity_name,
      updated_by: user?.userId,
      updated_at: toMysqlTimestamp(),
    };
    await this.db.update(table).set(updates).where(and(eq(table.activity_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    await this.db.update(table).set({ is_active: active, updated_at: toMysqlTimestamp(), updated_by: user?.userId })
      .where(and(eq(table.activity_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}

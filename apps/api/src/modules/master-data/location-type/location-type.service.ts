import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { and, eq, isNull, like, ne, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateLocationTypeDto, QueryLocationTypeDto, UpdateLocationTypeDto } from './dto/location-type.dto';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const mysqlTimestamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const seriesCodeFor = (typeCode: string) => `LOCATION_${typeCode}`;

@Injectable()
export class LocationTypeService {
  constructor(private readonly cls: ClsService, private readonly auditService: AuditLogService, private readonly numberSeriesService: NumberSeriesService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async assertPrefixAvailable(prefix: string, tenantId: string, companyId: string | null, excludeId?: string) {
    const conditions = [
      eq(schema.locationTypeMaster.tenant_id, tenantId),
      eq(schema.locationTypeMaster.code_prefix, prefix),
      isNull(schema.locationTypeMaster.deleted_at),
    ];
    if (excludeId) conditions.push(ne(schema.locationTypeMaster.location_type_id, excludeId));
    conditions.push(companyCondition(schema.locationTypeMaster.company_id, companyId));
    const [duplicate] = await this.db.select({ id: schema.locationTypeMaster.location_type_id })
      .from(schema.locationTypeMaster).where(and(...conditions)).limit(1);
    if (duplicate) throw new ConflictException(`Location prefix '${prefix}' is already used by another type in this scope.`);
  }

  private async assertParentTypesExist(parentTypes: string[], ownType: string, tenantId: string, companyId: string | null) {
    if (parentTypes.includes(ownType)) throw new ConflictException('A Location Type cannot allow itself as a parent.');
    for (const parentType of parentTypes) {
      const conditions = [
        eq(schema.locationTypeMaster.tenant_id, tenantId),
        eq(schema.locationTypeMaster.type_code, parentType),
        eq(schema.locationTypeMaster.is_active, true),
        isNull(schema.locationTypeMaster.deleted_at),
      ];
      conditions.push(companyCondition(schema.locationTypeMaster.company_id, companyId));
      const [parent] = await this.db.select({ id: schema.locationTypeMaster.location_type_id })
        .from(schema.locationTypeMaster).where(and(...conditions)).limit(1);
      if (!parent) throw new NotFoundException(`Allowed parent Location Type '${parentType}' does not exist.`);
    }
  }

  async create(dto: CreateLocationTypeDto, tenantId: string, user?: any) {
    const companyId = dto.company_id || null;
    const typeCode = await this.numberSeriesService.resolveNewCode('LOCATION_TYPE', dto.type_code, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);
    const [duplicate] = await this.db.select().from(schema.locationTypeMaster).where(and(
      eq(schema.locationTypeMaster.tenant_id, tenantId),
      eq(schema.locationTypeMaster.type_code, typeCode),
      companyId ? eq(schema.locationTypeMaster.company_id, companyId) : isNull(schema.locationTypeMaster.company_id),
      isNull(schema.locationTypeMaster.deleted_at),
    )).limit(1);
    if (duplicate) throw new ConflictException(`Location type '${typeCode}' already exists in this scope.`);
    const prefix = dto.code_prefix.toUpperCase();
    await this.assertPrefixAvailable(prefix, tenantId, companyId);
    const parentTypes = dto.allowed_parent_types || [];
    await this.assertParentTypesExist(parentTypes, typeCode, tenantId, companyId);

    const existingCodes = companyId
      ? await this.db.select({ code: schema.locationMaster.location_code }).from(schema.locationMaster).where(and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.company_id, companyId),
          eq(schema.locationMaster.location_type, typeCode),
        ))
      : [];
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, 'i');
    const currentSeq = existingCodes.reduce((max, location) => {
      const match = location.code.match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    const row = {
      location_type_id: randomUUID(), tenant_id: tenantId, company_id: companyId,
      nob_id: (dto as any).nob_id ?? null, lob_id: (dto as any).lob_id ?? null,
      type_code: typeCode, type_name: dto.type_name.trim(), code_prefix: prefix,
      allowed_parent_types: parentTypes, is_system: false, is_active: true, status: 'ACTIVE',
      created_by: user?.userId || null, updated_by: user?.userId || null,
    };

    // No series is minted here any more. A location type used to get its own
    // LOCATION_<TYPE> row, because a series held one prefix and each type needed
    // a different one — so the Number Series list grew by one every time someone
    // added a type. The single LOCATION series takes location_type as a segment
    // instead, and covers every type from one row.
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.locationTypeMaster).values(row);
    });
    await this.auditService.log({ tenantId, companyId: companyId || undefined, userId: user?.userId, action: 'CREATE', entityName: 'location_type_master', entityId: row.location_type_id, newValues: row });
    return this.findOne(row.location_type_id, tenantId);
  }

  async findAll(query: QueryLocationTypeDto, tenantId: string) {
    const conditions: any[] = [eq(schema.locationTypeMaster.tenant_id, tenantId), isNull(schema.locationTypeMaster.deleted_at)];
    conditions.push(...masterScopeConditions(this.cls, schema.locationTypeMaster, query.companyId));
    if (query.isActive !== undefined) conditions.push(eq(schema.locationTypeMaster.is_active, query.isActive));
    if (query.search) conditions.push(or(like(schema.locationTypeMaster.type_code, `%${query.search}%`), like(schema.locationTypeMaster.type_name, `%${query.search}%`))!);
    conditions.push(...listFilterConditions(schema.locationTypeMaster, query.filter));
    const rows = await this.db.select().from(schema.locationTypeMaster).where(and(...conditions))
      // The company-null ordering is a precedence rule, not a preference: the
      // rows below dedupe tenant templates against company overrides and rely
      // on it. Any sort the caller asks for is applied within that.
      .orderBy(sql`${schema.locationTypeMaster.company_id} IS NULL`,
               listOrderBy(schema.locationTypeMaster, query, schema.locationTypeMaster.type_code))
      .limit(query.limit || 50).offset(query.offset || 0);
    if (!query.companyId) return rows;
    // A company override replaces the tenant-wide definition in dropdowns;
    // it must not appear as a second option with the same Type Code.
    const effective = new Map<string, typeof rows[number]>();
    rows.forEach((row) => { if (!effective.has(row.type_code)) effective.set(row.type_code, row); });
    return Array.from(effective.values());
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(schema.locationTypeMaster).where(and(
      eq(schema.locationTypeMaster.location_type_id, id),
      eq(schema.locationTypeMaster.tenant_id, tenantId),
      isNull(schema.locationTypeMaster.deleted_at),
    )).limit(1);
    if (!row) throw new NotFoundException(`Location type '${id}' not found.`);
    return row;
  }

  async update(id: string, dto: UpdateLocationTypeDto, tenantId: string, user?: any) {
    const existing = await this.findOne(id, tenantId);
    const updates: any = { updated_by: user?.userId || null, updated_at: mysqlTimestamp() };
    if (dto.type_name !== undefined) updates.type_name = dto.type_name.trim();
    if (dto.code_prefix !== undefined) {
      const prefix = dto.code_prefix.toUpperCase();
      if (prefix !== existing.code_prefix) await this.assertPrefixAvailable(prefix, tenantId, existing.company_id, id);
      updates.code_prefix = prefix;
    }
    if (dto.allowed_parent_types !== undefined) {
      await this.assertParentTypesExist(dto.allowed_parent_types, existing.type_code, tenantId, existing.company_id);
      updates.allowed_parent_types = dto.allowed_parent_types;
    }
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    await this.db.transaction(async (tx) => {
      await tx.update(schema.locationTypeMaster).set(updates).where(eq(schema.locationTypeMaster.location_type_id, id));
      if (dto.code_prefix !== undefined || dto.type_name !== undefined) {
        await tx.update(schema.noSeriesMaster).set({
          ...(dto.code_prefix !== undefined ? { prefix: dto.code_prefix.toUpperCase() } : {}),
          ...(dto.type_name !== undefined ? { series_name: `${dto.type_name.trim()} Location` } : {}),
          updated_by: user?.userId || null,
        }).where(and(
          eq(schema.noSeriesMaster.tenant_id, tenantId),
          eq(schema.noSeriesMaster.series_code, seriesCodeFor(existing.type_code)),
          // A tenant-wide type owns one independent series per company. Keep
          // those company counters on the new prefix as well; their numeric
          // positions remain unchanged.
          ...(existing.company_id ? [eq(schema.noSeriesMaster.company_id, existing.company_id)] : []),
        ));
      }
    });
    await this.auditService.log({ tenantId, companyId: existing.company_id || undefined, userId: user?.userId, action: 'UPDATE', entityName: 'location_type_master', entityId: id, oldValues: existing, newValues: updates });
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string, user?: any) {
    const existing = await this.findOne(id, tenantId);
    if (existing.is_system) {
      throw new ConflictException(`Location type '${existing.type_code}' is a core type and cannot be deleted.`);
    }
    const usageConditions = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, existing.type_code),
    ];
    if (existing.company_id) usageConditions.push(eq(schema.locationMaster.company_id, existing.company_id));
    const [location] = await this.db.select({ id: schema.locationMaster.location_id })
      .from(schema.locationMaster).where(and(...usageConditions)).limit(1);
    if (location) throw new ConflictException(`Location type '${existing.type_code}' is already used by a location and cannot be deleted.`);
    const now = mysqlTimestamp();
    await this.db.update(schema.locationTypeMaster).set({ is_active: false, status: 'INACTIVE', deleted_at: now as any, updated_by: user?.userId || null }).where(eq(schema.locationTypeMaster.location_type_id, id));
    await this.auditService.log({ tenantId, companyId: existing.company_id || undefined, userId: user?.userId, action: 'DELETE', entityName: 'location_type_master', entityId: id, oldValues: existing });
    return { success: true };
  }

  async restore(id: string, tenantId: string, user?: any) {
    const [existing] = await this.db.select().from(schema.locationTypeMaster).where(eq(schema.locationTypeMaster.location_type_id, id)).limit(1);
    if (!existing) throw new NotFoundException(`Location type '${id}' not found.`);
    await this.db.update(schema.locationTypeMaster).set({ is_active: true, status: 'ACTIVE', deleted_at: null, updated_by: user?.userId || null }).where(eq(schema.locationTypeMaster.location_type_id, id));
    await this.auditService.log({ tenantId, companyId: existing.company_id || undefined, userId: user?.userId, action: 'RESTORE', entityName: 'location_type_master', entityId: id });
    return this.findOne(id, tenantId);
  }
}

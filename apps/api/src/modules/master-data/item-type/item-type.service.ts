import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateItemTypeDto, UpdateItemTypeDto, QueryItemTypeDto } from './dto/item-type.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ItemTypeService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** Item types carry no further type dimension of their own — resolves the master-alone series. */
  private async resolveTypeCode(dto: CreateItemTypeDto, tenantId: string, companyId: string | null): Promise<string> {
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('ITEM_TYPE', null, tenantId, companyId);
    if (!seriesCode) {
      if (!dto.type_code) {
        throw new BadRequestException('type_code is required — no number series is configured for item types.');
      }
      return dto.type_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId);
    if (series.allow_manual && dto.type_code) {
      return dto.type_code.toUpperCase();
    }
    return this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);
  }

  async create(dto: CreateItemTypeDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;

    // 1. Verify company exists (if provided)
    if (companyId) {
      const [company] = await this.db
        .select()
        .from(schema.companyMaster)
        .where(and(eq(schema.companyMaster.company_id, companyId), isNull(schema.companyMaster.deleted_at)))
        .limit(1);

      if (!company) {
        throw new NotFoundException(`Company with ID '${companyId}' not found.`);
      }
    }

    // 2. Resolve the type code — a series if one is configured, else the user-supplied code.
    const typeCode = await this.resolveTypeCode(dto, tenantId, companyId);

    // 3. Check duplicate type code
    const duplicateConditions = [
      eq(schema.itemTypeMaster.tenant_id, tenantId),
      eq(schema.itemTypeMaster.type_code, typeCode),
      isNull(schema.itemTypeMaster.deleted_at),
    ];
    if (companyId) {
      duplicateConditions.push(eq(schema.itemTypeMaster.company_id, companyId));
    } else {
      duplicateConditions.push(isNull(schema.itemTypeMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.itemTypeMaster)
      .where(and(...duplicateConditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Item type with code '${typeCode}' already exists in this scope.`);
    }

    const itemTypeId = randomUUID();
    const newType = {
      item_type_id: itemTypeId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: companyId,
      type_code: typeCode,
      // code_prefix is the more specific configuration an ITEM_<type_code> series
      // defers to instead of its own prefix (NumberSeriesService.resolveSeriesFor
      // callers) — defaults to the type_code itself when not explicitly set.
      code_prefix: (dto.code_prefix || typeCode).toUpperCase(),
      type_name: dto.type_name,
      description: dto.description || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.itemTypeMaster).values(newType);

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_type_master',
      entityId: itemTypeId,
      newValues: newType,
    });

    return this.findOne(itemTypeId);
  }

  async findOne(id: string) {
    const [itemType] = await this.db
      .select()
      .from(schema.itemTypeMaster)
      .where(and(eq(schema.itemTypeMaster.item_type_id, id), isNull(schema.itemTypeMaster.deleted_at)))
      .limit(1);

    if (!itemType) {
      throw new NotFoundException(`Item Type with ID '${id}' not found.`);
    }

    return itemType;
  }

  async findAll(query: QueryItemTypeDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.itemTypeMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.itemTypeMaster, query.companyId));
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.itemTypeMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.itemTypeMaster.type_code, `%${query.search}%`),
          like(schema.itemTypeMaster.type_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.itemTypeMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.itemTypeMaster, conditions, query, schema.itemTypeMaster.type_code);
  }

  async update(id: string, dto: UpdateItemTypeDto, tenantId: string, userPayload?: any) {
    const itemType = await this.findOne(id);

    // type_code is immutable (UpdateItemTypeDto no longer carries it), and
    // blocking the row is the same outcome by another route: an inactive
    // MEDICINE type is what remove() refuses to allow.
    if (itemType.is_system && (dto.is_active === false || (dto.status !== undefined && dto.status.toUpperCase() !== 'ACTIVE'))) {
      throw new ConflictException(`Item type '${itemType.type_code}' is a system type and cannot be deactivated.`);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.code_prefix !== undefined) updates.code_prefix = dto.code_prefix.toUpperCase();
    if (dto.type_name !== undefined) updates.type_name = dto.type_name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.itemTypeMaster)
      .set(updates)
      .where(eq(schema.itemTypeMaster.item_type_id, id));

    await this.auditService.log({
      tenantId,
      companyId: itemType.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'item_type_master',
      entityId: id,
      oldValues: itemType,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const itemType = await this.findOne(id);

    if (itemType.is_system) {
      throw new ConflictException(`Item type '${itemType.type_code}' is a system type and cannot be deleted.`);
    }

    // item_master.item_type holds the type_code string with no foreign key, so
    // deleting a type in use leaves those items pointing at nothing. Mirrors
    // LocationTypeService.remove()'s check against location_master.
    const usageConditions = [
      eq(schema.itemMaster.tenant_id, tenantId),
      eq(schema.itemMaster.item_type, itemType.type_code),
    ];
    if (itemType.company_id) usageConditions.push(eq(schema.itemMaster.company_id, itemType.company_id));
    const [item] = await this.db
      .select({ id: schema.itemMaster.item_id })
      .from(schema.itemMaster)
      .where(and(...usageConditions))
      .limit(1);
    if (item) {
      throw new ConflictException(`Item type '${itemType.type_code}' is already used by an item and cannot be deleted.`);
    }

    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.itemTypeMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.itemTypeMaster.item_type_id, id));

    await this.auditService.log({
      tenantId,
      companyId: itemType.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'item_type_master',
      entityId: id,
      oldValues: itemType,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Item Type '${itemType.type_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [itemType] = await this.db
      .select()
      .from(schema.itemTypeMaster)
      .where(eq(schema.itemTypeMaster.item_type_id, id))
      .limit(1);

    if (!itemType) {
      throw new NotFoundException(`Item Type with ID '${id}' not found.`);
    }

    if (!itemType.deleted_at) {
      return itemType;
    }

    await this.db
      .update(schema.itemTypeMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.itemTypeMaster.item_type_id, id));

    await this.auditService.log({
      tenantId,
      companyId: itemType.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'item_type_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

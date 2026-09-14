import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateItemAttributeDto, UpdateItemAttributeDto, QueryItemAttributeDto } from './dto/item-attribute.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ItemAttributeService {
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

  async create(dto: CreateItemAttributeDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;

    if (dto.data_type === 'LIST' && (!dto.list_values || dto.list_values.length === 0)) {
      throw new ConflictException('LIST attributes require at least one entry in list_values.');
    }
    const attributeCode = await this.numberSeriesService.resolveNewCode('ITEM_ATTRIBUTE', dto.attribute_code, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);

    const conditions = [
      eq(schema.itemAttributeMaster.tenant_id, tenantId),
      eq(schema.itemAttributeMaster.attribute_code, attributeCode),
      isNull(schema.itemAttributeMaster.deleted_at),
    ];
    if (companyId) {
      conditions.push(eq(schema.itemAttributeMaster.company_id, companyId));
    } else {
      conditions.push(isNull(schema.itemAttributeMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.itemAttributeMaster)
      .where(and(...conditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Attribute with code '${dto.attribute_code}' already exists in this scope.`);
    }

    const attributeId = randomUUID();
    const newAttribute = {
      attribute_id: attributeId,
      tenant_id: tenantId,
      company_id: companyId,
      nob_id: dto.nob_id || null,
      lob_id: dto.lob_id || null,
      attribute_code: attributeCode,
      attribute_name: dto.attribute_name,
      data_type: dto.data_type,
      list_values: dto.list_values ? JSON.stringify(dto.list_values) : null,
      unit: dto.unit || null,
      is_mandatory: dto.is_mandatory ?? false,
      affects_costing: dto.affects_costing ?? false,
      is_variant: dto.is_variant ?? false,
      is_active: true,
      status: 'ACTIVE',
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.itemAttributeMaster).values(newAttribute);

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_attribute_master',
      entityId: attributeId,
      newValues: newAttribute,
    });

    return this.findOne(attributeId);
  }

  async findOne(id: string) {
    const [attribute] = await this.db
      .select()
      .from(schema.itemAttributeMaster)
      .where(and(eq(schema.itemAttributeMaster.attribute_id, id), isNull(schema.itemAttributeMaster.deleted_at)))
      .limit(1);

    if (!attribute) {
      throw new NotFoundException(`Item attribute with ID '${id}' not found.`);
    }

    return attribute;
  }

  async findAll(query: QueryItemAttributeDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.itemAttributeMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.itemAttributeMaster, query.companyId));
    if (query.nobId) {
      conditions.push(eq(schema.itemAttributeMaster.nob_id, query.nobId));
    }
    if (query.lobId) {
      conditions.push(eq(schema.itemAttributeMaster.lob_id, query.lobId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.itemAttributeMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.itemAttributeMaster.attribute_code, `%${query.search}%`),
          like(schema.itemAttributeMaster.attribute_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.itemAttributeMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.itemAttributeMaster, conditions, query, schema.itemAttributeMaster.attribute_code);
  }

  async update(id: string, dto: UpdateItemAttributeDto, tenantId: string, userPayload?: any) {
    const attribute = await this.findOne(id);

    if (dto.attribute_code && dto.attribute_code.toUpperCase() !== attribute.attribute_code) {
      const codeConditions = [
        eq(schema.itemAttributeMaster.tenant_id, tenantId),
        eq(schema.itemAttributeMaster.attribute_code, dto.attribute_code.toUpperCase()),
        ne(schema.itemAttributeMaster.attribute_id, id),
        isNull(schema.itemAttributeMaster.deleted_at),
      ];
      if (attribute.company_id) {
        codeConditions.push(eq(schema.itemAttributeMaster.company_id, attribute.company_id));
      } else {
        codeConditions.push(isNull(schema.itemAttributeMaster.company_id));
      }

      const existing = await this.db
        .select()
        .from(schema.itemAttributeMaster)
        .where(and(...codeConditions))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Attribute with code '${dto.attribute_code}' already exists in this scope.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;
    if (dto.attribute_code !== undefined) updates.attribute_code = dto.attribute_code.toUpperCase();
    if (dto.attribute_name !== undefined) updates.attribute_name = dto.attribute_name;
    if (dto.data_type !== undefined) updates.data_type = dto.data_type;
    if (dto.list_values !== undefined) updates.list_values = JSON.stringify(dto.list_values);
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.is_mandatory !== undefined) updates.is_mandatory = dto.is_mandatory;
    if (dto.affects_costing !== undefined) updates.affects_costing = dto.affects_costing;
    if (dto.is_variant !== undefined) updates.is_variant = dto.is_variant;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;

    await this.db
      .update(schema.itemAttributeMaster)
      .set(updates)
      .where(eq(schema.itemAttributeMaster.attribute_id, id));

    await this.auditService.log({
      tenantId,
      companyId: attribute.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'item_attribute_master',
      entityId: id,
      oldValues: attribute,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const attribute = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.itemAttributeMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.itemAttributeMaster.attribute_id, id));

    await this.auditService.log({
      tenantId,
      companyId: attribute.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'item_attribute_master',
      entityId: id,
      oldValues: attribute,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Item attribute '${attribute.attribute_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [attribute] = await this.db
      .select()
      .from(schema.itemAttributeMaster)
      .where(eq(schema.itemAttributeMaster.attribute_id, id))
      .limit(1);

    if (!attribute) {
      throw new NotFoundException(`Item attribute with ID '${id}' not found.`);
    }

    if (!attribute.deleted_at) {
      return attribute;
    }

    await this.db
      .update(schema.itemAttributeMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.itemAttributeMaster.attribute_id, id));

    await this.auditService.log({
      tenantId,
      companyId: attribute.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'item_attribute_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

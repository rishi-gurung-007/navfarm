import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { 
  CreateUomDto, 
  UpdateUomDto, 
  QueryUomDto, 
  CreateUomConversionDto, 
  UpdateUomConversionDto 
} from './dto/uom.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class UomService {
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

  /** Resolves by uom_type first (e.g. UOM_WEIGHT), then the master-alone UOM series, else manual. */
  private async resolveUomCode(dto: CreateUomDto, tenantId: string, companyId: string | null): Promise<string> {
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('UOM', dto.uom_type, tenantId, companyId);
    if (!seriesCode) {
      if (!dto.uom_code) {
        throw new BadRequestException('uom_code is required — no number series is configured for units of measure.');
      }
      return dto.uom_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId);
    if (series.allow_manual && dto.uom_code) {
      return dto.uom_code.toUpperCase();
    }
    return this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);
  }

  async create(dto: CreateUomDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;

    // Resolve the UOM code — a series if one is configured, else the user-supplied code.
    const uomCode = await this.resolveUomCode(dto, tenantId, companyId);

    // Validate unique UOM code per tenant/company
    const conditions = [
      eq(schema.uomMaster.tenant_id, tenantId),
      eq(schema.uomMaster.uom_code, uomCode),
      isNull(schema.uomMaster.deleted_at),
    ];
    if (companyId) {
      conditions.push(eq(schema.uomMaster.company_id, companyId));
    } else {
      conditions.push(isNull(schema.uomMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.uomMaster)
      .where(and(...conditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`UOM with code '${uomCode}' already exists in this scope.`);
    }

    // Handle is_base_uom rule: only one base UOM per uom_type within scope
    if (dto.is_base_uom) {
      const baseConditions = [
        eq(schema.uomMaster.tenant_id, tenantId),
        eq(schema.uomMaster.uom_type, dto.uom_type),
        eq(schema.uomMaster.is_base_uom, true),
        isNull(schema.uomMaster.deleted_at),
      ];
      if (companyId) {
        baseConditions.push(eq(schema.uomMaster.company_id, companyId));
      } else {
        baseConditions.push(isNull(schema.uomMaster.company_id));
      }

      const existingBase = await this.db
        .select()
        .from(schema.uomMaster)
        .where(and(...baseConditions))
        .limit(1);

      if (existingBase.length > 0) {
        throw new BadRequestException(
          `A base UOM for type '${dto.uom_type}' already exists (${existingBase[0].uom_code}). Please deactivate it first.`
        );
      }
    }

    const uomId = randomUUID();
    const newUom = {
      uom_id: uomId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: companyId,
      uom_code: uomCode,
      uom_name: dto.uom_name,
      uom_type: dto.uom_type,
      decimal_places: dto.decimal_places ?? 0,
      is_base_uom: dto.is_base_uom ?? false,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.uomMaster).values(newUom);

    // Audit Log
    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'uom_master',
      entityId: uomId,
      newValues: newUom,
    });

    return this.findOne(uomId);
  }

  async findOne(id: string) {
    const [uom] = await this.db
      .select()
      .from(schema.uomMaster)
      .where(and(eq(schema.uomMaster.uom_id, id), isNull(schema.uomMaster.deleted_at)))
      .limit(1);

    if (!uom) {
      throw new NotFoundException(`UOM with ID '${id}' not found.`);
    }

    return uom;
  }

  async findAll(query: QueryUomDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.uomMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.uomMaster, query.companyId));
    if (query.uomType) {
      conditions.push(eq(schema.uomMaster.uom_type, query.uomType));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.uomMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.uomMaster.uom_code, `%${query.search}%`),
          like(schema.uomMaster.uom_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.uomMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.uomMaster)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.uomMaster, query, schema.uomMaster.uom_code))
      .limit(limit)
      .offset(offset);
  }

  async update(id: string, dto: UpdateUomDto, tenantId: string, userPayload?: any) {
    const uom = await this.findOne(id);

    // Validate unique code if code is changed
    if (dto.uom_code && dto.uom_code.toUpperCase() !== uom.uom_code) {
      const codeConditions = [
        eq(schema.uomMaster.tenant_id, tenantId),
        eq(schema.uomMaster.uom_code, dto.uom_code.toUpperCase()),
        ne(schema.uomMaster.uom_id, id),
        isNull(schema.uomMaster.deleted_at),
      ];
      if (uom.company_id) {
        codeConditions.push(eq(schema.uomMaster.company_id, uom.company_id));
      } else {
        codeConditions.push(isNull(schema.uomMaster.company_id));
      }

      const existing = await this.db
        .select()
        .from(schema.uomMaster)
        .where(and(...codeConditions))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`UOM with code '${dto.uom_code}' already exists in this scope.`);
      }
    }

    // Handle is_base_uom rule: only one base UOM per type
    if ((dto.is_base_uom ?? uom.is_base_uom) && (!uom.is_base_uom || (dto.uom_type !== undefined && dto.uom_type !== uom.uom_type))) {
      const baseConditions = [
        eq(schema.uomMaster.tenant_id, tenantId),
        eq(schema.uomMaster.uom_type, dto.uom_type || uom.uom_type),
        eq(schema.uomMaster.is_base_uom, true),
        ne(schema.uomMaster.uom_id, id),
        isNull(schema.uomMaster.deleted_at),
      ];
      if (uom.company_id) {
        baseConditions.push(eq(schema.uomMaster.company_id, uom.company_id));
      } else {
        baseConditions.push(isNull(schema.uomMaster.company_id));
      }

      const existingBase = await this.db
        .select()
        .from(schema.uomMaster)
        .where(and(...baseConditions))
        .limit(1);

      if (existingBase.length > 0) {
        throw new BadRequestException(
          `A base UOM for type '${dto.uom_type || uom.uom_type}' already exists (${existingBase[0].uom_code}).`
        );
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.uom_code !== undefined) updates.uom_code = dto.uom_code.toUpperCase();
    if (dto.uom_name !== undefined) updates.uom_name = dto.uom_name;
    if (dto.uom_type !== undefined) updates.uom_type = dto.uom_type;
    if (dto.decimal_places !== undefined) updates.decimal_places = dto.decimal_places;
    if (dto.is_base_uom !== undefined) updates.is_base_uom = dto.is_base_uom;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.uomMaster)
      .set(updates)
      .where(eq(schema.uomMaster.uom_id, id));

    // Audit Log
    await this.auditService.log({
      tenantId,
      companyId: uom.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'uom_master',
      entityId: id,
      oldValues: uom,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const uom = await this.findOne(id);

    // Business check: Prevent deleting records used in transactions
    // For now, we will soft delete. If there are items/transactions referencing it, DB constraint may trigger, or we can check later.
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.uomMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.uomMaster.uom_id, id));

    // Audit Log
    await this.auditService.log({
      tenantId,
      companyId: uom.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'uom_master',
      entityId: id,
      oldValues: uom,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `UOM '${uom.uom_code}' has been successfully soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [uom] = await this.db
      .select()
      .from(schema.uomMaster)
      .where(eq(schema.uomMaster.uom_id, id))
      .limit(1);

    if (!uom) {
      throw new NotFoundException(`UOM with ID '${id}' not found.`);
    }

    if (!uom.deleted_at) {
      return uom; // Already active / not deleted
    }

    await this.db
      .update(schema.uomMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.uomMaster.uom_id, id));

    // Audit Log
    await this.auditService.log({
      tenantId,
      companyId: uom.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'uom_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }

  // ========================================================
  // UOM CONVERSIONS
  // ========================================================

  async createConversion(dto: CreateUomConversionDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;

    // Check if conversion already exists
    const existing = await this.db
      .select()
      .from(schema.uomConversionMaster)
      .where(
        and(
          eq(schema.uomConversionMaster.tenant_id, tenantId),
          eq(schema.uomConversionMaster.from_uom, dto.from_uom.toUpperCase()),
          eq(schema.uomConversionMaster.to_uom, dto.to_uom.toUpperCase()),
          dto.item_id ? eq(schema.uomConversionMaster.item_id, dto.item_id) : isNull(schema.uomConversionMaster.item_id),
          isNull(schema.uomConversionMaster.deleted_at),
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException('A conversion factor already exists between these units.');
    }

    // Manual today, automatic once a UOM_CONVERSION series is configured; null
    // when neither applies, which is why the column is nullable.
    const conversionCode = await this.numberSeriesService.resolveOptionalCode('UOM_CONVERSION', dto.conversion_code, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);

    const conversionId = randomUUID();
    const newConv = {
      conversion_id: conversionId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: companyId,
      conversion_code: conversionCode,
      item_id: dto.item_id || null,
      from_uom: dto.from_uom.toUpperCase(),
      to_uom: dto.to_uom.toUpperCase(),
      conversion_factor: dto.conversion_factor.toString(),
      effective_from: dto.effective_from,
      effective_to: dto.effective_to || null,
      is_active: true,
      status: 'ACTIVE',
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.uomConversionMaster).values(newConv);

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'uom_conversion_master',
      entityId: conversionId,
      newValues: newConv,
    });

    return this.findOneConversion(conversionId);
  }

  async findOneConversion(id: string) {
    const [conv] = await this.db
      .select()
      .from(schema.uomConversionMaster)
      .where(and(eq(schema.uomConversionMaster.conversion_id, id), isNull(schema.uomConversionMaster.deleted_at)))
      .limit(1);

    if (!conv) {
      throw new NotFoundException(`UOM Conversion with ID '${id}' not found.`);
    }

    return conv;
  }

  async findAllConversions(query: { itemId?: string; companyId?: string; fromUom?: string; toUom?: string; limit?: number; offset?: number }, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.uomConversionMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.uomConversionMaster, query.companyId));
    if (query.itemId) {
      conditions.push(
        or(
          eq(schema.uomConversionMaster.item_id, query.itemId),
          isNull(schema.uomConversionMaster.item_id) // Include global mappings
        )
      );
    }

    // The Item Master Template says the item's conversion factor is
    // "Auto-filled from uom_conversion_master", which needs a lookup by unit
    // pair rather than by item — otherwise the form has to ask for a number
    // this table already holds.
    if (query.fromUom) conditions.push(eq(schema.uomConversionMaster.from_uom, query.fromUom.toUpperCase()));
    if (query.toUom) conditions.push(eq(schema.uomConversionMaster.to_uom, query.toUom.toUpperCase()));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.uomConversionMaster)
      .where(and(...conditions))
      .orderBy(schema.uomConversionMaster.from_uom)
      .limit(limit)
      .offset(offset);
  }

  async updateConversion(id: string, dto: UpdateUomConversionDto, tenantId: string, userPayload?: any) {
    const conv = await this.findOneConversion(id);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    // Blank means "untouched": the master-data form posts "" for every optional
    // field, and rows created before this column existed still hold NULL.
    const conversionCode = await this.numberSeriesService.editedCode('UOM_CONVERSION', dto.conversion_code, conv.conversion_code, tenantId, conv.company_id);
    if (conversionCode) updates.conversion_code = conversionCode;
    if (dto.conversion_factor !== undefined) updates.conversion_factor = dto.conversion_factor.toString();
    if (dto.effective_from !== undefined) updates.effective_from = dto.effective_from;
    if (dto.effective_to !== undefined) updates.effective_to = dto.effective_to;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;

    await this.db
      .update(schema.uomConversionMaster)
      .set(updates)
      .where(eq(schema.uomConversionMaster.conversion_id, id));

    await this.auditService.log({
      tenantId,
      companyId: conv.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'uom_conversion_master',
      entityId: id,
      oldValues: conv,
      newValues: updates,
    });

    return this.findOneConversion(id);
  }

  async removeConversion(id: string, tenantId: string, userPayload?: any) {
    const conv = await this.findOneConversion(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.uomConversionMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.uomConversionMaster.conversion_id, id));

    await this.auditService.log({
      tenantId,
      companyId: conv.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'uom_conversion_master',
      entityId: id,
      oldValues: conv,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: 'UOM conversion has been successfully soft-deleted.' };
  }

  /**
   * Resolves the conversion factor to convert quantity from fromUom to toUom.
   * Checks item-specific conversion first, then falls back to global conversion.
   * If fromUom === toUom, returns 1.
   */
  async resolveConversionFactor(
    fromUom: string,
    toUom: string,
    itemId?: string,
    companyId?: string,
    tenantId?: string
  ): Promise<number> {
    const fromClean = fromUom.toUpperCase().trim();
    const toClean = toUom.toUpperCase().trim();

    if (fromClean === toClean) return 1.0;

    // 1. Check item-specific conversion if itemId is provided
    if (itemId) {
      const itemConv = await this.db
        .select()
        .from(schema.uomConversionMaster)
        .where(
          and(
            eq(schema.uomConversionMaster.from_uom, fromClean),
            eq(schema.uomConversionMaster.to_uom, toClean),
            eq(schema.uomConversionMaster.item_id, itemId),
            eq(schema.uomConversionMaster.is_active, true),
            isNull(schema.uomConversionMaster.deleted_at)
          )
        )
        .limit(1);

      if (itemConv.length > 0) {
        return Number(itemConv[0].conversion_factor);
      }
    }

    // 2. Check global conversion
    const globalConv = await this.db
      .select()
      .from(schema.uomConversionMaster)
      .where(
        and(
          eq(schema.uomConversionMaster.from_uom, fromClean),
          eq(schema.uomConversionMaster.to_uom, toClean),
          isNull(schema.uomConversionMaster.item_id),
          eq(schema.uomConversionMaster.is_active, true),
          isNull(schema.uomConversionMaster.deleted_at)
        )
      )
      .limit(1);

    if (globalConv.length > 0) {
      return Number(globalConv[0].conversion_factor);
    }

    // 3. Check inverse conversion (toUom -> fromUom)
    const inverseConv = await this.db
      .select()
      .from(schema.uomConversionMaster)
      .where(
        and(
          eq(schema.uomConversionMaster.from_uom, toClean),
          eq(schema.uomConversionMaster.to_uom, fromClean),
          eq(schema.uomConversionMaster.is_active, true),
          isNull(schema.uomConversionMaster.deleted_at)
        )
      )
      .limit(1);

    if (inverseConv.length > 0) {
      const factor = Number(inverseConv[0].conversion_factor);
      if (factor > 0) return 1.0 / factor;
    }

    throw new BadRequestException(
      `No UOM conversion rule found between '${fromClean}' and '${toClean}'${itemId ? ` for item '${itemId}'` : ''}.`
    );
  }

  async convertQuantity(
    fromUom: string,
    toUom: string,
    quantity: number,
    itemId?: string,
    companyId?: string,
    tenantId?: string
  ) {
    const factor = await this.resolveConversionFactor(fromUom, toUom, itemId, companyId, tenantId);
    return {
      fromUom: fromUom.toUpperCase().trim(),
      toUom: toUom.toUpperCase().trim(),
      inputQuantity: quantity,
      conversionFactor: factor,
      convertedQuantity: quantity * factor,
    };
  }
}

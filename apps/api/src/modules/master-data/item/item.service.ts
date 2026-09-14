import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, getTableColumns, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateItemDto, UpdateItemDto, QueryItemDto } from './dto/item.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ItemService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * Each company owns exactly one ITEM counter, shared by every Item Type.
   * Older tenants only have the tenant-wide template row, so create the
   * company counter lazily and continue after the highest existing matching
   * code instead of restarting at one.
   */
  private async ensureCompanyItemSeries(tenantId: string, companyId: string | null) {
    if (!companyId) return;
    const [existing] = await this.db.select().from(schema.noSeriesMaster).where(and(
      eq(schema.noSeriesMaster.tenant_id, tenantId),
      eq(schema.noSeriesMaster.company_id, companyId),
      eq(schema.noSeriesMaster.series_code, 'ITEM'),
      isNull(schema.noSeriesMaster.deleted_at),
    )).limit(1);
    if (existing) return;

    const [template] = await this.db.select().from(schema.noSeriesMaster).where(and(
      eq(schema.noSeriesMaster.tenant_id, tenantId),
      isNull(schema.noSeriesMaster.company_id),
      eq(schema.noSeriesMaster.series_code, 'ITEM'),
      isNull(schema.noSeriesMaster.deleted_at),
    )).limit(1);
    if (!template) throw new NotFoundException("Number series 'ITEM' is not configured for this tenant.");

    const codes = await this.db.select({ code: schema.itemMaster.item_code }).from(schema.itemMaster).where(and(
      eq(schema.itemMaster.tenant_id, tenantId),
      eq(schema.itemMaster.company_id, companyId),
    ));
    const prefix = template.prefix || 'ITM';
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}${template.separator || '-'}(\\d+)$`, 'i');
    const currentSeq = codes.reduce((max, row) => {
      const match = row.code.match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    await this.db.insert(schema.noSeriesMaster).values({
      series_id: randomUUID(), tenant_id: tenantId, company_id: companyId,
      series_code: 'ITEM', series_name: template.series_name, document_type: template.document_type,
      prefix: template.prefix, separator: template.separator,
      seq_length: template.seq_length, current_seq: currentSeq,
      reset_frequency: template.reset_frequency, allow_manual: true,
    }).onDuplicateKeyUpdate({ set: { series_name: template.series_name } });
  }

  /**
   * item_master.item_type stores a type_code string with no foreign key, so the
   * scope guard (master-data-scope.ts walks declared FKs) cannot check it and
   * any string would otherwise be accepted. Resolved the same way
   * LocationService.resolveLocationType resolves location_type: an active,
   * undeleted type owned by this exact scope. Tenant rows are draft templates,
   * not shared live records for companies.
   * Matched exactly, never upper-cased — the stored value is what
   * assertWithdrawalDays() compares against 'MEDICINE'/'VACCINE'.
   */
  private async assertItemTypeExists(itemType: string, tenantId: string, companyId: string | null) {
    const [type] = await this.db
      .select({ id: schema.itemTypeMaster.item_type_id })
      .from(schema.itemTypeMaster)
      .where(and(
        eq(schema.itemTypeMaster.tenant_id, tenantId),
        eq(schema.itemTypeMaster.type_code, itemType),
        eq(schema.itemTypeMaster.is_active, true),
        isNull(schema.itemTypeMaster.deleted_at),
        companyId
          ? eq(schema.itemTypeMaster.company_id, companyId)
          : isNull(schema.itemTypeMaster.company_id),
      ))
      .limit(1);

    if (!type) {
      throw new NotFoundException(`Item Type '${itemType}' not found.`);
    }
  }

  /** withdrawal_days is mandatory for MEDICINE/VACCINE item types per spec. */
  private assertWithdrawalDays(itemType: string, withdrawalDays?: number | null) {
    if ((itemType === 'MEDICINE' || itemType === 'VACCINE') && withdrawalDays == null) {
      throw new BadRequestException(`${itemType} items require withdrawal_days to be set.`);
    }
  }

  /** standard_cost is mandatory when valuation_method is STANDARD, per spec. */
  private assertStandardCost(valuationMethod?: string | null, standardCost?: number | null) {
    if (valuationMethod === 'STANDARD' && standardCost == null) {
      throw new BadRequestException('standard_cost is required when valuation_method is STANDARD.');
    }
  }

  /**
   * The Item Master Template has the item's factor "Auto-filled from
   * uom_conversion_master", so the conversion belongs in that table rather than
   * only on the item's own column. If the pair is already recorded the form
   * shows it read-only and nothing is written here; if it was captured on the
   * item form for the first time, it is recorded now, so the next item inherits
   * it and the two can never disagree.
   *
   * Called from update as well as create. It used to run on create only, which
   * meant an item edited to add a secondary unit and a factor wrote the number
   * to its own row and nowhere else — the next item over the same pair was
   * asked for it again, with nothing to stop a different answer.
   */
  private async recordUomConversion(
    tx: any,
    args: { tenantId: string; companyId: string | null; fromUom?: string | null; toUom?: string | null; factor?: number | string | null; userId?: string | null },
  ) {
    const { tenantId, companyId, fromUom, toUom, factor } = args;
    if (!fromUom || !toUom || factor == null || factor === '') return;
    const pair = [
      eq(schema.uomConversionMaster.tenant_id, tenantId),
      eq(schema.uomConversionMaster.from_uom, fromUom.toUpperCase()),
      eq(schema.uomConversionMaster.to_uom, toUom.toUpperCase()),
      companyId ? eq(schema.uomConversionMaster.company_id, companyId) : isNull(schema.uomConversionMaster.company_id),
    ];
    const [existing] = await tx.select({ id: schema.uomConversionMaster.conversion_id })
      .from(schema.uomConversionMaster).where(and(...pair)).limit(1);
    if (existing) return;
    await tx.insert(schema.uomConversionMaster).values({
      conversion_id: randomUUID(),
      tenant_id: tenantId,
      company_id: companyId,
      item_id: null, // applies to every item using this unit pair
      from_uom: fromUom.toUpperCase(),
      to_uom: toUom.toUpperCase(),
      conversion_factor: factor.toString(),
      // effective_from is NOT NULL and the form does not ask for it here; the
      // factor is true from the moment it is recorded, and left open-ended
      // until someone supersedes it in UOM Conversion.
      effective_from: toMysqlTimestamp().slice(0, 10),
      is_active: true,
      created_by: args.userId || null,
    });
  }

  /** tracking_series_id is mandatory when the item is lot- or serial-tracked, per spec. */
  private assertTrackingSeries(isLotTracked?: boolean | null, isSerialTracked?: boolean | null, trackingSeriesId?: string | null) {
    if ((isLotTracked || isSerialTracked) && !trackingSeriesId) {
      throw new BadRequestException('tracking_series_id is required when is_lot_tracked or is_serial_tracked is true.');
    }
  }

  async create(dto: CreateItemDto, tenantId: string, userPayload?: any) {
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

    // 2. Verify category exists (if provided)
    if (dto.category_id) {
      const [category] = await this.db
        .select()
        .from(schema.itemCategoryMaster)
        .where(and(eq(schema.itemCategoryMaster.category_id, dto.category_id), isNull(schema.itemCategoryMaster.deleted_at)))
        .limit(1);

      if (!category) {
        throw new NotFoundException(`Item Category with ID '${dto.category_id}' not found.`);
      }
    }

    // 3. Verify the item type exists in this scope
    await this.assertItemTypeExists(dto.item_type, tenantId, companyId);

    this.assertWithdrawalDays(dto.item_type, dto.withdrawal_days);
    this.assertStandardCost(dto.valuation_method, dto.standard_cost);
    this.assertTrackingSeries(dto.is_lot_tracked, dto.is_serial_tracked, dto.tracking_series_id);

    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). item_master.nob_id/lob_id are nullable, so an ambiguous company
    // (operational areas split across LOBs) simply stores null rather than
    // blocking the create — a farm must never be blocked from adding an item
    // because the taxonomy is ambiguous.
    const resolvedNobLob = await this.nobLobResolution.resolve(tenantId, companyId, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });

    // 4. One company-wide ITEM sequence is shared by all Item Types.
    await this.ensureCompanyItemSeries(tenantId, companyId);
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('ITEM', dto.item_type, tenantId, companyId) || 'ITEM';
    const itemCode = dto.item_code?.trim()
      ? await this.numberSeriesService.manualCode('ITEM', dto.item_code, tenantId, companyId, dto.item_type)
      : await this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);

    const itemId = randomUUID();
    const newItem = {
      item_id: itemId,
      tenant_id: tenantId,
      company_id: companyId,
      category_id: dto.category_id || null,
      item_code: itemCode,
      item_name: dto.item_name,
      item_type: dto.item_type,
      nob_id: resolvedNobLob.nob_id,
      lob_id: resolvedNobLob.lob_id,
      sub_category: dto.sub_category || null,
      uom_primary: dto.uom_primary,
      uom_secondary: dto.uom_secondary || null,
      uom_conversion_factor: dto.uom_conversion_factor?.toString() || null,
      valuation_method: dto.valuation_method || null,
      posting_group: dto.posting_group || dto.item_type,
      standard_cost: dto.standard_cost?.toString() || null,
      is_lot_tracked: dto.is_lot_tracked || false,
      is_serial_tracked: dto.is_serial_tracked || false,
      tracking_series_id: dto.tracking_series_id || null,
      is_biological_asset: dto.is_biological_asset || false,
      is_biological_costing_method: dto.is_biological_costing_method || null,
      is_inventoriable: dto.is_inventoriable ?? true,
      min_stock_level: dto.min_stock_level?.toString() || null,
      max_stock_level: dto.max_stock_level?.toString() || null,
      reorder_level: dto.reorder_level?.toString() || null,
      lead_time_days: dto.lead_time_days ?? null,
      shelf_life_days: dto.shelf_life_days ?? null,
      storage_temp_min: dto.storage_temp_min?.toString() || null,
      storage_temp_max: dto.storage_temp_max?.toString() || null,
      withdrawal_days: dto.withdrawal_days ?? null,
      is_qr_enabled: dto.is_qr_enabled || false,
      qr_trigger_event: dto.qr_trigger_event || null,
      item_image_url: dto.item_image_url || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    // Transactional save for item + attribute values mapping
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.itemMaster).values(newItem);

      await this.recordUomConversion(tx, {
        tenantId,
        companyId,
        fromUom: dto.uom_primary,
        toUom: dto.uom_secondary,
        factor: dto.uom_conversion_factor,
        userId: userPayload?.userId,
      });

      if (dto.attributes && dto.attributes.length > 0) {
        for (const attr of dto.attributes) {
          // Verify attribute definition exists
          const [attrDef] = await tx
            .select()
            .from(schema.itemAttributeMaster)
            .where(and(eq(schema.itemAttributeMaster.attribute_id, attr.attribute_id), isNull(schema.itemAttributeMaster.deleted_at)))
            .limit(1);

          if (!attrDef) {
            throw new NotFoundException(`Attribute definition with ID '${attr.attribute_id}' not found.`);
          }

          await tx.insert(schema.itemAttributeValues).values({
            value_id: randomUUID(),
            item_id: itemId,
            attribute_id: attr.attribute_id,
            attribute_value: attr.attribute_value,
          });
        }
      }
    });

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_master',
      entityId: itemId,
      newValues: newItem,
    });

    return this.findOne(itemId);
  }

  /**
   * `includeBlocked` is what the read endpoint passes. findAll deliberately
   * keeps soft-deleted rows in the list so a blocked item can be found and
   * restored (see its comment), but this filtered them out — so the row was
   * listed and then 404'd the moment it was opened. Blocking an item is not
   * supposed to make it unreadable.
   *
   * Left off everywhere else: update() and remove() call this to load the row
   * they are about to change, and neither should act on a blocked one.
   */
  async findOne(id: string, includeBlocked = false) {
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(includeBlocked
        ? eq(schema.itemMaster.item_id, id)
        : and(eq(schema.itemMaster.item_id, id), isNull(schema.itemMaster.deleted_at)))
      .limit(1);

    if (!item) {
      throw new NotFoundException(`Item with ID '${id}' not found.`);
    }

    // Fetch mapped attributes
    const attributes = await this.db
      .select({
        attribute_id: schema.itemAttributeValues.attribute_id,
        attribute_code: schema.itemAttributeMaster.attribute_code,
        attribute_name: schema.itemAttributeMaster.attribute_name,
        attribute_value: schema.itemAttributeValues.attribute_value,
      })
      .from(schema.itemAttributeValues)
      .leftJoin(
        schema.itemAttributeMaster,
        eq(schema.itemAttributeValues.attribute_id, schema.itemAttributeMaster.attribute_id)
      )
      .where(eq(schema.itemAttributeValues.item_id, id));

    return {
      ...item,
      attributes,
    };
  }

  async findAll(query: QueryItemDto, tenantId: string) {
    // No isNull(deleted_at) filter here — remove() sets both is_active=false and deleted_at, and
    // the list view is meant to show both states (Active/Inactive badge) so a blocked item can be
    // found again and restored, rather than vanishing from the list entirely.
    const conditions: any[] = [
      eq(schema.itemMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.itemMaster, query.companyId));
    if (query.categoryId) {
      conditions.push(eq(schema.itemMaster.category_id, query.categoryId));
    }
    if (query.itemType) {
      conditions.push(eq(schema.itemMaster.item_type, query.itemType));
    }
    if (query.nobId) {
      conditions.push(eq(schema.itemMaster.nob_id, query.nobId));
    }
    if (query.lobId) {
      conditions.push(eq(schema.itemMaster.lob_id, query.lobId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.itemMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.itemMaster.item_code, `%${query.search}%`),
          like(schema.itemMaster.item_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.itemMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    // category_code alongside the raw category_id, so a list can show the
    // category an item is filed under. The column stores a UUID, and a list
    // that renders it raw shows the reader a UUID; resolving it per row from
    // the client would be one request per row instead.
    //
    // sub_category needs no join — it already stores the child category's own
    // code, which is what makes it readable as it stands.
    // Not runMasterList: that helper selects from one table, and this list joins
    // the category so the screen shows a code rather than a UUID. The count
    // repeats the same conditions, so the two can never disagree about what
    // they are counting.
    const data = await this.db
      .select({
        ...getTableColumns(schema.itemMaster),
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
      })
      .from(schema.itemMaster)
      .leftJoin(
        schema.itemCategoryMaster,
        eq(schema.itemCategoryMaster.category_id, schema.itemMaster.category_id),
      )
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.itemMaster, query, schema.itemMaster.item_code))
      .limit(limit)
      .offset(offset);

    const [counted] = await this.db
      .select({ total: count() })
      .from(schema.itemMaster)
      .where(and(...conditions));

    return { data, total: Number(counted?.total ?? 0), limit, offset };
  }

  async update(id: string, dto: UpdateItemDto, tenantId: string, userPayload?: any) {
    const item = await this.findOne(id);

    if (dto.category_id) {
      const [category] = await this.db
        .select()
        .from(schema.itemCategoryMaster)
        .where(and(eq(schema.itemCategoryMaster.category_id, dto.category_id), isNull(schema.itemCategoryMaster.deleted_at)))
        .limit(1);

      if (!category) {
        throw new NotFoundException(`Item Category with ID '${dto.category_id}' not found.`);
      }
    }

    // Only a genuine change is held to the master. Seed and demo scripts write
    // item_type straight into item_master (e.g. BY_PRODUCT, which no tenant has
    // in item_type_master), and the console resends every field on edit — so
    // validating an unchanged value would make such a row impossible to edit.
    if (dto.item_type !== undefined && dto.item_type !== item.item_type) {
      await this.assertItemTypeExists(dto.item_type, tenantId, item.company_id);
    }

    if (dto.item_code && dto.item_code.toUpperCase() !== item.item_code) {
      throw new ConflictException('Item Code is generated from the company-wide ITEM sequence and cannot be changed.');
    }

    const effectiveItemType = dto.item_type ?? item.item_type;
    const effectiveWithdrawalDays = dto.withdrawal_days !== undefined ? dto.withdrawal_days : item.withdrawal_days;
    this.assertWithdrawalDays(effectiveItemType, effectiveWithdrawalDays);

    const effectiveValuationMethod = dto.valuation_method !== undefined ? dto.valuation_method : item.valuation_method;
    const effectiveStandardCost = dto.standard_cost !== undefined ? dto.standard_cost : (item.standard_cost != null ? Number(item.standard_cost) : null);
    this.assertStandardCost(effectiveValuationMethod, effectiveStandardCost);

    const effectiveIsLotTracked = dto.is_lot_tracked !== undefined ? dto.is_lot_tracked : item.is_lot_tracked;
    const effectiveIsSerialTracked = dto.is_serial_tracked !== undefined ? dto.is_serial_tracked : item.is_serial_tracked;
    const effectiveTrackingSeriesId = dto.tracking_series_id !== undefined ? dto.tracking_series_id : item.tracking_series_id;
    this.assertTrackingSeries(effectiveIsLotTracked, effectiveIsSerialTracked, effectiveTrackingSeriesId);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.item_name !== undefined) updates.item_name = dto.item_name;
    if (dto.item_type !== undefined) updates.item_type = dto.item_type;
    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;
    if (dto.category_id !== undefined) updates.category_id = dto.category_id;
    if (dto.sub_category !== undefined) updates.sub_category = dto.sub_category;
    if (dto.uom_primary !== undefined) updates.uom_primary = dto.uom_primary;
    if (dto.uom_secondary !== undefined) updates.uom_secondary = dto.uom_secondary;
    if (dto.uom_conversion_factor !== undefined) updates.uom_conversion_factor = dto.uom_conversion_factor?.toString() || null;
    if (dto.valuation_method !== undefined) updates.valuation_method = dto.valuation_method;
    if (dto.posting_group !== undefined) updates.posting_group = dto.posting_group;
    if (dto.standard_cost !== undefined) updates.standard_cost = dto.standard_cost?.toString() || null;
    if (dto.is_lot_tracked !== undefined) updates.is_lot_tracked = dto.is_lot_tracked;
    if (dto.is_serial_tracked !== undefined) updates.is_serial_tracked = dto.is_serial_tracked;
    if (dto.tracking_series_id !== undefined) updates.tracking_series_id = dto.tracking_series_id;
    // Switching tracking off takes the series with it. A series left standing on
    // an untracked item reads as configuration still in force, and whoever turns
    // tracking back on inherits a choice nobody made on this visit.
    if (!effectiveIsLotTracked && !effectiveIsSerialTracked) updates.tracking_series_id = null;
    if (dto.is_biological_asset !== undefined) updates.is_biological_asset = dto.is_biological_asset;
    if (dto.is_biological_costing_method !== undefined) updates.is_biological_costing_method = dto.is_biological_costing_method;
    if (dto.is_inventoriable !== undefined) updates.is_inventoriable = dto.is_inventoriable;
    if (dto.min_stock_level !== undefined) updates.min_stock_level = dto.min_stock_level?.toString() || null;
    if (dto.max_stock_level !== undefined) updates.max_stock_level = dto.max_stock_level?.toString() || null;
    if (dto.reorder_level !== undefined) updates.reorder_level = dto.reorder_level?.toString() || null;
    if (dto.lead_time_days !== undefined) updates.lead_time_days = dto.lead_time_days;
    if (dto.shelf_life_days !== undefined) updates.shelf_life_days = dto.shelf_life_days;
    if (dto.storage_temp_min !== undefined) updates.storage_temp_min = dto.storage_temp_min?.toString() || null;
    if (dto.storage_temp_max !== undefined) updates.storage_temp_max = dto.storage_temp_max?.toString() || null;
    if (dto.withdrawal_days !== undefined) updates.withdrawal_days = dto.withdrawal_days;
    if (dto.is_qr_enabled !== undefined) updates.is_qr_enabled = dto.is_qr_enabled;
    if (dto.qr_trigger_event !== undefined) updates.qr_trigger_event = dto.qr_trigger_event;
    if (dto.item_image_url !== undefined) updates.item_image_url = dto.item_image_url;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.itemMaster)
        .set(updates)
        .where(eq(schema.itemMaster.item_id, id));

      await this.recordUomConversion(tx, {
        tenantId,
        companyId: item.company_id || null,
        fromUom: dto.uom_primary !== undefined ? dto.uom_primary : item.uom_primary,
        toUom: dto.uom_secondary !== undefined ? dto.uom_secondary : item.uom_secondary,
        factor: dto.uom_conversion_factor !== undefined ? dto.uom_conversion_factor : item.uom_conversion_factor,
        userId: userPayload?.userId,
      });

      if (dto.attributes) {
        // Drop existing attributes map
        await tx.delete(schema.itemAttributeValues).where(eq(schema.itemAttributeValues.item_id, id));

        // Insert new ones
        for (const attr of dto.attributes) {
          const [attrDef] = await tx
            .select()
            .from(schema.itemAttributeMaster)
            .where(and(eq(schema.itemAttributeMaster.attribute_id, attr.attribute_id), isNull(schema.itemAttributeMaster.deleted_at)))
            .limit(1);

          if (!attrDef) {
            throw new NotFoundException(`Attribute definition with ID '${attr.attribute_id}' not found.`);
          }

          await tx.insert(schema.itemAttributeValues).values({
            value_id: randomUUID(),
            item_id: id,
            attribute_id: attr.attribute_id,
            attribute_value: attr.attribute_value,
          });
        }
      }
    });

    await this.auditService.log({
      tenantId,
      companyId: item.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'item_master',
      entityId: id,
      oldValues: item,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const item = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.itemMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.itemMaster.item_id, id));

    await this.auditService.log({
      tenantId,
      companyId: item.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'item_master',
      entityId: id,
      oldValues: item,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Item '${item.item_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, id))
      .limit(1);

    if (!item) {
      throw new NotFoundException(`Item with ID '${id}' not found.`);
    }

    if (!item.deleted_at) {
      return item;
    }

    await this.db
      .update(schema.itemMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.itemMaster.item_id, id));

    await this.auditService.log({
      tenantId,
      companyId: item.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'item_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, getTableColumns, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { NoSeriesService } from '../no-series/no-series.service';
import { CreateItemDto, UpdateItemDto, QueryItemDto, CreateItemFromTemplateDto } from './dto/item.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

/** The item types a withdrawal period applies to. Every other type stores none. */
const carriesWithdrawal = (itemType?: string | null) => itemType === 'MEDICINE' || itemType === 'VACCINE';

@Injectable()
export class ItemService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly noSeriesService: NoSeriesService,
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
    if (carriesWithdrawal(itemType) && withdrawalDays == null) {
      throw new BadRequestException('Withdrawal Days is mandatory for Medicine and Vaccine items.');
    }
  }

  /** GL accounts must exist in synced Chart of Accounts (gl_account_master) */
  private async assertGlAccountExists(accountRef: string | null | undefined, tenantId: string, companyId: string | null, errorMsg: string) {
    if (!accountRef) return;
    const conditions: any[] = [
      eq(schema.glAccountMaster.tenant_id, tenantId),
      isNull(schema.glAccountMaster.deleted_at),
      or(
        eq(schema.glAccountMaster.gl_account_id, accountRef),
        eq(schema.glAccountMaster.account_code, accountRef),
      ),
    ];
    if (companyId) {
      conditions.push(
        or(
          eq(schema.glAccountMaster.company_id, companyId),
          isNull(schema.glAccountMaster.company_id),
        )!,
      );
    }
    const [acc] = await this.db
      .select({ id: schema.glAccountMaster.gl_account_id })
      .from(schema.glAccountMaster)
      .where(and(...conditions))
      .limit(1);
    if (!acc) {
      throw new BadRequestException(errorMsg);
    }
  }

  /**
   * The series has to be one that issues the kind of number the item is
   * tracked by. The form filters the picker by ?documentType=LOT / SERIAL; this
   * is the same rule for a caller that does not use the form, so a lot-tracked
   * item cannot point at the BREED series.
   */
  private async assertTrackingSeriesKind(isLotTracked?: boolean | null, isSerialTracked?: boolean | null, trackingSeriesId?: string | null) {
    if (!trackingSeriesId || (!isLotTracked && !isSerialTracked)) return;
    const expected = isLotTracked ? 'LOT' : 'SERIAL';
    const [series] = await this.db
      .select({ document_type: schema.noSeriesMaster.document_type })
      .from(schema.noSeriesMaster)
      .where(and(eq(schema.noSeriesMaster.series_id, trackingSeriesId), isNull(schema.noSeriesMaster.deleted_at)))
      .limit(1);
    if (!series) {
      const [modernSeries] = await this.db
        .select({ id: schema.noSeries.id })
        .from(schema.noSeries)
        .where(eq(schema.noSeries.id, trackingSeriesId))
        .limit(1);
      if (!modernSeries) {
        throw new NotFoundException(`Number Series '${trackingSeriesId}' not found.`);
      }
      return;
    }
    if (series.document_type !== expected) {
      throw new BadRequestException(`A ${expected === 'LOT' ? 'lot' : 'serial'}-tracked item needs a ${expected} number series.`);
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
      throw new BadRequestException('Item Tracking No. Series is required when Item Tracking is LOT or SERIAL.');
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
    await this.assertTrackingSeriesKind(dto.is_lot_tracked, dto.is_serial_tracked, dto.tracking_series_id);

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
      // Medicines and vaccines only (2026-09-15); anything sent for another type is dropped.
      withdrawal_days: carriesWithdrawal(dto.item_type) ? dto.withdrawal_days ?? null : null,
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
   * Generates next item number atomically from linked No. Series and creates draft item.
   */
  async createFromTemplate(dto: CreateItemFromTemplateDto, tenantId: string, companyId: string | null, userPayload?: any) {
    const effectiveCompanyId = dto.company_id || companyId || null;

    // 1. Verify template exists and is active
    const [template] = await this.db
      .select()
      .from(schema.itemTemplate)
      .where(eq(schema.itemTemplate.id, dto.template_id))
      .limit(1);

    if (!template) {
      throw new NotFoundException(`Item Template with ID '${dto.template_id}' not found.`);
    }

    if (!template.is_active) {
      throw new BadRequestException('Item Template is inactive.');
    }

    if (!template.no_series_id) {
      throw new BadRequestException('No. Series is mandatory on Item Template.');
    }

    // 2. Preview next item number without advancing last_no_used (increments only upon item save)
    let currentNumberInfo = this.noSeriesService.previewNextNumber
      ? await this.noSeriesService.previewNextNumber(template.no_series_id)
      : await this.noSeriesService.generateNextNumber(template.no_series_id, tenantId, effectiveCompanyId);

    let next_number = currentNumberInfo.next_number;
    let series = currentNumberInfo.series;

    // 3. Ensure next_number is free of stale drafts or advances past existing active items
    let attempts = 0;
    while (attempts < 50) {
      attempts++;
      const [existingCode] = await this.db
        .select()
        .from(schema.itemMaster)
        .where(and(
          eq(schema.itemMaster.tenant_id, tenantId),
          eq(schema.itemMaster.item_code, next_number),
          effectiveCompanyId ? eq(schema.itemMaster.company_id, effectiveCompanyId) : isNull(schema.itemMaster.company_id),
        ))
        .limit(1);

      if (!existingCode) {
        break;
      }

      // If it's an uncompleted draft or soft-deleted draft, delete the stale draft to reuse this number
      if (!existingCode.item_name || !existingCode.item_name.trim() || existingCode.status === 'DRAFT' || existingCode.deleted_at) {
        await this.db.delete(schema.itemMaster).where(eq(schema.itemMaster.item_id, existingCode.item_id));
        break;
      }

      // If an active item already exists with this code (e.g. series out of sync), advance the series
      if (this.noSeriesService.recordNumberUsed) {
        await this.noSeriesService.recordNumberUsed(template.no_series_id, next_number);
      }
      currentNumberInfo = this.noSeriesService.previewNextNumber
        ? await this.noSeriesService.previewNextNumber(template.no_series_id)
        : await this.noSeriesService.generateNextNumber(template.no_series_id, tenantId, effectiveCompanyId);
      next_number = currentNumberInfo.next_number;
      series = currentNumberInfo.series;
    }

    const itemId = randomUUID();
    const draftItem = {
      item_id: itemId,
      tenant_id: tenantId,
      company_id: effectiveCompanyId,
      item_template_id: template.id,
      item_code: next_number,
      item_name: '',
      uom_primary: '',
      item_type: template.item_type || 'SUPPLY',
      category_id: template.category || null,
      sub_category: template.sub_category || null,
      valuation_method: template.valuation_method || null,
      posting_group: template.item_type || 'SUPPLY',
      is_lot_tracked: template.item_tracking === 'LOT',
      is_serial_tracked: template.item_tracking === 'SERIAL',
      tracking_series_id: template.item_tracking_no_series_id || null,
      is_inventoriable: template.inventory_type !== 'NON_INVENTORY',
      is_qr_enabled: template.qr_code_enabled ?? false,
      inventory_gl_account: template.inventory_gl_account || null,
      cogs_gl_account: template.cogs_gl_account || null,
      is_active: false,
      status: 'DRAFT',
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.itemMaster).values(draftItem);

    await this.auditService.log({
      tenantId,
      companyId: effectiveCompanyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_master',
      entityId: itemId,
      newValues: draftItem,
    });

    return {
      item_id: itemId,
      item_no: next_number,
      item_code: next_number,
      item_template_id: template.id,
      template_code: template.template_code,
      template_description: template.template_description,
      item_type: template.item_type,
      category: template.category,
      sub_category: template.sub_category,
      valuation_method: template.valuation_method,
      item_tracking: template.item_tracking,
      item_tracking_no_series_id: template.item_tracking_no_series_id,
      inventory_type: template.inventory_type,
      qr_code_enabled: template.qr_code_enabled,
      inventory_gl_account: template.inventory_gl_account,
      cogs_gl_account: template.cogs_gl_account,
      manual_nos: series.manual_nos ?? false,
      status: 'DRAFT',
    };
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

    const filter = { ...(query.filter || {}) };
    const templateFilter = filter['template_code'] || query.templateCode;
    delete filter['template_code'];

    if (query.itemTemplateId) {
      conditions.push(eq(schema.itemMaster.item_template_id, query.itemTemplateId));
    }

    if (templateFilter) {
      if (typeof templateFilter === 'string' && templateFilter.includes('*')) {
        conditions.push(like(schema.itemTemplate.template_code, `%${templateFilter.replace(/\*/g, '')}%`));
      } else if (typeof templateFilter === 'string') {
        conditions.push(like(schema.itemTemplate.template_code, `%${templateFilter}%`));
      }
    }

    conditions.push(...listFilterConditions(schema.itemMaster, filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const data = await this.db
      .select({
        ...getTableColumns(schema.itemMaster),
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
        template_code: schema.itemTemplate.template_code,
      })
      .from(schema.itemMaster)
      .leftJoin(
        schema.itemCategoryMaster,
        eq(schema.itemCategoryMaster.category_id, schema.itemMaster.category_id),
      )
      .leftJoin(
        schema.itemTemplate,
        eq(schema.itemTemplate.id, schema.itemMaster.item_template_id),
      )
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.itemMaster, query, schema.itemMaster.item_code))
      .limit(limit)
      .offset(offset);

    const [counted] = await this.db
      .select({ total: count() })
      .from(schema.itemMaster)
      .leftJoin(
        schema.itemTemplate,
        eq(schema.itemTemplate.id, schema.itemMaster.item_template_id),
      )
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

    if (dto.item_type !== undefined && dto.item_type !== item.item_type) {
      await this.assertItemTypeExists(dto.item_type, tenantId, item.company_id);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.item_code && dto.item_code.trim() !== item.item_code) {
      let allowManual = false;
      if (item.item_template_id) {
        const [tmpl] = await this.db
          .select({ manual_nos: schema.noSeries.manual_nos })
          .from(schema.itemTemplate)
          .innerJoin(schema.noSeries, eq(schema.itemTemplate.no_series_id, schema.noSeries.id))
          .where(eq(schema.itemTemplate.id, item.item_template_id))
          .limit(1);
        if (tmpl?.manual_nos) {
          allowManual = true;
        }
      }
      if (!allowManual) {
        throw new ConflictException('Item Code is generated from the company-wide ITEM sequence and cannot be changed.');
      } else {
        const [dup] = await this.db
          .select({ id: schema.itemMaster.item_id })
          .from(schema.itemMaster)
          .where(and(
            eq(schema.itemMaster.tenant_id, tenantId),
            eq(schema.itemMaster.item_code, dto.item_code.trim()),
            isNull(schema.itemMaster.deleted_at),
            item.company_id ? eq(schema.itemMaster.company_id, item.company_id) : isNull(schema.itemMaster.company_id),
          ))
          .limit(1);
        if (dup && dup.id !== id) {
          throw new ConflictException(`Generated item code [${dto.item_code.trim()}] already exists. Check No. Series Last No. Used.`);
        }
        updates.item_code = dto.item_code.trim();
      }
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
    if (dto.tracking_series_id !== undefined || dto.is_lot_tracked !== undefined || dto.is_serial_tracked !== undefined) {
      await this.assertTrackingSeriesKind(effectiveIsLotTracked, effectiveIsSerialTracked, effectiveTrackingSeriesId);
    }

    // Chart of Accounts validation
    const effectiveInventoryGl = dto.inventory_gl_account !== undefined ? dto.inventory_gl_account : item.inventory_gl_account;
    if (effectiveInventoryGl) {
      await this.assertGlAccountExists(effectiveInventoryGl, tenantId, item.company_id, 'Inventory GL Account not found in Chart of Accounts.');
    }

    const effectiveCogsGl = dto.cogs_gl_account !== undefined ? dto.cogs_gl_account : item.cogs_gl_account;
    if (effectiveCogsGl) {
      await this.assertGlAccountExists(effectiveCogsGl, tenantId, item.company_id, 'COGS GL Account not found in Chart of Accounts.');
    }

    // Required fields when saving or activating a draft item
    if (item.status === 'DRAFT' || dto.status === 'ACTIVE') {
      const effectiveName = dto.item_name !== undefined ? dto.item_name : item.item_name;
      if (!effectiveName || !effectiveName.trim()) {
        throw new BadRequestException('Item Description is mandatory.');
      }

      const effectiveUom = dto.uom_primary !== undefined ? dto.uom_primary : item.uom_primary;
      if (!effectiveUom || !effectiveUom.trim()) {
        throw new BadRequestException('Unit of Measure is mandatory.');
      }

      if (item.status === 'DRAFT' && dto.status === undefined) {
        updates.status = 'ACTIVE';
        updates.is_active = true;
      }
    }

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
    // Only a medicine or vaccine carries one. An item re-typed away from those
    // loses it, rather than keeping a slaughter block nothing shows any more.
    if (!carriesWithdrawal(effectiveItemType)) updates.withdrawal_days = null;
    if (dto.is_qr_enabled !== undefined) updates.is_qr_enabled = dto.is_qr_enabled;
    if (dto.qr_trigger_event !== undefined) updates.qr_trigger_event = dto.qr_trigger_event;
    if (dto.item_image_url !== undefined) updates.item_image_url = dto.item_image_url;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.item_template_id !== undefined) updates.item_template_id = dto.item_template_id;
    if (dto.inventory_gl_account !== undefined) updates.inventory_gl_account = dto.inventory_gl_account;
    if (dto.cogs_gl_account !== undefined) updates.cogs_gl_account = dto.cogs_gl_account;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    const willBeActive = updates.status === 'ACTIVE' || (item.status === 'DRAFT' && dto.status === 'ACTIVE');
    if (willBeActive && item.status === 'DRAFT') {
      const templateId = dto.item_template_id || item.item_template_id;
      if (templateId) {
        const [template] = await this.db
          .select({ no_series_id: schema.itemTemplate.no_series_id })
          .from(schema.itemTemplate)
          .where(eq(schema.itemTemplate.id, templateId))
          .limit(1);
        if (template?.no_series_id && this.noSeriesService?.recordNumberUsed) {
          await this.noSeriesService.recordNumberUsed(template.no_series_id, updates.item_code || item.item_code);
        }
      }
    }

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
    const item = await this.findOne(id, true);

    // If this was an uncompleted draft, hard delete it so it frees up the item code
    if (item.status === 'DRAFT' || !item.item_name || !item.item_name.trim()) {
      await this.db.delete(schema.itemMaster).where(eq(schema.itemMaster.item_id, id));
      return { success: true, message: 'Draft discarded.' };
    }

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
      oldValues: item,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateItemTemplateDto, UpdateItemTemplateDto } from './dto/item-template.dto';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ItemTemplateService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateItemTemplateDto, tenantId?: string, companyId?: string | null) {
    if (!dto.no_series_id) {
      throw new BadRequestException('No. Series is mandatory on Item Template.');
    }

    if (
      (dto.item_tracking === 'LOT' || dto.item_tracking === 'SERIAL') &&
      !dto.item_tracking_no_series_id
    ) {
      throw new BadRequestException('Item Tracking No. Series is required when Item Tracking is LOT or SERIAL.');
    }

    // Verify linked primary No. Series exists
    const [noSeries] = await this.db
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.id, dto.no_series_id))
      .limit(1);

    if (!noSeries) {
      throw new NotFoundException(`No. Series with ID '${dto.no_series_id}' not found.`);
    }

    // Verify linked tracking No. Series exists (if specified)
    if (dto.item_tracking_no_series_id) {
      const [trackingSeries] = await this.db
        .select()
        .from(schema.noSeries)
        .where(eq(schema.noSeries.id, dto.item_tracking_no_series_id))
        .limit(1);

      if (!trackingSeries) {
        throw new NotFoundException(`Item Tracking No. Series with ID '${dto.item_tracking_no_series_id}' not found.`);
      }
    }

    // Check unique template_code
    const existing = await this.db
      .select()
      .from(schema.itemTemplate)
      .where(eq(schema.itemTemplate.template_code, dto.template_code))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Item Template with code '${dto.template_code}' already exists.`);
    }

    const id = randomUUID();
    const newRecord = {
      id,
      tenant_id: tenantId || null,
      company_id: dto.company_id || companyId || null,
      template_code: dto.template_code,
      template_description: dto.template_description || null,
      no_series_id: dto.no_series_id,
      item_type: dto.item_type || null,
      category: dto.category || null,
      sub_category: dto.sub_category || null,
      valuation_method: dto.valuation_method || null,
      item_tracking: dto.item_tracking || 'NONE',
      item_tracking_no_series_id: dto.item_tracking_no_series_id || null,
      inventory_type: dto.inventory_type || 'INVENTORY',
      qr_code_enabled: dto.qr_code_enabled ?? false,
      inventory_gl_account: dto.inventory_gl_account || null,
      cogs_gl_account: dto.cogs_gl_account || null,
      is_active: dto.is_active ?? true,
      created_at: toMysqlTimestamp(),
      updated_at: toMysqlTimestamp(),
    };

    await this.db.insert(schema.itemTemplate).values(newRecord);
    return this.findOne(id);
  }

  async findAll(tenantId?: string, companyId?: string | null) {
    const conditions: SQL[] = [];

    if (tenantId) {
      conditions.push(
        or(
          eq(schema.itemTemplate.tenant_id, tenantId),
          isNull(schema.itemTemplate.tenant_id),
        )!,
      );
    }

    if (companyId) {
      conditions.push(
        or(
          eq(schema.itemTemplate.company_id, companyId),
          isNull(schema.itemTemplate.company_id),
        )!,
      );
    }

    const query = this.db
      .select({
        id: schema.itemTemplate.id,
        template_code: schema.itemTemplate.template_code,
        template_description: schema.itemTemplate.template_description,
        item_type: schema.itemTemplate.item_type,
        category: schema.itemTemplate.category,
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
        sub_category: schema.itemTemplate.sub_category,
        valuation_method: schema.itemTemplate.valuation_method,
        item_tracking: schema.itemTemplate.item_tracking,
        item_tracking_no_series_id: schema.itemTemplate.item_tracking_no_series_id,
        inventory_type: schema.itemTemplate.inventory_type,
        qr_code_enabled: schema.itemTemplate.qr_code_enabled,
        inventory_gl_account: schema.itemTemplate.inventory_gl_account,
        cogs_gl_account: schema.itemTemplate.cogs_gl_account,
        is_active: schema.itemTemplate.is_active,
        no_series_id: schema.itemTemplate.no_series_id,
        no_series_code: schema.noSeries.code,
        no_series_prefix: schema.noSeries.no_series_code,
        no_series_description: schema.noSeries.description,
        manual_nos: schema.noSeries.manual_nos,
        no_series_blocked: schema.noSeries.blocked,
      })
      .from(schema.itemTemplate)
      .innerJoin(
        schema.noSeries,
        eq(schema.itemTemplate.no_series_id, schema.noSeries.id),
      );

    return conditions.length > 0
      ? query
          .leftJoin(
            schema.itemCategoryMaster,
            eq(schema.itemTemplate.category, schema.itemCategoryMaster.category_id),
          )
          .where(and(...conditions))
      : query.leftJoin(
          schema.itemCategoryMaster,
          eq(schema.itemTemplate.category, schema.itemCategoryMaster.category_id),
        );
  }

  /**
   * Return active Item Templates for the selection popup.
   * Only is_active = true.
   * Return: template_code, template_description, item_type, no_series code and description, valuation_method.
   */
  async findAllActive(tenantId?: string, companyId?: string | null) {
    const conditions = [eq(schema.itemTemplate.is_active, true)];

    if (tenantId) {
      conditions.push(
        or(
          eq(schema.itemTemplate.tenant_id, tenantId),
          isNull(schema.itemTemplate.tenant_id),
        )!,
      );
    }

    if (companyId) {
      conditions.push(
        or(
          eq(schema.itemTemplate.company_id, companyId),
          isNull(schema.itemTemplate.company_id),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: schema.itemTemplate.id,
        template_code: schema.itemTemplate.template_code,
        template_description: schema.itemTemplate.template_description,
        item_type: schema.itemTemplate.item_type,
        category: schema.itemTemplate.category,
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
        sub_category: schema.itemTemplate.sub_category,
        valuation_method: schema.itemTemplate.valuation_method,
        item_tracking: schema.itemTemplate.item_tracking,
        item_tracking_no_series_id: schema.itemTemplate.item_tracking_no_series_id,
        inventory_type: schema.itemTemplate.inventory_type,
        qr_code_enabled: schema.itemTemplate.qr_code_enabled,
        inventory_gl_account: schema.itemTemplate.inventory_gl_account,
        cogs_gl_account: schema.itemTemplate.cogs_gl_account,
        is_active: schema.itemTemplate.is_active,
        no_series_id: schema.itemTemplate.no_series_id,
        no_series_code: schema.noSeries.code,
        no_series_prefix: schema.noSeries.no_series_code,
        no_series_description: schema.noSeries.description,
        manual_nos: schema.noSeries.manual_nos,
        no_series_blocked: schema.noSeries.blocked,
      })
      .from(schema.itemTemplate)
      .innerJoin(
        schema.noSeries,
        eq(schema.itemTemplate.no_series_id, schema.noSeries.id),
      )
      .leftJoin(
        schema.itemCategoryMaster,
        eq(schema.itemTemplate.category, schema.itemCategoryMaster.category_id),
      )
      .where(and(...conditions));

    return rows;
  }

  async findOne(id: string) {
    const [template] = await this.db
      .select({
        id: schema.itemTemplate.id,
        template_code: schema.itemTemplate.template_code,
        template_description: schema.itemTemplate.template_description,
        item_type: schema.itemTemplate.item_type,
        category: schema.itemTemplate.category,
        category_code: schema.itemCategoryMaster.category_code,
        category_name: schema.itemCategoryMaster.category_name,
        sub_category: schema.itemTemplate.sub_category,
        valuation_method: schema.itemTemplate.valuation_method,
        item_tracking: schema.itemTemplate.item_tracking,
        item_tracking_no_series_id: schema.itemTemplate.item_tracking_no_series_id,
        inventory_type: schema.itemTemplate.inventory_type,
        qr_code_enabled: schema.itemTemplate.qr_code_enabled,
        inventory_gl_account: schema.itemTemplate.inventory_gl_account,
        cogs_gl_account: schema.itemTemplate.cogs_gl_account,
        is_active: schema.itemTemplate.is_active,
        no_series_id: schema.itemTemplate.no_series_id,
        no_series_code: schema.noSeries.code,
        no_series_prefix: schema.noSeries.no_series_code,
        no_series_description: schema.noSeries.description,
        manual_nos: schema.noSeries.manual_nos,
        no_series_blocked: schema.noSeries.blocked,
      })
      .from(schema.itemTemplate)
      .innerJoin(
        schema.noSeries,
        eq(schema.itemTemplate.no_series_id, schema.noSeries.id),
      )
      .leftJoin(
        schema.itemCategoryMaster,
        eq(schema.itemTemplate.category, schema.itemCategoryMaster.category_id),
      )
      .where(eq(schema.itemTemplate.id, id))
      .limit(1);

    if (!template) {
      throw new NotFoundException(`Item Template with ID '${id}' not found.`);
    }

    return template;
  }

  async update(id: string, dto: UpdateItemTemplateDto) {
    const existing = await this.findOne(id);

    const effectiveTracking = dto.item_tracking ?? existing.item_tracking;
    const effectiveTrackingSeries = dto.item_tracking_no_series_id !== undefined ? dto.item_tracking_no_series_id : existing.item_tracking_no_series_id;

    if ((effectiveTracking === 'LOT' || effectiveTracking === 'SERIAL') && !effectiveTrackingSeries) {
      throw new BadRequestException('Item Tracking No. Series is required when Item Tracking is LOT or SERIAL.');
    }

    if (dto.no_series_id) {
      const [noSeries] = await this.db
        .select()
        .from(schema.noSeries)
        .where(eq(schema.noSeries.id, dto.no_series_id))
        .limit(1);

      if (!noSeries) {
        throw new NotFoundException(`No. Series with ID '${dto.no_series_id}' not found.`);
      }
    }

    const updates: Partial<typeof schema.itemTemplate.$inferInsert> = {
      updated_at: toMysqlTimestamp() as any,
    };

    if (dto.template_description !== undefined) updates.template_description = dto.template_description;
    if (dto.no_series_id !== undefined) updates.no_series_id = dto.no_series_id;
    if (dto.item_type !== undefined) updates.item_type = dto.item_type;
    if (dto.category !== undefined) updates.category = dto.category;
    if (dto.sub_category !== undefined) updates.sub_category = dto.sub_category;
    if (dto.valuation_method !== undefined) updates.valuation_method = dto.valuation_method;
    if (dto.item_tracking !== undefined) updates.item_tracking = dto.item_tracking;
    if (dto.item_tracking_no_series_id !== undefined) updates.item_tracking_no_series_id = dto.item_tracking_no_series_id;
    if (dto.inventory_type !== undefined) updates.inventory_type = dto.inventory_type;
    if (dto.qr_code_enabled !== undefined) updates.qr_code_enabled = dto.qr_code_enabled;
    if (dto.inventory_gl_account !== undefined) updates.inventory_gl_account = dto.inventory_gl_account;
    if (dto.cogs_gl_account !== undefined) updates.cogs_gl_account = dto.cogs_gl_account;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    await this.db.update(schema.itemTemplate).set(updates).where(eq(schema.itemTemplate.id, id));
    return this.findOne(id);
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.db.delete(schema.itemTemplate).where(eq(schema.itemTemplate.id, id));
    return { id };
  }
}

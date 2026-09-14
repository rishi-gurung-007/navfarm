import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateItemCategoryDto, UpdateItemCategoryDto, QueryItemCategoryDto } from './dto/item-category.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { generateCompositeCode } from '../../system/number-series/composite-code.util';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ItemCategoryService {
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

  async create(dto: CreateItemCategoryDto, tenantId: string, userPayload?: any) {
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

    // 2. Verify parent category exists (if provided)
    const parent = dto.parent_category_id ? await this.findOne(dto.parent_category_id) : undefined;

    // 3. Item categories carry no type dimension of their own — resolve the master-alone series.
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('ITEM_CATEGORY', null, tenantId, companyId);

    if (!seriesCode) {
      return this.createManual(dto, tenantId, companyId, userPayload);
    }

    const categoryId = randomUUID();
    const attempt = () => this.db.transaction((tx) => this.createAutoRecord(tx, {
      dto, tenantId, companyId, seriesCode, parent, categoryId, userPayload,
    }));

    let newCategory: Awaited<ReturnType<typeof this.createAutoRecord>>;
    try {
      newCategory = await attempt();
    } catch (err) {
      if ((err as { code?: string })?.code !== 'ER_DUP_ENTRY') throw err;
      try {
        newCategory = await attempt();
      } catch (retryErr) {
        if ((retryErr as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('Category code collided with a concurrently created category; please retry.');
        }
        throw retryErr;
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_category_master',
      entityId: categoryId,
      newValues: newCategory,
    });

    return this.findOne(categoryId);
  }

  /** No series configured for ITEM_CATEGORY — manual entry, exactly as before this feature existed. */
  private async createManual(dto: CreateItemCategoryDto, tenantId: string, companyId: string | null, userPayload?: any) {
    if (!dto.category_code) {
      throw new BadRequestException('category_code is required — no number series is configured for item categories.');
    }

    const duplicateConditions = [
      eq(schema.itemCategoryMaster.tenant_id, tenantId),
      eq(schema.itemCategoryMaster.category_code, dto.category_code.toUpperCase()),
      isNull(schema.itemCategoryMaster.deleted_at),
    ];
    if (companyId) {
      duplicateConditions.push(eq(schema.itemCategoryMaster.company_id, companyId));
    } else {
      duplicateConditions.push(isNull(schema.itemCategoryMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.itemCategoryMaster)
      .where(and(...duplicateConditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Item category with code '${dto.category_code}' already exists in this scope.`);
    }

    const categoryId = randomUUID();
    const newCategory = {
      category_id: categoryId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: companyId,
      category_code: dto.category_code.toUpperCase(),
      category_name: dto.category_name,
      parent_category_id: dto.parent_category_id || null,
      item_type: dto.item_type || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.itemCategoryMaster).values(newCategory);

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'item_category_master',
      entityId: categoryId,
      newValues: newCategory,
    });

    return this.findOne(categoryId);
  }

  /**
   * Builds and inserts the category row (generating its code inside `tx`), for
   * the case a series IS configured. Split out so create()'s retry can re-run
   * the whole attempt, unmodified, if the insert collides on
   * uq_item_category_master_tenant_company_code — mirrors location.service.ts.
   */
  private async createAutoRecord(
    tx: MySql2Database<typeof schema>,
    params: {
      dto: CreateItemCategoryDto;
      tenantId: string;
      companyId: string | null;
      seriesCode: string;
      parent: typeof schema.itemCategoryMaster.$inferSelect | undefined;
      categoryId: string;
      userPayload?: any;
    },
  ) {
    const { dto, tenantId, companyId, seriesCode, parent, categoryId, userPayload } = params;

    // Locks the series row for the duration of code generation + this insert —
    // also the row that carries allow_manual, so a user-supplied code can win
    // when the series explicitly permits it.
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId, tx);

    let categoryCode: string;
    if (series.allow_manual && dto.category_code) {
      categoryCode = dto.category_code.toUpperCase();
    } else if (parent) {
      categoryCode = await generateCompositeCode({
        parentCode: parent.category_code,
        prefix: series.prefix || seriesCode,
        seqLength: series.seq_length,
        fetchSiblingCodes: () => tx
          .select({ code: schema.itemCategoryMaster.category_code })
          .from(schema.itemCategoryMaster)
          .where(and(
            eq(schema.itemCategoryMaster.tenant_id, tenantId),
            eq(schema.itemCategoryMaster.parent_category_id, parent.category_id),
          )),
      });
    } else {
      categoryCode = await this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, tx, dto as unknown as Record<string, unknown>);
    }

    if (categoryCode.length > 255) {
      throw new BadRequestException(
        `Category code would exceed 255 characters ('${categoryCode}', ${categoryCode.length} characters).`,
      );
    }

    const newCategory = {
      category_id: categoryId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: companyId,
      category_code: categoryCode,
      category_name: dto.category_name,
      parent_category_id: dto.parent_category_id || null,
      item_type: dto.item_type || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await tx.insert(schema.itemCategoryMaster).values(newCategory);
    return newCategory;
  }

  async findOne(id: string) {
    const [category] = await this.db
      .select()
      .from(schema.itemCategoryMaster)
      .where(and(eq(schema.itemCategoryMaster.category_id, id), isNull(schema.itemCategoryMaster.deleted_at)))
      .limit(1);

    if (!category) {
      throw new NotFoundException(`Item Category with ID '${id}' not found.`);
    }

    return category;
  }

  async findAll(query: QueryItemCategoryDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.itemCategoryMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.itemCategoryMaster, query.companyId));
    if (query.parentCategoryId) {
      conditions.push(eq(schema.itemCategoryMaster.parent_category_id, query.parentCategoryId));
    }
    // A category picker should offer categories, not sub-categories. Without
    // this the Item form's Category dropdown listed FEED-STARTER and
    // MED-VACCINE alongside their own parents.
    if (query.rootOnly) {
      conditions.push(isNull(schema.itemCategoryMaster.parent_category_id));
    }
    if (query.itemType) {
      conditions.push(eq(schema.itemCategoryMaster.item_type, query.itemType));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.itemCategoryMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.itemCategoryMaster.category_code, `%${query.search}%`),
          like(schema.itemCategoryMaster.category_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.itemCategoryMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.itemCategoryMaster, conditions, query, schema.itemCategoryMaster.category_code);
  }

  async update(id: string, dto: UpdateItemCategoryDto, tenantId: string, userPayload?: any) {
    const category = await this.findOne(id);

    if (dto.parent_category_id) {
      if (dto.parent_category_id === id) {
        throw new ConflictException(`Category cannot be parent of itself.`);
      }
      await this.findOne(dto.parent_category_id);
    }

    if (dto.category_code && dto.category_code.toUpperCase() !== category.category_code) {
      const duplicateConditions = [
        eq(schema.itemCategoryMaster.tenant_id, tenantId),
        eq(schema.itemCategoryMaster.category_code, dto.category_code.toUpperCase()),
        ne(schema.itemCategoryMaster.category_id, id),
        isNull(schema.itemCategoryMaster.deleted_at),
      ];
      const targetCompanyId = category.company_id;
      if (targetCompanyId) {
        duplicateConditions.push(eq(schema.itemCategoryMaster.company_id, targetCompanyId));
      } else {
        duplicateConditions.push(isNull(schema.itemCategoryMaster.company_id));
      }

      const existing = await this.db
        .select()
        .from(schema.itemCategoryMaster)
        .where(and(...duplicateConditions))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Item category with code '${dto.category_code}' already exists in this scope.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.parent_category_id !== undefined) updates.parent_category_id = dto.parent_category_id;
    if (dto.item_type !== undefined) updates.item_type = dto.item_type;
    if (dto.category_code !== undefined) updates.category_code = dto.category_code.toUpperCase();
    if (dto.category_name !== undefined) updates.category_name = dto.category_name;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.itemCategoryMaster)
      .set(updates)
      .where(eq(schema.itemCategoryMaster.category_id, id));

    await this.auditService.log({
      tenantId,
      companyId: category.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'item_category_master',
      entityId: id,
      oldValues: category,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const category = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.itemCategoryMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.itemCategoryMaster.category_id, id));

    await this.auditService.log({
      tenantId,
      companyId: category.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'item_category_master',
      entityId: id,
      oldValues: category,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Item Category '${category.category_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [category] = await this.db
      .select()
      .from(schema.itemCategoryMaster)
      .where(eq(schema.itemCategoryMaster.category_id, id))
      .limit(1);

    if (!category) {
      throw new NotFoundException(`Item Category with ID '${id}' not found.`);
    }

    if (!category.deleted_at) {
      return category;
    }

    await this.db
      .update(schema.itemCategoryMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.itemCategoryMaster.category_id, id));

    await this.auditService.log({
      tenantId,
      companyId: category.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'item_category_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateFeedFormulaDto, UpdateFeedFormulaDto, QueryFeedFormulaDto } from './dto/feed-formula.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class FeedFormulaService {
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

  /** Feed formulas carry no type dimension of their own — resolves the master-alone series. */
  private async resolveFormulaCode(dto: CreateFeedFormulaDto, tenantId: string): Promise<string> {
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('FEED_FORMULA', null, tenantId, dto.company_id);
    if (!seriesCode) {
      if (!dto.formula_code) {
        throw new BadRequestException('formula_code is required — no number series is configured for feed formulas.');
      }
      return dto.formula_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, dto.company_id);
    if (series.allow_manual && dto.formula_code) {
      return dto.formula_code.toUpperCase();
    }
    return this.numberSeriesService.generateNext(seriesCode, tenantId, dto.company_id, undefined, dto as unknown as Record<string, unknown>);
  }

  async create(dto: CreateFeedFormulaDto, tenantId: string, userPayload?: any) {
    if (!dto.ingredients || dto.ingredients.length === 0) {
      throw new BadRequestException('A feed formula must contain at least one ingredient.');
    }

    // 1. Verify company exists
    if (dto.company_id) {
      const [company] = await this.db
        .select()
        .from(schema.companyMaster)
        .where(and(companyCondition(schema.companyMaster.company_id, dto.company_id), isNull(schema.companyMaster.deleted_at)))
        .limit(1);

      if (!company) {
        throw new NotFoundException(`Company with ID '${dto.company_id}' not found.`);
      }
    }

    // 2. Verify target item exists
    const [targetItem] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, dto.target_item_id), isNull(schema.itemMaster.deleted_at)))
      .limit(1);

    if (!targetItem) {
      throw new NotFoundException(`Target produced Item with ID '${dto.target_item_id}' not found.`);
    }

    // 3. Resolve the formula code — a series if one is configured, else the user-supplied code.
    const formulaCode = await this.resolveFormulaCode(dto, tenantId);

    // 4. Verify unique formula code per company
    const existing = await this.db
      .select()
      .from(schema.feedFormulaMaster)
      .where(
        and(
          eq(schema.feedFormulaMaster.tenant_id, tenantId),
          companyCondition(schema.feedFormulaMaster.company_id, dto.company_id),
          eq(schema.feedFormulaMaster.formula_code, formulaCode),
          isNull(schema.feedFormulaMaster.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Feed formula with code '${formulaCode}' already exists in this company.`);
    }

    // 5. Verify each ingredient item exists
    for (const ingredient of dto.ingredients) {
      const [ingrItem] = await this.db
        .select()
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.item_id, ingredient.item_id), isNull(schema.itemMaster.deleted_at)))
        .limit(1);

      if (!ingrItem) {
        throw new NotFoundException(`Ingredient Item with ID '${ingredient.item_id}' not found.`);
      }
    }

    const formulaId = randomUUID();

    // Execute in a database transaction
    const result = await this.db.transaction(async (tx) => {
      const newFormula = {
        formula_id: formulaId,
        tenant_id: tenantId,
        nob_id: (dto as any).nob_id ?? null,
        lob_id: (dto as any).lob_id ?? null,
        company_id: dto.company_id || null,
        formula_code: formulaCode,
        formula_name: dto.formula_name,
        target_item_id: dto.target_item_id,
        batch_size: dto.batch_size.toString(),
        batch_unit: dto.batch_unit,
        description: dto.description || null,
        is_active: true,
        status: 'ACTIVE',
        extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      };

      await tx.insert(schema.feedFormulaMaster).values(newFormula);

      // Insert ingredients
      const newIngredients = dto.ingredients.map((ingr) => ({
        ingredient_id: randomUUID(),
        tenant_id: tenantId,
        nob_id: (dto as any).nob_id ?? null,
        lob_id: (dto as any).lob_id ?? null,
        company_id: dto.company_id || null,
        formula_id: formulaId,
        item_id: ingr.item_id,
        quantity: ingr.quantity.toString(),
        unit: ingr.unit,
        inclusion_pct: ingr.inclusion_pct?.toString() || null,
        loss_pct: ingr.loss_pct?.toString() || null,
        is_active: true,
        status: 'ACTIVE',
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      }));

      for (const ingredientRow of newIngredients) {
        await tx.insert(schema.feedFormulaIngredients).values(ingredientRow);
      }

      return { newFormula, newIngredients };
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'feed_formula_master',
      entityId: formulaId,
      newValues: result,
    });

    return this.findOne(formulaId);
  }

  async findOne(id: string) {
    const [formula] = await this.db
      .select()
      .from(schema.feedFormulaMaster)
      .where(and(eq(schema.feedFormulaMaster.formula_id, id), isNull(schema.feedFormulaMaster.deleted_at)))
      .limit(1);

    if (!formula) {
      throw new NotFoundException(`Feed Formula with ID '${id}' not found.`);
    }

    // Load ingredients
    const ingredientsList = await this.db
      .select()
      .from(schema.feedFormulaIngredients)
      .where(
        and(
          eq(schema.feedFormulaIngredients.formula_id, id),
          isNull(schema.feedFormulaIngredients.deleted_at)
        )
      );

    return {
      ...formula,
      ingredients: ingredientsList,
    };
  }

  async findAll(query: QueryFeedFormulaDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.feedFormulaMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.feedFormulaMaster, query.companyId));
    if (query.targetItemId) {
      conditions.push(eq(schema.feedFormulaMaster.target_item_id, query.targetItemId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.feedFormulaMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.feedFormulaMaster.formula_code, `%${query.search}%`),
          like(schema.feedFormulaMaster.formula_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.feedFormulaMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.feedFormulaMaster, conditions, query, schema.feedFormulaMaster.formula_code);
  }

  async update(id: string, dto: UpdateFeedFormulaDto, tenantId: string, userPayload?: any) {
    const formula = await this.findOne(id);

    if (dto.formula_code && dto.formula_code.toUpperCase() !== formula.formula_code) {
      const existing = await this.db
        .select()
        .from(schema.feedFormulaMaster)
        .where(
          and(
            eq(schema.feedFormulaMaster.tenant_id, tenantId),
            companyCondition(schema.feedFormulaMaster.company_id, formula.company_id),
            eq(schema.feedFormulaMaster.formula_code, dto.formula_code.toUpperCase()),
            ne(schema.feedFormulaMaster.formula_id, id),
            isNull(schema.feedFormulaMaster.deleted_at)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Feed formula with code '${dto.formula_code}' already exists in this company.`);
      }
    }

    if (dto.target_item_id && dto.target_item_id !== formula.target_item_id) {
      const [targetItem] = await this.db
        .select()
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.item_id, dto.target_item_id), isNull(schema.itemMaster.deleted_at)))
        .limit(1);

      if (!targetItem) {
        throw new NotFoundException(`Target produced Item with ID '${dto.target_item_id}' not found.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.formula_code !== undefined) updates.formula_code = dto.formula_code.toUpperCase();
    if (dto.formula_name !== undefined) updates.formula_name = dto.formula_name;
    if (dto.target_item_id !== undefined) updates.target_item_id = dto.target_item_id;
    if (dto.batch_size !== undefined) updates.batch_size = dto.batch_size.toString();
    if (dto.batch_unit !== undefined) updates.batch_unit = dto.batch_unit;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.feedFormulaMaster)
      .set(updates)
      .where(eq(schema.feedFormulaMaster.formula_id, id));

    await this.auditService.log({
      tenantId,
      companyId: formula.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'feed_formula_master',
      entityId: id,
      oldValues: formula,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const formula = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db.transaction(async (tx) => {
      // 1. Soft delete master
      await tx
        .update(schema.feedFormulaMaster)
        .set({
          is_active: false,
          status: 'INACTIVE',
          deleted_at: deletedTime as any,
          updated_by: userPayload?.userId || null,
        })
        .where(eq(schema.feedFormulaMaster.formula_id, id));

      // 2. Soft delete ingredients
      await tx
        .update(schema.feedFormulaIngredients)
        .set({
          is_active: false,
          status: 'INACTIVE',
          deleted_at: deletedTime as any,
          updated_by: userPayload?.userId || null,
        })
        .where(eq(schema.feedFormulaIngredients.formula_id, id));
    });

    await this.auditService.log({
      tenantId,
      companyId: formula.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'feed_formula_master',
      entityId: id,
      oldValues: formula,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Feed Formula and its ingredients soft-deleted successfully.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [formula] = await this.db
      .select()
      .from(schema.feedFormulaMaster)
      .where(eq(schema.feedFormulaMaster.formula_id, id))
      .limit(1);

    if (!formula) {
      throw new NotFoundException(`Feed Formula with ID '${id}' not found.`);
    }

    if (!formula.deleted_at) {
      return this.findOne(id);
    }

    await this.db.transaction(async (tx) => {
      // 1. Restore master
      await tx
        .update(schema.feedFormulaMaster)
        .set({
          is_active: true,
          status: 'ACTIVE',
          deleted_at: null,
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp(),
        })
        .where(eq(schema.feedFormulaMaster.formula_id, id));

      // 2. Restore ingredients
      await tx
        .update(schema.feedFormulaIngredients)
        .set({
          is_active: true,
          status: 'ACTIVE',
          deleted_at: null,
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp(),
        })
        .where(eq(schema.feedFormulaIngredients.formula_id, id));
    });

    await this.auditService.log({
      tenantId,
      companyId: formula.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'feed_formula_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

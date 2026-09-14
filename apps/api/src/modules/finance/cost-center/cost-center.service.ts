import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateCostCenterDto, UpdateCostCenterDto, QueryCostCenterDto } from './dto/cost-center.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { generateCompositeCode } from '../../system/number-series/composite-code.util';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class CostCenterService {
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

  private async findParentCostCenter(parentCostCenterId: string) {
    const [parent] = await this.db
      .select()
      .from(schema.costCenterMaster)
      .where(and(eq(schema.costCenterMaster.cost_center_id, parentCostCenterId), isNull(schema.costCenterMaster.deleted_at)))
      .limit(1);
    if (!parent) {
      throw new NotFoundException(`Parent Cost Center with ID '${parentCostCenterId}' not found.`);
    }
    return parent;
  }

  async create(dto: CreateCostCenterDto, tenantId: string, userPayload?: any) {
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

    // 2. Verify parent cost center if specified
    const parent = dto.parent_cost_center_id ? await this.findParentCostCenter(dto.parent_cost_center_id) : undefined;

    // 3. Resolve a series for this cost_center_type, falling back to the master-alone series.
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('COST_CENTER', dto.cost_center_type, tenantId, dto.company_id);

    if (!seriesCode) {
      return this.createManual(dto, tenantId, userPayload);
    }

    const costCenterId = randomUUID();
    const attempt = () => this.db.transaction((tx) => this.createAutoRecord(tx, {
      dto, tenantId, seriesCode, parent, costCenterId, userPayload,
    }));

    let newCC: Awaited<ReturnType<typeof this.createAutoRecord>>;
    try {
      newCC = await attempt();
    } catch (err) {
      if ((err as { code?: string })?.code !== 'ER_DUP_ENTRY') throw err;
      try {
        newCC = await attempt();
      } catch (retryErr) {
        if ((retryErr as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('Cost Center code collided with a concurrently created cost center; please retry.');
        }
        throw retryErr;
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'cost_center_master',
      entityId: costCenterId,
      newValues: newCC,
    });

    return this.findOne(costCenterId);
  }

  /** No series configured for COST_CENTER[_<type>] — manual entry, exactly as before this feature existed. */
  private async createManual(dto: CreateCostCenterDto, tenantId: string, userPayload?: any) {
    if (!dto.cost_center_code) {
      throw new BadRequestException('cost_center_code is required — no number series is configured for cost centers.');
    }

    const existing = await this.db
      .select()
      .from(schema.costCenterMaster)
      .where(
        and(
          eq(schema.costCenterMaster.tenant_id, tenantId),
          companyCondition(schema.costCenterMaster.company_id, dto.company_id),
          eq(schema.costCenterMaster.cost_center_code, dto.cost_center_code.toUpperCase()),
          isNull(schema.costCenterMaster.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Cost Center with code '${dto.cost_center_code}' already exists in this company.`);
    }

    const costCenterId = randomUUID();
    const newCC = {
      cost_center_id: costCenterId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: dto.company_id || null,
      cost_center_code: dto.cost_center_code.toUpperCase(),
      cost_center_name: dto.cost_center_name,
      cost_center_type: dto.cost_center_type,
      parent_cost_center_id: dto.parent_cost_center_id || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.costCenterMaster).values(newCC);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'cost_center_master',
      entityId: costCenterId,
      newValues: newCC,
    });

    return this.findOne(costCenterId);
  }

  /**
   * Builds and inserts the cost center row (generating its code inside `tx`),
   * for the case a series IS configured. Split out so create()'s retry can
   * re-run the whole attempt, unmodified, if the insert collides on
   * uq_cost_center_master_tenant_company_code.
   */
  private async createAutoRecord(
    tx: MySql2Database<typeof schema>,
    params: {
      dto: CreateCostCenterDto;
      tenantId: string;
      seriesCode: string;
      parent: typeof schema.costCenterMaster.$inferSelect | undefined;
      costCenterId: string;
      userPayload?: any;
    },
  ) {
    const { dto, tenantId, seriesCode, parent, costCenterId, userPayload } = params;

    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, dto.company_id, tx);

    let costCenterCode: string;
    if (series.allow_manual && dto.cost_center_code) {
      costCenterCode = dto.cost_center_code.toUpperCase();
    } else if (parent) {
      costCenterCode = await generateCompositeCode({
        parentCode: parent.cost_center_code,
        prefix: series.prefix || seriesCode,
        seqLength: series.seq_length,
        fetchSiblingCodes: () => tx
          .select({ code: schema.costCenterMaster.cost_center_code })
          .from(schema.costCenterMaster)
          .where(and(
            eq(schema.costCenterMaster.tenant_id, tenantId),
            eq(schema.costCenterMaster.parent_cost_center_id, parent.cost_center_id),
          )),
      });
    } else {
      costCenterCode = await this.numberSeriesService.generateNext(seriesCode, tenantId, dto.company_id, tx, dto as unknown as Record<string, unknown>);
    }

    if (costCenterCode.length > 255) {
      throw new BadRequestException(
        `Cost Center code would exceed 255 characters ('${costCenterCode}', ${costCenterCode.length} characters).`,
      );
    }

    const newCC = {
      cost_center_id: costCenterId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: dto.company_id || null,
      cost_center_code: costCenterCode,
      cost_center_name: dto.cost_center_name,
      cost_center_type: dto.cost_center_type,
      parent_cost_center_id: dto.parent_cost_center_id || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await tx.insert(schema.costCenterMaster).values(newCC);
    return newCC;
  }

  async findOne(id: string) {
    const [cc] = await this.db
      .select()
      .from(schema.costCenterMaster)
      .where(and(eq(schema.costCenterMaster.cost_center_id, id), isNull(schema.costCenterMaster.deleted_at)))
      .limit(1);

    if (!cc) {
      throw new NotFoundException(`Cost Center with ID '${id}' not found.`);
    }

    return cc;
  }

  async findAll(query: QueryCostCenterDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.costCenterMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.costCenterMaster, query.companyId));
    if (query.costCenterType) {
      conditions.push(eq(schema.costCenterMaster.cost_center_type, query.costCenterType));
    }
    if (query.parentCostCenterId) {
      conditions.push(eq(schema.costCenterMaster.parent_cost_center_id, query.parentCostCenterId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.costCenterMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.costCenterMaster.cost_center_code, `%${query.search}%`),
          like(schema.costCenterMaster.cost_center_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.costCenterMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.costCenterMaster, conditions, query, schema.costCenterMaster.cost_center_code);
  }

  async update(id: string, dto: UpdateCostCenterDto, tenantId: string, userPayload?: any) {
    const cc = await this.findOne(id);

    if (dto.cost_center_code && dto.cost_center_code.toUpperCase() !== cc.cost_center_code) {
      const existing = await this.db
        .select()
        .from(schema.costCenterMaster)
        .where(
          and(
            eq(schema.costCenterMaster.tenant_id, tenantId),
            companyCondition(schema.costCenterMaster.company_id, cc.company_id),
            eq(schema.costCenterMaster.cost_center_code, dto.cost_center_code.toUpperCase()),
            ne(schema.costCenterMaster.cost_center_id, id),
            isNull(schema.costCenterMaster.deleted_at)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Cost Center with code '${dto.cost_center_code}' already exists in this company.`);
      }
    }

    if (dto.parent_cost_center_id && dto.parent_cost_center_id !== cc.parent_cost_center_id) {
      if (dto.parent_cost_center_id === id) {
        throw new ConflictException('A Cost Center cannot be its own parent.');
      }

      const [parent] = await this.db
        .select()
        .from(schema.costCenterMaster)
        .where(
          and(
            eq(schema.costCenterMaster.cost_center_id, dto.parent_cost_center_id),
            isNull(schema.costCenterMaster.deleted_at)
          )
        )
        .limit(1);

      if (!parent) {
        throw new NotFoundException(`Parent Cost Center with ID '${dto.parent_cost_center_id}' not found.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.cost_center_code !== undefined) updates.cost_center_code = dto.cost_center_code.toUpperCase();
    if (dto.cost_center_name !== undefined) updates.cost_center_name = dto.cost_center_name;
    if (dto.cost_center_type !== undefined) updates.cost_center_type = dto.cost_center_type;
    if (dto.parent_cost_center_id !== undefined) updates.parent_cost_center_id = dto.parent_cost_center_id;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.costCenterMaster)
      .set(updates)
      .where(eq(schema.costCenterMaster.cost_center_id, id));

    await this.auditService.log({
      tenantId,
      companyId: cc.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'cost_center_master',
      entityId: id,
      oldValues: cc,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const cc = await this.findOne(id);

    // Verify no sub-cost centers exist linking to this one
    const subCCs = await this.db
      .select()
      .from(schema.costCenterMaster)
      .where(
        and(
          eq(schema.costCenterMaster.parent_cost_center_id, id),
          isNull(schema.costCenterMaster.deleted_at)
        )
      )
      .limit(1);

    if (subCCs.length > 0) {
      throw new ConflictException('Cannot delete a Cost Center that has active sub-cost centers.');
    }

    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.costCenterMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.costCenterMaster.cost_center_id, id));

    await this.auditService.log({
      tenantId,
      companyId: cc.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'cost_center_master',
      entityId: id,
      oldValues: cc,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Cost Center '${cc.cost_center_name}' soft-deleted successfully.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [cc] = await this.db
      .select()
      .from(schema.costCenterMaster)
      .where(eq(schema.costCenterMaster.cost_center_id, id))
      .limit(1);

    if (!cc) {
      throw new NotFoundException(`Cost Center with ID '${id}' not found.`);
    }

    if (!cc.deleted_at) {
      return this.findOne(id);
    }

    // Verify parent is not deleted
    if (cc.parent_cost_center_id) {
      const [parent] = await this.db
        .select()
        .from(schema.costCenterMaster)
        .where(
          and(
            eq(schema.costCenterMaster.cost_center_id, cc.parent_cost_center_id),
            isNull(schema.costCenterMaster.deleted_at)
          )
        )
        .limit(1);

      if (!parent) {
        throw new ConflictException('Cannot restore a Cost Center whose parent is deleted or inactive. Restore parent first.');
      }
    }

    await this.db
      .update(schema.costCenterMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.costCenterMaster.cost_center_id, id));

    await this.auditService.log({
      tenantId,
      companyId: cc.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'cost_center_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

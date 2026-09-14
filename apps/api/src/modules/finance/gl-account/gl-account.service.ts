import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateGlAccountDto, UpdateGlAccountDto, QueryGlAccountDto } from './dto/gl-account.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { generateCompositeCode } from '../../system/number-series/composite-code.util';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class GlAccountService {
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

  private async findParentAccount(parentAccountId: string) {
    const [parent] = await this.db
      .select()
      .from(schema.glAccountMaster)
      .where(and(eq(schema.glAccountMaster.gl_account_id, parentAccountId), isNull(schema.glAccountMaster.deleted_at)))
      .limit(1);
    if (!parent) {
      throw new NotFoundException(`Parent G/L Account with ID '${parentAccountId}' not found.`);
    }
    return parent;
  }

  async create(dto: CreateGlAccountDto, tenantId: string, userPayload?: any) {
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

    // 2. Verify parent account exists if specified
    const parent = dto.parent_account_id ? await this.findParentAccount(dto.parent_account_id) : undefined;

    // 3. Resolve a series for this account_type, falling back to the master-alone series.
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('GL_ACCOUNT', dto.account_type, tenantId, dto.company_id);

    if (!seriesCode) {
      return this.createManual(dto, tenantId, userPayload);
    }

    const glAccountId = randomUUID();
    const attempt = () => this.db.transaction((tx) => this.createAutoRecord(tx, {
      dto, tenantId, seriesCode, parent, glAccountId, userPayload,
    }));

    let newAccount: Awaited<ReturnType<typeof this.createAutoRecord>>;
    try {
      newAccount = await attempt();
    } catch (err) {
      if ((err as { code?: string })?.code !== 'ER_DUP_ENTRY') throw err;
      try {
        newAccount = await attempt();
      } catch (retryErr) {
        if ((retryErr as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('Account code collided with a concurrently created account; please retry.');
        }
        throw retryErr;
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'gl_account_master',
      entityId: glAccountId,
      newValues: newAccount,
    });

    return this.findOne(glAccountId);
  }

  /** No series configured for GL_ACCOUNT[_<type>] — manual entry, exactly as before this feature existed. */
  private async createManual(dto: CreateGlAccountDto, tenantId: string, userPayload?: any) {
    if (!dto.account_code) {
      throw new BadRequestException('account_code is required — no number series is configured for G/L accounts.');
    }

    // Check unique account code in this company
    const existing = await this.db
      .select()
      .from(schema.glAccountMaster)
      .where(
        and(
          eq(schema.glAccountMaster.tenant_id, tenantId),
          companyCondition(schema.glAccountMaster.company_id, dto.company_id),
          eq(schema.glAccountMaster.account_code, dto.account_code),
          isNull(schema.glAccountMaster.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`G/L Account with code '${dto.account_code}' already exists in this company.`);
    }

    const glAccountId = randomUUID();
    const newAccount = {
      gl_account_id: glAccountId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: dto.company_id || null,
      account_code: dto.account_code,
      account_name: dto.account_name,
      account_type: dto.account_type,
      parent_account_id: dto.parent_account_id || null,
      is_sub_account: dto.is_sub_account ?? false,
      is_reconciliation: dto.is_reconciliation ?? false,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.glAccountMaster).values(newAccount);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'gl_account_master',
      entityId: glAccountId,
      newValues: newAccount,
    });

    return this.findOne(glAccountId);
  }

  /**
   * Builds and inserts the account row (generating its code inside `tx`), for
   * the case a series IS configured. Split out so create()'s retry can re-run
   * the whole attempt, unmodified, if the insert collides on
   * uq_gl_account_master_tenant_company_code.
   */
  private async createAutoRecord(
    tx: MySql2Database<typeof schema>,
    params: {
      dto: CreateGlAccountDto;
      tenantId: string;
      seriesCode: string;
      parent: typeof schema.glAccountMaster.$inferSelect | undefined;
      glAccountId: string;
      userPayload?: any;
    },
  ) {
    const { dto, tenantId, seriesCode, parent, glAccountId, userPayload } = params;

    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, dto.company_id, tx);

    let accountCode: string;
    if (series.allow_manual && dto.account_code) {
      accountCode = dto.account_code;
    } else if (parent) {
      accountCode = await generateCompositeCode({
        parentCode: parent.account_code,
        prefix: series.prefix || seriesCode,
        seqLength: series.seq_length,
        fetchSiblingCodes: () => tx
          .select({ code: schema.glAccountMaster.account_code })
          .from(schema.glAccountMaster)
          .where(and(
            eq(schema.glAccountMaster.tenant_id, tenantId),
            eq(schema.glAccountMaster.parent_account_id, parent.gl_account_id),
          )),
      });
    } else {
      accountCode = await this.numberSeriesService.generateNext(seriesCode, tenantId, dto.company_id, tx, dto as unknown as Record<string, unknown>);
    }

    if (accountCode.length > 255) {
      throw new BadRequestException(
        `Account code would exceed 255 characters ('${accountCode}', ${accountCode.length} characters).`,
      );
    }

    const newAccount = {
      gl_account_id: glAccountId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: dto.company_id || null,
      account_code: accountCode,
      account_name: dto.account_name,
      account_type: dto.account_type,
      parent_account_id: dto.parent_account_id || null,
      is_sub_account: dto.is_sub_account ?? false,
      is_reconciliation: dto.is_reconciliation ?? false,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await tx.insert(schema.glAccountMaster).values(newAccount);
    return newAccount;
  }

  async findOne(id: string) {
    const [account] = await this.db
      .select()
      .from(schema.glAccountMaster)
      .where(and(eq(schema.glAccountMaster.gl_account_id, id), isNull(schema.glAccountMaster.deleted_at)))
      .limit(1);

    if (!account) {
      throw new NotFoundException(`G/L Account with ID '${id}' not found.`);
    }

    return account;
  }

  async findAll(query: QueryGlAccountDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.glAccountMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.glAccountMaster, query.companyId));
    if (query.accountType) {
      conditions.push(eq(schema.glAccountMaster.account_type, query.accountType));
    }
    if (query.parentAccountId) {
      conditions.push(eq(schema.glAccountMaster.parent_account_id, query.parentAccountId));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.glAccountMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.glAccountMaster.account_code, `%${query.search}%`),
          like(schema.glAccountMaster.account_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.glAccountMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.glAccountMaster, conditions, query, schema.glAccountMaster.account_code);
  }

  async update(id: string, dto: UpdateGlAccountDto, tenantId: string, userPayload?: any) {
    const account = await this.findOne(id);

    if (dto.account_code && dto.account_code !== account.account_code) {
      const existing = await this.db
        .select()
        .from(schema.glAccountMaster)
        .where(
          and(
            eq(schema.glAccountMaster.tenant_id, tenantId),
            companyCondition(schema.glAccountMaster.company_id, account.company_id),
            eq(schema.glAccountMaster.account_code, dto.account_code),
            ne(schema.glAccountMaster.gl_account_id, id),
            isNull(schema.glAccountMaster.deleted_at)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`G/L Account with code '${dto.account_code}' already exists in this company.`);
      }
    }

    if (dto.parent_account_id && dto.parent_account_id !== account.parent_account_id) {
      if (dto.parent_account_id === id) {
        throw new ConflictException('A G/L Account cannot be its own parent.');
      }

      const [parent] = await this.db
        .select()
        .from(schema.glAccountMaster)
        .where(
          and(
            eq(schema.glAccountMaster.gl_account_id, dto.parent_account_id),
            isNull(schema.glAccountMaster.deleted_at)
          )
        )
        .limit(1);

      if (!parent) {
        throw new NotFoundException(`Parent G/L Account with ID '${dto.parent_account_id}' not found.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.account_code !== undefined) updates.account_code = dto.account_code;
    if (dto.account_name !== undefined) updates.account_name = dto.account_name;
    if (dto.account_type !== undefined) updates.account_type = dto.account_type;
    if (dto.parent_account_id !== undefined) updates.parent_account_id = dto.parent_account_id;
    if (dto.is_sub_account !== undefined) updates.is_sub_account = dto.is_sub_account;
    if (dto.is_reconciliation !== undefined) updates.is_reconciliation = dto.is_reconciliation;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.glAccountMaster)
      .set(updates)
      .where(eq(schema.glAccountMaster.gl_account_id, id));

    await this.auditService.log({
      tenantId,
      companyId: account.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'gl_account_master',
      entityId: id,
      oldValues: account,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const account = await this.findOne(id);

    // Verify no sub-accounts exist linking to this account
    const subAccounts = await this.db
      .select()
      .from(schema.glAccountMaster)
      .where(
        and(
          eq(schema.glAccountMaster.parent_account_id, id),
          isNull(schema.glAccountMaster.deleted_at)
        )
      )
      .limit(1);

    if (subAccounts.length > 0) {
      throw new ConflictException('Cannot delete a G/L Account that has active sub-accounts.');
    }

    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.glAccountMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.glAccountMaster.gl_account_id, id));

    await this.auditService.log({
      tenantId,
      companyId: account.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'gl_account_master',
      entityId: id,
      oldValues: account,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `G/L Account '${account.account_name}' soft-deleted successfully.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [account] = await this.db
      .select()
      .from(schema.glAccountMaster)
      .where(eq(schema.glAccountMaster.gl_account_id, id))
      .limit(1);

    if (!account) {
      throw new NotFoundException(`G/L Account with ID '${id}' not found.`);
    }

    if (!account.deleted_at) {
      return this.findOne(id);
    }

    // Verify parent is not deleted
    if (account.parent_account_id) {
      const [parent] = await this.db
        .select()
        .from(schema.glAccountMaster)
        .where(
          and(
            eq(schema.glAccountMaster.gl_account_id, account.parent_account_id),
            isNull(schema.glAccountMaster.deleted_at)
          )
        )
        .limit(1);

      if (!parent) {
        throw new ConflictException('Cannot restore a G/L Account whose parent is deleted or inactive. Restore parent first.');
      }
    }

    await this.db
      .update(schema.glAccountMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.glAccountMaster.gl_account_id, id));

    await this.auditService.log({
      tenantId,
      companyId: account.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'gl_account_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}

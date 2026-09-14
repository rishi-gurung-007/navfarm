import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, ne, isNull, like, or, type SQL } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.module';
import { CreateCompanyDto, UpdateCompanyDto, QueryCompanyDto } from './dto/company.dto';
import * as crypto from 'crypto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { seedDefaultCompanyRoles } from '../role/default-role-seed';
import { copyCompanyMasterTemplates } from './copy-master-templates';
import { isTenantLevelUserType } from '../../../common/user-type-hierarchy';

/** Seeded in bootstrap-database.ts. */
const USD_CURRENCY_ID = '20000000-2000-2000-2000-200000000002';

const toMysqlTimestamp = (date: Date = new Date()) =>
  date.toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class CompanyService {
  constructor(
    private readonly cls: ClsService,
    @Inject(MASTER_CONNECTION)
    private readonly masterDb: MySql2Database<typeof masterSchema>,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async findByTenant(tenantId: string, query?: QueryCompanyDto) {
    const conditions: any[] = [
      eq(schema.companyMaster.tenant_id, tenantId),
      ne(schema.companyMaster.company_code, 'PLACEHOLDER'),
      isNull(schema.companyMaster.deleted_at),
    ];

    if (query) {
      if (query.isActive !== undefined) {
        conditions.push(eq(schema.companyMaster.is_active, query.isActive));
      }
      if (query.onboardingStatus !== undefined) {
        conditions.push(eq(schema.companyMaster.onboarding_status, query.onboardingStatus));
      }
      if (query.search) {
        conditions.push(
          or(
            like(schema.companyMaster.company_code, `%${query.search}%`),
            like(schema.companyMaster.company_name, `%${query.search}%`)
          )
        );
      }
    }

    const limit = query?.limit || 50;
    const offset = query?.offset || 0;

    return this.db
      .select()
      .from(schema.companyMaster)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  async findOne(companyId: string) {
    const [company] = await this.db
      .select()
      .from(schema.companyMaster)
      .where(and(
        eq(schema.companyMaster.company_id, companyId),
        isNull(schema.companyMaster.deleted_at)
      ))
      .limit(1);

    if (!company) {
      throw new NotFoundException(`Company with ID '${companyId}' not found.`);
    }

    return company;
  }

  async create(dto: CreateCompanyDto, tenantId: string, userPayload?: any) {
    this.assertTenantLevel(userPayload, 'create');

    // Check plan limits in masterDb
    const [tenantMeta] = await this.masterDb
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, tenantId))
      .limit(1);

    if (!tenantMeta) {
      throw new NotFoundException(`Tenant with ID '${tenantId}' not found.`);
    }

    const activeCompanies = await this.db
      .select()
      .from(schema.companyMaster)
      .where(and(
        ne(schema.companyMaster.company_code, 'PLACEHOLDER'),
        eq(schema.companyMaster.is_active, true),
      ));

    if (activeCompanies.length >= tenantMeta.max_companies) {
      throw new BadRequestException(
        `Company registration limit reached (${tenantMeta.max_companies}). Please upgrade your SaaS plan to create more companies.`
      );
    }

    // Check for duplicate company_code or company_name within tenant
    const existing = await this.db
      .select()
      .from(schema.companyMaster)
      .where(
        and(
          eq(schema.companyMaster.tenant_id, tenantId),
          or(
            eq(schema.companyMaster.company_code, dto.company_code.toUpperCase()),
            eq(schema.companyMaster.company_name, dto.company_name)
          ),
          isNull(schema.companyMaster.deleted_at)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].company_code === dto.company_code.toUpperCase()) {
        throw new ConflictException(`Company with code '${dto.company_code}' already exists in this tenant.`);
      }
      throw new ConflictException(`Company with name '${dto.company_name}' already exists in this tenant.`);
    }

    // Get default language and currency if not specified or invalid UUID format
    let langId = dto.default_language_id;
    let currId = dto.base_currency_id;
    
    const isValidUuid = (val?: string) => 
      val && typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    if (!isValidUuid(langId)) {
      const [lang] = await this.db.select().from(schema.languageMaster).limit(1);
      langId = lang?.lang_id;
    }
    if (!isValidUuid(currId)) {
      // See auth.service: pick USD by iso_code, never the first row.
      const [curr] = await this.db.select().from(schema.currencyMaster).where(eq(schema.currencyMaster.iso_code, 'USD')).limit(1);
      currId = curr?.currency_id;
    }

    const companyId = crypto.randomUUID();

    return this.db.transaction(async (tx) => {
      // Create Company Master with COMPLETED onboarding status
      await tx.insert(schema.companyMaster).values({
        company_id: companyId,
        tenant_id: tenantId,
        company_code: dto.company_code,
        company_name: dto.company_name,
        company_display_name: dto.company_display_name || dto.company_name,
        company_type: dto.company_type,
        industry_type: dto.industry_type,
        base_currency_id: currId || '20000000-2000-2000-2000-200000000002',
        default_language_id: langId || '10000000-1000-1000-1000-100000000001',
        default_timezone_id: dto.default_timezone_id || 'UTC',
        country_id: dto.country_id,
        registration_no: dto.registration_no || null,
        tax_id: dto.tax_id || null,
        primary_color_hex: dto.primary_color_hex || '#1F4E79',
        onboarding_status: 'PENDING',
        is_active: true,
      });

      // Seed the four starter roles (SUPER_ADMIN/MANAGER/ACCOUNTANT/OPERATOR)
      await copyCompanyMasterTemplates(tx, tenantId, companyId);
      const { superAdminRoleId: roleId } = await seedDefaultCompanyRoles(tx, companyId);

      if (userPayload?.userId) {
        const existingAssignments = await tx
          .select({ assignId: schema.userCompanyAssignments.assign_id })
          .from(schema.userCompanyAssignments)
          .where(eq(schema.userCompanyAssignments.user_id, userPayload.userId));

        await tx.insert(schema.userCompanyAssignments).values({
          user_id: userPayload.userId,
          company_id: companyId,
          is_primary: existingAssignments.length === 0,
          assigned_by: userPayload.userId,
        });
        await tx.insert(schema.userRoleAssignment).values({
          user_id: userPayload.userId,
          role_id: roleId,
          assigned_by: userPayload.userId,
        });

        if (existingAssignments.length === 0) {
          await tx
            .update(schema.userMaster)
            .set({ company_id: companyId })
            .where(eq(schema.userMaster.user_id, userPayload.userId));
        }
      }

      // 1. Create Default Office Address
      await tx.insert(schema.companyAddress).values({
        company_id: companyId,
        address_type: 'REGISTERED',
        address_label: 'Registered Office',
        line1: 'Primary Office Block',
        city: dto.country_id === 'IND' ? 'Mumbai' : 'New York',
        state_id: '40000000-4000-4000-4000-400000000001',
        pincode: dto.country_id === 'IND' ? '400001' : '10001',
        country_id: dto.country_id || 'IND',
        is_active: true,
      });

      // 2. Create Default Primary Contact
      let userFullName = 'Tenant Administrator';
      if (userPayload?.userId) {
        const [u] = await tx
          .select()
          .from(schema.userMaster)
          .where(eq(schema.userMaster.user_id, userPayload.userId))
          .limit(1);
        if (u?.full_name) {
          userFullName = u.full_name;
        }
      }

      const contactId = crypto.randomUUID();
      await tx.insert(schema.companyContacts).values({
        contact_id: contactId,
        company_id: companyId,
        contact_type: 'PRIMARY',
        full_name: userFullName,
        email: userPayload?.email || 'admin@navfarm.com',
        phone_primary: '+919999999999',
        is_primary: true,
        receives_alerts: true,
        receives_reports: true,
        is_active: true,
      });

      // 3. Create Default Fiscal Configuration
      const fiscalId = crypto.randomUUID();
      const currentYear = new Date().getFullYear();
      await tx.insert(schema.companyFiscal).values({
        fiscal_id: fiscalId,
        company_id: companyId,
        fiscal_year_format: 'FY APR MAR',
        fiscal_start_month: 4,
        fiscal_start_day: 1,
        current_fiscal_year: `FY ${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
        period_type: 'MONTHLY',
        accounting_standard: 'IND AS',
        depreciation_method: 'SLM',
        inventory_valuation: 'STANDARD',
        tax_audit_applicable: false,
        is_active: true,
      });

      // 4. Create default language configuration
      const langConfigId = crypto.randomUUID();
      await tx.insert(schema.companyLanguageConfig).values({
        config_id: langConfigId,
        company_id: companyId,
        lang_id: langId || '10000000-1000-1000-1000-100000000001',
        is_default: true,
        is_enabled: true,
        set_by: userPayload?.userId || null,
      });

      // 5. Create default currency configuration
      const currConfigId = crypto.randomUUID();
      await tx.insert(schema.companyCurrencyConfig).values({
        curr_config_id: currConfigId,
        company_id: companyId,
        // Was the Indian Rupee's id as a silent fallback, so a company created
        // without naming a currency got ₹. USD per BBP-1 §1.1's field spec —
        // the same section's flowchart says ZWL, which is Triple C's to settle.
        currency_id: currId || USD_CURRENCY_ID,
        is_base: true,
        is_reporting: true,
        display_order: 1,
      });

      // 6. Enable standard default modules
      const defaultModules = ['FARM', 'INVENTORY', 'FINANCE', 'PROCUREMENT', 'SALES', 'HRMS'];
      const moduleInserts = defaultModules.map((modCode) => ({
        module_id: crypto.randomUUID(),
        company_id: companyId,
        module_code: modCode,
        is_active: true,
        activated_on: new Date().toISOString().split('T')[0],
      }));
      await tx.insert(schema.companyModules).values(moduleInserts);

      // 7. Seed only COMPANY_PROFILE step as COMPLETED in setupWizardLog
      const [profileStep] = await tx
        .select()
        .from(schema.setupStepMaster)
        .where(eq(schema.setupStepMaster.step_code, 'COMPANY_PROFILE'))
        .limit(1);

      if (profileStep) {
        await tx.insert(schema.setupWizardLog).values({
          log_id: crypto.randomUUID(),
          company_id: companyId,
          step_id: profileStep.step_id,
          status: 'COMPLETED',
          completed_at: toMysqlTimestamp(),
          completed_by: userPayload?.userId || null,
        });
      }

      const [company] = await tx
        .select()
        .from(schema.companyMaster)
        .where(eq(schema.companyMaster.company_id, companyId))
        .limit(1);

      return company;
    });
  }

  async update(companyId: string, dto: UpdateCompanyDto, tenantId?: string, userPayload?: any) {
    const company = await this.findOne(companyId);
    await this.assertCanEditCompany(company, userPayload);
    // is_active=false is a soft delete by another name, so it follows delete's rule.
    if (dto.is_active !== undefined && dto.is_active !== company.is_active) {
      this.assertTenantLevel(userPayload, 'deactivate or reactivate');
    }

    // Validate unique code / name if modified
    if (tenantId && (dto.company_code || dto.company_name)) {
      const codeOrName: SQL[] = [];
      if (dto.company_code) codeOrName.push(eq(schema.companyMaster.company_code, dto.company_code.toUpperCase()));
      if (dto.company_name) codeOrName.push(eq(schema.companyMaster.company_name, dto.company_name));

      const existing = await this.db
        .select()
        .from(schema.companyMaster)
        .where(
          and(
            eq(schema.companyMaster.tenant_id, tenantId),
            ne(schema.companyMaster.company_id, companyId),
            or(...codeOrName),
            isNull(schema.companyMaster.deleted_at)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        if (dto.company_code && existing[0].company_code === dto.company_code.toUpperCase()) {
          throw new ConflictException(`Company with code '${dto.company_code}' already exists in this tenant.`);
        }
        throw new ConflictException(`Company with name '${dto.company_name}' already exists in this tenant.`);
      }
    }

    const updates: any = {
      updated_at: toMysqlTimestamp(),
      updated_by: userPayload?.userId || null,
    };

    if (dto.company_code !== undefined) updates.company_code = dto.company_code.toUpperCase();
    if (dto.company_name !== undefined) updates.company_name = dto.company_name;
    if (dto.company_display_name !== undefined) updates.company_display_name = dto.company_display_name;
    if (dto.company_type !== undefined) updates.company_type = dto.company_type;
    if (dto.industry_type !== undefined) updates.industry_type = dto.industry_type;
    if (dto.base_currency_id !== undefined) updates.base_currency_id = dto.base_currency_id;
    if (dto.default_language_id !== undefined) updates.default_language_id = dto.default_language_id;
    if (dto.country_id !== undefined) updates.country_id = dto.country_id;
    if (dto.default_timezone_id !== undefined) updates.default_timezone_id = dto.default_timezone_id;
    if (dto.registration_no !== undefined) updates.registration_no = dto.registration_no;
    if (dto.tax_id !== undefined) updates.tax_id = dto.tax_id;
    if (dto.primary_color_hex !== undefined) updates.primary_color_hex = dto.primary_color_hex;
    if (dto.onboarding_status !== undefined) updates.onboarding_status = dto.onboarding_status;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    await this.db
      .update(schema.companyMaster)
      .set(updates)
      .where(eq(schema.companyMaster.company_id, companyId));

    // Audit Log
    await this.auditService.log({
      tenantId: tenantId || company.tenant_id,
      companyId: companyId,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'company_master',
      entityId: companyId,
      oldValues: company,
      newValues: updates,
    });

    return this.findOne(companyId);
  }

  async remove(companyId: string, tenantId?: string, userPayload?: any) {
    this.assertTenantLevel(userPayload, 'delete');
    const company = await this.findOne(companyId);
    const deletedTime = toMysqlTimestamp();

    // Soft-delete
    await this.db
      .update(schema.companyMaster)
      .set({
        is_active: false,
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.companyMaster.company_id, companyId));

    // Audit Log
    await this.auditService.log({
      tenantId: tenantId || company.tenant_id,
      companyId: companyId,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'company_master',
      entityId: companyId,
      oldValues: company,
      newValues: { is_active: false, deleted_at: deletedTime },
    });

    return { success: true, message: `Company '${company.company_name}' has been soft-deleted.` };
  }

  async restore(companyId: string, tenantId?: string, userPayload?: any) {
    this.assertTenantLevel(userPayload, 'restore');

    const [company] = await this.db
      .select()
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);

    if (!company) {
      throw new NotFoundException(`Company with ID '${companyId}' not found.`);
    }

    if (!company.deleted_at) {
      return company;
    }

    await this.db
      .update(schema.companyMaster)
      .set({
        is_active: true,
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.companyMaster.company_id, companyId));

    // Audit Log
    await this.auditService.log({
      tenantId: tenantId || company.tenant_id,
      companyId: companyId,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'company_master',
      entityId: companyId,
      newValues: { is_active: true, deleted_at: null },
    });

    return this.findOne(companyId);
  }

  /**
   * Creating, deleting and restoring companies reshapes the tenant. The
   * permission decorators cannot enforce that on their own: COMPANY_ADMIN
   * bypasses role_permissions in RolesGuard, so it passed 'create'/'delete'.
   */
  private assertTenantLevel(userPayload: any, action: string) {
    if (!isTenantLevelUserType(userPayload?.userType)) {
      throw new ForbiddenException(`Only a tenant administrator can ${action} a company.`);
    }
  }

  /**
   * Below tenant level a user may edit only a company they belong to: their
   * home company or an active assignment. RolesGuard validates the
   * x-active-company-id header but never the :id in the path.
   */
  private async assertCanEditCompany(company: { company_id: string; tenant_id: string }, userPayload: any) {
    const userType = userPayload?.userType;
    if (userType === 'SYSTEM_ADMIN') return;
    if (userType === 'TENANT_ADMIN') {
      if (company.tenant_id !== userPayload.tenantId) {
        throw new ForbiddenException('Not authorized for this company.');
      }
      return;
    }
    if (!userPayload?.userId) {
      throw new ForbiddenException('Not authorized for this company.');
    }
    if (company.company_id === userPayload.companyId) return;

    const [assignment] = await this.db
      .select({ id: schema.userCompanyAssignments.assign_id })
      .from(schema.userCompanyAssignments)
      .where(and(
        eq(schema.userCompanyAssignments.user_id, userPayload.userId),
        eq(schema.userCompanyAssignments.company_id, company.company_id),
        eq(schema.userCompanyAssignments.is_active, true),
      ))
      .limit(1);
    if (!assignment) {
      throw new ForbiddenException('Not authorized for this company.');
    }
  }
}

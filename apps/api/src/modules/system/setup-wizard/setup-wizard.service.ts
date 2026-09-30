import { Injectable, OnModuleInit, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.module';
import { Step1ProfileDto } from './dto/step1-profile.dto';
import { copyCompanyMasterTemplates } from '../../core/company/copy-master-templates';
import { Step2AddressDto } from './dto/step2-address.dto';
import { Step3ContactDto } from './dto/step3-contact.dto';
import { Step7FiscalDto } from './dto/step7-fiscal.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MasterDataSeedService } from './seed/master-data-seed.service';
import { seedDefaultCompanyRoles } from '../../core/role/default-role-seed';

@Injectable()
export class SetupWizardService implements OnModuleInit {
  constructor(
    @Inject(MASTER_CONNECTION)
    private readonly masterDb: MySql2Database<typeof masterSchema>,
    private readonly cls: ClsService,
    private readonly auditLogService: AuditLogService,
    private readonly masterDataSeedService: MasterDataSeedService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async onModuleInit() {
    try {
      await this.masterDb
        .select({ planId: masterSchema.planMaster.plan_id })
        .from(masterSchema.planMaster)
        .limit(1);
    } catch {
      console.warn(
        'NAVFarm databases are not initialized. Run `pnpm nx db-bootstrap api` before using database-backed routes.',
      );
    }
  }

  async saveStep1Profile(dto: Step1ProfileDto) {
    // The DTO's @Transform('' -> undefined) normalizes blank optional fields
    // for varchar columns, which tolerate ''. incorporation_date is a strict
    // SQL `date` column though — '' fails with ER_TRUNCATED_WRONG_VALUE, so
    // it needs an explicit null fallback rather than relying on that transform.
    const incorporationDate = dto.incorporation_date ? dto.incorporation_date : null;
    const existing = dto.company_id
      ? await this.db
          .select()
          .from(schema.companyMaster)
          .where(eq(schema.companyMaster.company_id, dto.company_id))
          .limit(1)
      : await this.db
          .select()
          .from(schema.companyMaster)
          .where(
            or(
              and(eq(schema.companyMaster.tenant_id, dto.tenant_id), eq(schema.companyMaster.company_code, dto.company_code.toUpperCase())),
              eq(schema.companyMaster.company_id, '00000000-0000-0000-0000-000000000000')
            )
          )
          .limit(1);

    return this.db.transaction(async (tx) => {
      let company;
      if (existing.length > 0) {
        // Tenant signup creates a placeholder company so the first administrator
        // has a valid company FK. Step 1 normally claims that row instead of
        // inserting a new company, so this branch must take the same one-time
        // master-template snapshot as the insert branch below. Use the original
        // code, not the permanent all-zero id: later edits keep that id and must
        // not re-copy independently owned company masters or reset counters.
        const claimsPlaceholder = existing[0].company_code === 'PLACEHOLDER';
        // Update
        await tx
          .update(schema.companyMaster)
          .set({
            company_code: dto.company_code.toUpperCase(),
            company_name: dto.company_name,
            company_display_name: dto.company_display_name || dto.company_name,
            company_type: dto.company_type,
            industry_type: dto.industry_type,
            registration_no: dto.registration_no,
            tax_id: dto.tax_id,
            tax_regime: dto.tax_regime || 'STANDARD',
            incorporation_date: incorporationDate,
            website: dto.website,
            email_domain: dto.email_domain,
            support_email: dto.support_email,
            phone_primary: dto.phone_primary,
            company_logo_url: dto.company_logo_url,
            company_logo_dark_url: dto.company_logo_dark_url,
            primary_color_hex: dto.primary_color_hex || '#1F4E79',
          })
          .where(eq(schema.companyMaster.company_id, existing[0].company_id));

        if (claimsPlaceholder) {
          await copyCompanyMasterTemplates(tx, dto.tenant_id, existing[0].company_id);
        }

        [company] = await tx
          .select()
          .from(schema.companyMaster)
          .where(eq(schema.companyMaster.company_id, existing[0].company_id))
          .limit(1);
      } else {
        // Check plan limits in masterDb
        const [tenantMeta] = await this.masterDb
          .select()
          .from(masterSchema.tenantMaster)
          .where(eq(masterSchema.tenantMaster.tenant_id, dto.tenant_id))
          .limit(1);

        if (!tenantMeta) {
          throw new NotFoundException(`Tenant with ID '${dto.tenant_id}' not found.`);
        }

        const activeCompanies = await tx
          .select()
          .from(schema.companyMaster)
          .where(eq(schema.companyMaster.tenant_id, dto.tenant_id));

        if (activeCompanies.length >= tenantMeta.max_companies) {
          throw new BadRequestException(
            `Company registration limit reached (${tenantMeta.max_companies}). Please upgrade your SaaS plan to create more companies.`
          );
        }

        // Create - Drizzle schema fields base_currency_id, default_language_id, default_timezone_id, country_id are NOT NULL.
        // During step 1, we pass nil UUID placeholder references and update them in step 4, 5, 6.
        const companyId = randomUUID();
        const NIL_UUID = '00000000-0000-0000-0000-000000000000';
        await tx
          .insert(schema.companyMaster)
          .values({
            company_id: companyId,
            tenant_id: dto.tenant_id,
            company_code: dto.company_code.toUpperCase(),
            company_name: dto.company_name,
            company_display_name: dto.company_display_name || dto.company_name,
            company_type: dto.company_type,
            industry_type: dto.industry_type,
            registration_no: dto.registration_no,
            tax_id: dto.tax_id,
            tax_regime: dto.tax_regime || 'STANDARD',
            incorporation_date: incorporationDate,
            website: dto.website,
            email_domain: dto.email_domain,
            support_email: dto.support_email,
            phone_primary: dto.phone_primary,
            company_logo_url: dto.company_logo_url,
            company_logo_dark_url: dto.company_logo_dark_url,
            primary_color_hex: dto.primary_color_hex || '#1F4E79',
            base_currency_id: NIL_UUID,
            default_language_id: NIL_UUID,
            default_timezone_id: NIL_UUID,
            country_id: NIL_UUID,
            onboarding_status: 'PENDING',
          });

        await copyCompanyMasterTemplates(tx, dto.tenant_id, companyId);

        [company] = await tx
          .select()
          .from(schema.companyMaster)
          .where(eq(schema.companyMaster.company_id, companyId))
          .limit(1);
      }

      // Seed the four starter roles the first time this company gets a real
      // profile. The "existing" branch above frequently claims the tenant's
      // placeholder company in place rather than inserting a fresh row, so a
      // create()-only hook (as in CompanyService) would miss most companies
      // onboarded through this wizard — check roleMaster directly instead.
      const hasRoles = await tx
        .select({ role_id: schema.roleMaster.role_id })
        .from(schema.roleMaster)
        .where(eq(schema.roleMaster.company_id, company.company_id))
        .limit(1);
      if (hasRoles.length === 0) {
        await seedDefaultCompanyRoles(tx, company.company_id);
      }

      try {
        await this.auditLogService.log({
          tenantId: company.tenant_id,
          companyId: company.company_id,
          action: existing.length > 0 ? 'UPDATE_COMPANY' : 'CREATE_COMPANY',
          entityName: 'COMPANY',
          entityId: company.company_id,
          newValues: dto,
        }, tx);
      } catch (e) {
        console.error('Failed to log company configuration audit event:', e);
      }

      await this.logStepCompletion(tx, company.company_id, 'COMPANY_PROFILE');
      return company;
    });
  }

  async saveStep2Address(dto: Step2AddressDto) {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.companyAddress)
        .where(eq(schema.companyAddress.company_id, dto.company_id))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(schema.companyAddress)
          .set({
            address_type: dto.address_type,
            address_label: dto.address_label,
            line1: dto.line1,
            line2: dto.line2,
            city: dto.city,
            state_id: dto.state_id,
            country_id: dto.country_id,
            pincode: dto.pincode,
            gps_latitude: dto.gps_latitude?.toString() || null,
            gps_longitude: dto.gps_longitude?.toString() || null,
          })
          .where(eq(schema.companyAddress.company_id, dto.company_id));
      } else {
        await tx.insert(schema.companyAddress).values({
          company_id: dto.company_id,
          address_type: dto.address_type,
          address_label: dto.address_label,
          line1: dto.line1,
          line2: dto.line2,
          city: dto.city,
          state_id: dto.state_id,
          country_id: dto.country_id,
          pincode: dto.pincode,
          gps_latitude: dto.gps_latitude?.toString(),
          gps_longitude: dto.gps_longitude?.toString(),
          is_primary: true,
        });
      }

      await this.logStepCompletion(tx, dto.company_id, 'ADDRESS');
    });
    return { success: true };
  }

  async saveStep3Contact(dto: Step3ContactDto) {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.companyContacts)
        .where(eq(schema.companyContacts.company_id, dto.company_id))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(schema.companyContacts)
          .set({
            contact_type: dto.contact_type,
            full_name: dto.full_name,
            designation: dto.designation,
            email: dto.email,
            phone_primary: dto.phone_primary,
            phone_secondary: dto.phone_secondary,
            receives_alerts: dto.receives_alerts || false,
            receives_reports: dto.receives_reports || false,
          })
          .where(eq(schema.companyContacts.company_id, dto.company_id));
      } else {
        await tx.insert(schema.companyContacts).values({
          company_id: dto.company_id,
          contact_type: dto.contact_type,
          full_name: dto.full_name,
          designation: dto.designation,
          email: dto.email,
          phone_primary: dto.phone_primary,
          phone_secondary: dto.phone_secondary,
          receives_alerts: dto.receives_alerts || false,
          receives_reports: dto.receives_reports || false,
          is_primary: true,
        });
      }

      await this.logStepCompletion(tx, dto.company_id, 'KEY_CONTACTS');
    });
    return { success: true };
  }

  async saveStep4Language(companyId: string, langId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.companyMaster)
        .set({ default_language_id: langId })
        .where(eq(schema.companyMaster.company_id, companyId));

      await this.logStepCompletion(tx, companyId, 'DEFAULT_LANGUAGE');
    });
    return { success: true };
  }

  async saveStep5Currency(companyId: string, currencyId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.companyMaster)
        .set({ base_currency_id: currencyId })
        .where(eq(schema.companyMaster.company_id, companyId));

      await this.logStepCompletion(tx, companyId, 'BASE_CURRENCY');
    });
    return { success: true };
  }

  async saveStep6Timezone(companyId: string, timezoneId: string, countryId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.companyMaster)
        .set({ default_timezone_id: timezoneId, country_id: countryId })
        .where(eq(schema.companyMaster.company_id, companyId));

      await this.logStepCompletion(tx, companyId, 'TIMEZONE');
    });
    return { success: true };
  }

  async saveStep7Fiscal(dto: Step7FiscalDto) {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.companyFiscal)
        .where(eq(schema.companyFiscal.company_id, dto.company_id))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(schema.companyFiscal)
          .set({
            fiscal_year_format: dto.fiscal_year_format,
            fiscal_start_month: dto.fiscal_start_month,
            fiscal_start_day: dto.fiscal_start_day,
            fiscal_end_day: dto.fiscal_end_day || 31,
            current_fiscal_year: dto.current_fiscal_year,
            period_type: dto.period_type,
            accounting_standard: dto.accounting_standard,
            depreciation_method: dto.depreciation_method || 'SLM',
            inventory_valuation: dto.inventory_valuation,
            gst_filing_frequency: dto.gst_filing_frequency,
            tax_audit_applicable: dto.tax_audit_applicable || false,
            decimal_places: dto.decimal_places ?? 2,
          })
          .where(eq(schema.companyFiscal.company_id, dto.company_id));
      } else {
        await tx.insert(schema.companyFiscal).values({
          company_id: dto.company_id,
          fiscal_year_format: dto.fiscal_year_format,
          fiscal_start_month: dto.fiscal_start_month,
          fiscal_start_day: dto.fiscal_start_day,
          fiscal_end_day: dto.fiscal_end_day || 31,
          current_fiscal_year: dto.current_fiscal_year,
          period_type: dto.period_type,
          accounting_standard: dto.accounting_standard,
          depreciation_method: dto.depreciation_method || 'SLM',
          inventory_valuation: dto.inventory_valuation,
          gst_filing_frequency: dto.gst_filing_frequency,
          tax_audit_applicable: dto.tax_audit_applicable || false,
          decimal_places: dto.decimal_places ?? 2,
        });
      }

      await this.logStepCompletion(tx, dto.company_id, 'FISCAL_YEAR');
    });
    return { success: true };
  }

  async saveStep8Modules(companyId: string, modules: string[]) {
    const modulesList = modules || [];
    await this.db.transaction(async (tx) => {
      // Clear old module configs
      await tx.delete(schema.companyModules).where(eq(schema.companyModules.company_id, companyId));

      if (modulesList.length > 0) {
        const moduleInserts = modulesList.map((modCode) => ({
          module_id: randomUUID(),
          company_id: companyId,
          module_code: modCode,
          is_active: true,
          activated_on: new Date().toISOString().split('T')[0],
        }));

        await tx.insert(schema.companyModules).values(moduleInserts);
      }

      await this.logStepCompletion(tx, companyId, 'ENABLE_MODULES');
    });
    return { success: true };
  }

  async getWizardStatus(companyId: string) {
    const steps = await this.db
      .select()
      .from(schema.setupStepMaster)
      .orderBy(schema.setupStepMaster.step_order);

    const logs = await this.db
      .select()
      .from(schema.setupWizardLog)
      .where(eq(schema.setupWizardLog.company_id, companyId));

    return steps.map((step) => {
      const stepLog = logs.find((l) => l.step_id === step.step_id);
      return {
        stepCode: step.step_code,
        stepName: step.step_name,
        stepOrder: step.step_order,
        isMandatory: step.is_mandatory,
        status: stepLog ? stepLog.status : 'PENDING',
        completedAt: stepLog ? stepLog.completed_at : null,
      };
    });
  }

  async completeWizard(companyId: string) {
    const stepsStatus = await this.getWizardStatus(companyId);
    
    // Check steps 1 to 8 (mandatory setup configuration)
    const pendingMandatory = stepsStatus.filter(
      (s) => s.isMandatory && s.stepOrder < 9 && s.status !== 'COMPLETED',
    );

    if (pendingMandatory.length > 0) {
      const names = pendingMandatory.map((s) => s.stepName).join(', ');
      throw new BadRequestException(
        `Onboarding wizard cannot be completed. The following mandatory steps are pending: ${names}`,
      );
    }

    // Mark company onboarding as completed
    await this.db
      .update(schema.companyMaster)
      .set({ onboarding_status: 'COMPLETED' })
      .where(eq(schema.companyMaster.company_id, companyId));

    // Mark the final completion step as completed in log
    await this.logStepCompletion(this.db, companyId, 'SETUP_COMPLETE');

    // Provision a starter chart of accounts, GL mappings, and a default
    // warehouse — without this a brand-new company has no way to post a
    // batch or goods receipt until someone hand-builds a chart of accounts.
    const [company] = await this.db
      .select({ tenant_id: schema.companyMaster.tenant_id })
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);
    if (company) {
      await this.masterDataSeedService.seedStarterMasterData(company.tenant_id, companyId);
      await this.logStepCompletion(this.db, companyId, 'CHART_OF_ACCOUNTS');
      await this.logStepCompletion(this.db, companyId, 'MASTER_DATA_LOAD');
    }

    return {
      success: true,
      onboarding_status: 'COMPLETED',
      message: 'Onboarding setup wizard successfully completed. Dashboard unlocked.',
    };
  }

  // Internal Helper to log completions
  private async logStepCompletion(tx: any, companyId: string, stepCode: string) {
    const [step] = await tx
      .select()
      .from(schema.setupStepMaster)
      .where(eq(schema.setupStepMaster.step_code, stepCode))
      .limit(1);

    if (!step) return;

    const existingLog = await tx
      .select()
      .from(schema.setupWizardLog)
      .where(and(eq(schema.setupWizardLog.company_id, companyId), eq(schema.setupWizardLog.step_id, step.step_id)))
      .limit(1);

    if (existingLog.length > 0) {
      await tx
        .update(schema.setupWizardLog)
        .set({ status: 'COMPLETED', completed_at: new Date().toISOString().replace('T', ' ').substring(0, 19) })
        .where(eq(schema.setupWizardLog.log_id, existingLog[0].log_id));
    } else {
      await tx.insert(schema.setupWizardLog).values({
        log_id: randomUUID(),
        company_id: companyId,
        step_id: step.step_id,
        status: 'COMPLETED',
        completed_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
      });
    }
  }

  async listNobs(tenantId?: string) {
    const nobs = await this.masterDb
      .select()
      .from(masterSchema.nobMaster)
      .where(eq(masterSchema.nobMaster.is_active, true));
    if (!tenantId) return nobs;

    const [tenant] = await this.masterDb
      .select({ allowedNobIds: masterSchema.tenantMaster.allowed_nob_ids })
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, tenantId))
      .limit(1);
    if (!tenant?.allowedNobIds?.length) return nobs;
    const allowed = new Set(tenant.allowedNobIds);
    return nobs.filter((nob) => allowed.has(nob.nob_id));
  }

  async listLobs(nobId: string, tenantId?: string) {
    const lobs = await this.masterDb
      .select()
      .from(masterSchema.lobMaster)
      .where(and(eq(masterSchema.lobMaster.nob_id, nobId), eq(masterSchema.lobMaster.is_active, true)))
      .orderBy(masterSchema.lobMaster.sort_order);
    if (!tenantId) return lobs;

    const [tenant] = await this.masterDb
      .select({ allowedLobIds: masterSchema.tenantMaster.allowed_lob_ids })
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, tenantId))
      .limit(1);
    if (!tenant?.allowedLobIds?.length) return lobs;
    const allowed = new Set(tenant.allowedLobIds);
    return lobs.filter((lob) => allowed.has(lob.lob_id));
  }

  async getCompanySetupDetails(companyId: string) {
    const [company] = await this.db
      .select()
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);

    if (!company) {
      throw new NotFoundException(`Company profile with ID '${companyId}' not found.`);
    }

    const [address] = await this.db
      .select()
      .from(schema.companyAddress)
      .where(eq(schema.companyAddress.company_id, companyId))
      .limit(1);

    const [contact] = await this.db
      .select()
      .from(schema.companyContacts)
      .where(eq(schema.companyContacts.company_id, companyId))
      .limit(1);

    const [fiscal] = await this.db
      .select()
      .from(schema.companyFiscal)
      .where(eq(schema.companyFiscal.company_id, companyId))
      .limit(1);

    const modules = await this.db
      .select()
      .from(schema.companyModules)
      .where(eq(schema.companyModules.company_id, companyId));

    // The company's own currencies, joined to their codes. BBP-1 §1.1 gives a
    // company one base currency and treats the other as the foreign/local one,
    // so anything asking "which currencies may this company use" should read
    // this rather than the platform-wide catalog, which lists every currency
    // any tenant has ever needed.
    const currencies = await this.db
      .select({
        currency_id: schema.companyCurrencyConfig.currency_id,
        iso_code: schema.currencyMaster.iso_code,
        currency_name: schema.currencyMaster.currency_name,
        symbol: schema.currencyMaster.symbol,
        decimal_places: schema.currencyMaster.decimal_places,
        symbol_position: schema.currencyMaster.symbol_position,
        is_base: schema.companyCurrencyConfig.is_base,
        is_reporting: schema.companyCurrencyConfig.is_reporting,
      })
      .from(schema.companyCurrencyConfig)
      .innerJoin(schema.currencyMaster, eq(schema.companyCurrencyConfig.currency_id, schema.currencyMaster.currency_id))
      .where(eq(schema.companyCurrencyConfig.company_id, companyId))
      .orderBy(desc(schema.companyCurrencyConfig.is_base));

    return {
      company,
      address: address || null,
      contact: contact || null,
      fiscal: fiscal || null,
      currencies,
      modules: modules.map(m => m.module_code)
    };
  }

  async createNob(data: any) {
    const nobId = data.nob_id || randomUUID();
    await this.masterDb.insert(masterSchema.nobMaster).values({
      ...data,
      nob_id: nobId
    });
    const [newNob] = await this.masterDb.select().from(masterSchema.nobMaster).where(eq(masterSchema.nobMaster.nob_id, nobId)).limit(1);
    return newNob;
  }

  async updateNob(id: string, data: any) {
    await this.masterDb
      .update(masterSchema.nobMaster)
      .set(data)
      .where(eq(masterSchema.nobMaster.nob_id, id));
    
    const [updatedNob] = await this.masterDb.select().from(masterSchema.nobMaster).where(eq(masterSchema.nobMaster.nob_id, id)).limit(1);
    return updatedNob;
  }

  async deleteNob(id: string) {
    const [deletedNob] = await this.masterDb.select().from(masterSchema.nobMaster).where(eq(masterSchema.nobMaster.nob_id, id)).limit(1);
    
    await this.masterDb
      .delete(masterSchema.nobMaster)
      .where(eq(masterSchema.nobMaster.nob_id, id));
    
    return deletedNob;
  }

  async createLob(data: any) {
    const lobId = data.lob_id || randomUUID();
    await this.masterDb.insert(masterSchema.lobMaster).values({
      ...data,
      lob_id: lobId
    });
    const [newLob] = await this.masterDb.select().from(masterSchema.lobMaster).where(eq(masterSchema.lobMaster.lob_id, lobId)).limit(1);
    return newLob;
  }

  async updateLob(id: string, data: any) {
    await this.masterDb
      .update(masterSchema.lobMaster)
      .set(data)
      .where(eq(masterSchema.lobMaster.lob_id, id));
    
    const [updatedLob] = await this.masterDb.select().from(masterSchema.lobMaster).where(eq(masterSchema.lobMaster.lob_id, id)).limit(1);
    return updatedLob;
  }

  async deleteLob(id: string) {
    const [deletedLob] = await this.masterDb.select().from(masterSchema.lobMaster).where(eq(masterSchema.lobMaster.lob_id, id)).limit(1);
    
    await this.masterDb
      .delete(masterSchema.lobMaster)
      .where(eq(masterSchema.lobMaster.lob_id, id));
    
    return deletedLob;
  }
}

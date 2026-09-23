import { Injectable, ConflictException, NotFoundException, Inject, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, sql, and, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as masterSchema from '../../../core/database/master-schema';
import * as schema from '../../../core/database/schema';
import { SYSTEM_UOM_SEED, SYSTEM_SPECIES_SEED, SYSTEM_BREED_SEED, SYSTEM_ITEM_SEED, SYSTEM_PARAMETER_SEED, SYSTEM_STAGE_SEED, SYSTEM_NO_SERIES_SEED, SYSTEM_KPI_METRIC_SEED } from '../../../core/database/system-master-data-seed';
import { MASTER_CONNECTION } from '../../../core/database/database.module';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { SignupTenantDto } from './dto/signup-tenant.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { ConfigService } from '@nestjs/config';
import { DOCUMENTED_REASONS } from '../../../core/database/reason-code-seed';

@Injectable()
export class TenantService {
  constructor(
    @Inject(MASTER_CONNECTION)
    private readonly db: MySql2Database<typeof masterSchema>,
    private readonly connectionManager: ConnectionManagerService,
    private readonly auditService: AuditLogService,
    private readonly config: ConfigService,
  ) { }

  async signup(dto: SignupTenantDto) {
    // 1. Check if tenant code is already registered in master
    const existing = await this.db
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_code, dto.tenant_code.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Tenant subdomain code '${dto.tenant_code}' is already taken.`);
    }

    // 2. Fetch selected pricing plan configuration from plan_master
    const planId = dto.plan_id || 'PLAN_BASIC';
    const [plan] = await this.db
      .select()
      .from(masterSchema.planMaster)
      .where(eq(masterSchema.planMaster.plan_id, planId))
      .limit(1);

    if (!plan) {
      throw new NotFoundException(`Subscription plan '${planId}' does not exist.`);
    }

    const tenantId = randomUUID();
    const planStartDate = new Date().toISOString().split('T')[0];
    const dbName = `tenant_${dto.tenant_code.toLowerCase()}`;

    // 3. Create database on MySQL server
    try {
      await this.db.execute(sql.raw(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`));
    } catch (err) {
      throw new ConflictException(`Failed to create database for tenant '${dto.tenant_code}': ${err.message}`);
    }

    // 4. Provision tenant connection and run migrations
    let tenantDb;
    let adminId: string;
    try {
      tenantDb = await this.connectionManager.getTenantConnection({
        tenant_id: tenantId,
        db_host: this.config.get<string>('database.host') || 'localhost',
        db_port: this.config.get<number>('database.port') || 3306,
        db_name: dbName,
        db_user: this.config.get<string>('database.username') || 'root',
        db_password: this.config.get<string>('database.password') || '',
      });

      const { migrate } = await import('drizzle-orm/mysql2/migrator');
      await migrate(tenantDb as any, {
        migrationsFolder: `${__dirname}/drizzle/tenant`,
      });

      // Seed global localization data copies into new tenant database
      const masterLangs = await this.db.select().from(masterSchema.languageMaster);
      if (masterLangs.length > 0) {
        await tenantDb.insert(schema.languageMaster).values(masterLangs);
      }

      const masterCurrs = await this.db.select().from(masterSchema.currencyMaster);
      if (masterCurrs.length > 0) {
        await tenantDb.insert(schema.currencyMaster).values(masterCurrs);
      }

      const masterTimezones = await this.db.select().from(masterSchema.timezoneMaster);
      if (masterTimezones.length > 0) {
        await tenantDb.insert(schema.timezoneMaster).values(masterTimezones);
      }

      const masterCountries = await this.db.select().from(masterSchema.countryMaster);
      if (masterCountries.length > 0) {
        await tenantDb.insert(schema.countryMaster).values(masterCountries);
      }

      const masterStates = await this.db.select().from(masterSchema.stateProvince);
      if (masterStates.length > 0) {
        await tenantDb.insert(schema.stateProvince).values(masterStates);
      }

      const masterCostingMethods = await this.db.select().from(masterSchema.costingMethodConfig);
      if (masterCostingMethods.length > 0) {
        await tenantDb.insert(schema.costingMethodConfig).values(masterCostingMethods);
      }

      const masterSteps = await this.db.select().from(masterSchema.setupStepMaster);
      if (masterSteps.length > 0) {
        await tenantDb.insert(schema.setupStepMaster).values(masterSteps);
      }

      // Seed NOB/LOB master data copies into new tenant database
      const masterNobs = await this.db.select().from(masterSchema.nobMaster);
      if (masterNobs.length > 0) {
        await tenantDb.insert(schema.nobMaster).values(masterNobs);
      }

      const masterLobs = await this.db.select().from(masterSchema.lobMaster);
      if (masterLobs.length > 0) {
        await tenantDb.insert(schema.lobMaster).values(masterLobs);
      }

      // Seed system-generated, tenant-wide reference master data (company_id left
      // null so every company under this tenant shares the same base catalog).
      await tenantDb.insert(schema.uomMaster).values(
        SYSTEM_UOM_SEED.map((u) => ({ ...u, tenant_id: tenantId }))
      );
      await tenantDb.insert(schema.speciesMaster).values(
        SYSTEM_SPECIES_SEED.map((s) => ({ ...s, tenant_id: tenantId }))
      );
      await tenantDb.insert(schema.kpiMetricMaster).values(
        SYSTEM_KPI_METRIC_SEED.map((m) => ({ ...m, tenant_id: tenantId }))
      );

      // Default breeds/items per NOB/LOB, visible tenant-wide (company_id
      // null — same wildcard convention breed.service.ts/item.service.ts
      // already match on) so every company under this tenant starts with a
      // real catalog instead of empty dropdowns.
      const nobIdByCode = new Map(masterNobs.map((n) => [n.nob_code, n.nob_id]));
      const lobIdByCode = new Map(masterLobs.map((l) => [l.lob_code, l.lob_id]));
      const speciesRows = await tenantDb.select().from(schema.speciesMaster);
      const speciesIdByCode = new Map(speciesRows.map((s) => [s.species_code, s.species_id]));

      for (const breed of SYSTEM_BREED_SEED) {
        const nobId = nobIdByCode.get(breed.nob_code);
        const lobId = lobIdByCode.get(breed.lob_code);
        const speciesId = speciesIdByCode.get(breed.species_code);
        if (!nobId || !lobId) continue;
        await tenantDb.insert(schema.breedMaster).values({
          breed_id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          breed_code: breed.breed_code,
          breed_name: breed.breed_name,
          species_id: speciesId || null,
          breed_type: breed.breed_type,
          gestation_days: breed.gestation_days ?? null,
          lactation_days: breed.lactation_days ?? null,
          productive_life_months: breed.productive_life_months ?? null,
          residual_value_pct: breed.residual_value_pct?.toString() ?? null,
          productive_life_cycles: breed.productive_life_cycles ?? null,
          avg_litter_size_born: breed.avg_litter_size_born?.toString() ?? null,
          avg_litter_size_weaned: breed.avg_litter_size_weaned?.toString() ?? null,
          avg_weaning_weight_kg: breed.avg_weaning_weight_kg?.toString() ?? null,
          farrowing_rate_pct: breed.farrowing_rate_pct?.toString() ?? null,
          boar_doses_per_week: breed.boar_doses_per_week?.toString() ?? null,
          boar_productive_life_months: breed.boar_productive_life_months ?? null,
        });
      }

      const itemIdByCode = new Map<string, string>();
      for (const item of SYSTEM_ITEM_SEED) {
        const nobId = nobIdByCode.get(item.nob_code);
        const lobId = lobIdByCode.get(item.lob_code);
        if (!nobId || !lobId) continue;
        const itemId = randomUUID();
        itemIdByCode.set(item.item_code, itemId);
        await tenantDb.insert(schema.itemMaster).values({
          item_id: itemId,
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          item_code: item.item_code,
          item_name: item.item_name,
          item_type: item.item_type,
          uom_primary: item.uom_primary,
        });
      }

      // Default batch KPI parameters (CONSUMPTION/MORTALITY/OUTPUT) per
      // NOB/LOB — same tenant-wide wildcard convention as breed/item above.
      for (const param of SYSTEM_PARAMETER_SEED) {
        const nobId = nobIdByCode.get(param.nob_code);
        const lobId = lobIdByCode.get(param.lob_code);
        if (!nobId || !lobId) continue;
        const itemId = param.item_code ? itemIdByCode.get(param.item_code) : undefined;
        await tenantDb.insert(schema.parameterMaster).values({
          parameter_id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          parameter_code: param.parameter_code,
          parameter_name: param.parameter_name,
          parameter_type: param.parameter_type,
          item_id: itemId || null,
          default_uom: param.default_uom,
          qty_method: param.qty_method,
          default_qty_per_unit: param.default_qty_per_unit != null ? param.default_qty_per_unit.toString() : null,
          default_qty_per_batch: param.default_qty_per_batch != null ? param.default_qty_per_batch.toString() : null,
          is_mandatory: param.is_mandatory ?? false,
        });
      }

      // The eight BBP LVS_PIGGERY production stages (see SYSTEM_STAGE_SEED — piggery-only,
      // other LOBs get theirs via the normal Stage CRUD API once documented). Two passes,
      // not one: next_stage_id/alt_next_stage_id are FKs MySQL checks per-statement (no
      // deferred constraint checking like Postgres), and BOAR_AI even points at itself —
      // so every row is inserted first with those two columns null, then a second pass
      // of UPDATEs wires the chain now that every row actually exists.
      const pigLobId = lobIdByCode.get('LVS_PIGGERY');
      const pigNobId = nobIdByCode.get('LIVESTOCK');
      if (pigLobId && pigNobId) {
        for (const reason of DOCUMENTED_REASONS) {
          await tenantDb.insert(schema.reasonMaster).values({ ...reason, reason_id: randomUUID(), tenant_id: tenantId, company_id: null });
        }
        const stageIdByCode = new Map(SYSTEM_STAGE_SEED.map((s) => [s.stage_code, randomUUID()]));

        for (const stage of SYSTEM_STAGE_SEED) {
          await tenantDb.insert(schema.stageMaster).values({
            stage_id: stageIdByCode.get(stage.stage_code)!,
            tenant_id: tenantId,
            company_id: null,
            nob_id: pigNobId,
            lob_id: pigLobId,
            stage_code: stage.stage_code,
            stage_name: stage.stage_name,
            stage_category: stage.stage_category,
            stage_sequence: stage.stage_sequence,
            typical_duration_days: stage.typical_duration_days ?? null,
            min_days_before_move: stage.min_days_before_move,
            transition_trigger: stage.transition_trigger,
            auto_move_on_day: stage.auto_move_on_day ?? null,
            alt_trigger_condition: stage.alt_trigger_condition || null,
            data_entry_form: stage.data_entry_form,
            show_on_animal_card: stage.show_on_animal_card,
            stage_description: stage.stage_description,
            sort_order: stage.stage_sequence,
            is_system: true,
          });
        }

        for (const stage of SYSTEM_STAGE_SEED) {
          if (!stage.next_stage_code && !stage.alt_next_stage_code) continue;
          await tenantDb
            .update(schema.stageMaster)
            .set({
              next_stage_id: stage.next_stage_code ? stageIdByCode.get(stage.next_stage_code) || null : null,
              alt_next_stage_id: stage.alt_next_stage_code ? stageIdByCode.get(stage.alt_next_stage_code) || null : null,
            })
            .where(eq(schema.stageMaster.stage_id, stageIdByCode.get(stage.stage_code)!));
        }
      }

      // Number Series (see SYSTEM_NO_SERIES_SEED) — BATCH is tenant-wide; generateBatchNo() in
      // batch.service.ts relies on it existing for every tenant. ANIMAL_PIGGERY is scoped to
      // LIVESTOCK/LVS_PIGGERY, skipped if that NOB/LOB combo isn't seeded for this tenant.
      for (const series of SYSTEM_NO_SERIES_SEED) {
        const seriesNobId = series.nob_code ? nobIdByCode.get(series.nob_code) : undefined;
        const seriesLobId = series.lob_code ? lobIdByCode.get(series.lob_code) : undefined;
        if ((series.nob_code && !seriesNobId) || (series.lob_code && !seriesLobId)) continue;

        await tenantDb.insert(schema.noSeries).values({
          id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: seriesNobId || null,
          lob_id: seriesLobId || null,
          code: series.series_code,
          description: series.series_name,
          document_type: series.document_type,
          prefix: series.prefix || null,
          separator: series.separator,
          seq_separator: series.seq_separator || null,
          seq_length: series.seq_length,
          current_seq: 0,
          reset_frequency: series.reset_frequency,
          manual_nos: series.allow_manual ?? false,
          code_segments: series.code_segments ?? null,
          prefix_position: series.prefix_position ?? 'END',
        });
      }

      // Seed placeholder company to prevent foreign key errors for initial user registration
      const defaultLangId = masterLangs.find(l => l.is_system_default)?.lang_id || masterLangs[0]?.lang_id || '10000000-1000-1000-1000-100000000001';
      // USD by iso_code first — `masterCurrs[0]` is INR, which is only the
      // first row of an unordered ISO reference list, not a default.
      const defaultCurrId = masterCurrs.find(c => c.iso_code === 'USD')?.currency_id || masterCurrs.find(c => c.is_system_default)?.currency_id || masterCurrs[0]?.currency_id || '20000000-2000-2000-2000-200000000002';
      await tenantDb.insert(schema.companyMaster).values({
        company_id: '00000000-0000-0000-0000-000000000000',
        tenant_id: tenantId,
        company_code: 'PLACEHOLDER',
        company_name: 'Placeholder Company',
        company_type: 'Pvt Ltd',
        industry_type: 'Poultry Farming',
        base_currency_id: defaultCurrId,
        default_language_id: defaultLangId,
        default_timezone_id: 'UTC',
        country_id: 'ZWE',
        onboarding_status: 'PENDING',
        is_active: true,
      });

      // Seed initial Tenant Administrator account
      adminId = randomUUID();
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(dto.admin_password, 10);
      await tenantDb.insert(schema.userMaster).values({
        user_id: adminId,
        company_id: '00000000-0000-0000-0000-000000000000',
        tenant_id: tenantId,
        full_name: dto.admin_name,
        email: dto.admin_email.toLowerCase(),
        phone: '',
        password_hash: passwordHash,
        user_type: 'TENANT_ADMIN',
        timezone_pref_id: 'Asia/Kolkata',
      });
    } catch (err) {
      // Rollback database creation if provisioning/migration/seeding failed
      await this.db.execute(sql.raw(`DROP DATABASE IF EXISTS \`${dbName}\`;`));
      throw new BadRequestException(`Failed to provision tenant database: ${err.message}`);
    }

    // 5. Register tenant and subscription in master database
    try {
      return await this.db.transaction(async (tx) => {
        await tx
          .insert(masterSchema.tenantMaster)
          .values({
            tenant_id: tenantId,
            tenant_code: dto.tenant_code.toLowerCase(),
            tenant_name: dto.tenant_name,
            tenant_type: dto.tenant_type || 'SME',
            plan_id: plan.plan_id,
            plan_start_date: planStartDate,
            billing_email: dto.billing_email,
            billing_cycle: plan.billing_cycle,
            max_companies: plan.max_companies,
            max_users: plan.max_users,
            api_rate_limit: plan.plan_id === 'PLAN_ENTERPRISE' ? 5000 : 1000,
            allowed_nob_ids: dto.allowed_nob_ids || null,
            allowed_lob_ids: dto.allowed_lob_ids || null,
            db_host: this.config.get<string>('database.host') || 'localhost',
            db_port: this.config.get<number>('database.port') || 3306,
            db_name: dbName,
            db_user: this.config.get<string>('database.username') || 'root',
            db_password: this.config.get<string>('database.password') || '',
          });

        await tx
          .insert(masterSchema.tenantSubscription)
          .values({
            tenant_id: tenantId,
            plan_code: plan.plan_id,
            storage_limit_gb: plan.storage_limit_gb,
            support_tier: plan.plan_id === 'PLAN_ENTERPRISE' ? 'PREMIUM' : 'STANDARD',
            sla_uptime_pct: plan.plan_id === 'PLAN_ENTERPRISE' ? '99.90' : '99.50',
            renewal_auto: true,
            feature_flags: plan.feature_flags,
          });

        const [tenant] = await tx
          .select()
          .from(masterSchema.tenantMaster)
          .where(eq(masterSchema.tenantMaster.tenant_id, tenantId))
          .limit(1);

        // Central email -> tenant index used by login (see UserDirectoryService).
        // Inserted in the same transaction as tenantMaster since it FK-references it.
        await tx
          .insert(masterSchema.userAuthIndex)
          .values({ email: dto.admin_email.toLowerCase(), user_id: adminId, tenant_id: tenantId })
          .onDuplicateKeyUpdate({
            set: { user_id: adminId, tenant_id: tenantId },
          });

        // Write Audit Log on control plane
        await this.auditService.log(
          {
            tenantId: tenant.tenant_id,
            action: 'CREATE',
            entityName: 'tenant_master',
            entityId: tenant.tenant_id,
            newValues: tenant,
          },
          tx,
        );

        return tenant;
      });
    } catch (err) {
      // Rollback database if metadata registration fails
      await this.db.execute(sql.raw(`DROP DATABASE IF EXISTS \`${dbName}\`;`));
      throw err;
    }
  }

  async findOne(id: string) {
    const [tenant] = await this.db
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, id))
      .limit(1);

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID '${id}' not found.`);
    }

    // Fetch subscription detail from master
    const [subscription] = await this.db
      .select()
      .from(masterSchema.tenantSubscription)
      .where(eq(masterSchema.tenantSubscription.tenant_id, id))
      .limit(1);

    return {
      ...tenant,
      subscription,
    };
  }

  async findByCode(code: string) {
    const [tenant] = await this.db
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_code, code.toLowerCase()))
      .limit(1);

    if (!tenant) {
      throw new NotFoundException(`Active tenant with code '${code}' not found.`);
    }

    const [subscription] = await this.db
      .select()
      .from(masterSchema.tenantSubscription)
      .where(eq(masterSchema.tenantSubscription.tenant_id, tenant.tenant_id))
      .limit(1);

    return {
      ...tenant,
      subscription,
    };
  }

  async findAll() {
    return this.db.select().from(masterSchema.tenantMaster);
  }

  async getTenantCompanies(tenantId: string) {
    const tenant = await this.findOne(tenantId);
    const tenantDb = await this.connectionManager.getTenantConnection(tenant);
    return tenantDb
      .select()
      .from(schema.companyMaster)
      .where(and(
        ne(schema.companyMaster.company_code, 'PLACEHOLDER'),
        eq(schema.companyMaster.is_active, true),
      ));
  }

  async getTenantUsers(tenantId: string) {
    const tenant = await this.findOne(tenantId);
    const tenantDb = await this.connectionManager.getTenantConnection(tenant);

    const rows = await tenantDb
      .select({
        user_id: schema.userMaster.user_id,
        company_id: schema.userMaster.company_id,
        tenant_id: schema.userMaster.tenant_id,
        full_name: schema.userMaster.full_name,
        email: schema.userMaster.email,
        phone: schema.userMaster.phone,
        user_type: schema.userMaster.user_type,
        is_active: schema.userMaster.is_active,
        role_id: schema.roleMaster.role_id,
        role_code: schema.roleMaster.role_code,
        role_name: schema.roleMaster.role_name,
      })
      .from(schema.userMaster)
      .leftJoin(
        schema.userRoleAssignment,
        and(
          eq(schema.userMaster.user_id, schema.userRoleAssignment.user_id),
          eq(schema.userRoleAssignment.is_active, true)
        )
      )
      .leftJoin(
        schema.roleMaster,
        eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id)
      );

    const seen = new Map<string, any>();
    for (const row of rows) {
      if (!seen.has(row.user_id)) {
        seen.set(row.user_id, {
          user_id: row.user_id,
          company_id: row.company_id,
          tenant_id: row.tenant_id,
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          user_type: row.user_type,
          is_active: row.is_active,
          roles: row.role_id ? [{ role_id: row.role_id, role_code: row.role_code, role_name: row.role_name }] : [],
        });
      } else if (row.role_id) {
        seen.get(row.user_id).roles.push({ role_id: row.role_id, role_code: row.role_code, role_name: row.role_name });
      }
    }
    return Array.from(seen.values());
  }

  async update(id: string, dto: UpdateTenantDto) {
    if (id === '00000000-0000-0000-0000-000000000000' && dto.is_active === false) {
      throw new BadRequestException('Cannot deactivate the platform administration tenant.');
    }

    const existing = await this.findOne(id);

    return this.db.transaction(async (tx) => {
      await tx
        .update(masterSchema.tenantMaster)
        .set({
          tenant_name: dto.tenant_name !== undefined ? dto.tenant_name : undefined,
          tenant_type: dto.tenant_type !== undefined ? dto.tenant_type : undefined,
          billing_email: dto.billing_email !== undefined ? dto.billing_email : undefined,
          is_active: dto.is_active !== undefined ? dto.is_active : undefined,
          allowed_nob_ids: dto.allowed_nob_ids !== undefined ? dto.allowed_nob_ids : undefined,
          allowed_lob_ids: dto.allowed_lob_ids !== undefined ? dto.allowed_lob_ids : undefined,
        })
        .where(eq(masterSchema.tenantMaster.tenant_id, id));

      const [updated] = await tx
        .select()
        .from(masterSchema.tenantMaster)
        .where(eq(masterSchema.tenantMaster.tenant_id, id))
        .limit(1);

      // Write Audit Log
      await this.auditService.log(
        {
          tenantId: id,
          action: 'UPDATE',
          entityName: 'tenant_master',
          entityId: id,
          oldValues: existing,
          newValues: updated,
        },
        tx,
      );

      return updated;
    });
  }

  async changePlan(id: string, dto: ChangePlanDto) {
    if (id === '00000000-0000-0000-0000-000000000000') {
      throw new BadRequestException('Cannot change the subscription plan of the platform administration tenant.');
    }

    const existing = await this.findOne(id);

    // Resolve plan configuration
    const [plan] = await this.db
      .select()
      .from(masterSchema.planMaster)
      .where(eq(masterSchema.planMaster.plan_id, dto.plan_id))
      .limit(1);

    if (!plan) {
      throw new NotFoundException(`Subscription plan '${dto.plan_id}' does not exist.`);
    }

    return this.db.transaction(async (tx) => {
      // 1. Update tenant master attributes
      await tx
        .update(masterSchema.tenantMaster)
        .set({
          plan_id: plan.plan_id,
          max_companies: plan.max_companies,
          max_users: plan.max_users,
          billing_cycle: plan.billing_cycle,
          api_rate_limit: plan.plan_id === 'PLAN_ENTERPRISE' ? 5000 : 1000,
        })
        .where(eq(masterSchema.tenantMaster.tenant_id, id));

      const [updatedTenant] = await tx
        .select()
        .from(masterSchema.tenantMaster)
        .where(eq(masterSchema.tenantMaster.tenant_id, id))
        .limit(1);

      // 2. Update tenant subscription limits
      await tx
        .update(masterSchema.tenantSubscription)
        .set({
          plan_code: plan.plan_id,
          storage_limit_gb: plan.storage_limit_gb,
          support_tier: plan.plan_id === 'PLAN_ENTERPRISE' ? 'PREMIUM' : 'STANDARD',
          sla_uptime_pct: plan.plan_id === 'PLAN_ENTERPRISE' ? '99.90' : '99.50',
          feature_flags: plan.feature_flags,
        })
        .where(eq(masterSchema.tenantSubscription.tenant_id, id));

      const [updatedSubscription] = await tx
        .select()
        .from(masterSchema.tenantSubscription)
        .where(eq(masterSchema.tenantSubscription.tenant_id, id))
        .limit(1);

      // Write Audit Log
      await this.auditService.log(
        {
          tenantId: id,
          action: 'CHANGE_PLAN',
          entityName: 'tenant_master',
          entityId: id,
          oldValues: {
            plan_id: existing.plan_id,
            max_companies: existing.max_companies,
            max_users: existing.max_users,
            billing_cycle: existing.billing_cycle,
            subscription: existing.subscription,
          },
          newValues: {
            plan_id: updatedTenant.plan_id,
            max_companies: updatedTenant.max_companies,
            max_users: updatedTenant.max_users,
            billing_cycle: updatedTenant.billing_cycle,
            subscription: updatedSubscription,
          },
        },
        tx,
      );

      return {
        tenant: updatedTenant,
        subscription: updatedSubscription,
      };
    });
  }

  async remove(id: string) {
    if (id === '00000000-0000-0000-0000-000000000000') {
      throw new BadRequestException('Cannot delete the platform administration tenant.');
    }

    const [tenant] = await this.db
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, id))
      .limit(1);

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID '${id}' not found.`);
    }

    // Must use the tenant's registered db_name, not a recomputed tenant_<code> —
    // they can differ (e.g. under an isolated DATABASE_NAME), and dropping the
    // wrong physical database here is unrecoverable.
    const dbName = tenant.db_name;

    // 1. Drop dynamic MySQL database
    try {
      await this.db.execute(sql.raw(`DROP DATABASE IF EXISTS \`${dbName}\`;`));
    } catch (err) {
      console.error(`Failed to drop database ${dbName}:`, err);
    }

    // 2. Perform deletion in master tables using a transaction
    await this.db.transaction(async (tx) => {
      await tx
        .delete(masterSchema.tenantSubscription)
        .where(eq(masterSchema.tenantSubscription.tenant_id, id));

      await tx
        .delete(masterSchema.tenantMaster)
        .where(eq(masterSchema.tenantMaster.tenant_id, id));
    });

    return { success: true, message: `Tenant ${tenant.tenant_name} and its subscription database deleted successfully.` };
  }
}

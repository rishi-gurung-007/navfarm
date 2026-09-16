import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { CreateOperationalAreaDto, UpdateOperationalAreaDto, UpdateAreaSettingsDto, AssignAreaStaffDto, PreseedSource } from './dto/operational-area.dto';
import * as crypto from 'crypto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

@Injectable()
export class OperationalAreaService {
  constructor(
    private readonly cls: ClsService,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private get tenantId(): string {
    const tid = this.cls.get<string>('tenantId');
    return tid || '00000000-0000-0000-0000-000000000000';
  }

  async findAll(companyId?: string) {
    const baseQuery = this.db
      .select({
        area_id: schema.operationalAreaMaster.area_id,
        tenant_id: schema.operationalAreaMaster.tenant_id,
        company_id: schema.operationalAreaMaster.company_id,
        company_name: schema.companyMaster.company_name,
        farm_id: schema.operationalAreaMaster.farm_id,
        nob_id: schema.operationalAreaMaster.nob_id,
        nob_code: schema.nobMaster.nob_code,
        nob_name: schema.nobMaster.nob_name,
        lob_id: schema.operationalAreaMaster.lob_id,
        lob_code: schema.lobMaster.lob_code,
        lob_name: schema.lobMaster.lob_name,
        area_code: schema.operationalAreaMaster.area_code,
        area_name: schema.operationalAreaMaster.area_name,
        description: schema.operationalAreaMaster.description,
        preseed_source: schema.operationalAreaMaster.preseed_source,
        is_active: schema.operationalAreaMaster.is_active,
        status: schema.operationalAreaMaster.status,
        created_at: schema.operationalAreaMaster.created_at,
      })
      .from(schema.operationalAreaMaster)
      .leftJoin(schema.companyMaster, eq(schema.operationalAreaMaster.company_id, schema.companyMaster.company_id))
      .leftJoin(schema.nobMaster, eq(schema.operationalAreaMaster.nob_id, schema.nobMaster.nob_id))
      .leftJoin(schema.lobMaster, eq(schema.operationalAreaMaster.lob_id, schema.lobMaster.lob_id));

    if (companyId) {
      return baseQuery
        .where(
          and(
            eq(schema.operationalAreaMaster.tenant_id, this.tenantId),
            eq(schema.operationalAreaMaster.company_id, companyId),
            eq(schema.operationalAreaMaster.is_active, true)
          )
        )
        .orderBy(desc(schema.operationalAreaMaster.created_at));
    }

    return baseQuery
      .where(
        and(
          eq(schema.operationalAreaMaster.tenant_id, this.tenantId),
          eq(schema.operationalAreaMaster.is_active, true)
        )
      )
      .orderBy(desc(schema.operationalAreaMaster.created_at));
  }

  async findOne(id: string) {
    const [area] = await this.db
      .select({
        area_id: schema.operationalAreaMaster.area_id,
        tenant_id: schema.operationalAreaMaster.tenant_id,
        company_id: schema.operationalAreaMaster.company_id,
        company_name: schema.companyMaster.company_name,
        farm_id: schema.operationalAreaMaster.farm_id,
        nob_id: schema.operationalAreaMaster.nob_id,
        nob_code: schema.nobMaster.nob_code,
        nob_name: schema.nobMaster.nob_name,
        lob_id: schema.operationalAreaMaster.lob_id,
        lob_code: schema.lobMaster.lob_code,
        lob_name: schema.lobMaster.lob_name,
        area_code: schema.operationalAreaMaster.area_code,
        area_name: schema.operationalAreaMaster.area_name,
        description: schema.operationalAreaMaster.description,
        preseed_source: schema.operationalAreaMaster.preseed_source,
        is_active: schema.operationalAreaMaster.is_active,
        status: schema.operationalAreaMaster.status,
        created_at: schema.operationalAreaMaster.created_at,
      })
      .from(schema.operationalAreaMaster)
      .leftJoin(schema.companyMaster, eq(schema.operationalAreaMaster.company_id, schema.companyMaster.company_id))
      .leftJoin(schema.nobMaster, eq(schema.operationalAreaMaster.nob_id, schema.nobMaster.nob_id))
      .leftJoin(schema.lobMaster, eq(schema.operationalAreaMaster.lob_id, schema.lobMaster.lob_id))
      .where(
        and(
          eq(schema.operationalAreaMaster.area_id, id),
          eq(schema.operationalAreaMaster.tenant_id, this.tenantId)
        )
      )
      .limit(1);

    if (!area) {
      throw new NotFoundException(`Operational Area with ID '${id}' not found.`);
    }

    return area;
  }

  async create(dto: CreateOperationalAreaDto, userId?: string) {
    // 1. Verify code uniqueness within company
    const existing = await this.db
      .select()
      .from(schema.operationalAreaMaster)
      .where(
        and(
          eq(schema.operationalAreaMaster.company_id, dto.company_id),
          eq(schema.operationalAreaMaster.area_code, dto.area_code.toUpperCase()),
          eq(schema.operationalAreaMaster.is_active, true)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Operational Area with code '${dto.area_code}' already exists in this company.`);
    }

    const areaId = crypto.randomUUID();

    // 2. Insert area record
    await this.db.insert(schema.operationalAreaMaster).values({
      area_id: areaId,
      tenant_id: this.tenantId,
      company_id: dto.company_id,
      farm_id: dto.farm_id || null,
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
      area_code: dto.area_code.toUpperCase(),
      area_name: dto.area_name,
      description: dto.description || null,
      preseed_source: dto.preseed_source || PreseedSource.TENANT,
      is_active: dto.is_active ?? true,
      created_by: userId || null,
    });

    // Areas share company-owned masters filtered by their LOB. Creating a
    // second area must not clone items or invent physical farms and sheds.

    const created = await this.findOne(areaId);
    await this.audit?.recordChange({
      action: 'CREATE',
      entityName: 'operational_area_master',
      entityId: areaId,
      after: created as Record<string, any>,
      tenantId: this.tenantId,
      companyId: dto.company_id,
      userId,
    });
    return created;
  }

  async update(id: string, dto: UpdateOperationalAreaDto, userId?: string) {
    const area = await this.findOne(id);

    await this.db
      .update(schema.operationalAreaMaster)
      .set({
        area_name: dto.area_name ?? area.area_name,
        description: dto.description ?? area.description,
        farm_id: dto.farm_id ?? area.farm_id,
        is_active: dto.is_active ?? area.is_active,
        updated_by: userId || null,
      })
      .where(eq(schema.operationalAreaMaster.area_id, id));

    const updated = await this.findOne(id);
    await this.audit?.recordChange({
      action: 'UPDATE',
      entityName: 'operational_area_master',
      entityId: id,
      before: area as Record<string, any>,
      after: updated as Record<string, any>,
      tenantId: this.tenantId,
      companyId: (area as any).company_id,
      userId,
    });
    return updated;
  }

  async delete(id: string, userId?: string) {
    const area = await this.findOne(id);
    await this.db
      .update(schema.operationalAreaMaster)
      .set({ is_active: false })
      .where(eq(schema.operationalAreaMaster.area_id, id));
    await this.audit?.recordChange({
      action: 'DELETE',
      entityName: 'operational_area_master',
      entityId: id,
      before: area as Record<string, any>,
      after: { ...(area as Record<string, any>), is_active: false },
      tenantId: this.tenantId,
      companyId: (area as any).company_id,
      userId,
    });
    return { success: true, message: `Operational Area '${area.area_name}' deactivated.` };
  }

  async preseedCompanyMasterDataFromTenant(_companyId: string) {
    throw new BadRequestException('Tenant templates are copied when a company is created. Existing company masters are independent; repeated preseed is no longer supported.');
  }

  /**
   * Everything the Area Settings screen needs, in one call: the area's identity
   * (read from the area master — never stored twice), its operating settings,
   * and the people assigned to it (read from user_operational_area_assignment).
   *
   * Settings come back with defaults applied rather than null when the area has
   * no row yet, so the screen renders a usable form on first visit instead of
   * empty inputs.
   */
  async getSettings(areaId: string) {
    const [area] = await this.db
      .select({
        area_id: schema.operationalAreaMaster.area_id,
        area_code: schema.operationalAreaMaster.area_code,
        area_name: schema.operationalAreaMaster.area_name,
        description: schema.operationalAreaMaster.description,
        company_id: schema.operationalAreaMaster.company_id,
        tenant_id: schema.operationalAreaMaster.tenant_id,
        company_name: schema.companyMaster.company_name,
        farm_id: schema.operationalAreaMaster.farm_id,
        farm_name: schema.locationMaster.location_name,
        nob_id: schema.operationalAreaMaster.nob_id,
        nob_code: schema.nobMaster.nob_code,
        nob_name: schema.nobMaster.nob_name,
        lob_id: schema.operationalAreaMaster.lob_id,
        lob_code: schema.lobMaster.lob_code,
        lob_name: schema.lobMaster.lob_name,
        status: schema.operationalAreaMaster.status,
      })
      .from(schema.operationalAreaMaster)
      .leftJoin(schema.companyMaster, eq(schema.companyMaster.company_id, schema.operationalAreaMaster.company_id))
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.operationalAreaMaster.farm_id))
      .leftJoin(schema.nobMaster, eq(schema.nobMaster.nob_id, schema.operationalAreaMaster.nob_id))
      .leftJoin(schema.lobMaster, eq(schema.lobMaster.lob_id, schema.operationalAreaMaster.lob_id))
      .where(eq(schema.operationalAreaMaster.area_id, areaId))
      .limit(1);

    if (!area) throw new NotFoundException('Operational area not found.');

    const [row] = await this.db
      .select()
      .from(schema.operationalAreaSettings)
      .where(eq(schema.operationalAreaSettings.area_id, areaId))
      .limit(1);

    const settings = {
      costing_method: row?.costing_method ?? 'STANDARD',
      default_feed_uom: row?.default_feed_uom ?? 'KG',
      mortality_threshold_pct: row?.mortality_threshold_pct !== undefined && row?.mortality_threshold_pct !== null ? Number(row.mortality_threshold_pct) : null,
      temp_threshold_min: row?.temp_threshold_min !== undefined && row?.temp_threshold_min !== null ? Number(row.temp_threshold_min) : null,
      temp_threshold_max: row?.temp_threshold_max !== undefined && row?.temp_threshold_max !== null ? Number(row.temp_threshold_max) : null,
      auto_approve_ration_under_qty:
        row?.auto_approve_ration_under_qty !== undefined && row?.auto_approve_ration_under_qty !== null ? Number(row.auto_approve_ration_under_qty) : null,
      lob_config: (row?.lob_config as Record<string, unknown>) ?? {},
      configured: Boolean(row),
      updated_at: row?.updated_at ?? null,
    };

    return { area, settings, staff: await this.listStaff(areaId) };
  }

  async updateSettings(areaId: string, dto: UpdateAreaSettingsDto, userId?: string) {
    const [area] = await this.db
      .select({ area_id: schema.operationalAreaMaster.area_id, company_id: schema.operationalAreaMaster.company_id, tenant_id: schema.operationalAreaMaster.tenant_id })
      .from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.area_id, areaId))
      .limit(1);
    if (!area) throw new NotFoundException('Operational area not found.');

    const num = (v?: number | null) => (v === undefined || v === null ? null : String(v));
    const values = {
      costing_method: dto.costing_method ?? 'STANDARD',
      default_feed_uom: dto.default_feed_uom ?? 'KG',
      mortality_threshold_pct: num(dto.mortality_threshold_pct),
      temp_threshold_min: num(dto.temp_threshold_min),
      temp_threshold_max: num(dto.temp_threshold_max),
      auto_approve_ration_under_qty: num(dto.auto_approve_ration_under_qty),
      lob_config: dto.lob_config ?? {},
      updated_by: userId || null,
    };

    // The whole settings row, not just its id: the audit entry has to say what
    // the thresholds and the costing method were before this call changed them.
    const [existing] = await this.db
      .select()
      .from(schema.operationalAreaSettings)
      .where(eq(schema.operationalAreaSettings.area_id, areaId))
      .limit(1);

    if (existing) {
      await this.db
        .update(schema.operationalAreaSettings)
        .set(values)
        .where(eq(schema.operationalAreaSettings.area_id, areaId));
    } else {
      await this.db.insert(schema.operationalAreaSettings).values({
        setting_id: crypto.randomUUID(),
        tenant_id: area.tenant_id,
        company_id: area.company_id,
        area_id: areaId,
        created_by: userId || null,
        ...values,
      });
    }

    await this.audit?.recordChange({
      action: existing ? 'UPDATE' : 'CREATE',
      entityName: 'operational_area_settings',
      entityId: areaId,
      before: existing ?? null,
      after: { ...(existing ?? {}), ...values },
      tenantId: area.tenant_id,
      companyId: area.company_id ?? undefined,
      userId,
    });

    return this.getSettings(areaId);
  }

  /** The people assigned to this area — the real assignment table, not a list kept on the client. */
  async listStaff(areaId: string) {
    return this.db
      .select({
        assignment_id: schema.userOperationalAreaAssignment.assignment_id,
        user_id: schema.userMaster.user_id,
        full_name: schema.userMaster.full_name,
        email: schema.userMaster.email,
        user_type: schema.userMaster.user_type,
        is_active: schema.userMaster.is_active,
        is_primary: schema.userOperationalAreaAssignment.is_primary,
      })
      .from(schema.userOperationalAreaAssignment)
      .innerJoin(schema.userMaster, eq(schema.userMaster.user_id, schema.userOperationalAreaAssignment.user_id))
      .where(eq(schema.userOperationalAreaAssignment.area_id, areaId))
      .orderBy(schema.userMaster.full_name);
  }

  /**
   * Assigns an EXISTING user to the area. Deliberately does not create users:
   * the old screen invented staff rows out of a name and an email, which
   * produced people who could never log in. Inviting a new user stays the
   * User Management screen's job.
   */
  async addStaff(areaId: string, dto: AssignAreaStaffDto) {
    const [area] = await this.db
      .select({ area_id: schema.operationalAreaMaster.area_id, company_id: schema.operationalAreaMaster.company_id })
      .from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.area_id, areaId))
      .limit(1);
    if (!area) throw new NotFoundException('Operational area not found.');

    let userId = dto.user_id;
    if (!userId && dto.email) {
      const [user] = await this.db
        .select({ user_id: schema.userMaster.user_id })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.email, dto.email))
        .limit(1);
      if (!user) throw new NotFoundException(`No user exists with the email ${dto.email}. Invite them from User Management first.`);
      userId = user.user_id;
    }
    if (!userId) throw new BadRequestException('Provide either user_id or the email of an existing user.');

    const [already] = await this.db
      .select({ assignment_id: schema.userOperationalAreaAssignment.assignment_id })
      .from(schema.userOperationalAreaAssignment)
      .where(and(eq(schema.userOperationalAreaAssignment.area_id, areaId), eq(schema.userOperationalAreaAssignment.user_id, userId)))
      .limit(1);
    if (already) throw new ConflictException('That user is already assigned to this area.');

    await this.db.insert(schema.userOperationalAreaAssignment).values({
      assignment_id: crypto.randomUUID(),
      user_id: userId,
      area_id: areaId,
      company_id: area.company_id,
      is_primary: dto.is_primary ?? false,
    });

    return this.listStaff(areaId);
  }

  async removeStaff(areaId: string, userId: string) {
    await this.db
      .delete(schema.userOperationalAreaAssignment)
      .where(and(eq(schema.userOperationalAreaAssignment.area_id, areaId), eq(schema.userOperationalAreaAssignment.user_id, userId)));
    return this.listStaff(areaId);
  }
}

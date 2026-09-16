import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, sql, inArray, isNull, asc } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateUserDto, UpdateUserDto, QueryUserDto } from './dto/user.dto';
import { UserDirectoryService } from '../../../core/database/user-directory.service';
import { canAssignUserType, isTenantLevelUserType, outranks } from '../../../common/user-type-hierarchy';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

/**
 * The validated JWT user (JwtStrategy re-reads user_master on every request),
 * so userType is the database value, never anything from the request body.
 */
export interface RequestingUser {
  userId: string;
  tenantId: string;
  userType: string;
  companyId?: string | null;
}

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

/** Never returned by the API and never copied into an audit row. */
function withoutSecrets<T extends Record<string, any>>(row: T): Omit<T, 'password_hash' | 'mfa_secret'> {
  const { password_hash: _hash, mfa_secret: _secret, ...rest } = row;
  return rest;
}

@Injectable()
export class UserService {
  constructor(
    private readonly cls: ClsService,
    private readonly userDirectory: UserDirectoryService,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * One audit row per user change. A failed audit write is reported, not
   * raised: the account change has already committed and a 500 would only
   * invite a duplicate retry.
   */
  private async record(requester: RequestingUser | undefined, user: { user_id: string; tenant_id: string; company_id: string | null }, action: string, oldValues?: unknown, newValues?: unknown) {
    try {
      await this.audit?.log({
        tenantId: user.tenant_id,
        companyId: user.company_id || undefined,
        userId: requester?.userId,
        action,
        entityName: 'user_master',
        entityId: user.user_id,
        oldValues,
        newValues,
      });
    } catch (e) {
      console.error(`Failed to write ${action} audit row for user ${user.user_id}:`, e);
    }
  }

  async create(dto: CreateUserDto, requester: RequestingUser) {
    // Checked before anything touches the database: user_type decides whether
    // RolesGuard consults role_permissions at all, so an unchecked value let a
    // company admin mint tenant or system admins.
    const userType = dto.user_type ?? 'STANDARD_USER';
    this.assertCanAssign(requester, userType);
    // The auth directory maps the email to this tenant id for login routing;
    // only a platform admin may name a tenant other than their own.
    if (requester.userType !== 'SYSTEM_ADMIN' && dto.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You can only create users in your own tenant.');
    }
    await this.assertCompanyInReach(requester, dto.company_id, dto.tenant_id);
    if (userType === 'STANDARD_USER' && !dto.farm_id) {
      throw new BadRequestException('A standard user must be assigned to a farm.');
    }
    if (dto.farm_id) await this.assertActiveCompanyFarm(dto.farm_id, dto.company_id, dto.tenant_id);
    const areaIds = await this.validateAreas(dto.operational_area_ids, dto.company_id, dto.tenant_id, requester);

    const existing = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, dto.email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`User with email '${dto.email}' already exists.`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const userId = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.userMaster).values({
        user_id: userId,
        company_id: dto.company_id,
        tenant_id: dto.tenant_id,
        full_name: dto.full_name,
        email: dto.email.toLowerCase(),
        phone: dto.phone || null,
        password_hash: passwordHash,
        user_type: userType,
        employee_id: dto.employee_id || null,
        department: dto.department || null,
        designation: dto.designation || null,
        timezone_pref_id: dto.timezone_pref_id || null,
        // A farm is a standard user's boundary; on any other type it would mean nothing.
        farm_id: userType === 'STANDARD_USER' ? dto.farm_id || null : null,
        invited_by: requester?.userId || null,
      });
      await tx.insert(schema.userCompanyAssignments).values({
        user_id: userId,
        company_id: dto.company_id,
        is_primary: true,
        assigned_by: requester?.userId || userId,
      });
      if (areaIds.length > 0) {
        await tx.insert(schema.userOperationalAreaAssignment).values(areaIds.map((areaId, index) => ({
          assignment_id: randomUUID(),
          user_id: userId,
          area_id: areaId,
          company_id: dto.company_id,
          is_primary: index === 0,
        })));
      }
    });

    this.userDirectory.index(dto.email, userId, dto.tenant_id).catch((err) =>
      console.error('Failed to update user auth index:', err),
    );

    const created = await this.findById(userId);
    await this.record(requester, created, 'CREATE', undefined, this.auditSnapshot(created));
    return created;
  }

  async findById(id: string) {
    const [user] = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.user_id, id))
      .limit(1);

    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found.`);
    }

    const [enriched] = await this.enrich([withoutSecrets(user)]);
    return enriched;
  }

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, email.toLowerCase()))
      .limit(1);

    return user || null;
  }

  /**
   * The team directory. Below tenant level it is the requester's active company
   * — home users and users assigned to it — never the whole tenant, which is
   * what GET /user returned to any holder of RBAC/USER view before.
   */
  async findAll(query: QueryUserDto, requester?: RequestingUser, activeCompanyId?: string) {
    const conditions: any[] = [isNull(schema.userMaster.deleted_at)];

    let companyId = query.companyId;
    if (requester && !isTenantLevelUserType(requester.userType)) {
      const reach = activeCompanyId || requester.companyId || undefined;
      if (companyId && companyId !== reach) {
        throw new ForbiddenException('You can only list users of your own company.');
      }
      companyId = reach;
    }

    if (companyId) {
      conditions.push(or(
        eq(schema.userMaster.company_id, companyId),
        sql`${schema.userMaster.user_id} IN (SELECT uca.user_id FROM user_company_assignments uca WHERE uca.company_id = ${companyId} AND uca.is_active = 1)`,
      ));
    }
    if (query.userType) {
      conditions.push(eq(schema.userMaster.user_type, query.userType));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.userMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.userMaster.full_name, `%${query.search}%`),
          like(schema.userMaster.email, `%${query.search}%`),
        ),
      );
    }

    const limit = query.limit || 200;
    const offset = query.offset || 0;

    const users = await this.db
      .select({
        user_id: schema.userMaster.user_id,
        company_id: schema.userMaster.company_id,
        tenant_id: schema.userMaster.tenant_id,
        farm_id: schema.userMaster.farm_id,
        full_name: schema.userMaster.full_name,
        email: schema.userMaster.email,
        phone: schema.userMaster.phone,
        user_type: schema.userMaster.user_type,
        employee_id: schema.userMaster.employee_id,
        department: schema.userMaster.department,
        designation: schema.userMaster.designation,
        is_active: schema.userMaster.is_active,
        last_login_at: schema.userMaster.last_login_at,
        created_at: schema.userMaster.created_at,
      })
      .from(schema.userMaster)
      .where(and(...conditions))
      .orderBy(asc(schema.userMaster.full_name))
      .limit(limit)
      .offset(offset);

    return this.enrich(users);
  }

  async findByCompany(companyId: string, requester?: RequestingUser, activeCompanyId?: string) {
    return this.findAll({ companyId }, requester, activeCompanyId);
  }

  /** Company, farm, operational areas and roles for a page of users, in four queries rather than per user. */
  private async enrich<T extends { user_id: string; company_id: string | null; farm_id?: string | null }>(users: T[]) {
    if (users.length === 0) return [];
    const userIds = users.map((u) => u.user_id);
    const companyIds = [...new Set(users.map((u) => u.company_id).filter((id): id is string => Boolean(id)))];
    const farmIds = [...new Set(users.map((u) => u.farm_id).filter((id): id is string => Boolean(id)))];

    // Each branch below is either a Drizzle query or a plain array, so the
    // inferred element type is a union that collapses to `{}`. The four row
    // shapes are named here instead, which is also what the return type shows.
    type CompanyRow = { company_id: string; company_code: string; company_name: string };
    type FarmRow = { location_id: string; location_code: string; location_name: string };
    type AreaRow = { user_id: string; area_id: string; area_code: string; area_name: string; is_primary: boolean | null };
    type RoleRow = { user_id: string; assign_id: string; role_id: string; role_code: string; role_name: string };

    const [companies, farms, areas, roles] = await Promise.all([
      companyIds.length
        ? this.db.select({ company_id: schema.companyMaster.company_id, company_code: schema.companyMaster.company_code, company_name: schema.companyMaster.company_name })
            .from(schema.companyMaster).where(inArray(schema.companyMaster.company_id, companyIds))
        : Promise.resolve([] as { company_id: string; company_code: string; company_name: string }[]),
      farmIds.length
        ? this.db.select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name })
            .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, farmIds))
        : Promise.resolve([] as { location_id: string; location_code: string; location_name: string }[]),
      this.db
        .select({
          user_id: schema.userOperationalAreaAssignment.user_id,
          area_id: schema.operationalAreaMaster.area_id,
          area_code: schema.operationalAreaMaster.area_code,
          area_name: schema.operationalAreaMaster.area_name,
          is_primary: schema.userOperationalAreaAssignment.is_primary,
        })
        .from(schema.userOperationalAreaAssignment)
        .innerJoin(schema.operationalAreaMaster, eq(schema.operationalAreaMaster.area_id, schema.userOperationalAreaAssignment.area_id))
        .where(inArray(schema.userOperationalAreaAssignment.user_id, userIds)),
      this.db
        .select({
          user_id: schema.userRoleAssignment.user_id,
          assign_id: schema.userRoleAssignment.assign_id,
          role_id: schema.roleMaster.role_id,
          role_code: schema.roleMaster.role_code,
          role_name: schema.roleMaster.role_name,
        })
        .from(schema.userRoleAssignment)
        .innerJoin(schema.roleMaster, eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id))
        .where(and(inArray(schema.userRoleAssignment.user_id, userIds), eq(schema.userRoleAssignment.is_active, true))),
    ]);

    const companyById = new Map((companies as CompanyRow[]).map((c) => [c.company_id, c] as const));
    const farmById = new Map((farms as FarmRow[]).map((f) => [f.location_id, f] as const));
    const areaRows = areas as AreaRow[];
    const roleRows = roles as RoleRow[];

    return users.map((user) => ({
      ...user,
      company_code: user.company_id ? companyById.get(user.company_id)?.company_code ?? null : null,
      company_name: user.company_id ? companyById.get(user.company_id)?.company_name ?? null : null,
      farm_code: user.farm_id ? farmById.get(user.farm_id)?.location_code ?? null : null,
      farm_name: user.farm_id ? farmById.get(user.farm_id)?.location_name ?? null : null,
      operational_areas: areaRows.filter((a) => a.user_id === user.user_id).map(({ user_id: _u, ...a }) => a),
      roles: roleRows.filter((r) => r.user_id === user.user_id).map(({ user_id: _u, ...r }) => r),
    }));
  }

  /** What an audit row shows for a user: readable names beside the ids, no secrets. */
  private auditSnapshot(user: Record<string, any>) {
    return {
      full_name: user.full_name,
      email: user.email,
      phone: user.phone ?? null,
      user_type: user.user_type,
      company_id: user.company_id,
      company_name: user.company_name ?? null,
      farm_id: user.farm_id ?? null,
      farm_name: user.farm_name ?? null,
      operational_areas: (user.operational_areas ?? []).map((a: any) => a.area_code).join(', ') || null,
      roles: (user.roles ?? []).map((r: any) => r.role_code).join(', ') || null,
      employee_id: user.employee_id ?? null,
      department: user.department ?? null,
      designation: user.designation ?? null,
      is_active: user.is_active,
    };
  }

  async update(id: string, dto: UpdateUserDto, requester: RequestingUser) {
    const user = await this.findById(id);
    const actingUserId = requester.userId;
    const isSelf = id === actingUserId;

    // Peers and superiors are out of reach; your own profile is not.
    if (!isSelf) {
      this.assertOutranks(requester, user.user_type);
      await this.assertCompanyInReach(requester, user.company_id, user.tenant_id);
    }

    // The console's edit form always echoes the current type back, so only a
    // real change is treated as an assignment.
    const typeChanged = dto.user_type !== undefined && dto.user_type !== user.user_type;
    if (typeChanged) {
      if (isSelf) {
        throw new ForbiddenException('You cannot change your own user type.');
      }
      this.assertCanAssign(requester, dto.user_type as string);
    }

    // A user can edit their own profile fields, but never flip their own
    // account inactive — that's an easy way to accidentally lock yourself
    // out with no one else able to log in and reverse it (especially for a
    // tenant's only admin). Deactivating someone always has to come from a
    // different, still-active account.
    if (isSelf && dto.is_active === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    // Your own farm and areas are your access boundary; changing them is an
    // assignment someone above you makes.
    const currentAreaIds = user.operational_areas.map((a) => a.area_id);
    const requestedAreaIds = dto.operational_area_ids !== undefined ? [...new Set(dto.operational_area_ids)] : undefined;
    const areasRequestedChange = requestedAreaIds !== undefined
      && (requestedAreaIds.length !== currentAreaIds.length || requestedAreaIds.some((a) => !currentAreaIds.includes(a)));
    if (isSelf && ((dto.farm_id !== undefined && dto.farm_id !== user.farm_id) || areasRequestedChange)) {
      throw new ForbiddenException('You cannot change your own farm or operational area assignment.');
    }

    const resultingType = typeChanged ? dto.user_type : user.user_type;
    const resultingFarm = resultingType === 'STANDARD_USER' ? (dto.farm_id !== undefined ? dto.farm_id : user.farm_id) : null;
    if (resultingType === 'STANDARD_USER' && !resultingFarm) {
      throw new BadRequestException('A standard user must be assigned to a farm.');
    }
    if (resultingType === 'STANDARD_USER' && dto.farm_id) await this.assertActiveCompanyFarm(dto.farm_id, user.company_id, user.tenant_id);
    const areaIds = areasRequestedChange
      ? await this.validateAreas(requestedAreaIds, user.company_id, user.tenant_id, requester)
      : undefined;

    const updates: any = {};
    if (dto.full_name !== undefined) updates.full_name = dto.full_name;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (typeChanged) updates.user_type = dto.user_type;
    if (dto.employee_id !== undefined) updates.employee_id = dto.employee_id;
    if (dto.department !== undefined) updates.department = dto.department;
    if (dto.designation !== undefined) updates.designation = dto.designation;
    if (dto.timezone_pref_id !== undefined) updates.timezone_pref_id = dto.timezone_pref_id;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    // Moving a standard user to another type clears the farm, which would
    // otherwise sit on the row with no meaning.
    if (resultingFarm !== (user.farm_id ?? null)) updates.farm_id = resultingFarm;

    // Only fields that actually change are written and audited.
    for (const key of Object.keys(updates)) {
      if ((user as any)[key] === updates[key]) delete updates[key];
    }

    const areasChanged = areaIds !== undefined;

    if (Object.keys(updates).length > 0 || areasChanged) {
      await this.db.transaction(async (tx) => {
        if (Object.keys(updates).length > 0) {
          await tx
            .update(schema.userMaster)
            .set(updates)
            .where(eq(schema.userMaster.user_id, id));
        }
        if (areasChanged && areaIds) {
          const removed = currentAreaIds.filter((a) => !areaIds.includes(a));
          if (removed.length > 0) {
            await tx.delete(schema.userOperationalAreaAssignment).where(and(
              eq(schema.userOperationalAreaAssignment.user_id, id),
              inArray(schema.userOperationalAreaAssignment.area_id, removed),
            ));
          }
          const added = areaIds.filter((a) => !currentAreaIds.includes(a));
          if (added.length > 0) {
            const keepsPrimary = user.operational_areas.some((a) => a.is_primary && areaIds.includes(a.area_id));
            await tx.insert(schema.userOperationalAreaAssignment).values(added.map((areaId, index) => ({
              assignment_id: randomUUID(),
              user_id: id,
              area_id: areaId,
              company_id: user.company_id,
              is_primary: !keepsPrimary && index === 0,
            })));
          }
        }
      });
    }

    const updated = await this.findById(id);
    if (Object.keys(updates).length > 0 || areasChanged) {
      await this.record(requester, updated, dto.is_active === false && user.is_active ? 'DEACTIVATE' : 'UPDATE', this.auditSnapshot(user), this.auditSnapshot(updated));
    }
    return updated;
  }

  async deactivate(id: string, requester: RequestingUser) {
    if (id === requester.userId) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }
    const user = await this.findById(id);
    this.assertOutranks(requester, user.user_type);
    await this.assertCompanyInReach(requester, user.company_id, user.tenant_id);

    await this.db
      .update(schema.userMaster)
      .set({
        is_active: false,
      })
      .where(eq(schema.userMaster.user_id, id));

    const updated = await this.findById(id);
    await this.record(requester, updated, 'DEACTIVATE', { is_active: user.is_active }, { is_active: false });
    return updated;
  }

  async remove(id: string, requester: RequestingUser) {
    if (id === requester.userId) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const user = await this.findById(id);
    this.assertOutranks(requester, user.user_type);
    await this.assertCompanyInReach(requester, user.company_id, user.tenant_id);

    const deletedAt = toMysqlTimestamp();
    await this.db
      .update(schema.userMaster)
      .set({
        is_active: false,
        deleted_at: deletedAt as any,
        deleted_by: requester?.userId || null,
      })
      .where(eq(schema.userMaster.user_id, id));

    await this.record(requester, user, 'DELETE', this.auditSnapshot(user), { is_active: false, deleted_at: deletedAt });
    return { deleted: true, user_id: id };
  }

  /** Top-level active farms of a company, for the standard user's farm selector — the same rule create/update enforce. */
  async assignableFarms(companyId: string, requester: RequestingUser, activeCompanyId?: string) {
    await this.assertCompanyInReach(requester, companyId, requester.tenantId, activeCompanyId);
    return this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_name: schema.locationMaster.location_name,
      })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.company_id, companyId),
        eq(schema.locationMaster.tenant_id, requester.tenantId),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.parent_location_id),
        isNull(schema.locationMaster.deleted_at),
      ))
      .orderBy(asc(schema.locationMaster.location_name));
  }

  /** Operational areas a requester may hand out in a company; an operational admin only their own. */
  async assignableAreas(companyId: string, requester: RequestingUser, activeCompanyId?: string) {
    await this.assertCompanyInReach(requester, companyId, requester.tenantId, activeCompanyId);
    const conditions: any[] = [
      eq(schema.operationalAreaMaster.company_id, companyId),
      eq(schema.operationalAreaMaster.tenant_id, requester.tenantId),
      eq(schema.operationalAreaMaster.is_active, true),
      isNull(schema.operationalAreaMaster.deleted_at),
    ];
    if (requester.userType === 'OPERATIONAL_ADMIN') {
      conditions.push(sql`${schema.operationalAreaMaster.area_id} IN (SELECT uoa.area_id FROM user_operational_area_assignment uoa WHERE uoa.user_id = ${requester.userId})`);
    }
    return this.db
      .select({
        area_id: schema.operationalAreaMaster.area_id,
        area_code: schema.operationalAreaMaster.area_code,
        area_name: schema.operationalAreaMaster.area_name,
      })
      .from(schema.operationalAreaMaster)
      .where(and(...conditions))
      .orderBy(asc(schema.operationalAreaMaster.area_code));
  }

  private assertCanAssign(requester: RequestingUser, targetType: string) {
    if (!canAssignUserType(requester?.userType, targetType)) {
      throw new ForbiddenException(`You are not allowed to assign the user type '${targetType}'.`);
    }
  }

  private assertOutranks(requester: RequestingUser, targetType: string) {
    if (!outranks(requester?.userType, targetType)) {
      throw new ForbiddenException('You cannot modify a user at or above your own access level.');
    }
  }

  /**
   * A tenant admin reaches every company of the tenant; anyone below reaches
   * their home company and companies they are actively assigned to — the rule
   * RolesGuard applies to the company header. Before this, a company admin
   * could create or edit users in any company of the tenant by naming it.
   */
  private async assertCompanyInReach(requester: RequestingUser, companyId: string, tenantId: string, activeCompanyId?: string) {
    if (!requester || requester.userType === 'SYSTEM_ADMIN') return;
    const [company] = await this.db
      .select({ tenant_id: schema.companyMaster.tenant_id })
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);
    if (!company || company.tenant_id !== (tenantId || requester.tenantId)) {
      throw new ForbiddenException('That company is not part of your tenant.');
    }
    if (isTenantLevelUserType(requester.userType)) return;
    // The active company header has already been checked by RolesGuard.
    if (companyId === requester.companyId || (activeCompanyId && companyId === activeCompanyId)) return;
    const [assignment] = await this.db
      .select({ id: schema.userCompanyAssignments.assign_id })
      .from(schema.userCompanyAssignments)
      .where(and(
        eq(schema.userCompanyAssignments.user_id, requester.userId),
        eq(schema.userCompanyAssignments.company_id, companyId),
        eq(schema.userCompanyAssignments.is_active, true),
      ))
      .limit(1);
    if (!assignment) throw new ForbiddenException('You can only manage users of your own company.');
  }

  /**
   * Areas must be active areas of the user's company. An operational admin may
   * only hand out areas they hold themselves, or they could widen a standard
   * user into a line of business they do not administer.
   */
  private async validateAreas(areaIds: string[] | undefined, companyId: string, tenantId: string, requester: RequestingUser): Promise<string[]> {
    const unique = [...new Set(areaIds ?? [])];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({ area_id: schema.operationalAreaMaster.area_id })
      .from(schema.operationalAreaMaster)
      .where(and(
        inArray(schema.operationalAreaMaster.area_id, unique),
        eq(schema.operationalAreaMaster.company_id, companyId),
        eq(schema.operationalAreaMaster.tenant_id, tenantId),
        eq(schema.operationalAreaMaster.is_active, true),
        isNull(schema.operationalAreaMaster.deleted_at),
      ));
    if (rows.length !== unique.length) {
      throw new BadRequestException('Every operational area must be an active area of the user company.');
    }
    if (requester?.userType === 'OPERATIONAL_ADMIN') {
      const held = await this.db
        .select({ area_id: schema.userOperationalAreaAssignment.area_id })
        .from(schema.userOperationalAreaAssignment)
        .where(and(eq(schema.userOperationalAreaAssignment.user_id, requester.userId), inArray(schema.userOperationalAreaAssignment.area_id, unique)));
      if (held.length !== unique.length) {
        throw new ForbiddenException('You can only assign operational areas you are assigned to.');
      }
    }
    return unique;
  }

  private async assertActiveCompanyFarm(farmId: string, companyId: string, tenantId: string): Promise<void> {
    const [farm] = await this.db.select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, farmId),
        eq(schema.locationMaster.company_id, companyId),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.is_active, true),
        sql`${schema.locationMaster.parent_location_id} IS NULL`,
        sql`${schema.locationMaster.deleted_at} IS NULL`,
      )).limit(1);
    if (!farm) throw new BadRequestException('The assigned farm must be an active top-level farm in the user company.');
  }
}

import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { isTenantLevelUserType, outranks } from '../../../common/user-type-hierarchy';

/** Who is asking, from the validated JWT user — never from a request body. */
export interface RoleRequester {
  userId: string;
  userType?: string;
}

@Injectable()
export class RoleService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * Role and assignment changes are access changes, so each writes an audit
   * row with what it was and what it became. A failed audit write is logged,
   * not raised — the access change has already committed.
   */
  private async record(params: { companyId?: string | null; userId?: string; action: string; entityName: string; entityId: string; oldValues?: unknown; newValues?: unknown }, tx?: any) {
    try {
      await this.auditLogService.log({
        tenantId: this.cls.get('tenantId'),
        companyId: params.companyId || undefined,
        userId: params.userId,
        action: params.action,
        entityName: params.entityName,
        entityId: params.entityId,
        oldValues: params.oldValues,
        newValues: params.newValues,
      }, tx);
    } catch (e) {
      console.error(`Failed to log ${params.action} audit event:`, e);
    }
  }

  /** Active role assignments of a user, as the audit trail shows them. */
  private async activeRolesOf(userId: string, client: any = this.db) {
    return client
      .select({ assign_id: schema.userRoleAssignment.assign_id, role_id: schema.roleMaster.role_id, role_code: schema.roleMaster.role_code, role_name: schema.roleMaster.role_name })
      .from(schema.userRoleAssignment)
      .innerJoin(schema.roleMaster, eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id))
      .where(and(eq(schema.userRoleAssignment.user_id, userId), eq(schema.userRoleAssignment.is_active, true)));
  }

  async createRole(companyId: string, roleCode: string, roleName: string, description?: string) {
    const existing = await this.db
      .select()
      .from(schema.roleMaster)
      .where(and(eq(schema.roleMaster.company_id, companyId), eq(schema.roleMaster.role_code, roleCode.toUpperCase())))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Role with code '${roleCode}' already exists for this company.`);
    }

    const roleId = randomUUID();
    await this.db
      .insert(schema.roleMaster)
      .values({
        role_id: roleId,
        company_id: companyId,
        role_code: roleCode.toUpperCase(),
        role_name: roleName,
        role_description: description,
        is_system_role: false,
      });

    const [role] = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    await this.record({ companyId, action: 'CREATE', entityName: 'role_master', entityId: roleId, newValues: role });

    return role;
  }

  /**
   * A role is a grant of permissions, so assigning one is the same act as
   * raising a user's access. Before this checked nothing, a company admin could
   * hand a standard user SUPER_ADMIN (ALL/ALL) — the same escalation the
   * user-type ladder closes, reached through a different door.
   */
  async assignRoleToUser(userId: string, roleId: string, requester: RoleRequester) {
    const role = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (role.length === 0) {
      throw new NotFoundException(`Role with ID '${roleId}' not found.`);
    }

    const target = await this.loadTargetUser(userId);

    // Strictly above: this also stops anyone re-assigning their own role.
    if (!outranks(requester.userType, target.user_type)) {
      throw new ForbiddenException('You can only assign roles to users below your own access level.');
    }

    if (!isTenantLevelUserType(requester.userType) && (role[0].role_code === 'SUPER_ADMIN' || await this.grantsUnrestrictedAccess(roleId))) {
      throw new ForbiddenException('Only a tenant administrator can assign a role with unrestricted access.');
    }

    if (role[0].company_id && !(await this.userBelongsToCompany(target, role[0].company_id))) {
      throw new BadRequestException('That role belongs to a company this user is not part of.');
    }

    const assignedBy = requester.userId;
    const previousRoles = await this.activeRolesOf(userId);

    const assignment = await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.userRoleAssignment)
        .where(eq(schema.userRoleAssignment.user_id, userId));

      const assignId = randomUUID();
      await tx
        .insert(schema.userRoleAssignment)
        .values({
          assign_id: assignId,
          user_id: userId,
          role_id: roleId,
          assigned_by: assignedBy,
        });

      const [assignment] = await tx
        .select()
        .from(schema.userRoleAssignment)
        .where(eq(schema.userRoleAssignment.assign_id, assignId))
        .limit(1);

      return assignment;
    });

    await this.record({
      companyId: role[0].company_id || target.company_id,
      userId: requester.userId,
      action: 'ASSIGN_ROLE',
      entityName: 'user_role_assignment',
      entityId: userId,
      oldValues: { user_id: userId, roles: previousRoles.map((r: any) => r.role_code).join(', ') || null },
      newValues: { user_id: userId, roles: role[0].role_code, role_name: role[0].role_name },
    });

    return assignment;
  }

  async updateRolePermissions(roleId: string, requester: RoleRequester, permissions: Array<{
    module_code: string;
    resource: string;
    can_view?: boolean;
    can_create?: boolean;
    can_edit?: boolean;
    can_delete?: boolean;
    can_approve?: boolean;
    can_export?: boolean;
    can_print?: boolean;
  }>) {
    const role = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (role.length === 0) {
      throw new NotFoundException(`Role with ID '${roleId}' not found.`);
    }

    if (role[0].is_system_role) {
      throw new BadRequestException('System role permissions cannot be changed.');
    }

    // An ALL wildcard on a custom role turns every holder of it into a super
    // administrator, so writing one is a tenant-level decision.
    const widensToAll = permissions.some((p) => p.module_code === 'ALL' || p.resource === 'ALL');
    if (widensToAll && !isTenantLevelUserType(requester.userType)) {
      throw new ForbiddenException('Only a tenant administrator can grant unrestricted (ALL) permissions.');
    }

    const previous = await this.db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.role_id, roleId));
    const grants = (rows: any[]) => Object.fromEntries(
      rows
        .map((p) => [`${p.module_code}.${p.resource}`, ['view', 'create', 'edit', 'delete', 'approve', 'export', 'print'].filter((a) => p[`can_${a}`]).join(',')] as const)
        .filter(([, actions]) => actions)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

    return this.db.transaction(async (tx) => {
      // 1. Delete old permission rows
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.role_id, roleId));

      // 2. Insert new permission rows
      if (permissions.length > 0) {
        const insertRows = permissions.map((p) => ({
          perm_id: randomUUID(),
          role_id: roleId,
          module_code: p.module_code,
          resource: p.resource,
          can_view: p.can_view || false,
          can_create: p.can_create || false,
          can_edit: p.can_edit || false,
          can_delete: p.can_delete || false,
          can_approve: p.can_approve || false,
          can_export: p.can_export || false,
          can_print: p.can_print || false,
        }));

        await tx.insert(schema.rolePermissions).values(insertRows);
      }

      // Before and after as "MODULE.RESOURCE: actions", so the ledger shows which grant changed.
      await this.record({
        companyId: role[0]?.company_id,
        userId: requester.userId,
        action: 'UPDATE_PERMISSIONS',
        entityName: 'role_master',
        entityId: roleId,
        oldValues: { role_code: role[0].role_code, ...grants(previous) },
        newValues: { role_code: role[0].role_code, ...grants(permissions) },
      }, tx);

      return { success: true, message: 'Permissions updated successfully.' };
    });
  }

  async getRolePermissions(roleId: string) {
    const role = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (role.length === 0) {
      throw new NotFoundException(`Role with ID '${roleId}' not found.`);
    }

    return this.db
      .select()
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.role_id, roleId));
  }

  async getCompanyRoles(companyId: string) {
    const roles = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.company_id, companyId));
    if (roles.length === 0) return roles;

    // How many live accounts hold each role, so the Roles screen can say who a change affects.
    const counts = await this.db
      .select({ role_id: schema.userRoleAssignment.role_id, user_count: sql<number>`count(*)` })
      .from(schema.userRoleAssignment)
      .innerJoin(schema.userMaster, eq(schema.userMaster.user_id, schema.userRoleAssignment.user_id))
      .where(and(
        inArray(schema.userRoleAssignment.role_id, roles.map((r) => r.role_id)),
        eq(schema.userRoleAssignment.is_active, true),
        isNull(schema.userMaster.deleted_at),
      ))
      .groupBy(schema.userRoleAssignment.role_id);
    const countByRole = new Map(counts.map((c) => [c.role_id, Number(c.user_count)]));
    return roles.map((r) => ({ ...r, user_count: countByRole.get(r.role_id) ?? 0 }));
  }

  /** The users who currently hold a role. */
  async getRoleMembers(roleId: string) {
    return this.db
      .select({
        assign_id: schema.userRoleAssignment.assign_id,
        user_id: schema.userMaster.user_id,
        full_name: schema.userMaster.full_name,
        email: schema.userMaster.email,
        user_type: schema.userMaster.user_type,
        is_active: schema.userMaster.is_active,
        assigned_at: schema.userRoleAssignment.assigned_at,
      })
      .from(schema.userRoleAssignment)
      .innerJoin(schema.userMaster, eq(schema.userMaster.user_id, schema.userRoleAssignment.user_id))
      .where(and(
        eq(schema.userRoleAssignment.role_id, roleId),
        eq(schema.userRoleAssignment.is_active, true),
        isNull(schema.userMaster.deleted_at),
      ))
      .orderBy(schema.userMaster.full_name);
  }

  async updateRole(roleId: string, data: { roleName?: string; description?: string; isActive?: boolean }) {
    const [role] = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (!role) {
      throw new NotFoundException(`Role with ID '${roleId}' not found.`);
    }

    if (role.is_system_role && (data.roleName !== undefined || data.description !== undefined)) {
      throw new BadRequestException('System roles cannot be renamed or redescribed.');
    }

    const updateData: Record<string, any> = {};
    if (data.roleName !== undefined) updateData.role_name = data.roleName;
    if (data.description !== undefined) updateData.role_description = data.description;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    if (Object.keys(updateData).length > 0) {
      await this.db
        .update(schema.roleMaster)
        .set(updateData)
        .where(eq(schema.roleMaster.role_id, roleId));
    }

    const [updated] = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (Object.keys(updateData).length > 0) {
      await this.record({ companyId: role.company_id, action: 'UPDATE', entityName: 'role_master', entityId: roleId, oldValues: role, newValues: updated });
    }

    return updated;
  }

  async deleteRole(roleId: string) {
    const [role] = await this.db
      .select()
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, roleId))
      .limit(1);

    if (!role) {
      throw new NotFoundException(`Role with ID '${roleId}' not found.`);
    }

    if (role.is_system_role) {
      throw new BadRequestException('System roles cannot be deleted.');
    }

    // Check if any active assignments exist
    const assignments = await this.db
      .select()
      .from(schema.userRoleAssignment)
      .where(and(
        eq(schema.userRoleAssignment.role_id, roleId),
        eq(schema.userRoleAssignment.is_active, true),
      ))
      .limit(1);

    if (assignments.length > 0) {
      throw new BadRequestException(
        'Role has active user assignments. Revoke all assignments before deleting this role.'
      );
    }

    // Delete permissions first, then the role (cascade handles permissions but explicit is cleaner)
    await this.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.role_id, roleId));
    await this.db.delete(schema.roleMaster).where(eq(schema.roleMaster.role_id, roleId));

    await this.record({ companyId: role.company_id, action: 'DELETE', entityName: 'role_master', entityId: roleId, oldValues: role });

    return { success: true, message: `Role '${role.role_code}' deleted successfully.` };
  }

  async unassignRole(assignId: string, requester: RoleRequester) {
    const [assignment] = await this.db
      .select()
      .from(schema.userRoleAssignment)
      .where(eq(schema.userRoleAssignment.assign_id, assignId))
      .limit(1);

    if (!assignment) {
      throw new NotFoundException(`Role assignment with ID '${assignId}' not found.`);
    }

    // Removing a higher admin's role is as much an attack on them as editing them.
    const target = await this.loadTargetUser(assignment.user_id);
    if (!outranks(requester.userType, target.user_type)) {
      throw new ForbiddenException('You can only remove roles from users below your own access level.');
    }

    await this.db
      .update(schema.userRoleAssignment)
      .set({ is_active: false })
      .where(eq(schema.userRoleAssignment.assign_id, assignId));

    const [removedRole] = await this.db
      .select({ role_code: schema.roleMaster.role_code, role_name: schema.roleMaster.role_name, company_id: schema.roleMaster.company_id })
      .from(schema.roleMaster)
      .where(eq(schema.roleMaster.role_id, assignment.role_id))
      .limit(1);
    await this.record({
      companyId: removedRole?.company_id || target.company_id,
      userId: requester.userId,
      action: 'UNASSIGN_ROLE',
      entityName: 'user_role_assignment',
      entityId: assignment.user_id,
      oldValues: { user_id: assignment.user_id, roles: removedRole?.role_code ?? assignment.role_id, role_name: removedRole?.role_name ?? null },
      newValues: { user_id: assignment.user_id, roles: null },
    });

    return { success: true, message: 'Role unassigned successfully.' };
  }

  async getUserAssignments(userId: string) {
    return this.db
      .select({
        assign_id: schema.userRoleAssignment.assign_id,
        user_id: schema.userRoleAssignment.user_id,
        role_id: schema.userRoleAssignment.role_id,
        is_active: schema.userRoleAssignment.is_active,
        assigned_at: schema.userRoleAssignment.assigned_at,
        role_code: schema.roleMaster.role_code,
        role_name: schema.roleMaster.role_name,
      })
      .from(schema.userRoleAssignment)
      .leftJoin(
        schema.roleMaster,
        eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id),
      )
      .where(eq(schema.userRoleAssignment.user_id, userId));
  }

  private async loadTargetUser(userId: string) {
    const [target] = await this.db
      .select({
        user_id: schema.userMaster.user_id,
        user_type: schema.userMaster.user_type,
        company_id: schema.userMaster.company_id,
      })
      .from(schema.userMaster)
      .where(and(eq(schema.userMaster.user_id, userId), isNull(schema.userMaster.deleted_at)))
      .limit(1);

    if (!target) {
      throw new NotFoundException(`User with ID '${userId}' not found.`);
    }
    return target;
  }

  private async grantsUnrestrictedAccess(roleId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.rolePermissions.perm_id })
      .from(schema.rolePermissions)
      .where(and(
        eq(schema.rolePermissions.role_id, roleId),
        or(eq(schema.rolePermissions.module_code, 'ALL'), eq(schema.rolePermissions.resource, 'ALL')),
      ))
      .limit(1);
    return Boolean(row);
  }

  /** Home company, or an active assignment — the same rule RolesGuard applies to the company header. */
  private async userBelongsToCompany(target: { user_id: string; company_id: string | null }, companyId: string): Promise<boolean> {
    if (target.company_id === companyId) return true;
    const [assignment] = await this.db
      .select({ id: schema.userCompanyAssignments.assign_id })
      .from(schema.userCompanyAssignments)
      .where(and(
        eq(schema.userCompanyAssignments.user_id, target.user_id),
        eq(schema.userCompanyAssignments.company_id, companyId),
        eq(schema.userCompanyAssignments.is_active, true),
      ))
      .limit(1);
    return Boolean(assignment);
  }
}

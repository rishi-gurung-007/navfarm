import { and, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { RequiredPermission } from './decorators/require-permission.decorator';

/**
 * Whether a set of role grants satisfies a required permission.
 *
 * Extracted from RolesGuard so that rules which cannot be expressed as a static
 * decorator can ask the same question and get the same answer. Batch data entry
 * is the case that forced it: whether a farmer may change an entry depends on
 * the date of the entry, which no decorator can see.
 *
 * Duplicating the wildcard handling instead would be the real hazard — a second
 * copy that forgets 'ALL' silently grants nothing to a super administrator.
 */
export interface PermissionGrant {
  moduleCode: string;
  resource: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canApprove: boolean;
  canExport: boolean;
  canPrint: boolean;
}

const COLUMN_FOR: Record<RequiredPermission['action'], keyof PermissionGrant> = {
  view: 'canView',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
  approve: 'canApprove',
  export: 'canExport',
  print: 'canPrint',
};

/** User types that bypass the grant table entirely. */
export const ADMIN_USER_TYPES = ['SYSTEM_ADMIN', 'TENANT_ADMIN', 'COMPANY_ADMIN'];

export const isAdminUserType = (userType: unknown): boolean =>
  typeof userType === 'string' && ADMIN_USER_TYPES.includes(userType);

/** Does any grant cover this module+resource and allow this action? */
export function grantsPermission(grants: PermissionGrant[], required: RequiredPermission): boolean {
  const column = COLUMN_FOR[required.action];
  if (!column) return false;
  return grants.some((grant) => {
    const matchesModule = grant.moduleCode === 'ALL' || grant.moduleCode === required.moduleCode;
    const matchesResource = grant.resource === 'ALL' || grant.resource === required.resource;
    return matchesModule && matchesResource && !!grant[column];
  });
}

/** Satisfied by any one of several required permissions. */
export const grantsAny = (grants: PermissionGrant[], required: RequiredPermission[]): boolean =>
  required.some((one) => grantsPermission(grants, one));

/** Every active grant reaching a user through their active roles. */
export function loadUserPermissions(
  db: MySql2Database<typeof schema>,
  userId: string,
): Promise<PermissionGrant[]> {
  return db
    .select({
      moduleCode: schema.rolePermissions.module_code,
      resource: schema.rolePermissions.resource,
      canView: schema.rolePermissions.can_view,
      canCreate: schema.rolePermissions.can_create,
      canEdit: schema.rolePermissions.can_edit,
      canDelete: schema.rolePermissions.can_delete,
      canApprove: schema.rolePermissions.can_approve,
      canExport: schema.rolePermissions.can_export,
      canPrint: schema.rolePermissions.can_print,
    })
    .from(schema.userRoleAssignment)
    .innerJoin(schema.roleMaster, eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id))
    .innerJoin(schema.rolePermissions, eq(schema.roleMaster.role_id, schema.rolePermissions.role_id))
    .where(and(
      eq(schema.userRoleAssignment.user_id, userId),
      eq(schema.userRoleAssignment.is_active, true),
      eq(schema.roleMaster.is_active, true),
    ));
}

/**
 * Whether a user holds a permission, honouring the admin bypass.
 *
 * `user` is the JWT payload the guards put on the request.
 */
export async function userHasPermission(
  db: MySql2Database<typeof schema>,
  user: { userId?: string; userType?: unknown } | undefined,
  required: RequiredPermission,
): Promise<boolean> {
  if (!user) return false;
  if (isAdminUserType(user.userType)) return true;
  if (!user.userId) return false;
  return grantsPermission(await loadUserPermissions(db, user.userId), required);
}

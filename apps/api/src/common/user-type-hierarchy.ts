/**
 * The user-type ladder, highest first.
 *
 * SYSTEM_ADMIN, TENANT_ADMIN and COMPANY_ADMIN bypass the role_permissions
 * table in RolesGuard, so whoever can write `user_master.user_type` can hand
 * out that bypass. Every endpoint that sets or edits a user type has to ask the
 * same question the same way, which is why the ladder lives here and not in
 * each service. auth.service.ts register() spells the same rule out inline and
 * could adopt these helpers.
 */
export const USER_TYPES = [
  'SYSTEM_ADMIN',
  'TENANT_ADMIN',
  'COMPANY_ADMIN',
  'OPERATIONAL_ADMIN',
  'STANDARD_USER',
] as const;

export type UserType = (typeof USER_TYPES)[number];

/** Types that manage tenant structure itself (companies, tenant-wide users). */
export const TENANT_LEVEL_USER_TYPES: readonly UserType[] = ['SYSTEM_ADMIN', 'TENANT_ADMIN'];

export const isTenantLevelUserType = (userType: unknown): boolean =>
  typeof userType === 'string' && (TENANT_LEVEL_USER_TYPES as readonly string[]).includes(userType);

/**
 * Higher is more privileged. Anything off the ladder — including the legacy
 * schema default 'STAFF' — ranks 0, below STANDARD_USER, so an unrecognised
 * type can never be mistaken for authority.
 */
export function userTypeRank(userType: unknown): number {
  const index = typeof userType === 'string' ? USER_TYPES.indexOf(userType as UserType) : -1;
  return index === -1 ? 0 : USER_TYPES.length - index;
}

/** Strictly above: peers do not manage peers. */
export const outranks = (requesterType: unknown, targetType: unknown): boolean =>
  userTypeRank(requesterType) > userTypeRank(targetType);

/**
 * Whether a requester may create a user of, or move a user to, `targetType`.
 *
 * TENANT_ADMIN -> COMPANY_ADMIN, OPERATIONAL_ADMIN, STANDARD_USER
 * COMPANY_ADMIN -> OPERATIONAL_ADMIN, STANDARD_USER
 * OPERATIONAL_ADMIN -> STANDARD_USER
 * STANDARD_USER -> nothing
 * SYSTEM_ADMIN is never assignable through a tenant API.
 */
export function canAssignUserType(requesterType: unknown, targetType: unknown): boolean {
  if (userTypeRank(targetType) === 0 || targetType === 'SYSTEM_ADMIN') return false;
  return outranks(requesterType, targetType);
}

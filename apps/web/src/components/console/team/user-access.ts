/**
 * The web-side mirror of `apps/api/src/common/user-type-hierarchy.ts`.
 *
 * The API is the authority — every create, edit and role assignment is checked
 * there and refused with a message this UI shows verbatim. This copy exists so
 * the form does not *offer* a user type its caller can never be granted; it
 * must never be the only thing standing between a caller and an escalation.
 */
export const USER_TYPES = [
  "SYSTEM_ADMIN",
  "TENANT_ADMIN",
  "COMPANY_ADMIN",
  "OPERATIONAL_ADMIN",
  "STANDARD_USER",
] as const;

export type UserType = (typeof USER_TYPES)[number];

/** Higher is more privileged. Anything off the ladder ranks 0, below STANDARD_USER. */
export function userTypeRank(userType?: string | null): number {
  const index = userType ? USER_TYPES.indexOf(userType as UserType) : -1;
  return index === -1 ? 0 : USER_TYPES.length - index;
}

/** Strictly above: peers do not manage peers. */
export const outranks = (requesterType?: string | null, targetType?: string | null): boolean =>
  userTypeRank(requesterType) > userTypeRank(targetType);

/** SYSTEM_ADMIN is never assignable through a tenant API, whoever is asking. */
export function canAssignUserType(requesterType?: string | null, targetType?: string | null): boolean {
  if (userTypeRank(targetType) === 0 || targetType === "SYSTEM_ADMIN") return false;
  return outranks(requesterType, targetType);
}

export const isTenantLevelUserType = (userType?: string | null): boolean =>
  userType === "SYSTEM_ADMIN" || userType === "TENANT_ADMIN";

/** The types this requester may hand out, most privileged first. */
export function assignableUserTypes(requesterType?: string | null): UserType[] {
  return USER_TYPES.filter((type) => canAssignUserType(requesterType, type));
}

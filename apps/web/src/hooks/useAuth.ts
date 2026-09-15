"use client";

import { AUTH_STORAGE, clearAuthSession } from "@/lib/api-client";

export type WorkspaceScope = "TENANT" | "COMPANY" | "OPERATIONAL";

export interface CompanyRef {
  company_id:   string;
  company_name: string;
  is_primary:   boolean;
}

export interface OperationalAreaRef {
  area_id:      string;
  area_code:    string;
  area_name:    string;
  company_id:   string;
  lob_id:       string;
  nob_id:       string;
  is_primary?:  boolean;
}

export interface FarmRef {
  location_id:   string;
  location_code: string;
  location_name: string;
}

export interface NavUser {
  userId:              string;
  email:               string;
  fullName:            string;
  userType:            "SYSTEM_ADMIN" | "TENANT_ADMIN" | "COMPANY_ADMIN" | "OPERATIONAL_ADMIN" | "STANDARD_USER";
  companyId?:          string;
  company_id?:         string;
  tenantId?:           string;
  operationalAreaId?:  string;
  operational_area_id?: string;
  farmId?:             string;
  farm_id?:            string;
  farm?:               FarmRef;
  companies?:          CompanyRef[];
  operationalAreas?:   OperationalAreaRef[];
  permissions?: Array<{
    moduleCode:  string;
    resource:    string;
    canView:     boolean;
    canCreate:   boolean;
    canEdit:     boolean;
    canDelete?:  boolean;
    canApprove?: boolean;
  }>;
}

export function getStoredUser(): NavUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE.user);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Merge a patch into the stored user and persist it under the single auth-user key. */
export function updateStoredUser(patch: Partial<NavUser>): NavUser | null {
  if (typeof window === "undefined") return null;
  const current = getStoredUser();
  if (!current) return null;
  const patched = { ...current, ...patch };
  localStorage.setItem(AUTH_STORAGE.user, JSON.stringify(patched));
  return patched;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE.accessToken);
}

export function getStoredTenantId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_STORAGE.tenantId);
}

/** The active workspace scope: TENANT, COMPANY, or OPERATIONAL */
export function getActiveWorkspaceScope(): WorkspaceScope {
  if (typeof window === "undefined") return "COMPANY";
  const user = getStoredUser();
  if (!user) return "COMPANY";

  const stored = localStorage.getItem("active_workspace_scope") as WorkspaceScope;

  // Strict role enforcement
  if (user.userType === "TENANT_ADMIN") {
    return stored || "TENANT";
  }

  if (user.userType === "COMPANY_ADMIN") {
    // Company admins can never enter TENANT scope
    if (stored === "OPERATIONAL") return "OPERATIONAL";
    return "COMPANY";
  }

  if (user.userType === "OPERATIONAL_ADMIN" || user.userType === "STANDARD_USER") {
    return "OPERATIONAL";
  }

  return "COMPANY";
}

export function setActiveWorkspaceScope(scope: WorkspaceScope): void {
  if (typeof window === "undefined") return;
  const user = getStoredUser();

  // Prevent non-tenant admins from setting TENANT scope
  if (user && user.userType !== "TENANT_ADMIN" && scope === "TENANT") {
    scope = "COMPANY";
  }

  localStorage.setItem("active_workspace_scope", scope);
}

/** The company the user is currently "working as" in this browser session */
export function getActiveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  const user = getStoredUser();
  if (!user) return null;

  const stored =
    localStorage.getItem("active_company_id") ||
    localStorage.getItem("company_id") ||
    null;

  // Tenant admin can work across all companies
  if (user.userType === "TENANT_ADMIN") {
    return stored || user.companyId || (user.companies && user.companies[0]?.company_id) || null;
  }

  // Strictly enforce user's assigned company boundary
  const allowedCompanyIds = new Set([
    user.companyId,
    user.company_id,
    ...(user.companies || []).map((c) => c.company_id),
  ].filter(Boolean));

  if (stored && allowedCompanyIds.has(stored)) {
    return stored;
  }

  const defaultCompId = user.companyId || user.company_id || (user.companies && user.companies[0]?.company_id) || null;
  if (defaultCompId) {
    localStorage.setItem("active_company_id", defaultCompId);
  }
  return defaultCompId;
}

export function setActiveCompanyId(companyId: string): void {
  if (typeof window === "undefined") return;
  const user = getStoredUser();

  // Guard: non-tenant admin cannot switch to unassigned companies
  if (user && user.userType !== "TENANT_ADMIN") {
    const allowedCompanyIds = new Set([
      user.companyId,
      user.company_id,
      ...(user.companies || []).map((c) => c.company_id),
    ].filter(Boolean));

    if (!allowedCompanyIds.has(companyId)) {
      console.warn(`Access denied: User ${user.email} is not authorized for company ${companyId}`);
      return;
    }
  }

  localStorage.setItem("active_company_id", companyId);
}

/** The active operational area the user is currently inspecting/operating */
export function getActiveOperationalAreaId(): string | null {
  if (typeof window === "undefined") return null;
  const user = getStoredUser();
  if (!user) return null;

  const stored = localStorage.getItem("active_operational_area_id") || null;

  if (user.userType === "TENANT_ADMIN") {
    return stored;
  }

  const allowedAreaIds = new Set([
    user.operationalAreaId,
    user.operational_area_id,
    ...(user.operationalAreas || []).map((a) => a.area_id),
  ].filter(Boolean));

  if (stored && (allowedAreaIds.size === 0 || allowedAreaIds.has(stored))) {
    return stored;
  }

  return user.operationalAreaId || user.operational_area_id || (user.operationalAreas && user.operationalAreas[0]?.area_id) || null;
}

export function setActiveOperationalAreaId(areaId: string | null): void {
  if (typeof window === "undefined") return;
  if (areaId) localStorage.setItem("active_operational_area_id", areaId);
  else localStorage.removeItem("active_operational_area_id");
}

/**
 * The active farm. A STANDARD_USER is bound to exactly one farm
 * (user_master.farm_id, decided 2026-09-14/15) — it is never a switch, so
 * this always answers with the user's own farm and ignores anything stored.
 * Admin user types (system/tenant/company) and operational admins may view
 * every farm or select one; `null` there means every farm in scope, matching
 * the API's `x-active-farm-id` absent = unrestricted rule.
 */
export function getActiveFarmId(): string | null {
  if (typeof window === "undefined") return null;
  const user = getStoredUser();
  if (!user) return null;
  if (user.userType === "STANDARD_USER") {
    return user.farmId ?? user.farm_id ?? null;
  }
  return localStorage.getItem("active_farm_id") || null;
}

export function setActiveFarmId(farmId: string | null): void {
  if (typeof window === "undefined") return;
  const user = getStoredUser();
  // A standard user's farm is fixed — selecting one here would imply a
  // choice that does not exist.
  if (user?.userType === "STANDARD_USER") return;
  if (farmId) localStorage.setItem("active_farm_id", farmId);
  else localStorage.removeItem("active_farm_id");
}

/** The active LOB code/id for the active operational scope (e.g. 'PIGGERY', 'DAIRY', 'LVS_PIGGERY') */
export function getActiveLob(): string {
  if (typeof window === "undefined") return "PIGGERY";
  return localStorage.getItem("active_lob") || "PIGGERY";
}

export function setActiveLob(lob: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("active_lob", lob);
}

/** Legacy helper preserved for backwards compatibility */
export function isTenantCompanyMode(): boolean {
  return getActiveWorkspaceScope() !== "TENANT";
}

export function setTenantCompanyMode(on: boolean): void {
  setActiveWorkspaceScope(on ? "COMPANY" : "TENANT");
}

/** Clears the full session. The removal list lives in one place: clearAuthSession(). */
export function clearSession() {
  clearAuthSession();
}

export function hasPermission(
  user: NavUser | null,
  moduleCode: string,
  resource: string,
  action: "can_view" | "can_create" | "can_edit"
): boolean {
  if (!user) return false;
  if (user.userType === "TENANT_ADMIN" || user.userType === "COMPANY_ADMIN") return true;
  if (user.userType === "OPERATIONAL_ADMIN") {
    // Operational admins have full operational and master permissions within their assigned area
    if (
      moduleCode === "PRODUCTION" ||
      moduleCode === "PIGGERY" ||
      moduleCode === "DAIRY" ||
      moduleCode === "POULTRY" ||
      moduleCode === "MASTER_DATA" ||
      moduleCode === "INVENTORY"
    ) {
      return true;
    }
  }
  const perms = user.permissions || [];
  return perms.some((p) => {
    const matchModule   = p.moduleCode === "ALL" || p.moduleCode === moduleCode;
    const matchResource = p.resource   === "ALL" || p.resource   === resource;
    if (!matchModule || !matchResource) return false;
    if (action === "can_view")   return !!p.canView;
    if (action === "can_create") return !!p.canCreate;
    if (action === "can_edit")   return !!p.canEdit;
    return false;
  });
}

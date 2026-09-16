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

export type PermissionAction =
  | "can_view"
  | "can_create"
  | "can_edit"
  | "can_delete"
  | "can_approve";

export function hasPermission(
  user: NavUser | null,
  moduleCode: string,
  resource: string,
  action: PermissionAction = "can_view"
): boolean {
  if (!user) return false;
  if (
    user.userType === "SYSTEM_ADMIN" ||
    user.userType === "TENANT_ADMIN" ||
    user.userType === "COMPANY_ADMIN"
  ) {
    return true;
  }
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
    if (action === "can_view")    return !!p.canView;
    if (action === "can_create")  return !!p.canCreate;
    if (action === "can_edit")    return !!p.canEdit;
    if (action === "can_delete")  return !!p.canDelete;
    if (action === "can_approve") return !!p.canApprove;
    return false;
  });
}

export function hasAnyPermissionInModule(
  user: NavUser | null,
  moduleCode: string,
  action: PermissionAction = "can_view"
): boolean {
  if (!user) return false;
  if (
    user.userType === "SYSTEM_ADMIN" ||
    user.userType === "TENANT_ADMIN" ||
    user.userType === "COMPANY_ADMIN"
  ) {
    return true;
  }
  if (user.userType === "OPERATIONAL_ADMIN") {
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
    const matchModule = p.moduleCode === "ALL" || p.moduleCode === moduleCode;
    if (!matchModule) return false;
    if (action === "can_view")    return !!p.canView;
    if (action === "can_create")  return !!p.canCreate;
    if (action === "can_edit")    return !!p.canEdit;
    if (action === "can_delete")  return !!p.canDelete;
    if (action === "can_approve") return !!p.canApprove;
    return false;
  });
}

export function canAccessMasterDataConfig(
  user: NavUser | null,
  configKey: string,
  action: PermissionAction = "can_view"
): boolean {
  if (!user) return false;
  if (
    user.userType === "SYSTEM_ADMIN" ||
    user.userType === "TENANT_ADMIN" ||
    user.userType === "COMPANY_ADMIN" ||
    user.userType === "OPERATIONAL_ADMIN"
  ) {
    return true;
  }

  const mapping: Record<string, { module: string; resource: string }> = {
    "location-type": { module: "MASTER_DATA", resource: "LOCATION" },
    location: { module: "MASTER_DATA", resource: "LOCATION" },
    farm: { module: "MASTER_DATA", resource: "FARM" },
    shed: { module: "MASTER_DATA", resource: "SHED" },
    warehouse: { module: "MASTER_DATA", resource: "WAREHOUSE" },
    stage: { module: "PRODUCTION", resource: "STAGE" },
    "number-series": { module: "SYSTEM", resource: "NUMBER_SERIES" },
    activity: { module: "MASTER_DATA", resource: "ACTIVITY" },
    animal: { module: "PIGGERY", resource: "ANIMAL" },
    "item-category": { module: "MASTER_DATA", resource: "ITEM_CATEGORY" },
    "item-type": { module: "MASTER_DATA", resource: "ITEM_TYPE" },
    uom: { module: "MASTER_DATA", resource: "UOM" },
    "uom-conversion": { module: "MASTER_DATA", resource: "UOM" },
    item: { module: "MASTER_DATA", resource: "ITEM" },
    "item-attribute": { module: "MASTER_DATA", resource: "ITEM_ATTRIBUTE" },
    species: { module: "MASTER_DATA", resource: "SPECIES" },
    breed: { module: "MASTER_DATA", resource: "BREED" },
    "breed-lifecycle-stage": { module: "MASTER_DATA", resource: "BREED_LIFECYCLE_STAGE" },
    reason: { module: "MASTER_DATA", resource: "REASON" },
    disease: { module: "MASTER_DATA", resource: "DISEASE" },
    "feed-formula": { module: "MASTER_DATA", resource: "FEED_FORMULA" },
    supplier: { module: "MASTER_DATA", resource: "SUPPLIER" },
    customer: { module: "MASTER_DATA", resource: "CUSTOMER" },
    resource: { module: "MASTER_DATA", resource: "RESOURCE" },
    "gl-account": { module: "MASTER_DATA", resource: "GL_ACCOUNT" },
    "gl-mapping": { module: "MASTER_DATA", resource: "GL_MAPPING" },
    "cost-center": { module: "MASTER_DATA", resource: "COST_CENTER" },
    country: { module: "MASTER_DATA", resource: "LOCATION" },
    currency: { module: "MASTER_DATA", resource: "CURRENCY" },
    "exchange-rate": { module: "MASTER_DATA", resource: "CURRENCY" },
    "operational-area": { module: "MASTER_DATA", resource: "OPERATIONAL_AREA" },
  };

  const target = mapping[configKey];
  if (!target) {
    return hasAnyPermissionInModule(user, "MASTER_DATA", action);
  }
  return hasPermission(user, target.module, target.resource, action);
}

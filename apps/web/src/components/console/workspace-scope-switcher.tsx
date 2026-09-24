"use client";

import React, { useState, useEffect } from "react";
import {
  Building2,
  ChevronDown,
  Check,
  Building,
  Plus,
  Layers,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import {
  getStoredUser,
  getStoredTenantId,
  updateStoredUser,
  getActiveWorkspaceScope,
  setActiveWorkspaceScope,
  getActiveCompanyId,
  setActiveCompanyId,
  getActiveOperationalAreaId,
  setActiveOperationalAreaId,
  setActiveOperationalArea,
  getActiveFarmId,
  setActiveFarmId,
  getActiveLob,
  setActiveLob,
  WorkspaceScope,
  NavUser
} from "@/hooks/useAuth";
import { api } from "@/lib/api-client";
import { resolveLobFamily } from "@/lib/lob";
import { useLanguage } from "@/hooks/useLanguage";

interface OperationalAreaItem {
  area_id: string;
  area_code: string;
  area_name: string;
  company_id: string;
  company_name?: string;
  lob_id: string;
  nob_id: string;
  lob_code?: string;
  lob_name?: string;
}

interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

export default function WorkspaceScopeSwitcher({
  onScopeChanged
}: {
  onScopeChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<NavUser | null>(null);
  const [currentScope, setCurrentScope] = useState<WorkspaceScope>("COMPANY");
  const [companies, setCompanies] = useState<any[]>([]);
  const [operationalAreas, setOperationalAreas] = useState<OperationalAreaItem[]>([]);
  const [activeCompId, setActiveCompId] = useState<string | null>(null);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [activeLobCode, setActiveLobCode] = useState<string>("PIGGERY");
  const [farms, setFarms] = useState<FarmItem[]>([]);
  const [activeFarmIdState, setActiveFarmIdState] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = getStoredUser();
    setUser(storedUser);

    const scope = getActiveWorkspaceScope();
    setCurrentScope(scope);

    const compId = getActiveCompanyId();
    setActiveCompId(compId);

    const areaId = getActiveOperationalAreaId();
    setActiveAreaId(areaId);

    const lob = getActiveLob();
    setActiveLobCode(lob);

    setActiveFarmIdState(getActiveFarmId());

    // Fetch companies and operational areas
    const tenantId = getStoredTenantId() || storedUser?.tenantId;
    const isTenantAdminUser = storedUser?.userType === "TENANT_ADMIN";
    // A STANDARD_USER's farm is fixed (user_master.farm_id) — they never pick
    // one, so there is nothing to fetch for them here (decided 2026-09-14/15).
    const canSelectFarmUser = storedUser?.userType !== "STANDARD_USER";

    if (tenantId) {
      api.get(`/company/tenant/${tenantId}`).then((res: any) => {
        if (Array.isArray(res)) {
          if (isTenantAdminUser) {
            setCompanies(res);
          } else {
            // Strict Company Admin / User boundary: Only allow assigned companies
            const userAllowedCompanyIds = new Set([
              storedUser?.companyId,
              ...(storedUser?.companies || []).map((c: any) => c.company_id),
            ].filter(Boolean));
            setCompanies(res.filter((c: any) => userAllowedCompanyIds.has(c.company_id)));
          }
        }
      }).catch(() => {
        if (!isTenantAdminUser && storedUser?.companies) {
          setCompanies(storedUser.companies);
        }
      });

      api.get(`/operational-area${compId ? `?company_id=${compId}` : ""}`).then((res: any) => {
        if (Array.isArray(res)) {
          if (isTenantAdminUser || storedUser?.userType === "COMPANY_ADMIN") {
            // Tenant/company admins operate across every area in their allowed companies.
            const userAllowedCompanyIds = new Set([
              storedUser?.companyId,
              ...(storedUser?.companies || []).map((c: any) => c.company_id),
            ].filter(Boolean));
            const allowed = isTenantAdminUser ? res : res.filter((a: any) => userAllowedCompanyIds.has(a.company_id));
            setOperationalAreas(allowed);
            if (scope === "OPERATIONAL" && areaId) {
              const matched = allowed.find((a: any) => a.area_id === areaId);
              if (matched) setActiveOperationalArea(matched);
            }
          } else {
            // Operational admins / standard users: only areas they're explicitly assigned to.
            const userAllowedAreaIds = new Set((storedUser?.operationalAreas || []).map((a: any) => a.area_id));
            const allowed = res.filter((a: any) => userAllowedAreaIds.has(a.area_id));
            setOperationalAreas(allowed);
            if (scope === "OPERATIONAL" && areaId) {
              const matched = allowed.find((a: any) => a.area_id === areaId);
              if (matched) setActiveOperationalArea(matched);
            }
          }
        }
      }).catch(() => {
        // Fallback default operational areas if fresh
        if (storedUser?.operationalAreas && storedUser.operationalAreas.length > 0) {
          setOperationalAreas(storedUser.operationalAreas);
        }
      });

      if (canSelectFarmUser) {
        // isActive=true: a retired farm (FARM-001 sits at is_active=0) must not
        // be offered as a choice, because pinning it 403s every farm-scoped
        // request and the screens read as if the data were gone.
        api.get(`/location?locationType=FARM&rootOnly=true&isActive=true`).then((res: any) => {
          const rows = Array.isArray(res) ? res : res?.data;
          if (Array.isArray(rows)) setFarms(rows);
        }).catch(() => {});
      }
    }
  }, []);

  const handleSelectTenantScope = () => {
    setActiveWorkspaceScope("TENANT");
    setActiveOperationalAreaId(null);
    setActiveOperationalArea(null);
    setCurrentScope("TENANT");
    setIsOpen(false);
    window.location.href = "/dashboard";
  };

  const handleSelectCompany = (companyId: string) => {
    setActiveCompanyId(companyId);
    setActiveWorkspaceScope("COMPANY");
    setActiveOperationalAreaId(null);
    setActiveOperationalArea(null);
    // The farm pinned under the previous company is not a farm of this one.
    // apiRequest keeps sending x-active-farm-id from storage regardless of
    // company, and resolveFarmScope 403s any farm-scoped request once the
    // farm no longer belongs to the active company — so it must be cleared
    // here, not left for the user to notice and fix via "All farms".
    setActiveFarmId(null);
    setActiveFarmIdState(null);
    setCurrentScope("COMPANY");
    setActiveCompId(companyId);

    updateStoredUser({ companyId, company_id: companyId });

    setIsOpen(false);
    window.location.href = "/dashboard";
  };

  const handleSelectOperationalArea = (area: OperationalAreaItem) => {
    setActiveCompanyId(area.company_id);
    setActiveOperationalAreaId(area.area_id);
    setActiveOperationalArea(area as any);
    setActiveWorkspaceScope("OPERATIONAL");
    // Same reasoning as handleSelectCompany: switching the operational area
    // can also switch the company underneath it, and a farm pinned to the
    // old company must not survive the move.
    setActiveFarmId(null);
    setActiveFarmIdState(null);

    const normalizedLob = resolveLobFamily(area.lob_code, area.lob_name, area.area_name);
    setActiveLob(normalizedLob);
    setCurrentScope("OPERATIONAL");
    setActiveAreaId(area.area_id);
    setActiveLobCode(normalizedLob);

    updateStoredUser({
      companyId: area.company_id,
      company_id: area.company_id,
      operationalAreaId: area.area_id,
      operational_area_id: area.area_id,
    });

    setIsOpen(false);
    window.location.href = "/dashboard";
  };

  const handleSelectFarm = (farmId: string | null) => {
    setActiveFarmId(farmId);
    setActiveFarmIdState(farmId);
    setIsOpen(false);
    window.location.href = "/dashboard";
  };

  const activeCompanyObj = companies.find((c) => c.company_id === activeCompId) ||
    user?.companies?.find((c) => c.company_id === activeCompId) ||
    companies[0] ||
    user?.companies?.[0];

  const activeAreaObj = operationalAreas.find((a) => a.area_id === activeAreaId) || operationalAreas[0];

  // Derive label and badge text
  let scopeBadge = "TENANT";
  let primaryTitle = "Organization Overview";
  let secondarySubtitle = "All Companies & Group Masters";

  if (currentScope === "COMPANY") {
    scopeBadge = "COMPANY";
    primaryTitle = activeCompanyObj?.company_name || "Active Company";
    secondarySubtitle = "Subsidiary & Commercial Operations";
  } else if (currentScope === "OPERATIONAL") {
    scopeBadge = `AREA · ${activeLobCode}`;
    primaryTitle = activeAreaObj?.area_name || `${activeLobCode} Operational Area`;
    secondarySubtitle = `${activeCompanyObj?.company_name || "Company"} Farm Operations`;
  }

  // A pinned farm is part of the answer to "where am I?": without it the
  // collapsed trigger reads the same whether the workspace is showing every
  // farm or one, and there is no visible way to tell which farm failed when
  // a farm-scoped request is refused.
  const activeFarmObj = farms.find((f) => f.location_id === activeFarmIdState) || null;

  const isTenantAdmin = user?.userType === "TENANT_ADMIN";
  const isCompanyAdmin = user?.userType === "COMPANY_ADMIN" || isTenantAdmin;
  // Every user type except STANDARD_USER may view every farm or select one
  // (decided 2026-09-14/15) — a STANDARD_USER's farm is fixed to
  // user_master.farm_id and is never a switch.
  const canSelectFarm = !!user && user.userType !== "STANDARD_USER";

  const standardUserFarm = user?.farm;
  const fixedFarmLabel = user?.userType === "STANDARD_USER" && standardUserFarm
    ? t("wsFixedFarmLabel", { code: standardUserFarm.location_code, name: standardUserFarm.location_name })
    : null;

  // A switcher only makes sense when there's something to switch to. A
  // STANDARD_USER assigned to exactly one area, or a COMPANY_ADMIN of
  // exactly one company with no other areas, has no real choice — showing
  // an interactive dropdown there implies capability that isn't there. A
  // farm-selecting user with at least one farm to choose from (including
  // "All farms" versus one) does have a real choice, even with one company.
  const canSwitch = isTenantAdmin || (isCompanyAdmin && companies.length > 1) || operationalAreas.length > 1
    || (canSelectFarm && farms.length > 0);

  const identityBlock = (
    <>
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white/50">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--sidebar-active-accent)" }} />
          {scopeBadge}
        </span>
        {canSwitch && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 group-hover:text-white/80 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        )}
      </div>
      <p className="text-xs font-semibold text-white truncate tracking-tight">
        {primaryTitle}
      </p>
      <p className="text-[10px] text-white/40 truncate mt-0.5">
        {secondarySubtitle}
      </p>
      {/* F3: name the pinned farm on the collapsed trigger. A farm pin is a
          scope like any other — leaving it invisible made a farm-filtered
          screen read as "my data is gone" instead of "this is another farm". */}
      {activeFarmObj && (
        <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--sidebar-active-accent)" }}>
          {activeFarmObj.location_code} — {activeFarmObj.location_name}
        </p>
      )}
      {fixedFarmLabel && (
        <p className="text-[10px] text-white/40 truncate mt-0.5">
          {fixedFarmLabel}
        </p>
      )}
    </>
  );

  if (!canSwitch) {
    // Same identity display, no switch affordance — no button semantics,
    // no hover/focus state, no chevron: there's nothing to click into.
    return (
      <div className="w-full rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.05] p-2.5">
        {identityBlock}
      </div>
    );
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      align="start"
      side="bottom"
      floating
      haspopup="dialog"
      panelRole="dialog"
      label={t("wsWorkspaceScope")}
      className="w-full"
      panelClassName="nf-scope-popover-panel"
      trigger={(props) => (
        <button
          {...props}
          className="w-full text-left transition-all duration-150 rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.05] hover:bg-white/[0.08] p-2.5 group focus:outline-none focus:ring-1 focus:ring-white/20 cursor-pointer"
          aria-label={t("wsSwitchScope")}
        >
          {identityBlock}
        </button>
      )}
    >
      <div
        className="px-3.5 py-2.5 border-b flex items-center justify-between shrink-0"
        style={{
          backgroundColor: "var(--surface-raised)",
          borderColor: "var(--border)",
        }}
      >
        <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: "var(--text-secondary)" }}>
          {t("wsWorkspaceScope")}
        </span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded tracking-wide uppercase shrink-0"
          style={{
            backgroundColor: "var(--accent-muted)",
            color: "var(--accent)",
          }}
        >
          {user?.userType?.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2.5">
            {/* 1. Tenant Scope (Available for TENANT_ADMIN) */}
            {isTenantAdmin && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("wsOrganizationLevel")}</div>
                <button
                  onClick={handleSelectTenantScope}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-sm)] text-xs transition-colors text-left ${
                    currentScope === "TENANT"
                      ? "font-semibold"
                      : "hover:bg-[var(--surface-raised)]"
                  }`}
                  style={
                    currentScope === "TENANT"
                      ? { backgroundColor: "var(--accent-muted)", color: "var(--accent)" }
                      : { color: "var(--text-primary)" }
                  }
                >
                  <Building className="w-4 h-4 shrink-0" style={{ color: "var(--accent)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{t("wsTenantRootWorkspace")}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>{t("wsConsolidatedMetrics")}</p>
                  </div>
                  {currentScope === "TENANT" && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                </button>
              </div>
            )}

            {/* 2. Companies List */}
            {isCompanyAdmin && companies.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("wsLegalEntities")}</div>
                <div className="space-y-0.5">
                  {companies.map((comp) => {
                    const isSelected = currentScope === "COMPANY" && activeCompId === comp.company_id;
                    return (
                      <button
                        key={comp.company_id}
                        onClick={() => handleSelectCompany(comp.company_id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors text-left ${
                          isSelected
                            ? "font-semibold"
                            : "hover:bg-[var(--surface-raised)]"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: "var(--accent-muted)", color: "var(--accent)" }
                            : { color: "var(--text-primary)" }
                        }
                      >
                        <Building2 className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-secondary)" }} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{comp.company_name}</p>
                          <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                            {comp.company_code || "Company Scope"}
                          </p>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Operational Areas */}
            <div>
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
                <span>{t("wsOperationalFarmAreas")}</span>
                {isCompanyAdmin && (
                  <a
                    href="/operational-areas"
                    onClick={() => setIsOpen(false)}
                    className="text-[10px] hover:underline flex items-center gap-0.5"
                    style={{ color: "var(--accent)" }}
                  >
                    <Plus className="w-2.5 h-2.5" />{t("wsNewArea")}</a>
                )}
              </div>

              {operationalAreas.length === 0 ? (
                <div className="px-3 py-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>{t("dashNoOpAreasConfigured")}</div>
              ) : (
                <div className="space-y-0.5">
                  {operationalAreas.map((area) => {
                    const isSelected = currentScope === "OPERATIONAL" && activeAreaId === area.area_id;
                    const lobLabel = (area.lob_name || area.lob_code || area.lob_id || "PIGGERY").toUpperCase();
                    const isPig = lobLabel.includes("PIG") || lobLabel.includes("SWINE");
                    const isDairy = lobLabel.includes("DAIRY") || lobLabel.includes("CATTLE");

                    return (
                      <button
                        key={area.area_id}
                        onClick={() => handleSelectOperationalArea(area)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors text-left ${
                          isSelected
                            ? "font-semibold"
                            : "hover:bg-[var(--surface-raised)]"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: "var(--accent-muted)", color: "var(--accent)" }
                            : { color: "var(--text-primary)" }
                        }
                      >
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border"
                          style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                        >
                          <Layers className="h-3 w-3" style={{ color: "var(--accent)" }} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{area.area_name}</p>
                          <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                            {area.company_name ? `${area.company_name} · ` : ""}{isPig ? "Piggery" : isDairy ? "Dairy" : lobLabel} · {area.area_code}
                          </p>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 4. Farms — every user type but STANDARD_USER may view every
                farm or pin the workspace to one (decided 2026-09-14/15). */}
            {canSelectFarm && farms.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("wsFarms")}</div>
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => handleSelectFarm(null)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors text-left ${
                      activeFarmIdState === null ? "font-semibold" : "hover:bg-[var(--surface-raised)]"
                    }`}
                    style={
                      activeFarmIdState === null
                        ? { backgroundColor: "var(--accent-muted)", color: "var(--accent)" }
                        : { color: "var(--text-primary)" }
                    }
                  >
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border"
                      style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                    >
                      <Layers className="h-3 w-3" style={{ color: "var(--accent)" }} />
                    </span>
                    <span className="flex-1 min-w-0 truncate font-medium">{t("wsAllFarms")}</span>
                    {activeFarmIdState === null && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                  </button>
                  {farms.map((farm) => {
                    const isSelected = activeFarmIdState === farm.location_id;
                    return (
                      <button
                        key={farm.location_id}
                        type="button"
                        onClick={() => handleSelectFarm(farm.location_id)}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs transition-colors text-left ${
                          isSelected ? "font-semibold" : "hover:bg-[var(--surface-raised)]"
                        }`}
                        style={
                          isSelected
                            ? { backgroundColor: "var(--accent-muted)", color: "var(--accent)" }
                            : { color: "var(--text-primary)" }
                        }
                      >
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border"
                          style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                        >
                          <Building className="h-3 w-3" style={{ color: "var(--accent)" }} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{farm.location_name}</p>
                          <p className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>{farm.location_code}</p>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
        )}
      </div>

      <div
        className="p-2.5 border-t shrink-0"
        style={{
          backgroundColor: "var(--surface-raised)",
          borderColor: "var(--border)",
        }}
      >
        <p className="text-[10px] text-center leading-normal" style={{ color: "var(--text-muted)" }}>
          {t("wsActiveScopeNote")}
        </p>
      </div>
    </Popover>
  );
}

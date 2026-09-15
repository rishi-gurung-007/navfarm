"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Filter,
  ChevronRight,
  Activity,
  Layers,
  ArrowUpRight,
  Wheat,
  Building2,
  DollarSign,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { api } from "../../../services/api-client";
import {
  getStoredUser,
  getStoredToken,
  getStoredTenantId,
  getActiveCompanyId,
  setActiveCompanyId,
  getActiveWorkspaceScope,
  setActiveWorkspaceScope,
  getActiveLob,
  setActiveLob,
  getActiveOperationalAreaId,
  setActiveOperationalAreaId,
  WorkspaceScope,
  NavUser,
} from "../../../hooks/useAuth";
import { useLanguage } from "../../../hooks/useLanguage";
import { useCompanyCurrency } from "../../../hooks/useCompanyCurrency";
import { LoadingState, ErrorState } from "../../../components/ui/states";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ConsolePage } from "../../../components/ui/console-page";
import { StatRow, StatCard } from "../../../components/ui/stat-row";
import { resolveLobFamily } from "@/lib/lob";

const CHART_COLORS = ["var(--accent)", "var(--success)", "var(--info)", "var(--warning)", "#8a6fd6", "#4fb0a5"];

function ChartCard({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyChartState({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
      {label}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: "12px",
  color: "var(--text-primary)",
};

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(null);
  const [scope, setScope] = useState<WorkspaceScope>("COMPANY");
  const [activeLob, setActiveLobState] = useState<string>("PIGGERY");
  const [activeCompanyId, setActiveCompanyIdState] = useState<string>("");
  // Amounts render in the active company's configured currency, not a hardcoded one.
  const { formatMoney } = useCompanyCurrency();
  const [companies, setCompanies] = useState<any[]>([]);
  const [operationalAreas, setOperationalAreas] = useState<any[]>([]);
  const [tenantInfo, setTenantInfo] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [animals, setAnimals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters State
  const [filterTenantCompany, setFilterTenantCompany] = useState<string>("ALL");
  const [filterLob, setFilterLob] = useState<string>("ALL");
  const [filterArea, setFilterArea] = useState<string>("ALL");
  // OPERATIONAL scope: view aggregated stats across every batch in this area,
  // or drill into one. Defaults to the first active batch, matching the old
  // hardcoded behavior, but is now a real, switchable selection.
  const [batchViewMode, setBatchViewMode] = useState<string>("ALL");

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tenantId = getStoredTenantId();
    if (!token || !storedUser || !tenantId) {
      router.replace("/");
      return;
    }
    const currentScope = getActiveWorkspaceScope();
    const currentLob = getActiveLob();
    const compId = getActiveCompanyId() || storedUser.companyId || (storedUser as any).company_id || "";

    setUser(storedUser);
    setScope(currentScope);
    setActiveLobState(currentLob);
    setActiveCompanyIdState(compId);

    loadDashboard(storedUser, tenantId, compId, currentScope);
  }, [router]);

  const loadDashboard = async (storedUser: NavUser, tenantId: string, compId: string, currentScope: WorkspaceScope = getActiveWorkspaceScope()) => {
    setLoading(true);
    try {
      // The tenant record and the full cross-tenant company list are only
      // ever rendered in TENANT scope — for COMPANY/OPERATIONAL scope the
      // active company's name/id is already in storedUser.companies, so
      // skip both tenant-wide calls instead of syncing data nothing reads.
      const isTenantScope = currentScope === "TENANT";
      const [tenant, compRes, areasRes, batchRes, animalRes] = await Promise.all([
        isTenantScope ? api.get(`/tenant/${tenantId}`).catch(() => null) : Promise.resolve(null),
        isTenantScope ? api.get(`/company/tenant/${tenantId}`).catch(() => []) : Promise.resolve(storedUser.companies || []),
        api.get(`/operational-area${compId && currentScope !== "TENANT" ? `?company_id=${compId}` : ""}`).catch(() => []),
        // Batch and herd are the dashboard's substance, so their failures are
        // not swallowed into empty arrays: a farm-scoped 403 rendered as
        // "0 herd / no batches recorded yet", which reads as lost data rather
        // than as the wrong-farm refusal it is.
        api.get(`/batch${compId && currentScope !== "TENANT" ? `?companyId=${compId}&limit=100` : "?limit=100"}`),
        api.get(`/animal${compId && currentScope !== "TENANT" ? `?companyId=${compId}&limit=500` : "?limit=500"}`),
      ]);

      setTenantInfo(tenant);
      if (Array.isArray(compRes)) setCompanies(compRes);
      if (Array.isArray(areasRes)) setOperationalAreas(areasRes);
      setBatches(Array.isArray(batchRes) ? batchRes : (batchRes?.data ?? []));
      setAnimals(Array.isArray(animalRes) ? animalRes : (animalRes?.data ?? []));
    } catch (e: any) {
      setError(e?.message || t("dashLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState label={t("dashLoadingTelemetry")} />;

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={() => user && loadDashboard(user, getStoredTenantId() || "", activeCompanyId, scope)} />
      </div>
    );
  }

  // Active Company Record
  const activeCompany = companies.find((c) => c.company_id === activeCompanyId) || companies[0];

  // Dynamic LOB options for filter
  const availableLobs = Array.from(
    new Set(
      operationalAreas
        .filter((a) => scope === "TENANT" || !activeCompanyId || a.company_id === activeCompanyId)
        .map((a) => a.lob_code || a.lob_name || "PIGGERY")
    )
  );

  // Switch to an operational area
  const handleEnterArea = (area: any) => {
    setActiveCompanyId(area.company_id);
    setActiveOperationalAreaId(area.area_id);
    setActiveWorkspaceScope("OPERATIONAL");
    setActiveLob(resolveLobFamily(area.lob_code, area.lob_name, area.area_name));
    window.location.href = "/dashboard";
  };

  // Switch to a company
  const handleEnterCompany = (comp: any) => {
    setActiveCompanyId(comp.company_id);
    setActiveOperationalAreaId(null);
    setActiveWorkspaceScope("COMPANY");
    window.location.href = "/dashboard";
  };

  // ── TENANT scope: apply the Company + LOB filters to what's rendered ──
  const tenantLobCompanyIds = new Set(
    filterLob === "ALL"
      ? companies.map((c) => c.company_id)
      : operationalAreas.filter((a) => (a.lob_code || a.lob_name) === filterLob).map((a) => a.company_id)
  );
  const filteredCompanies = companies.filter(
    (c) => (filterTenantCompany === "ALL" || c.company_id === filterTenantCompany) && tenantLobCompanyIds.has(c.company_id)
  );
  const filteredCompanyIds = new Set(filteredCompanies.map((c) => c.company_id));
  const tenantScopedBatches = batches.filter((b) => filteredCompanyIds.has(b.company_id));
  const tenantScopedAnimals = animals.filter((a) => filteredCompanyIds.has(a.company_id));
  const tenantScopedAreas = operationalAreas.filter((a) => filteredCompanyIds.has(a.company_id));

  // ── COMPANY scope: LOB + Operational Area filters narrow the areas grid ──
  const companyVisibleAreas = operationalAreas.filter(
    (a) => (filterLob === "ALL" || (a.lob_code || a.lob_name) === filterLob) && (filterArea === "ALL" || a.area_id === filterArea)
  );

  // ── OPERATIONAL scope: All Batches vs one specific batch ──
  const singleBatch = batchViewMode === "ALL" ? undefined : batches.find((b) => b.batch_id === batchViewMode);
  const isAllBatchesView = batchViewMode === "ALL" || !singleBatch;
  const activeArea = operationalAreas.find((a) => a.area_id === getActiveOperationalAreaId());

  return (
    <ConsolePage className="text-(--text-primary)">
      {/* ── Top Header Bar & Scope-Specific Title & Filters ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <div>
          <PageHeader
            title={
              scope === "TENANT"
                ? t("dashTenantTitle", { tenant: tenantInfo?.tenant_name || "Enterprise" })
                : scope === "COMPANY"
                ? t("dashCompanyTitle", { company: activeCompany?.company_name || "Company" })
                : t("dashAreaOperationsTitle", { area: activeArea?.area_name || activeLob })
            }
            description={
              scope === "TENANT"
                ? t("dashTenantDesc")
                : scope === "COMPANY"
                ? t("dashCompanyDesc")
                : activeLob === "DAIRY"
                ? t("dashDairyDesc")
                : t("dashPiggeryDesc")
            }
            sticky={false}
          />
        </div>

        {/* ── Filters Bar ── */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Tenant Scope Filters: Company + LOB */}
          {scope === "TENANT" && (
            <>
              {companies.length > 0 && (
                <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <Building2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <span style={{ color: "var(--text-secondary)" }}>{t("dashCompanyColon")}</span>
                  <select
                    value={filterTenantCompany}
                    onChange={(e) => setFilterTenantCompany(e.target.value)}
                    className="min-w-0 max-w-full truncate bg-transparent font-semibold outline-none cursor-pointer"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <option value="ALL">{t("dashAllCompanies", { n: companies.length })}</option>
                    {companies.map((c) => (
                      <option key={c.company_id} value={c.company_id}>
                        {c.company_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {availableLobs.length > 0 && (
                <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <Filter className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <span style={{ color: "var(--text-secondary)" }}>{t("dashLobColon")}</span>
                  <select
                    value={filterLob}
                    onChange={(e) => setFilterLob(e.target.value)}
                    className="min-w-0 max-w-full truncate bg-transparent font-semibold outline-none cursor-pointer"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <option value="ALL">{t("dashAllLobs", { n: availableLobs.length })}</option>
                    {availableLobs.map((lob) => (
                      <option key={lob} value={lob}>
                        {lob}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Company Scope Filters: LOB + Operational Area */}
          {scope === "COMPANY" && availableLobs.length > 0 && (
            <>
              <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                <Filter className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <span style={{ color: "var(--text-secondary)" }}>{t("dashLobColon")}</span>
                <select
                  value={filterLob}
                  onChange={(e) => setFilterLob(e.target.value)}
                  className="min-w-0 max-w-full truncate bg-transparent font-semibold outline-none cursor-pointer"
                  style={{ color: "var(--text-primary)" }}
                >
                  <option value="ALL">{t("dashAllCompanyLobs", { n: availableLobs.length })}</option>
                  {availableLobs.map((lob) => (
                    <option key={lob} value={lob}>
                      {lob}
                    </option>
                  ))}
                </select>
              </div>

              {operationalAreas.length > 0 && (
                <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <Layers className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <span style={{ color: "var(--text-secondary)" }}>{t("dashOperationalAreaColon")}</span>
                  <select
                    value={filterArea}
                    onChange={(e) => setFilterArea(e.target.value)}
                    className="min-w-0 max-w-full truncate bg-transparent font-semibold outline-none cursor-pointer"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <option value="ALL">{t("dashAllAreas", { n: operationalAreas.length })}</option>
                    {operationalAreas.map((a) => (
                      <option key={a.area_id} value={a.area_id}>
                        {a.area_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Operational Area Badge + Batch view toggle */}
          {scope === "OPERATIONAL" && (
            <>
              <div className="flex items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: "var(--surface-raised)", border: "1px solid var(--border)" }}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--success)" }} />
                <span>{activeArea?.area_name || activeLob}</span>
              </div>
              {batches.length > 0 && (
                <div className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <Layers className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                  <span style={{ color: "var(--text-secondary)" }}>{t("dashBatchColon")}</span>
                  <select
                    value={batchViewMode}
                    onChange={(e) => setBatchViewMode(e.target.value)}
                    className="min-w-0 max-w-full truncate bg-transparent font-semibold outline-none cursor-pointer"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <option value="ALL">{t("dashAllBatches", { n: batches.length })}</option>
                    {batches.map((b) => (
                      <option key={b.batch_id} value={b.batch_id}>
                        {b.batch_no}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ── 1. TENANT SCOPE DASHBOARD (Group Multi-Entity Command Center) ── */}
      {/* ========================================================================= */}
      {scope === "TENANT" && (
        <div className="space-y-6">
          {/* 4 Group KPI Stat Strips */}
          <StatRow>
            <StatCard
              icon={Building2}
              label={t("dashOperatingCompanies")}
              value={filteredCompanies.length}
              unit={t("statusActive")}
              onClick={() => router.push("/companies")}
              sub={
                <span className="flex items-center justify-between">
                  <span>{filteredCompanies.map(c => c.company_name).slice(0, 2).join(", ") || t("dashConfiguredEntities")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </span>
              }
            />
            <StatCard
              icon={Activity}
              label={t("dashBiologicalCensus")}
              value={tenantScopedAnimals.length > 0 ? tenantScopedAnimals.length : tenantScopedBatches.reduce((sum, b) => sum + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0)}
              unit={t("dashHeadCount")}
              onClick={() => router.push("/livestock")}
              sub={
                <span className="flex items-center justify-between">
                  <span>{t("dashAcrossProductionBatches", { n: tenantScopedBatches.length })}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </span>
              }
            />
            <StatCard
              icon={Layers}
              label={t("dashActiveBatches")}
              value={tenantScopedBatches.filter(b => b.status === "ACTIVE" || !b.status).length}
              unit={t("dashInProgress")}
              onClick={() => router.push("/batches")}
              sub={
                <span className="flex items-center justify-between">
                  <span>{t("dashNOperationalAreas", { n: tenantScopedAreas.length })}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </span>
              }
            />
            <StatCard
              icon={DollarSign}
              label={t("dashGroupBatchValuation")}
              value={formatMoney(tenantScopedBatches.reduce((sum, b) => sum + (Number(b.wip_value) || 0), 0))}
              unit={t("dashWip")}
              onClick={() => router.push("/finance/journal")}
              sub={
                <span className="flex items-center justify-between">
                  <span>{t("dashStandardDirectCostAllocation")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </span>
              }
            />
          </StatRow>

          {/* Batches & Population by Company */}
          <ChartCard title={t("dashBatchesPopulationByCompany")} subtitle={t("dashBatchesPopulationByCompanyDesc")}>
            {filteredCompanies.length === 0 ? (
              <EmptyChartState label={t("dashNoCompaniesMatchFilters")} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={filteredCompanies.map((c) => {
                    const cBatches = tenantScopedBatches.filter((b) => b.company_id === c.company_id);
                    const cAnimals = tenantScopedAnimals.filter((a) => a.company_id === c.company_id);
                    return {
                      name: c.company_name?.length > 18 ? `${c.company_name.slice(0, 18)}…` : c.company_name,
                      Batches: cBatches.length,
                      Population: cAnimals.length > 0 ? cAnimals.length : cBatches.reduce((s, b) => s + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0),
                    };
                  })}
                  margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Batches" name={t("dashBatchesWord")} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Population" name={t("dashPopulationWord")} fill="var(--success)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Tenant Executive Multi-Company Benchmark Table */}
          <div className="rounded-[var(--radius-md)] border p-5 space-y-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">{t("dashEntityMatrixTitle")}</h2>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t("dashEntityMatrixDesc")}
                </p>
              </div>
              <Link href="/companies" className="text-xs font-semibold hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }}>
                {t("dashViewAllCompanies")} <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-[11px] font-semibold uppercase" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                    <th className="px-3 pb-2.5">{t("dashColCompany")}</th>
                    <th className="px-3 pb-2.5">{t("dashColNob")}</th>
                    <th className="px-3 pb-2.5">{t("dashColOpAreas")}</th>
                    <th className="px-3 pb-2.5 text-right">{t("dashColBatches")}</th>
                    <th className="px-3 pb-2.5 text-right">{t("dashColPopulation")}</th>
                    <th className="px-3 pb-2.5 text-right">{t("dashColStatus")}</th>
                    <th className="px-3 pb-2.5 text-right">{t("dashColAction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {filteredCompanies.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center" style={{ color: "var(--text-muted)" }}>
                        {t("dashNoCompaniesMatchFilters")}
                      </td>
                    </tr>
                  )}
                  {filteredCompanies.map((comp) => {
                    const compAreas = operationalAreas.filter((a) => a.company_id === comp.company_id);
                    const compAnimals = animals.filter((a) => a.company_id === comp.company_id);
                    const compBatches = batches.filter((b) => b.company_id === comp.company_id);
                    const compHeadcount = compAnimals.length > 0
                      ? compAnimals.length
                      : compBatches.reduce((sum, b) => sum + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0);

                    return (
                      <tr key={comp.company_id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
                            <span>{comp.company_name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3" style={{ color: "var(--text-secondary)" }}>{comp.nob_name || t("dashDefaultNob")}</td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1.5 flex-wrap">
                            {compAreas.length > 0 ? (
                              compAreas.map((a) => (
                                <span key={a.area_id} className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium border" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                                  {a.area_name}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{t("dashNoAreas")}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-semibold">{compBatches.length}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold">{t("dashNHead", { n: compHeadcount })}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium border" style={{ backgroundColor: "var(--success-muted)", borderColor: "var(--success)", color: "var(--success)" }}>
                            {t("statusActive")}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => handleEnterCompany(comp)}
                            className="nf-press rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: "var(--accent)" }}
                          >
                            {t("dashOpen")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ── 2. COMPANY SCOPE DASHBOARD (Company Overview & Operational Areas) ── */}
      {/* ========================================================================= */}
      {scope === "COMPANY" && (
        <div className="space-y-6">
          {/* 4 Company KPI Stat Strips */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div
              onClick={() => router.push("/operational-areas")}
              className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("operationalAreas")}
                </span>
                <Layers className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono">{operationalAreas.length}</span>
                <span className="text-xs font-medium" style={{ color: "var(--success)" }}>{t("dashConfigured")}</span>
              </div>
              <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                <span>{operationalAreas.map(a => a.area_name).join(", ") || t("dashActiveAreasFallback")}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
              </p>
            </div>

            <div
              onClick={() => router.push("/livestock")}
              className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("dashBiologicalPopulation")}
                </span>
                <Activity className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono">
                  {animals.length > 0 ? animals.length : batches.reduce((sum, b) => sum + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0)}
                </span>
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{t("dashHeadCount")}</span>
              </div>
              <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                <span>{t("dashNIdentifiedAnimalRecords", { n: animals.length })}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
              </p>
            </div>

            <div
              onClick={() => router.push("/batches")}
              className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("dashProductionBatches")}
                </span>
                <Layers className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono">
                  {batches.filter(b => b.status === "ACTIVE" || !b.status).length}
                </span>
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{t("dashBatchesWord")}</span>
              </div>
              <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                <span>{t("dashActiveLifecycleProgression")}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
              </p>
            </div>

            <div
              onClick={() => router.push("/finance/journal")}
              className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
              style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {t("dashActiveBatchWip")}
                </span>
                <DollarSign className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight font-mono">
                  {formatMoney(batches.reduce((sum, b) => sum + (Number(b.wip_value) || 0), 0))}
                </span>
                <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{t("dashWip")}</span>
              </div>
              <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                <span>{t("dashLiveBatchWipValuation")}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title={t("dashBatchesByOpArea")} subtitle={t("dashBatchesByOpAreaDesc")}>
              {operationalAreas.length === 0 ? (
                <EmptyChartState label={t("dashNoOpAreasConfigured")} />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={operationalAreas.map((a) => ({
                      name: a.area_name?.length > 16 ? `${a.area_name.slice(0, 16)}…` : a.area_name,
                      Batches: batches.filter((b) => b.company_id === a.company_id).length,
                    }))}
                    margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="Batches" name={t("dashBatchesWord")} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title={t("dashBatchStatusBreakdown")} subtitle={t("dashBatchStatusBreakdownDesc")}>
              {batches.length === 0 ? (
                <EmptyChartState label={t("dashNoBatchesRecorded")} />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    layout="vertical"
                    data={Object.entries(
                      batches.reduce((acc: Record<string, number>, b) => {
                        const key = b.status || "ACTIVE";
                        acc[key] = (acc[key] || 0) + 1;
                        return acc;
                      }, {})
                    ).map(([name, value]) => ({ name, value }))}
                    margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={80} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" name={t("dashBatchesWord")} radius={[0, 4, 4, 0]}>
                      {Object.keys(
                        batches.reduce((acc: Record<string, number>, b) => {
                          const key = b.status || "ACTIVE";
                          acc[key] = (acc[key] || 0) + 1;
                          return acc;
                        }, {})
                      ).map((key, idx) => (
                        <Cell key={key} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Operational Area Cards */}
          <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">{t("dashOpAreasCount", { n: companyVisibleAreas.length })}</h2>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t("dashFarmSitesFor", { company: activeCompany?.company_name || "" })}
                </p>
              </div>
              <Link href="/operational-areas" className="text-xs font-semibold hover:underline flex items-center gap-1" style={{ color: "var(--accent)" }}>
                {t("dashManageAreas")} <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {companyVisibleAreas.length === 0 && (
                <p className="text-xs col-span-full text-center py-6" style={{ color: "var(--text-muted)" }}>
                  {t("dashNoOpAreasMatchFilters")}
                </p>
              )}
              {companyVisibleAreas.map((area) => {
                const isPig = area.lob_code?.includes("PIG") || area.area_name?.toLowerCase().includes("pig");
                const isDairy = area.lob_code?.includes("DAIRY") || area.area_name?.toLowerCase().includes("dairy");
                return (
                  <div
                    key={area.area_id}
                    className="flex flex-col justify-between rounded-[var(--radius-sm)] border p-4 transition-all hover:bg-[var(--surface)]"
                    style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold" style={{ color: "var(--accent)" }}>{area.area_code}</span>
                        <span className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium border" style={{ backgroundColor: "var(--success-muted)", borderColor: "var(--success)", color: "var(--success)" }}>
                          {t("statusActive")}
                        </span>
                      </div>
                      <h3 className="mt-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                        {area.area_name}
                      </h3>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                        {isPig ? t("dashSwineAreaDesc") : isDairy ? t("dashDairyAreaDesc") : t("dashAgriAreaDesc")}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                      <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        {isPig ? t("dashSwineLivestockBatchOps") : isDairy ? t("dashDairyCattleBatchOps") : t("dashProductionBatchWord")}
                      </span>
                      <button
                        onClick={() => handleEnterArea(area)}
                        className="nf-press flex items-center gap-1 rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: "var(--accent)" }}
                      >
                        <span>{t("dashOpenArea")}</span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ── 3. OPERATIONAL SCOPE: PIGGERY DASHBOARD ── */}
      {/* ========================================================================= */}
      {scope === "OPERATIONAL" && activeLob === "PIGGERY" && (() => {
        const activeBatch = singleBatch || batches.find(b => b.status === "ACTIVE") || batches[0];
        const aggAssignedHead = batches.reduce((sum, b) => sum + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0);
        const assignedHead = isAllBatchesView
          ? (animals.length > 0 ? animals.length : aggAssignedHead)
          : Number(activeBatch?.closing_quantity) || Number(activeBatch?.opening_quantity) || (animals.length > 0 ? animals.length : 0);
        const aggWip = batches.reduce((sum, b) => sum + (Number(b.wip_value) || 0), 0);

        const stageBreakdown = Object.entries(
          batches.reduce((acc: Record<string, number>, b) => {
            const key = b.current_stage_code || "UNSTAGED";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {})
        ).map(([name, value]) => ({ name, value }));

        return (
          <div className="space-y-6">
            {/* 4 Piggery Operational Stat Strips */}
            <StatRow>
              <StatCard
                icon={Activity}
                label={t("dashBreedingSowsGilts")}
                value={animals.length > 0 ? animals.length : assignedHead}
                unit={t("dashActiveHerd")}
                onClick={() => router.push("/livestock")}
                sub={
                  <span className="flex items-center justify-between">
                    {/* Real breed only — this used to fall back to a hardcoded
                        "Large White lineage", which showed on Landrace batches. */}
                    <span>{activeBatch?.breed_name || "—"}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                  </span>
                }
              />
              <StatCard
                icon={Layers}
                label={isAllBatchesView ? t("dashBatchesInView") : t("dashActiveGestationBatch")}
                // In "all batches" mode this rendered the whole sentence
                // "All batches (2)" at metric size — a phrase styled as a number,
                // which broke badly in non-Latin scripts. Show the count.
                value={isAllBatchesView ? batches.length : (activeBatch?.batch_no || "—")}
                onClick={() => router.push("/batches")}
                sub={
                  <span className="flex items-center justify-between">
                    <span>{isAllBatchesView ? t("dashNDistinctStages", { n: stageBreakdown.length }) : t("dashStageColon", { stage: activeBatch?.current_stage_code || "ACTIVE" })}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                  </span>
                }
              />
              <StatCard
                icon={Wheat}
                label={t("dashActiveBatches")}
                value={batches.length}
                unit={t("dashBatchesWord")}
                onClick={() => router.push("/batches/records")}
                sub={
                  <span className="flex items-center justify-between">
                    <span>{t("dashUnderActiveOperations")}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                  </span>
                }
              />
              <StatCard
                icon={DollarSign}
                label={t("dashBatchWipValuation")}
                value={formatMoney(isAllBatchesView ? aggWip : Number(activeBatch?.wip_value || 0))}
                unit={t("dashWip")}
                onClick={() => router.push("/livestock")}
                sub={
                  <span className="flex items-center justify-between">
                    <span>{t("dashDirectCostAllocation")}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                  </span>
                }
              />
            </StatRow>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {isAllBatchesView ? (
                  <ChartCard title={t("dashBatchesByStage")} subtitle={t("dashBatchesByStageDesc")}>
                    {stageBreakdown.length === 0 ? (
                      <EmptyChartState label={t("dashNoBatchesRecorded")} />
                    ) : (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={stageBreakdown} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                          <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                          <Tooltip contentStyle={tooltipStyle} />
                          <Bar dataKey="value" name={t("dashBatchesWord")} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                ) : (
                  <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold">{t("dashActiveSowBatchLifecycle", { batchNo: activeBatch?.batch_no || "PIG-BATCH-001" })}</h3>
                      <Link href="/batches/entry" className="text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>
                        {t("dashOpenBatchEntry")}
                      </Link>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border p-4 space-y-3" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
                      <div className="flex justify-between text-xs">
                        <span>{t("dashCurrentStageColon")} <strong>{activeBatch?.current_stage_code || "GESTATION"}</strong></span>
                        <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{t("dashActiveLifecycleWord")}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: "65%", backgroundColor: "var(--accent)" }} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs" style={{ borderColor: "var(--border)" }}>
                        <div><span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("dashBreedLabel")}</span><p className="font-semibold">{activeBatch?.breed_name || "Large White"}</p></div>
                        <div><span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("dashAssignedHeadLabel")}</span><p className="font-semibold">{t("dashNHead", { n: assignedHead })}</p></div>
                        <div><span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{t("dashColStatus")}</span><p className="font-semibold" style={{ color: "var(--success)" }}>{activeBatch?.status || "ACTIVE"}</p></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold mb-3">{t("quickActionsHeading")}</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => router.push("/batches/entry")}
                      className="nf-press flex w-full items-center justify-between rounded-[var(--radius-sm)] border p-2.5 text-xs font-semibold hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span>{t("dashLogDailyOperations")}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => router.push("/livestock")}
                      className="nf-press flex w-full items-center justify-between rounded-[var(--radius-sm)] border p-2.5 text-xs font-semibold hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span>{t("dashAnimalEarTagRegister")}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* ── 4. OPERATIONAL SCOPE: DAIRY DASHBOARD ── */}
      {/* ========================================================================= */}
      {scope === "OPERATIONAL" && activeLob === "DAIRY" && (() => {
        const dairyBatches = batches.filter(b => (b.batch_no || "").includes("COW") || (b.lob_name || "").includes("DAIRY"));
        const activeDairyBatch = singleBatch || dairyBatches[0] || batches[0];
        const dairyHead = animals.filter(a => a.animal_type?.includes("COW") || a.breed_name?.includes("Holstein") || a.gender === "F").length || 80;

        const dairyStageBreakdown = Object.entries(
          dairyBatches.reduce((acc: Record<string, number>, b) => {
            const key = b.current_stage_code || "UNSTAGED";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {})
        ).map(([name, value]) => ({ name, value }));

        return (
          <div className="space-y-6">
            {/* 4 Dairy Operational Stat Strips */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                onClick={() => router.push("/livestock")}
                className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    {t("dashTotalDairyHerd")}
                  </span>
                  <Activity className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight font-mono">{dairyHead}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--success)" }}>{t("dashActiveHeadWord")}</span>
                </div>
                <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                  <span>{t("dashHolsteinFriesianHerd")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </p>
              </div>

              <div
                onClick={() => router.push("/batches/entry")}
                className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    {t("dashDairyBatchesWord")}
                  </span>
                  <Layers className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight font-mono">{dairyBatches.length || 1}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{t("dashBatchesWord")}</span>
                </div>
                <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                  <span>{isAllBatchesView ? t("dashViewingAllBatches") : t("dashBatchColonValue", { batchNo: activeDairyBatch?.batch_no || "COW-LAC-001" })}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </p>
              </div>

              <div
                onClick={() => router.push("/batches/records")}
                className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    {t("dashMilkQualityBenchmark")}
                  </span>
                  <Activity className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight font-mono">4.15% {t("dashFatLabel")}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>8.85% SNF</span>
                </div>
                <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                  <span>{t("dashGradeAStandard")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </p>
              </div>

              <div
                onClick={() => router.push("/inventory/balance")}
                className="nf-press group rounded-[var(--radius-md)] border p-5 transition-all hover:bg-[var(--surface-raised)] cursor-pointer"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    {t("dashActiveWipAsset")}
                  </span>
                  <DollarSign className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold tracking-tight font-mono">
                    {formatMoney(activeDairyBatch?.wip_value || 0)}
                  </span>
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{t("dashValuationWord")}</span>
                </div>
                <p className="mt-2 text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                  <span>{t("dashBiologicalAssetValuation")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                {isAllBatchesView ? (
                  <ChartCard title={t("dashDairyBatchesByStage")} subtitle={t("dashDairyBatchesByStageDesc")}>
                    {dairyStageBreakdown.length === 0 ? (
                      <EmptyChartState label={t("dashNoDairyBatchesRecorded")} />
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={dairyStageBreakdown} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                          <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} allowDecimals={false} />
                          <Tooltip contentStyle={tooltipStyle} />
                          <Bar dataKey="value" name={t("dashBatchesWord")} fill="var(--accent)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </ChartCard>
                ) : (
                  <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                    <h3 className="text-sm font-semibold mb-3">{t("dashTodaysMilkingSessionBreakdown")}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-[var(--radius-sm)] border p-3.5" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
                        <span className="text-[11px] uppercase font-semibold" style={{ color: "var(--text-secondary)" }}>{t("dashMorningSession")}</span>
                        <p className="text-2xl font-bold font-mono mt-1">1,180 L</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("dashAvgLCowFat", { vol: "14.75", fat: "4.18" })}</p>
                      </div>
                      <div className="rounded-[var(--radius-sm)] border p-3.5" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
                        <span className="text-[11px] uppercase font-semibold" style={{ color: "var(--text-secondary)" }}>{t("dashEveningSession")}</span>
                        <p className="text-2xl font-bold font-mono mt-1">1,100 L</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("dashAvgLCowFat", { vol: "13.75", fat: "4.12" })}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-[var(--radius-md)] border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                  <h3 className="text-sm font-semibold mb-3">{t("dashDairyQuickActions")}</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => router.push("/batches/entry")}
                      className="nf-press flex w-full items-center justify-between rounded-[var(--radius-sm)] border p-2.5 text-xs font-semibold hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span>{t("dashLogDailyMilkingTmr")}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => router.push("/livestock")}
                      className="nf-press flex w-full items-center justify-between rounded-[var(--radius-sm)] border p-2.5 text-xs font-semibold hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span>{t("dashDairyCattleRegister")}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </ConsolePage>
  );
}

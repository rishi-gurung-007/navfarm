"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, RefreshCw, AlertCircle, CheckCircle, XCircle, X,
  ArrowUpRight, Users, Layers, Database, Building, Mail,
  Shield, Calendar, Activity, ChevronDown, ChevronUp,
  MapPin, Phone,
} from "lucide-react";
import { api } from "../../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../../hooks/useAuth";
import { Dialog } from "../../../../components/ui/dialog";
import { PageHeader } from "../../../../components/ui/PageHeader";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../../components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";

const S = {
  surface:  { backgroundColor: "var(--surface)",        borderColor: "var(--border)" },
  raised:   { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary:  { color: "var(--text-primary)" },
  sub:      { color: "var(--text-secondary)" },
  muted:    { color: "var(--text-muted)" },
  accent:   { color: "var(--accent)" },
  border:   { borderColor: "var(--border)" },
  input:    { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="px-5 py-3.5 border-b" style={S.border}>
      <div className="nf-text-caption mb-1">{label}</div>
      <div className="text-sm font-semibold truncate" style={S.primary}>{value ?? "—"}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, accent = false }: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; accent?: boolean;
}) {
  return (
    <div className="p-5" style={S.surface}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{label}</span>
        <Icon className="w-4 h-4" style={accent ? { color: "var(--accent)" } : S.muted} />
      </div>
      <div className="text-2xl font-semibold" style={S.primary}>{value}</div>
      {sub && <div className="text-xs mt-1 truncate" style={S.sub}>{sub}</div>}
    </div>
  );
}

function Badge({ children, color = "default" }: { children: React.ReactNode; color?: "green"|"amber"|"blue"|"purple"|"default" }) {
  const style: Record<string, React.CSSProperties> = {
    green:   { backgroundColor: "var(--success-muted)", color: "var(--success)", borderColor: "var(--success)" },
    amber:   { backgroundColor: "var(--warning-muted)", color: "var(--warning)", borderColor: "var(--warning)" },
    blue:    { backgroundColor: "var(--color-blue-soft)", color: "var(--info)", borderColor: "var(--info)" },
    purple:  { backgroundColor: "var(--badge-bg)", color: "var(--text-secondary)", borderColor: "var(--border)" },
    default: { backgroundColor: "var(--surface-secondary)", color: "var(--text-secondary)", borderColor: "var(--border)" },
  };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold border px-2.5 py-0.5 rounded-[var(--radius-pill)]" style={style[color]}>
      {children}
    </span>
  );
}

function MiniCard({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="min-w-0">
      <div className="nf-text-caption mb-1">{label}</div>
      <div className="text-xs font-semibold truncate" style={S.primary}>{value ?? "—"}</div>
    </div>
  );
}

const CountryMap: Record<string, string> = {
  IND: "India",
  USA: "United States",
  GBR: "United Kingdom",
  ARE: "UAE",
  SGP: "Singapore",
  "40000000-4000-4000-4000-400000000001": "India",
};

export default function TenantDetailPage() {
  const { t } = useLanguage();
  const router   = useRouter();
  const params   = useParams();
  const tenantId = params?.id as string;

  const [tenant,       setTenant]       = useState<any>(null);
  const [companies,    setCompanies]    = useState<any[]>([]);
  const [users,        setUsers]        = useState<any[]>([]);
  const [plans,        setPlans]        = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState("");
  const [success,      setSuccess]      = useState("");
  const [upgrading,    setUpgrading]    = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [showPlanDialog, setShowPlanDialog] = useState(false);

  const [companyDetails,  setCompanyDetails]  = useState<Record<string, any>>({});
  const [loadingDetails,  setLoadingDetails]  = useState<Record<string, boolean>>({});
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  // Catalogs mapping states
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [nobs,       setNobs]       = useState<any[]>([]);
  const [lobs,       setLobs]       = useState<any[]>([]);

  // Edit Permitted Sectors (NOB/LOB) state
  const [showSectorModal, setShowSectorModal] = useState(false);
  const [editNobIds,      setEditNobIds]      = useState<string[]>([]);
  const [editLobIds,      setEditLobIds]      = useState<string[]>([]);
  const [savingSectors,   setSavingSectors]   = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const user  = getStoredUser();
    if (!token || !user || user.userType !== "SYSTEM_ADMIN") { router.replace("/"); return; }
    if (!tenantId) { router.replace("/admin/tenants"); return; }
    loadAll();
  }, [tenantId]); // eslint-disable-line

  const loadAll = async () => {
    setLoading(true); setError("");
    try {
      const [tenantData, companiesList, usersList, plansList, currenciesList, nobsList] = await Promise.all([
        api.get(`/tenant/${tenantId}`),
        api.get(`/tenant/${tenantId}/companies`),
        api.get(`/tenant/${tenantId}/users`),
        api.get("/plan"),
        api.get("/currency").catch(() => []),
        api.get("/setup/wizard/nobs").catch(() => []),
      ]);
      setTenant(tenantData);
      const cos = Array.isArray(companiesList) ? companiesList : [];
      setCompanies(cos);
      setUsers(Array.isArray(usersList) ? usersList : []);
      setPlans(Array.isArray(plansList) ? plansList : []);
      setSelectedPlan(tenantData?.plan_id || "");
      setCurrencies(Array.isArray(currenciesList) ? currenciesList : currenciesList?.data ?? []);
      setNobs(nobsList || []);
      setEditNobIds(Array.isArray(tenantData?.allowed_nob_ids) ? tenantData.allowed_nob_ids : nobsList.map((n: any) => n.nob_id));
      setEditLobIds(Array.isArray(tenantData?.allowed_lob_ids) ? tenantData.allowed_lob_ids : []);

      // If we have NOBs, load all of their LOB sub-sectors in parallel
      if (nobsList && nobsList.length > 0) {
        try {
          const lobsPromises = nobsList.map((nobItem: any) =>
            api.get(`/setup/wizard/lobs/${nobItem.nob_id}`).catch(() => [])
          );
          const lobsResult = await Promise.all(lobsPromises);
          setLobs(lobsResult.flat());
        } catch (err) {
          console.error("Failed to load LOB sub-sectors:", err);
        }
      }

      if (cos.length > 0) {
        const detailsMap: Record<string, any> = {};
        const results = await Promise.allSettled(
          cos.map((co: any) => api.get(`/setup/wizard/company-details/${co.company_id}`, {
            headers: { "x-tenant-id": tenantId }
          }))
        );
        results.forEach((r, i) => {
          if (r.status === "fulfilled") detailsMap[cos[i].company_id] = r.value;
        });
        setCompanyDetails(detailsMap);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load tenant details.");
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanyDetails = useCallback(async (companyId: string) => {
    if (companyDetails[companyId] || loadingDetails[companyId]) return;
    setLoadingDetails(prev => ({ ...prev, [companyId]: true }));
    try {
      const d = await api.get(`/setup/wizard/company-details/${companyId}`, {
        headers: { "x-tenant-id": tenantId }
      });
      setCompanyDetails(prev => ({ ...prev, [companyId]: d }));
    } catch { /* silent */ }
    finally { setLoadingDetails(prev => ({ ...prev, [companyId]: false })); }
  }, [companyDetails, loadingDetails, tenantId]);

  const toggleExpand = (companyId: string) => {
    if (expandedCompany === companyId) { setExpandedCompany(null); return; }
    setExpandedCompany(companyId);
    fetchCompanyDetails(companyId);
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || selectedPlan === tenant?.plan_id) return;
    setUpgrading(true); setError(""); setSuccess("");
    try {
      await api.post(`/tenant/${tenantId}/change-plan`, { plan_id: selectedPlan });
      setSuccess("Subscription plan updated successfully.");
      setShowPlanDialog(false);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Failed to update plan.");
    } finally { setUpgrading(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw className="animate-spin w-5 h-5 mr-2" style={S.accent} />
      <span className="text-sm" style={S.sub}>{t("admLoadingTenantDetails")}</span>
    </div>
  );

  if (!tenant) return (
    <div className="p-6">
      <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-4 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0" />{t("admTenantNotFound")}</div>
      <Link href="/admin/tenants" className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium" style={S.accent}>
        <ArrowLeft className="w-4 h-4" />{t("admBackToTenants")}</Link>
    </div>
  );

  const completedCos = companies.filter((c) => c.onboarding_status === "COMPLETED").length;
  const activeUsers  = users.filter((u) => u.is_active).length;
  const planLabel    = tenant.plan_id?.replace("PLAN_", "") || "—";
  const companyMap   = Object.fromEntries(companies.map((c) => [c.company_id, c.company_name]));
  const isSystemTenant = tenant?.tenant_id === "00000000-0000-0000-0000-000000000000" || tenant?.tenant_code === "system";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      <Link href="/admin/tenants" className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline" style={S.sub}>
        <ArrowLeft className="w-4 h-4" />{t("admBackToTenants")}</Link>

      <PageHeader
        title={tenant.tenant_name}
        description={
          <span className="flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5" /> {tenant.billing_email || "—"}
            <span className="mx-2 opacity-40">·</span>
            <span className="font-mono text-xs">{tenant.tenant_code}</span>
          </span>
        }
        actions={
          <>
            <Badge color={tenant.is_active ? "green" : "default"}>
              {tenant.is_active ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {tenant.is_active ? "Active" : "Inactive"}
            </Badge>
            {tenant.is_trial && <Badge color="amber">{t("admTrial")}</Badge>}
          </>
        }
      />

      {error   && <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-4 text-sm"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
      {success && <div className="flex items-center gap-2 text-(--success) bg-(--success-muted) border border-(--success) rounded-lg p-4 text-sm"><CheckCircle className="w-4 h-4 shrink-0" /> {success}</div>}

      {/* Summary strip — one bordered surface with hairline dividers between
          segments, not four separate cards competing for attention. */}
      <div
        className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border sm:grid-cols-4"
        style={{ backgroundColor: "var(--border)", borderColor: "var(--border)" }}
      >
        <StatCard icon={Building} label={t("companies")} value={companies.length}
          sub={`${completedCos} onboarded · ${companies.length - completedCos} pending`} />
        <StatCard icon={Users}    label={t("admUsers")}      value={users.length}
          sub={`${activeUsers} active · ${users.length - activeUsers} inactive`} />
        <StatCard icon={Layers}   label={t("admPlan")}       value={planLabel}
          sub={tenant.billing_cycle || "—"} />
        <StatCard icon={Database} label={t("admDatabase")}   value={tenant.db_name || "—"}
          sub={`${tenant.db_host || "localhost"}:${tenant.db_port || 3306}`} />
      </div>

      {/* Tenant Config */}
      <div className="rounded-lg border overflow-hidden" style={S.surface}>
        <div className="px-6 py-4 border-b flex items-center gap-2" style={S.border}>
          <Shield className="w-4 h-4" style={S.muted} />
          <h2 className="nf-text-label-strong" style={S.primary}>{t("admTenantConfiguration")}</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          <InfoRow label={t("admTenantId")}       value={tenant.tenant_id} />
          <InfoRow label={t("admTenantCode")}     value={tenant.tenant_code} />
          <InfoRow label={t("btColAnimalType")}            value={tenant.tenant_type || "STANDARD"} />
          <InfoRow label={t("admPlan")}            value={planLabel} />
          <InfoRow label={t("admBillingCycle")}   value={tenant.billing_cycle || "—"} />
          <InfoRow label={t("admMaxCompanies")}   value={tenant.max_companies} />
          <InfoRow label={t("admMaxUsers")}       value={tenant.max_users} />
          <InfoRow label={t("admApiRateLimit")}  value={tenant.api_rate_limit ? `${tenant.api_rate_limit} req/hr` : "—"} />
          <InfoRow label={t("admPlanStart")}      value={tenant.plan_start_date || "—"} />
          <InfoRow label={t("admPlanEnd")}        value={tenant.plan_end_date || "Ongoing"} />
          <InfoRow label={t("admDbHost")}         value={`${tenant.db_host || "localhost"}:${tenant.db_port || 3306}`} />
          <InfoRow label={t("admDbName")}         value={tenant.db_name || "—"} />
          <InfoRow label={t("admBillingEmail")}   value={tenant.billing_email || "—"} />
          <InfoRow label={t("admCreatedAt")}      value={tenant.created_at ? new Date(tenant.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
        </div>
      </div>

      {/* Permitted Business Sectors (NOB & LOB) */}
      <div className="rounded-lg border overflow-hidden" style={S.surface}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={S.border}>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4" style={S.muted} />
            <h2 className="nf-text-label-strong" style={S.primary}>{t("admPermittedSectors")}</h2>
          </div>
          <button
            onClick={() => {
              setEditNobIds(Array.isArray(tenant.allowed_nob_ids) && tenant.allowed_nob_ids.length > 0
                ? tenant.allowed_nob_ids
                : nobs.map(n => n.nob_id));
              setEditLobIds(Array.isArray(tenant.allowed_lob_ids) && tenant.allowed_lob_ids.length > 0
                ? tenant.allowed_lob_ids
                : lobs.map(l => l.lob_id));
              setShowSectorModal(true);
            }}
            className="nf-press flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-(--surface-secondary)"
            style={{ ...S.surface, ...S.primary }}
          >{t("admConfigureSectorAccess")}</button>
        </div>
        <div className="p-6">
          {(!tenant.allowed_nob_ids || tenant.allowed_nob_ids.length === 0) ? (
            <p className="text-xs font-semibold text-(--success) bg-(--success-muted) border border-(--success) rounded-lg p-3">{t("admFullSectorAccess")}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {nobs
                  .filter(n => tenant.allowed_nob_ids.includes(n.nob_id))
                  .map(n => (
                    <div key={n.nob_id} className="flex flex-col gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                      style={{ backgroundColor: "var(--surface-secondary)", color: "var(--text-primary)", borderColor: "var(--border)" }}>
                      <span>{n.nob_name} ({n.nob_code})</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lobs
                          .filter(l => l.nob_id === n.nob_id && (!tenant.allowed_lob_ids || tenant.allowed_lob_ids.length === 0 || tenant.allowed_lob_ids.includes(l.lob_id)))
                          .map(l => (
                            <span key={l.lob_id} className="rounded-[var(--radius-xs)] px-2 py-0.5 text-[10px] font-normal" style={{ backgroundColor: "var(--badge-bg)", color: "var(--text-secondary)" }}>
                              {l.lob_name}
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Plan Upgrade */}
      <div className="flex flex-col gap-4 rounded-[var(--radius-sm)] border p-5 sm:flex-row sm:items-center sm:justify-between" style={S.surface}>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-(--warning-muted) p-2 text-(--warning)"><ArrowUpRight className="h-4 w-4" /></div>
          <div>
            <h2 className="text-sm font-semibold" style={S.primary}>{t("admSubscriptionPlan")}</h2>
            <p className="mt-0.5 text-sm" style={S.sub}>{isSystemTenant ? "The platform tenant uses a fixed plan." : `Currently on ${planLabel}.`}</p>
          </div>
        </div>
        {!isSystemTenant && <button type="button" onClick={() => setShowPlanDialog(true)} className="min-h-10 rounded-lg bg-(--accent) px-4 text-sm font-semibold text-white hover:bg-(--accent-hover)">{t("admChangePlan")}</button>}
      </div>

      <Dialog open={showPlanDialog} onClose={() => !upgrading && setShowPlanDialog(false)} title={t("admChangeSubscriptionPlan")} description={`Choose a new plan for ${tenant.tenant_name}.`} maxWidth="sm">
        <form onSubmit={handleUpgrade} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider" style={S.sub}>{t("admNewPlan")}</label>
            <select value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)}
              className="min-h-11 w-full rounded-lg border px-4 text-sm nf-select" style={S.input}>
              <option value="">— Select a plan —</option>
              {plans.map((p) => (
                <option key={p.plan_id} value={p.plan_id}>{p.plan_name} — {p.billing_cycle} · ${p.price}</option>
              ))}
            </select>
          </div>
          {selectedPlan && selectedPlan === tenant?.plan_id && (
            <p className="text-xs" style={S.muted}>{t("admCurrentPlan")}</p>
          )}
          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end" style={S.border}>
            <button type="button" disabled={upgrading} onClick={() => setShowPlanDialog(false)} className="min-h-10 rounded-lg border border-(--border) bg-(--surface) px-4 text-sm font-semibold text-(--text-secondary) hover:bg-(--surface-raised) disabled:opacity-50">{t("cancel")}</button>
            <button type="submit" disabled={!selectedPlan || upgrading || selectedPlan === tenant?.plan_id}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
              {upgrading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              {upgrading ? "Updating…" : "Apply plan change"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* ── Companies Table ── */}
      <div className="rounded-lg border overflow-hidden" style={S.surface}>
        <div className="px-6 py-4 border-b flex items-center gap-2" style={S.border}>
          <Building className="w-4 h-4" style={S.muted} />
          <h2 className="nf-text-label-strong" style={S.primary}>
            Companies under this Tenant ({companies.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                {["#", "Company Name", "Reg. No.", "Country", "Currency", "NOB", "LOBs", "Onboarding", ""].map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <tr><TableCell colSpan={9} className="text-center py-12" style={S.muted}>{t("coNoCompanies")}</TableCell></tr>
              ) : companies.map((co, idx) => {
                const d          = companyDetails[co.company_id];
                const isExpanded = expandedCompany === co.company_id;
                const isLoading  = loadingDetails[co.company_id];

                const regNo      = d?.company?.registration_no  || co.company_reg_no || "—";
                const country    = d?.company?.country_id        || co.country         || "—";
                const currency   = d?.company?.base_currency_id  || co.currency_id     || "—";
                const modules    = d?.modules || [];

                const nobCodes   = modules.filter((m: string) => !m.includes("_"));
                const lobCodes   = modules.filter((m: string) => m.includes("_"));

                // Resolve country name
                const countryName = CountryMap[country] || country;

                // Resolve currency name
                const currencyObj = currencies.find(c => c.currency_id === currency || c.iso_code === currency);
                const currencyName = currencyObj ? `${currencyObj.currency_name} (${currencyObj.iso_code})` : currency;

                // Resolve Nature of Business names
                const resolvedNobs = nobCodes.map((code: string) => {
                  const found = nobs.find(n => n.nob_code === code);
                  return found ? found.nob_name : code;
                });

                // Resolve Line of Business names
                const resolvedLobs = lobCodes.map((code: string) => {
                  const found = lobs.find(l => l.lob_code === code);
                  return found ? found.lob_name : code;
                });

                return (
                  <React.Fragment key={co.company_id}>
                    <TableRow
                      onClick={() => toggleExpand(co.company_id)}
                      className="cursor-pointer hover:opacity-90"
                      style={{ backgroundColor: isExpanded ? "var(--accent-muted)" : undefined }}
                    >
                      <TableCell className="font-mono" style={S.muted}>{idx + 1}</TableCell>
                      <TableCell className="font-semibold" style={S.primary}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                            style={{ backgroundColor: "var(--accent)" }}>
                            {co.company_code?.substring(0, 2) || "CO"}
                          </div>
                          <div>
                            <div>{co.company_name || "—"}</div>
                            <div className="text-[10px] font-mono" style={S.muted}>{co.company_code}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono" style={S.sub}>{regNo}</TableCell>
                      <TableCell style={S.sub}>{countryName}</TableCell>
                      <TableCell className="font-semibold" style={S.sub}>
                        {currencyName}
                      </TableCell>
                      <TableCell>
                        {resolvedNobs.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {resolvedNobs.map((n: string) => (
                              <span key={n} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-xs)] border"
                                style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)", borderColor: "var(--accent)" }}>{n}</span>
                            ))}
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {resolvedLobs.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {resolvedLobs.slice(0, 3).map((l: string) => (
                              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)] border font-semibold"
                                style={{ backgroundColor: "var(--surface-raised)", color: "var(--text-secondary)", borderColor: "var(--border)" }}>{l}</span>
                            ))}
                            {resolvedLobs.length > 3 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-xs)] border" style={{ ...S.raised, ...S.muted }}>+{resolvedLobs.length - 3}</span>
                            )}
                          </div>
                        ) : <span style={S.muted}>—</span>}
                      </TableCell>
                      <TableCell>
                        {co.onboarding_status === "COMPLETED" ? (
                          <Badge color="green"><CheckCircle className="w-3 h-3" />{t("coStatusComplete")}</Badge>
                        ) : (
                          <Badge color="amber"><Activity className="w-3 h-3" /> {co.onboarding_status || "Pending"}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs font-semibold flex items-center gap-1 justify-end" style={S.accent}>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? "Hide" : "Details"}
                        </span>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <tr key={`${co.company_id}-expanded`}>
                        <TableCell colSpan={9} className="border-b p-0" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                          {isLoading ? (
                            <div className="flex items-center gap-2 px-8 py-6 text-sm" style={S.muted}>
                              <RefreshCw className="w-4 h-4 animate-spin" />{t("admLoadingDetails")}</div>
                          ) : d ? (
                            <div className="px-6 py-5 space-y-6 border-l-4" style={{ borderColor: "var(--accent)" }}>

                              {/* Profile */}
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                  <Building className="w-3.5 h-3.5" />{t("admCompanyProfile")}</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                                  <MiniCard label={t("admLegalName")}   value={d.company?.company_name} />
                                  <MiniCard label={t("wzDisplayName")} value={d.company?.company_display_name || d.company?.company_name} />
                                  <MiniCard label={t("btColAnimalType")}         value={d.company?.company_type} />
                                  <MiniCard label={t("ctIndustry")}     value={d.company?.industry_type} />
                                  <MiniCard label={t("admTaxId")}       value={d.company?.tax_id} />
                                  <MiniCard label={t("country")}      value={countryName} />
                                  <MiniCard label={t("admCurrency")}     value={currencyName} />
                                </div>
                              </div>

                              {/* Address */}
                              {d.address && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                    <MapPin className="w-3.5 h-3.5" />{t("admRegisteredAddress")}</p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                    <MiniCard label={t("btColAnimalType")}    value={d.address.address_type} />
                                    <MiniCard label={t("admLine1")}  value={d.address.line1} />
                                    <MiniCard label={t("ctCity")}    value={d.address.city} />
                                    <MiniCard label={t("admState")}   value={d.address.state_id} />
                                    <MiniCard label={t("ctPincode")} value={d.address.pincode} />
                                  </div>
                                </div>
                              )}

                              {/* Contact */}
                              {d.contact && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                    <Phone className="w-3.5 h-3.5" />{t("admPrimaryContact")}</p>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <MiniCard label={t("usrColName")}        value={d.contact.full_name} />
                                    <MiniCard label={t("profileDesignation")} value={d.contact.designation} />
                                    <MiniCard label={t("authEmail")}       value={d.contact.email} />
                                    <MiniCard label={t("profilePhone")}       value={d.contact.phone_primary} />
                                  </div>
                                </div>
                              )}

                              {/* Fiscal */}
                              {d.fiscal && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                    <Calendar className="w-3.5 h-3.5" />{t("admFiscalConfiguration")}</p>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                                    <MiniCard label={t("admFiscalYear")}    value={d.fiscal.current_fiscal_year} />
                                    <MiniCard label={t("admStartMonth")}    value={d.fiscal.fiscal_start_month} />
                                    <MiniCard label={t("ctPeriodType")}    value={d.fiscal.period_type} />
                                    <MiniCard label={t("blCostingStandard")}       value={d.fiscal.accounting_standard} />
                                    <MiniCard label={t("admInventoryVal")} value={d.fiscal.inventory_valuation} />
                                    <MiniCard label={t("admFyFormat")}      value={d.fiscal.fiscal_year_format} />
                                  </div>
                                </div>
                              )}

                              {/* Modules */}
                              {modules.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                    <Layers className="w-3.5 h-3.5" /> Enabled Modules ({modules.length})
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {modules.map((m: string) => {
                                      const isLob = m.includes("_");
                                      const displayName = isLob
                                        ? (lobs.find(l => l.lob_code === m)?.lob_name || m)
                                        : (nobs.find(n => n.nob_code === m)?.nob_name || m);
                                      return (
                                        <span key={m}
                                          className="text-[11px] font-semibold px-2.5 py-1 rounded-[var(--radius-pill)] border"
                                          style={isLob
                                            ? { borderColor: "var(--info)", backgroundColor: "var(--color-blue-soft)", color: "var(--info)" }
                                            : { borderColor: "var(--border)", backgroundColor: "var(--surface-secondary)", color: "var(--text-secondary)" }}>
                                          {displayName}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Associated Members */}
                              {(() => {
                                const coUsers = users.filter(u => u.company_id === co.company_id);
                                return coUsers.length > 0 ? (
                                  <div>
                                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={S.muted}>
                                      <Users className="w-3.5 h-3.5" /> Associated Members ({coUsers.length})
                                    </p>
                                    <div className="rounded-lg border overflow-hidden" style={S.surface}>
                                      <table className="w-full border-collapse text-xs">
                                        <TableHeader>
                                          <tr className="border-b border-(--row-border)">
                                            {["#", "Name", "Email", "Phone", "Type", "Role", "Status"].map(h => (
                                              <TableHead key={h} className="h-auto py-2.5 text-[10px]">{h}</TableHead>
                                            ))}
                                          </tr>
                                        </TableHeader>
                                        <TableBody>
                                          {coUsers.map((u: any, i: number) => (
                                            <TableRow key={u.user_id}>
                                              <TableCell className="py-2.5 font-mono" style={S.muted}>{i + 1}</TableCell>
                                              <TableCell className="py-2.5 font-semibold" style={S.primary}>
                                                <div className="flex items-center gap-2">
                                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-semibold shrink-0"
                                                    style={{ backgroundColor: "var(--accent)" }}>
                                                    {u.full_name?.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase() || "?"}
                                                  </div>
                                                  {u.full_name || "—"}
                                                </div>
                                              </TableCell>
                                              <TableCell className="py-2.5" style={S.sub}>{u.email || "—"}</TableCell>
                                              <TableCell className="py-2.5" style={S.sub}>{u.phone || "—"}</TableCell>
                                              <TableCell className="py-2.5">
                                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] border"
                                                  style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)", borderColor: "var(--accent)" }}>
                                                  {u.user_type?.replace(/_/g, " ") || "—"}
                                                </span>
                                              </TableCell>
                                              <TableCell className="py-2.5" style={S.sub}>{u.role_name || u.role_code || "—"}</TableCell>
                                              <TableCell className="py-2.5">
                                                <Badge color={u.is_active ? "green" : "default"}>
                                                  {u.is_active ? "Active" : "Inactive"}
                                                </Badge>
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </table>
                                    </div>
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          ) : (
                            <p className="px-8 py-5 text-xs" style={S.muted}>{t("admNoSetupFound")}</p>
                          )}
                        </TableCell>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </table>
        </div>
      </div>

      {/* ── Users Table ── */}
      <div className="rounded-lg border overflow-hidden" style={S.surface}>
        <div className="px-6 py-4 border-b flex items-center gap-2" style={S.border}>
          <Users className="w-4 h-4" style={S.muted} />
          <h2 className="nf-text-label-strong" style={S.primary}>
            Users in this Tenant ({users.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                {["#", "Full Name", "Email", "Phone", "Type", "Role", "Company", "Status"].map((h) => (
                  <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <tr><TableCell colSpan={8} className="text-center py-12" style={S.muted}>{t("admNoUsersFound")}</TableCell></tr>
              ) : users.map((u, idx) => (
                <TableRow key={u.user_id || idx} className="hover:opacity-90">
                  <TableCell className="font-mono" style={S.muted}>{idx + 1}</TableCell>
                  <TableCell className="font-semibold" style={S.primary}>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                        style={{ backgroundColor: "var(--accent)" }}>
                        {u.full_name?.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase() || "?"}
                      </div>
                      {u.full_name || "—"}
                    </div>
                  </TableCell>
                  <TableCell style={S.sub}>{u.email || "—"}</TableCell>
                  <TableCell style={S.sub}>{u.phone || "—"}</TableCell>
                  <TableCell>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border"
                      style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)", borderColor: "var(--accent)" }}>
                      {u.user_type?.replace(/_/g, " ") || "—"}
                    </span>
                  </TableCell>
                  <TableCell style={S.sub}>{u.role_name || u.role_code || "—"}</TableCell>
                  <TableCell style={S.sub}>
                    {u.company_id ? (
                      <div>
                        <div className="font-semibold" style={S.primary}>{companyMap[u.company_id] || "Unknown"}</div>
                        <div className="font-mono text-[10px] mt-0.5" style={S.muted}>{u.company_id.substring(0, 12)}…</div>
                      </div>
                    ) : u.user_type === "TENANT_ADMIN" ? (
                      <Badge color="purple">{t("admAllCompanies")}</Badge>
                    ) : (
                      <span style={S.muted}>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge color={u.is_active ? "green" : "default"}>
                      {u.is_active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {u.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </div>

      {/* ── Configure Sector Access Modal ── */}
      {showSectorModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 60,
          backgroundColor: "rgba(46,49,63,0.5)",
          display: "flex", alignItems: "center",
          justifyContent: "center", padding: 16, overflowY: "auto",
        }}>
          <div className="rounded-[var(--radius-lg)] border w-full max-w-2xl my-auto" style={{ ...S.surface, boxShadow: "var(--shadow-md)" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b" style={S.border}>
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5" style={S.accent} />
                <h2 className="text-base font-semibold" style={S.primary}>{t("admConfigureSectorsTitle")}</h2>
              </div>
              <button onClick={() => setShowSectorModal(false)} style={S.muted} className="cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-xs" style={S.sub}>{t("admConfigureSectorsDesc")}</p>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {nobs.map((nob: any) => {
                  const isNobChecked = editNobIds.includes(nob.nob_id);
                  const childLobs = lobs.filter(l => l.nob_id === nob.nob_id);

                  const toggleNob = () => {
                    if (isNobChecked) {
                      setEditNobIds(prev => prev.filter(id => id !== nob.nob_id));
                      const childIds = new Set(childLobs.map(l => l.lob_id));
                      setEditLobIds(prev => prev.filter(id => !childIds.has(id)));
                    } else {
                      setEditNobIds(prev => [...prev, nob.nob_id]);
                      const childIds = childLobs.map(l => l.lob_id);
                      setEditLobIds(prev => Array.from(new Set([...prev, ...childIds])));
                    }
                  };

                  return (
                    <div
                      key={nob.nob_id}
                      className="rounded-lg border p-3.5 transition-colors"
                      style={{
                        backgroundColor: isNobChecked ? "var(--accent-muted)" : "var(--surface-raised)",
                        borderColor: isNobChecked ? "var(--accent)" : "var(--border)",
                      }}
                    >
                      <label className="flex items-center gap-2.5 cursor-pointer font-semibold text-xs select-none" style={S.primary}>
                        <input
                          type="checkbox"
                          checked={isNobChecked}
                          onChange={toggleNob}
                          className="w-4 h-4 rounded-[var(--radius-xs)] accent-(--accent) cursor-pointer"
                        />
                        <span>{nob.nob_name}</span>
                        <span className="text-[10px] font-mono font-normal opacity-60">({nob.nob_code})</span>
                      </label>

                      {isNobChecked && childLobs.length > 0 && (
                        <div className="mt-2.5 ml-6 pt-2 border-t flex flex-wrap gap-2" style={{ borderColor: "var(--border)" }}>
                          {childLobs.map((lob: any) => {
                            const isLobChecked = editLobIds.includes(lob.lob_id);
                            const toggleLob = () => {
                              if (isLobChecked) {
                                setEditLobIds(prev => prev.filter(id => id !== lob.lob_id));
                              } else {
                                setEditLobIds(prev => [...prev, lob.lob_id]);
                              }
                            };

                            return (
                              <label
                                key={lob.lob_id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-xs)] text-[11px] font-medium border cursor-pointer select-none"
                                style={{
                                  backgroundColor: isLobChecked ? "var(--surface)" : "transparent",
                                  borderColor: isLobChecked ? "var(--accent)" : "var(--border)",
                                  color: isLobChecked ? "var(--accent)" : "var(--text-secondary)",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isLobChecked}
                                  onChange={toggleLob}
                                  className="w-3 h-3 rounded-[var(--radius-xs)] accent-(--accent) cursor-pointer"
                                />
                                <span>{lob.lob_name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 pt-3 border-t" style={S.border}>
                <button
                  type="button"
                  disabled={savingSectors}
                  onClick={async () => {
                    setSavingSectors(true); setError(""); setSuccess("");
                    try {
                      await api.patch(`/tenant/${tenantId}`, {
                        allowed_nob_ids: editNobIds,
                        allowed_lob_ids: editLobIds,
                      });
                      setSuccess("Tenant permitted business sectors updated successfully.");
                      setShowSectorModal(false);
                      await loadAll();
                    } catch (err: any) {
                      setError(err?.message || "Failed to update permitted sectors.");
                    } finally {
                      setSavingSectors(false);
                    }
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 cursor-pointer"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  {savingSectors ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {savingSectors ? "Saving..." : "Save Sector Licensing"}
                </button>
                <button type="button" onClick={() => setShowSectorModal(false)}
                  className="px-5 py-2.5 text-sm font-medium rounded-lg border cursor-pointer" style={{ ...S.raised, ...S.sub }}>{t("cancel")}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

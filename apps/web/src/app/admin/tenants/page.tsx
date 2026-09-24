"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building, RefreshCw, AlertCircle, CheckCircle, XCircle,
  ChevronDown, ChevronUp, Search, ArrowUpRight, Eye, Plus
} from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../hooks/useAuth";
import { Dialog } from "../../../components/ui/dialog";
import { Field } from "../../../components/ui/field";
import { Badge } from "../../../components/ui/badge";
import { PageHeader } from "../../../components/ui/PageHeader";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../../components/ui/table";
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

export default function AdminTenantsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [tenants,  setTenants]  = useState<any[]>([]);
  const [plans,    setPlans]    = useState<any[]>([]);
  const [filtered, setFiltered] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");
  const [search,   setSearch]   = useState("");

  const [expandedId,        setExpandedId]        = useState<string | null>(null);
  const [expandedCompanies, setExpandedCompanies] = useState<any[]>([]);
  const [loadingCos,        setLoadingCos]        = useState(false);

  const [upgradingTenant, setUpgradingTenant] = useState<any>(null);
  const [selectedPlanId,  setSelectedPlanId]  = useState("");
  const [upgrading,       setUpgrading]       = useState(false);

  // Add Tenant Modal state
  const [showAddModal, setShowAddModal]   = useState(false);
  const [creating,     setCreating]       = useState(false);
  const [createError,  setCreateError]    = useState("");
  const [createForm,   setCreateForm]     = useState({
    tenant_code: "", tenant_name: "", tenant_type: "SME",
    plan_id: "PLAN_BASIC", billing_email: "",
    admin_name: "", admin_email: "", admin_password: "",
  });

  // NOB & LOB catalog selection state for Super Admin
  const [nobsList, setNobsList] = useState<any[]>([]);
  const [lobsByNob, setLobsByNob] = useState<Record<string, any[]>>({});
  const [selectedNobIds, setSelectedNobIds] = useState<string[]>([]);
  const [selectedLobIds, setSelectedLobIds] = useState<string[]>([]);

  useEffect(() => {
    const token = getStoredToken();
    const user  = getStoredUser();
    if (!token || !user || user.userType !== "SYSTEM_ADMIN") { router.replace("/"); return; }
    loadData();
  }, [router]);

  useEffect(() => {
    if (!search.trim()) { setFiltered(tenants); return; }
    const q = search.toLowerCase();
    setFiltered(tenants.filter((t) =>
      t.tenant_name?.toLowerCase().includes(q) ||
      t.billing_email?.toLowerCase().includes(q) ||
      t.tenant_code?.toLowerCase().includes(q)
    ));
  }, [search, tenants]);

  const loadData = async () => {
    setLoading(true); setError("");
    try {
      const [tList, pList, nobsData] = await Promise.all([
        api.get("/tenant"),
        api.get("/plan"),
        api.get("/setup/wizard/nobs").catch(() => []),
      ]);
      setTenants(tList); setFiltered(tList); setPlans(pList);
      setNobsList(Array.isArray(nobsData) ? nobsData : []);

      // Pre-fetch LOBs for all NOBs
      if (Array.isArray(nobsData) && nobsData.length > 0) {
        const lobMap: Record<string, any[]> = {};
        await Promise.all(
          nobsData.map(async (nob: any) => {
            try {
              const lobs = await api.get(`/setup/wizard/lobs/${nob.nob_id}`);
              lobMap[nob.nob_id] = Array.isArray(lobs) ? lobs : [];
            } catch {
              lobMap[nob.nob_id] = [];
            }
          })
        );
        setLobsByNob(lobMap);
        // By default select all NOBs and LOBs for quick setup
        const allNobIds = nobsData.map((n: any) => n.nob_id);
        const allLobIds = Object.values(lobMap).flat().map((l: any) => l.lob_id);
        setSelectedNobIds(allNobIds);
        setSelectedLobIds(allLobIds);
      }
    } catch (e: any) { setError(e?.message || "Failed to load tenants."); }
    finally { setLoading(false); }
  };

  const handleExpand = async (tenant: any) => {
    if (expandedId === tenant.tenant_id) { setExpandedId(null); return; }
    setExpandedId(tenant.tenant_id);
    setLoadingCos(true);
    try {
      // Use the correct per-tenant endpoint
      const list = await api.get(`/tenant/${tenant.tenant_id}/companies`);
      setExpandedCompanies(Array.isArray(list) ? list : []);
    } catch { setExpandedCompanies([]); }
    finally { setLoadingCos(false); }
  };

  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradingTenant || !selectedPlanId) return;
    setUpgrading(true); setError(""); setSuccess("");
    try {
      await api.post(`/tenant/${upgradingTenant.tenant_id}/change-plan`, { plan_id: selectedPlanId });
      setSuccess(`Plan updated for ${upgradingTenant.tenant_name}.`);
      setUpgradingTenant(null); setSelectedPlanId("");
      await loadData();
    } catch (err: any) { setError(err?.message || "Failed to upgrade plan."); }
    finally { setUpgrading(false); }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setCreateError(""); setSuccess("");
    try {
      await api.post("/tenant/signup", {
        ...createForm,
        allowed_nob_ids: selectedNobIds,
        allowed_lob_ids: selectedLobIds,
      });
      setSuccess(`Tenant account ${createForm.tenant_name} registered successfully!`);
      setShowAddModal(false);
      setCreateForm({
        tenant_code: "", tenant_name: "", tenant_type: "SME",
        plan_id: "PLAN_BASIC", billing_email: "",
        admin_name: "", admin_email: "", admin_password: "",
      });
      await loadData();
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create tenant.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin w-5 h-5 mr-2" style={S.accent} />
        <span className="text-sm" style={S.sub}>{t("admLoadingTenants")}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      <PageHeader
        title={t("admTenantRegistry")}
        description={`${tenants.length} tenants registered on platform`}
        actions={
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={t("admPhSearchTenants")}
              className="w-full rounded-lg border py-2 pl-9 pr-4 text-sm sm:w-60"
              style={S.input} />
          </div>
          <button onClick={() => { setCreateError(""); setShowAddModal(true); }}
            className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--accent)" }}>
            <Plus className="w-4 h-4" />{t("admAddTenant")}</button>
        </div>
        }
      />

      {error   && <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-4 text-sm"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</div>}
      {success && <div className="flex items-center gap-2 text-(--success) bg-(--success-muted) border border-(--success) rounded-lg p-4 text-sm"><CheckCircle className="w-4 h-4 shrink-0" /> {success}</div>}

      <Dialog
        open={Boolean(upgradingTenant)}
        onClose={() => { if (!upgrading) { setUpgradingTenant(null); setSelectedPlanId(""); } }}
        title={t("admChangeSubscriptionPlan")}
        description={upgradingTenant ? `Choose a new plan for ${upgradingTenant.tenant_name}.` : undefined}
        maxWidth="sm"
      >
          <form onSubmit={handleUpgrade} className="space-y-5">
            <label className="block text-xs font-semibold uppercase tracking-wider" style={S.sub}>{t("admNewPlan")}</label>
            <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)}
              className="min-h-11 w-full rounded-lg border px-3 text-sm nf-select" style={S.input}>
              <option value="">— Select new plan —</option>
              {plans.map((p) => (
                <option key={p.plan_id} value={p.plan_id}>{p.plan_name} ({p.billing_cycle})</option>
              ))}
            </select>
            <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end" style={S.border}>
              <button type="submit" disabled={!selectedPlanId || upgrading}
                className="min-h-10 rounded-lg bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                {upgrading ? "Updating…" : "Apply plan change"}
              </button>
            </div>
          </form>
      </Dialog>

      {/* Tenants Table */}
      <div className="rounded-lg border overflow-hidden" style={S.surface}>
        <table className="w-full border-collapse text-sm">
          <TableHeader>
            <tr className="border-b border-(--row-border)">
              {["#", "Tenant Name", "Email", "Plan", "Status", "Actions"].map((h) => (
                <TableHead key={h} className="px-5 whitespace-nowrap">{h}</TableHead>
              ))}
            </tr>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <tr><TableCell colSpan={6} className="px-5 text-center py-10" style={S.muted}>{t("admNoTenantsFound")}</TableCell></tr>
            )}
            {filtered.map((tenant, idx) => {
              const isExpanded = expandedId === tenant.tenant_id;
              const active = tenant.is_active !== false;
              return (
                <React.Fragment key={tenant.tenant_id}>
                  <TableRow style={{ backgroundColor: isExpanded ? "var(--accent-muted)" : undefined }}>
                    <TableCell className="px-5 font-mono" style={S.muted}>{idx + 1}</TableCell>
                    <TableCell className="px-5 font-semibold" style={S.primary}>
                      <div>{tenant.tenant_name}</div>
                      <div className="text-[10px] font-mono mt-0.5" style={S.muted}>{tenant.tenant_code}</div>
                    </TableCell>
                    <TableCell className="px-5" style={S.sub}>{tenant.billing_email || "—"}</TableCell>
                    <TableCell className="px-5">
                      {/* Plan tier is neutral metadata, not a status — colouring it
                          brand-red made every row shout for attention. */}
                      <Badge variant="neutral">{tenant.plan_id?.replace("PLAN_", "") || "—"}</Badge>
                    </TableCell>
                    <TableCell className="px-5">
                      <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded-[var(--radius-xs)] inline-flex items-center gap-1 ${active ? "bg-(--success-muted) text-(--success) border-(--success)" : "bg-(--surface-raised) text-(--text-secondary) border-(--border)"}`}>
                        {active ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="px-5">
                      {/* Peer row actions share one treatment. Giving each its own
                          colour turned a three-item action list into a traffic
                          light and implied a severity difference that isn't real. */}
                      <div className="flex flex-wrap items-center gap-4">
                        <button onClick={() => handleExpand(tenant)}
                          className="flex items-center gap-1 text-xs font-semibold text-(--text-secondary) transition-colors hover:text-(--text-primary) hover:underline">
                          {isExpanded ? <><ChevronUp className="w-3.5 h-3.5" />{t("admHide")}</> : <><ChevronDown className="w-3.5 h-3.5" />{t("companies")}</>}
                        </button>
                        <Link href={`/admin/tenants/${tenant.tenant_id}`}
                          className="flex items-center gap-1 text-xs font-semibold text-(--text-secondary) transition-colors hover:text-(--text-primary) hover:underline">
                          <Eye className="w-3.5 h-3.5" />{t("apDetails")}</Link>
                        {tenant.tenant_id === "00000000-0000-0000-0000-000000000000" || tenant.tenant_code === "system" ? (
                          <span className="flex cursor-not-allowed items-center gap-1 text-xs font-semibold text-(--text-disabled)" title={t("systemPlanCannotBeChanged")}>
                            <ArrowUpRight className="w-3.5 h-3.5" />{t("upgrade")}</span>
                        ) : (
                          <button onClick={() => { setUpgradingTenant(tenant); setSelectedPlanId(""); }}
                            className="flex items-center gap-1 text-xs font-semibold text-(--text-secondary) transition-colors hover:text-(--text-primary) hover:underline">
                            <ArrowUpRight className="w-3.5 h-3.5" />{t("upgrade")}</button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded companies row */}
                  {isExpanded && (
                    <tr key={`${tenant.tenant_id}-detail`}>
                      <TableCell colSpan={6} className="px-8 py-5 border-b" style={{ backgroundColor: "var(--accent-muted)", borderColor: "var(--border)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={S.muted}>
                          Companies under {tenant.tenant_name}
                        </p>
                        {loadingCos ? (
                          <div className="text-xs flex items-center gap-2" style={S.muted}>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />{t("coLoadingCompanies")}</div>
                        ) : expandedCompanies.length === 0 ? (
                          <p className="text-xs" style={S.muted}>{t("admNoCompaniesUnderTenant")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {expandedCompanies.map((co: any) => (
                              <span key={co.company_id}
                                className="text-xs border rounded-lg px-3 py-1.5 font-medium flex items-center gap-1.5"
                                style={{ ...S.surface, ...S.primary }}>
                                <Building className="w-3 h-3 shrink-0" style={S.muted} />
                                {co.company_name}
                                <span className={`text-[10px] font-semibold ${co.onboarding_status === "COMPLETED" ? "text-(--success)" : "text-(--warning)"}`}>
                                  {co.onboarding_status === "COMPLETED" ? "✓" : "⚠"}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                        <Link href={`/admin/tenants/${tenant.tenant_id}`}
                          className="mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                          style={S.accent}>
                          <Eye className="w-3 h-3" />{t("admViewFullTenant")}</Link>
                      </TableCell>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </table>
      </div>

      <Dialog
        open={showAddModal}
        onClose={() => !creating && setShowAddModal(false)}
        title={t("admRegisterTenantTitle")}
        description={t("admRegisterTenantDesc")}
        maxWidth="lg"
      >
            <form onSubmit={handleCreateTenant} className="space-y-6">
              {createError && (
                <div className="flex items-center gap-2 text-(--danger) bg-(--danger-muted) border border-(--danger) rounded-lg p-3 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {createError}
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-(--accent)">1. Tenant & Invoicing Info</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("admLegalTenantName")}>
                    <input required placeholder={t("admPhTenantName")} value={createForm.tenant_name}
                      onChange={e => setCreateForm(f => ({ ...f, tenant_name: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                  <Field label={t("admSubdomainCode")}>
                    <input required placeholder={t("admPhSubdomain")} value={createForm.tenant_code}
                      onChange={e => setCreateForm(f => ({ ...f, tenant_code: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "") }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                  <Field label={t("admBillingEmailRequired")}>
                    <input required type="email" placeholder={t("admPhBillingEmail")} value={createForm.billing_email}
                      onChange={e => setCreateForm(f => ({ ...f, billing_email: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                  <Field label={t("admPricingPlanRequired")}>
                    <select required value={createForm.plan_id}
                      onChange={e => setCreateForm(f => ({ ...f, plan_id: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus) nf-select" style={S.input}>
                      <option value="PLAN_BASIC">{t("admPlanBasic")}</option>
                      <option value="PLAN_PRO">{t("admPlanPro")}</option>
                      <option value="PLAN_ENTERPRISE">{t("admPlanEnterprise")}</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t" style={S.border}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-(--accent)">2. Initial Tenant Admin Account</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("admAdminName")}>
                    <input required placeholder={t("admPhAdminName")} value={createForm.admin_name}
                      onChange={e => setCreateForm(f => ({ ...f, admin_name: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                  <Field label={t("admAdminEmail")}>
                    <input required type="email" placeholder={t("admPhAdminEmail")} value={createForm.admin_email}
                      onChange={e => setCreateForm(f => ({ ...f, admin_email: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                  <Field label={t("admAdminPassword")}>
                    <input required type="password" placeholder={t("ctPhMinEightChars")} value={createForm.admin_password}
                      onChange={e => setCreateForm(f => ({ ...f, admin_password: e.target.value }))}
                      className="w-full border rounded-[var(--radius-sm)] px-3 py-2.5 text-sm focus-visible:border-(--input-border-focus)" style={S.input} />
                  </Field>
                </div>
              </div>

              {/* ── Section 3: NOB / LOB Licensing ── */}
              <div className="space-y-4 pt-4 border-t" style={S.border}>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-(--accent)">3. Permitted Business Sectors (NOB & LOB)</h3>
                    <p className="text-xs mt-0.5" style={S.muted}>{t("admSelectLicensedSectors")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const allNobIds = nobsList.map(n => n.nob_id);
                      const allLobIds = Object.values(lobsByNob).flat().map(l => l.lob_id);
                      if (selectedNobIds.length === allNobIds.length) {
                        setSelectedNobIds([]);
                        setSelectedLobIds([]);
                      } else {
                        setSelectedNobIds(allNobIds);
                        setSelectedLobIds(allLobIds);
                      }
                    }}
                    className="text-xs font-semibold px-2.5 py-1 rounded-[var(--radius-xs)] border hover:opacity-80"
                    style={{ ...S.raised, ...S.accent, borderColor: "var(--accent)" }}
                  >
                    {selectedNobIds.length === nobsList.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {nobsList.length === 0 ? (
                    <p className="text-xs italic" style={S.muted}>{t("admNoNobInCatalog")}</p>
                  ) : (
                    nobsList.map((nob: any) => {
                      const isNobChecked = selectedNobIds.includes(nob.nob_id);
                      const childLobs = lobsByNob[nob.nob_id] || [];

                      const toggleNob = () => {
                        if (isNobChecked) {
                          setSelectedNobIds(prev => prev.filter(id => id !== nob.nob_id));
                          // Deselect child LOBs
                          const childIds = new Set(childLobs.map(l => l.lob_id));
                          setSelectedLobIds(prev => prev.filter(id => !childIds.has(id)));
                        } else {
                          setSelectedNobIds(prev => [...prev, nob.nob_id]);
                          // Select all child LOBs by default
                          const childIds = childLobs.map(l => l.lob_id);
                          setSelectedLobIds(prev => Array.from(new Set([...prev, ...childIds])));
                        }
                      };

                      return (
                        <div
                          key={nob.nob_id}
                          className="rounded-lg border p-3 transition-colors"
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

                          {/* Child LOBs */}
                          {isNobChecked && childLobs.length > 0 && (
                            <div className="mt-2.5 ml-6 pt-2 border-t flex flex-wrap gap-2" style={{ borderColor: "var(--border)" }}>
                              {childLobs.map((lob: any) => {
                                const isLobChecked = selectedLobIds.includes(lob.lob_id);
                                const toggleLob = () => {
                                  if (isLobChecked) {
                                    setSelectedLobIds(prev => prev.filter(id => id !== lob.lob_id));
                                  } else {
                                    setSelectedLobIds(prev => [...prev, lob.lob_id]);
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
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end" style={S.border}>
                <button type="submit" disabled={creating}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
                  {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {creating ? "Provisioning..." : "Provision Tenant"}
                </button>
              </div>
            </form>
      </Dialog>
    </div>
  );
}

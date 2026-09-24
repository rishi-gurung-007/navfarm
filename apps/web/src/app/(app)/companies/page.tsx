"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, RefreshCw, CheckCircle,
  Settings, Activity, Plus,
} from "lucide-react";
import { api } from "@/services/api-client";
import { updateStoredUser, getActiveCompanyId, getActiveWorkspaceScope, setActiveCompanyId } from "@/hooks/useAuth";
import { useCompaniesPageData } from "@/components/console/companies/use-companies-page-data";
import { useLanguage } from "@/hooks/useLanguage";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";

const S = {
  surface:  { backgroundColor: "var(--surface)",        borderColor: "var(--border)" },
  primary:  { color: "var(--text-primary)" },
  sub:      { color: "var(--text-secondary)" },
  muted:    { color: "var(--text-muted)" },
  border:   { borderColor: "var(--border)" },
};

function StatusBadge({ status, t }: { status: string; t: (key: any) => string }) {
  const ok = status === "COMPLETED";
  return (
    <Badge variant={ok ? "success" : "warning"}>
      {ok ? <CheckCircle className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
      {ok ? t("coStatusComplete") : t("coStatusPending")}
    </Badge>
  );
}

export default function CompaniesIndexPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, tenantId, companies, loading, error, reload } = useCompaniesPageData();

  const [showAddModal, setShowAddModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState({
    company_code: "", company_name: "", company_display_name: "",
    company_type: "Pvt Ltd", industry_type: "Poultry Farming",
    country_id: "IND", default_timezone_id: "Asia/Kolkata",
    registration_no: "", tax_id: "",
  });

  // Who gets the tenant-wide directory: a tenant admin who is actually working
  // at tenant scope. Branching on userType alone ignored the scope switcher, so
  // a tenant admin who had deliberately narrowed to one company still saw every
  // company in the tenant and an "Add Company" button, directly contradicting
  // the scope shown in the sidebar.
  const showsDirectory = user?.userType === "TENANT_ADMIN" && getActiveWorkspaceScope() === "TENANT";

  // Everyone else — including a tenant admin scoped into a single company —
  // lands straight on that company's own settings route.
  useEffect(() => {
    if (loading || !user || showsDirectory) return;
    const activeId = getActiveCompanyId() || user.companyId || (user as any).company_id;
    const myCompany = companies.find((c: any) => c.company_id === activeId) || companies[0];
    if (myCompany) router.replace(`/companies/${myCompany.company_id}`);
  }, [loading, user, companies, router]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setCreating(true); setCreateError("");
    try {
      await api.post("/company", { ...createForm });
      setShowAddModal(false);
      setCreateForm({ company_code: "", company_name: "", company_display_name: "",
        company_type: "Pvt Ltd", industry_type: "Poultry Farming",
        country_id: "IND", default_timezone_id: "Asia/Kolkata",
        registration_no: "", tax_id: "" });
      reload();
    } catch (err: any) { setCreateError(err?.message || t("coCreateFailedDefault")); }
    finally { setCreating(false); }
  };

  if (loading) return <LoadingState label={t("coLoadingCompanies")} />;

  // ── Tenant-wide directory (Tenant Admin, at tenant scope) ──
  if (showsDirectory) {
    return (
      <ConsolePage>
        <PageHeader
          title={t("coTitle")}
          description={t("coDirectoryDesc", { n: companies.length })}
          actions={
            <Button onClick={() => { setCreateError(""); setShowAddModal(true); }}>
              <Plus className="w-4 h-4" /> {t("coAddCompany")}
            </Button>
          }
        />

        <Dialog
          open={showAddModal}
          onClose={() => setShowAddModal(false)}
          title={t("coAddCompanyDrawerTitle")}
          description={t("coAddCompanyDrawerDesc")}
          footer={
            <Button type="submit" form="create-company-form" disabled={creating}>
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creating ? t("coCreatingCompany") : t("coCreateCompany")}
            </Button>
          }
        >
          <form id="create-company-form" onSubmit={handleCreateCompany} className="space-y-5">
            {createError && <ErrorState message={createError} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldCompanyCode")}</label>
                <Input required placeholder={t("coPhCompanyCode")} value={createForm.company_code}
                  onChange={e => setCreateForm(f => ({ ...f, company_code: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldLegalName")}</label>
                <Input required placeholder={t("coPhLegalName")} value={createForm.company_name}
                  onChange={e => setCreateForm(f => ({ ...f, company_name: e.target.value }))} />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldDisplayName")}</label>
                <Input placeholder={t("coPhDisplayName")} value={createForm.company_display_name}
                  onChange={e => setCreateForm(f => ({ ...f, company_display_name: e.target.value }))} />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldClassification")}</label>
                <Select required value={createForm.company_type}
                  onChange={e => setCreateForm(f => ({ ...f, company_type: e.target.value }))}>
                  {["Pvt Ltd","Ltd","LLP","Partnership","Proprietorship","Trust","NGO"].map(ty => (
                    <option key={ty} value={ty}>{ty}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldIndustry")}</label>
                <Select required value={createForm.industry_type}
                  onChange={e => setCreateForm(f => ({ ...f, industry_type: e.target.value }))}>
                  {[
                    { v: "Poultry Farming", k: "coIndustryPoultryFarming" },
                    { v: "Aquaculture", k: "coIndustryAquaculture" },
                    { v: "Dairy", k: "coIndustryDairy" },
                    { v: "Crop Farming", k: "coIndustryCropFarming" },
                    { v: "Agro Processing", k: "coIndustryAgroProcessing" },
                    { v: "Livestock", k: "coIndustryLivestock" },
                    { v: "Other", k: "coIndustryOther" },
                  ].map(({ v, k }) => (
                    <option key={v} value={v}>{t(k as any)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldRegistrationNo")}</label>
                <Input placeholder={t("coPhRegistrationNo")} value={createForm.registration_no}
                  onChange={e => setCreateForm(f => ({ ...f, registration_no: e.target.value }))} />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldTaxId")}</label>
                <Input placeholder={t("coPhTaxId")} value={createForm.tax_id}
                  onChange={e => setCreateForm(f => ({ ...f, tax_id: e.target.value }))} />
              </div>
              <div>
                <label className="nf-text-label mb-1 block" style={S.sub}>{t("coFieldCountry")}</label>
                <Select required value={createForm.country_id}
                  onChange={e => setCreateForm(f => ({ ...f, country_id: e.target.value }))}>
                  <option value="IND">{t("coCountryIndia")}</option>
                  <option value="USA">{t("coCountryUSA")}</option>
                  <option value="GBR">{t("coCountryUK")}</option>
                  <option value="ARE">{t("coCountryUAE")}</option>
                  <option value="SGP">{t("coCountrySingapore")}</option>
                </Select>
              </div>
            </div>
          </form>
        </Dialog>

        {error && <ErrorState message={error} />}

        <div className="rounded-[var(--radius-md)] border overflow-hidden" style={S.surface}>
          <table className="w-full border-collapse text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                {["#", t("coColCompany"), t("coColRegNo"), t("country"), t("onboardingLabel"), t("actionsColumn")].map((h) => (
                  <TableHead key={h} className="px-5 whitespace-nowrap">{h}</TableHead>
                ))}
              </tr>
            </TableHeader>
            <TableBody>
              {companies.length === 0 && (
                <tr><TableCell colSpan={6} className="px-5 text-center py-12" style={S.muted}>{t("coNoCompanies")}</TableCell></tr>
              )}
              {companies.map((co, idx) => (
                <TableRow key={co.company_id}>
                  <TableCell className="px-5 py-4 font-mono" style={S.muted}>{idx + 1}</TableCell>
                  <TableCell className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-[var(--radius-xs)] flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                        style={{ backgroundColor: "var(--color-navy)" }}>
                        {co.company_code?.substring(0, 2) || "CO"}
                      </div>
                      <div>
                        <div className="font-semibold" style={S.primary}>{co.company_name}</div>
                        <div className="text-[11px] font-mono" style={S.muted}>{co.company_code}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-4 font-mono" style={S.sub}>{co.registration_no || "—"}</TableCell>
                  <TableCell className="px-5 py-4" style={S.sub}>{co.country_id || "—"}</TableCell>
                  <TableCell className="px-5 py-4"><StatusBadge status={co.onboarding_status} t={t} /></TableCell>
                  <TableCell className="px-5 py-4">
                    {co.onboarding_status === "COMPLETED" ? (
                      <Button onClick={() => router.push(`/companies/${co.company_id}`)} variant="outline" size="sm">
                        <Settings className="w-3.5 h-3.5" />
                        {t("manage")}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          updateStoredUser({ companyId: co.company_id, company_id: co.company_id });
                          setActiveCompanyId(co.company_id);
                          router.push(`/companies/${co.company_id}`);
                        }}
                        variant="secondary"
                        size="sm"
                      >
                        <Activity className="w-3.5 h-3.5" style={{ color: "var(--warning)" }} />
                        {t("coContinueSetup")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </ConsolePage>
    );
  }

  // ── Fallback for a non-admin user without an assigned company ──
  if (!companies.length) {
    return (
      <ConsolePage>
        <PageHeader title={t("coSettingsTitle")} sticky={false} />
        <div className="rounded-[var(--radius-md)] border p-12 text-center" style={S.surface}>
          <Building2 className="w-10 h-10 mx-auto mb-3" style={S.muted} />
          <p className="text-sm font-semibold" style={S.sub}>{t("coNoCompanyAssigned")}</p>
          <p className="text-xs mt-1" style={S.muted}>{t("coContactTenantAdmin")}</p>
        </div>
      </ConsolePage>
    );
  }

  // Redirecting to /companies/[companyId]
  return null;
}

import React, { useState, useEffect } from "react";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Save,
  AlertCircle,
  CheckCircle,
  Building2,
  Plus,
  ArrowLeft,
  Check,
  Upload,
  Image as ImageIcon
} from "lucide-react";
import { api } from "../../../services/api-client";
import { Dialog } from "../../ui/dialog";
import { useLanguage } from "@/hooks/useLanguage";
import { API_ORIGIN } from "@/lib/api-client";

interface CompanyTabProps {
  activeCompany: any;
  currencies: any[];
  tenantId?: string;
  onRefreshCompany?: (selectCompanyId?: string) => Promise<void>;
  companies?: any[];
  currentUser?: any;
  onSelectCompany?: (company: any) => void;
  /** When true, skip the Corporate Directory list and go straight to company settings */
  skipDirectory?: boolean;
}

/**
 * The six settings sections. These were labelled "Step 1", "Step 2",
 * "Steps 4-6", "Step 7", "Step 8" — onboarding-wizard wording that survived
 * into a settings page, where nobody is walking a sequence. You come here to
 * change the fiscal year, not to complete step seven of eight.
 */
export const SETTINGS_SECTIONS = [
  { key: "profile", labelKey: "ctSecProfile", descKey: "ctSecProfileDesc" },
  { key: "address", labelKey: "ctSecAddress", descKey: "ctSecAddressDesc" },
  { key: "contact", labelKey: "ctSecContact", descKey: "ctSecContactDesc" },
  { key: "localization", labelKey: "ctSecLocale", descKey: "ctSecLocaleDesc" },
  { key: "fiscal", labelKey: "ctSecFiscal", descKey: "ctSecFiscalDesc" },
  { key: "modules", labelKey: "ctSecSectors", descKey: "ctSecSectorsDesc" },
] as const;

export default function CompanyTab({
  activeCompany,
  currencies,
  tenantId,
  onRefreshCompany,
  companies = [],
  currentUser,
  onSelectCompany,
  skipDirectory = false,
  section,
}: CompanyTabProps & { section?: string }) {
  const { t } = useLanguage();
  const isTenantAdmin = currentUser?.userType === "TENANT_ADMIN";
  const isCompanyAdmin = currentUser?.userType === "COMPANY_ADMIN";
  const canEditCompany = isTenantAdmin || isCompanyAdmin;

  // Navigation context
  const [selectedCompanyDetails, setSelectedCompanyDetails] = useState<any>(null);


  // 8 steps detailed setup configuration context
  const [setupDetails, setSetupDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [setupLoadWarning, setSetupLoadWarning] = useState("");
  // The active section is the page's to own: it drives the shell sub-sidebar
  // and the URL, so it cannot live in local state here. Falls back to internal
  // state only when no owner is passed.
  const [ownTab] = useState<"profile" | "address" | "contact" | "localization" | "fiscal" | "modules">("profile");
  const settingsTab = (section as typeof ownTab) || ownTab;

  // Support catalogs fetched on mount
  const [languages, setLanguages] = useState<any[]>([]);
  const [nobs, setNobs] = useState<any[]>([]);

  // Mapping of NOB ID to its LOBs list for Step 8 editing
  const [lobMap, setLobMap] = useState<Record<string, any[]>>({});
  const [loadingLobs, setLoadingLobs] = useState<Record<string, boolean>>({});

  // Edit settings context for the active tab
  // Only a tenant or company admin may edit. This check used to live on the
  // "Edit Configuration" button; with that button gone it has to gate the
  // fields themselves, or removing the wizard would have handed edit rights to
  // everyone who can view the page.
  // Settings are editable. This was a wizard you opened, reviewed and closed,
  // so every section had a read-only twin behind an "Edit Configuration"
  // button; a settings page shows the fields and a Save, like every other form
  // in the console. Kept as a constant so the per-section read-only branches
  // fall away without rewriting six sections at once.
  const isEditing = canEditCompany;
  const [saving, setSaving] = useState(false);

  // Logo upload state
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Form states matching wizard steps
  const [profileForm, setProfileForm] = useState({
    company_code: "",
    company_name: "",
    company_display_name: "",
    company_type: "Pvt Ltd",
    industry_type: "Poultry Farming",
    registration_no: "",
    tax_id: "",
    tax_regime: "STANDARD",
    incorporation_date: "",
    website: "",
    email_domain: "",
    support_email: "",
    phone_primary: "",
    company_logo_url: "",
    primary_color_hex: "#1F4E79"
  });

  const [addressForm, setAddressForm] = useState({
    address_type: "HQ",
    address_label: "",
    line1: "",
    line2: "",
    city: "",
    state_id: "",
    country_id: "IND",
    pincode: "",
    gps_latitude: "",
    gps_longitude: ""
  });

  const [contactForm, setContactForm] = useState({
    contact_type: "Primary",
    full_name: "",
    designation: "Director",
    email: "",
    phone_primary: "",
    phone_secondary: "",
    receives_alerts: false,
    receives_reports: false
  });

  const [localizationForm, setLocalizationForm] = useState({
    default_language_id: "",
    base_currency_id: "",
    default_timezone_id: "Asia/Kolkata",
    country_id: "IND"
  });

  const [fiscalForm, setFiscalForm] = useState({
    fiscal_start_month: 4,
    fiscal_start_day: 1,
    fiscal_end_day: 31,
    current_fiscal_year: "2026-27",
    period_type: "MONTHLY",
    accounting_standard: "Local GAAP",
    depreciation_method: "SLM",
    inventory_valuation: "FIFO",
    gst_filing_frequency: "MONTHLY",
    tax_audit_applicable: false,
    decimal_places: 2
  });


  const [modulesForm, setModulesForm] = useState<string[]>([]);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create company modal (Tenant Admin only)
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    company_code: "",
    company_name: "",
    company_display_name: "",
    company_type: "Pvt Ltd",
    industry_type: "Poultry Farming",
    country_id: "IND",
    default_timezone_id: "Asia/Kolkata",
    registration_no: "",
    tax_id: "",
    primary_color_hex: "#1F4E79"
  });
  const [creating, setCreating] = useState(false);

  // Determine active company details context
  const targetCompany = isTenantAdmin ? (selectedCompanyDetails || activeCompany) : activeCompany;

  // Load catalogs on mount — fetch independently so one failure doesn't block the other
  useEffect(() => {
    const fetchCatalogs = async () => {
      // Languages live at /language (GET), not /setup/wizard/languages
      const [langsResult, nobsResult] = await Promise.allSettled([
        api.get("/language"),
        api.get("/setup/wizard/nobs"),
      ]);
      if (langsResult.status === "fulfilled") setLanguages(langsResult.value || []);
      if (nobsResult.status  === "fulfilled") setNobs(nobsResult.value  || []);
    };
    fetchCatalogs();
  }, []);



  const fetchSetupDetails = async (companyId: string) => {
    setLoadingDetails(true);
    setSetupLoadWarning("");
    setSetupDetails(null);
    try {
      const details = await api.get(`/setup/wizard/company-details/${companyId}`);
      setSetupDetails(details);
    } catch {
      setSetupLoadWarning("Some setup details are temporarily unavailable. Available information is still shown.");
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (targetCompany?.company_id) {
      fetchSetupDetails(targetCompany.company_id);
    }
  }, [targetCompany?.company_id]);

  // Sync details response or targetCompany to states
  useEffect(() => {
    const comp = setupDetails?.company || targetCompany;
    if (comp) {
      setProfileForm({
        company_code: comp.company_code || "",
        company_name: comp.company_name || "",
        company_display_name: comp.company_display_name || "",
        company_type: comp.company_type || "Pvt Ltd",
        industry_type: comp.industry_type || "Poultry Farming",
        registration_no: comp.registration_no || "",
        tax_id: comp.tax_id || "",
        tax_regime: comp.tax_regime || "STANDARD",
        incorporation_date: comp.incorporation_date || "",
        website: comp.website || "",
        email_domain: comp.email_domain || "",
        support_email: comp.support_email || "",
        phone_primary: comp.phone_primary || "",
        company_logo_url: comp.company_logo_url || "",
        primary_color_hex: comp.primary_color_hex || "#1F4E79"
      });

      setAddressForm({
        address_type: setupDetails?.address?.address_type || "HQ",
        address_label: setupDetails?.address?.address_label || "",
        line1: setupDetails?.address?.line1 || "",
        line2: setupDetails?.address?.line2 || "",
        city: setupDetails?.address?.city || "",
        state_id: setupDetails?.address?.state_id || "",
        country_id: setupDetails?.address?.country_id || comp.country_id || "IND",
        pincode: setupDetails?.address?.pincode || "",
        gps_latitude: setupDetails?.address?.gps_latitude || "",
        gps_longitude: setupDetails?.address?.gps_longitude || ""
      });

      setContactForm({
        contact_type: setupDetails?.contact?.contact_type || "Primary",
        full_name: setupDetails?.contact?.full_name || "",
        designation: setupDetails?.contact?.designation || "Director",
        email: setupDetails?.contact?.email || comp.support_email || "",
        phone_primary: setupDetails?.contact?.phone_primary || comp.phone_primary || "",
        phone_secondary: setupDetails?.contact?.phone_secondary || "",
        receives_alerts: setupDetails?.contact?.receives_alerts || false,
        receives_reports: setupDetails?.contact?.receives_reports || false
      });

      setLocalizationForm({
        default_language_id: comp.default_language_id || "",
        base_currency_id: comp.base_currency_id || "",
        default_timezone_id: comp.default_timezone_id || "Asia/Kolkata",
        country_id: comp.country_id || "IND"
      });

      setFiscalForm({
        fiscal_start_month: setupDetails?.fiscal?.fiscal_start_month || comp.financial_year_start || 4,
        fiscal_start_day: setupDetails?.fiscal?.fiscal_start_day || 1,
        fiscal_end_day: setupDetails?.fiscal?.fiscal_end_day || 31,
        current_fiscal_year: setupDetails?.fiscal?.current_fiscal_year || "2026-27",
        period_type: setupDetails?.fiscal?.period_type || "MONTHLY",
        accounting_standard: setupDetails?.fiscal?.accounting_standard || "Local GAAP",
        depreciation_method: setupDetails?.fiscal?.depreciation_method || "SLM",
        inventory_valuation: setupDetails?.fiscal?.inventory_valuation || "FIFO",
        gst_filing_frequency: setupDetails?.fiscal?.gst_filing_frequency || "MONTHLY",
        tax_audit_applicable: setupDetails?.fiscal?.tax_audit_applicable || false,
        decimal_places: setupDetails?.fiscal?.decimal_places ?? 2
      });

      if (setupDetails?.modules) {
        setModulesForm(setupDetails.modules);
      }
    }
  }, [setupDetails, targetCompany]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {

    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    setError("");

    try {
      const data = new FormData();
      data.append("file", file);

      const res = await api.upload("/setup/wizard/upload-logo", data);
      setProfileForm(prev => ({ ...prev, company_logo_url: res.logoUrl }));
    } catch (err: any) {
      setError(err?.message || "Failed to upload logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const backendUrl = API_ORIGIN;

  // Fetch LOBs list for selected NOBs in modulesForm editing

  useEffect(() => {
    if (settingsTab === "modules" && nobs.length > 0) {
      nobs.forEach(nob => {
        if (modulesForm.includes(nob.nob_code)) {
          fetchLobsForNob(nob.nob_id, nob.nob_code);
        }
      });
    }
  }, [modulesForm, settingsTab, nobs]);

  const fetchLobsForNob = async (nobId: string, nobCode: string) => {
    if (lobMap[nobId]) return;
    setLoadingLobs(prev => ({ ...prev, [nobId]: true }));
    try {
      const list = await api.get(`/setup/wizard/lobs/${nobId}`);
      setLobMap(prev => ({ ...prev, [nobId]: list || [] }));
    } catch (e) {
      console.error(`Failed to fetch LOBs for ${nobCode}:`, e);
    } finally {
      setLoadingLobs(prev => ({ ...prev, [nobId]: false }));
    }
  };

  const handleNobToggle = (nobCode: string, nobId: string) => {
    const isChecked = modulesForm.includes(nobCode);
    if (isChecked) {
      const associatedLobs = lobMap[nobId] || [];
      const associatedCodes = associatedLobs.map(l => l.lob_code);
      setModulesForm(modulesForm.filter(code => code !== nobCode && !associatedCodes.includes(code)));
    } else {
      setModulesForm([...modulesForm, nobCode]);
    }
  };

  const handleLobToggle = (lobCode: string) => {
    const isChecked = modulesForm.includes(lobCode);
    if (isChecked) {
      setModulesForm(modulesForm.filter(code => code !== lobCode));
    } else {
      setModulesForm([...modulesForm, lobCode]);
    }
  };

  // Submit handlings for all steps
  const handleSaveTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) {
      setError("Tenant context is missing.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (settingsTab === "profile") {
        await api.post("/setup/wizard/step-1", {
          ...profileForm,
          tenant_id: tenantId,
          company_id: targetCompany.company_id
        });
      } else if (settingsTab === "address") {
        await api.post("/setup/wizard/step-2", {
          ...addressForm,
          company_id: targetCompany.company_id,
          gps_latitude: addressForm.gps_latitude ? parseFloat(addressForm.gps_latitude) : undefined,
          gps_longitude: addressForm.gps_longitude ? parseFloat(addressForm.gps_longitude) : undefined,
        });
      } else if (settingsTab === "contact") {
        await api.post("/setup/wizard/step-3", {
          ...contactForm,
          company_id: targetCompany.company_id
        });
      } else if (settingsTab === "localization") {
        const { default_language_id, base_currency_id, default_timezone_id, country_id } = localizationForm;
        await Promise.all([
          api.post(`/setup/wizard/step-4/${targetCompany.company_id}/${default_language_id}`),
          api.post(`/setup/wizard/step-5/${targetCompany.company_id}/${base_currency_id}`),
          api.post(`/setup/wizard/step-6/${targetCompany.company_id}/${encodeURIComponent(default_timezone_id)}/${country_id.toUpperCase()}`)
        ]);
      } else if (settingsTab === "fiscal") {
        const isAprilStart = parseInt(fiscalForm.fiscal_start_month as any) === 4;
        await api.post("/setup/wizard/step-7", {
          ...fiscalForm,
          company_id: targetCompany.company_id,
          fiscal_year_format: isAprilStart ? "FY APR-MAR" : "FY JAN-DEC",
          fiscal_start_day: 1
        });
      }

      setSuccess(`Company settings step updated successfully!`);
      await fetchSetupDetails(targetCompany.company_id);
      if (onRefreshCompany) {
        await onRefreshCompany(targetCompany.company_id);
      }
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err?.message || "Failed to update step parameter.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModules = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.post(`/setup/wizard/step-8/${targetCompany.company_id}`, {
        modules: modulesForm
      });
      setSuccess("Nature of Business and sub-sectors modules list saved!");
      await fetchSetupDetails(targetCompany.company_id);
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err?.message || "Failed to update modules configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) {
      setError("Tenant ID not found.");
      return;
    }
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const payload: any = {
        ...createForm,
        default_language_id: undefined
      };

      const firstCurrencyId = currencies && currencies.length > 0 ? currencies[0]?.currency_id : null;
      if (firstCurrencyId && typeof firstCurrencyId === 'string' && firstCurrencyId.length === 36) {
        payload.base_currency_id = firstCurrencyId;
      }

      const createdCompany = await api.post("/company", payload);
      setSuccess(`Company '${createForm.company_name}' created successfully!`);
      setShowCreateModal(false);
      setCreateForm({
        company_code: "",
        company_name: "",
        company_display_name: "",
        company_type: "Pvt Ltd",
        industry_type: "Poultry Farming",
        country_id: "IND",
        default_timezone_id: "Asia/Kolkata",
        registration_no: "",
        tax_id: "",
        primary_color_hex: "#1F4E79"
      });

      if (onRefreshCompany && createdCompany?.company_id) {
        await onRefreshCompany(createdCompany.company_id);
      } else if (onRefreshCompany) {
        await onRefreshCompany();
      }
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err?.message || "Failed to create company.");
    } finally {
      setCreating(false);
    }
  };

  // Render List View (Tenant Admin only when selectedCompanyDetails is null)
  if (isTenantAdmin && !selectedCompanyDetails && !skipDirectory) {
    return (
      <div className="flex w-full flex-col gap-4 animate-fade-in">

        {/* Feedback stays in the content flow so it never obscures actions. */}
        {error && (
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-4 py-3 border-(--danger) bg-(--danger-muted) text-(--danger)">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-4 py-3 border-(--success) bg-(--success-muted) text-(--success)">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">{success}</span>
          </div>
        )}

        <div className="flex justify-between items-center bg-(--surface) border border-(--border) p-5 rounded-[var(--radius-md)]">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-(--text-primary) text-base">{t("ctDirectoryTitle")}</h3>
            <p className="text-xs text-(--text-secondary)">{t("ctDirectoryDesc")}</p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 py-2.5 px-4 text-xs cursor-pointer hover:scale-[1.02]"
          >
            <Plus className="w-4 h-4" />{t("ctAddCompany")}</Button>
        </div>

        <Card className="p-0 border-(--border) bg-(--surface) overflow-hidden">
          <div className="overflow-x-auto w-full">
            <table className="w-full border-collapse text-left">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="text-center w-12">#</TableHead>
                  <TableHead className="w-28">{t("paramColCode")}</TableHead>
                  <TableHead>{t("companyName")}</TableHead>
                  <TableHead className="w-44">{t("ctIndustry")}</TableHead>
                  <TableHead className="w-48">{t("ctIdentifiers")}</TableHead>
                  <TableHead className="text-center w-28">{t("btColStatus")}</TableHead>
                  <TableHead className="text-right w-36">{t("actionsColumn")}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {companies.length === 0 ? (
                  <tr>
                    <TableCell colSpan={7} className="p-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("ctNoCompanies")}</TableCell>
                  </tr>
                ) : (
                  companies.map((comp, idx) => (
                    <TableRow key={comp.company_id}>
                      <TableCell className="p-4 text-center font-mono" style={{ color: "var(--text-secondary)" }}>{idx + 1}</TableCell>
                      <TableCell className="p-4">
                        <span className="font-mono text-(--text-primary) bg-(--surface-raised) px-2 py-1 rounded-[var(--radius-xs)] border border-(--border) font-semibold">{comp.company_code}</span>
                      </TableCell>
                      <TableCell className="p-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-(--text-primary)">{comp.company_name}</span>
                          <span className="text-[10px] text-(--text-secondary)">{comp.company_display_name || comp.company_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="p-4" style={{ color: "var(--text-secondary)" }}>{comp.industry_type}</TableCell>
                      <TableCell className="p-4">
                        <div className="flex flex-col text-[10px] text-(--text-secondary) font-mono gap-0.5">
                          <span>Tax: {comp.tax_id || "—"}</span>
                          <span>Reg: {comp.registration_no || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold ${
                          comp.onboarding_status === 'COMPLETED' ? 'bg-(--success-muted) text-(--success) border border-(--success)' : 'bg-(--warning-muted) text-(--warning) border border-(--warning)'
                        }`}>
                          {comp.onboarding_status || 'PENDING'}
                        </span>
                      </TableCell>
                      <TableCell className="p-4 text-right">
                        <Button
                          onClick={() => {
                            setSelectedCompanyDetails(comp);
                            if (onSelectCompany) onSelectCompany(comp);
                          }}
                          // w-full preserves the width this button had while the
                          // legacy primitive was display:flex — it is the one
                          // call site that sat in block flow rather than a flex row.
                          className="w-full py-1.5 px-3 text-[10px] uppercase font-semibold tracking-wider hover:scale-[1.02] cursor-pointer"
                        >{t("ctManageProfile")}</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
        </Card>

        <Dialog
          open={showCreateModal}
          onClose={() => !creating && setShowCreateModal(false)}
          title={t("ctRegisterCompanyTitle")}
          description={t("ctRegisterCompanyDesc")}
          maxWidth="lg"
          className="nf-company-config"
        >
            <form onSubmit={handleCreateCompany} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("ctCompanyCode")} htmlFor="create-company-code" required>
                  <Input
                    id="create-company-code"
                    value={createForm.company_code}
                    onChange={(e) => setCreateForm({ ...createForm, company_code: e.target.value })}
                    required
                  />
                </Field>
                <Field label={t("ctLegalEntityName")} htmlFor="create-company-name" required>
                  <Input
                    id="create-company-name"
                    placeholder={t("ctPhCompanyPvtLtd")}
                    value={createForm.company_name}
                    onChange={(e) => setCreateForm({ ...createForm, company_name: e.target.value })}
                    required
                  />
                </Field>
                <Field label={t("coFieldDisplayName")} htmlFor="create-company-display-name">
                  <Input
                    id="create-company-display-name"
                    placeholder={t("ctPhBrandName")}
                    value={createForm.company_display_name}
                    onChange={(e) => setCreateForm({ ...createForm, company_display_name: e.target.value })}
                  />
                </Field>
                <Field label={t("ctClassification")} htmlFor="cfg-ct-classification">
                  <Select
                    id="cfg-ct-classification"
                    value={createForm.company_type}
                    onChange={(e) => setCreateForm({ ...createForm, company_type: e.target.value })}
                  >
                    <option value="Pvt Ltd">{t("ctClsPvtLtd")}</option>
                    <option value="Sole Proprietor">{t("ctClsSoleProprietor")}</option>
                    <option value="Partnership">{t("ctClsPartnership")}</option>
                    <option value="LLP">LLP</option>
                    <option value="Trust">{t("ctClsTrust")}</option>
                    <option value="Co-operative">{t("ctClsCooperative")}</option>
                  </Select>
                </Field>
                <Field label={t("ctPrimaryIndustry")} htmlFor="create-industry-type" required>
                  <Input
                    id="create-industry-type"
                    placeholder={t("coIndustryPoultryFarming")}
                    value={createForm.industry_type}
                    onChange={(e) => setCreateForm({ ...createForm, industry_type: e.target.value })}
                    required
                  />
                </Field>
                <Field label={t("ctOperatingCountry")} htmlFor="create-country-id" hint={t("ctHintCountryIso")}>
                  <Input
                    id="create-country-id"
                    value={createForm.country_id}
                    onChange={(e) => setCreateForm({ ...createForm, country_id: e.target.value })}
                  />
                </Field>
                <Field label={t("ctTimezone")} htmlFor="create-timezone" hint={t("ctHintTimezoneIana")}>
                  <Input
                    id="create-timezone"
                    value={createForm.default_timezone_id}
                    onChange={(e) => setCreateForm({ ...createForm, default_timezone_id: e.target.value })}
                  />
                </Field>
                <Field label={t("ctTaxRegIdShort")} htmlFor="create-tax-id">
                  <Input
                    id="create-tax-id"
                    value={createForm.tax_id}
                    onChange={(e) => setCreateForm({ ...createForm, tax_id: e.target.value })}
                  />
                </Field>
                <Field label={t("ctCorpRegNoShort")} htmlFor="create-registration-no">
                  <Input
                    id="create-registration-no"
                    value={createForm.registration_no}
                    onChange={(e) => setCreateForm({ ...createForm, registration_no: e.target.value })}
                  />
                </Field>
                <Field label={t("ctBrandHexColor")}>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={createForm.primary_color_hex}
                      onChange={(e) => setCreateForm({ ...createForm, primary_color_hex: e.target.value })}
                      className="w-12 h-12 rounded-[var(--radius-sm)] bg-transparent border-0 cursor-pointer"
                    />
                    <Input
                      value={createForm.primary_color_hex}
                      onChange={(e) => setCreateForm({ ...createForm, primary_color_hex: e.target.value })}
                      className="flex-1"
                      placeholder="#1F4E79"
                    />
                  </div>
                </Field>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-(--border) pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={creating} onClick={() => setShowCreateModal(false)} className="min-h-10 px-4 text-sm cursor-pointer">{t("cancel")}</Button>
                <Button type="submit" disabled={creating} className="min-h-10 px-5 text-sm cursor-pointer">
                  {creating ? "Creating..." : "Create Company"}
                </Button>
              </div>
            </form>
        </Dialog>

      </div>
    );
  }

  // Render Details View (Tenant Admin managing details, or Company Admin viewing their own details)
  const currentLogoUrl = setupDetails?.company?.company_logo_url || targetCompany?.company_logo_url || "";

  return (
    <div className="flex w-full flex-col gap-4 animate-fade-in">

      {/* Feedback stays in the content flow so it never covers card actions. */}
      {error && (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-4 py-3 border-(--danger) bg-(--danger-muted) text-(--danger)">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-4 py-3 border-(--success) bg-(--success-muted) text-(--success)">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* Header back button for Tenant Admin */}
      {isTenantAdmin && !skipDirectory && (
        <button
          onClick={() => setSelectedCompanyDetails(null)}
          className="flex items-center gap-2 text-xs text-(--text-secondary) hover:text-(--text-primary) cursor-pointer w-fit font-semibold bg-(--surface-raised) py-2 px-4 rounded-[var(--radius-sm)] border border-(--border) transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />{t("ctBackToDirectory")}</button>
      )}

      {/* No card. The section title and its one explanatory line moved to the
          page header, and what was left was a border drawn around the only
          thing on the page — the form sits on the page itself now, the way a
          settings screen normally reads. */}
      <div className="company-settings-container nf-company-config flex flex-col gap-5">

            {setupLoadWarning && (
              <div className="flex items-start gap-2 rounded-lg border border-(--warning) bg-(--warning-muted) px-3 py-2.5 text-xs leading-5 text-(--warning)">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{setupLoadWarning}</span>
              </div>
            )}

            {!targetCompany ? (
              <div className="text-center p-8 text-(--text-secondary)">
                <Building2 className="w-12 h-12 mx-auto mb-3 opacity-30 text-(--accent)" />
                <p className="text-xs">{t("ctNoActiveProfile")}</p>
              </div>
            ) : loadingDetails ? (
              <div className="text-xs text-(--text-secondary) text-center py-12 animate-pulse">{t("ctLoadingSteps")}</div>
            ) : (
              <div className="min-w-0">

                  {/* profile TAB */}
                  {settingsTab === "profile" && (
                    !isEditing ? (
                      <div className="flex flex-col gap-6">
                        {/* Logo and website only. The company's name, code and
                            type were repeated here from the identity strip
                            directly above this card — the same three facts
                            twice on one screen, a hand-width apart. */}
                        <div className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-4">
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-(--border) bg-(--input-bg)">
                            {currentLogoUrl ? (
                              <img
                                src={currentLogoUrl.startsWith('/') ? `${backendUrl}${currentLogoUrl}` : currentLogoUrl}
                                alt={t("ctCompanyLogoAlt")}
                                className="h-full w-full object-contain p-1"
                              />
                            ) : (
                              <ImageIcon className="h-8 w-8 text-(--text-muted)" />
                            )}
                          </div>
                          <ReadField
                            label={t("ctOfficialWebsite")}
                            value={setupDetails?.company?.website ? (
                              <a href={setupDetails.company.website} target="_blank" rel="noreferrer" className="text-(--accent) hover:underline">
                                {setupDetails.company.website}
                              </a>
                            ) : ""}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
                          <ReadField mono label={t("ctCompanyCode")} value={setupDetails?.company?.company_code || targetCompany?.company_code} />
                          <ReadField label={t("ctLegalEntityName")} value={setupDetails?.company?.company_name || targetCompany?.company_name} />
                          <ReadField label={t("coFieldDisplayName")} value={setupDetails?.company?.company_display_name || targetCompany?.company_display_name} />
                          <ReadField label={t("ctBusinessClassification")} value={setupDetails?.company?.company_type || targetCompany?.company_type} />
                          <ReadField label={t("ctPrimaryIndustry")} value={setupDetails?.company?.industry_type || targetCompany?.industry_type} />
                          <ReadField mono label={t("ctTaxRegIdFull")} value={setupDetails?.company?.tax_id || targetCompany?.tax_id} />
                          <ReadField label={t("ctTaxRegimeScheme")} value={setupDetails?.company?.tax_regime} />
                          <ReadField mono label={t("ctCorpRegNoFull")} value={setupDetails?.company?.registration_no || targetCompany?.registration_no} />
                          <ReadField label={t("ctIncorporationDate")} value={setupDetails?.company?.incorporation_date} />
                          <ReadField mono label={t("ctAutoVerifyDomain")} value={setupDetails?.company?.email_domain} />
                          <ReadField mono label={t("ctSupportEmail")} value={setupDetails?.company?.support_email} />
                          <ReadField mono label={t("ctPrimaryPhoneLandline")} value={setupDetails?.company?.phone_primary} />
                          <ReadField
                            label={t("ctPrimaryAccentColor")}
                            mono
                            value={
                              <span className="flex items-center gap-2">
                                <span className="h-4 w-4 rounded-[var(--radius-xs)] border border-(--border)" style={{ backgroundColor: setupDetails?.company?.primary_color_hex || targetCompany?.primary_color_hex || "#1F4E79" }} />
                                <span className="uppercase">{setupDetails?.company?.primary_color_hex || targetCompany?.primary_color_hex || "#1F4E79"}</span>
                              </span>
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleSaveTab} className="flex flex-col gap-8">
                        <FieldGroup title={t("ctGrpIdentity")}>
                          <Field className="sm:col-span-3" label={t("ctCompanyCode")} htmlFor="profile-company-code" hint={t("ctHintCodeFixed")}>
                            <Input id="profile-company-code" value={profileForm.company_code} disabled />
                          </Field>
                          <Field className="sm:col-span-9" label={t("ctLegalEntityName")} htmlFor="profile-company-name" required>
                            <Input
                              id="profile-company-name"
                              value={profileForm.company_name}
                              onChange={(e) => setProfileForm({ ...profileForm, company_name: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-5" label={t("coFieldDisplayName")} htmlFor="profile-company-display-name" hint={t("ctHintDisplayName")}>
                            <Input
                              id="profile-company-display-name"
                              value={profileForm.company_display_name}
                              onChange={(e) => setProfileForm({ ...profileForm, company_display_name: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-3" label={t("ctClassification")} htmlFor="cfg-ct-classification">
                            <Select
                              id="cfg-ct-classification"
                              value={profileForm.company_type}
                              onChange={(e) => setProfileForm({ ...profileForm, company_type: e.target.value })}
                            >
                              <option value="Sole Proprietor">{t("ctClsSoleProprietor")}</option>
                              <option value="Partnership">{t("ctClsPartnership")}</option>
                              <option value="Pvt Ltd">{t("ctClsPvtLtd")}</option>
                              <option value="LLP">LLP</option>
                              <option value="Trust">{t("ctClsTrust")}</option>
                              <option value="Co-operative">{t("ctClsCooperative")}</option>
                            </Select>
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctPrimaryIndustry")} htmlFor="profile-industry-type" required>
                            <Input
                              id="profile-industry-type"
                              value={profileForm.industry_type}
                              onChange={(e) => setProfileForm({ ...profileForm, industry_type: e.target.value })}
                              required
                            />
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpRegistration")}>
                          <Field className="sm:col-span-4" label={t("ctTaxRegIdShort")} htmlFor="profile-tax-id">
                            <Input
                              id="profile-tax-id"
                              value={profileForm.tax_id}
                              onChange={(e) => setProfileForm({ ...profileForm, tax_id: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctCorpRegNoShort")} htmlFor="profile-registration-no">
                            <Input
                              id="profile-registration-no"
                              value={profileForm.registration_no}
                              onChange={(e) => setProfileForm({ ...profileForm, registration_no: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctIncorporationDate")} htmlFor="profile-incorporation-date">
                            <Input
                              id="profile-incorporation-date"
                              type="date"
                              value={profileForm.incorporation_date}
                              onChange={(e) => setProfileForm({ ...profileForm, incorporation_date: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctTaxRegime")} htmlFor="cfg-ct-tax-regime">
                            <Select
                              id="cfg-ct-tax-regime"
                              value={profileForm.tax_regime}
                              onChange={(e) => setProfileForm({ ...profileForm, tax_regime: e.target.value })}
                            >
                              <option value="STANDARD">{t("ctSchemeStandard")}</option>
                              <option value="COMPOSITION">{t("ctSchemeComposition")}</option>
                              <option value="EXEMPT">{t("ctSchemeExempt")}</option>
                            </Select>
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpContactWeb")}>
                          <Field className="sm:col-span-6" label={t("ctWebsiteUrl")} htmlFor="profile-website">
                            <Input
                              id="profile-website"
                              value={profileForm.website}
                              onChange={(e) => setProfileForm({ ...profileForm, website: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-6" label={t("ctEmailDomainAutoVerify")} htmlFor="profile-email-domain" hint={t("ctHintEmailDomain")}>
                            <Input
                              id="profile-email-domain"
                              value={profileForm.email_domain}
                              onChange={(e) => setProfileForm({ ...profileForm, email_domain: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-6" label={t("ctSupportEmail")} htmlFor="profile-support-email">
                            <Input
                              id="profile-support-email"
                              type="email"
                              value={profileForm.support_email}
                              onChange={(e) => setProfileForm({ ...profileForm, support_email: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-6" label={t("ctPrimaryPhoneLandline")} htmlFor="profile-phone-primary">
                            <Input
                              id="profile-phone-primary"
                              type="tel"
                              value={profileForm.phone_primary}
                              onChange={(e) => setProfileForm({ ...profileForm, phone_primary: e.target.value })}
                            />
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpBranding")} description={t("ctGrpBrandingDesc")}>
                          <Field className="sm:col-span-6" label={t("ctCompanyLogoImage")}>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-dashed border-(--border) bg-(--input-bg)">
                                {profileForm.company_logo_url ? (
                                  <img
                                    src={profileForm.company_logo_url.startsWith('/') ? `${backendUrl}${profileForm.company_logo_url}` : profileForm.company_logo_url}
                                    alt={t("ctLogoPreviewAlt")}
                                    className="h-full w-full object-contain p-0.5"
                                  />
                                ) : (
                                  <ImageIcon className="h-5 w-5 text-(--text-muted)" />
                                )}
                              </div>
                              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) px-3 text-sm font-medium text-(--text-primary) transition-colors hover:border-(--accent)">
                                <Upload className="h-4 w-4" />
                                {uploadingLogo ? t("ctLogoUploading") : profileForm.company_logo_url ? t("ctLogoChange") : t("ctLogoUpload")}
                                <input
                                  type="file"
                                  accept="image/png, image/jpeg, image/svg+xml, image/webp"
                                  onChange={handleLogoUpload}
                                  disabled={uploadingLogo}
                                  className="hidden"
                                />
                              </label>
                            </div>
                          </Field>
                          <Field className="sm:col-span-6" label={t("ctBrandHexColor")} htmlFor="profile-brand-hex">
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                aria-label={t("ctBrandHexColor")}
                                value={profileForm.primary_color_hex}
                                onChange={(e) => setProfileForm({ ...profileForm, primary_color_hex: e.target.value })}
                                className="h-10 w-10 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-(--input-border) bg-transparent p-1"
                              />
                              <Input
                                id="profile-brand-hex"
                                value={profileForm.primary_color_hex}
                                onChange={(e) => setProfileForm({ ...profileForm, primary_color_hex: e.target.value })}
                                className="font-mono"
                              />
                            </div>
                          </Field>
                        </FieldGroup>

                        <div className="flex justify-end border-t border-(--border) pt-4">
                          <Button type="submit" disabled={saving || uploadingLogo} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}


                  {/* address TAB */}
                  {settingsTab === "address" && (
                    !isEditing ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <ReadField label={t("ctAddressLabelTag")} value={setupDetails?.address?.address_label || "Primary HQ"} />
                        <ReadField label={t("ctAddressType")} value={setupDetails?.address?.address_type || "HQ"} />
                        <ReadField label={t("ctAddressLine1")} value={setupDetails?.address?.line1} />
                        <ReadField label={t("ctAddressLine2")} value={setupDetails?.address?.line2} />
                        <ReadField label={t("ctCity")} value={setupDetails?.address?.city} />
                        <ReadField label={t("ctStateProvince")} value={setupDetails?.address?.state_id} />
                        <ReadField mono label={t("ctCountryCode")} value={setupDetails?.address?.country_id} />
                        <ReadField mono label={t("ctPincodePostal")} value={setupDetails?.address?.pincode} />
                        <ReadField mono className="sm:col-span-2" label={t("ctGpsCoordinates")} value={setupDetails?.address?.gps_latitude && setupDetails?.address?.gps_longitude ? `${setupDetails.address.gps_latitude}, ${setupDetails.address.gps_longitude}` : "—"} />
                      </div>
                    ) : (
                      <form onSubmit={handleSaveTab} className="flex flex-col gap-8">
                        <FieldGroup title={t("ctGrpThisAddress")}>
                          <Field className="sm:col-span-7" label={t("ctAddressNicknameTag")} htmlFor="address-label">
                            <Input
                              id="address-label"
                              placeholder={t("ctPhHeadquartersGate")}
                              value={addressForm.address_label}
                              onChange={(e) => setAddressForm({ ...addressForm, address_label: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-5" label={t("ctAddressType")} htmlFor="cfg-ct-address-type">
                            <Select
                              id="cfg-ct-address-type"
                              value={addressForm.address_type}
                              onChange={(e) => setAddressForm({ ...addressForm, address_type: e.target.value })}
                            >
                              <option value="HQ">{t("ctAddrCorporateHq")}</option>
                              <option value="Branch">{t("ctAddrBranchOffice")}</option>
                              <option value="Warehouse">{t("ctAddrWarehouseDepot")}</option>
                              <option value="Farm">{t("ctAddrFarmSite")}</option>
                            </Select>
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpPostal")}>
                          <Field className="sm:col-span-12" label={t("ctAddressLine1")} htmlFor="address-line1" required>
                            <Input
                              id="address-line1"
                              value={addressForm.line1}
                              onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-12" label={t("ctAddressLine2")} htmlFor="address-line2">
                            <Input
                              id="address-line2"
                              value={addressForm.line2}
                              onChange={(e) => setAddressForm({ ...addressForm, line2: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctCity")} htmlFor="address-city" required>
                            <Input
                              id="address-city"
                              value={addressForm.city}
                              onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctStateProvince")} htmlFor="address-state" required>
                            <Input
                              id="address-state"
                              value={addressForm.state_id}
                              onChange={(e) => setAddressForm({ ...addressForm, state_id: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-2" label={t("ctPincode")} htmlFor="address-pincode" required>
                            <Input
                              id="address-pincode"
                              value={addressForm.pincode}
                              onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-2" label={t("country")} htmlFor="address-country" required hint={t("ctHintCountryIso")}>
                            <Input
                              id="address-country"
                              value={addressForm.country_id}
                              onChange={(e) => setAddressForm({ ...addressForm, country_id: e.target.value })}
                              required
                            />
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpCoordinates")} description={t("ctGrpCoordinatesDesc")}>
                          <Field className="sm:col-span-3" label={t("ctGpsLatitude")} htmlFor="address-gps-lat">
                            <Input
                              id="address-gps-lat"
                              placeholder={t("ctPhLatitude")}
                              className="font-mono"
                              value={addressForm.gps_latitude}
                              onChange={(e) => setAddressForm({ ...addressForm, gps_latitude: e.target.value })}
                            />
                          </Field>
                          <Field className="sm:col-span-3" label={t("ctGpsLongitude")} htmlFor="address-gps-lng">
                            <Input
                              id="address-gps-lng"
                              placeholder={t("ctPhLongitude")}
                              className="font-mono"
                              value={addressForm.gps_longitude}
                              onChange={(e) => setAddressForm({ ...addressForm, gps_longitude: e.target.value })}
                            />
                          </Field>
                        </FieldGroup>

                        <div className="flex justify-end border-t border-(--border) pt-4">
                          <Button type="submit" disabled={saving} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}

                  {/* contact TAB */}
                  {settingsTab === "contact" && (
                    !isEditing ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <ReadField label={t("ctContactPersonName")} value={setupDetails?.contact?.full_name} />
                        <ReadField label={t("profileDesignation")} value={setupDetails?.contact?.designation} />
                        <ReadField mono label={t("ctPrimaryPhone")} value={setupDetails?.contact?.phone_primary} />
                        <ReadField mono label={t("ctSecondaryPhone")} value={setupDetails?.contact?.phone_secondary} />
                        <ReadField mono label={t("ctPrimaryEmail")} value={setupDetails?.contact?.email} />
                        <ReadField label={t("ctAlertEmails")} value={setupDetails?.contact?.receives_alerts ? "Active - Receives ERP threshold notifications" : "Disabled"} />
                        <ReadField className="sm:col-span-2" label={t("ctExecReportEmails")} value={setupDetails?.contact?.receives_reports ? "Active - Receives periodic executive summary reports" : "Disabled"} />
                      </div>
                    ) : (
                      <form onSubmit={handleSaveTab} className="flex flex-col gap-8">
                        <FieldGroup title={t("ctGrpKeyContact")} description={t("ctGrpKeyContactDesc")}>
                          <Field className="sm:col-span-7" label={t("ctKeyContactFullName")} htmlFor="contact-full-name" required>
                            <Input
                              id="contact-full-name"
                              value={contactForm.full_name}
                              onChange={(e) => setContactForm({ ...contactForm, full_name: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-5" label={t("ctDesignationRole")} htmlFor="contact-designation" required>
                            <Input
                              id="contact-designation"
                              value={contactForm.designation}
                              onChange={(e) => setContactForm({ ...contactForm, designation: e.target.value })}
                              required
                            />
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpHowToReach")}>
                          <Field className="sm:col-span-7" label={t("ctPrimaryEmail")} htmlFor="contact-email" required>
                            <Input
                              id="contact-email"
                              type="email"
                              value={contactForm.email}
                              onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-5" label={t("ctPrimaryContactPhone")} htmlFor="contact-phone-primary" required>
                            <Input
                              id="contact-phone-primary"
                              type="tel"
                              value={contactForm.phone_primary}
                              onChange={(e) => setContactForm({ ...contactForm, phone_primary: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-5" label={t("ctSecondaryContactPhone")} htmlFor="contact-phone-secondary">
                            <Input
                              id="contact-phone-secondary"
                              type="tel"
                              value={contactForm.phone_secondary}
                              onChange={(e) => setContactForm({ ...contactForm, phone_secondary: e.target.value })}
                            />
                          </Field>
                        </FieldGroup>

                        {/* These two were a bare column of checkboxes wedged into the
                            field grid, vertically centred against nothing. They are a
                            subscription choice, not a contact detail. */}
                        <FieldGroup title={t("ctGrpNotifications")} description={t("ctGrpNotificationsDesc")}>
                          <label className="sm:col-span-6 flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-3">
                            <input
                              type="checkbox"
                              checked={contactForm.receives_alerts}
                              onChange={(e) => setContactForm({ ...contactForm, receives_alerts: e.target.checked })}
                              className="mt-0.5 h-4 w-4 cursor-pointer rounded-[var(--radius-xs)] border-(--border) bg-(--input-bg) text-(--accent)"
                            />
                            <span className="text-sm text-(--text-primary)">{t("ctReceiveThresholdAlerts")}</span>
                          </label>
                          <label className="sm:col-span-6 flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-3">
                            <input
                              type="checkbox"
                              checked={contactForm.receives_reports}
                              onChange={(e) => setContactForm({ ...contactForm, receives_reports: e.target.checked })}
                              className="mt-0.5 h-4 w-4 cursor-pointer rounded-[var(--radius-xs)] border-(--border) bg-(--input-bg) text-(--accent)"
                            />
                            <span className="text-sm text-(--text-primary)">{t("ctReceiveExecReports")}</span>
                          </label>
                        </FieldGroup>

                        <div className="flex justify-end border-t border-(--border) pt-4">
                          <Button type="submit" disabled={saving} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}


                  {/* localization TAB */}
                  {settingsTab === "localization" && (
                    !isEditing ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <ReadField label={t("ctDefaultLanguage")} value={languages.find(l => l.lang_id === setupDetails?.company?.default_language_id)?.lang_name || setupDetails?.company?.default_language_id} />
                        <ReadField label={t("ctBaseCurrency")} value={currencies.find(c => c.currency_id === setupDetails?.company?.base_currency_id)?.currency_name || setupDetails?.company?.base_currency_id} />
                        <ReadField mono label={t("ctDefaultTimezone")} value={setupDetails?.company?.default_timezone_id} />
                        <ReadField mono label={t("ctCountryLocaleCode")} value={setupDetails?.company?.country_id} />
                      </div>
                    ) : (
                      <form onSubmit={handleSaveTab} className="flex flex-col gap-8">
                        <FieldGroup title={t("ctGrpLanguageMoney")}>
                          <Field className="sm:col-span-6" label={t("ctDefaultLanguage")} htmlFor="cfg-ct-default-language">
                            <Select
                              id="cfg-ct-default-language"
                              value={localizationForm.default_language_id}
                              onChange={(e) => setLocalizationForm({ ...localizationForm, default_language_id: e.target.value })}
                            >
                              <option value="">{t("ctSelectLanguage")}</option>
                              {languages.map((l: any) => (
                                <option key={l.lang_id} value={l.lang_id}>{l.lang_name} ({l.lang_code})</option>
                              ))}
                            </Select>
                          </Field>
                          {/* BBP-1 §1.1: "USD. All financial values stored in USD."
                              Changing this restates every amount in the company. */}
                          <Field className="sm:col-span-6" label={t("ctBaseCurrency")} htmlFor="cfg-ct-base-currency" hint={t("ctHintBaseCurrency")}>
                            <Select
                              id="cfg-ct-base-currency"
                              value={localizationForm.base_currency_id}
                              onChange={(e) => setLocalizationForm({ ...localizationForm, base_currency_id: e.target.value })}
                            >
                              <option value="">{t("ctSelectCurrency")}</option>
                              {currencies.map((c: any) => (
                                <option key={c.currency_id} value={c.currency_id}>{c.currency_name} ({c.currency_code})</option>
                              ))}
                            </Select>
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpPlaceTime")}>
                          <Field className="sm:col-span-5" label={t("ctTimezoneId")} htmlFor="localization-timezone" required hint={t("ctHintTimezoneIana")}>
                            <Input
                              id="localization-timezone"
                              className="font-mono"
                              value={localizationForm.default_timezone_id}
                              onChange={(e) => setLocalizationForm({ ...localizationForm, default_timezone_id: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-3" label={t("ctOperatingCountryCode")} htmlFor="localization-country" required hint={t("ctHintCountryIso")}>
                            <Input
                              id="localization-country"
                              className="font-mono uppercase"
                              value={localizationForm.country_id}
                              onChange={(e) => setLocalizationForm({ ...localizationForm, country_id: e.target.value.toUpperCase() })}
                              required
                            />
                          </Field>
                        </FieldGroup>

                        <div className="flex justify-end border-t border-(--border) pt-4">
                          <Button type="submit" disabled={saving} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}

                  {/* fiscal TAB */}
                  {settingsTab === "fiscal" && (
                    !isEditing ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <ReadField mono label={t("ctFiscalYearFormat")} value={setupDetails?.fiscal?.fiscal_year_format || "FY APR-MAR"} />
                        <ReadField
                          label={t("ctFiscalStartMonthDay")}
                          value={`${setupDetails?.fiscal?.fiscal_start_month ? `Month ${setupDetails.fiscal.fiscal_start_month}` : "Month 4 (April)"} (Day ${setupDetails?.fiscal?.fiscal_start_day || 1} to Day ${setupDetails?.fiscal?.fiscal_end_day || 31})`}
                        />
                        <ReadField mono label={t("ctCurrentFiscalYear")} value={setupDetails?.fiscal?.current_fiscal_year || "2026-27"} />
                        <ReadField label={t("ctPeriodType")} value={setupDetails?.fiscal?.period_type || "MONTHLY"} />
                        <ReadField label={t("ctAccountingStandard")} value={setupDetails?.fiscal?.accounting_standard || "Local GAAP"} />
                        <ReadField label={t("ctDepreciationModel")} value={setupDetails?.fiscal?.depreciation_method || "SLM (Straight Line)"} />
                        <ReadField label={t("ctInventoryCostingModel")} value={setupDetails?.fiscal?.inventory_valuation || "FIFO"} />
                        <ReadField label={t("ctTaxFilingFrequency")} value={setupDetails?.fiscal?.gst_filing_frequency || "MONTHLY"} />
                        <ReadField label={t("ctStatutoryTaxAudit")} value={setupDetails?.fiscal?.tax_audit_applicable ? "Mandatory Tax Audit Applicable" : "Not Applicable"} />
                        <ReadField mono label={t("ctDecimalPrecision")} value={`${setupDetails?.fiscal?.decimal_places ?? 2} decimal places`} />
                      </div>
                    ) : (
                      <form onSubmit={handleSaveTab} className="flex flex-col gap-8">
                        <FieldGroup title={t("ctGrpTheYear")}>
                          <Field className="sm:col-span-4" label={t("ctFiscalStartMonth")} htmlFor="cfg-ct-fiscal-start-month">
                            <Select
                              id="cfg-ct-fiscal-start-month"
                              value={fiscalForm.fiscal_start_month}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, fiscal_start_month: parseInt(e.target.value) })}
                            >
                              <option value={1}>{t("ctMonthJanuary")}</option>
                              <option value={4}>{t("ctMonthApril")}</option>
                            </Select>
                          </Field>
                          <Field className="sm:col-span-3" label={t("ctCurrentFiscalYear")} htmlFor="fiscal-year" required>
                            <Input
                              id="fiscal-year"
                              className="font-mono"
                              placeholder={t("ctPhFiscalYear")}
                              value={fiscalForm.current_fiscal_year}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, current_fiscal_year: e.target.value })}
                              required
                            />
                          </Field>
                          <Field className="sm:col-span-3" label={t("ctAccountingPeriodicity")} htmlFor="cfg-ct-accounting-periodicity">
                            <Select
                              id="cfg-ct-accounting-periodicity"
                              value={fiscalForm.period_type}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, period_type: e.target.value })}
                            >
                              <option value="MONTHLY">{t("ctPeriodMonthly")}</option>
                              <option value="QUARTERLY">{t("ctPeriodQuarterly")}</option>
                            </Select>
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpAccountingPolicy")} description={t("ctGrpAccountingPolicyDesc")}>
                          <Field className="sm:col-span-4" label={t("ctAccountingStandard")} htmlFor="cfg-ct-accounting-standard">
                            <Select
                              id="cfg-ct-accounting-standard"
                              value={fiscalForm.accounting_standard}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, accounting_standard: e.target.value })}
                            >
                              <option value="Local GAAP">{t("ctLocalGaap")}</option>
                              <option value="IFRS">IFRS</option>
                              <option value="US GAAP">US GAAP</option>
                            </Select>
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctDepreciationModel")} htmlFor="cfg-ct-depreciation-model">
                            <Select
                              id="cfg-ct-depreciation-model"
                              value={fiscalForm.depreciation_method}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, depreciation_method: e.target.value })}
                            >
                              <option value="SLM">{t("ctDeprSlm")}</option>
                              <option value="WDV">{t("ctDeprWdv")}</option>
                              <option value="UNITS_OF_PRODUCTION">{t("ctDeprUnitsOfProduction")}</option>
                            </Select>
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctInventoryCostingMethod")} htmlFor="cfg-ct-inventory-costing-method">
                            <Select
                              id="cfg-ct-inventory-costing-method"
                              value={fiscalForm.inventory_valuation}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, inventory_valuation: e.target.value })}
                            >
                              <option value="FIFO">{t("ctCostFifo")}</option>
                              <option value="Weighted Average">{t("ctCostWeightedAverage")}</option>
                              <option value="STANDARD COSTING">{t("ctCostStandard")}</option>
                            </Select>
                          </Field>
                          <Field className="sm:col-span-4" label={t("ctDecimalPrecision")} htmlFor="cfg-ct-decimal-precision">
                            <Select
                              id="cfg-ct-decimal-precision"
                              value={fiscalForm.decimal_places}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, decimal_places: parseInt(e.target.value) })}
                            >
                              <option value={2}>{t("ctDecimals2")}</option>
                              <option value={3}>{t("ctDecimals3")}</option>
                              <option value={4}>{t("ctDecimals4")}</option>
                            </Select>
                          </Field>
                        </FieldGroup>

                        <FieldGroup title={t("ctGrpTaxCompliance")}>
                          <Field className="sm:col-span-4" label={t("ctTaxFilingFrequency")} htmlFor="cfg-ct-tax-filing-frequency">
                            <Select
                              id="cfg-ct-tax-filing-frequency"
                              value={fiscalForm.gst_filing_frequency}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, gst_filing_frequency: e.target.value })}
                            >
                              <option value="MONTHLY">{t("ctFilingMonthly")}</option>
                              <option value="QUARTERLY">{t("ctFilingQuarterly")}</option>
                            </Select>
                          </Field>
                          <label className="sm:col-span-8 flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) p-3">
                            <input
                              type="checkbox"
                              checked={fiscalForm.tax_audit_applicable}
                              onChange={(e) => setFiscalForm({ ...fiscalForm, tax_audit_applicable: e.target.checked })}
                              className="mt-0.5 h-4 w-4 cursor-pointer rounded-[var(--radius-xs)] border-(--border) bg-(--input-bg) text-(--accent)"
                            />
                            <span className="text-sm text-(--text-primary)">{t("ctStatutoryAuditApplicable")}</span>
                          </label>
                        </FieldGroup>

                        <div className="flex justify-end border-t border-(--border) pt-4">
                          <Button type="submit" disabled={saving} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}


                  {/* modules TAB */}
                  {settingsTab === "modules" && (
                    !isEditing ? (
                      <div className="flex flex-col gap-4">
                        <span className="nf-text-label text-(--text-secondary)">{t("ctActivatedSectors")}</span>
                        {modulesForm.length === 0 ? (
                          <div className="text-xs text-(--text-secondary) bg-(--surface-raised) p-4 rounded-[var(--radius-sm)] border border-(--border)">{t("ctNoModulesEnabled")}</div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {nobs.map((n: any) => {
                              const isNobActive = modulesForm.includes(n.nob_code);
                              if (!isNobActive) return null;

                              const associatedLobs = lobMap[n.nob_id] || [];
                              const activeLobs = associatedLobs.filter(l => modulesForm.includes(l.lob_code));

                              return (
                                <div key={n.nob_id} className="p-4 rounded-[var(--radius-sm)] bg-(--surface-raised) border border-(--border) flex flex-col gap-2">
                                  <div className="flex items-center gap-2 border-b border-(--border) pb-2">
                                    <span className="font-semibold text-xs text-(--text-primary)">{n.nob_name}</span>
                                    <span className="text-[9px] bg-(--accent)/10 text-(--accent) font-semibold border border-(--accent)/20 px-1.5 py-0.5 rounded-[var(--radius-xs)] font-mono uppercase shrink-0">{t("statusActive")}</span>
                                  </div>
                                  <div className="flex flex-col gap-1 mt-1">
                                    <span className="text-[9px] font-semibold text-(--accent) uppercase tracking-wider">{t("ctActiveLobsLabel")}</span>
                                    {activeLobs.length === 0 ? (
                                      <span className="text-xs text-(--text-secondary)">{t("ctNoneActive")}</span>
                                    ) : (
                                      <div className="flex flex-wrap gap-1.5 mt-1">
                                        {activeLobs.map(lob => (
                                          <span key={lob.lob_id} className="text-[10px] text-(--text-secondary) bg-(--surface-raised) px-2 py-0.5 rounded-[var(--radius-xs)] border border-(--border)">{lob.lob_name}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {nobs.map((n: any) => {
                            const isNobChecked = modulesForm.includes(n.nob_code);
                            const associatedLobs = lobMap[n.nob_id] || [];

                            return (
                              <div
                                key={n.nob_id}
                                onClick={() => handleNobToggle(n.nob_code, n.nob_id)}
                                className={`p-4 border rounded-[var(--radius-md)] flex flex-col gap-2 cursor-pointer transition-all ${
                                  isNobChecked
                                    ? "border-(--accent)/40 bg-(--accent)/5"
                                    : "border-(--border) bg-(--surface-raised) hover:border-(--accent)"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-sm text-(--text-primary)">{n.nob_name}</span>
                                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                                    isNobChecked ? "bg-(--accent) border-(--accent) text-white" : "border-(--border)"
                                  }`}>
                                    {isNobChecked && <Check className="w-3.5 h-3.5" />}
                                  </div>
                                </div>
                                <p className="text-xs text-(--text-secondary)">{n.description || "Link this sector to enable daily feed logs and batches."}</p>

                                {/* LOB Checkboxes inside setup view */}
                                {isNobChecked && (
                                  <div className="mt-3 pt-3 border-t border-(--border)/80 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                                    <span className="text-[10px] font-semibold text-(--accent) uppercase tracking-wider">{t("ctSelectActiveLobs")}</span>
                                    {loadingLobs[n.nob_id] ? (
                                      <div className="text-[11px] text-(--text-secondary) animate-pulse py-1">{t("ctLoadingSubSectors")}</div>
                                    ) : associatedLobs.length === 0 ? (
                                      <div className="text-[11px] text-(--text-secondary) py-1">{t("ctNoSubSectors")}</div>
                                    ) : (
                                      <div className="flex flex-col gap-1.5 mt-1">
                                        {associatedLobs.map((lob: any) => {
                                          const isLobChecked = modulesForm.includes(lob.lob_code);
                                          return (
                                            <label
                                              key={lob.lob_id}
                                              className="flex items-center gap-2.5 cursor-pointer py-1.5 px-2 rounded-lg hover:bg-(--surface-raised) text-xs transition-colors"
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isLobChecked}
                                                onChange={() => handleLobToggle(lob.lob_code)}
                                                className="w-4 h-4 rounded-[var(--radius-xs)] border-(--input-border) bg-(--input-bg) text-(--accent) focus:ring-(--accent) focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                              />
                                              <div className="flex flex-col">
                                                <span className="font-semibold text-(--text-primary)">{lob.lob_name}</span>
                                                {lob.description && <span className="text-[10px] text-(--text-secondary)">{lob.description}</span>}
                                              </div>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex justify-end border-t border-(--border) pt-4">
                          <Button type="button" onClick={handleSaveModules} disabled={saving} className="text-xs">
                            <Save className="w-4 h-4" /> {saving ? t("saving") : t("saveChanges")}
                          </Button>
                        </div>
                      </div>
                    )
                  )}

              </div>
            )}

      </div>
    </div>
  );
}

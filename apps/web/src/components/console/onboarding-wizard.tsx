import React from "react";
import { Building2, MapPin, Contact, Globe, Coins, Clock, Calendar, Layers, CheckCircle2, Check, RefreshCw } from "lucide-react";
import Step1Profile from "./wizard-steps/step1-profile";
import Step2Address from "./wizard-steps/step2-address";
import Step3Contact from "./wizard-steps/step3-contact";
import Step4Language from "./wizard-steps/step4-language";
import Step5Currency from "./wizard-steps/step5-currency";
import Step6Timezone from "./wizard-steps/step6-timezone";
import Step7Fiscal from "./wizard-steps/step7-fiscal";
import Step8Modules from "./wizard-steps/step8-modules";
import Step9Finalize from "./wizard-steps/step9-finalize";
import { api } from "../../services/api-client";
import { useLanguage } from "@/hooks/useLanguage";

interface OnboardingWizardProps {
  wizardSteps: any[];
  activeWizardStep: number;
  setActiveWizardStep: (step: number) => void;
  activeCompany: any;
  setActiveCompany: (company: any) => void;
  tenantId: string;
  languages: any[];
  currencies: any[];
  timezones: any[];
  countries: any[];
  nobs: any[];
  isSubmitting: boolean;
  setIsSubmitting: (val: boolean) => void;
  setActionError: (msg: string) => void;
  setActionSuccess: (msg: string) => void;
  fetchWizardProgress: (companyId: string) => Promise<void>;
  loadConsoleWorkspace: () => Promise<void>;
}

export default function OnboardingWizard({
  wizardSteps,
  activeWizardStep,
  setActiveWizardStep,
  activeCompany,
  setActiveCompany,
  tenantId,
  languages,
  currencies,
  timezones,
  countries,
  nobs,
  isSubmitting,
  setIsSubmitting,
  setActionError,
  setActionSuccess,
  fetchWizardProgress,
  loadConsoleWorkspace,
}: OnboardingWizardProps) {
  const { t } = useLanguage();

  const [setupDetails, setSetupDetails] = React.useState<any>(null);
  const [loadingDetails, setLoadingDetails] = React.useState(false);

  const fetchSetupDetails = async (companyId: string) => {
    if (!companyId) return;
    setLoadingDetails(true);
    try {
      const details = await api.get(`/setup/wizard/company-details/${companyId}`);
      setSetupDetails(details);
    } catch (err) {
      console.error("Failed to load step details:", err);
    } finally {
      setLoadingDetails(false);
    }
  };

  React.useEffect(() => {
    if (activeCompany?.company_id) {
      fetchSetupDetails(activeCompany.company_id);
    }
  }, [activeCompany?.company_id]);

  // Submit handlers
  const handleStep1Submit = async (data: any) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      const comp = await api.post("/setup/wizard/step-1", {
        ...data,
        tenant_id: tenantId,
        company_id: activeCompany?.company_id
      });
      setActiveCompany(comp);
      setActionSuccess("Company profile registered successfully!");
      await fetchWizardProgress(comp.company_id);
      await fetchSetupDetails(comp.company_id);
      setActiveWizardStep(2);
    } catch (err: any) {
      setActionError(err?.message || "Step 1 registration failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep2Submit = async (data: any) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post("/setup/wizard/step-2", {
        company_id: activeCompany.company_id,
        address_type: data.address_type,
        address_label: data.address_label,
        line1: data.address_line_1,
        line2: data.address_line_2,
        city: data.city,
        state_id: data.state_province,
        country_id: data.country_name,
        pincode: data.postal_code,
        gps_latitude: !data.gps_lat || isNaN(parseFloat(data.gps_lat)) ? undefined : parseFloat(data.gps_lat),
        gps_longitude: !data.gps_lng || isNaN(parseFloat(data.gps_lng)) ? undefined : parseFloat(data.gps_lng),
      });
      setActionSuccess("Company address configured successfully!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(3);
    } catch (err: any) {
      setActionError(err?.message || "Step 2 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep3Submit = async (data: any) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post("/setup/wizard/step-3", {
        company_id: activeCompany.company_id,
        contact_type: "PRIMARY",
        full_name: data.contact_name,
        designation: data.designation,
        email: data.contact_email,
        phone_primary: data.contact_phone,
        phone_secondary: data.phone_secondary,
        receives_alerts: true,
        receives_reports: data.receives_reports ?? true,
      });
      setActionSuccess("Contact details associated successfully!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(4);
    } catch (err: any) {
      setActionError(err?.message || "Step 3 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep4Submit = async (langId: string) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post(`/setup/wizard/step-4/${activeCompany.company_id}/${langId}`);
      setActionSuccess("Language preferences saved!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(5);
    } catch (err: any) {
      setActionError(err?.message || "Step 4 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep5Submit = async (currencyId: string) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post(`/setup/wizard/step-5/${activeCompany.company_id}/${currencyId}`);
      setActionSuccess("Base currency saved!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(6);
    } catch (err: any) {
      setActionError(err?.message || "Step 5 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep6Submit = async (tz: string, country: string) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post(`/setup/wizard/step-6/${activeCompany.company_id}`, { timezone_id: tz, country_id: country.toUpperCase() });
      setActionSuccess("Timezone and locale saved!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(7);
    } catch (err: any) {
      setActionError(err?.message || "Step 6 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep7Submit = async (data: any) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      const isAprilStart = data.fiscal_start_month === 4;
      await api.post("/setup/wizard/step-7", {
        company_id: activeCompany.company_id,
        fiscal_year_format: isAprilStart ? "FY APR-MAR" : "FY JAN-DEC",
        fiscal_start_month: data.fiscal_start_month,
        fiscal_start_day: 1,
        fiscal_end_day: 31,
        current_fiscal_year: "2026-27",
        period_type: "MONTHLY",
        accounting_standard: "Local GAAP",
        depreciation_method: data.depreciation_method || "SLM",
        inventory_valuation: data.valuation_method === "WEIGHTED_AVG" ? "Weighted Average" : data.valuation_method === "FIFO" ? "FIFO" : "STANDARD COSTING",
        gst_filing_frequency: data.gst_filing_frequency || "MONTHLY",
        tax_audit_applicable: data.tax_audit_applicable ?? false,
        decimal_places: data.decimal_places ?? 2,
      });
      setActionSuccess("Fiscal parameters registered!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);

      setActiveWizardStep(8);
    } catch (err: any) {
      setActionError(err?.message || "Step 7 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStep8Submit = async (selectedNobs: string[]) => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post(`/setup/wizard/step-8/${activeCompany.company_id}`, {
        modules: selectedNobs
      });
      setActionSuccess("Business segments linked successfully!");
      await fetchWizardProgress(activeCompany.company_id);
      await fetchSetupDetails(activeCompany.company_id);
      setActiveWizardStep(9);
    } catch (err: any) {
      setActionError(err?.message || "Step 8 failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinalize = async () => {
    setIsSubmitting(true);
    setActionError("");
    try {
      await api.post(`/setup/wizard/complete/${activeCompany.company_id}`);
      setActionSuccess("ERP Setup wizard complete! Welcome to NAVFarm!");
      setTimeout(() => {
        loadConsoleWorkspace();
      }, 1500);
    } catch (err: any) {
      setActionError(err?.message || "Finalization failed. Please verify all wizard checklist items are completed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="nf-onboarding flex-1 max-w-6xl mx-auto w-full p-4 sm:p-6 md:p-12 flex flex-col md:flex-row gap-4 md:gap-8 overflow-y-auto">

      <div className="rounded-[var(--radius-lg)] border p-4 md:hidden" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">{t("owCompanySetup")}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Step {activeWizardStep} of 9</p>
          </div>
          <span className="rounded-full border px-3 py-1 text-[10px] font-semibold" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            {Math.round((activeWizardStep / 9) * 100)}%
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-raised)]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(activeWizardStep / 9) * 100}%` }} />
        </div>
      </div>

      {/* Progress Menu (Left Sidebar) */}
      <aside className="hidden md:flex md:w-72 shrink-0 flex-col gap-3">
        {/* Intro copy is the column's heading, not a module */}
        <div className="mb-4 flex flex-col gap-1 px-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("owErpSetupWizard")}</h3>
          <p className="text-xs text-[var(--text-secondary)]">{t("owErpSetupWizardDesc")}</p>
        </div>

        {[
          { order: 1, label: t("wzNavCompanyProfile"), icon: <Building2 className="w-4 h-4" /> },
          { order: 2, label: t("wzNavOperatingAddresses"), icon: <MapPin className="w-4 h-4" /> },
          { order: 3, label: t("wzNavPrimaryContact"), icon: <Contact className="w-4 h-4" /> },
          { order: 4, label: t("wzNavLanguageCatalog"), icon: <Globe className="w-4 h-4" /> },
          { order: 5, label: t("wzNavBaseCurrency"), icon: <Coins className="w-4 h-4" /> },
          { order: 6, label: t("wzNavTimezoneCountry"), icon: <Clock className="w-4 h-4" /> },
          { order: 7, label: t("wzNavFiscalAccounting"), icon: <Calendar className="w-4 h-4" /> },
          { order: 8, label: t("wzNavNatureOfBusiness"), icon: <Layers className="w-4 h-4" /> },
          { order: 9, label: t("wzNavCompleteWizard"), icon: <CheckCircle2 className="w-4 h-4" /> }
        ].map((step) => {
          const isCompleted = wizardSteps.find(s => s.stepOrder === step.order)?.status === "COMPLETED";
          const isActive = activeWizardStep === step.order;
          const isClickable = isCompleted || step.order <= activeWizardStep;
          return (
            <button
              key={step.order}
              type="button"
              disabled={!isClickable}
              onClick={() => setActiveWizardStep(step.order)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-[var(--radius-sm)] border text-sm font-medium transition-all text-left outline-none ${
                isActive
                  ? "bg-[var(--accent-muted)] border-[var(--accent)] text-[var(--text-primary)] shadow-sm"
                  : isCompleted
                  ? "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:bg-[var(--surface)] cursor-pointer"
                  : isClickable
                  ? "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                  : "border-transparent text-[var(--text-muted)] cursor-not-allowed opacity-50"
              }`}
            >
              <div className="flex items-center gap-2">
                {step.icon}
                <span>{step.label}</span>
              </div>
              {isCompleted && <Check className="w-4 h-4 text-[var(--accent)]" />}
            </button>
          );
        })}
      </aside>

      {/* Wizard Form Panel (Right Side) */}
      <main className="flex-1 rounded-[var(--radius-lg)] border p-5 sm:p-8 flex flex-col gap-6 justify-between animate-fade-in" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex-1">
          {loadingDetails ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="animate-spin w-6 h-6 text-[var(--accent)]" />
            </div>
          ) : (
            <>
              {activeWizardStep === 1 && (
                <Step1Profile onSubmit={handleStep1Submit} isSubmitting={isSubmitting} initialData={setupDetails?.company || activeCompany} />
              )}
              {activeWizardStep === 2 && (
                <Step2Address
                  onSubmit={handleStep2Submit}
                  isSubmitting={isSubmitting}
                  initialData={setupDetails?.address ? {
                    address_label: setupDetails.address.address_label,
                    address_line_1: setupDetails.address.line1,
                    address_line_2: setupDetails.address.line2,
                    city: setupDetails.address.city,
                    state_province: setupDetails.address.state_id,
                    postal_code: setupDetails.address.pincode,
                    country_name: setupDetails.address.country_id,
                    address_type: setupDetails.address.address_type,
                    gps_lat: setupDetails.address.gps_latitude,
                    gps_lng: setupDetails.address.gps_longitude,
                  } : null}
                />
              )}
              {activeWizardStep === 3 && (
                <Step3Contact
                  onSubmit={handleStep3Submit}
                  isSubmitting={isSubmitting}
                  initialData={setupDetails?.contact ? {
                    contact_name: setupDetails.contact.full_name,
                    contact_email: setupDetails.contact.email,
                    contact_phone: setupDetails.contact.phone_primary,
                    phone_secondary: setupDetails.contact.phone_secondary,
                    designation: setupDetails.contact.designation,
                    receives_reports: setupDetails.contact.receives_reports,
                  } : null}
                />
              )}
              {activeWizardStep === 4 && (
                <Step4Language
                  onSubmit={handleStep4Submit}
                  isSubmitting={isSubmitting}
                  languages={languages}
                  initialValue={setupDetails?.company?.default_language_id || activeCompany?.default_language_id}
                />
              )}
              {activeWizardStep === 5 && (
                <Step5Currency
                  onSubmit={handleStep5Submit}
                  isSubmitting={isSubmitting}
                  currencies={currencies}
                  initialValue={setupDetails?.company?.base_currency_id || activeCompany?.base_currency_id}
                />
              )}
              {activeWizardStep === 6 && (
                <Step6Timezone
                  onSubmit={handleStep6Submit}
                  isSubmitting={isSubmitting}
                  timezones={timezones}
                  countries={countries}
                  initialTz={setupDetails?.company?.default_timezone_id || activeCompany?.default_timezone_id}
                  initialCountry={setupDetails?.company?.country_id || activeCompany?.country_id}
                  onError={setActionError}
                />
              )}
              {activeWizardStep === 7 && (
                <Step7Fiscal
                  onSubmit={handleStep7Submit}
                  isSubmitting={isSubmitting}
                  initialData={setupDetails?.fiscal ? {
                    fiscal_start_month: setupDetails.fiscal.fiscal_start_month,
                    valuation_method:
                      setupDetails.fiscal.inventory_valuation === "Weighted Average" ||
                      setupDetails.fiscal.inventory_valuation === "WEIGHTED_AVG"
                        ? "WEIGHTED_AVG"
                        : setupDetails.fiscal.inventory_valuation === "FIFO"
                        ? "FIFO"
                        : "STANDARD",
                    depreciation_method: setupDetails.fiscal.depreciation_method || "SLM",
                    gst_filing_frequency: setupDetails.fiscal.gst_filing_frequency || "MONTHLY",
                    tax_audit_applicable: setupDetails.fiscal.tax_audit_applicable ?? false,
                    decimal_places: setupDetails.fiscal.decimal_places ?? 2,
                  } : null}
                />
              )}
              {activeWizardStep === 8 && (
                <Step8Modules
                  onSubmit={handleStep8Submit}
                  isSubmitting={isSubmitting}
                  nobs={nobs}
                  initialModules={setupDetails?.modules}
                />
              )}
              {activeWizardStep === 9 && (
                <Step9Finalize onSubmit={handleFinalize} isSubmitting={isSubmitting} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

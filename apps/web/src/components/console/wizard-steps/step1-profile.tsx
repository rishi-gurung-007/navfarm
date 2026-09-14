import React, { useEffect, useId, useState } from "react";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Building2, Upload, X, Image as ImageIcon } from "lucide-react";
import { api } from "../../../services/api-client";
import { useLanguage } from "@/hooks/useLanguage";
import { API_ORIGIN } from "@/lib/api-client";

interface Step1ProfileProps {
  onSubmit: (data: any) => Promise<void>;
  isSubmitting: boolean;
  initialData?: any;
}

export default function Step1Profile({ onSubmit, isSubmitting, initialData }: Step1ProfileProps) {
  const { t } = useLanguage();
  const [logoUrl, setLogoUrl] = useState(initialData?.company_logo_url || "");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;

  const [formData, setFormData] = useState({
    company_code: initialData?.company_code || "",
    company_name: initialData?.company_name || "",
    company_display_name: initialData?.company_display_name || "",
    company_type: initialData?.company_type || "Pvt Ltd",
    industry_type: initialData?.industry_type || "Poultry Farming",
    registration_no: initialData?.registration_no || "",
    tax_id: initialData?.tax_id || "",
    tax_regime: initialData?.tax_regime || "STANDARD",
    incorporation_date: initialData?.incorporation_date || "",
    website: initialData?.website || "",
    email_domain: initialData?.email_domain || "",
    support_email: initialData?.support_email || "",
    phone_primary: initialData?.phone_primary || "",
    primary_color_hex: initialData?.primary_color_hex || "#1F4E79",
    company_logo_url: initialData?.company_logo_url || ""
  });

  useEffect(() => {
    if (initialData) {
      setLogoUrl(initialData.company_logo_url || "");
      setFormData({
        company_code: initialData.company_code || "",
        company_name: initialData.company_name || "",
        company_display_name: initialData.company_display_name || "",
        company_type: initialData.company_type || "Pvt Ltd",
        industry_type: initialData.industry_type || "Poultry Farming",
        registration_no: initialData.registration_no || "",
        tax_id: initialData.tax_id || "",
        tax_regime: initialData.tax_regime || "STANDARD",
        incorporation_date: initialData.incorporation_date || "",
        website: initialData.website || "",
        email_domain: initialData.email_domain || "",
        support_email: initialData.support_email || "",
        phone_primary: initialData.phone_primary || "",
        primary_color_hex: initialData.primary_color_hex || "#1F4E79",
        company_logo_url: initialData.company_logo_url || ""
      });
    }
  }, [initialData]);


  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    setLogoError("");

    try {
      const data = new FormData();
      data.append("file", file);

      const res = await api.upload("/setup/wizard/upload-logo", data);
      setLogoUrl(res.logoUrl);
      setFormData(prev => ({ ...prev, company_logo_url: res.logoUrl }));
    } catch (err: any) {
      setLogoError(err?.message || "Failed to upload logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleClearLogo = () => {
    setLogoUrl("");
    setFormData(prev => ({ ...prev, company_logo_url: "" }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const backendUrl = API_ORIGIN;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-(--text-primary) flex items-center gap-2">
          <Building2 className="w-5 h-5 text-(--text-muted)" />{t("wzStep1Title")}</h2>
        <p className="text-xs text-(--text-secondary)">{t("wzStep1Desc")}</p>
      </div>

      {/* ── Company Logo Upload Section ── */}
      <div className="p-4 rounded-[var(--radius-sm)] border border-(--border) bg-(--surface-raised) flex flex-col sm:flex-row items-center gap-4">
        <div className="w-20 h-20 rounded-[var(--radius-sm)] border border-dashed border-(--border) bg-(--input-bg) flex items-center justify-center overflow-hidden relative group shrink-0">
          {logoUrl ? (
            <img
              src={logoUrl.startsWith('/') ? `${backendUrl}${logoUrl}` : logoUrl}
              alt={t("ctCompanyLogoAlt")}
              className="w-full h-full object-contain p-1"
            />
          ) : (
            <ImageIcon className="w-8 h-8 text-(--text-muted)" />
          )}
        </div>

        <div className="flex flex-col gap-1.5 flex-1 w-full">
          <label className="text-xs font-semibold text-(--text-secondary)">{t("wzCompanyBrandLogo")}</label>
          <p className="text-[11px] text-(--text-secondary)">{t("wzLogoFormats")}</p>

          <div className="flex items-center gap-3 mt-1">
            <label className="nf-press cursor-pointer inline-flex min-h-9 items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-(--surface-secondary) text-(--text-primary) border border-(--border) text-xs font-semibold transition-colors hover:bg-(--border)">
              <Upload className="w-3.5 h-3.5" />
              {uploadingLogo ? "Uploading..." : logoUrl ? "Change Logo" : "Upload Logo"}
              <input
                type="file"
                accept="image/png, image/jpeg, image/svg+xml, image/webp"
                onChange={handleLogoUpload}
                disabled={uploadingLogo}
                className="hidden"
              />
            </label>

            {logoUrl && (
              <button
                type="button"
                onClick={handleClearLogo}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] bg-(--danger-muted) text-(--danger) border border-(--danger) text-xs font-semibold transition-colors hover:bg-(--danger) hover:text-white"
              >
                <X className="w-3.5 h-3.5" />{t("wzRemove")}</button>
            )}
          </div>

          {logoError && <p className="text-xs text-(--danger) mt-1">{logoError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("wzCompanyCodeShort")} htmlFor={fieldId("company_code")} required>
          <Input
            id={fieldId("company_code")}
            placeholder={t("wzPhCompanyCode")}
            value={formData.company_code}
            onChange={(e) => setFormData({ ...formData, company_code: e.target.value.toUpperCase() })}
            required
          />
        </Field>
        <Field label={t("ctLegalEntityName")} htmlFor={fieldId("company_name")} required>
          <Input
            id={fieldId("company_name")}
            placeholder={t("wzPhLegalName")}
            value={formData.company_name}
            onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
            required
          />
        </Field>
        <Field label={t("wzDisplayName")} htmlFor={fieldId("company_display_name")}>
          <Input
            id={fieldId("company_display_name")}
            placeholder={t("wzPhDisplayName")}
            value={formData.company_display_name}
            onChange={(e) => setFormData({ ...formData, company_display_name: e.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-(--text-secondary) font-medium">{t("wzBusinessClass")}</label>
          <Select
            value={formData.company_type}
            onChange={(e) => setFormData({ ...formData, company_type: e.target.value })}
            className="bg-(--input-bg) border border-(--input-border) rounded-[var(--radius-sm)] px-4 h-12 text-sm text-(--input-text) focus:border-(--input-border-focus)"
          >
            <option value="Sole Proprietor">{t("ctClsSoleProprietor")}</option>
            <option value="Partnership">{t("ctClsPartnership")}</option>
            <option value="Pvt Ltd">{t("ctClsPvtLtd")}</option>
            <option value="LLP">LLP</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-(--text-secondary) font-medium">{t("wzIndustryClassification")}</label>
          <Select
            value={formData.industry_type}
            onChange={(e) => setFormData({ ...formData, industry_type: e.target.value })}
            className="bg-(--input-bg) border border-(--input-border) rounded-[var(--radius-sm)] px-4 h-12 text-sm text-(--input-text) focus:border-(--input-border-focus)"
          >
            <option value="Poultry Farming">{t("coIndustryPoultryFarming")}</option>
            <option value="Livestock">{t("dashDefaultNob")}</option>
            <option value="Agriculture">{t("wzIndAgriCrop")}</option>
            <option value="Aquaculture">{t("wzIndAquaculture")}</option>
            <option value="Insect Farming">{t("wzIndInsectApiary")}</option>
            <option value="Feed & Processing">{t("wzIndFeedMill")}</option>
          </Select>
        </div>
        <Field label={t("wzRegCertificateNo")} htmlFor={fieldId("registration_no")}>
          <Input
            id={fieldId("registration_no")}
            placeholder={t("wzPhRegCertNo")}
            value={formData.registration_no}
            onChange={(e) => setFormData({ ...formData, registration_no: e.target.value })}
          />
        </Field>
        <Field label={t("wzTaxpayerIdGstin")} htmlFor={fieldId("tax_id")}>
          <Input
            id={fieldId("tax_id")}
            placeholder={t("wzPhTaxpayerId")}
            value={formData.tax_id}
            onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-(--text-secondary) font-medium">{t("ctTaxRegime")}</label>
          <Select
            value={formData.tax_regime}
            onChange={(e) => setFormData({ ...formData, tax_regime: e.target.value })}
            className="bg-(--input-bg) border border-(--input-border) rounded-[var(--radius-sm)] px-4 h-12 text-sm text-(--input-text) focus:border-(--input-border-focus)"
          >
            <option value="STANDARD">{t("ctSchemeStandard")}</option>
            <option value="COMPOSITION">{t("ctSchemeComposition")}</option>
            <option value="EXEMPT">{t("ctSchemeExempt")}</option>
          </Select>
        </div>
        <Field label={t("ctIncorporationDate")} htmlFor={fieldId("incorporation_date")}>
          <Input
            id={fieldId("incorporation_date")}
            type="date"
            value={formData.incorporation_date}
            onChange={(e) => setFormData({ ...formData, incorporation_date: e.target.value })}
          />
        </Field>
        <Field label={t("ctWebsiteUrl")} htmlFor={fieldId("website")}>
          <Input
            id={fieldId("website")}
            placeholder="https://greenvalleyfarms.in"
            value={formData.website}
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
          />
        </Field>
        <Field label={t("ctEmailDomainAutoVerify")} htmlFor={fieldId("email_domain")}>
          <Input
            id={fieldId("email_domain")}
            placeholder="greenvalleyfarms.in"
            value={formData.email_domain}
            onChange={(e) => setFormData({ ...formData, email_domain: e.target.value })}
          />
        </Field>
        <Field label={t("ctSupportEmail")} htmlFor={fieldId("support_email")}>
          <Input
            id={fieldId("support_email")}
            placeholder="support@greenvalleyfarms.in"
            type="email"
            value={formData.support_email}
            onChange={(e) => setFormData({ ...formData, support_email: e.target.value })}
          />
        </Field>
        <Field label={t("ctPrimaryPhoneLandline")} htmlFor={fieldId("phone_primary")}>
          <Input
            id={fieldId("phone_primary")}
            placeholder="+91 11 2345 6789"
            value={formData.phone_primary}
            onChange={(e) => setFormData({ ...formData, phone_primary: e.target.value })}
          />
        </Field>
      </div>
      <Button type="submit" disabled={isSubmitting || uploadingLogo} className="mt-4 self-end">
        {isSubmitting ? "Registering..." : "Save & Continue"}
      </Button>
    </form>
  );
}

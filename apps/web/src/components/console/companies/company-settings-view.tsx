"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Activity } from "lucide-react";
import { useCompaniesPageData } from "@/components/console/companies/use-companies-page-data";
import CompanyTab, { SETTINGS_SECTIONS } from "@/components/console/console-tabs/company-tab";
import { useContextNav, type ContextNavModel } from "@/components/shell/ContextNav";
import { useLanguage } from "@/hooks/useLanguage";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/PageHeader";

const S = {
  muted: { color: "var(--text-muted)" },
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

export function CompanySettingsView({ companyId, section = "profile", basePath = "/company/settings" }: { companyId: string; section?: string; basePath?: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, tenantId, companies, currencies, loading, error, reload } = useCompaniesPageData();
  const activeSection = SETTINGS_SECTIONS.find((sec) => sec.key === section) ?? SETTINGS_SECTIONS[0];

  // The sections belong in the console's own sub-sidebar, next to where Master
  // Data and Finance put theirs — not in a second sidebar drawn inside the
  // page. Same component, same place on screen, same behaviour.
  const contextNav = useMemo<ContextNavModel>(() => ({
    label: t("ctSettingsSections"),
    groups: [{ items: SETTINGS_SECTIONS.map((s) => ({ key: s.key, label: t(s.labelKey as any) })) }],
    activeKey: section,
    onSelect: (key: string) => router.push(`${basePath}/${key}`),
  }), [section, basePath, t, router]);
  useContextNav(contextNav);

  if (loading) return <LoadingState label={t("coLoadingCompanies")} />;

  const targetCompany = companies.find((c: any) => c.company_id === companyId);

  if (!targetCompany) {
    return (
      <div className="mx-auto max-w-2xl px-4 pb-8 sm:px-6 lg:px-7">
        <PageHeader title={t("coNotFoundTitle")} sticky={false} />
        <ErrorState message={t("coNotFoundDesc")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      {/* Everything identifying the page lives here, once. The section's own
          title and description used to be a card header below this, and the
          company's name and code a second card below that — three heading
          blocks before the first field.

          The title is the section — Profile, Address, Fiscal year — so the
          heading and the highlighted item in the sub-sidebar say the same
          word. It read "Company settings" on all six, which named the screen
          the user was already looking at and left the section identified only
          by a nav highlight.

          "Company settings" has not gone anywhere: it is the highlighted item
          in the main sidebar, one level up, which is exactly the level it
          belongs to.

          The company name is deliberately not in this header either: the
          breadcrumb above it and the company card in the main sidebar both
          already carry it.

          There is no "Back to All Companies" action. Leaving a company scope
          is what the scope switcher in the main sidebar is for, and it does
          strictly more than that button did: it switches to tenant scope, to
          any other company, or to an operational area, and it is present on
          every screen rather than only on this one. A second, weaker way out
          of the scope, sitting next to the permanent one, is a choice the user
          has to read before ignoring. Tenant scope carries /companies as a
          standing nav item, so the directory is still one control away. */}
      <PageHeader
        title={t(activeSection.labelKey)}
        description={t(activeSection.descKey)}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={S.muted}>
            <span className="font-mono">{targetCompany.company_code}</span>
            {targetCompany.registration_no && <span>{t("coRegLabel")} {targetCompany.registration_no}</span>}
            {targetCompany.country_id && <span>{targetCompany.country_id}</span>}
            <StatusBadge status={targetCompany.onboarding_status} t={t} />
          </div>
        }
        sticky={false}
      />

      {error && <ErrorState message={error} />}

      <CompanyTab
        activeCompany={targetCompany}
        currencies={Array.isArray(currencies) ? currencies : (currencies as any)?.data ?? []}
        tenantId={tenantId}
        onRefreshCompany={reload as any}
        companies={[targetCompany]}
        currentUser={user}
        onSelectCompany={(company: any) => void company}
        skipDirectory={true}
        section={section}
      />
    </div>
  );
}

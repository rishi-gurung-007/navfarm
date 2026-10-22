"use client";

import { useState } from "react";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { ShieldAlert } from "lucide-react";
import FarrowingReportPanel from "./farrowing-report-panel";

/**
 * The operational reports (Triple-C_reports COMMENTS.xlsx), one entry per report, each with its own view
 * permission (REPORTS / <key>). Exported so the sidebar builds its flyout from the same list, as Voucher does.
 */
export const REPORT_SECTIONS = [
  { key: "FARROWING", href: "/reports/farrowing", labelKey: "rptFarrowingReport", descriptionKey: "rptFarrowingDescription" },
] as const;

export type ReportKey = (typeof REPORT_SECTIONS)[number]["key"];

export function ReportPage({ reportKey }: { reportKey: ReportKey }) {
  const { t } = useLanguage();
  const [user] = useState(() => getStoredUser());
  const section = REPORT_SECTIONS.find((s) => s.key === reportKey) || REPORT_SECTIONS[0];

  const mayView = Boolean(user && hasPermission(user, "REPORTS", section.key, "can_view"));

  if (!user) return null;
  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={t(section.labelKey)} sticky={false} />
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5" style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{t("accessDeniedContactAdmin")}</p>
        </div>
      </ConsolePage>
    );
  }
  return (
    <ConsolePage>
      <PageHeader title={t(section.labelKey)} description={t(section.descriptionKey)} />
      <FarrowingReportPanel />
    </ConsolePage>
  );
}

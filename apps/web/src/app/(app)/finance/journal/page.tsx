"use client";

import { FinancePageShell } from "@/components/console/finance/finance-page-shell";
import JournalPanel from "@/components/console/finance/journal-panel";
import { InfoTip } from "@/components/ui/info-tip";
import { useLanguage } from "@/hooks/useLanguage";

export default function FinanceJournalPage() {
  const { t } = useLanguage();
  return (
    <FinancePageShell
      activeKey="journal"
      titleAddon={<InfoTip title={t("jpJournalEntries")}>{t("jpJournalEntriesDescription")}</InfoTip>}
    >
      <JournalPanel />
    </FinancePageShell>
  );
}

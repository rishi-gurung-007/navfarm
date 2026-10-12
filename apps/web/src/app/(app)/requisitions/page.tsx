"use client";

import RequisitionsHub from "@/components/console/requisitions/requisitions-hub";
import { ConsolePage } from "@/components/ui/console-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * Requisition — a top-level menu item (Rishi 5 Oct, docs/decisions.md). Item,
 * Fixed Asset and Service requisitions only; feed requisitions are on
 * Inventory -> Feed Forecast -> Requisition.
 */
export default function RequisitionsPage() {
  const { t } = useLanguage();

  return (
    <ConsolePage fill>
      <PageHeader title={t("navRequisition")} description={t("rhDesc")} sticky={false} />
      <RequisitionsHub />
    </ConsolePage>
  );
}

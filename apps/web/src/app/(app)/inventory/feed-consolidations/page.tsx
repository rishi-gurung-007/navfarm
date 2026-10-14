"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { useLanguage } from "@/hooks/useLanguage";
import { FeedConsolidationsPanel } from "@/components/console/inventory/feed-consolidations-panel";

export default function FeedConsolidationsPage() {
  const { t } = useLanguage();
  return (
    <InventoryPageShell activeKey="feed-forecast" title={t("invFeedConsolidations")}>
      <div className="p-6">
        <FeedConsolidationsPanel />
      </div>
    </InventoryPageShell>
  );
}

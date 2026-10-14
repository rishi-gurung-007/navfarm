"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { useLanguage } from "@/hooks/useLanguage";
import { FeedLoadingPanel } from "@/components/console/inventory/feed-loading-panel";

export default function FeedLoadingPage() {
  const { t } = useLanguage();
  return (
    <InventoryPageShell activeKey="feed-forecast" title={t("invFeedLoading")}>
      <div className="p-6">
        <FeedLoadingPanel />
      </div>
    </InventoryPageShell>
  );
}

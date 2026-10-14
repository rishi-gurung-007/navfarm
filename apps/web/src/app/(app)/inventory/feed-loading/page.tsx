"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { FeedLoadingPanel } from "@/components/console/inventory/feed-loading-panel";

export default function FeedLoadingPage() {
  return (
    <InventoryPageShell activeKey="feed-forecast">
      <div className="p-6">
        <FeedLoadingPanel />
      </div>
    </InventoryPageShell>
  );
}

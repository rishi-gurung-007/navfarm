"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { FeedConsolidationsPanel } from "@/components/console/inventory/feed-consolidations-panel";

export default function FeedConsolidationsPage() {
  return (
    <InventoryPageShell activeKey="feed-forecast">
      <div className="p-6">
        <FeedConsolidationsPanel />
      </div>
    </InventoryPageShell>
  );
}

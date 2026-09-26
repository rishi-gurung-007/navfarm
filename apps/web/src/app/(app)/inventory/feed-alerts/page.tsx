"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedAlertsPanel from "@/components/console/inventory/feed-alerts-panel";

export default function InventoryFeedAlertsPage() {
  return (
    <InventoryPageShell activeKey="feed-alerts">
      <FeedAlertsPanel />
    </InventoryPageShell>
  );
}

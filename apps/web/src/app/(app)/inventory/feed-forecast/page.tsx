"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedForecastPanel from "@/components/console/inventory/feed-forecast-panel";

export default function InventoryFeedForecastPage() {
  return (
    <InventoryPageShell activeKey="feed-forecast" fill>
      <FeedForecastPanel />
    </InventoryPageShell>
  );
}

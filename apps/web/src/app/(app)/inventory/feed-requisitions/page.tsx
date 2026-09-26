"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedRequisitionPanel from "@/components/console/inventory/feed-requisition-panel";

export default function InventoryFeedRequisitionsPage() {
  return (
    <InventoryPageShell activeKey="feed-requisitions">
      <FeedRequisitionPanel />
    </InventoryPageShell>
  );
}

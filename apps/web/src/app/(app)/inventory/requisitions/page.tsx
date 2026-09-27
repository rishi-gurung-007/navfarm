"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import RequisitionsPanel from "@/components/console/inventory/requisitions-panel";

export default function InventoryRequisitionsPage() {
  return (
    <InventoryPageShell activeKey="requisitions" fill>
      <RequisitionsPanel />
    </InventoryPageShell>
  );
}

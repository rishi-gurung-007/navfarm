"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import QcInspectionPanel from "@/components/console/inventory/qc-inspection-panel";

export default function InventoryQcInspectionPage() {
  return (
    <InventoryPageShell activeKey="qc-inspection">
      <QcInspectionPanel />
    </InventoryPageShell>
  );
}

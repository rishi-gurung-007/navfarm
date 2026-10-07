"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import ReceiveStockPanel from "@/components/console/inventory/receive-stock-panel";

export default function InventoryReceiveStockPage() {
  return (
    <InventoryPageShell activeKey="transfers">
      <ReceiveStockPanel />
    </InventoryPageShell>
  );
}

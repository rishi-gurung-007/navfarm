"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import InventoryLedgerPanel from "@/components/console/inventory/inventory-ledger-panel";

export default function InventoryLedgerPage() {
  return (
    <InventoryPageShell activeKey="ledger" showHeader={false}>
      <InventoryLedgerPanel />
    </InventoryPageShell>
  );
}

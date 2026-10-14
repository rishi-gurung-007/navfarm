"use client";

import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import BioAssetLedgerPanel from "@/components/console/inventory/bio-asset-ledger-panel";

export default function BioAssetLedgerPage() {
  return (
    <InventoryPageShell activeKey="bio-asset-ledger">
      <BioAssetLedgerPanel />
    </InventoryPageShell>
  );
}

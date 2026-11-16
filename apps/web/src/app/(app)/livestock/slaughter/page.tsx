"use client";

import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import SlaughterTransferPanel from "@/components/console/livestock/slaughter-transfer-panel";

export default function SlaughterTransfersPage() {
  return (
    <LivestockPageShell activeKey="slaughter">
      <SlaughterTransferPanel />
    </LivestockPageShell>
  );
}

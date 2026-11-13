"use client";

import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import AnimalScanPanel from "@/components/console/piggery/animal-scan-panel";

export default function LivestockScanPage() {
  return (
    <LivestockPageShell activeKey="scan">
      <AnimalScanPanel />
    </LivestockPageShell>
  );
}

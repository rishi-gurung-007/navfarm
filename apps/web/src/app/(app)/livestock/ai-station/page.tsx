"use client";

import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import { BreedingPanel } from "@/components/console/piggery/breeding-panel";

export default function PiggeryAiStationPage() {
  return (
    <LivestockPageShell activeKey="ai-station" hideTitle>
      <BreedingPanel section="ai-station" />
    </LivestockPageShell>
  );
}

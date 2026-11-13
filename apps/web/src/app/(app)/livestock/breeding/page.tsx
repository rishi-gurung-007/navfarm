"use client";

import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import { BreedingPanel } from "@/components/console/piggery/breeding-panel";

export default function PiggeryBreedingPage() {
  return (
    <LivestockPageShell activeKey="breeding" hideTitle>
      <BreedingPanel />
    </LivestockPageShell>
  );
}

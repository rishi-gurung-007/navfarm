"use client";

import { LivestockPageShell } from "@/components/console/livestock/livestock-page-shell";
import FacilityOccupancyPanel from "@/components/console/piggery/facility-occupancy-panel";

export default function PiggeryFacilityOccupancyPage() {
  return (
    <LivestockPageShell activeKey="facility" hideTitle>
      <FacilityOccupancyPanel />
    </LivestockPageShell>
  );
}

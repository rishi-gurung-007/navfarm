"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import EntryWorkspace from "@/components/console/production/entry/entry-workspace";
import DairyDailyOperationsEntry from "@/components/console/dairy/dairy-daily-operations-entry";

export default function BatchDataEntryPage() {
  return (
    <ProductionPageShell titleKey="batchDataEntry">
      {/* Piggery enters through the stage-aware workspace: a stage overview, one
          workspace per stage, and the days rail. Dairy keeps its own screen. */}
      {(activeLob) => (activeLob === "DAIRY" ? <DairyDailyOperationsEntry /> : <EntryWorkspace />)}
    </ProductionPageShell>
  );
}

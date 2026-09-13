"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import SchedulerBatchDataEntry from "@/components/console/production/scheduler-batch-data-entry";
import DairyDailyOperationsEntry from "@/components/console/dairy/dairy-daily-operations-entry";

export default function BatchDataEntryPage() {
  return (
    <ProductionPageShell titleKey="batchDataEntry">
      {/* Piggery enters against its scheduler: only what the schedule calls
          for, in the order the day is owed. The old free-form screen let
          anyone add any activity, which is the opposite of the rule. */}
      {(activeLob) => (activeLob === "DAIRY" ? <DairyDailyOperationsEntry /> : <SchedulerBatchDataEntry />)}
    </ProductionPageShell>
  );
}

"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import OperationalBatchDataEntry from "@/components/console/production/operational-batch-data-entry";
import DairyDailyOperationsEntry from "@/components/console/dairy/dairy-daily-operations-entry";

export default function BatchDataEntryPage() {
  return (
    <ProductionPageShell titleKey="batchDataEntry">
      {(activeLob) => (activeLob === "DAIRY" ? <DairyDailyOperationsEntry /> : <OperationalBatchDataEntry />)}
    </ProductionPageShell>
  );
}

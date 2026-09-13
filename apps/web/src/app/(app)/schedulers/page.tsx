"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import SchedulerListPanel from "@/components/console/production/scheduler-list-panel";

export default function SchedulersPage() {
  return (
    <ProductionPageShell titleKey="navSchedulers">
      {() => <SchedulerListPanel />}
    </ProductionPageShell>
  );
}

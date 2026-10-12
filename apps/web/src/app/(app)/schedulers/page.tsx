"use client";

import { useState } from "react";
import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import SchedulerListPanel from "@/components/console/production/scheduler-list-panel";
import SystemSchedulerListPanel from "@/components/console/production/system-scheduler-list-panel";
import { Tabs } from "@/components/ui/tabs";
import { useLanguage } from "@/hooks/useLanguage";

type SchedulerTab = "current" | "system";

/** "Active" lists the batch-linked schedulers (one per batch per stage);
 * "Draft" lists the system schedulers — the per-stage templates a batch is offered to copy. */
function SchedulersTabs() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<SchedulerTab>("current");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={[
          { value: "system", label: t("schTabDraft") },
          { value: "current", label: t("schTabActive") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as SchedulerTab)}
        panelId="schedulers-tab-panel"
      />
      <div id="schedulers-tab-panel" role="tabpanel">
        {tab === "current" ? <SchedulerListPanel /> : <SystemSchedulerListPanel />}
      </div>
    </div>
  );
}

export default function SchedulersPage() {
  return (
    <ProductionPageShell titleKey="navSchedulers">
      {() => <SchedulersTabs />}
    </ProductionPageShell>
  );
}

"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import AlertPanel from "@/components/console/production/alert-panel";

export default function ProductionAlertsPage() {
  return (
    <ProductionPageShell titleKey="navAlerts" fill>
      {() => <AlertPanel />}
    </ProductionPageShell>
  );
}

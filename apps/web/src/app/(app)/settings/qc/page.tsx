"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import QcParameterPanel from "@/components/console/production/qc-parameter-panel";

export default function ProductionQcParametersPage() {
  return (
    <ProductionPageShell titleKey="navQcParameters" alsoAllow={[["PRODUCTION", "QC_PARAMETER"]]}>
      {() => <QcParameterPanel />}
    </ProductionPageShell>
  );
}

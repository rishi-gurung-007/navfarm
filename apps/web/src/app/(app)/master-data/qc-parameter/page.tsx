"use client";

import { ProductionPageShell } from "@/components/console/production/production-page-shell";
import QcParameterPanel from "@/components/console/production/qc-parameter-panel";

// The QC Parameter Master, under Master Data because the item card's QC Specification picks its checks from it (client, 9 Nov).
// /settings/qc renders the same panel for links made before it moved.
export default function MasterDataQcParametersPage() {
  return (
    <ProductionPageShell titleKey="navQcParameters" alsoAllow={[["PRODUCTION", "QC_PARAMETER"]]}>
      {() => <QcParameterPanel />}
    </ProductionPageShell>
  );
}

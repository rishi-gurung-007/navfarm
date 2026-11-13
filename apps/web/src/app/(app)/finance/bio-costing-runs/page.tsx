"use client";

import { FinancePageShell } from "@/components/console/finance/finance-page-shell";
import BioCostingRunsPanel from "@/components/console/finance/bio-costing-runs-panel";

export default function FinanceBioCostingRunsPage() {
  return (
    <FinancePageShell activeKey="bio-costing-runs">
      <BioCostingRunsPanel />
    </FinancePageShell>
  );
}

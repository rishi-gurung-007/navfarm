"use client";

import { FinancePageShell } from "@/components/console/finance/finance-page-shell";
import BioCostingSetupPanel from "@/components/console/finance/bio-costing-setup-panel";

export default function FinanceBioCostingSetupPage() {
  return (
    <FinancePageShell activeKey="bio-costing-setup">
      <BioCostingSetupPanel />
    </FinancePageShell>
  );
}

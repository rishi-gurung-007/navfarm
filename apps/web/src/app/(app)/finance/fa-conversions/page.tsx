"use client";

import { FinancePageShell } from "@/components/console/finance/finance-page-shell";
import FaConversionsPanel from "@/components/console/finance/fa-conversions-panel";

export default function FinanceFaConversionsPage() {
  return (
    <FinancePageShell activeKey="fa-conversions">
      <FaConversionsPanel />
    </FinancePageShell>
  );
}

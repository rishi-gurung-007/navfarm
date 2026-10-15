"use client";

import { useState } from "react";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { ShieldAlert } from "lucide-react";
import ExpensePanel from "./expense-panel";

/**
 * Expense Voucher is recorded and listed only; Expense posts to the ledger (Arun, 15 Oct). Petty Cash is an Expense
 * whose paid-from account is a petty cash GL — the manager's voucher format has no separate type.
 * Exported so the sidebar builds its flyout from the same list.
 */
export const EXPENSE_SECTIONS = [
  { key: "EXPENSE", href: "/expenses/expense", labelKey: "expExpenseVoucher", posts: true },
] as const;

export type ExpenseDocType = (typeof EXPENSE_SECTIONS)[number]["key"];

export function ExpensePage({ docType }: { docType: ExpenseDocType }) {
  const { t } = useLanguage();
  const [user] = useState(() => getStoredUser());
  const section = EXPENSE_SECTIONS.find((s) => s.key === docType) || EXPENSE_SECTIONS[0];

  const mayView = Boolean(
    user && (user.userType === "OPERATIONAL_ADMIN" || user.userType === "COMPANY_ADMIN" || user.userType === "TENANT_ADMIN" || hasPermission(user, "FINANCE", section.key, "can_view"))
  );
  const mayCreate = Boolean(
    user && (user.userType === "OPERATIONAL_ADMIN" || user.userType === "COMPANY_ADMIN" || user.userType === "TENANT_ADMIN" || hasPermission(user, "FINANCE", section.key, "can_create"))
  );

  if (!user) return null;
  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={t(section.labelKey)} sticky={false} />
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5" style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-semibold">{t("accessDeniedContactAdmin")}</p>
        </div>
      </ConsolePage>
    );
  }
  return (
    <ConsolePage>
      <PageHeader title={t(section.labelKey)} description={t("expPostsDescription")} />
      <ExpensePanel docType={section.key} posts={section.posts} mayCreate={mayCreate} />
    </ConsolePage>
  );
}

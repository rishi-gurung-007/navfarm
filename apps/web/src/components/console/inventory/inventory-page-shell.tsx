"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, hasPermission, NavUser, getActiveWorkspaceScope, getActiveLob } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Tabs } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { ShieldAlert } from "lucide-react";

const INVENTORY_SECTIONS = [
  { key: "balance", href: "/inventory/balance", labelKey: "invStockBalance" },
  { key: "feed-forecast", href: "/inventory/feed-forecast", labelKey: "invFeedForecast" },
  { key: "goods-receipt", href: "/inventory/goods-receipt", labelKey: "invGoodsReceipt" },
  { key: "transfers", href: "/inventory/transfers", labelKey: "invTransfers" },
  { key: "goods-issue", href: "/inventory/goods-issue", labelKey: "invGoodsIssue" },
  { key: "stock-adjustment", href: "/inventory/stock-adjustment", labelKey: "invStockAdjustment" },
  { key: "ledger", href: "/inventory/ledger", labelKey: "invLedger" },
] as const;

export type InventoryTabKey = (typeof INVENTORY_SECTIONS)[number]["key"];

function useInventoryPageState() {
  const router = useRouter();
  // Session state comes from localStorage and is available on the first
  // render. Resolving it in an effect left ready=false for a commit, which
  // registered the module index as null and made the sub-navigation blank and
  // refill on every page change.
  const [user, setUser] = useState<NavUser | null>(() => getStoredUser());
  const [ready, setReady] = useState(() => Boolean(getStoredUser()));
  const [scope, setScope] = useState(() => getActiveWorkspaceScope());
  const [activeLob, setActiveLobState] = useState(() => getActiveLob());

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setScope(getActiveWorkspaceScope());
    setActiveLobState(getActiveLob());
    setReady(true);
  }, [router]);

  const mayView = Boolean(
    user && (
      user.userType === "OPERATIONAL_ADMIN" ||
      user.userType === "COMPANY_ADMIN" ||
      user.userType === "TENANT_ADMIN" ||
      user.userType === "SYSTEM_ADMIN" ||
      hasPermission(user, "INVENTORY", "GOODS_RECEIPT", "can_view") ||
      hasPermission(user, "INVENTORY", "STOCK_COUNT", "can_view") ||
      hasPermission(user, "INVENTORY", "STOCK_TRANSFER", "can_view") ||
      hasPermission(user, "INVENTORY", "STOCK_ADJUSTMENT", "can_view") ||
      hasPermission(user, "INVENTORY", "LEDGER", "can_view") ||
      hasPermission(user, "INVENTORY", "GOODS_ISSUE", "can_view") ||
      hasPermission(user, "PROCUREMENT", "REQUISITION", "can_view")
    )
  );

  return { ready, scope, activeLob, mayView };
}

export function InventoryPageShell({ activeKey, fill = false, children }: { activeKey: InventoryTabKey; fill?: boolean; children: React.ReactNode }) {
  const { t, tLob } = useLanguage();
  const router = useRouter();
  const { ready, scope, activeLob, mayView } = useInventoryPageState();

  if (!ready) return null;

  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={t("invModuleTitle")} sticky={false} />
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5" style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("invAccessDeniedTitle")}</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{t("accessDeniedContactAdmin")}</p>
          </div>
        </div>
      </ConsolePage>
    );
  }

  const title =
    activeKey === "feed-forecast" ? t("invFeedForecastTitle") :
    activeKey === "goods-receipt" ? t("invGoodsReceiptTitle") :
    activeKey === "transfers" ? t("invTransfersTitle") :
    activeKey === "goods-issue" ? t("invGoodsIssueTitle") :
    activeKey === "stock-adjustment" ? t("invStockAdjustmentTitle") :
    activeKey === "ledger" ? t("invLedgerTitle") :
    scope === "OPERATIONAL" ? t("invUnitBalanceTitle", { lob: tLob(activeLob) }) : t("invCompanyBalanceTitle");

  const description =
    activeKey === "feed-forecast" ? t("invFeedForecastDesc") :
    scope === "OPERATIONAL" ? t("invOperationalDesc", { lob: tLob(activeLob) }) : t("invCompanyDesc");

  const tabsNode = (
    <Tabs
      items={INVENTORY_SECTIONS.map((s) => ({
        value: s.key,
        label: t(s.labelKey as any),
      }))}
      value={activeKey}
      onChange={(key) => {
        const target = INVENTORY_SECTIONS.find((s) => s.key === key);
        if (target) router.push(target.href);
      }}
      className="mb-4"
    />
  );

  return (
    // Plan S: a feed screen holds its header and filters still; only its table scrolls.
    <ConsolePage fill={fill}>
      <PageHeader title={title} description={description} sticky={!fill} />
      {tabsNode}
      {children}
    </ConsolePage>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, hasPermission, NavUser, getActiveLob } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { ShieldAlert } from "lucide-react";

/**
 * Shared by every /production/* route (this used to be one mega-page
 * switching content via ?tab=, each tab is now its own route — this holds
 * the boilerplate that was duplicated across all of them: auth/permission
 * gate, active LOB, and the page shell chrome).
 */
/** A [module, resource] pair whose view grant also opens the page. */
export type ExtraGrant = [moduleCode: string, resource: string];

export function useProductionPageState(alsoAllow: ExtraGrant[] = []) {
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);
  const [activeLob, setActiveLobState] = useState("PIGGERY");

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setActiveLobState(getActiveLob());
    setReady(true);
  }, [router]);

  const mayView = Boolean(
    user && (
      user.userType === "OPERATIONAL_ADMIN" ||
      user.userType === "COMPANY_ADMIN" ||
      user.userType === "TENANT_ADMIN" ||
      hasPermission(user, "PRODUCTION", "BATCH", "can_view") ||
      alsoAllow.some(([moduleCode, resource]) => hasPermission(user, moduleCode, resource, "can_view"))
    )
  );

  return { user, ready, activeLob, mayView };
}

export function ProductionPageShell({
  titleKey,
  fill = false,
  descriptionKey,
  alsoAllow,
  children,
}: {
  /** Translation key, not a literal — every Production route used to pass an
      English string, so these titles stayed English in every other language. */
  titleKey: TranslationKeys;
  /** Plan S: fixed-height page; only its table scrolls. */
  fill?: boolean;
  /**
   * A page's own subtitle. Without one the shell's generic operational-area
   * line is used, which read wrongly on Alerts ("Lifecycle tracking, batch
   * feed & health logs…" under a list of alerts). Opt-in, so every other
   * Production page keeps the line it has.
   */
  descriptionKey?: TranslationKeys;
  /**
   * Further view grants that open this page (F1, review I1). The shell's own
   * gate is PRODUCTION/BATCH, which is right for a batch screen; Alerts also
   * holds feed alerts, and a store or feed role reaches them with
   * INVENTORY/LEDGER and no batch grant at all. Opt-in, so no other
   * Production page is widened.
   */
  alsoAllow?: ExtraGrant[];
  children: (activeLob: string) => React.ReactNode;
}) {
  const { ready, activeLob, mayView } = useProductionPageState(alsoAllow);
  const { t, tLob } = useLanguage();
  const title = t(titleKey);

  if (!ready) return null;

  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={title} sticky={false} />
        <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5" style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("ppsAccessDeniedTitle")}</p>
            <p className="mt-1 text-xs">{t("ppsAccessDeniedDesc")}</p>
          </div>
        </div>
      </ConsolePage>
    );
  }

  return (
    <ConsolePage fill={fill}>
      <PageHeader
        title={title}
        description={descriptionKey ? t(descriptionKey) : t("ppsPageDescription", { lob: tLob(activeLob) })}
        sticky={!fill}
      />
      {children(activeLob)}
    </ConsolePage>
  );
}

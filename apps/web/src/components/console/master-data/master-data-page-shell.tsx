"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, NavUser, getActiveCompanyId, getActiveWorkspaceScope, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { MASTER_DATA_CONFIGS, MASTER_DATA_GROUPS, getConfig } from "@/modules/master-data/configs";
import type { MasterDataConfig } from "@/modules/master-data/types";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import { useContextNav, type ContextNavModel } from "@/components/shell/ContextNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { Tabs } from "@/components/ui/tabs";
import { ShieldAlert } from "lucide-react";


const S = {
  sub: { color: "var(--text-secondary)" },
};

function useMasterDataPageState() {
  const router = useRouter();
  // The session lives in localStorage, so it is available synchronously on the
  // first render. Resolving it in an effect instead meant this shell mounted
  // with user=null and ready=false, and the module index — which is static
  // configuration and never depended on either — was registered as null for a
  // commit before appearing. That is what made the sub-navigation visibly
  // empty and refill on every page change.
  const [user, setUser] = useState<NavUser | null>(() => getStoredUser());
  const [ready, setReady] = useState(() => Boolean(getStoredUser()));
  const scopeKey = `${getActiveWorkspaceScope()}-${getActiveCompanyId() || ""}-${getActiveOperationalAreaId() || ""}`;

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setReady(true);
  }, [router]);

  const mayView =
    user?.userType === "COMPANY_ADMIN" ||
    user?.userType === "SYSTEM_ADMIN" ||
    user?.userType === "TENANT_ADMIN" ||
    user?.userType === "OPERATIONAL_ADMIN";

  return { ready, user, mayView, scopeKey };
}

export function MasterDataPageShell({ activeKey }: { activeKey: string }) {
  const router = useRouter();
  const { t, tLabel } = useLanguage();
  const { ready, user, mayView, scopeKey } = useMasterDataPageState();
  // Old bookmarks must not reopen independent Farm/Shed/Warehouse creation.
  // Their persistence remains for historical operational references.
  const legacyLocation = ["farm", "shed", "warehouse"].includes(activeKey);
  const activeConfig: MasterDataConfig = getConfig(legacyLocation ? "location" : activeKey) || MASTER_DATA_CONFIGS.find((c) => c.isPrimary)!;
  useEffect(() => {
    if (legacyLocation) router.replace("/master-data/location");
  }, [legacyLocation, router]);
  const parentConfig = (activeConfig.tabOf && getConfig(activeConfig.tabOf)) || activeConfig;
  const tabConfigs = MASTER_DATA_CONFIGS.filter((c) => c.tabOf === parentConfig.key);
  const parentKey = parentConfig.key;

  const contextNav = useMemo<ContextNavModel | null>(() => {
    if (!ready || !mayView) return null;
    return {
      label: t("moduleSections", { module: t("masterData") }),
      groups: MASTER_DATA_GROUPS.map((group) => ({
        label: tLabel(group),
        items: MASTER_DATA_CONFIGS
          .filter((c) => c.group === group && c.isPrimary)
          .map((c) => ({ key: c.key, label: tLabel(c.label) })),
      })).filter((g) => g.items.length > 0),
      activeKey: parentKey,
      onSelect: (key) => router.push(`/master-data/${key}`),
    };
  }, [ready, mayView, parentKey, t, tLabel, router]);

  useContextNav(contextNav);

  if (!ready || !user) return null;

  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={t("masterData")} sticky={false} />
        <div
          className="flex items-center gap-3 rounded-[var(--radius-md)] border p-5"
          style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}
        >
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("masterDataAccessDeniedTitle")}</p>
            <p className="mt-1 text-xs" style={S.sub}>{t("masterDataAccessDeniedDesc", { type: user.userType.replace(/_/g, " ").toLowerCase() })}</p>
          </div>
        </div>
      </ConsolePage>
    );
  }

  const tabsNode = tabConfigs.length > 0 ? (
    <Tabs
      panelId="master-data-sheet"
      items={[parentConfig, ...tabConfigs].map((config) => ({
        value: config.key,
        label: tLabel(config.tabLabel || config.label),
      }))}
      value={activeConfig.key}
      onChange={(key) => router.push(`/master-data/${key}`)}
    />
  ) : undefined;

  return (
    <ConsolePage>
      <div id="master-data-sheet" role={tabConfigs.length ? "tabpanel" : undefined} aria-label={tLabel(activeConfig.tabLabel || activeConfig.label)}>
        <MasterDataTable
          key={`${activeConfig.key}-${scopeKey}`}
          config={activeConfig}
          showHeader={true}
          tabs={tabsNode}
        />
      </div>
    </ConsolePage>
  );
}

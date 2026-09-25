"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Users,
  ShieldAlert,
  History,
  Bell,
  Database,
  Boxes,
  Landmark,
  LogOut,
  RefreshCw,
  Layers,
  Wheat,
  Pill,
  CheckSquare,
  Settings,
  AlertTriangle,
  Package,
  CalendarClock,
  Gauge,
} from "lucide-react";
import {
  getStoredUser,
  getStoredToken,
  getStoredTenantId,
  updateStoredUser,
  clearSession,
  getActiveCompanyId,
  setActiveCompanyId,
  getActiveWorkspaceScope,
  setActiveWorkspaceScope,
  getActiveLob,
  NavUser,
} from "../../hooks/useAuth";
import { useLanguage } from "../../hooks/useLanguage";
import { api } from "../../services/api-client";
import OnboardingWizard from "../../components/console/onboarding-wizard";
import WorkspaceScopeSwitcher from "../../components/console/workspace-scope-switcher";
import { LanguageSelector } from "../../components/ui/language-selector";
import { AppShell, AppShellNavItem } from "../../components/shell/AppShell";
import { ContextNavProvider } from "../../components/shell/ContextNav";
import { PROFILE_ITEMS } from "../../components/shell/ProfilePopover";
import { ThemeIconButton } from "../../components/shell/ThemeIconButton";
import { resolveLobFamily } from "@/lib/lob";
import { LIVESTOCK_SECTIONS } from "@/components/console/livestock/livestock-page-shell";
import { MASTER_DATA_CONFIGS, MASTER_DATA_NAV_ORDER } from "@/modules/master-data/configs";

export default function ConsoleLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, tLob, tLabel } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);

  // Onboarding wizard state
  const [checkingOnboard, setCheckingOnboard] = useState(true);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [activeCompany, setActiveCompany] = useState<any>(null);
  const [wizardSteps, setWizardSteps] = useState<any[]>([]);
  const [activeWizardStep, setActiveWizardStep] = useState(1);
  const [languages, setLanguages] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [timezones, setTimezones] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [nobs, setNobs] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setWizardError] = useState("");
  const [, setWizardSuccess] = useState("");

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tenantId = getStoredTenantId();
    if (!token || !storedUser) { router.replace("/"); return; }
    if (storedUser.userType === "SYSTEM_ADMIN") { router.replace("/admin/tenants"); return; }

    const storedActiveId = getActiveCompanyId();
    const homeId = storedUser.companyId || (storedUser as any).company_id;
    const initialActiveId = storedActiveId || homeId || null;

    // Strict role scope check on load:
    const activeScope = getActiveWorkspaceScope();
    if (storedUser.userType !== "TENANT_ADMIN" && activeScope === "TENANT") {
      setActiveWorkspaceScope("COMPANY");
    }

    if (initialActiveId && initialActiveId !== homeId) {
      const patched = updateStoredUser({ companyId: initialActiveId, company_id: initialActiveId });
      setUser(patched || storedUser);
    } else {
      setUser(storedUser);
    }

    if (initialActiveId && !storedActiveId) setActiveCompanyId(initialActiveId);

    if (tenantId) {
      api.get(`/tenant/${tenantId}`).catch(() => {});
    }
    checkOnboardingStatus(
      initialActiveId && initialActiveId !== homeId
        ? { ...storedUser, companyId: initialActiveId, company_id: initialActiveId }
        : storedUser,
      tenantId ?? ""
    );
  }, [router]);

  const checkOnboardingStatus = async (storedUser: NavUser, tenantId: string) => {
    if (!tenantId) { setCheckingOnboard(false); setReady(true); return; }
    // Completing the setup wizard (legal entity details, registration numbers,
    // NOB/LOB, admin registration) is a company-admin task — a standard user's
    // role typically doesn't even grant COMPANY.SETTINGS.view, so the company
    // list fetch below 403s for them regardless of whether their company is
    // actually onboarded. That used to fall into the catch-all below and get
    // misread as "not onboarded", incorrectly routing already-active staff
    // into the wizard. Standard users never need this gate: by the time an
    // admin can invite one, the company they're being added to already exists
    // and (in normal use) is already set up.
    if (storedUser.userType === "STANDARD_USER" || storedUser.userType === "OPERATIONAL_ADMIN") {
      setIsOnboarded(true);
      setCheckingOnboard(false);
      setReady(true);
      return;
    }
    try {
      const companiesList = await api.get(`/company/tenant/${tenantId}`);
      let filtered = companiesList;

      // Always use active company ID as the source of truth
      const activeId = getActiveCompanyId() ||
        storedUser.companyId ||
        (storedUser as any).company_id;

      if (storedUser.userType !== "TENANT_ADMIN") {
        filtered = companiesList.filter((c: any) => c.company_id === activeId);
        if (filtered.length === 0) filtered = companiesList; // fallback
      }
      if (filtered.length === 0) {
        setIsOnboarded(false);
        setActiveWizardStep(1);
      } else {
        const comp = companiesList.find((c: any) => c.company_id === activeId) || filtered[0];
        setActiveCompany(comp);
        if (comp.onboarding_status === "COMPLETED") {
          setIsOnboarded(true);
        } else {
          setIsOnboarded(false);
          const steps = await api.get(`/setup/wizard/status/${comp.company_id}`);
          setWizardSteps(steps);
          const firstPending = steps.find((s: any) => s.status !== "COMPLETED" && s.isMandatory);
          setActiveWizardStep(firstPending ? firstPending.stepOrder : 8);
        }
      }
      const [langList, currList, tzList, countryList, nobList] = await Promise.all([
        api.get("/language").then((r: any) => r?.data ?? r).catch(() => []),
        api.get("/currency").then((r: any) => r?.data ?? r).catch(() => []),
        api.get("/timezone").then((r: any) => r?.data ?? r).catch(() => []),
        // /country now answers with the shared list envelope, like every
        // other master; take the rows out of it.
        api.get("/country").then((r: any) => r?.data ?? r).catch(() => []),
        api.get("/setup/wizard/nobs").then((r: any) => r?.data ?? r).catch(() => []),
      ]);
      setLanguages(langList);
      setCurrencies(currList);
      setTimezones(tzList);
      setCountries(countryList);
      setNobs(nobList);
    } catch (err: any) {
      // Never infer "not onboarded" from a failure. The wizard is destructive to
      // show over a configured company — it hides the whole console behind a
      // setup form — so it needs positive evidence that setup is incomplete,
      // which only the success path above can give. Two failures used to land
      // here and both rendered the wizard: a 403 for a role that cannot read
      // /company/tenant/:id (an operator or supervisor), and a 400 for a stale
      // session whose tenant no longer exists after the database was reseeded.
      const status = err?.status ?? err?.response?.status;
      const message = String(err?.message ?? '');

      // A session pointing at a tenant that is gone is not recoverable by
      // waiting — sign out and let them log in again rather than stranding
      // them in a setup wizard for a company they are not even scoped to.
      const staleSession =
        status === 401 || message.includes('Tenant connection context') || message.includes('not found');

      if (staleSession && status !== 403) {
        clearSession();
        router.replace('/');
        return;
      }

      setIsOnboarded(true);
    } finally {
      setCheckingOnboard(false);
      setReady(true);
    }
  };

  const reloadConsole = async () => {
    const tenantId = getStoredTenantId() ?? "";
    const storedUser = getStoredUser();
    if (!storedUser) return;
    setCheckingOnboard(true);
    await checkOnboardingStatus(storedUser, tenantId);
  };

  const handleLogout = () => { clearSession(); router.replace("/"); };

  const Spinner = () => (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg)" }}>
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        <RefreshCw className="animate-spin w-4 h-4" style={{ color: "var(--accent)" }} />{t("gLoadingWorkspace")}</div>
    </div>
  );

  if (!ready || !user) return <Spinner />;
  if (checkingOnboard) return <Spinner />;

  // Onboarding wizard guard
  if (!isOnboarded) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "var(--bg)", color: "var(--text-primary)" }}>
        <header className="h-14 flex items-center px-4 sm:px-6 shrink-0 border-b" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            NAV<span style={{ color: "var(--accent)" }}>Farm</span>
          </span>
          <span className="ml-2 hidden text-xs font-semibold uppercase tracking-widest px-2 py-0.5 rounded-[var(--radius-xs)] sm:inline-flex" style={{ color: "var(--text-muted)", backgroundColor: "var(--surface-raised)" }}>{t("gCompanySetup")}</span>
          <div className="ml-auto flex items-center gap-3">
            <ThemeIconButton />
            <button onClick={handleLogout} aria-label={t("signOut")} className="text-sm flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 sm:px-3" style={{ color: "var(--text-secondary)" }}>
              <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">{t("signOut")}</span>
            </button>
          </div>
        </header>
        <OnboardingWizard
          wizardSteps={wizardSteps}
          activeWizardStep={activeWizardStep}
          setActiveWizardStep={setActiveWizardStep}
          activeCompany={activeCompany}
          setActiveCompany={setActiveCompany}
          tenantId={getStoredTenantId() ?? ""}
          languages={languages}
          currencies={currencies}
          timezones={timezones}
          countries={countries}
          nobs={nobs}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          setActionError={setWizardError}
          setActionSuccess={setWizardSuccess}
          fetchWizardProgress={async (companyId: string) => {
            const steps = await api.get(`/setup/wizard/status/${companyId}`);
            setWizardSteps(steps);
          }}
          loadConsoleWorkspace={reloadConsole}
        />
      </div>
    );
  }

  // Tenant Admin's company-scoped tabs (Master Data/Inventory/Finance/Production/
  const activeScope = getActiveWorkspaceScope();
  const activeLob = getActiveLob();
  // One resolution point — nav labels must agree with what every page decides.
  const lobFamily = resolveLobFamily(activeLob);

  // Defined once and used by both company and operational scope: the same page
  // reached from two scopes must be called the same thing and offer the same
  // children. See specs/nav-scope-consistency.spec.ts.
  const batchChildren = [
    { label: t("batchList"), href: "/batches" },
    // { label: t("batchStages"), href: "/batches/stages" },
    { label: t("navBatchAnimals"), href: "/batches/animals" },
    { label: t("navBatchEntry"), href: "/batches/entry" },
    { label: t("navBatchRecords"), href: "/batches/records" },
    { label: t("navBatchTransfers"), href: "/batches/transfers" },
  ];
  const livestockChildren = LIVESTOCK_SECTIONS.map((section) => ({
    label:
      section.key === "register" && lobFamily === "DAIRY"
        ? t("dairyCowRegister")
        : t(section.labelKey),
    href: section.href,
  }));
  // Same list master-data-page-shell.tsx used to render as its own docked
  // column — folded into the primary nav's hover flyout instead, in the
  // client-requested order (MASTER_DATA_NAV_ORDER), so there is exactly one
  // place a master's link lives rather than two.
  const masterDataChildren = MASTER_DATA_CONFIGS.filter((c) => c.isPrimary)
    .sort((a, b) => {
      const ai = MASTER_DATA_NAV_ORDER.indexOf(a.key);
      const bi = MASTER_DATA_NAV_ORDER.indexOf(b.key);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map((c) => ({ label: tLabel(c.label), href: `/master-data/${c.key}` }));

  let navItems: AppShellNavItem[] = [];

  if (activeScope === "TENANT") {
    navItems = [
      { label: t("dashboard"),       href: "/dashboard",      icon: LayoutDashboard },
      { label: t("execDashboard"),   href: "/executive-dashboard", icon: Gauge },
      { label: t("companies"),       href: "/companies",      icon: Building2 },
      { label: t("masterData"),      href: "/master-data",    icon: Database, activePrefix: "/master-data", children: masterDataChildren, flyout: true },
      { label: t("teamManagement"),  href: "/users",          icon: Users },
      { label: t("auditLedger"),     href: "/audit",          icon: History },
      { label: t("notifications"),   href: "/notifications",  icon: Bell, activePrefix: "/notifications" },
    ];
  } else if (activeScope === "COMPANY") {
    navItems = [
      { label: t("companyDashboard"), href: "/dashboard",      icon: LayoutDashboard },
      { label: t("execDashboard"),    href: "/executive-dashboard", icon: Gauge },
      // The work-shaped spine first, in the order an operational area lists it,
      // then the company's own entities. Master Data used to sit 4th here and
      // 10th in an area, Batches 7th and 2nd, Livestock 8th and 4th — so what
      // you learned in one scope was wrong in the other, over the same routes.
      // specs/nav-scope-consistency.spec.ts locks the relative order of every
      // route two scopes share; each scope still keeps its own items.
      { label: t("navBatches"), href: "/batches", icon: Wheat, activePrefix: "/batches", children: batchChildren },
      // Schedulers is a company-scope entry too now, not operational-only. It
      // sits next to Batches in both, because a scheduler belongs to a batch
      // and a stage — which is exactly what the shared-order spec is for.
      { label: t("navSchedulers"), href: "/schedulers", icon: CalendarClock, activePrefix: "/schedulers" },
      { label: t("navLivestock"), href: "/livestock", icon: Pill, children: livestockChildren },
      { label: t("inventoryStock"), href: "/inventory/balance", icon: Boxes, activePrefix: "/inventory" },
      { label: t("financeCosting"), href: "/finance/journal", icon: Landmark, activePrefix: "/finance" },
      { label: t("masterData"),      href: "/master-data",    icon: Database, activePrefix: "/master-data", children: masterDataChildren, flyout: true },
      // A company is the entity under the tenant; an operational area is only a
      // scope for one LOB inside it. Neither is grouped under Settings — they
      // are not the same kind of thing as the three area configuration screens
      // that operational scope collects there.
      { label: t("operationalAreas"), href: "/operational-areas", icon: Layers },
      { label: t("teamManagement"),  href: "/users",          icon: Users },
      { label: t("rolePermissions"), href: "/roles",          icon: ShieldAlert },
      { label: t("notifications"),   href: "/notifications",  icon: Bell, activePrefix: "/notifications" },
      {
        label: t("settings"),
        href: "/company/settings",
        icon: Settings,
        children: [
          { label: t("companySettings"), href: "/company/settings" },
          { label: t("navInventorySetup"), href: "/settings/inventory-setup" },
        ],
      },
    ];
  } else {
    /**
     * OPERATIONAL area scope.
     *
     * Grouped the way the work actually runs, not the way the backend modules
     * were laid out. Everything in an operational area revolves around a
     * batch, so Batches is the first group and owns the whole batch lifecycle
     * — stages, its animals, daily entry, the record log, and the transfers
     * that end a cycle. Livestock is the animal-centric family beside it.
     * Settings collects the three configuration screens that were previously
     * scattered across /production/* and a top-level /area-settings.
     *
     * Labels come from the LOB where the LOB actually changes the meaning
     * (the register is "Cow Register" for Dairy), so a new line of business
     * reads correctly without a new nav tree.
     */
    navItems = [
      { label: t("lobDashboard", { lob: tLob(activeLob) }), href: "/dashboard", icon: LayoutDashboard },
      { label: t("execDashboard"), href: "/executive-dashboard", icon: Gauge },
      {
        label: t("navBatches"),
        href: "/batches",
        // Wheat in both scopes. Batches carried Wheat in company scope and
        // Layers here, while Layers is also Operational Areas' icon — so one
        // item had two icons and one icon meant two items.
        icon: Wheat,
        children: batchChildren,
      },
      {
        label: t("navSchedulers"),
        href: "/schedulers",
        icon: CalendarClock,
        activePrefix: "/schedulers",
      },
      {
        label: t("navLivestock"),
        href: "/livestock",
        icon: Pill,
        // Rendered from the shell's own section list so the sidebar and the
        // routes can never drift apart. Dairy calls its register something
        // else, and that is the only per-LOB override.
        children: livestockChildren,
      },
      { label: t("inventoryStock"), href: "/inventory/balance", icon: Boxes, activePrefix: "/inventory" },
      { label: t("financeCosting"), href: "/finance/journal", icon: Landmark, activePrefix: "/finance" },
      { label: t("navAlerts"), href: "/alerts", icon: AlertTriangle },
      { label: t("navTraceability"), href: "/traceability", icon: Package },
      { label: t("approvals"), href: "/approvals", icon: CheckSquare, activePrefix: "/approvals" },
      { label: t("masterData"), href: "/master-data", icon: Database, activePrefix: "/master-data", children: masterDataChildren, flyout: true },
      {
        label: t("settings"),
        href: "/settings/area",
        icon: Settings,
        children: [
          { label: t("navSettingsArea"), href: "/settings/area" },
          { label: t("navParameters"), href: "/settings/parameters" },
          { label: t("navQcParameters"), href: "/settings/qc" },
        ],
      },
    ];
  }

  const sidebarSummary = (
    <WorkspaceScopeSwitcher onScopeChanged={() => window.location.reload()} />
  );

  const initials = user?.fullName
    ? user.fullName
        .split(" ")
        .map((p: string) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  const breadcrumbLabel =
    activeScope === "TENANT"
      ? "Tenant Workspace"
      : activeScope === "COMPANY"
      ? activeCompany?.company_name || "Company Workspace"
      : `${activeLob || "Operational"} Area`;

  const headerRight = (
    <span className="hidden shrink-0 sm:inline-flex"><LanguageSelector /></span>
  );

  return (
    // The module index is a shell region — it has to sit outside <main> to hold
    // still while the content scrolls — but which sections exist is page state.
    // The provider is the seam: routes register an index, the shell renders it.
    // Routes that register nothing stay full-width, which is every route
    // outside Master Data, Inventory, Finance and Production.
    <>
      <ContextNavProvider>
        {(contextNav) => (
          <AppShell
            brandHref="/dashboard"
            brandSubtitle="Management console"
            sidebarSummary={sidebarSummary}
            navSectionLabel="Organization"
            navItems={navItems}
            pathname={pathname}
            userInitials={initials}
            userName={user.fullName}
            userEmail={user.email}
            onLogout={handleLogout}
            signOutLabel={t("signOut")}
            profileItems={PROFILE_ITEMS.map((key) => ({ label: t(key), href: key === "account" ? "/account/profile" : "/account/settings" }))}
            profileMenuLabel={t("accountMenu")}
            breadcrumbRoot="NAVFarm"
            breadcrumbCurrent={breadcrumbLabel}
            headerRight={headerRight}
            contextNav={contextNav}
          >
            {children}
          </AppShell>
        )}
      </ContextNavProvider>
      {modal}
    </>
  );
}

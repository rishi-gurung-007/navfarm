"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Building, Layers, Database, History,
  ShieldCheck,
  LayoutDashboard,
} from "lucide-react";
import { getStoredUser, getStoredToken, clearSession, NavUser } from "../../hooks/useAuth";
import { useLanguage } from "../../hooks/useLanguage";
import { LanguageSelector } from "../../components/ui/language-selector";
import { AppShell } from "../../components/shell/AppShell";
import { PROFILE_ITEMS } from "../../components/shell/ProfilePopover";

const adminNavItems = [
  { label: "Dashboard",   key: "dashboard" as const,   href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Tenants",     key: "tenants" as const,     href: "/admin/tenants", icon: Building  },
  { label: "Plans",       key: "plans" as const,       href: "/admin/plans",   icon: Layers    },
  { label: "Master Data", key: "masterData" as const,  href: "/admin/masters", icon: Database  },
  { label: "Audit Logs",  key: "auditLogs" as const,   href: "/admin/audit",   icon: History   },
];

export default function AdminLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (!token || !storedUser) { router.replace("/"); return; }
    if (storedUser.userType !== "SYSTEM_ADMIN") { router.replace("/dashboard"); return; }
    setUser(storedUser);
    setReady(true);
  }, [router]);

  const handleLogout = () => { clearSession(); router.replace("/"); };

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg)" }}>
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>{t("admAuthorizingSession")}</div>
      </div>
    );
  }

  const initials = user.fullName?.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase() || "SA";

  const sidebarSummary = (
    <div className="rounded-[var(--radius-sm)] border border-white/10 bg-white/[0.05] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-white/40">{t("admAccessLevel")}</span>
        <ShieldCheck className="h-3.5 w-3.5 text-white/50" />
      </div>
      <p className="mt-1 text-sm font-semibold text-white">{t("systemAdmin")}</p>
    </div>
  );

  const headerRight = (
    <>
      <LanguageSelector />
      {/* Theme control lives in the ProfilePopover now, not the header.
          Identity moved there too — the name is in the menu's heading
          rather than duplicated in the header. */}
    </>
  );

  return (
    <>
      <AppShell
        brandHref="/admin/dashboard"
        brandSubtitle="Platform administration"
        sidebarSummary={sidebarSummary}
        navSectionLabel={t("admin")}
        navItems={adminNavItems.map((i) => ({ label: t(i.key), href: i.href, icon: i.icon }))}
        pathname={pathname}
        userInitials={initials}
        userName={user.fullName}
        userEmail={user.email}
        onLogout={handleLogout}
        signOutLabel={t("signOut")}
        profileItems={PROFILE_ITEMS.map((key) => ({ label: t(key), href: key === "account" ? "/account/profile" : "/account/settings" }))}
        profileMenuLabel={t("accountMenu")}
        headerRight={headerRight}
      >
        {children}
      </AppShell>
      {modal}
    </>
  );
}

"use client";

import { NA } from "@/utils/na";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building,
  Layers,
  History,
  Plus,
  Database,
  Activity,
  ArrowUpRight
} from "lucide-react";
import { api } from "../../../services/api-client";
import { getStoredToken, getStoredUser } from "../../../hooks/useAuth";
import { useLanguage } from "../../../hooks/useLanguage";
import { LoadingState, ErrorState } from "../../../components/ui/states";
import { Badge } from "../../../components/ui/badge";
import { PageHeader } from "../../../components/ui/PageHeader";

const S = {
  surface:  { backgroundColor: "var(--surface)",        borderColor: "var(--border)" },
  raised:   { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary:  { color: "var(--text-primary)" },
  sub:      { color: "var(--text-secondary)" },
  muted:    { color: "var(--text-muted)" },
  accent:   { color: "var(--accent)" },
  border:   { borderColor: "var(--border)" },
  input:    { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [tenants, setTenants] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    if (!token || !storedUser || storedUser.userType !== "SYSTEM_ADMIN") {
      router.replace("/");
      return;
    }
    loadData();
  }, [router]);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [tenantsList, plansList, logsList] = await Promise.all([
        api.get("/tenant"),
        api.get("/plan"),
        api.get("/audit-log").catch(() => []),
      ]);
      setTenants(Array.isArray(tenantsList) ? tenantsList : []);
      setPlans(Array.isArray(plansList) ? plansList : []);
      setAuditLogs(Array.isArray(logsList) ? logsList.slice(0, 5) : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingState label={t("admLoadingStats")} />;
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} />
      </div>
    );
  }

  // Calculate metrics
  const totalTenants = tenants.length;
  const activeTenants = tenants.filter((t) => t.is_active !== false).length;
  const inactiveTenants = totalTenants - activeTenants;

  // Group tenants by plan
  const planDistribution: Record<string, number> = {};
  tenants.forEach((t) => {
    const pCode = t.plan_id || "UNCONFIGURED";
    planDistribution[pCode] = (planDistribution[pCode] || 0) + 1;
  });

  const getPlanPercentage = (count: number) => {
    if (totalTenants === 0) return 0;
    return (count / totalTenants) * 100;
  };

  const actionBadgeVariant = (action: string): "success" | "warning" | "danger" | "info" => {
    const act = action?.toUpperCase() || "";
    if (act.includes("CREATE") || act.includes("REGISTER")) return "success";
    if (act.includes("UPDATE") || act.includes("EDIT") || act.includes("ASSIGN")) return "warning";
    if (act.includes("DELETE") || act.includes("REMOVE") || act.includes("REVOKE")) return "danger";
    return "info";
  };

  const actionBadge = (action: string) => (
    <Badge variant={actionBadgeVariant(action)} className="rounded-[var(--radius-xs)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide font-mono">
      {action}
    </Badge>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 pb-4 sm:px-6 sm:pb-6 xl:px-8 xl:pb-8">
      <PageHeader
        title={t("controlTowerDashboard")}
        description={t("platformWideSaaSAnalytics")}
      />

      {/* Summary strip — one bordered surface with hairline dividers between
          segments, not four separate cards competing for attention. */}
      <div
        className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-md)] border sm:grid-cols-2 lg:grid-cols-4"
        style={{ backgroundColor: "var(--border)", borderColor: "var(--border)" }}
      >
        {/* Total Tenants */}
        <div className="p-4" style={S.surface}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("registeredTenants")}</span>
            <Building className="w-4 h-4" style={S.accent} />
          </div>
          <div className="text-2xl font-semibold" style={S.primary}>{totalTenants}</div>
          <div className="mt-2 text-xs flex items-center gap-2" style={S.sub}>
            <span className="font-semibold" style={{ color: "var(--success)" }}>{activeTenants} {t("active")}</span>
            <span className="opacity-40">·</span>
            <span className="font-semibold" style={S.muted}>{inactiveTenants} {t("inactive")}</span>
          </div>
        </div>

        {/* Total Pricing Plans */}
        <div className="p-4" style={S.surface}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("pricingPlans")}</span>
            <Layers className="w-4 h-4" style={S.accent} />
          </div>
          <div className="text-2xl font-semibold" style={S.primary}>{plans.length}</div>
          <div className="mt-2 text-xs" style={S.sub}>
            {t("activeSaaSTierPlans")}
          </div>
        </div>

        {/* Database Health */}
        <div className="p-4" style={S.surface}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("controlPlaneHost")}</span>
            <Database className="w-4 h-4" style={S.accent} />
          </div>
          <div className="text-base font-semibold truncate" style={S.primary}>localhost:3306</div>
          <div className="mt-2 text-xs flex items-center gap-1.5" style={S.sub}>
            <span className="w-2 h-2 rounded-full animate-pulse inline-block" style={{ backgroundColor: "var(--success)" }} />
            <span className="font-semibold" style={{ color: "var(--success)" }}>{t("sqlConnectionsHealthy")}</span>
          </div>
        </div>

        {/* Platform Uptime */}
        <div className="p-4" style={S.surface}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("platformUptime")}</span>
            <Activity className="w-4 h-4" style={S.accent} />
          </div>
          <div className="text-2xl font-semibold" style={{ color: "var(--success)" }}>99.98%</div>
          <div className="mt-2 text-xs" style={S.sub}>
            {t("continuousTelemetry")}
          </div>
        </div>
      </div>

      {/* Plan breakdown paired with recent signups in one bordered surface —
          a divider carries the grouping instead of two adjacent cards. */}
      <div className="grid grid-cols-1 overflow-hidden rounded-[var(--radius-lg)] border lg:grid-cols-3" style={S.surface}>

        {/* Plan Breakdown */}
        <div className="lg:col-span-1 border-b p-5 space-y-5 lg:border-b-0 lg:border-r" style={S.border}>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider" style={S.sub}>{t("tenantSubscriptionShare")}</h3>
            <p className="text-xs" style={S.muted}>{t("planDistributionAcrossActive")}</p>
          </div>

          <div className="space-y-4">
            {plans.map((p) => {
              const count = planDistribution[p.plan_id] || 0;
              const pct = getPlanPercentage(count);
              return (
                <div key={p.plan_id} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span style={S.primary}>{p.plan_name}</span>
                    <span style={S.sub}>{count} tenant{count !== 1 ? "s" : ""} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={S.raised}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: p.plan_id === "SYSTEM_PLAN" ? "var(--color-navy)" : "var(--accent)"
                      }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Platform Signups */}
        <div className="lg:col-span-2">
          <div className="px-6 py-4 border-b flex items-center justify-between" style={S.border}>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider" style={S.sub}>{t("recentTenantRegistrations")}</h3>
              <p className="text-xs" style={S.muted}>{t("newlyOnboardedEntities")}</p>
            </div>
            <Link href="/admin/tenants" className="text-xs font-semibold hover:underline flex items-center gap-1" style={S.accent}>
              {t("viewAll")} <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y" style={S.border}>
            {tenants.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm" style={S.muted}>{t("noTenantsRegistered")}</div>
            ) : (
              tenants.slice(-4).reverse().map((tItem) => (
                <div key={tItem.tenant_id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap hover:bg-(--surface-raised) transition-colors">
                  <div>
                    <div className="text-sm font-semibold" style={S.primary}>{tItem.tenant_name}</div>
                    <div className="text-xs font-mono" style={S.muted}>{tItem.tenant_code} · {tItem.billing_email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-semibold border px-2.5 py-0.5 rounded-[var(--radius-pill)]"
                      style={{ backgroundColor: "var(--accent-muted)", color: "var(--accent)", borderColor: "var(--accent)" }}>
                      {tItem.plan_id?.replace("PLAN_", "") || NA}
                    </span>
                    <span className="text-[11px] font-semibold" style={tItem.is_active !== false ? { color: "var(--success)" } : S.muted}>
                      {tItem.is_active !== false ? t("active") : t("inactive")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Management controls paired with the audit feed in one bordered
          surface; controls are a plain list of destinations, not four cards. */}
      <div className="grid grid-cols-1 overflow-hidden rounded-[var(--radius-lg)] border lg:grid-cols-3" style={S.surface}>

        {/* Management Controls */}
        <div className="lg:col-span-1 border-b p-3 lg:border-b-0 lg:border-r" style={S.border}>
          <h3 className="px-2 pt-1.5 pb-2 text-xs font-semibold uppercase tracking-wider" style={S.muted}>{t("managementControls")}</h3>
          {[
            { label: t("addNewTenant"), icon: Plus, href: "/admin/tenants", desc: t("provisionNewDbAdmin") },
            { label: t("configurePricingPlans"), icon: Layers, href: "/admin/plans", desc: t("manageQuotasRates") },
            { label: t("masterRegistries"), icon: Database, href: "/admin/masters", desc: t("seedGlobalStaticCatalogs") },
            { label: t("complianceAuditLogs"), icon: History, href: "/admin/audit", desc: t("platformSecurityActivity") }
          ].map((action) => (
            <Link key={action.label} href={action.href}
              className="nf-press flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-3 transition-colors hover:bg-(--surface-raised)">
              <action.icon className="w-4 h-4 shrink-0" style={S.muted} />
              <div className="min-w-0">
                <div className="text-sm font-semibold" style={S.primary}>{action.label}</div>
                <div className="text-xs mt-0.5 truncate" style={S.sub}>{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Audit Log Feed */}
        <div className="lg:col-span-2">
          <div className="px-6 py-4 border-b flex items-center justify-between" style={S.border}>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider" style={S.sub}>{t("platformAuditFeed")}</h3>
              <p className="text-xs" style={S.muted}>{t("recentMutationsSystem")}</p>
            </div>
            <Link href="/admin/audit" className="text-xs font-semibold hover:underline flex items-center gap-1" style={S.accent}>
              {t("fullHistory")} <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="divide-y" style={S.border}>
            {auditLogs.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm" style={S.muted}>{t("noEventsRecorded")}</div>
            ) : (
              auditLogs.map((log, index) => (
                <div key={log.audit_id || index} className="px-6 py-3.5 flex items-center justify-between gap-4 flex-wrap hover:bg-(--surface-raised) transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {actionBadge(log.action)}
                      <span className="text-xs font-semibold" style={S.primary}>{log.entity_name}</span>
                    </div>
                    <div className="text-xs" style={S.sub}>
                      {t("mutatedBy")} <span className="font-semibold" style={S.primary}>{log.user_name || t("system")}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-mono" style={S.muted}>
                      {log.created_at ? new Date(log.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : NA}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}

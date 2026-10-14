"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";

interface DashboardData {
  metadata: {
    tenantName: string;
    companyName: string;
    nobCode: string;
    periodCode: string;
    periodStartDate: string;
    periodEndDate: string;
    isPeriodActive: boolean;
  };
  impactSummary: {
    pigletsWeanedPerSowPerYear: number;
    divisionLiveBirths: number;
    preWeanLossCount: number;
    preWeanLossPct: number;
    mortalitySavingsExtraPigs: number;
    cycleIndexGapExtraPigs: number;
    activeBreedingFemales: number;
  };
  coreKpis: {
    avgSowsPresent: { value: number; delta: string; target: number; sparkline: number[] };
    avgGiltsPresent: { value: number; delta: string; totalBreeding: number; sparkline: number[] };
    cycleIndex: { value: number; delta: string; target: number; sparkline: number[] };
    bornAlivePerLitter: { value: number; delta: string; benchmark: number; sparkline: number[] };
    farrowingRatePct: { value: number; delta: string; target: number; sparkline: number[] };
    preWeanMortalityPct: { value: number; delta: string; target: number; sparkline: number[] };
    femaleMortalityPct: { value: number; delta: string; target: number; sparkline: number[] };
    avgCycleLengthDays: { value: number; delta: string; gestationDays: number; sparkline: number[] };
  };
  cycleAnatomy: {
    gestationDays: number;
    lactationDays: number;
    weanToServiceDays: number;
    emptyDays: number;
    totalCycleDays: number;
    metrics: {
      weanToService: { value: number; target: number; status: string };
      lactationDays: { value: number; target: number; status: string };
      cullRatePct: { value: number; target: number; status: string };
      firstLittersPct: { value: number; target: number; status: string };
    };
  };
  parityDistribution: {
    p1: { count: number; pct: number };
    p2: { count: number; pct: number };
    p3: { count: number; pct: number };
    p4: { count: number; pct: number };
    p5: { count: number; pct: number };
    p6: { count: number; pct: number };
    p7Plus: { count: number; pct: number };
    firstLitterPct: number;
  };
  farmScorecard: Array<{
    farmId: string;
    farmCode: string;
    farmName: string;
    sowsCount: number;
    giltsCount: number;
    cycleIndex: number;
    bornAlivePerLitter: number;
    farrowingRatePct: number;
    weanToServiceDays: number;
    preWeanMortalityPct: number;
    femaleMortalityPct: number;
    aiStatus: "Active" | "Partial" | "Inactive";
    status: "On Track" | "Watch" | "Critical";
  }>;
  divisionTotals: {
    sowsCount: number;
    giltsCount: number;
    cycleIndex: number;
    bornAlivePerLitter: number;
    farrowingRatePct: number;
    weanToServiceDays: number;
    preWeanMortalityPct: number;
    femaleMortalityPct: number;
    status: string;
  };
}

export default function PiggeryGmDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const companyId = getActiveCompanyId();

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
      const res = await api.get(`/piggery/analytics/gm-dashboard${qs}`);
      const payload = res?.data ?? res;
      setData(payload);
    } catch (err: any) {
      setError(err?.message || "Failed to load Piggery GM Dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Loading Piggery GM Telemetry...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-red-500/20 bg-red-500/10 p-6 text-center text-xs text-red-600">
        <AlertTriangle className="mx-auto h-6 w-6 text-red-500" />
        <p className="mt-2 font-semibold">Unable to display GM Dashboard</p>
        <p className="mt-1 text-[var(--text-secondary)]">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 rounded-[var(--radius-pill)] bg-[var(--accent)] px-4 py-1.5 font-semibold text-white shadow-sm hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }

  const { impactSummary, coreKpis, cycleAnatomy, parityDistribution, farmScorecard, divisionTotals, metadata } = data;

  return (
    <div className="space-y-6">
      {/* ── Executive Header Banner ── */}
      <div className="rounded-[var(--radius-lg)] bg-[#0f172a] p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              {metadata.tenantName} · {metadata.companyName} · NOB: {metadata.nobCode} · Zimbabwe
            </div>
            <h2 className="mt-1 font-serif text-xl font-bold tracking-tight text-white md:text-2xl">
              Piggery GM Dashboard — Period {metadata.periodCode}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Rolling Operational Period: {metadata.periodStartDate} → {metadata.periodEndDate} · NAVFarm In-House Telemetry
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
              3 Critical Actions
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Born Alive {coreKpis.bornAlivePerLitter.value} — Best Period
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/20 px-3 py-1 text-xs font-semibold text-blue-300">
              NAVFarm Core Synced
            </span>
          </div>
        </div>
      </div>

      {/* ── Business Impact Summary Strip ── */}
      <div>
        <div className="mb-2 text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
          Business Impact Summary · Period {metadata.periodCode}
        </div>
        <div className="grid grid-cols-1 divide-y divide-white/10 rounded-[var(--radius-lg)] bg-gradient-to-br from-[#0f172a] to-[#1e3a8a] p-5 text-white sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          <div className="px-4 py-2 first:pl-0">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Piglets Weaned / Sow / Year
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-tight">
              {impactSummary.pigletsWeanedPerSowPerYear}
            </div>
            <p className="mt-1 text-[11px] text-slate-300">
              {coreKpis.bornAlivePerLitter.value} born alive × {Number(100 - impactSummary.preWeanLossPct).toFixed(1)}% survival ·{" "}
              <strong className="text-white">+7 above avg</strong>
            </p>
          </div>

          <div className="px-4 py-2">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Division Live Births / Period
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-tight">
              {impactSummary.divisionLiveBirths.toLocaleString()}
            </div>
            <p className="mt-1 text-[11px] text-slate-300">
              Across active sow herd · Pre-wean losses: <strong className="text-amber-300">{impactSummary.preWeanLossCount.toLocaleString()} ({impactSummary.preWeanLossPct}%)</strong>
            </p>
          </div>

          <div className="px-4 py-2">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              Mortality Savings at 7.5% Tgt
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-tight text-emerald-400">
              +{impactSummary.mortalitySavingsExtraPigs}
            </div>
            <p className="mt-1 text-[11px] text-slate-300">
              extra pigs per period · <strong className="text-white">+1,812/yr</strong> recoverable
            </p>
          </div>

          <div className="px-4 py-2 last:pr-0">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
              CI Gap Opportunity (→ 2.50)
            </div>
            <div className="mt-1 font-mono text-3xl font-bold tracking-tight text-amber-300">
              +{impactSummary.cycleIndexGapExtraPigs}
            </div>
            <p className="mt-1 text-[11px] text-slate-300">
              extra pigs/year · Unlocked by optimizing service protocols
            </p>
          </div>
        </div>
      </div>

      {/* ── 8 Core KPI Tiles ── */}
      <div>
        <div className="mb-2 text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
          Core KPIs · Period {metadata.periodCode} vs Baseline · Benchmarked
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {/* 1. Avg Sows */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Avg Sows</div>
            <div className="mt-1 font-mono text-2xl font-bold">{coreKpis.avgSowsPresent.value.toLocaleString()}</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.avgSowsPresent.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-blue-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "var(--accent)" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">{coreKpis.avgSowsPresent.delta}</span>
              <span className="text-[var(--text-muted)]">Tgt {coreKpis.avgSowsPresent.target}</span>
            </div>
          </div>

          {/* 2. Avg Gilts */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-purple-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Avg Gilts</div>
            <div className="mt-1 font-mono text-2xl font-bold">{coreKpis.avgGiltsPresent.value.toLocaleString()}</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.avgGiltsPresent.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-purple-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#7c3aed" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">{coreKpis.avgGiltsPresent.delta}</span>
              <span className="text-[var(--text-muted)]">Tot {coreKpis.avgGiltsPresent.totalBreeding}</span>
            </div>
          </div>

          {/* 3. Cycle Index */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Cycle Index</div>
            <div className="mt-1 font-mono text-2xl font-bold">{coreKpis.cycleIndex.value}</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.cycleIndex.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-amber-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#f59e0b" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-amber-600">{coreKpis.cycleIndex.delta}</span>
              <span className="text-[var(--text-muted)]">Tgt {coreKpis.cycleIndex.target}</span>
            </div>
          </div>

          {/* 4. Born Alive */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Born Alive</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{coreKpis.bornAlivePerLitter.value}</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.bornAlivePerLitter.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-emerald-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#10b981" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">{coreKpis.bornAlivePerLitter.delta}</span>
              <span className="text-[var(--text-muted)]">Ind. {coreKpis.bornAlivePerLitter.benchmark}</span>
            </div>
          </div>

          {/* 5. Farrowing Rate */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Farr Rate</div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{coreKpis.farrowingRatePct.value}%</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.farrowingRatePct.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-emerald-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#10b981" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-slate-500">{coreKpis.farrowingRatePct.delta}</span>
              <span className="text-[var(--text-muted)]">Tgt {coreKpis.farrowingRatePct.target}%</span>
            </div>
          </div>

          {/* 6. Pre-Wean Mortality */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Pre-Wn Mort</div>
            <div className="mt-1 font-mono text-2xl font-bold text-amber-600">{coreKpis.preWeanMortalityPct.value}%</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.preWeanMortalityPct.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-amber-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#f59e0b" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">{coreKpis.preWeanMortalityPct.delta}</span>
              <span className="text-[var(--text-muted)]">&lt;{coreKpis.preWeanMortalityPct.target}%</span>
            </div>
          </div>

          {/* 7. Female Mortality */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">F. Mortality</div>
            <div className="mt-1 font-mono text-2xl font-bold text-rose-600">{coreKpis.femaleMortalityPct.value}%</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.femaleMortalityPct.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-rose-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "#ef4444" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-emerald-600">{coreKpis.femaleMortalityPct.delta}</span>
              <span className="text-[var(--text-muted)]">&lt;{coreKpis.femaleMortalityPct.target}%</span>
            </div>
          </div>

          {/* 8. Avg Cycle Length */}
          <div className="relative overflow-hidden rounded-[var(--radius-md)] border p-3.5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
            <div className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Cycle Days</div>
            <div className="mt-1 font-mono text-2xl font-bold">{coreKpis.avgCycleLengthDays.value}d</div>
            <div className="mt-2 flex items-end gap-1 h-6">
              {coreKpis.avgCycleLengthDays.sparkline.map((h, i) => (
                <div key={i} className="flex-1 rounded-t-xs bg-blue-500/30" style={{ height: `${h}%`, backgroundColor: i === 4 ? "var(--accent)" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px]">
              <span className="font-semibold text-slate-500">{coreKpis.avgCycleLengthDays.delta}</span>
              <span className="text-[var(--text-muted)]">Gest {coreKpis.avgCycleLengthDays.gestationDays}d</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Cycle Anatomy & Parity Profile Section ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Cycle Anatomy */}
        <div className="rounded-[var(--radius-lg)] border p-5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold">Sow Reproductive Cycle Anatomy — Period {metadata.periodCode}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Avg {cycleAnatomy.totalCycleDays} days per cycle · Target ≤148d · Wean-to-service is the prime lever
          </p>

          {/* Stacked bar */}
          <div className="mt-4 flex h-8 w-full overflow-hidden rounded-md text-[10px] font-bold text-white shadow-xs">
            <div style={{ width: "77.5%" }} className="flex items-center justify-center bg-blue-600 px-1">
              Gestation · {cycleAnatomy.gestationDays}d
            </div>
            <div style={{ width: "17.8%" }} className="flex items-center justify-center bg-cyan-600 px-1">
              Lact. {cycleAnatomy.lactationDays}d
            </div>
            <div style={{ width: "2.9%" }} className="flex items-center justify-center bg-amber-500 px-1">
              W→S
            </div>
            <div style={{ width: "1.8%" }} className="flex items-center justify-center bg-rose-600 px-1">
              ∅
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-blue-600" />Gestation {cycleAnatomy.gestationDays}d</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-cyan-600" />Lactation {cycleAnatomy.lactationDays}d</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-amber-500" />Wean→Svc {cycleAnatomy.weanToServiceDays}d</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-xs bg-rose-600" />Empty ~{cycleAnatomy.emptyDays}d</span>
          </div>

          <div className="mt-4 space-y-2.5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between text-xs">
              <span className="w-32 text-[var(--text-secondary)]">Wean → Service</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-amber-500" style={{ width: "86%" }} />
              </div>
              <span className="w-14 text-right font-mono font-bold text-amber-600">{cycleAnatomy.metrics.weanToService.value}d</span>
              <span className="w-12 text-right text-[10px] text-[var(--text-muted)]">Tgt {cycleAnatomy.metrics.weanToService.target}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="w-32 text-[var(--text-secondary)]">Lactation Days</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-blue-500" style={{ width: "100%" }} />
              </div>
              <span className="w-14 text-right font-mono font-bold text-blue-600">{cycleAnatomy.metrics.lactationDays.value}d</span>
              <span className="w-12 text-right text-[10px] text-[var(--text-muted)]">Tgt {cycleAnatomy.metrics.lactationDays.target}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="w-32 text-[var(--text-secondary)]">% Culled / Year</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-amber-500" style={{ width: "95%" }} />
              </div>
              <span className="w-14 text-right font-mono font-bold text-amber-600">{cycleAnatomy.metrics.cullRatePct.value}%</span>
              <span className="w-12 text-right text-[10px] text-[var(--text-muted)]">Tgt {cycleAnatomy.metrics.cullRatePct.target}%</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="w-32 text-[var(--text-secondary)]">% First Litters</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-purple-500" style={{ width: "65%" }} />
              </div>
              <span className="w-14 text-right font-mono font-bold text-purple-600">{cycleAnatomy.metrics.firstLittersPct.value}%</span>
              <span className="w-12 text-right text-[10px] text-[var(--text-muted)]">Tgt {cycleAnatomy.metrics.firstLittersPct.target}%</span>
            </div>
          </div>
        </div>

        {/* Right: Parity Distribution & Herd Structure */}
        <div className="rounded-[var(--radius-lg)] border p-5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold">Herd Composition & Parity Structure</h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            Parity profile drives lifetime productivity · High 1st-litter % indicates replacement intensity
          </p>

          <div className="mt-4 flex items-end gap-2 h-24 border-b pb-2" style={{ borderColor: "var(--border)" }}>
            {[
              { label: "P1", pct: parityDistribution.p1.pct, color: "bg-purple-600" },
              { label: "P2", pct: parityDistribution.p2.pct, color: "bg-blue-600" },
              { label: "P3", pct: parityDistribution.p3.pct, color: "bg-emerald-600" },
              { label: "P4", pct: parityDistribution.p4.pct, color: "bg-emerald-600" },
              { label: "P5", pct: parityDistribution.p5.pct, color: "bg-emerald-600" },
              { label: "P6", pct: parityDistribution.p6.pct, color: "bg-amber-500" },
              { label: "P7+", pct: parityDistribution.p7Plus.pct, color: "bg-rose-500" },
            ].map((p) => (
              <div key={p.label} className="flex flex-1 flex-col items-center gap-1 h-full justify-end">
                <span className="text-[10px] font-mono text-[var(--text-muted)]">{p.pct}%</span>
                <div className={`w-full rounded-t-sm ${p.color}`} style={{ height: `${Math.max(p.pct * 3.5, 6)}%` }} />
                <span className="text-[10px] font-semibold">{p.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase">Multiplier Supply Output</div>
              <div className="mt-1 font-mono text-lg font-bold text-blue-600">2 / wk</div>
              <div className="text-[10px] text-[var(--text-secondary)]">From Multiplier Farm = 104 gilts/yr</div>
            </div>
            <div className="rounded-md border border-rose-500/20 bg-rose-500/10 p-3">
              <div className="text-[9px] font-bold text-rose-600 uppercase">Annual Replacement Demand</div>
              <div className="mt-1 font-mono text-lg font-bold text-rose-600">~48%</div>
              <div className="text-[10px] text-rose-700 dark:text-rose-300">~1,033 replacements required/yr</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Farm Scorecard Table ── */}
      <div className="rounded-[var(--radius-lg)] border p-5 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Full Farm Performance Scorecard — Period {metadata.periodCode}</h3>
            <p className="text-xs text-[var(--text-secondary)]">All Colcom Group Production Sites · Telemetry Sourced</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {farmScorecard.length} Farms Operational
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] font-semibold uppercase text-[var(--text-muted)]" style={{ borderColor: "var(--border)" }}>
                <th className="py-2.5 px-3">Farm Name</th>
                <th className="py-2.5 px-3 text-right">Sows</th>
                <th className="py-2.5 px-3 text-right">Gilts</th>
                <th className="py-2.5 px-3 text-right">CI</th>
                <th className="py-2.5 px-3 text-right">Born Alive</th>
                <th className="py-2.5 px-3 text-right">Farr %</th>
                <th className="py-2.5 px-3 text-right">W→Svc</th>
                <th className="py-2.5 px-3 text-right">Pre-Wn Mort</th>
                <th className="py-2.5 px-3 text-right">F.Mort %</th>
                <th className="py-2.5 px-3 text-center">AI Station</th>
                <th className="py-2.5 px-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono" style={{ borderColor: "var(--border)" }}>
              {farmScorecard.map((f) => (
                <tr key={f.farmId} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="py-2.5 px-3 font-sans font-semibold text-[var(--text-primary)]">
                    {f.farmName} <span className="text-[10px] font-mono text-[var(--text-muted)]">({f.farmCode})</span>
                  </td>
                  <td className="py-2.5 px-3 text-right">{f.sowsCount}</td>
                  <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">{f.giltsCount}</td>
                  <td className={`py-2.5 px-3 text-right font-bold ${f.cycleIndex >= 2.45 ? "text-emerald-600" : f.cycleIndex >= 2.40 ? "text-blue-600" : "text-rose-600"}`}>
                    {f.cycleIndex}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-emerald-600">{f.bornAlivePerLitter}</td>
                  <td className="py-2.5 px-3 text-right">{f.farrowingRatePct}%</td>
                  <td className={`py-2.5 px-3 text-right ${f.weanToServiceDays > 4.5 ? "text-rose-600" : "text-[var(--text-secondary)]"}`}>
                    {f.weanToServiceDays}d
                  </td>
                  <td className={`py-2.5 px-3 text-right ${f.preWeanMortalityPct > 9.0 ? "text-rose-600 font-bold" : f.preWeanMortalityPct > 8.0 ? "text-amber-600" : "text-emerald-600"}`}>
                    {f.preWeanMortalityPct}%
                  </td>
                  <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">{f.femaleMortalityPct}%</td>
                  <td className="py-2.5 px-3 text-center font-sans">
                    <span className={`inline-block rounded-xs px-1.5 py-0.5 text-[10px] font-semibold ${
                      f.aiStatus === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
                      f.aiStatus === "Partial" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
                      "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    }`}>
                      {f.aiStatus}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-sans">
                    <span className={`inline-block rounded-xs px-2 py-0.5 text-[10px] font-semibold ${
                      f.status === "On Track" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" :
                      f.status === "Watch" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" :
                      "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    }`}>
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
              {/* Division Summary Row */}
              <tr className="bg-[var(--surface-raised)] font-semibold border-t-2" style={{ borderColor: "var(--border)" }}>
                <td className="py-3 px-3 font-sans font-bold">Division Total</td>
                <td className="py-3 px-3 text-right">{divisionTotals.sowsCount.toLocaleString()}</td>
                <td className="py-3 px-3 text-right">{divisionTotals.giltsCount.toLocaleString()}</td>
                <td className="py-3 px-3 text-right font-bold text-amber-600">{divisionTotals.cycleIndex}</td>
                <td className="py-3 px-3 text-right text-emerald-600">{divisionTotals.bornAlivePerLitter}</td>
                <td className="py-3 px-3 text-right">{divisionTotals.farrowingRatePct}%</td>
                <td className="py-3 px-3 text-right">{divisionTotals.weanToServiceDays}d</td>
                <td className="py-3 px-3 text-right text-amber-600">{divisionTotals.preWeanMortalityPct}%</td>
                <td className="py-3 px-3 text-right">{divisionTotals.femaleMortalityPct}%</td>
                <td className="py-3 px-3 text-center font-sans">—</td>
                <td className="py-3 px-3 text-right font-sans">
                  <span className="rounded-xs bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {divisionTotals.status}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

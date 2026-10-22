"use client";

import { useEffect, useState } from "react";
import { Loader2, Calendar, RefreshCw, ShieldAlert, Layers, HeartPulse, Building2, CheckCircle2 } from "lucide-react";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { StatRow, StatCard } from "@/components/ui/stat-row";

interface PeriodOption {
  periodId: string;
  periodCode: string;
  businessYear: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

interface LiveDashboardData {
  metadata: {
    tenantName: string;
    companyName: string;
    nobCode: string;
    periodCode: string;
    businessYear: string;
    periodStartDate: string;
    periodEndDate: string;
    isPeriodActive: boolean;
    availablePeriods: PeriodOption[];
  };
  activeHerdSummary: {
    totalHeadcount: number;
    sowsCount: number;
    giltsCount: number;
    boarsCount: number;
    parityDistribution: {
      p0Gilts: { count: number; pct: number };
      p1: { count: number; pct: number };
      p2: { count: number; pct: number };
      p3: { count: number; pct: number };
      p4Plus: { count: number; pct: number };
    };
    stagesDistribution: Array<{
      stageName: string;
      count: number;
    }>;
  };
  reproductiveIntelligence: {
    totalLittersRecorded: number;
    totalPigletsBornLive: number;
    avgBornAlivePerLitter: number;
    totalPigletsWeaned: number;
    weaningSurvivalRatePct: number;
    preWeanMortalityPct: number;
    conceptionPipeline: {
      totalMatings: number;
      confirmedPregnant: number;
      repeatFailed: number;
      completedWeaned: number;
      aiInseminationCount: number;
      naturalMatingCount: number;
    };
    recentLitters: Array<{
      farrowId: string;
      sowCode: string;
      farrowingDate: string;
      pigletsBornLive: number;
      pigletsStillborn: number;
      pigletsWeaned: number;
      weaningDate: string | null;
      avgBirthWeightKg: number | null;
      avgWeaningWeightKg: number | null;
    }>;
  };
  productionBatchesSummary: {
    activeBatchesCount: number;
    totalBatchHeadcount: number;
    totalBatchWipValuation: number;
    batchesByStage: Array<{
      stageName: string;
      count: number;
      totalHeads: number;
    }>;
  };
  facilityLocations: Array<{
    locationId: string;
    locationCode: string;
    locationName: string;
    headcount: number;
    sowsCount: number;
    giltsCount: number;
    batchesCount: number;
    wipValuation: number;
    status: "Active Operations" | "Standby";
  }>;
}

export default function PiggeryGmDashboard() {
  const { formatMoney } = useCompanyCurrency();
  const companyId = getActiveCompanyId();

  const [data, setData] = useState<LiveDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter States
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [isCustomRange, setIsCustomRange] = useState(false);

  const loadData = async (opts?: { periodId?: string; from?: string; to?: string }) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (opts?.periodId) params.set("periodId", opts.periodId);
      if (opts?.from) params.set("dateFrom", opts.from);
      if (opts?.to) params.set("dateTo", opts.to);

      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await api.get(`/piggery/analytics/gm-dashboard${qs}`);
      const payload: LiveDashboardData = res?.data ?? res;
      setData(payload);

      if (!isCustomRange && payload?.metadata) {
        setDateFrom(payload.metadata.periodStartDate);
        setDateTo(payload.metadata.periodEndDate);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load live dashboard telemetry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateFrom || !dateTo) return;
    setIsCustomRange(true);
    loadData({ from: dateFrom, to: dateTo });
  };

  const handleResetToPeriod = () => {
    setIsCustomRange(false);
    setSelectedPeriodId("");
    loadData();
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Querying live farm database telemetry...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[var(--radius-lg)] border p-6 text-center text-xs" style={{ borderColor: "var(--danger)", backgroundColor: "var(--surface)" }}>
        <ShieldAlert className="mx-auto h-6 w-6 text-[var(--danger)]" />
        <p className="mt-2 font-semibold text-[var(--text-primary)]">Telemetry Service Offline</p>
        <p className="mt-1 text-[var(--text-secondary)]">{error}</p>
        <button
          onClick={() => loadData()}
          className="nf-press mt-4 rounded-[var(--radius-pill)] px-4 py-1.5 font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Retry
        </button>
      </div>
    );
  }

  const activeHerdSummary = data?.activeHerdSummary ?? {
    totalHeadcount: 0,
    sowsCount: 0,
    giltsCount: 0,
    boarsCount: 0,
    parityDistribution: {
      p0Gilts: { count: 0, pct: 0 },
      p1: { count: 0, pct: 0 },
      p2: { count: 0, pct: 0 },
      p3: { count: 0, pct: 0 },
      p4Plus: { count: 0, pct: 0 },
    },
    stagesDistribution: [],
  };
  const reproductiveIntelligence = data?.reproductiveIntelligence ?? {
    totalLittersRecorded: 0,
    totalPigletsBornLive: 0,
    avgBornAlivePerLitter: 0,
    totalPigletsWeaned: 0,
    weaningSurvivalRatePct: 0,
    preWeanMortalityPct: 0,
    conceptionPipeline: {
      totalMatings: 0,
      confirmedPregnant: 0,
      repeatFailed: 0,
      completedWeaned: 0,
      aiInseminationCount: 0,
      naturalMatingCount: 0,
    },
    recentLitters: [],
  };
  const productionBatchesSummary = data?.productionBatchesSummary ?? {
    activeBatchesCount: 0,
    totalBatchHeadcount: 0,
    totalBatchWipValuation: 0,
    batchesByStage: [],
  };
  const facilityLocations = data?.facilityLocations ?? [];

  return (
    <div className="space-y-5">
      {/* ── Filter Bar: Period, Year & Date Range (From / To) ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border p-3 shadow-xs" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2.5">

          {/* Date Range Inputs: From / To */}
          <form onSubmit={handleApplyCustomDates} className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span>From:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-mono font-medium"
                style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span>To:</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-mono font-medium"
                style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              />
            </div>
            <button
              type="submit"
              className="nf-press inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1 text-xs font-semibold text-white shadow-xs"
              style={{ backgroundColor: "var(--accent)" }}
            >
              <Calendar className="h-3 w-3" />
              <span>Filter</span>
            </button>
            {isCustomRange && (
              <button
                type="button"
                onClick={handleResetToPeriod}
                className="nf-press rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"
                style={{ borderColor: "var(--border)" }}
              >
                Reset
              </button>
            )}
          </form>
        </div>

        {/* Live Status Indicator */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: "var(--success-muted)", borderColor: "var(--success)", color: "var(--success)" }}>
            <span className="h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
            <span>100% Live Database Telemetry</span>
          </span>
          <button
            onClick={() => loadData({ from: dateFrom, to: dateTo, periodId: selectedPeriodId })}
            className="nf-press p-1.5 rounded-full border text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]"
            style={{ borderColor: "var(--border)" }}
            title="Refresh Live Data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Top Core Stat Cards (4 Cards) ── */}
      <StatRow>
        <StatCard
          icon={Building2}
          label="Active Registered Herd"
          value={activeHerdSummary.totalHeadcount}
          unit="Head"
          sub={`${activeHerdSummary.sowsCount} Sows · ${activeHerdSummary.giltsCount} Gilts · ${activeHerdSummary.boarsCount} Boar`}
        />
        <StatCard
          icon={Layers}
          label="Active Batches"
          value={productionBatchesSummary.activeBatchesCount}
          unit="Batches"
          sub={`${productionBatchesSummary.totalBatchHeadcount} Total Livestock Heads in Batch`}
        />
        <StatCard
          icon={Calendar}
          label="Live Batch WIP Asset"
          value={formatMoney(productionBatchesSummary.totalBatchWipValuation)}
          unit="WIP"
          sub="Direct Cost Accumulation from Live Ledger"
        />
        <StatCard
          icon={HeartPulse}
          label="Litter Weaning Efficiency"
          value={`${reproductiveIntelligence.weaningSurvivalRatePct}%`}
          unit="Survival"
          sub={`${reproductiveIntelligence.totalPigletsWeaned} Weaned of ${reproductiveIntelligence.totalPigletsBornLive} Live Born (${reproductiveIntelligence.preWeanMortalityPct}% Loss)`}
        />
      </StatRow>

      {/* ── Reproductive & Breeding Intelligence (3 Cards Grid) ── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Card 1: Farrowing & Litters */}
        <div className="rounded-[var(--radius-md)] border p-4 shadow-xs space-y-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Farrowing & Litters</h3>
              <p className="text-xs text-[var(--text-secondary)]">Recorded litters in selected date range</p>
            </div>
            <span className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold border" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              {reproductiveIntelligence.totalLittersRecorded} Litters
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <div className="rounded-[var(--radius-sm)] border p-2.5" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Born Live</span>
              <p className="mt-1 font-mono text-xl font-bold" style={{ color: "var(--success)" }}>
                {reproductiveIntelligence.totalPigletsBornLive}
              </p>
              <span className="text-[10px] text-[var(--text-secondary)]">{reproductiveIntelligence.avgBornAlivePerLitter} avg/litter</span>
            </div>
            <div className="rounded-[var(--radius-sm)] border p-2.5" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Weaned</span>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--accent)]">
                {reproductiveIntelligence.totalPigletsWeaned}
              </p>
              <span className="text-[10px] text-[var(--text-secondary)]">{reproductiveIntelligence.weaningSurvivalRatePct}% survival</span>
            </div>
          </div>

          {/* Recent Litters Mini Table */}
          <div>
            <span className="text-[11px] font-semibold text-[var(--text-secondary)]">Recent Farrowing Records:</span>
            {reproductiveIntelligence.recentLitters.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--text-muted)] italic">No litters recorded in this date range.</p>
            ) : (
              <div className="mt-1.5 divide-y overflow-hidden rounded-[var(--radius-sm)] border text-xs" style={{ borderColor: "var(--border)" }}>
                {reproductiveIntelligence.recentLitters.map((l) => (
                  <div key={l.farrowId} className="flex items-center justify-between p-2 hover:bg-[var(--surface-raised)]">
                    <div>
                      <span className="font-semibold text-[var(--text-primary)]">{l.sowCode}</span>
                      <span className="ml-2 font-mono text-[10px] text-[var(--text-muted)]">{l.farrowingDate}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[var(--success)] font-semibold">{l.pigletsBornLive} live</span>
                      <span className="text-[var(--text-muted)]">/</span>
                      <span className="text-[var(--accent)] font-semibold">{l.pigletsWeaned} weaned</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Breeding Pipeline */}
        <div className="rounded-[var(--radius-md)] border p-4 shadow-xs space-y-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Mating & Insemination</h3>
              <p className="text-xs text-[var(--text-secondary)]">Conception status & service methods</p>
            </div>
            <span className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold border" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              {reproductiveIntelligence.conceptionPipeline.totalMatings} Services
            </span>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border p-2 text-xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="font-medium text-[var(--text-secondary)]">Confirmed Pregnant</span>
              <span className="font-mono font-bold" style={{ color: "var(--success)" }}>
                {reproductiveIntelligence.conceptionPipeline.confirmedPregnant} Sows
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border p-2 text-xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="font-medium text-[var(--text-secondary)]">Completed / Weaned</span>
              <span className="font-mono font-bold text-[var(--accent)]">
                {reproductiveIntelligence.conceptionPipeline.completedWeaned} Sows
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border p-2 text-xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="font-medium text-[var(--text-secondary)]">Failed / Repeat</span>
              <span className="font-mono font-bold" style={{ color: "var(--danger)" }}>
                {reproductiveIntelligence.conceptionPipeline.repeatFailed} Sows
              </span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] border p-2 text-xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <span className="font-medium text-[var(--text-secondary)]">AI vs Natural Mating</span>
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {reproductiveIntelligence.conceptionPipeline.aiInseminationCount} AI · {reproductiveIntelligence.conceptionPipeline.naturalMatingCount} Natural
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Herd Parity & Stage Structure */}
        <div className="rounded-[var(--radius-md)] border p-4 shadow-xs space-y-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Herd Parity & Stage Structure</h3>
            <p className="text-xs text-[var(--text-secondary)]">Actual parity distribution across registered herd</p>
          </div>

          {/* Parity Breakdown Bars */}
          <div className="space-y-1.5 pt-1">
            {[
              { label: "Parity 0 (Gilts)", count: activeHerdSummary.parityDistribution.p0Gilts.count, pct: activeHerdSummary.parityDistribution.p0Gilts.pct },
              { label: "Parity 1", count: activeHerdSummary.parityDistribution.p1.count, pct: activeHerdSummary.parityDistribution.p1.pct },
              { label: "Parity 2", count: activeHerdSummary.parityDistribution.p2.count, pct: activeHerdSummary.parityDistribution.p2.pct },
              { label: "Parity 3", count: activeHerdSummary.parityDistribution.p3.count, pct: activeHerdSummary.parityDistribution.p3.pct },
              { label: "Parity 4+", count: activeHerdSummary.parityDistribution.p4Plus.count, pct: activeHerdSummary.parityDistribution.p4Plus.pct },
            ].map((p) => (
              <div key={p.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[var(--text-secondary)]">{p.label}</span>
                  <span className="font-mono font-semibold text-[var(--text-primary)]">{p.count} Head ({p.pct}%)</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(p.pct, p.count > 0 ? 5 : 0)}%`, backgroundColor: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Facility Locations & Farm Table (100% Live) ── */}
      <div className="rounded-[var(--radius-md)] border p-4 shadow-xs space-y-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Live Triple C Facility & Production Sites</h3>
            <p className="text-xs text-[var(--text-secondary)]">Actual stock allocations & operational batch status across company locations</p>
          </div>
          <span className="rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            {facilityLocations.length} Registered Sites
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] font-semibold uppercase text-[var(--text-muted)]" style={{ borderColor: "var(--border)" }}>
                <th className="py-2.5 px-3">Farm Location</th>
                <th className="py-2.5 px-3 text-right">Registered Herd</th>
                <th className="py-2.5 px-3 text-right">Sows</th>
                <th className="py-2.5 px-3 text-right">Gilts</th>
                <th className="py-2.5 px-3 text-right">Active Batches</th>
                <th className="py-2.5 px-3 text-right">Live WIP Asset</th>
                <th className="py-2.5 px-3 text-right">Operational Status</th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono" style={{ borderColor: "var(--border)" }}>
              {facilityLocations.map((f) => (
                <tr key={f.locationId} className="hover:bg-[var(--surface-raised)] transition-colors">
                  <td className="py-3 px-3 font-sans font-semibold text-[var(--text-primary)]">
                    {f.locationName} <span className="text-[10px] font-mono text-[var(--text-muted)]">({f.locationCode})</span>
                  </td>
                  <td className="py-3 px-3 text-right font-bold">{f.headcount} Head</td>
                  <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{f.sowsCount}</td>
                  <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{f.giltsCount}</td>
                  <td className="py-3 px-3 text-right font-semibold">{f.batchesCount}</td>
                  <td className="py-3 px-3 text-right font-semibold">{formatMoney(f.wipValuation)}</td>
                  <td className="py-3 px-3 text-right font-sans">
                    <span className={`inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold border ${
                      f.status === "Active Operations"
                        ? "bg-[var(--success-muted)] text-[var(--success)] border-[var(--success)]"
                        : "bg-slate-100 dark:bg-slate-800 text-[var(--text-muted)] border-transparent"
                    }`}>
                      {f.status === "Active Operations" && <CheckCircle2 className="h-3 w-3" />}
                      <span>{f.status}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

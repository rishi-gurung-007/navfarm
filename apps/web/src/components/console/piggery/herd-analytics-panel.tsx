"use client";

import { useEffect, useState } from "react";
import {
  Loader2, BarChart3, TrendingUp, Users, HeartPulse,
  Activity, ShieldCheck,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Toast } from "@/components/ui/toast";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised:  { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub:     { color: "var(--text-secondary)" },
  muted:   { color: "var(--text-muted)" },
  accent:  { color: "var(--accent)" },
  danger:  { color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--danger-muted)" },
  warning: { color: "var(--warning)", borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)" },
  success: { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" },
};

export default function HerdAnalyticsPanel() {
  const { formatMoney } = useCompanyCurrency();
  const formatCurrency = (val?: number | string | null) => formatMoney(val == null ? 0 : Number(val));
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [data, setData]         = useState<Row | null>(null);
  const [batches, setBatches]   = useState<Row[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");

  const loadAnalytics = async (batchId?: string) => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ companyId });
      if (batchId) qs.set("batchId", batchId);
      const res = await api.get(`/financial-reports/herd-analytics?${qs.toString()}`);
      setData(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("hapLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
    if (companyId) {
      api.get(`/batch?companyId=${companyId}&limit=200`).then((r) => setBatches(unwrap<Row[]>(r) || [])).catch(() => setBatches([]));
    }
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBatchFilterChange = (batchId: string) => {
    setSelectedBatchId(batchId);
    loadAnalytics(batchId || undefined);
  };

  const maxParityCount = data
    ? Math.max(...Object.values(data.parityDistribution as Record<string, number>), 1)
    : 1;

  return (
    <div className="space-y-6">
      {/* ── Top Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border p-4" style={S.surface}>
        <div>
          <h3 className="text-base font-semibold" style={S.primary}>{t("hapTitle")}</h3>
          <p className="text-xs" style={S.muted}>{t("hapSubtitle")}</p>
        </div>
        {batches.length > 0 && (
          <select
            value={selectedBatchId}
            onChange={(e) => handleBatchFilterChange(e.target.value)}
            className="nf-input h-9 text-xs"
          >
            <option value="">{t("hapAllBatches")}</option>
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
            ))}
          </select>
        )}
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      {loading && (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={S.accent} />
          <p className="mt-3 text-sm" style={S.sub}>{t("hapLoadingMessage")}</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
          {/* ── KPI Summary Cards ── */}
          <StatRow>
            <StatCard
              icon={Users}
              label={t("hapActiveHerdSize")}
              value={data.totalHeadcount.toLocaleString()}
              unit={t("hapHeadUnit")}
              sub={t("hapGenderSplit", { female: data.genderBreakdown.Female, male: data.genderBreakdown.Male })}
            />
            <StatCard
              icon={TrendingUp}
              label={t("hapAssetValuation")}
              value={formatCurrency(data.totalBookValue)}
              sub={t("hapAvgPerHead", { value: formatCurrency(data.totalHeadcount > 0 ? data.totalBookValue / data.totalHeadcount : 0) })}
            />
            <StatCard
              icon={HeartPulse}
              label={t("hapLiveBirths")}
              value={data.productivity.totalPigletsBornLive.toLocaleString()}
              unit={t("hapPigletsUnit")}
              sub={t("hapSuccessfullyWeaned", { count: data.productivity.totalPigletsWeaned.toLocaleString() })}
            />
            <StatCard
              icon={Activity}
              label={t("hapWeaningRate")}
              value={`${data.productivity.weaningRate}%`}
              sub={data.productivity.weaningRate >= 85 ? t("hapOptimalWeaningEfficiency") : t("hapMonitoringRecommended")}
            />
          </StatRow>

          {/* ── Parity Profile Curve & Breeding Distribution ── */}
          <div className="rounded-[var(--radius-lg)] border p-5 shadow-sm" style={S.surface}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-semibold" style={S.primary}>{t("hapParityCurveTitle")}</h4>
                <p className="text-xs" style={S.muted}>{t("hapParityCurveSubtitle")}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.accent}>
                <BarChart3 className="h-3.5 w-3.5" /> {t("hapParityTarget")}
              </span>
            </div>

            <div className="space-y-3 pt-2">
              {Object.entries(data.parityDistribution as Record<string, number>).map(([label, count]) => {
                const pct = (count / maxParityCount) * 100;
                return (
                  <div key={label} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span style={S.primary}>{label}</span>
                      <span style={S.sub}>{t("hapCountHead", { count })}</span>
                    </div>
                    <div className="h-4 w-full rounded-full overflow-hidden" style={S.raised}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(pct, count > 0 ? 4 : 0)}%`,
                          backgroundColor: "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Demographics Breakdown (Stage & Breed) ── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* By Stage */}
            <div className="rounded-[var(--radius-lg)] border p-5 shadow-sm" style={S.surface}>
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-4 w-4" style={S.accent} />
                <h4 className="text-sm font-semibold" style={S.primary}>{t("hapDistributionByStage")}</h4>
              </div>
              <div className="space-y-2 text-sm">
                {data.stageBreakdown.map((s: Row) => (
                  <div key={s.stage_name} className="flex items-center justify-between py-2 border-b">
                    <span style={S.sub}>{s.stage_name}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold" style={S.primary}>{t("hapCountHead", { count: s.count })}</span>
                      <span className="text-xs" style={S.muted}>
                        {((s.count / (data.totalHeadcount || 1)) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
                {data.stageBreakdown.length === 0 && (
                  <p className="text-xs" style={S.muted}>{t("hapNoAnimalsInActiveStages")}</p>
                )}
              </div>
            </div>

            {/* By Breed */}
            <div className="rounded-[var(--radius-lg)] border p-5 shadow-sm" style={S.surface}>
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4" style={S.accent} />
                <h4 className="text-sm font-semibold" style={S.primary}>{t("hapDistributionByBreed")}</h4>
              </div>
              <div className="space-y-2 text-sm">
                {data.breedBreakdown.map((b: Row) => (
                  <div key={b.breed_name} className="flex items-center justify-between py-2 border-b">
                    <span style={S.sub}>{b.breed_name}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold" style={S.primary}>{t("hapCountHead", { count: b.count })}</span>
                      <span className="text-xs" style={S.muted}>
                        {((b.count / (data.totalHeadcount || 1)) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
                {data.breedBreakdown.length === 0 && (
                  <p className="text-xs" style={S.muted}>{t("hapNoBreedRegistrations")}</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Disposals & Realized Gain/Loss Summary ── */}
          <div className="rounded-[var(--radius-lg)] border p-5 shadow-sm" style={S.surface}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-semibold" style={S.primary}>{t("hapDisposalsTitle")}</h4>
                <p className="text-xs" style={S.muted}>{t("hapDisposalsSubtitle")}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase font-semibold" style={S.muted}>{t("hapNetGainLoss")}</p>
                <p className="text-base font-bold" style={Number(data.disposals.totalGainLoss) >= 0 ? S.success : S.danger}>
                  {formatCurrency(data.disposals.totalGainLoss)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-2">
              {Object.entries(data.disposals.disposalBreakdown as Record<string, number>).map(([type, count]) => (
                <div key={type} className="rounded-[var(--radius-md)] border p-3" style={S.raised}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{type}</p>
                  <p className="mt-1 text-xl font-bold" style={S.primary}>{count} <span className="text-xs font-normal" style={S.muted}>{t("hapHeadUnit")}</span></p>
                </div>
              ))}
              {Object.keys(data.disposals.disposalBreakdown).length === 0 && (
                <div className="col-span-4 py-4 text-center">
                  <p className="text-xs" style={S.muted}>{t("hapNoDisposalEvents")}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

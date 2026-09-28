"use client";

import { useEffect, useState } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2,
  Layers, Calendar,
  Scale, Utensils, Skull,
} from "lucide-react";

import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLanguage } from "@/hooks/useLanguage";
import { getActiveCompanyId } from "@/hooks/useAuth";

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

interface BatchPerformanceCurvesPanelProps {
  batchId: string;
  onSchedulerGenerated?: () => void;
}

export default function BatchPerformanceCurvesPanel({
  batchId,
  onSchedulerGenerated,
}: BatchPerformanceCurvesPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError]           = useState("");
  const [data, setData]             = useState<Row | null>(null);
  const [animals, setAnimals]       = useState<Row[]>([]);
  const [selectedAnimalId, setSelectedAnimalId] = useState("");

  const loadCurves = async (animalId?: string) => {
    if (!batchId) return;
    setLoading(true);
    setError("");
    try {
      const qs = animalId ? `?animalId=${animalId}` : "";
      const res = await api.get(`/batch/${batchId}/performance-curves${qs}`);
      setData(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("bpcLoadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!batchId) return;
    const companyId = getActiveCompanyId();
    api.get(`/animal?companyId=${companyId}&currentBatchId=${batchId}&limit=500`)
      .then((res) => setAnimals(unwrap<Row[]>(res) || []))
      .catch(() => setAnimals([]));
  }, [batchId]);

  const handleGenerateScheduler = async () => {
    setGenerating(true);
    setError("");
    try {
      await api.post(`/batch/${batchId}/generate-scheduler`, {});
      await loadCurves();
      onSchedulerGenerated?.();
    } catch (err: any) {
      setError(err?.message || t("bpcGenerateSchedulerError"));
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    loadCurves();
  }, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnimalFilterChange = (animalId: string) => {
    setSelectedAnimalId(animalId);
    loadCurves(animalId || undefined);
  };

  if (loading && !data) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin" style={S.accent} />
        <p className="mt-3 text-sm" style={S.sub}>{t("bpcLoadingCurves")}</p>
      </div>
    );
  }

  const batch = data?.batch || {};
  const summary = data?.summary || {};
  const curves: Row[] = data?.curves || [];

  return (
    <div className="space-y-6">
      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      {/* ── Top Header / Actions Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border p-4" style={S.surface}>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-semibold" style={S.primary}>
              {t("bpcPanelTitle")}
            </h4>
            {batch.has_scheduler ? (
              <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> {t("bpcSchedulerLabel", { code: batch.scheduler_code })}</Badge>
            ) : (
              <Badge variant="warning"><AlertTriangle className="h-3 w-3" /> {t("bpcNoActiveScheduler")}</Badge>
            )}
          </div>
          <p className="text-xs mt-0.5" style={S.muted}>
            {t("bpcCurvesDescription", { breed: batch.breed_name || t("bpcStandardBreed") })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {animals.length > 0 && (
            <div className="w-48">
              <SearchableSelect
                ariaLabel={t("schedWholeBatch")}
                value={selectedAnimalId}
                onChange={handleAnimalFilterChange}
                options={[
                  { value: "", label: t("schedWholeBatch") },
                  ...animals.map((a) => ({
                    value: a.animal_id,
                    label: a.ear_tag || a.animal_code,
                  })),
                ]}
                placeholder={t("schedWholeBatch")}
                searchPlaceholder="Search animal…"
              />
            </div>
          )}
          {!batch.has_scheduler && (
            <Button size="sm" onClick={handleGenerateScheduler} disabled={generating}>
              {generating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Layers className="mr-1.5 h-3.5 w-3.5" />}
              {t("bpcGenerateSchedulerButton")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Summary KPI Cards ── */}
      <StatRow>
        <StatCard
          icon={Utensils}
          label={t("bpcTotalFeedIntake")}
          value={summary.totalActFeedKg?.toLocaleString() || 0}
          unit={t("bpcFeedStdSuffix", { value: summary.totalStdFeedKg?.toLocaleString() || 0 })}
          sub={
            <span className={summary.feedDeviationPct > 10 ? "text-(--warning)" : undefined}>
              {summary.feedDeviationPct > 0 ? `+${summary.feedDeviationPct}%` : `${summary.feedDeviationPct}%`} {t("bpcVarianceVsTarget")}
            </span>
          }
        />
        <StatCard
          icon={Scale}
          label={t("bpcFeedConversionFcr")}
          value={summary.liveFcr != null ? summary.liveFcr : "—"}
          unit={t("bpcKgFeedPerKgGain")}
          sub={t("bpcLastWeight", { weight: summary.lastRecordedWeightKg || 1.5 })}
        />
        <StatCard
          icon={Skull}
          tone={summary.totalMortality > 0 ? "danger" : "default"}
          label={t("bpcCumulativeMortality")}
          value={summary.totalMortality || 0}
          unit={t("bpcPigsWithRate", { rate: summary.mortalityRatePct || 0 })}
          sub={t("bpcCurrentHeadcount", { count: batch.current_quantity || 0 })}
        />
        <StatCard
          icon={Calendar}
          label={t("bpcBatchTimeline")}
          value={t("bpcDayLabel", { day: batch.batch_age_days || 1 })}
          sub={t("bpcStageLabel", { stage: batch.current_stage_code || t("bpcDefaultStage") })}
        />
      </StatRow>

      {/* ── Daily Timeline & Execution Grid ── */}
      <div className="rounded-[var(--radius-lg)] border overflow-hidden" style={S.surface}>
        <div className="border-b p-4" style={S.surface}>
          <h5 className="text-sm font-semibold" style={S.primary}>{t("bpcDayByDayExecutionTitle")}</h5>
          <p className="text-xs" style={S.muted}>{t("bpcDayByDayExecutionDescription")}</p>
        </div>

        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b text-left uppercase font-semibold" style={S.raised}>
              <tr>
                <th className="px-3 py-2.5">{t("bpcColDay")}</th>
                <th className="px-3 py-2.5">{t("bpcColDate")}</th>
                <th className="px-3 py-2.5">{t("bpcColDailyFeedTarget")}</th>
                <th className="px-3 py-2.5">{t("bpcColActualDailyFeed")}</th>
                <th className="px-3 py-2.5">{t("bpcColFeedProgress")}</th>
                <th className="px-3 py-2.5">{t("bpcColTargetWeight")}</th>
                <th className="px-3 py-2.5">{t("bpcColActualWeight")}</th>
                <th className="px-3 py-2.5">{t("bpcColMortality")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--row-border)]">
              {curves.map((c) => {
                const targetFeed = c.stdTotalDailyFeed || 0;
                const actFeed = c.actTotalDailyFeed;
                const pct = targetFeed > 0 && actFeed != null ? Math.round((actFeed / targetFeed) * 100) : null;
                const isOver = pct != null && pct > 115;
                const isUnder = pct != null && pct < 85;

                return (
                  <tr key={c.day} className={`hover:bg-[var(--row-hover)] transition-colors ${c.day === batch.batch_age_days ? "font-semibold bg-[var(--surface-raised)]" : ""}`}>
                    <td className="px-3 py-2 font-mono">
                      {t("bpcDayLabel", { day: c.day })}
                      {c.day === batch.batch_age_days && (
                        <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase border" style={S.accent}>
                          {t("bpcTodayBadge")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono" style={S.muted}>{c.date}</td>
                    <td className="px-3 py-2 font-mono">
                      {targetFeed > 0 ? t("bpcKgValue", { value: targetFeed }) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {actFeed != null ? (
                        <span style={isOver || isUnder ? S.warning : S.primary}>
                          {t("bpcKgValue", { value: actFeed })}
                        </span>
                      ) : (
                        <span style={S.muted}>—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[120px]">
                      {pct != null ? (
                        <div className="space-y-1">
                          <div className="h-1.5 w-full rounded-full overflow-hidden" style={S.raised}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: isOver || isUnder ? "var(--warning)" : "var(--accent)",
                              }}
                            />
                          </div>
                          <span className="text-[10px]" style={S.muted}>{t("bpcPctOfTarget", { pct })}</span>
                        </div>
                      ) : (
                        <span style={S.muted}>{t("bpcPending")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono" style={S.muted}>
                      {c.stdTargetWeight ? t("bpcKgValue", { value: c.stdTargetWeight }) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold" style={S.primary}>
                      {c.actWeight ? t("bpcKgValue", { value: c.actWeight }) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {c.actDailyMort != null ? (
                        <span style={c.actDailyMort > 0 ? S.danger : S.muted}>
                          {t("bpcHeadCount", { count: c.actDailyMort })}
                        </span>
                      ) : (
                        <span style={S.muted}>0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

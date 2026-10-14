"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort, unwrap } from "./feed-format";
import { FORECAST_VIEW_LABEL, type ForecastView } from "./feed-forecast-query";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { showToast, Toast } from "@/components/ui/toast";
import { FeedForecastGrid, type ReportRow, type SourceBalancePoint } from "./feed-forecast-grid";
import { FeedForecastNotes } from "./feed-forecast-notes";

interface ForecastRunSummary {
  run_id: string;
  run_code: string;
  version: number;
  view: string;
  planning_date?: string;
  from_date: string;
  to_date: string;
  period_id?: string | null;
  source_cutoff_at?: string;
  config_snapshot?: { version?: string };
  created_by?: string;
  created_by_name?: string | null;
  created_at: string;
}

function timestampParts(value: string | undefined): { date: string; time: string } | null {
  if (!value) return null;
  const [date, time = ""] = value.replace("T", " ").replace("Z", "").split(" ");
  return { date: formatDateShort(date), time: time.slice(0, 8) };
}

interface ViewedRun {
  run_code: string;
  display: { rows: ReportRow[]; sourceBalances?: SourceBalancePoint[]; flags?: unknown[]; filters?: { view?: string; from?: string }; view?: string; from?: string };
}

export function FeedForecastRunHistory({ farmId, reloadToken, compact = false, onViewRun }: { farmId: string; reloadToken: number; compact?: boolean; onViewRun?: (runId: string) => void }) {
  const { t } = useLanguage();
  const [runs, setRuns] = useState<ForecastRunSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedFarmId, setLoadedFarmId] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [viewing, setViewing] = useState<{ runCode: string; loading: boolean; run: ViewedRun | null; failed: boolean } | null>(null);
  const [deleting, setDeleting] = useState<{ run: ForecastRunSummary; busy: boolean; error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    setLoadedFarmId(null);
    api.get(`/feed-forecast/runs?${new URLSearchParams({ farmId }).toString()}`)
      .then((response) => {
        if (cancelled) return;
        const data = unwrap<ForecastRunSummary[]>(response);
        setRuns(Array.isArray(data) ? data : []);
        setLoadedFarmId(farmId);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoadedFarmId(farmId);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [farmId, reloadToken, localReload]);

  const currentRuns = loadedFarmId === farmId ? runs : [];
  const isLoading = loading || loadedFarmId !== farmId;

  const viewText = (view: string | null | undefined) => (view && view in FORECAST_VIEW_LABEL ? t(FORECAST_VIEW_LABEL[view as ForecastView]) : view ?? "");

  const viewRun = async (run: ForecastRunSummary) => {
    if (onViewRun) { onViewRun(run.run_id); return; }
    setViewing({ runCode: run.run_code, loading: true, run: null, failed: false });
    try {
      const detail = unwrap<any>(await api.get(`/feed-forecast/runs/${run.run_id}`));
      const display = detail?.output_snapshot?.display;
      if (!display?.rows) throw new Error("no snapshot");
      setViewing((current) => current && current.runCode === run.run_code ? { runCode: run.run_code, loading: false, run: { run_code: run.run_code, display }, failed: false } : current);
    } catch {
      setViewing((current) => current && current.runCode === run.run_code ? { runCode: run.run_code, loading: false, run: null, failed: true } : current);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { run } = deleting;
    setDeleting({ run, busy: true, error: "" });
    try {
      await api.delete(`/feed-forecast/runs/${run.run_id}/permanent`);
      setDeleting(null);
      showToast.success(t("ffRunDeleted", { code: run.run_code }));
      setLocalReload((n) => n + 1);
    } catch (err: any) {
      setDeleting({ run, busy: false, error: err?.response?.data?.message || err?.message || t("ffRunDeleteFailed") });
    }
  };

  const body = isLoading ? <LoadingState label={t("ffLoadingRunHistory")} /> : failed ? <InlineAlert>{t("ffRunHistoryFailed")}</InlineAlert> : currentRuns.length === 0 ? (
    <p className="px-3 pb-3 text-xs text-[var(--text-secondary)]">{t("ffNoSavedRuns")}</p>
  ) : (
    <ul className="divide-y divide-[var(--border)]" aria-label={t("ffRunHistoryLabel")}>
      {currentRuns.map((run) => (
        <li key={run.run_id} className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(13rem,auto)_1fr]">
          <span className="font-mono font-semibold text-[var(--text-primary)]">{run.run_code}</span>
          <span className="text-[var(--text-secondary)]">{t("ffRunHistoryRow", { version: run.version, view: viewText(run.view), from: formatDateShort(run.from_date), to: formatDateShort(run.to_date) })}</span>
          {timestampParts(run.created_at) && <span className="text-[var(--text-secondary)]">{t("ffRunAsOf", timestampParts(run.created_at)!)}</span>}
          {timestampParts(run.source_cutoff_at) && <span className="text-[var(--text-secondary)]">{t("ffRunPostingCutoff", timestampParts(run.source_cutoff_at)!)}</span>}
          {run.planning_date && <span className="text-[var(--text-secondary)]">{t("ffRunSelectedFilters", { view: viewText(run.view), planning: formatDateShort(run.planning_date), from: formatDateShort(run.from_date), to: formatDateShort(run.to_date) })}</span>}
          {run.config_snapshot?.version && <span className="break-all text-[var(--text-secondary)]">{t("ffRunConfigVersion", { version: run.config_snapshot.version })}</span>}
          {run.created_by && <span className="text-[var(--text-secondary)]">{t("ffRunAuthor", { author: run.created_by_name || t("ffUnknownUser") })}</span>}
          <span className="flex gap-2 sm:col-span-2">
            <Button size="sm" variant="outline" className="justify-self-start" onClick={() => void viewRun(run)}>{t("ffRunViewCalculation")}</Button>
            <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setDeleting({ run, busy: false, error: "" })}>{t("ffRunDelete")}</Button>
          </span>
        </li>
      ))}
    </ul>
  );
  const dialogs = (
    <>
      {viewing && (
        <Dialog open onClose={() => setViewing(null)} title={viewing.runCode} maxWidth="xl">
          {viewing.loading ? <LoadingState label={t("ffLoading")} /> : viewing.failed || !viewing.run ? <InlineAlert>{t("ffRunViewFailed")}</InlineAlert> : (
            <div className="flex min-h-0 flex-col gap-3">
              <FeedForecastGrid
                rows={viewing.run.display.rows}
                sourceBalances={viewing.run.display.sourceBalances ?? []}
                view={viewing.run.display.filters?.view ?? viewing.run.display.view}
                from={viewing.run.display.filters?.from ?? viewing.run.display.from}
                loading={false}
                t={t}
              />
              <FeedForecastNotes flags={(viewing.run.display.flags ?? []) as any} t={t} />
            </div>
          )}
        </Dialog>
      )}
      {deleting && (
        <Dialog
          open
          onClose={() => { if (!deleting.busy) setDeleting(null); }}
          title={t("ffRunDelete")}
          presentation="compact"
          maxWidth="sm"
          footer={(
            <>
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleting.busy}>{t("cancel")}</Button>
              <Button onClick={() => void confirmDelete()} disabled={deleting.busy}>{t("ffRunDelete")}</Button>
            </>
          )}
        >
          <p className="text-sm text-[var(--text-primary)]">{t("ffRunDeleteConfirm", { code: deleting.run.run_code })}</p>
          <Toast variant="danger" message={deleting.error} onClose={() => setDeleting((d) => (d ? { ...d, error: "" } : d))} />
        </Dialog>
      )}
    </>
  );
  if (compact) return <><RunHistoryDialogButton title={t("ffRunHistory", { count: currentRuns.length })} body={body} />{dialogs}</>;
  return (
    <>
    <details className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">
        {t("ffRunHistory", { count: currentRuns.length })}
      </summary>
      {body}
    </details>
    {dialogs}
    </>
  );
}

function RunHistoryDialogButton({ title, body }: { title: string; body: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="nf-button nf-button-secondary text-xs" onClick={() => setOpen(true)}>{title}</button><Dialog open={open} onClose={() => setOpen(false)} title={title} maxWidth="lg">{body}</Dialog></>;
}

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort, unwrap } from "./feed-format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

export function FeedForecastRunHistory({ farmId, reloadToken, compact = false, onViewRun }: { farmId: string; reloadToken: number; compact?: boolean; onViewRun?: (runId: string) => void }) {
  const { t } = useLanguage();
  const [runs, setRuns] = useState<ForecastRunSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedFarmId, setLoadedFarmId] = useState<string | null>(null);

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
  }, [farmId, reloadToken]);

  const currentRuns = loadedFarmId === farmId ? runs : [];
  const isLoading = loading || loadedFarmId !== farmId;

  const body = isLoading ? <LoadingState label={t("ffLoadingRunHistory")} /> : failed ? <InlineAlert>{t("ffRunHistoryFailed")}</InlineAlert> : currentRuns.length === 0 ? (
    <p className="px-3 pb-3 text-xs text-[var(--text-secondary)]">{t("ffNoSavedRuns")}</p>
  ) : (
    <ul className="divide-y divide-[var(--border)]" aria-label={t("ffRunHistoryLabel")}>
      {currentRuns.map((run) => (
        <li key={run.run_id} className="grid gap-1 px-3 py-2 text-xs sm:grid-cols-[minmax(13rem,auto)_1fr]">
          <span className="font-mono font-semibold text-[var(--text-primary)]">{run.run_code}</span>
          <span className="text-[var(--text-secondary)]">{t("ffRunHistoryRow", { version: run.version, view: run.view, from: formatDateShort(run.from_date), to: formatDateShort(run.to_date) })}</span>
          {timestampParts(run.created_at) && <span className="text-[var(--text-secondary)]">{t("ffRunAsOf", timestampParts(run.created_at)!)}</span>}
          {timestampParts(run.source_cutoff_at) && <span className="text-[var(--text-secondary)]">{t("ffRunPostingCutoff", timestampParts(run.source_cutoff_at)!)}</span>}
          {run.planning_date && <span className="text-[var(--text-secondary)]">{t("ffRunSelectedFilters", { view: run.view, planning: formatDateShort(run.planning_date), from: formatDateShort(run.from_date), to: formatDateShort(run.to_date) })}</span>}
          {run.config_snapshot?.version && <span className="break-all text-[var(--text-secondary)]">{t("ffRunConfigVersion", { version: run.config_snapshot.version })}</span>}
          {run.created_by && <span className="text-[var(--text-secondary)]">{t("ffRunAuthor", { author: run.created_by_name || t("ffUnknownUser") })}</span>}
          {onViewRun && <Button size="sm" variant="outline" className="justify-self-start" onClick={() => onViewRun(run.run_id)}>View calculation</Button>}
        </li>
      ))}
    </ul>
  );
  if (compact) return <RunHistoryDialogButton title={t("ffRunHistory", { count: currentRuns.length })} body={body} />;
  return (
    <details className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">
        {t("ffRunHistory", { count: currentRuns.length })}
      </summary>
      {body}
    </details>
  );
}

function RunHistoryDialogButton({ title, body }: { title: string; body: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="nf-button nf-button-secondary text-xs" onClick={() => setOpen(true)}>{title}</button><Dialog open={open} onClose={() => setOpen(false)} title={title} maxWidth="lg">{body}</Dialog></>;
}

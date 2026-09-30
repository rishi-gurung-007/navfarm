"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort, unwrap } from "./feed-format";

interface ForecastRunSummary {
  run_id: string;
  run_code: string;
  version: number;
  view: string;
  from_date: string;
  to_date: string;
  created_at: string;
}

export function FeedForecastRunHistory({ farmId, reloadToken }: { farmId: string; reloadToken: number }) {
  const { t } = useLanguage();
  const [runs, setRuns] = useState<ForecastRunSummary[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api.get(`/feed-forecast/runs?${new URLSearchParams({ farmId }).toString()}`)
      .then((response) => {
        if (cancelled) return;
        const data = unwrap<ForecastRunSummary[]>(response);
        setRuns(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [farmId, reloadToken]);

  return (
    <details className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-primary)]">
        {t("ffRunHistory", { count: runs.length })}
      </summary>
      {failed ? <InlineAlert>{t("ffRunHistoryFailed")}</InlineAlert> : runs.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-[var(--text-secondary)]">{t("ffNoSavedRuns")}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]" aria-label={t("ffRunHistoryLabel")}>
          {runs.map((run) => (
            <li key={run.run_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-mono font-semibold text-[var(--text-primary)]">{run.run_code}</span>
              <span className="text-[var(--text-secondary)]">
                {t("ffRunHistoryRow", { version: run.version, view: run.view, from: formatDateShort(run.from_date), to: formatDateShort(run.to_date) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

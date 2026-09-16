"use client";

import React from "react";
import { useLanguage } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SubCard } from "./sub-card";
import type { ActivityGroup, EntryFormResponse } from "./types";

/**
 * One Activity parent card (spec §5): a scheduler line *type* — Consumption,
 * Output, Health, … — with every due line of that type beneath it as a
 * sub-card.
 *
 * The parent's state is derived from its children (`form.activities`, computed
 * on the API): Not started until something is saved, In progress while any
 * required line is open, Complete once every required sub-card has posted.
 * Optional lines never hold the parent open.
 *
 * "Post completed sub-cards" is the bulk action the daily workflow actually
 * wants: the worker fills in the morning's feed lines and posts them in one
 * go. It collects only the drafts whose inputs are still valid — an empty or
 * invalid draft is left exactly as it was, and a failed bulk post changes
 * nothing (the API runs it all-or-nothing).
 */
export function ActivityCard({
  group,
  form,
  batchId,
  onChanged,
}: {
  group: ActivityGroup;
  form: EntryFormResponse;
  batchId: string;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const linesById = React.useMemo(() => new Map(form.lines.map((l) => [l.line_id, l])), [form.lines]);
  const groupLines = group.line_ids.map((id) => linesById.get(id)).filter((l): l is NonNullable<typeof l> => Boolean(l));

  const stateChip =
    group.state === "COMPLETE"
      ? { label: t("deWComplete"), cls: "bg-emerald-600/10 text-emerald-700" }
      : group.state === "IN_PROGRESS"
        ? { label: t("deWInProgress"), cls: "bg-amber-600/10 text-amber-700" }
        : { label: t("deWNotStarted"), cls: "bg-[var(--surface-raised)] text-(--text-muted)" };

  const currentStage = form.stages.find((s) => s.stage_id === form.selected_stage_id);
  const stageHeadCount = currentStage?.animal_count ?? 0;

  const feedForecast = React.useMemo(() => {
    if (group.line_type !== "CONSUMPTION" || stageHeadCount <= 0) return null;
    let dailyKg = 0;
    for (const line of groupLines) {
      if (line.standard_qty != null && Number(line.standard_qty) > 0) {
        dailyKg += Number(line.standard_qty) * stageHeadCount;
      }
    }
    if (dailyKg <= 0) return null;
    return {
      dailyKg: Math.round(dailyKg * 10) / 10,
      sevenDaysKg: Math.round(dailyKg * 7),
      thirtyDaysKg: Math.round(dailyKg * 30),
      stageHeadCount,
    };
  }, [group.line_type, groupLines, stageHeadCount]);

  const draftIds = groupLines
    .filter((l) => l.entry?.status === "DRAFT")
    .filter((l) => isValidDraft(l))
    .map((l) => l.line_id);

  const bulkPost = async () => {
    if (!draftIds.length) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/batch/${batchId}/daily-data/post`, {
        entry_date: form.date,
        line_ids: draftIds,
      });
      onChanged();
    } catch (e: unknown) {
      // The API posts all-or-nothing, so a failure leaves every card as it
      // was; the message says why instead of half the cards flipping state.
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-(--text-primary)">{activityTitle(group.line_type, t)}</h3>
          <p className="text-[11px] text-(--text-muted)">
            {t("deWGroupCounts", { required: String(group.required), posted: String(group.posted), drafts: String(group.drafts) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateChip.cls}`}>{stateChip.label}</span>
          {draftIds.length > 0 && (
            <Button size="sm" variant="outline" disabled={busy} onClick={bulkPost}>
              {busy ? t("deSaving") : t("deWPostCompleted", { count: String(draftIds.length) })}
            </Button>
          )}
        </div>
      </div>

      {feedForecast && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-emerald-600/20 bg-emerald-600/5 p-3 text-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-emerald-800 dark:text-emerald-300">
              {t("deWFeedForecastStage", { count: String(feedForecast.stageHeadCount) })}
            </span>
            <span className="text-[11px] text-(--text-muted)">{t("deWFeedProjectionHint")}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2">
              <div className="text-[10px] text-(--text-muted)">{t("deWFeedDailyDemand")}</div>
              <div className="font-semibold text-(--text-primary)">{feedForecast.dailyKg} kg</div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2">
              <div className="text-[10px] text-(--text-muted)">{t("deWFeed7DayForecast")}</div>
              <div className="font-semibold text-(--text-primary)">{feedForecast.sevenDaysKg} kg</div>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-2">
              <div className="text-[10px] text-(--text-muted)">{t("deWFeed30DayForecast")}</div>
              <div className="font-semibold text-(--text-primary)">{feedForecast.thirtyDaysKg} kg</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {groupLines.map((line) => (
          <SubCard key={line.line_id} form={form} line={line} batchId={batchId} onChanged={onChanged} />
        ))}
      </div>

      {error && <p className="mt-2 text-[12px] text-(--danger)">{error}</p>}
    </section>
  );
}

/** A draft is postable when it holds a value — an empty draft is a note, not a measurement. */
function isValidDraft(line: { entry: { entered_value: number | null; entered_text: string | null } | null }): boolean {
  const e = line.entry;
  if (!e) return false;
  return e.entered_value != null || (e.entered_text != null && e.entered_text !== "");
}

const ACTIVITY_TITLE_KEYS: Record<string, string> = {
  CONSUMPTION: "deWActConsumption",
  OUTPUT: "deWActOutput",
  DESCRIPTIVE: "deWActHealth",
  OVERHEAD: "deWActOverhead",
  RESOURCE: "deWActResource",
  TRANSFER: "deWActTransfer",
};

function activityTitle(lineType: string, t: (key: never) => string): string {
  const key = ACTIVITY_TITLE_KEYS[lineType];
  return key ? t(key as never) : lineType;
}

export default ActivityCard;

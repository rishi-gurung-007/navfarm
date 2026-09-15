"use client";

import React from "react";
import { useLanguage } from "@/hooks/useLanguage";
import type { DayState, HistoryDay } from "./types";

/**
 * The last few days of this batch, and where each one stands.
 *
 * A day says what it is in words rather than by colour alone — "Missing · 3
 * required" is the sentence a worker needs, and the shed is not a place where
 * a red dot reads reliably. The counts come from the API's own day state
 * (`dayState`, spec §8) so the browser never decides whether a day is late.
 *
 * `NOT_DUE` days are dropped entirely. A day the schedule asks nothing of is
 * not an outstanding task, and listing it as one buries the days that are.
 *
 * One DOM instance, two shapes: a horizontally scrolling strip above the work
 * on a phone, a sticky column beside it on a desktop. The screen this replaced
 * rendered the rail twice and hid one copy per breakpoint, which meant every
 * day button existed twice in the accessibility tree.
 */

const TONE: Record<DayState, string> = {
  COMPLETE: "text-emerald-600",
  IN_PROGRESS: "text-amber-600",
  MISSING: "text-(--danger)",
  NOT_STARTED: "text-(--text-muted)",
  // Never rendered — NOT_DUE days are filtered out above — but the record must
  // still accept every DayState so the lookup below it stays total.
  NOT_DUE: "text-(--text-muted)",
};

export function HistoryRail({
  days,
  selected,
  today,
  onSelect,
}: {
  days: HistoryDay[];
  selected: string;
  today?: string;
  onSelect: (date: string) => void;
}) {
  const { t } = useLanguage();
  const shown = days.filter((day) => day.state !== "NOT_DUE");
  if (!shown.length) return null;

  const stateText = (day: HistoryDay): string => {
    switch (day.state) {
      case "COMPLETE":
        return t("deWDayComplete", { posted: String(day.posted), required: String(day.required) });
      case "IN_PROGRESS":
        return t("deWDayInProgress", { posted: String(day.posted), drafts: String(day.drafts) });
      case "MISSING":
        return t("deWDayMissing", { required: String(day.required) });
      default:
        return t("deWDayNotStarted");
    }
  };

  return (
    <div>
      <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
        {t("deWDays")}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-x-visible">
        {shown.map((day) => {
          const active = day.date === selected;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelect(day.date)}
              aria-current={active ? "true" : undefined}
              className={[
                "min-w-[150px] shrink-0 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition lg:w-full lg:min-w-0",
                active
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] hover:border-[var(--accent)]",
              ].join(" ")}
            >
              <span className="block text-[13px] font-semibold text-(--text-primary)">
                {day.date}
                {day.date === today && (
                  <span className="ml-1 text-[11px] font-normal text-(--text-secondary)">· {t("deToday")}</span>
                )}
              </span>
              <span className={`mt-0.5 block text-[11px] ${TONE[day.state]}`}>{stateText(day)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default HistoryRail;

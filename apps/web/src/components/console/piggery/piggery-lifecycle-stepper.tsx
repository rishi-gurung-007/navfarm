"use client";

import React from "react";
import { Check, Clock } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";

export interface PiggeryStage {
  id: number;
  code: string;
  name: string;
  /** Translation key for `name` — the array is module scope, so the
      display string is resolved at render time, not here. */
  nameKey?: TranslationKeys;
  type: string;
  daysRange: string;
  dateRange?: string;
  status: "COMPLETED" | "CURRENT" | "UPCOMING";
  standardDays: number;
}

export const DEFAULT_PIGGERY_STAGES: PiggeryStage[] = [
  { id: 1, code: "ST-01", name: "Quarantine", nameKey: "astmDefaultStageQuarantine", type: "Rearing", daysRange: "0 - 7 Days", dateRange: "02/03/25 to 08/03/25", status: "COMPLETED", standardDays: 7 },
  { id: 2, code: "ST-02", name: "Gilt Grower", nameKey: "pigStageGiltGrower", type: "Rearing", daysRange: "8 - 120 Days", dateRange: "09/03/25 to 05/05/25", status: "COMPLETED", standardDays: 112 },
  { id: 3, code: "ST-03", name: "Flush / AI", nameKey: "pigStageFlushAi", type: "Breeding", daysRange: "121 - 128 Days", dateRange: "06/05/25 to 13/05/25", status: "COMPLETED", standardDays: 7 },
  { id: 4, code: "ST-04", name: "Gestation", nameKey: "pigStageGestation", type: "Production", daysRange: "129 - 242 Days", dateRange: "14/05/25 to 04/09/25", status: "CURRENT", standardDays: 114 },
  { id: 5, code: "ST-05", name: "Farrowing", nameKey: "pigStageFarrowing", type: "Production", daysRange: "243 - 250 Days", dateRange: "05/09/25 to 12/09/25", status: "UPCOMING", standardDays: 7 },
  { id: 6, code: "ST-06", name: "Lactation", nameKey: "pigStageLactation", type: "Production", daysRange: "251 - 278 Days", dateRange: "13/09/25 to 10/10/25", status: "UPCOMING", standardDays: 28 },
  { id: 7, code: "ST-07", name: "Weaning", nameKey: "pigStageWeaning", type: "Recovery", daysRange: "279 - 285 Days", dateRange: "11/10/25 to 17/10/25", status: "UPCOMING", standardDays: 6 },
  { id: 8, code: "ST-08", name: "Next Cycle", nameKey: "pigStageNextCycle", type: "Recovery", daysRange: "286+ Days", dateRange: "18/10/25 onwards", status: "UPCOMING", standardDays: 14 },
];

export default function PiggeryLifecycleStepper({
  stages = DEFAULT_PIGGERY_STAGES,
  currentStageId = 4,
  onSelectStage,
}: {
  stages?: PiggeryStage[];
  currentStageId?: number;
  onSelectStage?: (stage: PiggeryStage) => void;
}) {
  const { t } = useLanguage();
  const currentIdx = stages.findIndex((s) => s.status === "CURRENT" || s.id === currentStageId);
  const activeIndex = currentIdx >= 0 ? currentIdx : 0;

  // The green run spans only the stages the batch genuinely walked: from the
  // first one it entered to the one it is in now. Anchoring it at index 0
  // painted a completed line straight through stages that were skipped — a
  // sow cohort that starts at Flush/AI showed Quarantine and Gilt Grower as
  // part of its history.
  const firstDoneIdx = stages.findIndex((s) => s.status === "COMPLETED");
  const step = stages.length > 1 ? 100 / (stages.length - 1) : 0;
  const hasCompleted = firstDoneIdx >= 0;
  const progressLeft = hasCompleted ? firstDoneIdx * step : activeIndex * step;
  const progressWidth = hasCompleted ? Math.max(0, activeIndex - firstDoneIdx) * step : 0;

  // 11 stages inside a fixed 780px track gave each column ~70px while the label
  // was allowed 110px, so adjacent stage names overlapped. Scale the track with
  // the number of stages instead.
  const trackMinWidth = Math.max(780, stages.length * 108);

  return (
    <div className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 overflow-x-auto shadow-2xs">
      <div className="relative" style={{ minWidth: `${trackMinWidth}px` }}>
        {/* Continuous Background Timeline Line */}
        <div className="absolute top-4 left-6 right-6 h-[3px] bg-[var(--border)] z-0 rounded-full" />

        {/* Dynamic Completed/Active Progress Line */}
        <div
          data-testid="stepper-progress"
          className="absolute top-4 h-[3px] bg-[var(--success)] z-0 transition-all duration-500 rounded-full"
          style={{ left: `${progressLeft}%`, width: `${progressWidth}%` }}
        />

        {/* Stages Grid - strictly top-aligned */}
        <div className="flex items-start justify-between relative z-10">
          {stages.map((stage) => {
            // Completion comes from the stage's own status, not its position in
            // the sequence. A batch that starts mid-lifecycle — a sow cohort
            // entering at Flush/AI — never passed through Quarantine or Gilt
            // Grower, but those sit earlier in the master order and so were
            // rendered "Done" on every batch.
            const isCurrent = stage.status === "CURRENT" || stage.id === currentStageId;
            const isCompleted = !isCurrent && stage.status === "COMPLETED";

            return (
              <div
                key={stage.id}
                onClick={() => onSelectStage?.(stage)}
                className={`flex min-w-0 flex-col items-center group flex-1 ${onSelectStage ? "cursor-pointer" : ""}`}
              >
                {/* 1. Circle Indicator (strictly 32px height, top-aligned) */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${
                    isCompleted
                      ? "bg-[var(--success)] text-white ring-4 ring-[var(--success-muted)] shadow-xs"
                      : isCurrent
                      ? "bg-[var(--accent)] text-white ring-4 ring-[var(--accent-muted)] shadow-md scale-110"
                      : "bg-[var(--surface)] border-2 border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--text-secondary)]"
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4 stroke-[3]" />
                  ) : isCurrent ? (
                    <Clock className="h-4 w-4 animate-spin" />
                  ) : (
                    <span>{stage.id}</span>
                  )}
                </div>

                {/* 2. Text Details below circle */}
                <div className="mt-2.5 text-center flex flex-col items-center w-full">
                  <p
                    className={`text-xs tracking-tight truncate w-full px-0.5 ${
                      isCurrent
                        ? "text-[var(--accent)] font-bold"
                        : isCompleted
                        ? "text-[var(--text-primary)] font-semibold"
                        : "text-[var(--text-secondary)] font-medium"
                    }`}
                    title={stage.nameKey ? t(stage.nameKey) : stage.name}
                  >
                    {stage.nameKey ? t(stage.nameKey) : stage.name}
                  </p>

                  <p className="text-[10px] text-[var(--text-muted)] font-mono whitespace-nowrap mt-0.5">
                    {stage.daysRange}
                  </p>

                  {/* 3. Status Pill with fixed height to prevent vertical misalignment */}
                  <div className="h-5 mt-1.5 flex items-center justify-center">
                    {isCurrent ? (
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold uppercase tracking-wider shadow-2xs animate-pulse">
                        {t("plsCurrent")}
                      </span>
                    ) : isCompleted ? (
                      <span className="px-1.5 py-0.5 rounded-full bg-[var(--success-muted)] text-[var(--success)] border border-[var(--success)]/20 text-[9px] font-semibold">
                        {t("plsDone")}
                      </span>
                    ) : (
                      <span className="text-[9px] text-[var(--text-muted)]">{t("plsUpcoming")}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

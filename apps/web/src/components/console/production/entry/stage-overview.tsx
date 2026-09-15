"use client";

import React from "react";
import { CheckCircle2, CircleSlash, Clock } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import type { StageStatus } from "./types";

/**
 * Where the day starts: every stage of this batch, how many animals stand in
 * it, and how much of what the schedule asks has been recorded.
 *
 * It is a grid rather than the row of chips it replaced because this is now a
 * destination — you pick a stage, the URL gains `?stage=`, and Back brings you
 * here — not a filter sitting on top of the lines. A stage with no scheduler
 * covering it is still listed: animals genuinely stand there, and leaving it
 * out reads as "these animals are not yours" rather than "nothing is due".
 */
export function StageOverview({
  stages,
  onSelect,
}: {
  stages: StageStatus[];
  onSelect: (stageId: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <section>
      <h2 className="px-1 pb-2 text-sm font-semibold text-(--text-primary)">{t("deWChooseStage")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stages.map((stage) => {
          const Icon = !stage.scheduled ? CircleSlash : stage.complete ? CheckCircle2 : Clock;
          const tone = !stage.scheduled
            ? "text-(--text-muted)"
            : stage.complete
              ? "text-emerald-600"
              : "text-amber-600";
          return (
            <button
              key={stage.stage_id ?? "none"}
              type="button"
              onClick={() => stage.stage_id && stage.scheduled && onSelect(stage.stage_id)}
              disabled={!stage.scheduled || !stage.stage_id}
              className={[
                "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition",
                stage.scheduled && stage.stage_id
                  ? "cursor-pointer hover:border-[var(--accent)]"
                  : "cursor-not-allowed opacity-60",
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <Icon size={16} className={`shrink-0 ${tone}`} />
                <span className="truncate text-sm font-semibold text-(--text-primary)">
                  {stage.stage_name ?? "—"}
                </span>
              </div>
              {/* The head count sits under the stage name: it is what the
                  worker counts against when they weigh out the feed. */}
              <p className="mt-2 text-2xl font-semibold leading-none text-(--text-primary)">
                {stage.animal_count ?? "—"}
                <span className="ml-1.5 text-[11px] font-normal text-(--text-muted)">{t("deWAnimals")}</span>
              </p>
              <p className="mt-1.5 text-[11px] text-(--text-muted)">
                {!stage.scheduled
                  ? t("deNoSchedule")
                  : stage.complete
                    ? t("deWStageComplete")
                    : t("deStagePending", { done: String(stage.entered), total: String(stage.due) })}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default StageOverview;

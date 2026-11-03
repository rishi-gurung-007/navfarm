/**
 * The Boar Condition tab's small rules (plan 2026-11-02-ai-station-semen-collection, Phase 6; SOP 21): how a status looks, what an
 * assessment will do (read from the line's own scale), and the "is it filled in" checks of the assess dialog. The line's rules
 * themselves (which scores exist, whether the feed may be overridden, the dates) are the API's, which refuses a breach in words.
 */

export type ConditionStatus = "NEVER" | "NOT_SCHEDULED" | "OK" | "DUE_SOON" | "DUE" | "OVERDUE";

export const STATUS_LABEL: Record<ConditionStatus, string> = {
  NEVER: "Never assessed",
  NOT_SCHEDULED: "No schedule",
  OK: "OK",
  DUE_SOON: "Due soon",
  DUE: "Due",
  OVERDUE: "Overdue",
};

/** The colour token a status is shown in. */
export const STATUS_COLOUR: Record<ConditionStatus, string> = {
  NEVER: "var(--warning)",
  NOT_SCHEDULED: "var(--text-muted)",
  OK: "var(--success)",
  DUE_SOON: "var(--accent)",
  DUE: "var(--warning)",
  OVERDUE: "var(--danger)",
};

/** A status that wants someone to act. */
export const needsAttention = (s: string) => s === "OVERDUE" || s === "DUE" || s === "NEVER";

export interface ScaleOption {
  score: number;
  score_name: string | null;
  /** What a boar at this score looks like. */
  indicators?: string | null;
  required_action: string | null;
  feed_kg_per_day: number | null;
  health_assessment_required: boolean;
  medication_review: boolean;
}

/** What recording a score will do, for the line beneath the scale, in words: the feed level it sets and what it flags. */
export function consequenceOf(option: ScaleOption | undefined, currentFeed: number | null): string[] {
  if (!option) return [];
  const out: string[] = [];
  if (option.feed_kg_per_day != null) {
    out.push(
      currentFeed != null && currentFeed !== option.feed_kg_per_day
        ? `Feed level: ${currentFeed} → ${option.feed_kg_per_day} kg a day.`
        : `Feed level: ${option.feed_kg_per_day} kg a day.`,
    );
  } else {
    out.push("This score leaves the feed level as it is.");
  }
  if (option.required_action) out.push(`Required action: ${option.required_action}`);
  if (option.health_assessment_required) out.push("Flags a health assessment.");
  if (option.medication_review) out.push("Flags a medication review.");
  return out;
}

export interface AssessDraft {
  score: number | null;
  date: string;
  today: string;
  /** The feed level typed in; blank = the scale's. */
  feed: string;
  reason: string;
}

export interface AssessRules {
  allow_feed_override: boolean;
  override_reason_required: boolean;
}

export function assessDraftIssues(draft: AssessDraft, scale: ScaleOption[], rules: AssessRules): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (!scale.length) return [{ field: "score", text: "No body condition scale is set up for this boar's line. Add one under Body Condition Scale." }];
  if (draft.score == null) out.push({ field: "score", text: "Choose the score." });
  if (!draft.date) out.push({ field: "date", text: "Enter the assessment date." });
  else if (draft.date > draft.today) out.push({ field: "date", text: "The assessment date cannot be in the future." });
  const typed = draft.feed.trim() === "" ? null : Number(draft.feed);
  const scaleFeed = scale.find((s) => s.score === draft.score)?.feed_kg_per_day ?? null;
  if (typed != null) {
    if (Number.isNaN(typed) || typed <= 0) out.push({ field: "feed", text: "The feed level must be above 0 kg a day." });
    else if (typed !== scaleFeed && rules.override_reason_required && !draft.reason.trim()) out.push({ field: "reason", text: "Give the reason for changing the feed level from the scale's." });
  }
  return out;
}

/**
 * The daily data entry API contract.
 *
 * Copied verbatim from the fixed contract block in
 * `docs/superpowers/plans/2026-09-15-phase-06-daily-data-entry.md`, because the
 * API half of this phase is being written against that same block at the same
 * time. Where the running API and this file disagree, the contract wins and the
 * API is corrected — which is only true if nothing here is quietly "improved"
 * on the way across. Do not rename a field to read better.
 */

export type EntryStatus = "DRAFT" | "POSTED";
export type TargetScope = "BATCH" | "STAGE_ANIMALS" | "SELECTED_ANIMALS";

export interface EntryView {
  entry_id: string;
  status: EntryStatus;
  version: number;
  entered_value: number | null;
  entered_text: string | null;
  lot_no: string | null;
  remarks: string | null;
  target_scope: TargetScope;
  /** SELECTED_ANIMALS: the selection; POSTED STAGE_ANIMALS: the snapshot. */
  animal_ids: string[];
  supersedes_entry_id: string | null;
}

/**
 * A stage as the form reports it. Unchanged by this phase — `due`/`entered`
 * count every line the schedule calls for, `mandatory`/`mandatoryEntered` only
 * the required ones, and `scheduled` is false for a stage animals stand in that
 * no scheduler covers.
 */
export interface StageStatus {
  stage_id: string | null;
  stage_name: string | null;
  animal_count: number | null;
  due: number;
  mandatory: number;
  mandatoryEntered: number;
  entered: number;
  complete: boolean;
  scheduled: boolean;
}

/** A scheduler line as the form has always returned it, minus its entry. */
export interface ExistingFormLine {
  line_id: string;
  line_type: string;
  activity_name: string;
  is_mandatory: boolean;
  item_name: string | null;
  uom: string | null;
  standard_qty: number | null;
  qty_basis: string | null;
  suggested_value: number | null;
  allow_qty_edit: boolean;
  lot_required: boolean;
  kpi_metric: string | null;
  lower_alert_limit: number | null;
  upper_alert_limit: number | null;
  editable: boolean;
  locked_reason: string | null;
}

export type FormLine = ExistingFormLine & { entry: EntryView | null; correctable: boolean };

export type ActivityLineType =
  | "CONSUMPTION"
  | "OUTPUT"
  | "DESCRIPTIVE"
  | "OVERHEAD"
  | "RESOURCE"
  | "TRANSFER";

export type ActivityState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export interface ActivityGroup {
  line_type: ActivityLineType;
  state: ActivityState;
  required: number;
  posted: number;
  drafts: number;
  /** in line_seq order */
  line_ids: string[];
}

export interface TargetingInfo {
  mode: "COUNT_ONLY" | "REGISTERED";
  default_scope: "BATCH" | "STAGE_ANIMALS";
  /** [] for COUNT_ONLY */
  stage_animals: Array<{ animal_id: string; animal_code: string; ear_tag: string | null }>;
}

/** GET /batch/:batchId/daily-data/form?date=&stageId= — fields added, none removed. */
export interface EntryFormResponse {
  batch: { batch_id: string; batch_no: string; animal_tracking: string; start_date: string };
  date: string;
  today: string;
  hasScheduler: boolean;
  mayEditAnyDay: boolean;
  /**
   * Still returned by the API, still ignored by this screen: Ruling 4 removed
   * the banner and the jump to the oldest owed day. Owed days are Missing rows
   * in the History rail and are entered from there.
   */
  backlog: string[];
  selected_stage_id: string | null;
  stages: StageStatus[];
  lines: FormLine[];
  complete: boolean;
  activities: ActivityGroup[];
  targeting: TargetingInfo;
}

export type DayState = "COMPLETE" | "IN_PROGRESS" | "MISSING" | "NOT_STARTED" | "NOT_DUE";

/** GET /batch/:batchId/daily-data/history?to=YYYY-MM-DD&days=30 — newest first. */
export interface HistoryDay {
  date: string;
  state: DayState;
  required: number;
  posted: number;
  drafts: number;
}

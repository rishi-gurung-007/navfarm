import { NA } from "@/utils/na";
import type { PiggeryStage } from "./piggery-lifecycle-stepper";

/**
 * Turns a batch's real stage history into the lifecycle stepper's model.
 *
 * The stepper previously rendered DEFAULT_PIGGERY_STAGES — a hardcoded eight
 * stages with fixed 2025 dates and three of them permanently marked "Done" —
 * for every batch, regardless of where the batch actually was. That contradicted
 * the rest of the page: the stage filter beside it lists only the stages the
 * batch genuinely entered, so the two disagreed on screen.
 *
 * Completion is derived from batch_stage_log, not from sequence position: a
 * batch that started mid-lifecycle never "completed" the stages before it.
 */

export interface StageMasterRow {
  stage_id: string;
  stage_code: string;
  stage_name: string;
  stage_sequence: number;
  stage_category?: string | null;
  typical_duration_days?: number | null;
  /** Forward link in the lifecycle, used to scope the stepper to this batch. */
  next_stage_id?: string | null;
}

export interface StageLogRow {
  from_stage_code: string | null;
  to_stage_code: string;
  transferred_at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`);

// Local formatting, not toISOString(): the dates here are parsed as local
// midnight, and converting back through UTC shifts them a day backwards
// anywhere east of Greenwich — the day before a stage transition came out as
// the day before that.
const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Day 1 is the batch start date, matching batch.service.ts#evaluateKpi. */
const dayOfBatch = (start: string, at: string) =>
  Math.floor((toDate(at).getTime() - toDate(start).getTime()) / DAY_MS) + 1;

export function buildLifecycleStages({
  stageMaster,
  stageLog,
  batchStartDate,
  currentStageCode,
  today,
}: {
  stageMaster: StageMasterRow[];
  stageLog: StageLogRow[];
  batchStartDate: string;
  currentStageCode: string | null;
  today?: string;
}): { stages: PiggeryStage[]; currentStageId: number } {
  if (!stageMaster.length) return { stages: [], currentStageId: 0 };

  const all = [...stageMaster].sort((a, b) => a.stage_sequence - b.stage_sequence);
  const log = [...stageLog].sort(
    (a, b) => toDate(a.transferred_at).getTime() - toDate(b.transferred_at).getTime()
  );

  // The path the batch actually walked: where it started, then each stage it
  // was moved into. With no history it has only ever been at its current stage.
  const path: string[] = [];
  if (log.length && log[0].from_stage_code) path.push(log[0].from_stage_code);
  for (const entry of log) path.push(entry.to_stage_code);
  if (!path.length && currentStageCode) path.push(currentStageCode);

  // When each stage on the path began. The first began at the batch start; each
  // later one at the transfer that moved the batch into it.
  const enteredOn = new Map<string, string>();
  if (path.length) enteredOn.set(path[0], batchStartDate);
  for (const entry of log) enteredOn.set(entry.to_stage_code, entry.transferred_at.slice(0, 10));

  const visited = new Set(path);
  const endOfDay = today ?? toYmd(new Date());

  // Every stage configured for the LOB is shown, in sequence order. Scoping
  // this to the batch's forward chain was tried and reverted: operators want
  // the whole lifecycle visible, and a stage the batch will not reach is
  // already distinguishable — it simply never leaves "Upcoming".
  const ordered = all;

  const stages: PiggeryStage[] = ordered.map((row, index) => {
    const isCurrent = currentStageCode === row.stage_code;
    const status: PiggeryStage["status"] = isCurrent
      ? "CURRENT"
      : visited.has(row.stage_code)
      ? "COMPLETED"
      : "UPCOMING";

    const from = enteredOn.get(row.stage_code);
    // A stage ends when the batch moved on from it; the current stage runs to today.
    const movedOn = log.find((e) => e.from_stage_code === row.stage_code);
    const to = movedOn ? movedOn.transferred_at.slice(0, 10) : isCurrent ? endOfDay : undefined;

    let daysRange = row.typical_duration_days ? `${row.typical_duration_days} days (standard)` : NA;
    let dateRange: string | undefined;

    if (from) {
      const startDay = dayOfBatch(batchStartDate, from);
      // A completed stage ends the day before the batch entered the next one.
      const endDay = to ? dayOfBatch(batchStartDate, to) - (movedOn ? 1 : 0) : null;
      daysRange = endDay !== null ? `Day ${startDay} – ${endDay}` : `Day ${startDay}`;
      dateRange = to && to !== from ? `${from} → ${to}` : from;
    }

    return {
      id: index + 1,
      code: row.stage_code,
      name: row.stage_name,
      type: row.stage_category || "",
      daysRange,
      dateRange,
      status,
      standardDays: row.typical_duration_days ?? 0,
    };
  });

  const current = stages.find((s) => s.status === "CURRENT");
  return { stages, currentStageId: current?.id ?? 0 };
}

/**
 * The date window each stage of a batch occupied, in order.
 *
 * Used to split a batch's transactions per stage. Without it the records screen
 * built a single profile covering the batch's whole life, so its Stage filter
 * offered exactly one option no matter how many stages the batch had passed
 * through.
 */
export function stageWindows({
  stageLog,
  batchStartDate,
  currentStageCode,
  batchEndDate,
  today,
}: {
  stageLog: StageLogRow[];
  batchStartDate: string;
  currentStageCode: string | null;
  batchEndDate?: string | null;
  today?: string;
}): Array<{ code: string; from: string; to: string }> {
  const log = [...stageLog].sort(
    (a, b) => toDate(a.transferred_at).getTime() - toDate(b.transferred_at).getTime()
  );

  const entries: Array<{ code: string; from: string }> = [];
  if (log.length && log[0].from_stage_code) {
    entries.push({ code: log[0].from_stage_code, from: batchStartDate });
  } else if (currentStageCode) {
    entries.push({ code: currentStageCode, from: batchStartDate });
  }
  for (const e of log) entries.push({ code: e.to_stage_code, from: e.transferred_at.slice(0, 10) });

  const last = batchEndDate || today || toYmd(new Date());
  return entries.map((entry, i) => {
    if (i + 1 < entries.length) {
      // A stage ends the day before the batch entered the next one.
      const next = toDate(entries[i + 1].from);
      const end = new Date(next.getTime() - DAY_MS);
      return { code: entry.code, from: entry.from, to: toYmd(end) };
    }
    return { code: entry.code, from: entry.from, to: last };
  });
}

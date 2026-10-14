import { FeedRow, feedRowFor } from '../../production/lifecycle/feed-row-days';

/**
 * Next Diet Feed Item from the breed lifecycle (client ruling, Rishi 12 Oct): a batch's next diet is always
 * knowable — take its current stage, the stage its Next Stage field names (stage_master.next_stage_id; Rishi
 * 12 Oct chose the field over Display Order), and that stage's breed lifecycle row. It does not wait for the engine
 * to see a diet change inside the forecast window, so it still answers when the next stage starts after it.
 * Pure: the service supplies the batches, stages and lifecycle rows the engine already loaded.
 */
export interface NextStageStage {
  stageId: string;
  stageCode: string;
  stageName?: string | null;
  durationDays: number | null;
  isActive: boolean;
  /** stage_master.next_stage_id — the Next Stage field. */
  nextStageId?: string | null;
  /** stage_master.stage_sequence — Display Order. */
  sequence?: number | null;
  companyId?: string | null;
  lobId?: string | null;
}

export interface NextStageDiet {
  batchNo: string;
  shedCode: string;
  heads: number;
  breedId: string;
  currentStageCode: string;
  nextStageId: string | null;
  nextStageName: string | null;
  itemId: string | null;
  itemName: string | null;
  /** First day of the next stage when the current stage has a typical duration, else null. */
  date: string | null;
  /** Why itemId is null (no next stage / no lifecycle row); null when an item was found. */
  reason: string | null;
}

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
};

/** The stage `current`'s Next Stage field names, when it exists and is active. */
export function nextStageFromField(current: NextStageStage, stages: Map<string, NextStageStage>): NextStageStage | null {
  const next = current.nextStageId ? stages.get(current.nextStageId) : undefined;
  return next && next.isActive ? next : null;
}

export function resolveNextStageDiets(args: {
  batches: Array<{
    batchNo: string; breedId: string; shedId: string; heads: number;
    segments: Array<{ stageId: string; stageCode: string; start: string }>;
  }>;
  stages: Map<string, NextStageStage>;
  feedRows: FeedRow[];
  farmId?: string | null;
  planningDate: string;
  shedCodeById: Map<string, string>;
  items: Record<string, string>;
  breedNames?: Record<string, string>;
}): NextStageDiet[] {
  const { batches, stages, feedRows, farmId, shedCodeById, items } = args;
  const out: NextStageDiet[] = [];
  for (const b of batches) {
    const shedCode = shedCodeById.get(b.shedId);
    if (!shedCode) continue; // no shed, no silo to link it to
    const segment = b.segments[0];
    const current = stages.get(segment.stageId);
    const base = { batchNo: b.batchNo, shedCode, heads: b.heads, breedId: b.breedId, currentStageCode: segment.stageCode };
    const blank = { nextStageId: null, nextStageName: null, itemId: null, itemName: null, date: null };
    const stageLabel = current?.stageName ?? segment.stageCode;
    const next = current ? nextStageFromField(current, stages) : null;
    if (!next) {
      out.push({ ...base, ...blank, reason: `No Next Stage set for stage ${stageLabel} — no next diet` });
      continue;
    }
    const nextName = next.stageName ?? next.stageCode;
    const date = current?.durationDays && current.durationDays >= 1 ? addDays(segment.start, current.durationDays) : null;
    const rows = feedRows.filter((r) => r.breedId === b.breedId && r.stageId === next.stageId);
    // The row that feeds day 1 of the stage; if the lifecycle starts later in the stage, its earliest row.
    let row: FeedRow | undefined;
    const first = feedRowFor(rows, 1, farmId);
    if ('row' in first) row = first.row;
    else if (first.error === 'NONE') {
      const own = farmId ? rows.filter((r) => r.farmId === farmId) : [];
      const pool = own.length ? own : rows.filter((r) => !r.farmId);
      row = [...pool].sort((a, c) => a.fromDay - c.fromDay || a.lifecycleId.localeCompare(c.lifecycleId))[0];
    }
    if (!row) {
      const breed = args.breedNames?.[b.breedId] ?? b.breedId;
      out.push({ ...base, nextStageId: next.stageId, nextStageName: nextName, itemId: null, itemName: null, date, reason: `No feed item set for stage ${nextName} of breed ${breed}` });
      continue;
    }
    out.push({ ...base, nextStageId: next.stageId, nextStageName: nextName, itemId: row.itemId, itemName: items[row.itemId] ?? row.itemName ?? null, date, reason: null });
  }
  return out;
}

/**
 * Several batches can sit in one silo's sheds. Pick the one the silo shows: an item beats none, then the earliest
 * known date (dated before undated), then the batch with the most heads, then batch no. for a stable order.
 */
export function pickNextStageDiet(candidates: NextStageDiet[]): NextStageDiet | null {
  return [...candidates].sort((a, b) =>
    Number(b.itemId !== null) - Number(a.itemId !== null)
    || Number(b.date !== null) - Number(a.date !== null)
    || (a.date && b.date ? a.date.localeCompare(b.date) : 0)
    || b.heads - a.heads
    || a.batchNo.localeCompare(b.batchNo))[0] ?? null;
}

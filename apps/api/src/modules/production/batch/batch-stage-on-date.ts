/**
 * Which stages of an Animal Wise batch had animals on a given day (Rishi, 13 Oct).
 *
 * A day is complete when every stage that held animals that day is locked. The animal register keeps only the
 * CURRENT stage, so reading it for a past day made a day posted before a stage change look incomplete for ever:
 * the animal's new stage was never locked for that day. The stage an animal stood in on a day comes from its
 * STAGE_CHANGE movements instead, and an animal that joined the batch after the day does not count for it.
 */
export interface StageAnimal {
  animal_id: string;
  current_stage_id: string | null;
}

export interface StageMove {
  animal_id: string;
  movement_type: string;
  event_date: string;
  to_batch_id: string | null;
  from_stage_id: string | null;
  to_stage_id: string | null;
  /** Orders two moves on the same day. */
  created_at?: string | null;
}

/** Movement types that bring an animal into a batch. */
const ARRIVALS = new Set(['ASSIGN', 'TRANSFER', 'PURCHASE']);

const day = (d: string) => String(d).slice(0, 10);

/** The stage the animal stood in on `date`, or null when it was not yet in the batch. */
export function stageOnDate(animal: StageAnimal, moves: StageMove[], batchId: string, date: string): string | null {
  const own = moves
    .filter((m) => m.animal_id === animal.animal_id)
    .sort((a, b) => day(a.event_date).localeCompare(day(b.event_date)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const arrivals = own.filter((m) => ARRIVALS.has(m.movement_type) && m.to_batch_id === batchId);
  // Recorded arrivals all after the day: the animal joined later. No arrival recorded: it has been here throughout.
  if (arrivals.length && arrivals.every((m) => day(m.event_date) > date)) return null;

  const changes = own.filter((m) => m.movement_type === 'STAGE_CHANGE' && m.to_batch_id === batchId);
  const before = changes.filter((m) => day(m.event_date) <= date);
  if (before.length) return before[before.length - 1].to_stage_id;
  const after = changes.find((m) => day(m.event_date) > date);
  if (after) return after.from_stage_id;
  return animal.current_stage_id;
}

/** The stages that held at least one of the animals on `date`. */
export function stagesOnDate(animals: StageAnimal[], moves: StageMove[], batchId: string, date: string): Set<string> {
  const stages = new Set<string>();
  for (const a of animals) {
    const s = stageOnDate(a, moves, batchId, date);
    if (s) stages.add(s);
  }
  return stages;
}

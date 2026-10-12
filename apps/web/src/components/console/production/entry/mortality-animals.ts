/**
 * Mortality count (Rishi, 12 Oct): on a batch with registered animals the user names the animals that died; on a
 * count-only batch there is no animal to name. Either way every death gets its dead body weight and a reason. The rules live here so the screen and its tests share one copy; the API checks
 * the same things again and is the authority.
 */

/** The reason value that means "not in the Reason Master - I will type it". Never sent to the API. */
export const OTHER_REASON = '__OTHER__';

export interface MortalityCandidate {
  animal_id: string;
  animal_code: string;
  rfid_tag: string | null;
}

export interface MortalityPick {
  /** The registered animal that died; '' on a count-only batch. */
  animal_id: string;
  dead_weight_kg: string;
  /** A Reason Master id, or OTHER_REASON, or '' while unchosen. */
  reason_id: string;
  reason_text: string;
}

/** The deaths the entry adds beyond what the date already has posted; each needs a weight and reason. */
export function requiredMortalityAnimals(count: number, alreadyPosted: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(count - alreadyPosted));
}

/** A batch with registered animals cannot record more deaths than it has animals alive: the API refuses it too. */
export function tooManyDeaths(required: number, aliveRegistered: number): boolean {
  return aliveRegistered > 0 && required > aliveRegistered;
}

/** A count-only batch has one row per death, so the picks are padded or cut to exactly `required`. */
export function countOnlyPicks(picks: MortalityPick[], required: number): MortalityPick[] {
  const rows = picks.slice(0, required);
  while (rows.length < required) rows.push({ animal_id: '', dead_weight_kg: '', reason_id: '', reason_text: '' });
  return rows;
}

/** True when exactly `required` animals are chosen and each has a dead weight above 0 and a reason. */
export function mortalityPicksComplete(picks: MortalityPick[], required: number): boolean {
  if (picks.length !== required) return false;
  return picks.every((p) => {
    const weight = Number(p.dead_weight_kg);
    if (p.dead_weight_kg.trim() === '' || !Number.isFinite(weight) || weight <= 0) return false;
    if (p.reason_id === OTHER_REASON) return p.reason_text.trim() !== '';
    return p.reason_id !== '';
  });
}

/** The `mortality_animals` the API takes: a master reason by id, or the typed one, never both; no animal on a count-only batch. */
export function mortalityPayload(picks: MortalityPick[]) {
  return picks.map((p) => ({
    ...(p.animal_id ? { animal_id: p.animal_id } : {}),
    dead_weight_kg: Number(p.dead_weight_kg),
    ...(p.reason_id === OTHER_REASON ? { reason_text: p.reason_text.trim() } : { reason_id: p.reason_id }),
  }));
}

/** Animals matching a search on tag or ID (case-insensitive); an empty search matches all. */
export function filterMortalityCandidates(animals: MortalityCandidate[], search: string): MortalityCandidate[] {
  const q = search.trim().toLowerCase();
  if (!q) return animals;
  return animals.filter((a) => a.animal_code.toLowerCase().includes(q) || (a.rfid_tag ?? '').toLowerCase().includes(q));
}

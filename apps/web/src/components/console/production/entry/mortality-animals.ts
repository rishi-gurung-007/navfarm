/**
 * Mortality count on a batch with registered animals (Rishi, 12 Oct): the user names the animals that died, with the
 * dead body weight and a reason each. The rules live here so the screen and its tests share one copy; the API checks
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
  animal_id: string;
  dead_weight_kg: string;
  /** A Reason Master id, or OTHER_REASON, or '' while unchosen. */
  reason_id: string;
  reason_text: string;
}

/**
 * How many animals the entry must name: the deaths it adds beyond what the date already has posted, capped at the
 * registered animals still alive (a batch registered in part cannot name animals it does not have).
 */
export function requiredMortalityAnimals(count: number, alreadyPosted: number, aliveRegistered: number): number {
  if (!Number.isFinite(count)) return 0;
  const added = Math.max(0, Math.round(count - alreadyPosted));
  return Math.min(added, Math.max(0, aliveRegistered));
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

/** The `mortality_animals` the API takes: a master reason by id, or the typed one, never both. */
export function mortalityPayload(picks: MortalityPick[]) {
  return picks.map((p) =>
    p.reason_id === OTHER_REASON
      ? { animal_id: p.animal_id, dead_weight_kg: Number(p.dead_weight_kg), reason_text: p.reason_text.trim() }
      : { animal_id: p.animal_id, dead_weight_kg: Number(p.dead_weight_kg), reason_id: p.reason_id },
  );
}

/** Animals matching a search on tag or ID (case-insensitive); an empty search matches all. */
export function filterMortalityCandidates(animals: MortalityCandidate[], search: string): MortalityCandidate[] {
  const q = search.trim().toLowerCase();
  if (!q) return animals;
  return animals.filter((a) => a.animal_code.toLowerCase().includes(q) || (a.rfid_tag ?? '').toLowerCase().includes(q));
}

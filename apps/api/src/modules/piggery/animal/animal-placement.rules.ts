/**
 * Where a registered animal may stand. Pure, so it is tested without a database; the services resolve the locations and
 * their farms and pass them in.
 *
 * One rule holds everything together: an animal stands on the farm of the batch it belongs to. Farm scope counts an animal
 * on a farm when either its location or its batch is there (`animalOnFarm`), so an animal whose batch is on one farm and
 * whose pen is on another is counted, fed and seen on both. The 10 Nov 2026 rehearsal showed a batch transfer doing exactly
 * that: a farm-to-farm move that named no pen kept the old farm's pen, and a pen on the wrong farm was accepted.
 *
 * So:
 *  - a transfer moves each animal to the location named, else the destination batch's own location, else (a reversal) the
 *    location it came from, else it keeps its own; and it refuses any of those that is not on the destination batch's farm;
 *  - a location move (one pen, crate or shed to another) never changes the farm: that is a transfer, with its value.
 */
export interface Place {
  location_id: string;
  location_code: string;
  location_type: string;
  /** The farm the location belongs to (itself for a farm). */
  farm_id: string | null;
  farm_code: string | null;
  company_id: string | null;
  is_active: boolean;
}

export interface FarmOfBatch {
  batch_no: string;
  farm_id: string | null;
  farm_code: string | null;
  company_id: string;
}

/** Location types an animal never stands in: feed and stock locations. */
export const NOT_FOR_ANIMALS = ['SILO', 'STORE', 'WAREHOUSE', 'MILL', 'BIN'] as const;

/** Why an animal of `batch` may not stand in `place`, or null when it may. */
export function placeProblem(place: Place, batch: FarmOfBatch): string | null {
  if (!place.is_active) return `${place.location_code} is not an active location.`;
  if (place.company_id && place.company_id !== batch.company_id) return `${place.location_code} belongs to another company.`;
  if ((NOT_FOR_ANIMALS as readonly string[]).includes(place.location_type))
    return `${place.location_code} is a ${place.location_type}; an animal stands in a shed, pen or crate.`;
  if (batch.farm_id && place.farm_id !== batch.farm_id)
    return `${place.location_code} is on ${place.farm_code ?? 'another farm'}; ${batch.batch_no} is on ${batch.farm_code}. Choose a location on ${batch.farm_code}.`;
  return null;
}

export interface TransferAnimal {
  animal_id: string;
  animal_code: string;
  /** Where it stands now. */
  current: Place | null;
  /** On a reversal: the location it left from. */
  returnTo: Place | null;
}

/**
 * The location each animal of a transfer ends in: an id, or null to keep its own. `problems` lists what refuses the
 * transfer; when it is not empty nothing may post.
 */
export function planTransferPens(input: {
  destination: FarmOfBatch;
  /** The location the caller named. */
  named: Place | null;
  /** The destination batch's own location, used when none is named. */
  batchDefault: Place | null;
  animals: TransferAnimal[];
}): { pens: Map<string, string | null>; problems: string[] } {
  const { destination, named, batchDefault, animals } = input;
  const problems: string[] = [];
  const pens = new Map<string, string | null>();
  if (named) {
    const p = placeProblem(named, destination);
    if (p) return { pens, problems: [p] };
  }
  const usableDefault = batchDefault && !placeProblem(batchDefault, destination) ? batchDefault : null;
  for (const a of animals) {
    const back = a.returnTo && !placeProblem(a.returnTo, destination) ? a.returnTo : null;
    const target = named ?? back ?? usableDefault;
    if (target) {
      pens.set(a.animal_id, target.location_id);
      continue;
    }
    if (a.current && destination.farm_id && a.current.farm_id !== destination.farm_id) {
      problems.push(
        `${a.animal_code} stands in ${a.current.location_code} on ${a.current.farm_code ?? 'another farm'}; ${destination.batch_no} is on ${destination.farm_code}. Choose the location on ${destination.farm_code} it moves to.`,
      );
    }
    pens.set(a.animal_id, null);
  }
  return { pens, problems };
}

/**
 * Why an animal may not move to `target` without changing batch, or null when it may. The farm it must stay on is its
 * batch's, or, with no batch, the farm of the location it stands in.
 */
export function checkLocationMove(input: {
  animal_code: string;
  company_id: string;
  current: Place | null;
  batchFarm: { farm_id: string | null; farm_code: string | null } | null;
  target: Place | null;
}): string | null {
  const { animal_code, company_id, current, batchFarm, target } = input;
  if (!target) return `Choose the location ${animal_code} moves to.`;
  if (current && target.location_id === current.location_id) return `${animal_code} is already in ${target.location_code}.`;
  const farm = batchFarm?.farm_id ? batchFarm : current ? { farm_id: current.farm_id, farm_code: current.farm_code } : null;
  const basic = placeProblem(target, { batch_no: '', farm_id: null, farm_code: null, company_id });
  if (basic) return basic;
  if (farm?.farm_id && target.farm_id !== farm.farm_id) {
    return `${target.location_code} is on ${target.farm_code ?? 'another farm'}, but ${animal_code} belongs to ${batchFarm?.farm_id ? 'a batch' : 'a location'} on ${farm.farm_code}. A location move stays on the farm; to move it to ${target.farm_code}, transfer it to a batch there.`;
  }
  return null;
}

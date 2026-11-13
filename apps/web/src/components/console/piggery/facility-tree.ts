/**
 * The farm → shed → pen hierarchy of the Pen Occupancy & Biosecurity page, built from the flat list the API returns. The API gives
 * each place only what is directly in it (the animals standing in that pen, the batch head held at that shed); a shed's or a farm's
 * own figures are what is under it, which is added up here. A store or a silo is
 * a place of its own: it is listed but never added into the head figures. A capacity written in anything but head (a shed holding
 * doses) is not a head capacity.
 */
export type Place = Record<string, any>;

export interface FacilityNode {
  id: string;
  place: Place;
  kids: FacilityNode[];
  /** A store or a silo: shown, never counted as head. */
  isOther: boolean;
  /** The head capacity the place itself declares, or null. */
  declared: number | null;
  /** What its sheds and pens declare, added up (the head places directly under it). */
  childCapacity: number;
  /** The capacity shown: its own, else what is under it, else none. */
  capacity: number | null;
  /** Head in it and everything under it: animals plus batch head. */
  occupied: number;
  animals: number;
  batchHead: number;
  /** Head standing in the place itself, not under it. */
  directAnimals: number;
  sick: number;
  /** Places at or under it that are over their own capacity / hold a sick animal. */
  placesOver: number;
  placesSick: number;
  /** Over its capacity once everything under it is counted. */
  over: boolean;
  /** How many of each kind are under it ("SHED": 3, "PEN": 12). */
  below: Record<string, number>;
}

const num = (v: unknown) => (Number(v) > 0 ? Number(v) : 0);
const NON_HEAD_TYPES = ['STORE', 'SILO'];

/**
 * Whether the place holds animals at all. A farm, shed, pen or crate does, whatever unit its capacity is written in; only a store or a
 * silo is a place for something else.
 */
export function isHeadPlace(place: Place): boolean {
  return !NON_HEAD_TYPES.includes(String(place.location_type || '').toUpperCase());
}

/** The capacity counts in head only when it is written in head (or nowhere: the API's default). A shed with a capacity in doses has none to show. */
const declaresHead = (place: Place) => !place.capacity_uom || String(place.capacity_uom).toUpperCase() === 'HEAD';

const byCode = (a: FacilityNode, b: FacilityNode) =>
  String(a.place.location_code).localeCompare(String(b.place.location_code), undefined, { numeric: true });

export function buildTree(places: Place[]): { roots: FacilityNode[]; byId: Map<string, FacilityNode> } {
  const byId = new Map<string, FacilityNode>();
  const node = (p: Place): FacilityNode => {
    const isOther = !isHeadPlace(p);
    const declared = !isOther && declaresHead(p) && num(p.max_capacity) ? num(p.max_capacity) : null;
    return {
      id: p.location_id,
      place: p,
      kids: [],
      isOther,
      declared,
      childCapacity: 0,
      capacity: declared,
      occupied: isOther ? 0 : num(p.current_occupancy),
      animals: isOther ? 0 : num(p.animal_count),
      batchHead: isOther ? 0 : num(p.batch_count),
      directAnimals: num(p.animal_count),
      sick: isOther ? 0 : num(p.sick_animal_count),
      placesOver: !isOther && p.is_over_capacity ? 1 : 0,
      placesSick: !isOther && num(p.sick_animal_count) > 0 ? 1 : 0,
      over: false,
      below: {},
    };
  };
  for (const p of places) byId.set(p.location_id, node(p));
  const roots: FacilityNode[] = [];
  for (const n of byId.values()) {
    const parent = n.place.parent_location_id ? byId.get(n.place.parent_location_id) : undefined;
    (parent ? parent.kids : roots).push(n);
  }

  const roll = (n: FacilityNode, seen = new Set<string>()): void => {
    if (seen.has(n.id)) return; // a loop in the data must not hang the page
    seen.add(n.id);
    n.kids.sort(byCode);
    for (const k of n.kids) roll(k, seen);
    for (const k of n.kids) {
      if (k.isOther) continue;
      n.occupied += k.occupied;
      n.animals += k.animals;
      n.batchHead += k.batchHead;
      n.sick += k.sick;
      n.placesOver += k.placesOver;
      n.placesSick += k.placesSick;
      n.childCapacity += k.capacity ?? 0;
      const type = String(k.place.location_type || 'PEN').toUpperCase();
      n.below[type] = (n.below[type] ?? 0) + 1;
      for (const [t, c] of Object.entries(k.below)) n.below[t] = (n.below[t] ?? 0) + c;
    }
    n.capacity = n.declared ?? (n.childCapacity > 0 ? n.childCapacity : null);
    n.over = n.capacity != null && n.occupied > n.capacity;
  };
  roots.sort(byCode);
  for (const r of roots) roll(r);
  return { roots, byId };
}

export interface FacilityTotals {
  capacity: number;
  occupied: number;
  animals: number;
  batchHead: number;
  placesOver: number;
  placesSick: number;
}

/** The figures for a set of places (the farms, or the one place being looked into). */
export function totalsOf(nodes: FacilityNode[]): FacilityTotals {
  const head = nodes.filter((n) => !n.isOther);
  return {
    capacity: head.reduce((s, n) => s + (n.capacity ?? 0), 0),
    occupied: head.reduce((s, n) => s + n.occupied, 0),
    animals: head.reduce((s, n) => s + n.animals, 0),
    batchHead: head.reduce((s, n) => s + n.batchHead, 0),
    placesOver: head.reduce((s, n) => s + n.placesOver, 0),
    placesSick: head.reduce((s, n) => s + n.placesSick, 0),
  };
}

export type FacilityStatus = 'OVER' | 'QUARANTINE' | 'CLEAN';
/** Over capacity first, then a sick animal under it, else clean. */
export const statusOfNode = (n: FacilityNode): FacilityStatus => (n.over || (!n.isOther && n.placesOver > 0 && n.kids.length === 0) ? 'OVER' : n.sick > 0 ? 'QUARANTINE' : 'CLEAN');

import { buildTree, isHeadPlace, statusOfNode, totalsOf } from './facility-tree';

const place = (id: string, code: string, type: string, parent: string | null, extra: object = {}) => ({
  location_id: id, location_code: code, location_name: code, location_type: type, parent_location_id: parent,
  max_capacity: null, capacity_uom: 'HEAD', current_occupancy: 0, animal_count: 0, batch_count: 0, sick_animal_count: 0, is_over_capacity: false, ...extra,
});

const rows = [
  place('f1', 'FARM-1', 'FARM', null, { max_capacity: 1000 }),
  place('s1', 'SHED-1', 'SHED', 'f1', { max_capacity: 100 }),
  place('p1', 'PEN-1', 'PEN', 's1', { max_capacity: 10, current_occupancy: 4, animal_count: 4 }),
  place('p2', 'PEN-2', 'PEN', 's1', { max_capacity: 10, current_occupancy: 12, animal_count: 12, is_over_capacity: true }),
  place('s2', 'SHED-2', 'SHED', 'f1', { current_occupancy: 30, batch_count: 30 }),
  place('p3', 'PEN-3', 'PEN', 's2', { max_capacity: 20, current_occupancy: 5, animal_count: 3, batch_count: 2, sick_animal_count: 1 }),
  place('st1', 'STORE-1', 'STORE', 'f1', { max_capacity: 500, capacity_uom: 'KG', current_occupancy: 9, animal_count: 9 }),
  place('f2', 'FARM-2', 'FARM', null),
];

describe('the facility tree', () => {
  const { roots, byId } = buildTree(rows);
  const f1 = byId.get('f1')!;

  it('puts the farms at the top and the sheds, pens and a store under them, in code order', () => {
    expect(roots.map((r) => r.place.location_code)).toEqual(['FARM-1', 'FARM-2']);
    expect(f1.kids.map((k) => k.place.location_code)).toEqual(['SHED-1', 'SHED-2', 'STORE-1']);
    expect(byId.get('s1')!.kids.map((k) => k.place.location_code)).toEqual(['PEN-1', 'PEN-2']);
  });

  it('adds what is under a place into it: head, animals, batch head and sick', () => {
    expect(byId.get('s1')!.occupied).toBe(16);
    expect(byId.get('s2')!.occupied).toBe(35); // 30 batch head at the shed itself + 5 in its pen
    expect(byId.get('s2')!).toMatchObject({ animals: 3, batchHead: 32, sick: 1, directAnimals: 0 });
    expect(f1).toMatchObject({ occupied: 51, animals: 19, batchHead: 32 });
  });

  it('never adds a store into the head figures, and counts a shed whose capacity is in doses as a shed with no head capacity', () => {
    expect(isHeadPlace(rows[6])).toBe(false);
    expect(byId.get('st1')!.isOther).toBe(true);
    expect(f1.occupied).toBe(51);
    expect(f1.below).toEqual({ SHED: 2, PEN: 3 });
    const doses = buildTree([place('f', 'F', 'FARM', null), place('d', 'D', 'SHED', 'f', { max_capacity: 900, capacity_uom: 'DOSE', current_occupancy: 3, animal_count: 3 })]);
    expect(doses.byId.get('d')).toMatchObject({ isOther: false, declared: null, capacity: null, occupied: 3, animals: 3 });
    expect(doses.byId.get('f')).toMatchObject({ occupied: 3, animals: 3, capacity: null });
  });

  it('shows a place\'s own head capacity, else what is under it', () => {
    expect(f1.capacity).toBe(1000);
    expect(f1.childCapacity).toBe(100 + 20); // shed 1 declares 100; shed 2 declares none, so its pen's 20
    expect(byId.get('s1')!.capacity).toBe(100);
    expect(byId.get('s2')!).toMatchObject({ declared: null, capacity: 20 });
    expect(byId.get('f2')!.capacity).toBeNull();
  });

  it('flags a place over its capacity once what is under it is counted, and counts the places over and sick beneath', () => {
    expect(byId.get('p2')!.over).toBe(true);
    expect(byId.get('s1')!.over).toBe(false); // 16 of 100
    expect(byId.get('s2')!.over).toBe(true); // 35 head against the 20 its pens declare
    expect(f1.placesOver).toBe(1);
    expect(f1.placesSick).toBe(1);
    expect(statusOfNode(byId.get('p2')!)).toBe('OVER');
    expect(statusOfNode(byId.get('p3')!)).toBe('QUARANTINE');
    expect(statusOfNode(byId.get('p1')!)).toBe('CLEAN');
  });

  it('totals a set of places', () => {
    expect(totalsOf(roots)).toMatchObject({ capacity: 1000, occupied: 51, animals: 19, batchHead: 32, placesOver: 1, placesSick: 1 });
  });

  it('does not hang on a place that is its own ancestor', () => {
    const loop = buildTree([place('a', 'A', 'SHED', 'b'), place('b', 'B', 'SHED', 'a')]);
    expect(loop.roots).toEqual([]);
  });
});

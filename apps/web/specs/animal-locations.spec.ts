import { animalLocationOptions, farmIdOf } from '../src/components/console/piggery/animal-locations';

const rows = [
  { location_id: 'mul', location_code: 'MUL100', location_type: 'FARM', parent_location_id: null },
  { location_id: 'mul-s6', location_code: 'MUL100/SHED-006', location_type: 'SHED', parent_location_id: 'mul', farm_id: 'mul' },
  { location_id: 'mul-p3', location_code: 'MUL100/SHED-006/PEN-003', location_name: 'Boar House Pen 3', location_type: 'PEN', parent_location_id: 'mul-s6', farm_id: 'mul' },
  // An older row with no farm_id: its farm is found through its parents.
  { location_id: 'mul-p4', location_code: 'MUL100/SHED-006/PEN-004', location_type: 'PEN', parent_location_id: 'mul-s6', farm_id: null },
  { location_id: 'mul-silo', location_code: 'MUL100/SILO-01', location_type: 'SILO', parent_location_id: 'mul', farm_id: 'mul' },
  { location_id: 'mul-old', location_code: 'MUL100/SHED-006/PEN-009', location_type: 'PEN', parent_location_id: 'mul-s6', farm_id: 'mul', is_active: false },
  { location_id: 'por', location_code: 'POR100', location_type: 'FARM', parent_location_id: null },
  { location_id: 'por-p2', location_code: 'POR100/SHED-001/PEN-002', location_type: 'PEN', parent_location_id: 'por-s1', farm_id: 'por' },
];

describe('animal location pickers', () => {
  it('finds a farm through the parents when farm_id is missing', () => {
    const byId = new Map(rows.map((r) => [r.location_id, r]));
    expect(farmIdOf(rows[3], byId)).toBe('mul');
    expect(farmIdOf(rows[0], byId)).toBe('mul');
  });

  it("offers only the farm's active sheds, pens and crates, never a silo or another farm", () => {
    expect(animalLocationOptions(rows, 'mul').map((o) => o.value)).toEqual(['mul-s6', 'mul-p3', 'mul-p4']);
    expect(animalLocationOptions(rows, 'por').map((o) => o.value)).toEqual(['por-p2']);
  });

  it('leaves out the location the animal already stands in, and names each by code and name', () => {
    const options = animalLocationOptions(rows, 'mul', 'mul-p4');
    expect(options.map((o) => o.value)).toEqual(['mul-s6', 'mul-p3']);
    expect(options[1].label).toBe('MUL100/SHED-006/PEN-003 — Boar House Pen 3');
  });
});

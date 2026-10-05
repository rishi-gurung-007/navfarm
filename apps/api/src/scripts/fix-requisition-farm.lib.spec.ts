import { farmOf, planRequisitionFarms, type LocationRow, type RequisitionFarmRow } from './fix-requisition-farm.lib';

const L = (location_id: string, location_code: string, location_type: string, parent_location_id: string | null): LocationRow =>
  ({ location_id, location_code, location_type, parent_location_id });
const LOCATIONS = [
  L('gra', 'GRA100', 'FARM', null),
  L('shed', 'GRA100/SHED-001', 'SHED', 'gra'),
  L('pen', 'GRA100/SHED-001/PEN-001', 'PEN', 'shed'),
  L('vil', 'VIL100', 'FARM', null),
  L('hq', 'HQ', 'OFFICE', null),
  L('loop-a', 'A', 'SHED', 'loop-b'),
  L('loop-b', 'B', 'SHED', 'loop-a'),
];
const R = (req_no: string, main_location_id: string | null, farm_id: string | null = null): RequisitionFarmRow =>
  ({ requisition_id: `id-${req_no}`, req_no, main_location_id, farm_id });

describe('farmOf — the location itself if a FARM, else its farm ancestor via parent_location_id', () => {
  const byId = new Map(LOCATIONS.map((l) => [l.location_id, l]));
  it('resolves a farm, a child and a grandchild', () => {
    expect(farmOf('gra', byId)).toBe('gra');
    expect(farmOf('shed', byId)).toBe('gra');
    expect(farmOf('pen', byId)).toBe('gra');
  });
  it('returns null for no farm above, an unknown id, or a parent cycle', () => {
    expect(farmOf('hq', byId)).toBeNull();
    expect(farmOf('missing', byId)).toBeNull();
    expect(farmOf('loop-a', byId)).toBeNull();
  });
});

describe('planRequisitionFarms — NULL farms only', () => {
  it('sets the derived farm on rows with no farm, and reports what it cannot resolve or would contradict', () => {
    const plan = planRequisitionFarms([
      R('RQ-00033', 'gra'),
      R('RQ-00031', 'pen'),
      R('RQ-00001', null),
      R('RQ-00002', 'hq'),
      R('RQ-00005', 'gra', 'gra'),
      R('RQ-00006', 'vil', 'gra'),
    ], LOCATIONS);
    expect(plan.set).toEqual([
      { requisition_id: 'id-RQ-00033', req_no: 'RQ-00033', farm_id: 'gra', farm_code: 'GRA100' },
      { requisition_id: 'id-RQ-00031', req_no: 'RQ-00031', farm_id: 'gra', farm_code: 'GRA100' },
    ]);
    expect(plan.unresolved).toEqual([
      { req_no: 'RQ-00001', reason: 'no main location' },
      { req_no: 'RQ-00002', reason: 'main location HQ has no farm above it' },
    ]);
    // A stored farm is never overwritten; a disagreement is only reported.
    expect(plan.mismatched).toEqual([{ req_no: 'RQ-00006', farm_id: 'gra', derived: 'VIL100' }]);
  });

  it('plans nothing on a second run', () => {
    expect(planRequisitionFarms([R('RQ-00033', 'gra', 'gra')], LOCATIONS).set).toEqual([]);
  });
});

import { planRequisitionFarms, type RequisitionFarmRow } from './fix-requisition-farm.lib';

/**
 * The planner does not define "the farm of a location". The script passes the
 * shared farmOfLocation (common/farm-scope.ts) as `farmOf`, so the stored farm
 * is always the one assertLocationOnActiveFarm checks against (review p1f, I2).
 * Here `farmOf` is a fixture of that helper's answers.
 */
const FARM_OF: Record<string, string | null> = { gra: 'gra', pen: 'gra', vil: 'vil', gone: null };
const farmOf = async (id: string) => FARM_OF[id] ?? null;
const CODE: Record<string, string> = { gra: 'GRA100', vil: 'VIL100' };
const codeOf = (id: string) => CODE[id] ?? id;
const R = (req_no: string, main_location_id: string | null, farm_id: string | null = null): RequisitionFarmRow =>
  ({ requisition_id: `id-${req_no}`, req_no, main_location_id, farm_id });

describe('planRequisitionFarms — NULL farms only, by the shared farmOfLocation rule', () => {
  it('sets the farm on rows with none, and reports what it cannot place or would contradict', async () => {
    const plan = await planRequisitionFarms([
      R('RQ-00033', 'gra'),
      R('RQ-00031', 'pen'),
      R('RQ-00001', null),
      R('RQ-00002', 'gone'),
      R('RQ-00005', 'gra', 'gra'),
      R('RQ-00006', 'vil', 'gra'),
    ], farmOf, codeOf);
    expect(plan.set).toEqual([
      { requisition_id: 'id-RQ-00033', req_no: 'RQ-00033', farm_id: 'gra', farm_code: 'GRA100' },
      { requisition_id: 'id-RQ-00031', req_no: 'RQ-00031', farm_id: 'gra', farm_code: 'GRA100' },
    ]);
    expect(plan.unresolved).toEqual([
      { req_no: 'RQ-00001', reason: 'no main location' },
      { req_no: 'RQ-00002', reason: 'main location gone has no farm' },
    ]);
    // A stored farm is never overwritten; a disagreement is only reported.
    expect(plan.mismatched).toEqual([{ req_no: 'RQ-00006', farm_id: 'gra', derived: 'VIL100' }]);
  });

  it('plans nothing on a second run', async () => {
    expect((await planRequisitionFarms([R('RQ-00033', 'gra', 'gra')], farmOf, codeOf)).set).toEqual([]);
  });
});

import { checkLocationMove, placeProblem, planTransferPens, Place } from './animal-placement.rules';

const place = (code: string, over: Partial<Place> = {}): Place => {
  const farmCode = code.split('/')[0];
  return { location_id: code, location_code: code, location_type: 'PEN', farm_id: farmCode, farm_code: farmCode, company_id: 'co', is_active: true, ...over };
};
const MUL_PEN2 = place('MUL100/SHED-006/PEN-002');
const MUL_PEN3 = place('MUL100/SHED-006/PEN-003');
const POR_PEN2 = place('POR100/SHED-001/PEN-002');
const toPor = { batch_no: 'BATCH-POR', farm_id: 'POR100', farm_code: 'POR100', company_id: 'co' };
const toMul = { batch_no: 'BATCH-MUL', farm_id: 'MUL100', farm_code: 'MUL100', company_id: 'co' };
const boar = (code: string, current: Place | null, returnTo: Place | null = null) => ({ animal_id: code, animal_code: code, current, returnTo });

describe('placeProblem: where an animal may stand', () => {
  it('accepts a pen, a crate or a shed of the right farm', () => {
    expect(placeProblem(MUL_PEN3, toMul)).toBeNull();
    expect(placeProblem(place('MUL100/SHED-003/CRATE-01', { location_type: 'CRATE' }), toMul)).toBeNull();
    expect(placeProblem(place('MUL100/SHED-006', { location_type: 'SHED' }), toMul)).toBeNull();
  });

  it('refuses a pen on another farm, naming both farms (S3 of the 10 Nov rehearsal was accepted)', () => {
    expect(placeProblem(MUL_PEN3, toPor)).toBe('MUL100/SHED-006/PEN-003 is on MUL100; BATCH-POR is on POR100. Choose a location on POR100.');
  });

  it('refuses a silo or a store, an inactive location and another company', () => {
    expect(placeProblem(place('MUL100/SILO-01', { location_type: 'SILO' }), toMul)).toBe('MUL100/SILO-01 is a SILO; an animal stands in a shed, pen or crate.');
    expect(placeProblem(place('MUL100/STORE', { location_type: 'STORE' }), toMul)).toMatch(/is a STORE/);
    expect(placeProblem(place('MUL100/SHED-006/PEN-009', { is_active: false }), toMul)).toBe('MUL100/SHED-006/PEN-009 is not an active location.');
    expect(placeProblem(place('MUL100/SHED-006/PEN-003', { company_id: 'other' }), toMul)).toBe('MUL100/SHED-006/PEN-003 belongs to another company.');
  });
});

describe('planTransferPens', () => {
  it('moves every animal to the pen named, on the destination farm', () => {
    const plan = planTransferPens({ destination: toPor, named: POR_PEN2, batchDefault: null, animals: [boar('PIG-1', MUL_PEN2), boar('PIG-2', MUL_PEN3)] });
    expect(plan.problems).toEqual([]);
    expect([...plan.pens]).toEqual([['PIG-1', POR_PEN2.location_id], ['PIG-2', POR_PEN2.location_id]]);
  });

  it('refuses a farm-to-farm move that names no pen: the animal would stand on one farm and belong to another (S2)', () => {
    const plan = planTransferPens({ destination: toPor, named: null, batchDefault: null, animals: [boar('PIG-2024-0015', MUL_PEN2)] });
    expect(plan.problems).toEqual([
      'PIG-2024-0015 stands in MUL100/SHED-006/PEN-002 on MUL100; BATCH-POR is on POR100. Choose the location on POR100 it moves to.',
    ]);
  });

  it('keeps each animal in its own pen within the same farm when no pen is named', () => {
    const plan = planTransferPens({ destination: toMul, named: null, batchDefault: null, animals: [boar('PIG-1', MUL_PEN2), boar('PIG-2', MUL_PEN3)] });
    expect(plan.problems).toEqual([]);
    expect([...plan.pens]).toEqual([['PIG-1', null], ['PIG-2', null]]);
  });

  it("uses the destination batch's own location when none is named", () => {
    const plan = planTransferPens({ destination: toPor, named: null, batchDefault: POR_PEN2, animals: [boar('PIG-1', MUL_PEN2)] });
    expect([...plan.pens]).toEqual([['PIG-1', POR_PEN2.location_id]]);
  });

  it('refuses a named pen on the wrong farm once, not once per animal', () => {
    const plan = planTransferPens({ destination: toPor, named: MUL_PEN3, batchDefault: null, animals: [boar('PIG-1', MUL_PEN2), boar('PIG-2', MUL_PEN2)] });
    expect(plan.problems).toEqual(['MUL100/SHED-006/PEN-003 is on MUL100; BATCH-POR is on POR100. Choose a location on POR100.']);
  });

  it('sends a reversed animal back to the pen it came from (it stayed in the new pen on 10 Nov)', () => {
    const plan = planTransferPens({ destination: toMul, named: null, batchDefault: null, animals: [boar('PIG-2024-0019', MUL_PEN3, MUL_PEN2)] });
    expect([...plan.pens]).toEqual([['PIG-2024-0019', MUL_PEN2.location_id]]);
  });

  it('falls back when the pen it came from is no longer usable', () => {
    const plan = planTransferPens({ destination: toMul, named: null, batchDefault: null, animals: [boar('PIG-1', MUL_PEN3, place('MUL100/SHED-006/PEN-002', { is_active: false }))] });
    expect([...plan.pens]).toEqual([['PIG-1', null]]);
  });

  it('lets an animal with no pen join a batch without one (nothing to contradict)', () => {
    expect(planTransferPens({ destination: toPor, named: null, batchDefault: null, animals: [boar('PIG-1', null)] }).problems).toEqual([]);
  });
});

describe('checkLocationMove: one location to another, same farm', () => {
  const move = (target: Place | null, current: Place | null = MUL_PEN2, batchFarm: { farm_id: string; farm_code: string } | null = { farm_id: 'MUL100', farm_code: 'MUL100' }) =>
    checkLocationMove({ animal_code: 'PIG-2024-0016', company_id: 'co', current, batchFarm, target });

  it('accepts a pen on the farm of the animal’s batch', () => {
    expect(move(MUL_PEN3)).toBeNull();
  });

  it('refuses another farm and points to the transfer', () => {
    expect(move(POR_PEN2)).toBe(
      'POR100/SHED-001/PEN-002 is on POR100, but PIG-2024-0016 belongs to a batch on MUL100. A location move stays on the farm; to move it to POR100, transfer it to a batch there.',
    );
  });

  it('refuses the location it is already in, a missing one, a silo', () => {
    expect(move(MUL_PEN2)).toBe('PIG-2024-0016 is already in MUL100/SHED-006/PEN-002.');
    expect(move(null)).toBe('Choose the location PIG-2024-0016 moves to.');
    expect(move(place('MUL100/SILO-01', { location_type: 'SILO' }))).toMatch(/is a SILO/);
  });

  it('keeps an animal with no batch on the farm of the pen it stands in', () => {
    expect(move(POR_PEN2, MUL_PEN2, null)).toMatch(/A location move stays on the farm/);
    expect(move(MUL_PEN3, MUL_PEN2, null)).toBeNull();
  });
});

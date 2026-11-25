import { specLineProblem, specLinesForSource, specProblems } from './qc-inspection.rules';

const lab = { measurement_code: 'MOT', stage: 'INCOMING' };
const farm = { measurement_code: 'MOT-FARM', stage: 'FARM_RECEIPT' };
const old = { measurement_code: 'VOL', stage: null };

describe('specLinesForSource', () => {
  it("gives the lot's own QC everything but the farm-receipt checks", () => {
    expect(specLinesForSource('SEMEN_COLLECTION', [lab, farm, old])).toEqual([lab, old]);
    expect(specLinesForSource('GOODS_RECEIPT', [lab, farm])).toEqual([lab]);
  });
  it('gives a transfer receipt the farm-receipt checks', () => {
    expect(specLinesForSource('TRANSFER_RECEIPT', [lab, farm, old])).toEqual([farm]);
    expect(specLinesForSource('TRANSFER_EVENT', [lab, farm])).toEqual([farm]);
  });
  it('gives a transfer receipt every check when the item has no farm-receipt checks, as before', () => {
    expect(specLinesForSource('TRANSFER_RECEIPT', [lab, old])).toEqual([lab, old]);
  });
});

describe('stage on a specification line', () => {
  const value = { sampling_type: 'VALUE', measurement_code: 'MOT', min_value: 60 };
  it('accepts INCOMING, FARM_RECEIPT and none', () => {
    expect(specLineProblem({ ...value, stage: 'FARM_RECEIPT' })).toBeNull();
    expect(specLineProblem({ ...value, stage: 'incoming' })).toBeNull();
    expect(specLineProblem({ ...value })).toBeNull();
  });
  it('refuses any other stage', () => {
    expect(specLineProblem({ ...value, stage: 'SHIPPING' })).toMatch(/INCOMING or FARM_RECEIPT/);
  });
  it('lets the same parameter be checked at both stages', () => {
    expect(specProblems([{ ...value, stage: 'INCOMING' }, { ...value, stage: 'FARM_RECEIPT' }])).toEqual([]);
    expect(specProblems([{ ...value, stage: 'INCOMING' }, { ...value }])).not.toEqual([]);
  });
});

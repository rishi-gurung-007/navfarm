import { qcRangeError, QC_PARAM_TYPES } from './qc-parameter.rules';

describe('QC Parameter Master rules', () => {
  it('offers the QC Types a result can be judged by without a grade scale', () => {
    expect([...QC_PARAM_TYPES]).toEqual(['NUMERIC', 'BOOLEAN']);
  });

  it("accepts the client's example: Min 10, Target 12, Max 14", () => {
    expect(qcRangeError(10, 12, 14)).toBeNull();
    expect(qcRangeError('10.0000', '12.0000', '14.0000')).toBeNull();
  });

  it('accepts a target on either bound and values left out', () => {
    expect(qcRangeError(10, 10, 14)).toBeNull();
    expect(qcRangeError(10, 14, 14)).toBeNull();
    expect(qcRangeError(null, undefined, null)).toBeNull();
    expect(qcRangeError(10, null, null)).toBeNull();
    expect(qcRangeError(null, 12, 14)).toBeNull();
  });

  it('refuses Min above Max', () => {
    expect(qcRangeError(14, null, 10)).toBe('Min Value cannot be greater than Max Value.');
  });

  it('refuses a Target outside Min..Max, also when only one bound is given', () => {
    expect(qcRangeError(10, 9, 14)).toBe('Target Value cannot be below Min Value.');
    expect(qcRangeError(10, 15, 14)).toBe('Target Value cannot be above Max Value.');
    expect(qcRangeError(null, 15, 14)).toBe('Target Value cannot be above Max Value.');
    expect(qcRangeError(10, 9, null)).toBe('Target Value cannot be below Min Value.');
  });
});

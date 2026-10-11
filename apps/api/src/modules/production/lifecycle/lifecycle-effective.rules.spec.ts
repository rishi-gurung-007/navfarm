import { findEffectiveOverlap, lifecycleWindowsOverlap } from './lifecycle-effective.rules';

const w = (o: object) => ({ calcUnit: 'DAY', periodFrom: 1, periodTo: 28, ...o });

describe('lifecycleWindowsOverlap', () => {
  it('clashes when days and dates both overlap', () => {
    expect(lifecycleWindowsOverlap(w({ effectiveFrom: '2026-10-01' }), w({ effectiveTo: '2026-10-05' }))).toBe(true);
  });
  it('does not clash when the dates are disjoint', () => {
    expect(lifecycleWindowsOverlap(w({ effectiveTo: '2026-10-19' }), w({ effectiveFrom: '2026-10-20' }))).toBe(false);
  });
  it('does not clash when the day ranges are disjoint', () => {
    expect(lifecycleWindowsOverlap(w({}), w({ periodFrom: 29, periodTo: 40 }))).toBe(false);
  });
  it('treats undated rows as always effective', () => {
    expect(lifecycleWindowsOverlap(w({}), w({ effectiveFrom: '2027-01-01' }))).toBe(true);
  });
});

describe('findEffectiveOverlap', () => {
  it('skips the row being edited', () => {
    expect(findEffectiveOverlap(w({ lifecycleId: 'x' }), [w({ lifecycleId: 'x' })])).toBeUndefined();
    expect(findEffectiveOverlap(w({ lifecycleId: 'y' }), [w({ lifecycleId: 'x' })])).toBeDefined();
  });
});

import { findEffectiveOverlap, lifecycleWindowsOverlap } from './lifecycle-effective.rules';

const w = (o: object) => ({ calcUnit: 'DAY', periodFrom: 1, periodTo: 28, ...o });

describe('lifecycleWindowsOverlap', () => {
  it('clashes when the stage days overlap', () => {
    expect(lifecycleWindowsOverlap(w({}), w({ periodFrom: 28, periodTo: 40 }))).toBe(true);
  });
  it('does not clash when the day ranges are disjoint', () => {
    expect(lifecycleWindowsOverlap(w({}), w({ periodFrom: 29, periodTo: 40 }))).toBe(false);
  });
  it('compares stage days across units (week 4 = days 22-28)', () => {
    expect(lifecycleWindowsOverlap(w({}), w({ calcUnit: 'WEEK', periodFrom: 4, periodTo: 5 }))).toBe(true);
    expect(lifecycleWindowsOverlap(w({}), w({ calcUnit: 'WEEK', periodFrom: 5, periodTo: 6 }))).toBe(false);
  });
});

describe('findEffectiveOverlap', () => {
  it('skips the row being edited', () => {
    expect(findEffectiveOverlap(w({ lifecycleId: 'x' }), [w({ lifecycleId: 'x' })])).toBeUndefined();
    expect(findEffectiveOverlap(w({ lifecycleId: 'y' }), [w({ lifecycleId: 'x' })])).toBeDefined();
  });
});

describe('findEffectiveOverlap — farm scope', () => {
  it('allows a farm override to overlap the default', () => {
    expect(findEffectiveOverlap(w({ farmId: 'farm-A' }), [w({ lifecycleId: 'd' })])).toBeUndefined();
    expect(findEffectiveOverlap(w({}), [w({ lifecycleId: 'o', farmId: 'farm-A' })])).toBeUndefined();
  });
  it('refuses an overlap within the same farm, and between two defaults', () => {
    expect(findEffectiveOverlap(w({ farmId: 'farm-A' }), [w({ lifecycleId: 'o', farmId: 'farm-A' })])).toBeDefined();
    expect(findEffectiveOverlap(w({ farmId: null }), [w({ lifecycleId: 'd' })])).toBeDefined();
  });
  it('allows overrides on different farms to overlap', () => {
    expect(findEffectiveOverlap(w({ farmId: 'farm-A' }), [w({ lifecycleId: 'o', farmId: 'farm-B' })])).toBeUndefined();
  });
});

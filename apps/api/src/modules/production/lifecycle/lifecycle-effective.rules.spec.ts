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

/**
 * The lines the Feed Consumption form shows are grouped by SIBLING_KEY_COLUMNS —
 * breed, stage, farm, season_type and category — but this rule only knew about the
 * farm. An active feed row for the same breed+stage+farm with a different category
 * or season therefore blocked a save while never appearing as a line, so the only
 * thing the user could do about it was invisible to them.
 *
 * Reproduced on 13 Oct in the running app: a third BLANKTST Z-Line/WEANER row with
 * category SOW over days 1-20 left the dialog showing "Feed Consumption (2)" and
 * made Update answer "Another feed row ... already covers these days."
 *
 * Company is here for the same reason: neither this rule nor stageRows filtered it,
 * so on a tenant-level breed or stage one company's rows could block — and be shown
 * as lines of — another's (Rishi, 13 Oct).
 */
describe('findEffectiveOverlap — season, category and company scope', () => {
  it('lets rows for a different category share the same stage days', () => {
    expect(findEffectiveOverlap(w({ category: 'PIGLET' }), [w({ lifecycleId: 'o', category: 'SOW' })])).toBeUndefined();
  });
  it('lets rows for a different season share the same stage days', () => {
    expect(findEffectiveOverlap(w({ seasonType: 'SUMMER' }), [w({ lifecycleId: 'o', seasonType: 'WINTER' })])).toBeUndefined();
  });
  it('lets rows of a different company share the same stage days', () => {
    expect(findEffectiveOverlap(w({ companyId: 'co-1' }), [w({ lifecycleId: 'o', companyId: 'co-2' })])).toBeUndefined();
  });
  it('still clashes inside one season, category and company', () => {
    const scope = { seasonType: 'ALL', category: 'PIGLET', companyId: 'co-1' };
    expect(findEffectiveOverlap(w(scope), [w({ lifecycleId: 'o', ...scope })])).toBeDefined();
  });
  it('treats null and absent the same way, as the farm scope does', () => {
    expect(findEffectiveOverlap(w({ category: null }), [w({ lifecycleId: 'o' })])).toBeDefined();
    expect(findEffectiveOverlap(w({ seasonType: null, companyId: null }), [w({ lifecycleId: 'o' })])).toBeDefined();
  });
});

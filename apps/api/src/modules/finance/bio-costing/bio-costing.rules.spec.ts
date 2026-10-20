import {
  changedLockedFields, costingStartDate, originOf, residualFor, resolveProfile, scopeKey, validateActivation, validateTerms,
  type ResolvableProfile,
} from './bio-costing.rules';

const ON = { bio_asset_support: true, amort_option: true, fair_value_option: true };
const importedFemale = {
  origin: 'IMPORTED', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
  residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 150, residual_price_per_kg: 2.05, residual_applies_gender: 'F',
};

describe('validateTerms', () => {
  it('accepts the client\'s imported female: week 33, 36 months, residual 150 kg x 2.05', () => {
    expect(validateTerms(importedFemale, ON)).toEqual([]);
  });
  it('needs a useful life for amortisation; fair value may carry the stated 36 months (unused by its run) or none, but no residual', () => {
    expect(validateTerms({ ...importedFemale, useful_life_months: null }, ON).join()).toMatch(/useful life/);
    const local = { origin: 'LOCAL', gender: 'F', costing_method: 'FAIR_VALUE', start_age_weeks: 33 };
    expect(validateTerms({ ...local, useful_life_months: 36 }, ON)).toEqual([]);
    expect(validateTerms(local, ON)).toEqual([]);
    expect(validateTerms({ ...local, residual_rule: 'FIXED', residual_fixed_amount: 5 }, ON).join()).toMatch(/no residual/);
  });
  it('refuses the BBP\'s forbidden pairings: imported with fair value, local with amortisation', () => {
    expect(validateTerms({ origin: 'IMPORTED', gender: 'F', costing_method: 'FAIR_VALUE', start_age_weeks: 33 }, ON).join()).toMatch(/imported asset cannot/);
    expect(validateTerms({ ...importedFemale, origin: 'LOCAL' }, ON).join()).toMatch(/local breeding asset cannot/);
  });
  it('needs the method switched on for biological assets: this is what gives the costing_method_config flags a reader', () => {
    expect(validateTerms(importedFemale, { ...ON, amort_option: false }).join()).toMatch(/Amortisation is not enabled/);
    expect(validateTerms({ origin: 'LOCAL', costing_method: 'FAIR_VALUE', start_age_weeks: 33 }, { ...ON, fair_value_option: false }).join()).toMatch(/Fair value is not enabled/);
    expect(validateTerms(importedFemale, { ...ON, bio_asset_support: false }).join()).toMatch(/not enabled for this tenant/);
  });
  it('needs a scope, a coherent residual and a whole, non-negative start age', () => {
    expect(validateTerms({ costing_method: 'FAIR_VALUE', start_age_weeks: 18 }, ON).join()).toMatch(/needs a scope/);
    expect(validateTerms({ ...importedFemale, residual_price_per_kg: null }, ON).join()).toMatch(/weight and a price per kg/);
    expect(validateTerms({ ...importedFemale, start_age_weeks: -1 }, ON).join()).toMatch(/Start age/);
    expect(validateTerms({ ...importedFemale, residual_rule: 'NONE' }, ON).join()).toMatch(/residual rule is NONE/);
  });
});

describe('validateActivation', () => {
  it('lists every missing GL account for amortisation', () => {
    const e = validateActivation(importedFemale, { glPresent: { acquisition_gl_id: true }, rateRows: 0 });
    expect(e).toHaveLength(3);
    expect(e.join()).toMatch(/accumulated amortisation/);
  });
  it('lets fair value go live only with a rate row', () => {
    const t = { origin: 'LOCAL', costing_method: 'FAIR_VALUE', start_age_weeks: 33 };
    const gl = { acquisition_gl_id: true, fv_gain_loss_gl_id: true, writeoff_gl_id: true };
    expect(validateActivation(t, { glPresent: gl, rateRows: 0 }).join()).toMatch(/needs at least one rate/);
    expect(validateActivation(t, { glPresent: gl, rateRows: 1 })).toEqual([]);
  });
});

describe('resolveProfile', () => {
  const p = (o: Partial<ResolvableProfile> & { profile_code: string }): ResolvableProfile => ({
    profile_id: o.profile_code, status: 'ACTIVE', effective_from: '2026-01-01', costing_method: 'AMORTIZATION', start_age_weeks: 33, ...o,
  });
  const animal = { item_id: 'i1', breed_id: 'b1', gender: 'F', origin: 'IMPORTED' };

  it('picks the group profile that matches origin and gender, and not the others', () => {
    const profiles = [p({ profile_code: 'IMP-F', origin: 'IMPORTED', gender: 'F' }), p({ profile_code: 'IMP-M', origin: 'IMPORTED', gender: 'M' }), p({ profile_code: 'LOC-F', origin: 'LOCAL', gender: 'F' })];
    expect(resolveProfile(profiles, animal, '2026-10-20').profile?.profile_code).toBe('IMP-F');
    expect(resolveProfile(profiles, { ...animal, gender: 'M' }, '2026-10-20').profile?.profile_code).toBe('IMP-M');
    expect(resolveProfile(profiles, { ...animal, origin: 'LOCAL' }, '2026-10-20').profile?.profile_code).toBe('LOC-F');
  });
  it('lets an item profile beat any group profile', () => {
    const profiles = [p({ profile_code: 'IMP-F', origin: 'IMPORTED', gender: 'F' }), p({ profile_code: 'ITEM', item_id: 'i1' })];
    expect(resolveProfile(profiles, animal, '2026-10-20').profile?.profile_code).toBe('ITEM');
  });
  it('prefers the profile that pins more dimensions', () => {
    const profiles = [p({ profile_code: 'ORIGIN', origin: 'IMPORTED' }), p({ profile_code: 'ORIGIN-GENDER', origin: 'IMPORTED', gender: 'F' })];
    expect(resolveProfile(profiles, animal, '2026-10-20').profile?.profile_code).toBe('ORIGIN-GENDER');
  });
  it('calls two equally specific matches ambiguous rather than guessing', () => {
    const profiles = [p({ profile_code: 'BREED', breed_id: 'b1' }), p({ profile_code: 'ORIGIN', origin: 'IMPORTED' })];
    const r = resolveProfile(profiles, animal, '2026-10-20');
    expect(r.profile).toBeNull();
    expect(r.ambiguous.map((x) => x.profile_code).sort()).toEqual(['BREED', 'ORIGIN']);
  });
  it('lets a superseded profile govern until its successor takes effect, and the successor from then on', () => {
    const old = p({ profile_code: 'IMP-F', origin: 'IMPORTED', gender: 'F', status: 'SUPERSEDED' });
    const next = p({ profile_code: 'IMP-F.2027', origin: 'IMPORTED', gender: 'F', effective_from: '2027-01-01', supersedes_profile_id: 'IMP-F' });
    expect(resolveProfile([old, next], animal, '2026-10-20').profile?.profile_code).toBe('IMP-F');
    expect(resolveProfile([old, next], animal, '2026-12-31').profile?.profile_code).toBe('IMP-F');
    expect(resolveProfile([old, next], animal, '2027-01-01').profile?.profile_code).toBe('IMP-F.2027');
    expect(resolveProfile([old, next], animal, '2027-06-01').ambiguous).toEqual([]);
  });
  it('does not resolve a superseded profile that has no successor on file', () => {
    expect(resolveProfile([p({ profile_code: 'OLD', origin: 'IMPORTED', status: 'SUPERSEDED' })], animal, '2026-10-20').profile).toBeNull();
  });
  it('ignores profiles that are not active or not yet in effect, and finds nothing for an unknown origin', () => {
    const profiles = [p({ profile_code: 'DRAFT', origin: 'IMPORTED', status: 'DRAFT' }), p({ profile_code: 'LATER', origin: 'IMPORTED', effective_from: '2027-01-01' })];
    expect(resolveProfile(profiles, animal, '2026-10-20').profile).toBeNull();
    expect(resolveProfile([p({ profile_code: 'IMP', origin: 'IMPORTED' })], { ...animal, origin: null }, '2026-10-20').profile).toBeNull();
  });
});

describe('costingStartDate', () => {
  it('is the birth date plus the start age: born 2026-01-05, week 33 = 231 days = 2026-08-24', () => {
    expect(costingStartDate({ dob: '2026-01-05', entry_date: '2026-02-01' }, 33)).toBe('2026-08-24');
  });
  it('is never before she was on the books (ours, D4): an animal bought older than the start age starts on her entry date', () => {
    expect(costingStartDate({ dob: '2025-01-01', entry_date: '2026-03-01' }, 33)).toBe('2026-03-01');
  });
  it('counts back from her age at entry when there is no birth date, and gives null with neither', () => {
    expect(costingStartDate({ entry_date: '2026-03-01', age_at_entry_weeks: 10 }, 33)).toBe('2026-08-09'); // born 2025-12-21
    expect(costingStartDate({ entry_date: '2026-03-01' }, 33)).toBeNull();
  });
});

describe('residualFor', () => {
  it('is 150 x 2.05 = 307.50 for a female and nil for a male under the client\'s rule', () => {
    expect(residualFor(importedFemale, 'F')).toBe(307.5);
    expect(residualFor(importedFemale, 'M')).toBe(0);
  });
  it('is nil with no rule and the stated amount for a fixed rule', () => {
    expect(residualFor({ ...importedFemale, residual_rule: 'NONE' }, 'F')).toBe(0);
    expect(residualFor({ ...importedFemale, residual_rule: 'FIXED', residual_fixed_amount: '12.5', residual_applies_gender: null }, 'M')).toBe(12.5);
  });
});

describe('scope, origin and the lock', () => {
  it('builds one key per company and scope', () => {
    expect(scopeKey('c1', { origin: 'IMPORTED', gender: 'F' })).toBe('c1|-|-|F|IMPORTED');
  });
  it('maps the entry types the documents name and nothing else', () => {
    expect(originOf('PURCHASED_IMPORTED')).toBe('IMPORTED');
    expect(originOf('PURCHASED_LOCAL')).toBe('LOCAL');
    expect(originOf('BORN_ON_FARM')).toBeNull();
    expect(originOf('TRANSFERRED_IN')).toBeNull();
  });
  it('reports only the locked fields that really change, treating 36 and "36" as the same', () => {
    const stored = { useful_life_months: 36, name: 'x', start_age_weeks: 33, residual_price_per_kg: '2.050000' };
    expect(changedLockedFields(stored, { useful_life_months: '36', name: 'y', residual_price_per_kg: 2.05 })).toEqual([]);
    expect(changedLockedFields(stored, { useful_life_months: 18, start_age_weeks: 26 })).toEqual(['start_age_weeks', 'useful_life_months']);
  });
});

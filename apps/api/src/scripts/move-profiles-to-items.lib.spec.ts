import { planMove, type MoveAnimal, type MoveItem, type MoveProfile, type MoveRate, type MoveSetting } from './move-profiles-to-items.lib';

const TODAY = '2026-10-28';
const item = (o: Partial<MoveItem> = {}): MoveItem => ({ item_id: 'i1', item_code: 'GP-Imp-F', company_id: 'c', is_biological_asset: 1, bio_costing_method: null, ...o });
const profile = (o: Partial<MoveProfile> = {}): MoveProfile => ({
  profile_id: 'p1', profile_code: 'IMP-F', company_id: 'c', status: 'ACTIVE', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
  residual_rule: 'NONE', residual_fixed_amount: null, residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null, run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS',
  tracking: 'INDIVIDUAL', auto_post: 0, effective_from: '2026-01-01', acquisition_gl_id: 'g-acq', accum_amort_gl_id: 'g-accum', amort_expense_gl_id: 'g-exp', fv_gain_loss_gl_id: null, writeoff_gl_id: 'g-w', ...o,
});
const animal = (profileId: string | null, gender: string | null = 'F', itemId = 'i1'): MoveAnimal => ({ item_id: itemId, gender, costing_profile_id: profileId });
const female: MoveSetting = { company_id: 'c', gender: 'F', residual_rule: 'WEIGHT_X_PRICE', residual_fixed_amount: null, residual_weight_kg: '150.000', residual_price_per_kg: '2.050000', effective_from: '2026-01-01' };
const male: MoveSetting = { company_id: 'c', gender: 'M', residual_rule: 'NONE', residual_fixed_amount: null, residual_weight_kg: null, residual_price_per_kg: null, effective_from: '2026-01-01' };
const plan = (over: Partial<Parameters<typeof planMove>[0]> = {}) => planMove({ items: [item()], animals: [animal('p1')], profiles: [profile()], settings: [female, male], rates: [], picks: [], today: TODAY, ...over });

describe('planMove — costing terms from the profile onto the item', () => {
  it('gives an item the terms of the one profile its animals carry, with the residual the profile way reads: the company setting for her sex', () => {
    const { moves, skipped } = plan();
    expect(skipped).toEqual([]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ item_code: 'GP-Imp-F', from_profiles: ['IMP-F'], animals: 1, missing_gl: ['fair value gain / loss'].slice(1) });
    expect(moves[0].terms).toMatchObject({
      bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 33, bio_start_age_days: 0, bio_useful_life_months: 36,
      bio_residual_rule: 'WEIGHT_X_PRICE', bio_residual_weight_kg: 150, bio_residual_price_per_kg: 2.05, bio_residual_fixed_amount: null,
      bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_effective_from: '2026-01-01', bio_auto_post: false,
      bio_acquisition_gl_id: 'g-acq', bio_accum_amort_gl_id: 'g-accum', bio_amort_expense_gl_id: 'g-exp', bio_writeoff_gl_id: 'g-w',
    });
  });

  it('gives a boar item no residual: the company has none for males', () => {
    const { moves } = plan({ items: [item({ item_code: 'GP-Imp-M' })], animals: [animal('p1', 'M')] });
    expect(moves[0].terms).toMatchObject({ bio_gender: 'M', bio_residual_rule: 'NONE', bio_residual_weight_kg: null, bio_residual_price_per_kg: null });
  });

  it('falls back to the profile\'s own residual where the company has set none', () => {
    const own = profile({ residual_rule: 'FIXED', residual_fixed_amount: '300.0000' });
    const { moves } = plan({ profiles: [own], settings: [] });
    expect(moves[0].terms).toMatchObject({ bio_residual_rule: 'FIXED', bio_residual_fixed_amount: 300 });
  });

  it('takes the company residual in force today and says that earlier months keep what they recorded, when the setting changed', () => {
    const older: MoveSetting = { ...female, residual_weight_kg: '140.000', effective_from: '2025-06-01' };
    const { moves } = plan({ settings: [older, female] });
    expect(moves[0].terms).toMatchObject({ bio_residual_weight_kg: 150 });
    expect(moves[0].notes.join(' ')).toMatch(/changed over time.*in force today.*already posted keep/);
  });

  it('ignores a setting that starts after today', () => {
    const later: MoveSetting = { ...female, residual_weight_kg: '999.000', effective_from: '2027-01-01' };
    expect(plan({ settings: [female, later] }).moves[0].terms).toMatchObject({ bio_residual_weight_kg: 150 });
  });

  it('merges profiles whose terms and accounts are identical, and says so', () => {
    const { moves, skipped } = plan({ profiles: [profile(), profile({ profile_id: 'p2', profile_code: 'LOC-F' })], animals: [animal('p1'), animal('p2'), animal(null)] });
    expect(skipped).toEqual([]);
    expect(moves[0]).toMatchObject({ from_profiles: ['IMP-F', 'LOC-F'], animals: 3 });
    expect(moves[0].notes.join(' ')).toMatch(/merged IMP-F \+ LOC-F: identical terms and accounts/);
  });

  it('refuses to merge profiles that differ in their terms, and names the difference', () => {
    const { moves, skipped } = plan({ profiles: [profile(), profile({ profile_id: 'p2', profile_code: 'LOC-F', useful_life_months: 24 })], animals: [animal('p1'), animal('p2')] });
    expect(moves).toEqual([]);
    expect(skipped).toEqual([{ item_code: 'GP-Imp-F', reason: 'CONFLICT_TERMS', detail: expect.stringMatching(/IMP-F, LOC-F.*useful_life_months.*--pick=GP-Imp-F=<profile>/) }]);
  });

  it('refuses to merge profiles with the same terms but different GL accounts: an item has one set of accounts', () => {
    const { moves, skipped } = plan({ profiles: [profile(), profile({ profile_id: 'p2', profile_code: 'LOC-F', acquisition_gl_id: 'g-loc-acq' })], animals: [animal('p1'), animal('p2')] });
    expect(moves).toEqual([]);
    expect(skipped[0]).toMatchObject({ reason: 'CONFLICT_ACCOUNTS', detail: expect.stringContaining('acquisition_gl_id') });
  });

  it('takes the profile a person names when the animals disagree', () => {
    const profiles = [profile(), profile({ profile_id: 'p2', profile_code: 'LOC-F', acquisition_gl_id: 'g-loc-acq' })];
    const { moves, skipped } = plan({ profiles, animals: [animal('p1'), animal('p2')], picks: [{ item_code: 'GP-Imp-F', profile_code: 'LOC-F' }] });
    expect(skipped).toEqual([]);
    expect(moves[0]).toMatchObject({ from_profiles: ['LOC-F'] });
    expect(moves[0].terms.bio_acquisition_gl_id).toBe('g-loc-acq');
  });

  it('reports a pick that names no profile of the company', () => {
    expect(plan({ picks: [{ item_code: 'GP-Imp-F', profile_code: 'NOPE' }] }).skipped).toEqual([{ item_code: 'GP-Imp-F', reason: 'PICK_NOT_FOUND', detail: expect.stringContaining('NOPE') }]);
  });

  it('never overwrites an item that already has terms', () => {
    const r = plan({ items: [item({ bio_costing_method: 'FAIR_VALUE' })] });
    expect(r.moves).toEqual([]);
    expect(r.skipped).toEqual([{ item_code: 'GP-Imp-F', reason: 'ALREADY_HAS_TERMS', detail: expect.stringContaining('nothing is overwritten') }]);
  });

  it('leaves an item whose animals carry no profile, and a batch-tracked profile, alone', () => {
    expect(plan({ animals: [animal(null), animal(null)] }).skipped[0]).toMatchObject({ reason: 'NO_PROFILE_ON_ANIMALS', detail: expect.stringContaining('2 animal(s)') });
    expect(plan({ profiles: [profile({ tracking: 'BATCH' })] }).skipped[0]).toMatchObject({ reason: 'BATCH_TRACKED' });
  });

  it('does not list items that are not biological assets', () => {
    expect(plan({ items: [item({ is_biological_asset: 0 })] })).toEqual({ moves: [], skipped: [] });
  });

  it('refuses an item of both sexes where the company\'s residual differs by sex', () => {
    const r = plan({ animals: [animal('p1', 'F'), animal('p1', 'M')] });
    expect(r.skipped[0]).toMatchObject({ reason: 'MIXED_GENDER_RESIDUAL' });
    // with the same residual for both sexes it is fine, and says so
    const same = plan({ animals: [animal('p1', 'F'), animal('p1', 'M')], settings: [female, { ...female, gender: 'M' }] });
    expect(same.skipped).toEqual([]);
    expect(same.moves[0].notes.join(' ')).toMatch(/both sexes/);
  });

  it('refuses terms the item would not accept itself (an amortised profile with no life)', () => {
    const r = plan({ profiles: [profile({ useful_life_months: null })] });
    expect(r.skipped[0]).toMatchObject({ reason: 'INVALID_TERMS', detail: expect.stringMatching(/useful life/) });
  });

  it('carries the fair-value rates of the profile chosen, and not another\'s', () => {
    const fv = profile({ costing_method: 'FAIR_VALUE', useful_life_months: null, acquisition_gl_id: 'g-acq', fv_gain_loss_gl_id: 'g-fv' });
    const rates: MoveRate[] = [
      { profile_id: 'p1', farm_id: null, age_week_from: 17, effective_from: '2026-01-01', expected_weight_kg: '150.000', price_per_kg: '2.050000', cdm_based: 1, costs_to_sell_pct: null },
      { profile_id: 'other', farm_id: null, age_week_from: 0, effective_from: '2026-01-01', expected_weight_kg: '1.000', price_per_kg: '1.000000', cdm_based: 0, costs_to_sell_pct: null },
    ];
    const { moves } = plan({ profiles: [fv], rates, settings: [] });
    expect(moves[0].terms).toMatchObject({ bio_costing_method: 'FAIR_VALUE', bio_residual_rule: 'NONE' });
    expect(moves[0].rates).toEqual([{ farm_id: null, age_week_from: 17, effective_from: '2026-01-01', expected_weight_kg: '150.000', price_per_kg: '2.050000', cdm_based: 1, costs_to_sell_pct: null }]);
  });

  it('flags a DRAFT profile and lists the accounts the item still needs', () => {
    const { moves } = plan({ profiles: [profile({ status: 'DRAFT', accum_amort_gl_id: null, writeoff_gl_id: null })] });
    expect(moves[0].missing_gl).toEqual(['accumulated amortisation', 'mortality / impairment loss']);
    expect(moves[0].notes.join(' ')).toMatch(/DRAFT profile.*cannot run until its GL accounts are set/);
  });

  it('plans each item on its own, in code order', () => {
    const r = plan({
      items: [item({ item_id: 'i2', item_code: 'P-Imp-F' }), item()],
      animals: [animal('p1'), animal('p1', 'F', 'i2')],
    });
    expect(r.moves.map((m) => m.item_code)).toEqual(['GP-Imp-F', 'P-Imp-F']);
  });
});

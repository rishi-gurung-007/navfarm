import { REQUIRED_GL, costingStartDate, residualFor, resolveResidual } from './bio-costing.rules';

// The terms of the sow item (TDD Item Card): week 33, 36 months, residual 150 kg x 2.05.
const sow = { costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36, residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 150, residual_price_per_kg: 2.05 };

describe('costingStartDate', () => {
  it('is the birth date plus the start age: born 2026-01-05, week 33 = 231 days = 2026-08-24', () => {
    expect(costingStartDate({ dob: '2026-01-05', entry_date: '2026-02-01' }, 33)).toBe('2026-08-24');
  });
  it('counts the item\'s extra days as well: 33 weeks and 3 days = 2026-08-27', () => {
    expect(costingStartDate({ dob: '2026-01-05', entry_date: '2026-02-01' }, 33, 3)).toBe('2026-08-27');
  });
  it('is never before she was on the books (ours, D4): an animal bought older than the start age starts on her entry date', () => {
    expect(costingStartDate({ dob: '2024-01-01', entry_date: '2026-01-12' }, 33)).toBe('2026-01-12');
  });
  it('counts back from her age at entry when there is no birth date, and gives null with neither', () => {
    expect(costingStartDate({ dob: null, entry_date: '2026-01-12', age_at_entry_weeks: 10 }, 33)).toBe('2026-06-22');
    expect(costingStartDate({ dob: null, entry_date: '2026-01-12' }, 33)).toBeNull();
  });
});

describe('residualFor', () => {
  it('is 150 x 2.05 = 307.50 under the sow item\'s rule', () => {
    expect(residualFor(sow, 'F')).toBe(307.5);
  });
  it('is nil for a boar item: its own rule is NONE', () => {
    expect(residualFor({ ...sow, residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null }, 'M')).toBe(0);
  });
  it('is nil with no rule and the stated amount for a fixed rule', () => {
    expect(residualFor({ costing_method: 'AMORTIZATION', start_age_weeks: 0 }, 'F')).toBe(0);
    expect(residualFor({ ...sow, residual_rule: 'FIXED', residual_fixed_amount: '300.0000' }, 'F')).toBe(300);
  });
  it('applies only to the sex a rule names, where one is named', () => {
    expect(residualFor({ ...sow, residual_applies_gender: 'F' }, 'M')).toBe(0);
    expect(residualFor({ ...sow, residual_applies_gender: 'F' }, 'F')).toBe(307.5);
  });
});

describe('resolveResidual', () => {
  it('is her item\'s residual, and nothing else: an animal has none of her own', () => {
    expect(resolveResidual({ terms: sow, gender: 'F' })).toEqual({ value: 307.5, source: 'ITEM' });
    expect(resolveResidual({ terms: { ...sow, residual_applies_gender: 'F' }, gender: 'M' }).value).toBe(0);
  });
});

describe('REQUIRED_GL', () => {
  it('names the accounts each method needs before a run can post', () => {
    expect(REQUIRED_GL.AMORTIZATION.map((g) => g.column)).toEqual(['acquisition_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id', 'writeoff_gl_id']);
    expect(REQUIRED_GL.FAIR_VALUE.map((g) => g.column)).toEqual(['acquisition_gl_id', 'fv_gain_loss_gl_id', 'writeoff_gl_id']);
  });
});

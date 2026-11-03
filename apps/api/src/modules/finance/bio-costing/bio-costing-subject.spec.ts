import { itemHasCostingTerms, itemStartAge, subjectFromItem } from './bio-costing-subject';
import { amortisationLine, periodFor } from './bio-costing.engine';
import { resolveResidual } from './bio-costing.rules';

const item = (o: Record<string, unknown> = {}): any => ({
  item_id: 'i1', item_code: 'GP-Imp-F', tenant_id: 't', company_id: 'c', is_active: true, is_blocked: false, deleted_at: null, is_biological_asset: true,
  bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 33, bio_start_age_days: 2, bio_useful_life_months: 36,
  bio_residual_rule: 'WEIGHT_X_PRICE', bio_residual_weight_kg: '150.000', bio_residual_price_per_kg: '2.050000', bio_residual_fixed_amount: null,
  bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_auto_post: true, bio_effective_from: '2026-03-01',
  bio_acquisition_gl_id: 'g-acq', bio_accum_amort_gl_id: 'g-accum', bio_amort_expense_gl_id: 'g-exp', bio_fv_gain_loss_gl_id: null, bio_writeoff_gl_id: 'g-w', ...o,
});

describe('costing subject: what a run is made for (a biological item)', () => {
  describe('itemHasCostingTerms', () => {
    it('is true only for a biological asset with a costing method', () => {
      expect(itemHasCostingTerms({ is_biological_asset: true, bio_costing_method: 'FAIR_VALUE' })).toBe(true);
      expect(itemHasCostingTerms({ is_biological_asset: true, bio_costing_method: null })).toBe(false);
      expect(itemHasCostingTerms({ is_biological_asset: false, bio_costing_method: 'AMORTIZATION' })).toBe(false);
    });
  });

  describe('itemStartAge', () => {
    it('reads weeks and days, blank as zero', () => {
      expect(itemStartAge({ bio_start_age_weeks: 26, bio_start_age_days: 3 })).toEqual({ weeks: 26, days: 3 });
      expect(itemStartAge({})).toEqual({ weeks: 0, days: 0 });
    });
  });

  describe('subjectFromItem', () => {
    it('speaks the terms the engine already takes, from the item\'s columns', () => {
      const s = subjectFromItem(item());
      expect(s).toMatchObject({ id: 'i1', code: 'GP-Imp-F', company_id: 'c', costing_method: 'AMORTIZATION', run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS', auto_post: true, effective_from: '2026-03-01', not_runnable: null });
      expect(s.terms).toMatchObject({ start_age_weeks: 33, useful_life_months: 36, residual_rule: 'WEIGHT_X_PRICE', tracking: 'INDIVIDUAL', residual_applies_gender: null });
      expect(s.gl).toEqual({ acquisition_gl_id: 'g-acq', accum_amort_gl_id: 'g-accum', amort_expense_gl_id: 'g-exp', fv_gain_loss_gl_id: null, writeoff_gl_id: 'g-w' });
    });

    it('defaults what the item left blank: monthly, frequency days, no residual', () => {
      const s = subjectFromItem(item({ bio_run_frequency: null, bio_day_basis: null, bio_residual_rule: null }));
      expect(s).toMatchObject({ run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS' });
      expect(s.terms.residual_rule).toBe('NONE');
    });

    it('has no scheduling date until the item gives one', () => {
      expect(subjectFromItem(item({ bio_effective_from: null })).effective_from).toBeNull();
    });

    it.each([
      ['has no costing method', { bio_costing_method: null }, /GP-Imp-F has no costing method/],
      ['is not active', { is_active: false }, /not active/],
      ['is blocked', { is_blocked: true }, /not active/],
      ['is removed', { deleted_at: '2026-01-01' }, /not active/],
      ['belongs to no company', { company_id: null }, /not a company's own item/],
    ])('cannot be run when it %s', (_why, over, message) => {
      expect(subjectFromItem(item(over)).not_runnable).toMatch(message as RegExp);
    });

    it('feeds the engine the terms of the item: the charge for one animal and month follows from them', () => {
      const animal = { animal_id: 'a1', gender: 'F', dob: '2025-01-05', entry_date: '2025-02-01', age_at_entry_weeks: null, costing_start_date: '2025-08-24', is_active: true, disposal_date: null, exit_date: null };
      const period = periodFor('MONTHLY', '2026-03-15');
      const s = subjectFromItem(item({ bio_start_age_days: 0 }));
      const residual = resolveResidual({ terms: s.terms, gender: 'F' }).value;
      const line = amortisationLine({ terms: s.terms, animal, period, bookValueBefore: 392.8, residual });
      expect(residual).toBe(307.5);
      // life ends 1095 days after birth (2028-01-05); 30 of 30 days inside the window; remaining days from the period start
      expect(line).toMatchObject({ status: 'CHARGED', days: 30, residual: 307.5, costing_start_date: '2025-08-24' });
      expect(line.charge).toBeGreaterThan(0);
      expect(line.book_value_after).toBeCloseTo(392.8 - line.charge, 4);
    });

    it('gives a boar item no residual: its own rule is NONE', () => {
      const s = subjectFromItem(item({ bio_gender: 'M', bio_residual_rule: 'NONE', bio_residual_weight_kg: null, bio_residual_price_per_kg: null }));
      expect(resolveResidual({ terms: s.terms, gender: 'M' }).value).toBe(0);
    });
  });
});

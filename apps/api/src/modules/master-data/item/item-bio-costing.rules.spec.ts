import {
  BIO_COSTING_COLUMNS, changedLockedBioColumns, hasBioCostingTerms, missingBioGl, storedBioCosting, validateItemBioCosting,
} from './item-bio-costing.rules';

const sow = {
  is_biological_asset: true,
  bio_costing_method: 'AMORTIZATION',
  bio_gender: 'F',
  bio_start_age_weeks: 33,
  bio_useful_life_months: 36,
  bio_residual_rule: 'WEIGHT_X_PRICE',
  bio_residual_weight_kg: 150,
  bio_residual_price_per_kg: 2.05,
};

describe('item bio costing rules (TDD Item Card, Bio Asset Costing tab)', () => {
  describe('validateItemBioCosting', () => {
    it('accepts a sow item: amortised from 33 weeks over 36 months to 150 kg x 2.05', () => {
      expect(validateItemBioCosting(sow)).toEqual([]);
    });

    it('says nothing about an item that is not a biological asset', () => {
      expect(validateItemBioCosting({ is_biological_asset: false, bio_costing_method: 'NONSENSE' })).toEqual([]);
    });

    it('accepts a biological item with no costing terms yet (PIGLETS, Finisher until the batch rule is given)', () => {
      expect(validateItemBioCosting({ is_biological_asset: true })).toEqual([]);
    });

    it('asks for the method when other terms were given without one', () => {
      expect(validateItemBioCosting({ is_biological_asset: true, bio_start_age_weeks: 33 })).toEqual([
        'Choose the FA/Bio Asset Costing Method (Amortization or Fair Value) for the costing terms given.',
      ]);
    });

    it('requires a start period for either method', () => {
      expect(validateItemBioCosting({ ...sow, bio_start_age_weeks: null })).toContain('The start period (weeks) must be a whole number, 0 or more.');
      expect(validateItemBioCosting({ ...sow, bio_costing_method: 'FAIR_VALUE', bio_residual_rule: 'NONE', bio_residual_weight_kg: null, bio_residual_price_per_kg: null, bio_start_age_weeks: -1 }))
        .toContain('The start period (weeks) must be a whole number, 0 or more.');
    });

    it('keeps the start days within a week', () => {
      expect(validateItemBioCosting({ ...sow, bio_start_age_days: 7 })).toContain('The start period days must be a whole number from 0 to 6.');
      expect(validateItemBioCosting({ ...sow, bio_start_age_days: 3 })).toEqual([]);
    });

    it('needs a useful life to amortise, but not to fair-value', () => {
      expect(validateItemBioCosting({ ...sow, bio_useful_life_months: null })).toContain('Amortisation needs a useful life in whole months, above 0.');
      expect(validateItemBioCosting({ ...sow, bio_costing_method: 'FAIR_VALUE', bio_residual_rule: 'NONE', bio_residual_weight_kg: null, bio_residual_price_per_kg: null, bio_useful_life_months: null })).toEqual([]);
    });

    it('gives fair value no residual', () => {
      expect(validateItemBioCosting({ ...sow, bio_costing_method: 'FAIR_VALUE' })).toContain('Fair value has no residual; set the residual rule to NONE.');
    });

    it('checks each residual rule', () => {
      expect(validateItemBioCosting({ ...sow, bio_residual_rule: 'FIXED', bio_residual_weight_kg: null, bio_residual_price_per_kg: null })).toContain('A fixed residual needs an amount of 0 or more.');
      expect(validateItemBioCosting({ ...sow, bio_residual_price_per_kg: 0 })).toContain('A weight-times-price residual needs a weight and a price per kg, both above 0.');
      expect(validateItemBioCosting({ ...sow, bio_residual_rule: 'NONE' })).toContain('Residual amounts were given but the residual rule is NONE.');
    });

    it('takes a Costing From date, and refuses one that is not a date', () => {
      expect(validateItemBioCosting({ ...sow, bio_effective_from: '2026-01-01' })).toEqual([]);
      expect(validateItemBioCosting({ ...sow, bio_effective_from: 'next week' })).toContain('Costing from must be a date (YYYY-MM-DD).');
    });

    it('rejects an unknown method, frequency, day basis and gender', () => {
      const e = validateItemBioCosting({ ...sow, bio_costing_method: 'X', bio_run_frequency: 'DAILY', bio_day_basis: 'Y', bio_gender: 'Z' });
      expect(e).toEqual(expect.arrayContaining([
        expect.stringContaining('FA/Bio Asset Costing Method must be one of'),
        expect.stringContaining('Frequency must be one of'),
        expect.stringContaining('Day basis must be'),
        'Gender must be F or M.',
      ]));
    });
  });

  describe('storedBioCosting', () => {
    it('drops every term of an item that is not a biological asset', () => {
      const out = storedBioCosting({ ...sow, is_biological_asset: false, bio_auto_post: true });
      for (const c of BIO_COSTING_COLUMNS) expect(out[c]).toBe(c === 'bio_auto_post' ? false : null);
    });

    it('fills the defaults of a costed item: monthly, frequency-days, no residual, start days 0', () => {
      const out = storedBioCosting({ is_biological_asset: true, bio_costing_method: 'FAIR_VALUE', bio_start_age_weeks: 17 });
      expect(out).toMatchObject({ bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_residual_rule: 'NONE', bio_start_age_days: 0 });
    });

    it('leaves an uncosted biological item uncosted', () => {
      const out = storedBioCosting({ is_biological_asset: true });
      expect(out.bio_costing_method).toBeNull();
      expect(out.bio_run_frequency).toBeNull();
    });

    it('clears residual amounts under a residual rule of NONE', () => {
      const out = storedBioCosting({ ...sow, bio_residual_rule: 'NONE' });
      expect([out.bio_residual_fixed_amount, out.bio_residual_weight_kg, out.bio_residual_price_per_kg]).toEqual([null, null, null]);
    });
  });

  describe('hasBioCostingTerms', () => {
    it('ignores auto-post, which is a switch with a default', () => {
      expect(hasBioCostingTerms({ bio_auto_post: true })).toBe(false);
      expect(hasBioCostingTerms({ bio_gender: 'M' })).toBe(true);
    });
  });

  describe('missingBioGl', () => {
    it('lists the accounts an amortising item still needs', () => {
      expect(missingBioGl({ bio_costing_method: 'AMORTIZATION', bio_acquisition_gl_id: 'a' })).toEqual([
        'accumulated amortisation', 'amortisation expense', 'mortality / impairment loss',
      ]);
    });

    it('lists the accounts a fair-valued item needs', () => {
      expect(missingBioGl({ bio_costing_method: 'FAIR_VALUE', bio_acquisition_gl_id: 'a', bio_writeoff_gl_id: 'w' })).toEqual(['fair value gain / loss']);
    });

    it('lists nothing once every needed account is set', () => {
      expect(missingBioGl({
        bio_costing_method: 'AMORTIZATION', bio_acquisition_gl_id: 'a', bio_accum_amort_gl_id: 'b', bio_amort_expense_gl_id: 'c', bio_writeoff_gl_id: 'd',
      })).toEqual([]);
    });
  });

  describe('changedLockedBioColumns', () => {
    const stored = { bio_costing_method: 'AMORTIZATION', bio_useful_life_months: 36, bio_residual_price_per_kg: '2.050000', bio_auto_post: false };

    it('sees a changed locked term', () => {
      expect(changedLockedBioColumns(stored, { bio_useful_life_months: 24 })).toEqual(['bio_useful_life_months']);
    });

    it('does not count a number sent in another form as a change', () => {
      expect(changedLockedBioColumns(stored, { bio_useful_life_months: '36', bio_residual_price_per_kg: 2.05 })).toEqual([]);
    });

    it('does not lock auto-post', () => {
      expect(changedLockedBioColumns(stored, { bio_auto_post: true })).toEqual([]);
    });

    it('ignores what the caller did not send', () => {
      expect(changedLockedBioColumns(stored, {})).toEqual([]);
    });

    it('treats null and empty as the same blank', () => {
      expect(changedLockedBioColumns({ bio_gender: null }, { bio_gender: '' })).toEqual([]);
    });
  });
});

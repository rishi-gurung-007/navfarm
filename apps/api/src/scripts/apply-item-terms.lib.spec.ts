import { FIXED_ASSET_ITEMS } from './fixed-asset-items.lib';
import { planSheetTerms, type FoundAccount, type FoundItem } from './apply-item-terms.lib';

const byCode = (code: string) => FIXED_ASSET_ITEMS.find((c) => c.item_code === code)!;
const found = (code: string, over: Partial<FoundItem> = {}): FoundItem => ({ item_id: `id-${code}`, item_code: code, company_id: 'c', is_biological_asset: 1, bio_costing_method: null, ...over });
const account = (name: string, id = `gl-${name}`): FoundAccount => ({ gl_account_id: id, account_name: name, company_id: 'c' });
const allItems = FIXED_ASSET_ITEMS.map((c) => found(c.item_code));
const entry = (plan: ReturnType<typeof planSheetTerms>, code: string) => plan.find((p) => p.item_code === code)!;

describe('the Fixed Asset sheet\'s figures, as data', () => {
  it('lists the twelve items the sheet names, in its order', () => {
    expect(FIXED_ASSET_ITEMS.map((c) => c.item_code)).toEqual([
      'GGP-Imp-F', 'GGP-Imp-M', 'GP-Imp-F', 'GP-Imp-M', 'P-Imp-F', 'P-Imp-M', 'GP-Loc-F', 'GP-Loc-M', 'P-Loc-F', 'P-Loc-M', 'PIGLETS', 'Finisher',
    ]);
  });

  it('imported animals are amortised: a female 36 months from week 33 to 150 kg x 2.05 = 307.50, a male 18 months from week 26 to nothing', () => {
    for (const code of ['GGP-Imp-F', 'GP-Imp-F', 'P-Imp-F']) expect(byCode(code)).toMatchObject({ costing_method: 'AMORTIZATION', gender: 'F', life_months: 36, start_weeks: 33, residual: { rule: 'WEIGHT_X_PRICE', weight_kg: 150, price_per_kg: 2.05 }, classification: 'NON_CURRENT', tracking: 'INDIVIDUAL' });
    for (const code of ['GGP-Imp-M', 'GP-Imp-M', 'P-Imp-M']) expect(byCode(code)).toMatchObject({ costing_method: 'AMORTIZATION', gender: 'M', life_months: 18, start_weeks: 26, residual: { rule: 'NONE' } });
  });

  it('local animals are fair-valued (GP and P only: the sheet lists no GGP-Loc), 36 / 33 for a female and 18 / 26 for a male, on 150 kg x 2.05, CDM based: No', () => {
    for (const code of ['GP-Loc-F', 'P-Loc-F']) expect(byCode(code)).toMatchObject({ costing_method: 'FAIR_VALUE', gender: 'F', life_months: 36, start_weeks: 33, fair_value: { cdm_based: false, expected_weight_kg: 150, price_per_kg: 2.05 } });
    for (const code of ['GP-Loc-M', 'P-Loc-M']) expect(byCode(code)).toMatchObject({ costing_method: 'FAIR_VALUE', gender: 'M', life_months: 18, start_weeks: 26 });
    expect(FIXED_ASSET_ITEMS.some((c) => c.item_code.startsWith('GGP-Loc'))).toBe(false);
  });

  it('weaners are current, batch-tracked, fair-valued from week 17 on 60 kg x 2.05 CDM based; the finisher has a classification and no method', () => {
    expect(byCode('PIGLETS')).toMatchObject({ classification: 'CURRENT', tracking: 'BATCH', costing_method: 'FAIR_VALUE', start_weeks: 17, fair_value: { cdm_based: true, expected_weight_kg: 60, price_per_kg: 2.05 }, runnable: false });
    expect(byCode('PIGLETS').open.join(' ')).toMatch(/week 17.*18/);
    expect(byCode('Finisher')).toMatchObject({ classification: 'CURRENT', tracking: 'BATCH', costing_method: null, runnable: false });
  });

  it('names the accounts as the sheet does, and none for accumulated amortisation or impairment', () => {
    expect(byCode('GGP-Imp-F').accounts).toEqual({ acquisition: 'GGP-Imp-F Acquisition Cost', result: 'GGP-IMP-F Amortization' });
    expect(byCode('P-Loc-M').accounts).toEqual({ acquisition: 'P-Loc-M Acquisition Cost', result: 'P-Loc-M Fair Value Gain/Loss' });
    expect(byCode('PIGLETS').accounts).toEqual({ acquisition: 'Weaners Acquisition Cost', result: 'Weaners Fair Value Gain/Loss' });
  });
});

describe('planSheetTerms — what putting them on the items that have been created would do', () => {
  it('reports an item that has not been created, and creates nothing', () => {
    const plan = planSheetTerms({ items: [found('GGP-Imp-F')], accounts: [] });
    expect(entry(plan, 'GP-Imp-F')).toMatchObject({ status: 'MISSING' });
    expect(entry(plan, 'GP-Imp-F').notes.join(' ')).toMatch(/Create the item GP-Imp-F first/);
    expect(entry(plan, 'GGP-Imp-F').status).toBe('READY');
  });

  it('gives an imported female the sheet\'s terms; the Costing From date is only what the caller names', () => {
    const plan = planSheetTerms({ items: allItems, accounts: [], costingFrom: '2026-01-01' });
    expect(entry(plan, 'P-Imp-F').terms).toMatchObject({
      bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 33, bio_start_age_days: 0, bio_useful_life_months: 36,
      bio_residual_rule: 'WEIGHT_X_PRICE', bio_residual_weight_kg: 150, bio_residual_price_per_kg: 2.05, bio_effective_from: '2026-01-01', bio_auto_post: false,
    });
    expect(entry(planSheetTerms({ items: allItems, accounts: [] }), 'P-Imp-F').terms!.bio_effective_from).toBeNull();
    expect(entry(planSheetTerms({ items: allItems, accounts: [] }), 'P-Imp-F').notes.join(' ')).toMatch(/No Costing From date given/);
  });

  it('gives a local item fair value, no residual, the fair-value account, and a dated rate only when a date is named', () => {
    const withDate = entry(planSheetTerms({ items: allItems, accounts: [account('GP-Loc-F Fair Value Gain/Loss')], costingFrom: '2026-01-01' }), 'GP-Loc-F');
    expect(withDate.terms).toMatchObject({ bio_costing_method: 'FAIR_VALUE', bio_residual_rule: 'NONE', bio_useful_life_months: 36, bio_start_age_weeks: 33, bio_fv_gain_loss_gl_id: 'gl-GP-Loc-F Fair Value Gain/Loss', bio_amort_expense_gl_id: null });
    expect(withDate.rate).toEqual({ farm_id: null, age_week_from: 0, effective_from: '2026-01-01', expected_weight_kg: 150, price_per_kg: 2.05, cdm_based: false, costs_to_sell_pct: null });
    const noDate = entry(planSheetTerms({ items: allItems, accounts: [] }), 'GP-Loc-F');
    expect(noDate.rate).toBeUndefined();
    expect(noDate.notes.join(' ')).toMatch(/added only with a date/);
  });

  it('uses the accounts the chart holds under the sheet\'s names (any case), reports the rest, and leaves what the sheet does not name for Finance', () => {
    const accounts = [account('ggp-imp-f acquisition cost', 'g1'), account('GGP-IMP-F Amortization', 'g2')];
    const e = entry(planSheetTerms({ items: allItems, accounts }), 'GGP-Imp-F');
    expect(e.terms).toMatchObject({ bio_acquisition_gl_id: 'g1', bio_amort_expense_gl_id: 'g2', bio_accum_amort_gl_id: null, bio_writeoff_gl_id: null });
    expect(e.accounts_set).toEqual(['GGP-Imp-F Acquisition Cost', 'GGP-IMP-F Amortization']);
    expect(e.missing_for_run).toEqual(['accumulated amortisation', 'mortality / impairment loss']);
    const none = entry(planSheetTerms({ items: allItems, accounts: [] }), 'GGP-Imp-F');
    expect(none.accounts_not_in_chart).toEqual(['GGP-Imp-F Acquisition Cost', 'GGP-IMP-F Amortization']);
    expect(none.missing_for_run).toEqual(['acquisition cost', 'accumulated amortisation', 'amortisation expense', 'mortality / impairment loss']);
  });

  it('only takes accounts of the item\'s own company (or the tenant\'s)', () => {
    const accounts: FoundAccount[] = [{ gl_account_id: 'other', account_name: 'GGP-Imp-F Acquisition Cost', company_id: 'another' }, { gl_account_id: 'mine', account_name: 'GGP-IMP-F Amortization', company_id: null }];
    const e = entry(planSheetTerms({ items: allItems, accounts }), 'GGP-Imp-F');
    expect(e.terms).toMatchObject({ bio_acquisition_gl_id: null, bio_amort_expense_gl_id: 'mine' });
  });

  it('never overwrites an item that has terms, and notes one that is not marked biological', () => {
    const items = [found('GGP-Imp-F', { bio_costing_method: 'FAIR_VALUE' }), found('GGP-Imp-M', { is_biological_asset: 0 })];
    const plan = planSheetTerms({ items, accounts: [] });
    expect(entry(plan, 'GGP-Imp-F').status).toBe('ALREADY_HAS_TERMS');
    expect(entry(plan, 'GGP-Imp-F').terms).toBeUndefined();
    expect(entry(plan, 'GGP-Imp-M').status).toBe('NOT_BIOLOGICAL');
  });

  it('leaves PIGLETS and Finisher without costing terms, with the sheet\'s open points', () => {
    const plan = planSheetTerms({ items: allItems, accounts: [] });
    expect(entry(plan, 'PIGLETS').status).toBe('NOT_COSTED_YET');
    expect(entry(plan, 'PIGLETS').terms).toBeUndefined();
    expect(entry(plan, 'PIGLETS').notes.join(' ')).toMatch(/Batch-tracked/);
    expect(entry(plan, 'Finisher').status).toBe('NOT_COSTED_YET');
  });

  it('matches an item code without regard to case', () => {
    expect(entry(planSheetTerms({ items: [found('ggp-imp-f')], accounts: [] }), 'GGP-Imp-F').status).toBe('READY');
  });
});

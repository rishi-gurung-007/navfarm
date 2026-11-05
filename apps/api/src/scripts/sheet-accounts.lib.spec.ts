import { FIXED_ASSET_ITEMS } from './fixed-asset-items.lib';
import { creditBalance, planSheetAccounts, sheetAccountNames, sheetItemGl } from './sheet-accounts.lib';

const item = (code: string) => FIXED_ASSET_ITEMS.find((i) => i.item_code === code)!;

describe('sheetAccountNames — every account the Fixed Asset sheet (V1.3) names, once', () => {
  it('names an acquisition, an accumulated amortisation and an amortisation account for each imported item, and fair value for the rest', () => {
    const names = sheetAccountNames();
    const kindOf = (n: string) => names.find((x) => x.name === n)?.kind;
    expect(kindOf('GP-Imp-F Acquisition Cost')).toBe('acquisition');
    expect(kindOf('GP-Imp-F Accumulated Amortization')).toBe('accumulated');
    expect(kindOf('GP-IMP-F Amortization')).toBe('amortisation');
    expect(kindOf('GP-Loc-F Fair Value Gain/Loss')).toBe('fair_value');
    expect(kindOf('Finisher Closing Stock')).toBe('acquisition');
    expect(kindOf('Finisher Fair Value Gain/Loss')).toBe('fair_value');
    expect(names.filter((n) => n.kind === 'accumulated')).toHaveLength(6);
    // 12 acquisition (10 animals, Weaners, Finisher) + 6 accumulated + 6 amortisation + 6 fair value (4 local, Weaners, Finisher)
    expect(names).toHaveLength(30);
  });
});

describe('planSheetAccounts', () => {
  it('uses an account the chart already holds under the sheet\'s name (any case), and gives the rest the next free code of their kind', () => {
    const chart = [
      { gl_account_id: 'a1', account_code: '1101', account_name: 'ggp-imp-f acquisition cost' },
      { gl_account_id: 'x', account_code: '1121', account_name: 'Something else' },
    ];
    const plan = planSheetAccounts(chart);
    const of = (n: string) => plan.find((p) => p.name === n)!;
    expect(of('GGP-Imp-F Acquisition Cost')).toMatchObject({ action: 'EXISTS', gl_account_id: 'a1', code: '1101' });
    expect(of('GGP-Imp-M Acquisition Cost')).toMatchObject({ action: 'CREATE', code: '1102', account_type: 'ASSET' });
    // 1121 is taken, so the first accumulated account goes to 1122
    expect(of('GGP-Imp-F Accumulated Amortization')).toMatchObject({ action: 'CREATE', code: '1122', account_type: 'ASSET' });
    expect(of('GGP-IMP-F Amortization')).toMatchObject({ code: '5101', account_type: 'EXPENSE' });
    expect(of('GP-Loc-F Fair Value Gain/Loss')).toMatchObject({ code: '4101', account_type: 'INCOME' });
    expect(new Set(plan.map((p) => p.code)).size).toBe(plan.length);
  });
});

describe('sheetItemGl', () => {
  const idOf = (n: string | null) => (n ? `id:${n}` : null);
  it('gives an amortised item its acquisition, accumulated amortisation and expense, and no fair value account', () => {
    expect(sheetItemGl(item('P-Imp-F'), idOf)).toEqual({
      bio_acquisition_gl_id: 'id:P-Imp-F Acquisition Cost', bio_accum_amort_gl_id: 'id:P-Imp-F Accumulated Amortization',
      bio_amort_expense_gl_id: 'id:P-IMP-F Amortization', bio_fv_gain_loss_gl_id: null,
    });
  });
  it('gives a fair value item, PIGLETS and Finisher their acquisition and fair value accounts only', () => {
    expect(sheetItemGl(item('GP-Loc-M'), idOf)).toEqual({ bio_acquisition_gl_id: 'id:GP-Loc-M Acquisition Cost', bio_accum_amort_gl_id: null, bio_amort_expense_gl_id: null, bio_fv_gain_loss_gl_id: 'id:GP-Loc-M Fair Value Gain/Loss' });
    expect(sheetItemGl(item('Finisher'), idOf)).toMatchObject({ bio_acquisition_gl_id: 'id:Finisher Closing Stock', bio_fv_gain_loss_gl_id: 'id:Finisher Fair Value Gain/Loss' });
  });
});

describe('creditBalance', () => {
  it('is credits less debits', () => {
    expect(creditBalance([{ debit_amount: '0', credit_amount: '100.5' }, { debit_amount: '20.25', credit_amount: 0 }])).toBe(80.25);
  });
});

import { codesFor, coaProblems, DUMMY_COA, ITEM_ACCOUNTS, OUR_ACCOUNTS, planProjectCoa, PROJECT_COA } from './project-coa.lib';

describe('the project chart of accounts (NAVFarm_Dummy_COA.xlsx)', () => {
  it('holds the workbook\'s 32 accounts with its codes and names, exactly', () => {
    expect(DUMMY_COA).toHaveLength(32);
    expect(DUMMY_COA.every((a) => a.source === 'COA')).toBe(true);
    const of = (code: string) => DUMMY_COA.find((a) => a.code === code)?.name;
    expect(of('150100')).toBe('GGP-Imp-F Acquisition Cost');
    expect(of('150110')).toBe('Accumulated Amortization - GGP-Imp-F');
    expect(of('520100')).toBe('Amortization Expense - GGP-Imp-F');
    expect(of('720100')).toBe('FV Gain - Weaners');
    expect(of('820100')).toBe('FV Loss - Weaners');
    expect(of('610400')).toBe('Mortality / Impairment Loss');
    expect(of('100100')).toBe('Cash & Bank');
  });

  it('marks every account the workbook does not have as ours', () => {
    expect(OUR_ACCOUNTS.every((a) => a.source === 'OURS')).toBe(true);
    expect(OUR_ACCOUNTS.some((a) => DUMMY_COA.some((d) => d.code === a.code))).toBe(false);
  });

  it('has no code twice, replaces each starter code once, and names only accounts it holds', () => {
    expect(coaProblems()).toEqual([]);
    expect(coaProblems([...PROJECT_COA, { code: '150100', name: 'x', type: 'ASSET', source: 'OURS' }])).toContain('code 150100 is used 2 times');
  });

  it('gives each amortised item its own acquisition, accumulated and expense accounts, and each fair value item a gain and a loss account', () => {
    expect(ITEM_ACCOUNTS['GGP-Imp-F']).toEqual({ acquisition: '150100', accumulated: '150110', amortisation: '520100', writeoff: '610400' });
    expect(ITEM_ACCOUNTS['P-Loc-M']).toMatchObject({ acquisition: '151400', fv_gain: '721400', fv_loss: '821400' });
    expect(ITEM_ACCOUNTS.PIGLETS).toMatchObject({ acquisition: '170400', fv_gain: '720100', fv_loss: '820100' });
  });

  it('knows a starter code by its new one too', () => {
    expect(codesFor('1050')).toEqual(['1050', '152100']);
    expect(codesFor('5010')).toEqual(['5010', '610400']);
    expect(codesFor('9999')).toEqual(['9999']);
  });
});

describe('planProjectCoa', () => {
  const row = (code: string, name: string, id = `id-${code}`) => ({ gl_account_id: id, account_code: code, account_name: name, account_type: 'ASSET' });
  it('renumbers the starter row an account replaces, creates what the chart lacks, and keeps an account already at its code', () => {
    const plan = planProjectCoa([row('1010', 'Raw Material Inventory'), row('150100', 'old name')]);
    const of = (code: string) => plan.find((p) => p.account.code === code)!;
    expect(of('170100')).toMatchObject({ action: 'RENAME', gl_account_id: 'id-1010', from: { code: '1010', name: 'Raw Material Inventory' } });
    expect(of('150100')).toMatchObject({ action: 'KEEP', gl_account_id: 'id-150100' });
    expect(of('170200')).toMatchObject({ action: 'CREATE', gl_account_id: null });
  });
});

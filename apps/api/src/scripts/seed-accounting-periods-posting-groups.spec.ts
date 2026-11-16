import { POSTING_GROUPS, resolveAccount, twelveMonths } from './seed-accounting-periods-posting-groups';

describe('accounting period and posting group seed', () => {
  it('runs twelve months from April, with only April marked New Fiscal Year', () => {
    const p = twelveMonths(2026, 4);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ starting_date: '2026-04-01', name: 'Apr 2026', new_fiscal_year: true });
    expect(p[8].starting_date).toBe('2026-12-01');
    expect(p[9].starting_date).toBe('2027-01-01');
    expect(p[11]).toMatchObject({ starting_date: '2027-03-01', name: 'Mar 2027', new_fiscal_year: false });
    expect(p.filter((x) => x.new_fiscal_year)).toHaveLength(1);
  });
  it('gives every group a unique code and the accounts its kind needs', () => {
    expect(new Set(POSTING_GROUPS.map((g) => g.code)).size).toBe(POSTING_GROUPS.length);
    for (const g of POSTING_GROUPS.filter((x) => x.kind === 'BIOLOGICAL')) expect(g.accounts.asset_gl_id).toBeDefined();
    for (const g of POSTING_GROUPS.filter((x) => x.kind === 'INVENTORY')) expect(g.accounts.inventory_gl_id).toBeDefined();
  });
  it('takes the project code, else the starter code, else nothing', () => {
    const idOf = new Map([['152100', 'a'], ['1060', 'b']]);
    expect(resolveAccount('152100|1050', idOf)).toBe('a');
    expect(resolveAccount('152200|1060', idOf)).toBe('b');
    expect(resolveAccount('170100|1010', idOf)).toBeUndefined();
  });
});

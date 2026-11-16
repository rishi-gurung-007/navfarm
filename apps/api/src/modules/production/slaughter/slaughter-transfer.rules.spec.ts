import { activeWithdrawals, assertSlaughterStatus, doaOverThreshold, invoiceLine, podIssues, slapMark, splitTransitValue } from './slaughter-transfer.rules';

describe('slaughter Transfer Order rules (BBP-1 S.10.1)', () => {
  it('prints the slap mark as [Farm Code]-[Batch No.]', () => {
    expect(slapMark('MUL100', 'LIT-000028')).toBe('MUL100-LIT-000028');
  });

  it('blocks a medicine or vaccine whose withdrawal has not cleared, by the latest dose, and ignores feed and items with no withdrawal', () => {
    const doses = [
      { item_name: 'Penicillin', item_type: 'MEDICINE', administered_date: '2026-10-01', withdrawal_days: 21 },
      { item_name: 'Penicillin', item_type: 'MEDICINE', administered_date: '2026-10-10', withdrawal_days: 21 },
      { item_name: 'Parvo', item_type: 'VACCINE', administered_date: '2026-09-01', withdrawal_days: 14 },
      { item_name: 'Mash', item_type: 'FEED', administered_date: '2026-10-30', withdrawal_days: 99 },
      { item_name: 'Iron', item_type: 'MEDICINE', administered_date: '2026-10-30', withdrawal_days: null },
    ];
    expect(activeWithdrawals(doses, '2026-10-25')).toEqual([{ item_name: 'Penicillin', clear_date: '2026-10-31' }]);
    expect(activeWithdrawals(doses, '2026-10-31')).toEqual([]);
  });

  it('splits a line\'s transit value between DOA and delivered, the delivered part taking the rounding', () => {
    expect(splitTransitValue(100, 3, 1)).toEqual({ doa: 33.3333, delivered: 66.6667 });
    expect(splitTransitValue(100, 3, 0)).toEqual({ doa: 0, delivered: 100 });
    expect(splitTransitValue(100, 3, 3)).toEqual({ doa: 100, delivered: 0 });
  });

  it('needs a DOA count on every line, a whole number up to the head sent', () => {
    const lines = [{ line_no: 1, head_count: 10 }, { line_no: 2, head_count: 4 }];
    expect(podIssues(lines, new Map([[1, 0], [2, 4]]))).toEqual([]);
    expect(podIssues(lines, new Map([[1, 0]]))[0]).toMatch(/Line 2 has no DOA/);
    expect(podIssues(lines, new Map([[1, 11], [2, 1.5]]))).toHaveLength(2);
  });

  it('invoices delivered x average carcass weight x price per kg', () => {
    expect(invoiceLine(9, 82.5, 3.1)).toEqual({ carcass_weight_kg: 742.5, amount: 2301.75 });
    expect(invoiceLine(0, 82.5, 3.1)).toEqual({ carcass_weight_kg: 0, amount: 0 });
  });

  it('raises the DOA alert above 5% of the head shipped', () => {
    expect(doaOverThreshold(1, 20)).toBe(false);
    expect(doaOverThreshold(2, 20)).toBe(true);
  });

  it('refuses a step from the wrong status', () => {
    expect(() => assertSlaughterStatus({ to_no: 'STO-1', status: 'DRAFT' }, 'CONFIRMED')).toThrow(/STO-1 is DRAFT/);
    expect(() => assertSlaughterStatus({ to_no: 'STO-1', status: 'DRAFT' }, 'DRAFT')).not.toThrow();
  });
});

import { rollForwardByProfile, tieOutRow, type LedgerFact } from './bio-costing-report.rules';

const f = (o: Partial<LedgerFact> & { entry_type: string; amount: number }): LedgerFact => ({ profile_code: 'IMP-F', has_animal: true, posting_date: '2026-09-30', ...o });

describe('rollForwardByProfile', () => {
  const rows: LedgerFact[] = [
    f({ entry_type: 'ACQUISITION', amount: 392.8, posting_date: '2024-02-07' }),            // opening
    f({ entry_type: 'CONSUMPTION', amount: 18.75, posting_date: '2026-09-10' }),
    f({ entry_type: 'AMORTIZATION', amount: -52.8655 }),
    f({ entry_type: 'ACQUISITION', amount: 300, profile_code: 'LOC-F', posting_date: '2025-10-15' }),
    f({ entry_type: 'FAIR_VALUE_ADJMT', amount: -9, profile_code: 'LOC-F' }),
    f({ entry_type: 'MORTALITY', amount: -300, profile_code: 'LOC-F', posting_date: '2026-10-05' }), // after dateTo: not counted
    f({ entry_type: 'ACQUISITION', amount: 657124, profile_code: null, posting_date: '2025-06-13' }),
    f({ entry_type: 'CONSUMPTION', amount: 5, profile_code: null, has_animal: false, posting_date: '2026-09-12' }),
    f({ entry_type: 'PURCHASE', amount: 9999 }),                                              // a GRN row: moves no carrying value
    f({ entry_type: 'TRANSFER_IN', amount: 50 }),
  ];
  const out = rollForwardByProfile(rows, '2026-09-01', '2026-09-30');
  const by = (key: string) => out.find((x) => x.key === key)!;

  it('gives each profile its own opening, movements and closing, and the roll adds up', () => {
    expect(by('P:IMP-F')).toMatchObject({ opening: 392.8, capitalised: 18.75, amortisation: -52.8655, closing: 358.6845 });
    expect(by('P:LOC-F')).toMatchObject({ opening: 300, fairValue: -9, exits: 0, closing: 291 });
  });
  it('keeps animals with no profile, and batch-level cost, apart', () => {
    expect(by('NO_PROFILE')).toMatchObject({ label: 'NO_PROFILE', opening: 657124, closing: 657124 });
    expect(by('BATCH_LEVEL')).toMatchObject({ label: 'BATCH_LEVEL', capitalised: 5, closing: 5 });
  });
  it('ignores a GRN purchase row, a transfer and anything dated after the period', () => {
    expect(out.reduce((n, x) => n + x.closing, 0)).toBeCloseTo(358.6845 + 291 + 657124 + 5, 4);
  });
  it('orders profiles first, then no-profile, then batch-level', () => {
    expect(out.map((x) => x.key)).toEqual(['P:IMP-F', 'P:LOC-F', 'NO_PROFILE', 'BATCH_LEVEL']);
  });
});

describe('tieOutRow', () => {
  const acct = { code: '2150', name: 'Accumulated amortisation' };
  it('reconciles when the GL holds what the ledger says, to the cent', () => {
    expect(tieOutRow('ACCUMULATED_AMORTISATION', acct, 'TO_DATE', 89.9525, 89.9525)).toMatchObject({ difference: 0, reconciled: true });
    expect(tieOutRow('ACCUMULATED_AMORTISATION', acct, 'TO_DATE', 89.9525, 89.96)).toMatchObject({ reconciled: true });
  });
  it('shows the difference, signed GL minus ledger, when they part: a death whose amortisation was never cleared', () => {
    const r = tieOutRow('ACCUMULATED_AMORTISATION', acct, 'TO_DATE', 0, 89.9525);
    expect(r).toMatchObject({ difference: 89.9525, reconciled: false });
  });
});

import { dayAfter, periodCostsOf } from './semen-cost';

describe('periodCostsOf — the cost behind a semen collection (G7)', () => {
  it('takes his own feed and drugs, his overhead plus his share of the batch\'s, and his amortisation plus his share', () => {
    expect(
      periodCostsOf(
        [
          { kind: 'CONSUMPTION', own: true, amount: -120, item_type: 'FEED' },
          { kind: 'CONSUMPTION', own: true, amount: -30, item_type: 'VACCINE' },
          { kind: 'CONSUMPTION', own: true, amount: -15, item_type: 'medicine' },
          { kind: 'OVERHEAD', own: true, amount: 40 },
          { kind: 'OVERHEAD', own: false, amount: 100 }, // the batch's, 4 head
          { kind: 'AMORTIZATION', own: true, amount: -250 },
          { kind: 'AMORTIZATION', own: false, amount: -80 },
        ],
        4,
      ),
    ).toEqual({ feed: 120, drug: 45, overhead: 65, amortisation: 270 });
  });

  it('never charges him another animal\'s consumption', () => {
    expect(periodCostsOf([{ kind: 'CONSUMPTION', own: false, amount: -999, item_type: 'FEED' }], 2)).toEqual({ feed: 0, drug: 0, overhead: 0, amortisation: 0 });
  });

  it('charges no batch share when the batch has no head', () => {
    expect(periodCostsOf([{ kind: 'OVERHEAD', own: false, amount: 50 }], 0).overhead).toBe(0);
  });

  it('starts a period the day after the last collection', () => {
    expect(dayAfter('2026-09-30')).toBe('2026-10-01');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
  });
});

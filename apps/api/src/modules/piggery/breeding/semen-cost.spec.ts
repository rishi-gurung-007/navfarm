import { dayAfter, periodCostsOf, semenCostPeriodOf } from './semen-cost';

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

describe('semenCostPeriodOf — the collection closes the boar\'s period (D2)', () => {
  it('runs from his entry when he has no earlier lot', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-23', entryDate: '2025-09-14 00:00:00' })).toEqual({ from: '2025-09-14', to: '2026-11-23' });
  });

  it('runs from the collection date when he has neither a lot nor an entry date', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-23' })).toEqual({ from: '2026-11-23', to: '2026-11-23' });
  });

  it('runs from the day after his latest lot', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-23', latestCollection: '2025-09-13', entryDate: '2024-01-01' })).toEqual({ from: '2025-09-14', to: '2026-11-23' });
  });

  it('covers no period for a second collection the same day: the first lot already took the costs', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-23', latestCollection: '2026-11-23' })).toBeNull();
  });

  it('covers no period for a back-dated collection: a later lot already took the costs up to its date', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-20', latestCollection: '2026-11-23' })).toBeNull();
  });

  it('ends on a typed period end', () => {
    expect(semenCostPeriodOf({ collectionDate: '2026-11-23', periodTo: '2026-11-22', latestCollection: '2026-11-16' })).toEqual({ from: '2026-11-17', to: '2026-11-22' });
  });
});

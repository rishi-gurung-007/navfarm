import { allocateSharesToParts } from './consumption-split';

describe('sharing an entry out across locations', () => {
  it('keeps every share in the one location when there is only one', () => {
    expect(allocateSharesToParts([{ animal_id: 'A', quantity: 18 }, { animal_id: 'B', quantity: 18 }], [{ quantity: 36 }]))
      .toEqual([[{ animal_id: 'A', quantity: 18 }, { animal_id: 'B', quantity: 18 }]]);
  });

  it('lays the animals end to end across a silo and the store, splitting the one that straddles', () => {
    const parts = allocateSharesToParts(
      [{ animal_id: 'A', quantity: 18 }, { animal_id: 'B', quantity: 18 }],
      [{ quantity: 20 }, { quantity: 16 }],
    );
    expect(parts[0]).toEqual([{ animal_id: 'A', quantity: 18 }, { animal_id: 'B', quantity: 2 }]);
    expect(parts[1]).toEqual([{ animal_id: 'B', quantity: 16 }]);
  });

  it('adds up exactly, whatever the rounding', () => {
    const shares = [{ animal_id: 'A', quantity: 3.3333 }, { animal_id: 'B', quantity: 3.3333 }, { animal_id: 'C', quantity: 3.3334 }];
    const parts = allocateSharesToParts(shares, [{ quantity: 4 }, { quantity: 6 }]);
    const total = (list: Array<{ quantity: number }>) => list.reduce((n, s) => n + s.quantity, 0);
    expect(total(parts[0])).toBeCloseTo(4, 4);
    expect(total(parts[1])).toBeCloseTo(6, 4);
  });

  it('gives a batch-wise share (no animal) the same treatment', () => {
    expect(allocateSharesToParts([{ quantity: 10 }], [{ quantity: 4 }, { quantity: 6 }])).toEqual([[{ animal_id: undefined, quantity: 4 }], [{ animal_id: undefined, quantity: 6 }]]);
  });
});

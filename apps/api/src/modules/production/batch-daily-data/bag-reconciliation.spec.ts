import { bagReconciliationWarning } from './bag-reconciliation';

describe('bagReconciliationWarning (checkpoint 28)', () => {
  it('flags the workbook example: 98 bags of 50 KG against 5,000 KG posted', () => {
    expect(bagReconciliationWarning({ emptyBags: 98, bagSizeKg: 50, consumedKg: 5000, tolerancePct: 1 }))
      .toBe('98 empty bags imply 4,900 KG versus 5,000 KG posted use; review tolerance (1%).');
  });

  it('allows a difference within the tolerance and an exact match', () => {
    expect(bagReconciliationWarning({ emptyBags: 98, bagSizeKg: 50, consumedKg: 5000, tolerancePct: 2 })).toBeNull();
    expect(bagReconciliationWarning({ emptyBags: 100, bagSizeKg: 50, consumedKg: 5000, tolerancePct: null })).toBeNull();
  });

  it('treats an unset tolerance as zero', () => {
    expect(bagReconciliationWarning({ emptyBags: 99, bagSizeKg: 50, consumedKg: 5000, tolerancePct: null })).toMatch(/review tolerance\.$/);
  });
});

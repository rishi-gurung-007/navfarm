import { asStageTotalLine, splitTotal } from './stage-total';

describe('per-batch lines in the All animals view', () => {
  it('shows a per-batch line as the stage total, and leaves a per-head line as it is', () => {
    const perBatch = { qty_basis: 'TOTAL_BATCH', expected_qty: 1, already_entered_qty: null };
    expect(asStageTotalLine(perBatch, 2)).toEqual({ qty_basis: 'TOTAL_BATCH', expected_qty: 2, already_entered_qty: null });
    expect(asStageTotalLine({ ...perBatch, already_entered_qty: 18 }, 2).already_entered_qty).toBe(36);
    const perHead = { qty_basis: 'PER_HEAD', expected_qty: 2 };
    expect(asStageTotalLine(perHead, 2)).toBe(perHead);
  });

  it('leaves a line alone when only one animal is left to post', () => {
    const perBatch = { qty_basis: 'TOTAL_BATCH', expected_qty: 2 };
    expect(asStageTotalLine(perBatch, 1)).toBe(perBatch);
  });

  it('splits a total so the shares add up exactly', () => {
    expect(splitTotal(36, 2)).toEqual([18, 18]);
    expect(splitTotal(10, 3)).toEqual([3.3333, 3.3333, 3.3334]);
    expect(splitTotal(10, 3).reduce((n, v) => n + v, 0)).toBeCloseTo(10, 4);
    expect(splitTotal(5, 1)).toEqual([5]);
  });
});

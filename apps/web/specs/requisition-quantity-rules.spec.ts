import { fitInSteps, isOffMultiple, orderStepKg, quantityProblems } from '../src/components/console/inventory/requisition-quantity-rules';

describe('requisition quantity rules in the form (Rishi, 30 Oct)', () => {
  const s = { bulkMultipleKg: 3000, bagSizeKg: 50 };
  it('orders bulk in compartments and bagged feed in bags', () => {
    expect(orderStepKg('BULK', s)).toBe(3000);
    expect(orderStepKg('BAGGED', s)).toBe(50);
    expect(isOffMultiple(4500, 3000)).toBe(true);
    expect(isOffMultiple(6000.0000000004, 3000)).toBe(false);
    expect(fitInSteps(8500, 3000)).toBe(6000);
  });
  it('flags a line off its multiple, and one that would overfill its silo with what fits', () => {
    const problems = quantityProblems([
      { quantityKg: 4500, feedType: 'BULK', destinationId: 'a', deliveryDate: '2026-11-07' },
      { quantityKg: 9000, feedType: 'BULK', destinationId: 'b', deliveryDate: '2026-11-07', capacityKg: 10000, stockOn: () => 2000 },
    ], s);
    expect(problems).toEqual([
      { kind: 'MULTIPLE', line: 0, multipleKg: 3000, bagged: false },
      { kind: 'CAPACITY', line: 1, capacityKg: 10000, stockKg: 2000, totalKg: 11000, fitsKg: 6000 },
    ]);
  });
  it('does not check capacity when the stock on that date is not known here', () => {
    expect(quantityProblems([{ quantityKg: 30000, feedType: 'BULK', destinationId: 'b', deliveryDate: '2026-11-07', capacityKg: 10000, stockOn: () => null }], s)).toEqual([]);
  });
});

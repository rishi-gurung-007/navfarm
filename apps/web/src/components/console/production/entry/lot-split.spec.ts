import { lotsToCover, planLotSplit } from './lot-split';

const lots = [
  { lot_no: 'A', remaining_quantity: 10, unit_cost: 20 },
  { lot_no: 'B', remaining_quantity: 6, unit_cost: 25 },
];

describe('planLotSplit', () => {
  it('splits 12 over lots of 10 and 6 as 10 then 2, with the cost of each', () => {
    const plan = planLotSplit(lots, ['A', 'B'], 12);
    expect(plan.parts).toEqual([
      { lot_no: 'A', quantity: 10, unit_cost: 20, cost: 200 },
      { lot_no: 'B', quantity: 2, unit_cost: 25, cost: 50 },
    ]);
    expect(plan.shortBy).toBe(0);
    expect(plan.totalCost).toBe(250);
  });

  it('uses only the ticked lots', () => {
    const plan = planLotSplit(lots, ['B'], 4);
    expect(plan.parts.map((p) => p.lot_no)).toEqual(['B']);
  });

  it('says how far short the ticked lots are', () => {
    expect(planLotSplit(lots, ['A', 'B'], 18).shortBy).toBe(2);
    expect(planLotSplit(lots, ['A'], 12).shortBy).toBe(2);
  });

  it('has no total cost when a lot has no unit cost', () => {
    expect(planLotSplit([{ lot_no: 'A', remaining_quantity: 5 }], ['A'], 3).totalCost).toBeNull();
  });
});

describe('lotsToCover', () => {
  const list = [
    { lot_no: 'NEAR', remaining_quantity: 10 },
    { lot_no: 'MID', remaining_quantity: 6 },
    { lot_no: 'FAR', remaining_quantity: 50 },
    { lot_no: 'OLD', remaining_quantity: 99, expired: true },
  ];

  it('picks only the nearest-expiry lot when it covers the quantity', () => {
    expect(lotsToCover(list, 4)).toEqual(['NEAR']);
    expect(lotsToCover(list, 10)).toEqual(['NEAR']);
  });

  it('adds the next lots, in order, until the quantity is covered', () => {
    expect(lotsToCover(list, 12)).toEqual(['NEAR', 'MID']);
    expect(lotsToCover(list, 17)).toEqual(['NEAR', 'MID', 'FAR']);
  });

  it('picks the suggested lot alone while no quantity is entered', () => {
    expect(lotsToCover(list, 0)).toEqual(['NEAR']);
  });

  it('never picks an expired lot, and takes every usable lot when they cannot cover it', () => {
    expect(lotsToCover(list, 500)).toEqual(['NEAR', 'MID', 'FAR']);
    expect(lotsToCover([{ lot_no: 'OLD', remaining_quantity: 9, expired: true }], 3)).toEqual([]);
  });
});

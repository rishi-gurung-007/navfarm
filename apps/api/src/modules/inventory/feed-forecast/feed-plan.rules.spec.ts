import {
  buildFeedPlanCode,
  buildFeedPlanRows,
  completedFeedWeeks,
  deriveTentativeFeedQuantity,
  isoProductionWeek,
  productionFeedWeek,
} from './feed-plan.rules';

it('groups by item/date and derives partial fulfilment and variance', () => {
  const [row] = buildFeedPlanRows([
    { farmId: 'f1', farmCode: 'GRA100', farmName: 'Grasmere', period: '2026-10-12', itemId: 'i1', itemCode: 'FD-01', itemName: 'Grower', tentativeKg: 6000, capacityKg: 10000 },
    { farmId: 'f1', farmCode: 'GRA100', farmName: 'Grasmere', period: '2026-10-12', itemId: 'i1', itemCode: 'FD-01', itemName: 'Grower', approvedRequisitionKg: 7200, shippedKg: 4000, receivedKg: 2500 },
  ]);
  expect(row).toMatchObject({ tentativeKg: 6000, approvedRequisitionKg: 7200, shippedKg: 4000, receivedKg: 2500, remainingKg: 4700, varianceKg: 1200, capacityKg: 10000 });
});

it('keeps missing capacity unavailable instead of inventing zero', () => {
  const [row] = buildFeedPlanRows([{ farmId: 'f1', farmCode: 'GRA100', farmName: 'Grasmere', period: '2026-10-12', itemId: 'i1', itemCode: 'FD-01', itemName: 'Grower', tentativeKg: 3000 }]);
  expect(row.capacityKg).toBeNull();
});

describe('retained weekly feed plan rules', () => {
  it('uses the ISO week containing the production date in the plan code', () => {
    expect(isoProductionWeek('2027-01-01')).toBe('202653');
    expect(buildFeedPlanCode('GRA100', '2027-01-01', 3)).toBe('PLAN-GRA100-202653-R03');
  });

  it('returns the five completed Wednesday-to-Tuesday weeks before the production cycle', () => {
    expect(completedFeedWeeks('2026-10-16')).toEqual([
      { from: '2026-09-09', to: '2026-09-15' },
      { from: '2026-09-16', to: '2026-09-22' },
      { from: '2026-09-23', to: '2026-09-29' },
      { from: '2026-09-30', to: '2026-10-06' },
      { from: '2026-10-07', to: '2026-10-13' },
    ]);
  });

  it('locates the production date inside its Wednesday-to-Tuesday planning week', () => {
    expect(productionFeedWeek('2026-10-16')).toEqual({ from: '2026-10-14', to: '2026-10-20' });
  });

  it('normalizes five-week posted consumption against lifecycle-expected consumption', () => {
    expect(deriveTentativeFeedQuantity({
      projectedTargetKg: 7_000,
      history: [
        { actualKg: 900, expectedKg: 1_000 },
        { actualKg: 1_100, expectedKg: 1_000 },
        { actualKg: 1_000, expectedKg: 1_000 },
        { actualKg: 1_200, expectedKg: 1_000 },
        { actualKg: 800, expectedKg: 1_000 },
      ],
    })).toEqual({ adjustmentFactor: 1, tentativeKg: 7_000 });
  });

  it('preserves projected lifecycle demand when no comparable historical expectation exists', () => {
    expect(deriveTentativeFeedQuantity({
      projectedTargetKg: 3_500,
      history: Array.from({ length: 5 }, () => ({ actualKg: 0, expectedKg: 0 })),
    })).toEqual({ adjustmentFactor: 1, tentativeKg: 3_500 });
  });

  it('rejects partial history so an incomplete five-week window is not presented as authoritative', () => {
    expect(() => deriveTentativeFeedQuantity({
      projectedTargetKg: 3_500,
      history: [{ actualKg: 500, expectedKg: 600 }],
    })).toThrow('Five completed feed weeks are required');
  });
});

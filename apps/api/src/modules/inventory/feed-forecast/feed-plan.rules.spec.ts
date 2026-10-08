import { buildFeedPlanRows } from './feed-plan.rules';

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

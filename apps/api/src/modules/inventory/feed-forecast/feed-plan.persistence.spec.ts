import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedPlanService } from './feed-plan.service';

function selection(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    for: async () => rows,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

describe('FeedPlanService retained versions', () => {
  const input = {
    tenantId: 'tenant-1', companyId: 'company-1', farmId: 'farm-1', farmCode: 'GRA100',
    sourceRunId: 'run-1', productionDate: '2026-10-16', planType: 'TENTATIVE' as const,
    sourceFrom: '2026-09-09', sourceTo: '2026-10-13',
    lines: [{
      itemId: 'item-1', projectedTargetKg: 7000, adjustmentFactor: 1.1, tentativeKg: 7700,
      requestedKg: null, millApprovedKg: null,
      history: [
        { from: '2026-09-09', to: '2026-09-15', actualKg: 1100, expectedKg: 1000 },
        { from: '2026-09-16', to: '2026-09-22', actualKg: 1100, expectedKg: 1000 },
        { from: '2026-09-23', to: '2026-09-29', actualKg: 1100, expectedKg: 1000 },
        { from: '2026-09-30', to: '2026-10-06', actualKg: 1100, expectedKg: 1000 },
        { from: '2026-10-07', to: '2026-10-13', actualKg: 1100, expectedKg: 1000 },
      ],
    }],
  };

  it('requires an authenticated creator and a non-empty demand document', async () => {
    const service = new FeedPlanService(transactionCls({}));
    await expect(service.createVersion(input)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.createVersion({ ...input, lines: [] }, { userId: 'user-1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('locks the farm-owned version stream and inserts a new immutable version with lines', async () => {
    const inserted: Array<{ table: unknown; values: unknown }> = [];
    const answers = [[{ id: 'farm-1' }], [{ version: 2 }]];
    const db: any = {
      select: jest.fn(() => selection(answers.shift() ?? [])),
      insert: jest.fn((table: unknown) => ({ values: async (values: unknown) => { inserted.push({ table, values }); } })),
    };
    const service = new FeedPlanService(transactionCls(db));

    await expect(service.createVersion(input, { userId: 'user-1' })).resolves.toMatchObject({
      planCode: 'PLAN-GRA100-202642-R03', planWeek: '202642', planType: 'TENTATIVE', version: 3,
    });
    expect(inserted).toHaveLength(2);
    expect(inserted[0].values).toMatchObject({ plan_code: 'PLAN-GRA100-202642-R03', version: 3, created_by: 'user-1' });
    expect(inserted[1].values).toEqual([expect.objectContaining({ item_id: 'item-1', tentative_qty_kg: '7700', history_snapshot: input.lines[0].history })]);
  });
});

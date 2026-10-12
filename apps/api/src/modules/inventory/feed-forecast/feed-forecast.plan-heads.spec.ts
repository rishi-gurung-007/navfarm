import { FeedForecastService } from './feed-forecast.service';

/** Queue-answered db: each select takes the next answer. */
function fakeDb(answers: unknown[][]) {
  return {
    select: () => {
      const rows = answers.shift() ?? [];
      const c: any = { from: () => c, innerJoin: () => c, where: () => c, limit: () => Promise.resolve(rows), then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
      return c;
    },
  } as any;
}

describe('FeedForecastService.generateFeedPlanVersion - the history uses heads net of posted Data Entry mortality', () => {
  it('expected usage is standard x reduced heads (500 less 2 and 3 posted deaths = 495)', async () => {
    const db = fakeDb([
      [{ code: 'F1' }], // farm
      [{ itemId: 'i1', demandKg: '100' }], // target week demand
      [{ entryDate: '2026-10-10', actualKg: '480', itemId: 'i1', standardQty: '1', qtyBasis: 'PER_HEAD', batchId: 'b1', openingQty: '500.0000' }],
      [], // batch_transaction MORTALITY
      [{ batchId: 'b1', date: '2026-10-01', quantity: '2' }, { batchId: 'b1', date: '2026-10-03', quantity: '3' }], // posted MORTALITY_COUNT
      [], // approved requisitions
    ]);
    const createVersion = jest.fn(async (x: any) => x);
    const service = new FeedForecastService({ get: () => db } as any, {} as any, { log: jest.fn() } as any, {} as any, {} as any, { findCurrent: jest.fn(async () => ({ run_id: 'r1' })) } as any, { createVersion } as any);
    jest.spyOn(service, 'resolveFarm').mockResolvedValue({ farmId: 'f1', companyId: 'c1' } as any);
    await service.generateFeedPlanVersion('f1', '2026-10-14', 't1');
    const line = createVersion.mock.calls[0][0].lines[0];
    const week = line.history.find((h: any) => h.from <= '2026-10-10' && h.to >= '2026-10-10');
    expect(week.actualKg).toBe(480);
    expect(week.expectedKg).toBe(495);
  });
});

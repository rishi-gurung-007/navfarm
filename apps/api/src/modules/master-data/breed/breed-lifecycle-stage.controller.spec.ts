import { BreedLifecycleStageController } from './breed-lifecycle-stage.controller';

/**
 * Same list envelope as every other master: `data` is the array, total/limit/
 * offset are siblings. The web table reads res.data as the rows, so returning
 * the {data,total} object as `data` empties the screen.
 */
describe('BreedLifecycleStageController list envelope', () => {
  it('returns the lifecycle rows as data with total alongside, not nested under it', async () => {
    const rows = [{ lifecycle_id: 'lc-1' }];
    const breedService = {
      findAllLifecycleStages: jest.fn().mockResolvedValue({ data: rows, total: 3, limit: 50, offset: 0 }),
    } as any;

    const controller = new BreedLifecycleStageController(breedService);
    const res: any = await controller.findAll({} as any, { user: { tenantId: 'tenant-1' } });

    expect(res.data).toBe(rows);
    expect(res.total).toBe(3);
    expect(res.limit).toBe(50);
    expect(res.offset).toBe(0);
  });
});

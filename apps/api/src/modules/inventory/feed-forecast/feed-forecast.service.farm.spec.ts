import { NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { farmScope } from '../../../common/farm-scope';
import { FeedForecastService } from './feed-forecast.service';

/**
 * Plan B callers (alerts, requisition auto-draft, posting hooks) reach the
 * forecast through resolveFarm + computeForFarm. These pin the two promises
 * those callers rely on: a farm-bound user cannot name another farm, and
 * every loader runs under the farm being computed, not the pinned one.
 */
describe('FeedForecastService — Plan B entry points', () => {
  const farm = { id: 'farm-b', code: 'GRS', name: 'Grasmere', companyId: 'co-1', refillBufferDays: 2, leadTimeDays: 0 };
  const emptyInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
    sheds: [], silos: [], store: null, items: {}, batches: [], feedRows: [],
  };

  it('answers NotFound when a farm-bound user names another farm (D13)', async () => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-a', restricted: true, companyId: 'co-1', lobId: null });
    const service = new FeedForecastService(cls, {} as any, {} as any);
    await expect(service.resolveFarm('farm-b', 'tenant-1', 'STANDARD_USER')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the pinned farm and its company for a farm-bound user who names none', async () => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-a', restricted: true, companyId: 'co-1', lobId: null });
    const service = new FeedForecastService(cls, {} as any, {} as any);
    await expect(service.resolveFarm(undefined, 'tenant-1', 'STANDARD_USER')).resolves.toEqual({ farmId: 'farm-a', companyId: 'co-1' });
  });

  it('runs every loader under the computed farm and returns sources and diet changes', async () => {
    const cls = transactionCls({});
    const service = new FeedForecastService(cls, {} as any, {} as any);
    const seen: Array<string | null> = [];
    jest.spyOn(service as any, 'loadFarm').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return farm; });
    jest.spyOn(service as any, 'loadInput').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return { input: emptyInput, flags: [] }; });

    const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { from: '2026-09-23', to: '2026-09-29' }));

    expect(seen).toEqual(['farm-b', 'farm-b']);
    expect(result).toMatchObject({ farm: { id: 'farm-b', code: 'GRS' }, rows: [], sources: [], dietChanges: [] });
  });
});

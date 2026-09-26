import { NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { FeedForecastService } from './feed-forecast.service';
import { todayLocal } from './feed-forecast.engine';

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
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-23', timeZone: null });
    const seen: Array<string | null> = [];
    jest.spyOn(service as any, 'loadFarm').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return farm; });
    jest.spyOn(service as any, 'loadInput').mockImplementation(async () => { seen.push(farmScope(cls).farmId); return { input: emptyInput, flags: [] }; });

    const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { from: '2026-09-23', to: '2026-09-29' }));

    expect(seen).toEqual(['farm-b', 'farm-b']);
    expect(result).toMatchObject({ farm: { id: 'farm-b', code: 'GRS' }, rows: [], sources: [], dietChanges: [] });
  });

  describe('todayInZone — D16 planning date in the farm time zone', () => {
    /** A tenantDb answering the two zone lookups farmToday makes: company_master, then timezone_master. */
    function zoneDb(companyZone: string | null, tzRows: Array<{ code: string }> = []) {
      return {
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              limit: async () => (table === schema.companyMaster ? (companyZone === null ? [] : [{ zone: companyZone }]) : tzRows),
            }),
          }),
        }),
      };
    }

    it('farmToday reads the company zone: 22:30 UTC on 25 Sep is 26 Sep in Harare (D16)', async () => {
      const service = new FeedForecastService(transactionCls(zoneDb('Africa/Harare')), {} as any, {} as any);
      await expect(service.farmToday('co-1', 'tenant-1', Date.UTC(2026, 8, 25, 22, 30))).resolves.toEqual({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    });

    it('farmToday looks a stored timezone_master id up to its IANA code', async () => {
      const service = new FeedForecastService(transactionCls(zoneDb('tz-id-1', [{ code: 'Africa/Harare' }])), {} as any, {} as any);
      await expect(service.farmToday('co-1', 'tenant-1', Date.UTC(2026, 8, 25, 22, 30))).resolves.toEqual({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    });

    it('farmToday falls back to the server day, and says so with a null zone, when the company has none', async () => {
      const service = new FeedForecastService(transactionCls(zoneDb(null)), {} as any, {} as any);
      const ms = Date.UTC(2026, 8, 25, 12, 0);
      await expect(service.farmToday('co-1', 'tenant-1', ms)).resolves.toEqual({ today: todayLocal(ms), timeZone: null });
    });

    it('computeForFarm plans from the farm day, not the server day', async () => {
      const cls = transactionCls({});
      const service = new FeedForecastService(cls, {} as any, {} as any);
      jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-26', timeZone: 'Africa/Harare' });
      jest.spyOn(service as any, 'loadFarm').mockResolvedValue(farm);
      const loadInput = jest.spyOn(service as any, 'loadInput').mockResolvedValue({ input: { ...emptyInput, planningDate: '2026-09-26' }, flags: [] });
      const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1'));
      expect(loadInput.mock.calls[0][1]).toBe('2026-09-26');
      expect(result.planningDate).toBe('2026-09-26');
    });
  });
});

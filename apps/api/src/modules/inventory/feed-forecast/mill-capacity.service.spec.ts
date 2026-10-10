import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { MillCapacityService } from './mill-capacity.service';

describe('MillCapacityService', () => {
  const mill = { millId: 'mill-1', millCode: 'MILL-001', millName: 'Mill', companyId: 'co-1', dailyKg: 30_000, hourlyKg: 1_250, bulkKg: 20_000, baggedKg: 10_000 };
  const schedule = (itemId: string, priority: number) => ({ itemId, millId: 'mill-1', feedForm: 'BULK' as const, priority, binId: `bin-${itemId}`, binCode: `BIN-${itemId}` });
  const build = () => {
    const service = new MillCapacityService(transactionCls({}));
    jest.spyOn(service, 'mills').mockResolvedValue([mill]);
    jest.spyOn(service, 'schedules').mockResolvedValue({ byDate: new Map([['2026-10-11', [schedule('d1', 1), schedule('d2', 2)]]]), diets: new Map() });
    return service;
  };

  describe('assertConsolidationWithinCapacity (Checkpoint 42)', () => {
    it('refuses a sheet whose mill-approved KG, with sheets already made for that day, exceeds a diet\'s capacity', async () => {
      const service = build();
      jest.spyOn(service, 'consolidatedDemand').mockResolvedValue([{ productionDate: '2026-10-11', itemId: 'd1', millApprovedKg: 15_000 }]);
      const attempt = service.assertConsolidationWithinCapacity('t-1', 'co-1', [
        { productionDate: '2026-10-11', itemId: 'd2', itemCode: 'FEED-R2', millApprovedKg: 6_000 },
      ]);
      await expect(attempt).rejects.toThrow(ConflictException);
      await expect(attempt).rejects.toThrow('FEED-R2 on 2026-10-11: 6,000 KG mill approved exceeds 5,000 KG Mill Capacity Available');
    });

    it('accepts a sheet within capacity and passes the sheet being finalized as excluded', async () => {
      const service = build();
      const existing = jest.spyOn(service, 'consolidatedDemand').mockResolvedValue([]);
      await expect(service.assertConsolidationWithinCapacity('t-1', 'co-1', [
        { productionDate: '2026-10-11', itemId: 'd1', itemCode: 'FEED-R1', millApprovedKg: 20_000 },
      ], 'cons-1')).resolves.toBeUndefined();
      expect(existing).toHaveBeenCalledWith('t-1', ['co-1'], ['2026-10-11'], 'cons-1');
    });

    it('does not block a diet with no BIN assignment that day; Release already requires one', async () => {
      const service = build();
      jest.spyOn(service, 'consolidatedDemand').mockResolvedValue([]);
      await expect(service.assertConsolidationWithinCapacity('t-1', 'co-1', [
        { productionDate: '2026-10-11', itemId: 'unscheduled', itemCode: 'FEED-X', millApprovedKg: 999_999 },
      ])).resolves.toBeUndefined();
    });
  });

  describe('compareReport', () => {
    it('reads the first MILL by default and the ISO week of the date when asked for a week', async () => {
      const service = build();
      const schedules = jest.spyOn(service, 'schedules');
      const demand = jest.spyOn(service, 'approvedDemand').mockResolvedValue({
        lines: [{ productionDate: '2026-10-11', farmId: 'farm-1', itemId: 'd1', requestedKg: 6_050, millApprovedKg: 6_000 }],
        diets: new Map([['d1', { itemId: 'd1', itemCode: 'FEED-R1', itemName: 'Diet 1', dietNo: 8 }]]),
      });
      const result = await service.compareReport('t-1', ['farm-1'], ['co-1'], { date: '2026-10-11', period: 'WEEK' });
      expect(schedules).toHaveBeenCalledWith('t-1', ['co-1'], ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
      expect(demand).toHaveBeenCalledWith('t-1', { farmIds: ['farm-1'], companyIds: ['co-1'] }, '2026-10-05', '2026-10-11');
      expect(result.report?.rows).toEqual([
        expect.objectContaining({ itemCode: 'FEED-R1', requestedKg: 6_050, millApprovedKg: 6_000, availableKg: 20_000, status: 'GREEN' }),
        expect.objectContaining({ itemId: 'd2', requestedKg: 0, availableKg: 13_950 }),
      ]);
      expect(result.report?.total).toEqual({ requestedKg: 6_050, millApprovedKg: 6_000, capacityKg: 210_000, status: 'GREEN' });
    });

    it('returns no report rather than zeros when the company has no MILL', async () => {
      const service = new MillCapacityService(transactionCls({}));
      jest.spyOn(service, 'mills').mockResolvedValue([]);
      await expect(service.compareReport('t-1', ['farm-1'], ['co-1'], { date: '2026-10-11' })).resolves.toEqual({ mills: [], report: null });
    });
  });
});

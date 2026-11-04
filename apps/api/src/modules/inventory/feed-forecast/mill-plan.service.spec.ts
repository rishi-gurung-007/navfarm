import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MillPlanService } from './mill-plan.service';

// Mill Planning (spec 2026-11-03): the service gathers one week of each
// farm's forecast and the mill's demand and capacity for buildMillPlan.
const farms = [
  {
    farmId: 'farm-1',
    code: 'F1',
    name: 'Farm One',
    companyId: 'co-1',
    companyName: null,
  },
  {
    farmId: 'farm-2',
    code: 'F2',
    name: 'Farm Two',
    companyId: 'co-1',
    companyName: null,
  },
  {
    farmId: 'farm-3',
    code: 'F3',
    name: 'Farm Three',
    companyId: 'co-2',
    companyName: null,
  },
];
const mills = [
  {
    millId: 'mill-1',
    millCode: 'M1',
    millName: 'Mill One',
    companyId: 'co-1',
    dailyKg: 10_000,
    hourlyKg: null,
    bulkKg: null,
    baggedKg: null,
  },
  {
    millId: 'mill-2',
    millCode: 'M2',
    millName: 'Mill Two',
    companyId: 'co-2',
    dailyKg: 5_000,
    hourlyKg: null,
    bulkKg: null,
    baggedKg: null,
  },
];
const report = (farmId: string) => ({
  farm: { id: farmId, code: farmId, name: farmId },
  daily: [],
  sourceBalances: [],
  dietChanges: [],
  rows: [],
});

function setup(getForecast?: jest.Mock) {
  const forecast = {
    listFarms: jest.fn(async () => farms),
    getForecast: getForecast ?? jest.fn(async (q: any) => report(q.farmId)),
  };
  const millCapacity = {
    mills: jest.fn(async () => mills),
    approvedDemand: jest.fn(async () => ({ lines: [], diets: new Map() })),
    allocateOnDates: jest.fn(async () => new Map()),
  };
  const feedSettings = {
    resolveForFeedPlanning: jest.fn(async () => ({ capacityWarningPct: 85 })),
  };
  const service = new MillPlanService(
    {} as any,
    forecast as any,
    millCapacity as any,
    feedSettings as any,
  );
  jest.spyOn(service as any, 'producedKg').mockResolvedValue([]);
  jest.spyOn(service as any, 'itemRows').mockResolvedValue([]);
  jest.spyOn(service as any, 'siloCapacities').mockResolvedValue(new Map());
  jest.spyOn(service as any, 'animalTypes').mockResolvedValue({});
  jest.spyOn(service as any, 'requisitionsDue').mockResolvedValue([]);
  return { service, forecast, millCapacity, feedSettings };
}

describe('MillPlanService.generate', () => {
  it('runs the forecast once per farm, in sequence, over seven days', async () => {
    const order: string[] = [];
    const getForecast = jest.fn(async (q: any) => {
      order.push(`start ${q.farmId}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end ${q.farmId}`);
      return report(q.farmId);
    });
    const { service } = setup(getForecast);
    const plan = await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
    });
    expect(getForecast).toHaveBeenCalledWith(
      {
        farmId: 'farm-1',
        view: 'CUSTOM',
        from: '2026-11-02',
        to: '2026-11-08',
      },
      'tenant-1',
      'TENANT_ADMIN',
      true,
    );
    expect(order).toEqual([
      'start farm-1',
      'end farm-1',
      'start farm-2',
      'end farm-2',
    ]);
    expect(plan.dates).toHaveLength(7);
  });

  it("keeps going when one farm's forecast throws", async () => {
    const getForecast = jest.fn(async (q: any) => {
      if (q.farmId === 'farm-2') throw new Error('No lifecycle');
      return report(q.farmId);
    });
    const { service } = setup(getForecast);
    const plan = await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
    });
    expect(plan.failedFarms).toEqual([
      { farmId: 'farm-2', code: 'F2', name: 'Farm Two', error: 'No lifecycle' },
    ]);
    expect(plan.farms.map((f) => f.farmId)).toEqual(['farm-1']);
  });

  it("refuses a farm outside the caller's scope", async () => {
    const { service } = setup();
    await expect(
      service.generate('tenant-1', 'TENANT_ADMIN', {
        weekOf: '2026-11-02',
        farmIds: 'farm-1,farm-x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a rolled-over date', async () => {
    const { service } = setup();
    await expect(
      service.generate('tenant-1', 'TENANT_ADMIN', { weekOf: '2026-02-31' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("limits farms to the chosen mill's company", async () => {
    const { service, forecast, feedSettings } = setup();
    const plan = await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
      millId: 'mill-2',
    });
    expect(forecast.getForecast).toHaveBeenCalledTimes(1);
    expect(forecast.getForecast.mock.calls[0][0].farmId).toBe('farm-3');
    expect(plan.mill?.millId).toBe('mill-2');
    expect(plan.mills.map((m) => m.millId)).toEqual(['mill-1', 'mill-2']);
    expect(feedSettings.resolveForFeedPlanning).toHaveBeenCalledWith(
      'co-2',
      'farm-3',
    );
  });

  it("takes a feed's form from the item master, not from whichever farm's silo was read last", async () => {
    const getForecast = jest.fn(async (q: any) => ({
      ...report(q.farmId),
      sourceBalances: [
        {
          date: '2026-11-02',
          sourceCode: `SL-${q.farmId}`,
          itemId: 'item-1',
          itemNo: 'FD1',
          itemName: 'Feed 1',
          feedType: 'BAGGED',
          recommendedQtyKg: 0,
          deliveryDate: null,
          openingSystemBalanceKg: 0,
          projectedClosingBalanceKg: 100,
        },
      ],
    }));
    const { service, millCapacity } = setup(getForecast);
    millCapacity.approvedDemand.mockResolvedValue({
      lines: [
        {
          productionDate: '2026-11-02',
          farmId: 'farm-1',
          itemId: 'item-1',
          requestedKg: 1000,
          millApprovedKg: null,
        },
      ],
      diets: new Map(),
    } as any);
    jest
      .spyOn(service as any, 'itemRows')
      .mockResolvedValue([
        {
          item_id: 'item-1',
          item_code: 'FD1',
          item_name: 'Feed 1',
          item_type: 'FEED',
          feed_form: 'BULK',
        },
      ]);
    const plan = await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
    });
    expect(plan.production[0]).toMatchObject({
      itemId: 'item-1',
      itemCode: 'FD1',
      feedForm: 'BULK',
    });
  });

  it("refuses farms that are not the chosen mill's company, instead of dropping them", async () => {
    const { service } = setup();
    await expect(
      service.generate('tenant-1', 'TENANT_ADMIN', {
        weekOf: '2026-11-02',
        millId: 'mill-1',
        farmIds: 'farm-1,farm-3',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads approved demand for the whole mill company and output of the chosen mill only', async () => {
    const { service, millCapacity } = setup();
    const produced = jest.spyOn(service as any, 'producedKg');
    await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
      farmIds: 'farm-1',
    });
    expect(millCapacity.approvedDemand).toHaveBeenCalledWith(
      'tenant-1',
      { companyIds: ['co-1'] },
      '2026-11-02',
      '2026-11-08',
    );
    expect(produced).toHaveBeenCalledWith(
      'tenant-1',
      'co-1',
      'mill-1',
      '2026-11-02',
      '2026-11-08',
    );
  });

  it("reads each silo's capacity from the location master, by the silo ids the forecast used", async () => {
    const getForecast = jest.fn(async (q: any) => ({
      ...report(q.farmId),
      sourceBalances: [
        {
          date: '2026-11-02',
          sourceType: 'SILO',
          sourceCode: 'SL-1',
          locationId: `loc-${q.farmId}`,
          itemId: 'item-1',
          itemNo: 'FD1',
          itemName: 'Feed 1',
          feedType: 'BULK',
          recommendedQtyKg: 0,
          deliveryDate: null,
          openingSystemBalanceKg: 2500,
          projectedClosingBalanceKg: 2400,
        },
      ],
    }));
    const { service } = setup(getForecast);
    const capacities = jest
      .spyOn(service as any, 'siloCapacities')
      .mockResolvedValue(new Map([['loc-farm-1', 5000]]));
    const plan = await service.generate('tenant-1', 'TENANT_ADMIN', {
      weekOf: '2026-11-02',
      farmIds: 'farm-1',
    });
    expect(capacities).toHaveBeenCalledWith('tenant-1', ['loc-farm-1']);
    expect(plan.siloCards[0]).toMatchObject({
      stockKg: 2500,
      capacityKg: 5000,
      fillPct: 50,
    });
  });
});

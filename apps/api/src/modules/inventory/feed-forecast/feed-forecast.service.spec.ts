import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FeedForecastService, projectSegments, siloInput } from './feed-forecast.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

// The engine has its own spec (feed-forecast.engine.spec.ts) against the
// workbook's worked example; here it is a spy, so these tests pin only what the
// service owns — farm resolution under scope, the date window, and handing the
// loaded snapshot to the engine unchanged.
jest.mock('./feed-forecast.engine', () => ({
  buildFeedForecast: jest.fn(() => ({ rows: [], flags: [] })),
}));

const FARM = { id: 'farm-A', code: 'VIL100', name: 'Village 100', companyId: 'comp-1', refillBufferDays: 2, leadTimeDays: 0 };

describe('FeedForecastService', () => {
  let service: FeedForecastService;
  let cls: ClsService;
  let loadFarm: jest.SpyInstance;
  let loadInput: jest.SpyInstance;

  beforeEach(async () => {
    (buildFeedForecast as jest.Mock).mockClear();
    cls = transactionCls({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedForecastService,
        { provide: ClsService, useValue: cls },
        { provide: InventoryLedgerService, useValue: { getStockBalance: jest.fn() } },
        { provide: SiloFeedService, useValue: { currentItems: jest.fn() } },
      ],
    }).compile();
    service = module.get(FeedForecastService);
    loadFarm = jest.spyOn(service as any, 'loadFarm').mockResolvedValue(FARM);
    loadInput = jest.spyOn(service as any, 'loadInput').mockImplementation(async (...args: any[]) => ({
      planningDate: args[1],
      from: args[2],
      to: args[3],
    }));
  });

  afterEach(() => jest.useRealTimers());

  it('a restricted user asking for another farm gets NotFound, before anything is loaded', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    await expect(service.getForecast({ farmId: 'farm-B' }, 'tenant-1')).rejects.toThrow(new NotFoundException('Farm not found.'));
    expect(loadFarm).not.toHaveBeenCalled();
    expect(buildFeedForecast).not.toHaveBeenCalled();
  });

  it('a restricted user with no farmId gets their own farm', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    await service.getForecast({}, 'tenant-1');
    expect(loadFarm).toHaveBeenCalledWith('farm-A', 'tenant-1');
  });

  it('an unrestricted caller must name a farm', async () => {
    await expect(service.getForecast({}, 'tenant-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects `to` before `from`', async () => {
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-09-24' }, 'tenant-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(loadFarm).not.toHaveBeenCalled();
  });

  it('rejects a span over 45 days (workbook checkpoint 15) and accepts exactly 45', async () => {
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-11-10' }, 'tenant-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-11-09' }, 'tenant-1')).resolves.toBeDefined();
  });

  it('happy path: planningDate is today, from/to default to today..today+7, and the loaded input goes to the engine as-is', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 25, 10, 30));
    const input = { planningDate: '2026-09-25', marker: 'loaded' } as unknown as ForecastInput;
    loadInput.mockResolvedValueOnce(input);
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({ rows: [{ batchNo: 'B1' }], flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }] });

    const result = await service.getForecast({ farmId: 'farm-A' }, 'tenant-1');

    expect(loadInput).toHaveBeenCalledWith(FARM, '2026-09-25', '2026-09-25', '2026-10-02', 'tenant-1');
    expect(buildFeedForecast).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      planningDate: '2026-09-25',
      from: '2026-09-25',
      to: '2026-10-02',
      farm: { id: 'farm-A', code: 'VIL100', name: 'Village 100' },
      rows: [{ batchNo: 'B1' }],
      flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }],
    });
  });
});

describe('projectSegments', () => {
  const stages = new Map([
    ['S1', { stageId: 'S1', stageCode: 'WEANER', durationDays: 10, nextStageId: 'S2' }],
    ['S2', { stageId: 'S2', stageCode: 'GROWER', durationDays: 5, nextStageId: 'S3' }],
    ['S3', { stageId: 'S3', stageCode: 'FINISHER', durationDays: null, nextStageId: null }],
  ]);

  it('projects the next stages while each segment ends before `to`', () => {
    expect(projectSegments('S1', '2026-09-20', '2026-10-15', stages)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-20', end: '2026-09-29', projected: false },
      { stageId: 'S2', stageCode: 'GROWER', start: '2026-09-30', end: '2026-10-04', projected: true },
      { stageId: 'S3', stageCode: 'FINISHER', start: '2026-10-05', end: null, projected: true },
    ]);
  });

  it('leaves the current segment open when it outlasts the range', () => {
    expect(projectSegments('S1', '2026-09-20', '2026-09-29', stages)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-20', end: null, projected: false },
    ]);
  });

  it('stops on a stage with no duration or no next stage, and on a cycle', () => {
    const cyclic = new Map([
      ['A', { stageId: 'A', stageCode: 'A', durationDays: 1, nextStageId: 'B' }],
      ['B', { stageId: 'B', stageCode: 'B', durationDays: 1, nextStageId: 'A' }],
    ]);
    const segments = projectSegments('A', '2026-01-01', '2026-12-31', cyclic);
    expect(segments.length).toBeLessThanOrEqual(60);
    expect(segments[segments.length - 1].end).toBeNull();
  });
});

describe('siloInput', () => {
  it('an empty silo is passed with no item and zero balance', () => {
    expect(siloInput({ siloId: 'S', siloCode: 'SILO-1' }, null)).toEqual({ siloId: 'S', siloCode: 'SILO-1', itemId: null, balanceKg: 0 });
  });

  it('a KG balance is passed through', () => {
    expect(siloInput({ siloId: 'S', siloCode: 'SILO-1' }, { item_id: 'I', on_hand_qty: 525, uom: 'KG' })).toEqual({
      siloId: 'S',
      siloCode: 'SILO-1',
      itemId: 'I',
      balanceKg: 525,
    });
  });

  it('a balance held in any other unit is refused, naming the silo and the unit', () => {
    expect(() => siloInput({ siloId: 'S', siloCode: 'SILO-1' }, { item_id: 'I', on_hand_qty: 10, uom: 'BAG' })).toThrow(
      new ConflictException("Silo 'SILO-1' holds its feed in BAG, not KG — the forecast cannot add bags to kilograms."),
    );
  });
});

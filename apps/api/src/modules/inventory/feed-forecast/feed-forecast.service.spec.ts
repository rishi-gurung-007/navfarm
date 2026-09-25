import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { buildInputBatches, FeedForecastService, projectSegments, resolveShed, siloInput, StageInfo } from './feed-forecast.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { activeFarmOfCompany } from '../../../common/farm-scope';

// The engine has its own spec (feed-forecast.engine.spec.ts) against the
// workbook's worked example; here it is a spy, so these tests pin only what the
// service owns — farm resolution under scope, the date window, and handing the
// loaded snapshot to the engine unchanged.
jest.mock('./feed-forecast.engine', () => ({
  buildFeedForecast: jest.fn(() => ({ rows: [], flags: [] })),
}));

// activeFarmOfCompany runs a real query against location_master; feed-forecast's
// own spec doubles it out (farm-scope.spec.ts already proves that query works)
// so these tests can pin only the service's own routing of the query farmId vs.
// the header-pinned scope.farmId (fix round 1).
jest.mock('../../../common/farm-scope', () => ({
  ...jest.requireActual('../../../common/farm-scope'),
  activeFarmOfCompany: jest.fn(),
}));

/** A tenantDb stub answering only the lob_id lookup the OPERATIONAL_ADMIN branch makes. */
function dbWithFarmLob(lobId: string | null): object {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (lobId === null ? [] : [{ lob_id: lobId }]),
        }),
      }),
    }),
  };
}

const FARM = { id: 'farm-A', code: 'VIL100', name: 'Village 100', companyId: 'comp-1', refillBufferDays: 2, leadTimeDays: 0 };

describe('FeedForecastService', () => {
  let service: FeedForecastService;
  let cls: ClsService;
  let loadFarm: jest.SpyInstance;
  let loadInput: jest.SpyInstance;

  beforeEach(async () => {
    (buildFeedForecast as jest.Mock).mockClear();
    (activeFarmOfCompany as jest.Mock).mockReset().mockResolvedValue(true);
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
      input: { planningDate: args[1], from: args[2], to: args[3] },
      flags: [],
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

  it('rejects an impossible calendar day', async () => {
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-02-27', to: '2026-02-31' }, 'tenant-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(loadFarm).not.toHaveBeenCalled();
  });

  it('happy path: planningDate is today, from/to default to today..today+7, the loaded input goes to the engine as-is, loader flags are appended', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 25, 10, 30));
    const input = { planningDate: '2026-09-25', marker: 'loaded' } as unknown as ForecastInput;
    loadInput.mockResolvedValueOnce({ input, flags: [{ kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }] });
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({ rows: [{ batchNo: 'B1' }], flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }] });

    const result = await service.getForecast({ farmId: 'farm-A' }, 'tenant-1');

    expect(loadInput).toHaveBeenCalledWith(
      FARM,
      '2026-09-25',
      '2026-09-25',
      '2026-10-02',
      'tenant-1',
      { farmId: 'farm-A', restricted: false, companyId: null, lobId: null },
    );
    expect(buildFeedForecast).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      planningDate: '2026-09-25',
      from: '2026-09-25',
      to: '2026-10-02',
      farm: { id: 'farm-A', code: 'VIL100', name: 'Village 100' },
      rows: [{ batchNo: 'B1' }],
      // The engine's flags, then the loader's own (a batch placed on no known shed).
      flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }],
    });
  });

  // Fix round 1: only STANDARD_USER is farm-bound on this endpoint. Every
  // other user type's query farmId must win over whatever the workspace
  // switcher pinned in x-active-farm-id, and every loader must then see that
  // chosen farm, not the pinned one.
  describe('non-STANDARD_USER farm switching', () => {
    it('an admin pinned to farm A (header) asking for farm B of the same company loads farm B, validated against the company, and every loader sees an effective scope with farmId B', async () => {
      useFarmScope(cls, { farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: null });

      await service.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'TENANT_ADMIN');

      expect(activeFarmOfCompany).toHaveBeenCalledWith(expect.anything(), 'farm-B', 'comp-1', 'tenant-1');
      expect(loadFarm).toHaveBeenCalledWith('farm-B', 'tenant-1');
      expect(loadInput).toHaveBeenCalledWith(
        FARM,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'tenant-1',
        { farmId: 'farm-B', restricted: false, companyId: 'comp-1', lobId: null },
      );
    });

    it('an OPERATIONAL_ADMIN asking for a farm of another LOB gets NotFound, before anything is loaded', async () => {
      const lobCls = transactionCls(dbWithFarmLob('lob-2'));
      useFarmScope(lobCls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FeedForecastService,
          { provide: ClsService, useValue: lobCls },
          { provide: InventoryLedgerService, useValue: { getStockBalance: jest.fn() } },
          { provide: SiloFeedService, useValue: { currentItems: jest.fn() } },
        ],
      }).compile();
      const lobService = module.get(FeedForecastService);
      const lobLoadFarm = jest.spyOn(lobService as any, 'loadFarm').mockResolvedValue(FARM);

      await expect(lobService.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'OPERATIONAL_ADMIN')).rejects.toThrow(
        new NotFoundException('Farm not found.'),
      );
      expect(lobLoadFarm).not.toHaveBeenCalled();
    });

    it('a STANDARD_USER asking for another farm still gets NotFound, before anything is loaded', async () => {
      useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });

      await expect(service.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
        new NotFoundException('Farm not found.'),
      );
      expect(loadFarm).not.toHaveBeenCalled();
      expect(activeFarmOfCompany).not.toHaveBeenCalled();
    });

    it('an admin asking for a farm of another company gets NotFound, before anything is loaded', async () => {
      useFarmScope(cls, { farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: null });
      (activeFarmOfCompany as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.getForecast({ farmId: 'farm-C' }, 'tenant-1', 'TENANT_ADMIN')).rejects.toThrow(
        new NotFoundException('Farm not found.'),
      );
      expect(loadFarm).not.toHaveBeenCalled();
    });
  });
});

describe('projectSegments', () => {
  const stage = (stageId: string, stageCode: string, durationDays: number | null, nextStageId: string | null, isActive = true): StageInfo => ({
    stageId, stageCode, durationDays, nextStageId, isActive,
  });
  const stages = new Map([
    ['S1', stage('S1', 'WEANER', 10, 'S2')],
    ['S2', stage('S2', 'GROWER', 5, 'S3')],
    ['S3', stage('S3', 'FINISHER', null, null)],
  ]);

  it('projects the next stages while each segment ends before `to`', () => {
    expect(projectSegments('S1', '2026-09-20', '2026-09-20', '2026-10-15', stages)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-20', end: '2026-09-29', projected: false },
      { stageId: 'S2', stageCode: 'GROWER', start: '2026-09-30', end: '2026-10-04', projected: true },
      { stageId: 'S3', stageCode: 'FINISHER', start: '2026-10-05', end: null, projected: true },
    ]);
  });

  it('leaves the current segment open when it outlasts the range', () => {
    expect(projectSegments('S1', '2026-09-20', '2026-09-20', '2026-09-29', stages)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-20', end: null, projected: false },
    ]);
  });

  it('a batch past its typical stage length keeps its current stage (ruling: an unposted transition is not known, D11)', () => {
    // WEANER from 1 Sep for 10 days would end 10 Sep, before the 25 Sep planning date.
    expect(projectSegments('S1', '2026-09-01', '2026-09-25', '2026-10-02', stages)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-01', end: null, projected: false },
    ]);
  });

  it('stops before an inactive next stage', () => {
    const withRetired = new Map([
      ['S1', stage('S1', 'WEANER', 10, 'S2')],
      ['S2', stage('S2', 'GROWER', 5, null, false)],
    ]);
    expect(projectSegments('S1', '2026-09-20', '2026-09-20', '2026-10-15', withRetired)).toEqual([
      { stageId: 'S1', stageCode: 'WEANER', start: '2026-09-20', end: null, projected: false },
    ]);
  });

  it('terminates on a cyclic chain', () => {
    const cyclic = new Map([
      ['A', stage('A', 'A', 1, 'B')],
      ['B', stage('B', 'B', 1, 'A')],
    ]);
    const segments = projectSegments('A', '2026-01-01', '2026-01-01', '2026-12-31', cyclic);
    expect(segments.length).toBeLessThanOrEqual(60);
    expect(segments[segments.length - 1].end).toBeNull();
  });
});

describe('resolveShed', () => {
  const locations = new Map([
    ['shed-1', { location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm' }],
    ['pen-1', { location_id: 'pen-1', location_type: 'PEN', parent_location_id: 'shed-1' }],
    ['crate-1', { location_id: 'crate-1', location_type: 'CRATE', parent_location_id: 'pen-1' }],
    ['store-1', { location_id: 'store-1', location_type: 'STORE', parent_location_id: 'farm' }],
    ['farm', { location_id: 'farm', location_type: 'FARM', parent_location_id: null }],
  ]);

  it('a SHED is its own shed', () => expect(resolveShed('shed-1', locations)).toBe('shed-1'));
  it('PEN -> SHED', () => expect(resolveShed('pen-1', locations)).toBe('shed-1'));
  it('CRATE -> PEN -> SHED', () => expect(resolveShed('crate-1', locations)).toBe('shed-1'));
  it('a location with no SHED above it resolves to nothing', () => {
    expect(resolveShed('store-1', locations)).toBeNull();
    expect(resolveShed('unknown', locations)).toBeNull();
    expect(resolveShed(null, locations)).toBeNull();
  });
});

describe('buildInputBatches', () => {
  const locationById = new Map([
    ['shed-1', { location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm' }],
    ['shed-2', { location_id: 'shed-2', location_type: 'SHED', parent_location_id: 'farm' }],
    ['shed-old', { location_id: 'shed-old', location_type: 'SHED', parent_location_id: 'farm' }],
    ['pen-2', { location_id: 'pen-2', location_type: 'PEN', parent_location_id: 'shed-2' }],
    ['store-1', { location_id: 'store-1', location_type: 'STORE', parent_location_id: 'farm' }],
  ]);
  const stages = new Map<string, StageInfo>([
    ['GIL', { stageId: 'GIL', stageCode: 'GILT', durationDays: null, nextStageId: null, isActive: true }],
    ['GES', { stageId: 'GES', stageCode: 'GESTATION', durationDays: null, nextStageId: null, isActive: true }],
  ]);
  const base = {
    animalGroups: new Map<string, { stageId: string; heads: number }[]>(),
    headers: [] as { batch_id: string; stage_id: string; effective_from: string; location_id: string | null }[],
    stages,
    locationById,
    activeShedIds: new Set(['shed-1', 'shed-2']),
    planningDate: '2026-09-25',
    to: '2026-10-02',
  };
  const batchWise = {
    batch_id: 'b1', batch_no: 'BATCH-1', breed_id: 'br', stage_id: 'GIL', shed_id: 'shed-1',
    tracking_mode: 'BATCH_WISE', start_date: '2026-09-01', opening_quantity: '50', closing_quantity: '48',
  };

  it('a batch-wise batch: heads = closing ?? opening, start from batch when no header', () => {
    const { batches, flags } = buildInputBatches({ ...base, batchRows: [batchWise] });
    expect(batches).toEqual([
      expect.objectContaining({ batchId: 'b1', batchNo: 'BATCH-1', breedId: 'br', shedId: 'shed-1', heads: 48,
        segments: [{ stageId: 'GIL', stageCode: 'GILT', start: '2026-09-01', end: null, projected: false }] }),
    ]);
    expect(flags).toEqual([]);
  });

  it("the scheduler header's location (a PEN, walked up to its SHED) wins over batch.shed_id, and its date sets the start", () => {
    const { batches } = buildInputBatches({
      ...base,
      batchRows: [batchWise],
      headers: [{ batch_id: 'b1', stage_id: 'GIL', effective_from: '2026-09-10', location_id: 'pen-2' }],
    });
    expect(batches[0]).toEqual(expect.objectContaining({ shedId: 'shed-2', segments: [expect.objectContaining({ start: '2026-09-10' })] }));
  });

  it('of duplicate headers for (batch, stage), the latest not after the planning date wins', () => {
    const { batches } = buildInputBatches({
      ...base,
      batchRows: [batchWise],
      headers: [
        { batch_id: 'b1', stage_id: 'GIL', effective_from: '2026-09-30', location_id: 'shed-1' },
        { batch_id: 'b1', stage_id: 'GIL', effective_from: '2026-09-05', location_id: 'shed-1' },
        { batch_id: 'b1', stage_id: 'GIL', effective_from: '2026-09-12', location_id: 'pen-2' },
      ],
    });
    expect(batches[0]).toEqual(expect.objectContaining({ shedId: 'shed-2', segments: [expect.objectContaining({ start: '2026-09-12' })] }));
  });

  it('two animal stage groups become two input batches, each with its own heads and a distinguishable batchNo', () => {
    const { batches } = buildInputBatches({
      ...base,
      batchRows: [{ ...batchWise, tracking_mode: 'ANIMAL_WISE', stage_id: null }],
      animalGroups: new Map([['b1', [{ stageId: 'GIL', heads: 12 }, { stageId: 'GES', heads: 30 }]]]),
    });
    expect(batches.map((b) => [b.batchId, b.batchNo, b.heads, b.segments[0].stageId])).toEqual([
      ['b1:GIL', 'BATCH-1 · GILT', 12, 'GIL'],
      ['b1:GES', 'BATCH-1 · GESTATION', 30, 'GES'],
    ]);
  });

  it('an animal-wise batch with no live animals yields no input batch', () => {
    const { batches, flags } = buildInputBatches({ ...base, batchRows: [{ ...batchWise, tracking_mode: 'ANIMAL_WISE' }] });
    expect(batches).toEqual([]);
    expect(flags).toEqual([]);
  });

  it('a batch whose location does not resolve to an active shed draws on the STORE and is flagged BATCH_SHED_UNKNOWN', () => {
    const { batches, flags } = buildInputBatches({
      ...base,
      batchRows: [
        { ...batchWise, batch_id: 'b1', batch_no: 'NO-LOC', shed_id: null },
        { ...batchWise, batch_id: 'b2', batch_no: 'ON-STORE', shed_id: 'store-1' },
        { ...batchWise, batch_id: 'b3', batch_no: 'RETIRED-SHED', shed_id: 'shed-old' },
      ],
    });
    expect(batches.map((b) => b.shedId)).toEqual(['', '', '']);
    expect(flags).toEqual([
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'NO-LOC' },
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'ON-STORE' },
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'RETIRED-SHED' },
    ]);
  });
});

describe('siloInput', () => {
  it('an empty silo is passed with no item and zero balance', () => {
    expect(siloInput({ siloId: 'S', siloCode: 'SILO-1' }, null)).toEqual({ siloId: 'S', siloCode: 'SILO-1', itemId: null, balanceKg: 0 });
  });

  it('a KG balance is passed through', () => {
    expect(siloInput({ siloId: 'S', siloCode: 'SILO-1' }, { item_id: 'I', on_hand_qty: 525, uoms: ['KG'] })).toEqual({
      siloId: 'S',
      siloCode: 'SILO-1',
      itemId: 'I',
      balanceKg: 525,
    });
  });

  it('a balance held in any other unit is refused, naming the silo and the unit', () => {
    expect(() => siloInput({ siloId: 'S', siloCode: 'SILO-1' }, { item_id: 'I', on_hand_qty: 10, uoms: ['KG', 'BAG'] })).toThrow(
      new ConflictException("Silo 'SILO-1' holds its feed in BAG, not KG — the forecast cannot add bags to kilograms."),
    );
  });
});

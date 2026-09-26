import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { buildInputBatches, FeedForecastService, locationLobConditions, projectSegments, resolveShed, siloInput, StageInfo } from './feed-forecast.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { buildFeedForecast, ForecastInput, todayLocal } from './feed-forecast.engine';
import { activeFarmOfCompany, FARM_SCOPE_KEY, farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { MySqlDialect } from 'drizzle-orm/mysql-core';

// The engine has its own spec (feed-forecast.engine.spec.ts) against the
// workbook's worked example; here it is a spy, so these tests pin only what the
// service owns — farm resolution under scope, the date window, and handing the
// loaded snapshot to the engine unchanged.
jest.mock('./feed-forecast.engine', () => ({
  ...jest.requireActual('./feed-forecast.engine'), // the real calendar helpers (todayLocal lives there)
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
    jest.spyOn(service, 'farmToday').mockImplementation(async () => ({ today: todayLocal(), timeZone: null }));
  });

  afterEach(() => jest.useRealTimers());

  it('a restricted user asking for another farm gets NotFound, before anything is loaded', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    await expect(service.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(new NotFoundException('Farm not found.'));
    expect(loadFarm).not.toHaveBeenCalled();
    expect(buildFeedForecast).not.toHaveBeenCalled();
  });

  it('a restricted user with no farmId gets their own farm', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    await service.getForecast({}, 'tenant-1', 'STANDARD_USER');
    expect(loadFarm).toHaveBeenCalledWith('farm-A', 'tenant-1');
  });

  it('an unrestricted caller must name a farm', async () => {
    await expect(service.getForecast({}, 'tenant-1', 'TENANT_ADMIN')).rejects.toThrow(BadRequestException);
  });

  it('rejects `to` before `from`', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-09-24' }, 'tenant-1', 'TENANT_ADMIN')).rejects.toThrow(
      BadRequestException,
    );
    expect(loadFarm).not.toHaveBeenCalled();
  });

  it('rejects a span over 45 days (workbook checkpoint 15) and accepts exactly 45', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-11-10' }, 'tenant-1', 'TENANT_ADMIN')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-09-25', to: '2026-11-09' }, 'tenant-1', 'TENANT_ADMIN')).resolves.toBeDefined();
  });

  it('rejects an impossible calendar day', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
    await expect(service.getForecast({ farmId: 'farm-A', from: '2026-02-27', to: '2026-02-31' }, 'tenant-1', 'TENANT_ADMIN')).rejects.toThrow(
      BadRequestException,
    );
    expect(loadFarm).not.toHaveBeenCalled();
  });

  it('happy path: planningDate is today, from/to default to today..today+7, the loaded input goes to the engine as-is, loader flags are appended', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 25, 10, 30));
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    const input = { planningDate: '2026-09-25', marker: 'loaded' } as unknown as ForecastInput;
    loadInput.mockResolvedValueOnce({ input, flags: [{ kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }] });
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({ rows: [{ batchNo: 'B1' }], flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }] });

    const result = await service.getForecast({ farmId: 'farm-A' }, 'tenant-1', 'STANDARD_USER');

    expect(loadInput).toHaveBeenCalledWith(FARM, '2026-09-25', '2026-09-25', '2026-10-02', 'tenant-1');
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
    it('an admin pinned to farm A (header) asking for farm B of the same company loads farm B, validated against the company', async () => {
      useFarmScope(cls, { farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: null });

      await service.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'TENANT_ADMIN');

      expect(activeFarmOfCompany).toHaveBeenCalledWith(expect.anything(), 'farm-B', 'comp-1', 'tenant-1');
      expect(loadFarm).toHaveBeenCalledWith('farm-B', 'tenant-1');
      expect(loadInput).toHaveBeenCalledWith(FARM, expect.any(String), expect.any(String), expect.any(String), 'tenant-1');
      // useFarmScope stubs cls.get('farmScope') to a fixed object, so it can't
      // observe the CLS mutation itself — the dedicated 'CLS scope reaches
      // every downstream loader' spec below proves that with a real cls.
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

  // Fix round 2, finding 2: TENANT_ADMIN/SYSTEM_ADMIN in tenant-wide scope
  // (no company header) send scope.companyId === null; activeFarmOfCompany
  // always answers false for a null company, so every farm 404'd. The farm
  // itself now resolves and supplies its own company to the effective scope.
  describe('TENANT_ADMIN/SYSTEM_ADMIN with no company pinned', () => {
    /** A tenantDb stub answering only the activeFarmOfTenant lookup. */
    function dbWithTenantFarm(companyId: string | null): object {
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (companyId === null ? [] : [{ company_id: companyId }]),
            }),
          }),
        }),
      };
    }

    it('a farm that is an active top-level FARM of the tenant resolves, and the effective scope takes the farm\'s company', async () => {
      // Seeded with a real cls.set (not useFarmScope, which would stub
      // farmScope(cls) to a fixed value and hide the mutation this test
      // checks), nested inside cls.run() so `.set` has an active context to
      // write into — same reasoning as runWithEffectiveScope below.
      const tenantCls = transactionCls(dbWithTenantFarm('comp-B'));
      await tenantCls.run(async () => {
        tenantCls.set(FARM_SCOPE_KEY, { farmId: null, restricted: false, companyId: null, lobId: null });
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            FeedForecastService,
            { provide: ClsService, useValue: tenantCls },
            { provide: InventoryLedgerService, useValue: { getStockBalance: jest.fn() } },
            { provide: SiloFeedService, useValue: { currentItems: jest.fn() } },
          ],
        }).compile();
        const tenantService = module.get(FeedForecastService);
        const tenantLoadFarm = jest.spyOn(tenantService as any, 'loadFarm').mockResolvedValue(FARM);
        // getForecast's own cls.run() nests a shallow-copied store (nestjs-cls
        // default `ifNested: 'inherit'`), so a check from out here after it
        // returns would still see the outer, unmutated store — capture the
        // scope from inside loadInput's own call, in the same nested context
        // the mutation actually happened in (same pattern as the
        // 'every downstream loader' spec below).
        let capturedScope: unknown;
        jest.spyOn(tenantService as any, 'loadInput').mockImplementation(async () => {
          capturedScope = farmScope(tenantCls);
          return { input: {}, flags: [] };
        });

        await tenantService.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'TENANT_ADMIN');

        expect(tenantLoadFarm).toHaveBeenCalledWith('farm-B', 'tenant-1');
        expect(capturedScope).toEqual({ farmId: 'farm-B', restricted: false, companyId: 'comp-B', lobId: null });
      });
    });

    it('a farm that is not an active top-level FARM of the tenant (deleted/inactive/child) gets NotFound', async () => {
      const tenantCls = transactionCls(dbWithTenantFarm(null));
      useFarmScope(tenantCls, { farmId: null, restricted: false, companyId: null, lobId: null });
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FeedForecastService,
          { provide: ClsService, useValue: tenantCls },
          { provide: InventoryLedgerService, useValue: { getStockBalance: jest.fn() } },
          { provide: SiloFeedService, useValue: { currentItems: jest.fn() } },
        ],
      }).compile();
      const tenantService = module.get(FeedForecastService);
      const tenantLoadFarm = jest.spyOn(tenantService as any, 'loadFarm').mockResolvedValue(FARM);

      await expect(tenantService.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'SYSTEM_ADMIN')).rejects.toThrow(
        new NotFoundException('Farm not found.'),
      );
      expect(tenantLoadFarm).not.toHaveBeenCalled();
    });

    it('a COMPANY_ADMIN with no company pinned (not tenant-wide) still gets NotFound rather than silently widening access', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });

      await expect(service.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'COMPANY_ADMIN')).rejects.toThrow(
        new NotFoundException('Farm not found.'),
      );
      expect(loadFarm).not.toHaveBeenCalled();
    });
  });

  // Fix round 1 (security): resolveFarm must fail closed. None of these stub
  // activeFarmOfTenant — a fail-closed path must reach its NotFound without
  // ever needing that (or any other) lookup to succeed.
  describe('resolveFarm — fails closed', () => {
    it('an unset userType with no company pinned gets NotFound (no STANDARD_USER fallback)', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
      await expect(service.resolveFarm('farm-B', 'tenant-1', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an unknown user type is bound to its scoped company: a farm outside it is NotFound', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
      (activeFarmOfCompany as jest.Mock).mockResolvedValueOnce(false);
      await expect(service.resolveFarm('farm-C', 'tenant-1', 'STAFF')).rejects.toBeInstanceOf(NotFoundException);
      expect(activeFarmOfCompany).toHaveBeenCalledWith(expect.anything(), 'farm-C', 'comp-1', 'tenant-1');
    });

    it('an OPERATIONAL_ADMIN naming a farm of another LOB gets NotFound', async () => {
      const lobCls = transactionCls(dbWithFarmLob('lob-2'));
      useFarmScope(lobCls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      const lobService = new FeedForecastService(lobCls, {} as any, {} as any);
      await expect(lobService.resolveFarm('farm-B', 'tenant-1', 'OPERATIONAL_ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a TENANT_ADMIN with no company pinned takes the company from the farm itself (the one lookup this path may make)', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
      jest.spyOn(service as any, 'activeFarmOfTenant').mockResolvedValue('comp-X');
      await expect(service.resolveFarm('farm-B', 'tenant-1', 'TENANT_ADMIN')).resolves.toEqual({ farmId: 'farm-B', companyId: 'comp-X' });
    });

    it('a COMPANY_ADMIN with no company pinned gets NotFound rather than a tenant-wide lookup', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
      await expect(service.resolveFarm('farm-B', 'tenant-1', 'COMPANY_ADMIN')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a STANDARD_USER with no farm pinned (malformed session) gets NotFound rather than the query farm', async () => {
      useFarmScope(cls, { farmId: null, restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      await expect(service.resolveFarm('farm-B', 'tenant-1', 'STANDARD_USER')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // Fix round 2, finding 1 (critical): the silo and store balance reads used
  // to run under whatever farm was pinned in the header, because
  // InventoryLedgerService/SiloFeedService read farmScope(cls) independently,
  // several calls below getForecast's own farm resolution — an admin pinned
  // to farm A asking for farm B got a 200 with every source silently empty.
  // This spec does NOT stub loadInput, so the real loaders run and reach the
  // (mocked) InventoryLedgerService exactly as production code would.
  describe('the effective farm scope reaches every downstream loader (no loadInput stub)', () => {
    const storeRow = { location_id: 'store-1', location_code: 'STORE-01', location_type: 'STORE', parent_location_id: null, is_active: true };

    /** Answers only the one query loadInput needs beyond an empty result: the
     * farm's locations, returning a single active STORE so the store-balance
     * read (the one finding 1 is about) actually runs. */
    function dbForLoadInput(): object {
      function thenable(rows: unknown[]): any {
        const node: any = {
          where: () => thenable(rows),
          limit: () => thenable(rows),
          orderBy: () => thenable(rows),
          then: (resolve: any) => resolve(rows),
        };
        return node;
      }
      return {
        select: () => ({
          from: (table: unknown) => thenable(table === schema.locationMaster ? [storeRow] : []),
        }),
      };
    }

    /**
     * `cls.set` needs an active CLS context (ClsService#set throws without
     * one — see the production `cls.run()` comment above), and the seeded
     * scope must still be there when getForecast makes its own *first*
     * farmScope(cls) read, before it does its own `cls.run()`. So the seed,
     * the module compile, the getForecast call and the downstream reads all
     * have to run nested inside one `cls.run()` — mirroring how a real
     * request already has RolesGuard's context active by the time this
     * service's own `cls.run()` nests inside it.
     */
    async function runWithEffectiveScope(
      initialScope: { farmId: string | null; restricted: boolean; companyId: string | null; lobId: string | null },
      work: (service: FeedForecastService) => Promise<unknown>,
    ): Promise<{ getCapturedFarmId: () => string | null | undefined }> {
      const localCls = transactionCls(dbForLoadInput());
      let capturedFarmId: string | null | undefined;
      await localCls.run(async () => {
        localCls.set(FARM_SCOPE_KEY, initialScope);
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            FeedForecastService,
            { provide: ClsService, useValue: localCls },
            {
              provide: InventoryLedgerService,
              useValue: {
                getStockBalance: jest.fn(async () => {
                  capturedFarmId = farmScope(localCls).farmId;
                  return [];
                }),
              },
            },
            { provide: SiloFeedService, useValue: { currentItems: jest.fn() } },
          ],
        }).compile();
        const localService = module.get(FeedForecastService);
        jest.spyOn(localService as any, 'loadFarm').mockResolvedValue(FARM);
        await work(localService);
      });
      return { getCapturedFarmId: () => capturedFarmId };
    }

    it('an admin pinned to farm A asking for farm B: the store balance read sees farmId B, not the pinned A', async () => {
      (activeFarmOfCompany as jest.Mock).mockResolvedValue(true);

      const { getCapturedFarmId } = await runWithEffectiveScope(
        { farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: null },
        (localService) => localService.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'TENANT_ADMIN'),
      );

      expect(getCapturedFarmId()).toBe('farm-B');
    });

    it('a STANDARD_USER is unaffected: the store balance read still sees their own (only) farm', async () => {
      const { getCapturedFarmId } = await runWithEffectiveScope(
        { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' },
        (localService) => localService.getForecast({}, 'tenant-1', 'STANDARD_USER'),
      );

      expect(getCapturedFarmId()).toBe('farm-A');
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
    animalGroups: new Map<string, { stageId: string | null; heads: number }[]>(),
    headers: [] as { batch_id: string; stage_id: string; effective_from: string; location_id: string | null }[],
    stages,
    locationById,
    activeShedIds: new Set(['shed-1', 'shed-2']),
    planningDate: '2026-09-25',
    to: '2026-10-02',
  };
  const batchWise = {
    batch_id: 'b1', batch_no: 'BATCH-1', breed_id: 'br', stage_id: 'GIL', shed_id: 'shed-1',
    tracking_mode: 'BATCH_WISE', animal_tracking: 'COUNT_ONLY' as string | null, start_date: '2026-09-01', opening_quantity: '50', closing_quantity: '48',
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

  // Ruling (final review, I2 + follow-up): a BATCH_WISE batch whose animals
  // are registered one by one moves them into their own stages (the demo's
  // breeding stock walks FLUSH -> ... -> LACTATION), so it is split by stage.
  // Staged animals are counted per stage; the batch's own stage gets only the
  // batch's heads not accounted for by a staged animal. Stage-less animal
  // rows are never counted one by one — on the demo they are BIO_ASSET
  // placeholders duplicating the registered herd.
  it('a REGISTERED batch is split by animal stage, each group on its own header, and its own stage gets the remainder', () => {
    const { batches } = buildInputBatches({
      ...base,
      batchRows: [{ ...batchWise, animal_tracking: 'REGISTERED' }], // 48 heads (closing)
      animalGroups: new Map([['b1', [{ stageId: 'GES', heads: 30 }]]]),
      headers: [{ batch_id: 'b1', stage_id: 'GES', effective_from: '2026-09-20', location_id: 'pen-2' }],
    });
    expect(batches.map((b) => [b.batchId, b.batchNo, b.heads, b.shedId, b.segments[0].stageId, b.segments[0].start])).toEqual([
      ['b1:GES', 'BATCH-1 · GESTATION', 30, 'shed-2', 'GES', '2026-09-20'],
      ['b1:GIL', 'BATCH-1 · GILT', 18, 'shed-1', 'GIL', '2026-09-01'],
    ]);
  });

  it('VIL100-like: 58 heads, 58 staged across 5 stages, 58 stage-less placeholders -> 5 groups summing to 58, no own-stage group', () => {
    const stages5 = new Map<string, StageInfo>([
      ...stages,
      ...['FLU', 'INS', 'GST', 'FAR', 'LAC'].map((id): [string, StageInfo] => [id, { stageId: id, stageCode: id, durationDays: null, nextStageId: null, isActive: true }]),
    ]);
    const { batches } = buildInputBatches({
      ...base,
      stages: stages5,
      batchRows: [{ ...batchWise, animal_tracking: 'REGISTERED', opening_quantity: '58', closing_quantity: null }],
      animalGroups: new Map([['b1', [
        { stageId: null, heads: 58 },
        { stageId: 'FLU', heads: 13 }, { stageId: 'INS', heads: 12 }, { stageId: 'GST', heads: 12 },
        { stageId: 'FAR', heads: 11 }, { stageId: 'LAC', heads: 10 },
      ]]]),
    });
    expect(batches.map((b) => b.segments[0].stageId)).toEqual(['FLU', 'INS', 'GST', 'FAR', 'LAC']);
    expect(batches.reduce((n, b) => n + b.heads, 0)).toBe(58);
  });

  it('a REGISTERED batch of 100 heads with 40 staged gets an own-stage group of 60', () => {
    const { batches } = buildInputBatches({
      ...base,
      batchRows: [{ ...batchWise, animal_tracking: 'REGISTERED', opening_quantity: '100', closing_quantity: null }],
      animalGroups: new Map([['b1', [{ stageId: null, heads: 100 }, { stageId: 'GES', heads: 40 }]]]),
    });
    expect(batches.map((b) => [b.batchNo, b.heads])).toEqual([
      ['BATCH-1 · GESTATION', 40],
      ['BATCH-1 · GILT', 60],
    ]);
  });

  it('a REGISTERED batch with no live animals feeds its whole head count at its own stage', () => {
    const { batches } = buildInputBatches({ ...base, batchRows: [{ ...batchWise, animal_tracking: 'REGISTERED' }] });
    expect(batches.map((b) => [b.batchNo, b.heads])).toEqual([['BATCH-1 · GILT', 48]]);
  });

  it('ANIMAL_WISE is unchanged: stage-less animals are not counted (they would double a BIO_ASSET placeholder herd)', () => {
    const withStage = buildInputBatches({
      ...base,
      batchRows: [{ ...batchWise, tracking_mode: 'ANIMAL_WISE' }],
      animalGroups: new Map([['b1', [{ stageId: null, heads: 7 }, { stageId: 'GIL', heads: 5 }, { stageId: 'GES', heads: 30 }]]]),
    });
    expect(withStage.batches.map((b) => [b.batchNo, b.heads])).toEqual([['BATCH-1 · GILT', 5], ['BATCH-1 · GESTATION', 30]]);
    const noStage = buildInputBatches({
      ...base,
      batchRows: [{ ...batchWise, tracking_mode: 'ANIMAL_WISE', stage_id: null }],
      animalGroups: new Map([['b1', [{ stageId: null, heads: 7 }, { stageId: 'GES', heads: 30 }]]]),
    });
    expect(noStage.batches.map((b) => [b.batchNo, b.heads])).toEqual([['BATCH-1 · GESTATION', 30]]);
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

describe('locationLobConditions', () => {
  const render = (conds: ReturnType<typeof locationLobConditions>) => {
    const dialect = new MySqlDialect();
    return conds.map((c) => dialect.sqlToQuery(c));
  };

  it('keeps a restricted caller on its LOB but also admits LOB-less locations (a farm STORE may carry none)', () => {
    const [q] = render(locationLobConditions({ farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' }));
    expect(q.sql).toMatch(/`lob_id` = \?/);
    expect(q.sql).toMatch(/`lob_id` is null/);
    expect(q.sql.toLowerCase()).toContain(' or ');
    expect(q.params).toEqual(['lob-1']);
  });

  it('adds nothing for an unrestricted caller or one with no LOB', () => {
    expect(locationLobConditions({ farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: 'lob-1' })).toEqual([]);
    expect(locationLobConditions({ farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: null })).toEqual([]);
  });
});

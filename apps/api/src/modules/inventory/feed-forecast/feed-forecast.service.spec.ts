import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { buildInputBatches, FeedForecastService, locationLobConditions, projectSegments, resolveShed, stageBlocksFor, StageInfo } from './feed-forecast.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { buildFeedForecast, ForecastInput, todayLocal } from './feed-forecast.engine';
import { activeFarmOfCompany, FARM_SCOPE_KEY, farmScope, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { MySqlDialect } from 'drizzle-orm/mysql-core';

// A minimal real stub for the direct-construct call sites below that
// never reach computeForFarm's real body (resolveFarm throws first, or the
// private method under test bypasses it); FeedForecastService.feedSettings
// is a required constructor parameter now (Important 3, fix round 2).
const FEED_SETTINGS_STUB = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } as any;

// The engine has its own spec (feed-forecast.engine.spec.ts) against the
// workbook's worked example; here it is a spy, so these tests pin only what the
// service owns — farm resolution under scope, the date window, and handing the
// loaded snapshot to the engine unchanged.
jest.mock('./feed-forecast.engine', () => ({
  ...jest.requireActual('./feed-forecast.engine'), // the real calendar helpers (todayLocal lives there)
  buildFeedForecast: jest.fn(() => ({ rows: [], flags: [], sources: [], dietChanges: [], daily: [] })),
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

const FARM = { id: 'farm-A', code: 'VIL100', name: 'Village 100', companyId: 'comp-1' };

describe('FeedForecastService', () => {
  let service: FeedForecastService;
  let cls: ClsService;
  let loadFarm: jest.SpyInstance;
  let loadInput: jest.SpyInstance;
  let feedSettings: { resolveForFeedPlanning: jest.Mock };

  beforeEach(async () => {
    (buildFeedForecast as jest.Mock).mockClear();
    (activeFarmOfCompany as jest.Mock).mockReset().mockResolvedValue(true);
    cls = transactionCls({});
    // Task 4: safety stock, bulk multiple and bag size come from
    // FeedSettingsService (Task 2) now; this default stub matches the
    // documented defaults (safety stock 0, bulk multiple 3000 KG, bag size
    // 50 KG) unless a test overrides it.
    feedSettings = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedForecastService,
        { provide: ClsService, useValue: cls },
        { provide: InventoryLedgerService, useValue: { getFeedStockAsOf: jest.fn() } },
        // D32's farm-settings write is the only caller; the report never logs.
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        // D41: the silos on Feed Planning; the report never asks it anything.
        { provide: SiloFeedService, useValue: { currentItems: jest.fn(async () => new Map()) } },
        { provide: FeedSettingsService, useValue: feedSettings },
      ],
    }).compile();
    service = module.get(FeedForecastService);
    loadFarm = jest.spyOn(service as any, 'loadFarm').mockResolvedValue(FARM);
    loadInput = jest.spyOn(service as any, 'loadInput').mockImplementation(async (...args: any[]) => ({
      input: { planningDate: args[1], from: args[2], to: args[3] },
      flags: [],
      stageBlocks: [],
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

  it('report rows and sources carry the silo / store NAME beside the code (Engine r70, rows 8-9; Rishi 4 Oct)', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    loadInput.mockResolvedValueOnce({ input: {}, flags: [], stageBlocks: [], sourceNames: { 'GRA100/SILO-001': 'Weaner silo', 'GRA100/STORE-01': 'Main store' } });
    const day = (sourceType: 'SILO' | 'STORE' | 'NONE', sourceCode: string | null, itemId: string) => ({
      batchId: 'b1', batchNo: 'B1', shedCode: 'S1', stageCode: 'WEANER', itemId, itemNo: itemId, itemName: itemId, sourceType, sourceCode,
      date: todayLocal(), currentInventoryKg: 100, heads: 10, perDayIntakeKg: 5, daysOfStock: 20, sharedBatchCount: 1, indicative: false, runDownDate: null,
    });
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({
      rows: [], flags: [], dietChanges: [],
      daily: [day('SILO', 'GRA100/SILO-001', 'i1'), day('STORE', 'GRA100/STORE-01', 'i2'), day('NONE', null, 'i3')],
      sources: [{ sourceType: 'SILO', sourceCode: 'GRA100/SILO-001', locationId: 's1', itemId: 'i1' }],
    });
    const report = await service.getForecast({ view: 'DAILY' }, 'tenant-1', 'STANDARD_USER');
    expect(report.rows.map((r) => [r.sourceCode, r.sourceName])).toEqual([
      ['GRA100/SILO-001', 'Weaner silo'], ['GRA100/STORE-01', 'Main store'], [null, null],
    ]);
    expect(report.sources[0]).toMatchObject({ sourceCode: 'GRA100/SILO-001', sourceName: 'Weaner silo' });
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

  it('happy path: planning date is the farm day, from/to default to it..+6 (7 days inclusive), stock is read as of it, the loaded input goes to the engine as-is plus configured safety stock, loader flags are appended', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 25, 10, 30));
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    // Task 4 Step 1: the settings stub answers a configured safety stock; it
    // must reach the engine, and the farm's old leadTimeDays key must not.
    feedSettings.resolveForFeedPlanning.mockResolvedValueOnce({ safetyStockKg: 500, bulkMultipleKg: 3000, bagSizeKg: 50 });
    const input = { planningDate: '2026-09-25', marker: 'loaded' } as unknown as ForecastInput;
    loadInput.mockResolvedValueOnce({ input, flags: [{ kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }], stageBlocks: [] });
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({
      rows: [{ batchNo: 'B1' }], flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }], sources: [], dietChanges: [], daily: [],
    });

    const result = await service.computeForFarm('farm-A', 'comp-1', 'tenant-1');

    expect(loadInput).toHaveBeenCalledWith(FARM, '2026-09-25', '2026-09-25', '2026-10-01', 'tenant-1', {
      stockDate: '2026-09-25', horizonTo: '2026-10-01', headerCutoff: '2026-09-25',
    });
    expect(feedSettings.resolveForFeedPlanning).toHaveBeenCalledWith('comp-1', 'farm-A');
    expect(buildFeedForecast).toHaveBeenCalledWith(expect.objectContaining({ planningDate: '2026-09-25', marker: 'loaded', safetyStockKg: 500 }));
    expect((buildFeedForecast as jest.Mock).mock.calls[0][0]).not.toHaveProperty('leadTimeDays');
    expect(result).toEqual({
      planningDate: '2026-09-25', today: '2026-09-25', timeZone: null, from: '2026-09-25', to: '2026-10-01', horizonTo: '2026-10-01',
      farm: { id: 'farm-A', code: 'VIL100', name: 'Village 100' },
      settings: { safetyStockKg: 500, bulkMultipleKg: 3000, bagSizeKg: 50 },
      rows: [{ batchNo: 'B1' }], daily: [],
      // The engine's flags, then the loader's own (a batch placed on no known shed).
      flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }],
      sources: [], dietChanges: [],
      sourceNames: {},
      stages: [],
      sourceSnapshot: expect.objectContaining({
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        values: { engineInput: { planningDate: '2026-09-25', marker: 'loaded', safetyStockKg: 500 } },
      }),
    });
    expect(result).not.toHaveProperty('leadTimeDays');
  });

  it('with no `to`, the planning window is 7 days inclusive: 23 to 29 Sep (Worked Example; Engine §5 row 67)', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    loadInput.mockResolvedValueOnce({ input: {}, flags: [], stageBlocks: [] });
    const result = await service.computeForFarm('farm-A', 'comp-1', 'tenant-1', { planningDate: '2026-09-23' }, { today: '2026-09-23', timeZone: null } as any);
    expect([result.from, result.to]).toEqual(['2026-09-23', '2026-09-29']);
  });

  it('the stage blocks loadInput built reach the computed result unchanged', async () => {
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    const block = { batchId: 'b1', batchNo: 'B1', shedCode: 'VIL100/SHED-004', currentStageCode: 'WEANER', currentFrom: '2026-09-22' };
    loadInput.mockResolvedValueOnce({ input: {}, flags: [], stageBlocks: [block] });
    const result = await service.computeForFarm('farm-A', 'comp-1', 'tenant-1');
    expect(result.stages).toEqual([block]);
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
      expect(loadInput).toHaveBeenCalledWith(FARM, expect.any(String), expect.any(String), expect.any(String), 'tenant-1', expect.any(Object));
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
          { provide: InventoryLedgerService, useValue: { getFeedStockAsOf: jest.fn() } },
          { provide: AuditLogService, useValue: { log: jest.fn() } },
        // D41: the silos on Feed Planning; the report never asks it anything.
        { provide: SiloFeedService, useValue: { currentItems: jest.fn(async () => new Map()) } },
        { provide: FeedSettingsService, useValue: { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } },
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
            { provide: InventoryLedgerService, useValue: { getFeedStockAsOf: jest.fn() } },
            { provide: AuditLogService, useValue: { log: jest.fn() } },
        // D41: the silos on Feed Planning; the report never asks it anything.
        { provide: SiloFeedService, useValue: { currentItems: jest.fn(async () => new Map()) } },
        { provide: FeedSettingsService, useValue: { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } },
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
          return { input: {}, flags: [], stageBlocks: [] };
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
          { provide: InventoryLedgerService, useValue: { getFeedStockAsOf: jest.fn() } },
          { provide: AuditLogService, useValue: { log: jest.fn() } },
        // D41: the silos on Feed Planning; the report never asks it anything.
        { provide: SiloFeedService, useValue: { currentItems: jest.fn(async () => new Map()) } },
        { provide: FeedSettingsService, useValue: { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } },
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
      const lobService = new FeedForecastService(lobCls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB);
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
          innerJoin: () => thenable(rows),
          groupBy: () => thenable(rows),
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
                getFeedStockAsOf: jest.fn(async () => {
                  capturedFarmId = farmScope(localCls).farmId;
                  return { opening: [], movements: [] };
                }),
              },
            },
            { provide: AuditLogService, useValue: { log: jest.fn() } },
        // D41: the silos on Feed Planning; the report never asks it anything.
        { provide: SiloFeedService, useValue: { currentItems: jest.fn(async () => new Map()) } },
        { provide: FeedSettingsService, useValue: { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } },
          ],
        }).compile();
        const localService = module.get(FeedForecastService);
        jest.spyOn(localService as any, 'loadFarm').mockResolvedValue(FARM);
        await work(localService);
      });
      return { getCapturedFarmId: () => capturedFarmId };
    }

    it('an admin pinned to farm A asking for farm B: the stock read sees farmId B, not the pinned A', async () => {
      (activeFarmOfCompany as jest.Mock).mockResolvedValue(true);

      const { getCapturedFarmId } = await runWithEffectiveScope(
        { farmId: 'farm-A', restricted: false, companyId: 'comp-1', lobId: null },
        (localService) => localService.getForecast({ farmId: 'farm-B' }, 'tenant-1', 'TENANT_ADMIN'),
      );

      expect(getCapturedFarmId()).toBe('farm-B');
    });

    it('a STANDARD_USER is unaffected: the stock read still sees their own (only) farm', async () => {
      const { getCapturedFarmId } = await runWithEffectiveScope(
        { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' },
        (localService) => localService.getForecast({}, 'tenant-1', 'STANDARD_USER'),
      );

      expect(getCapturedFarmId()).toBe('farm-A');
    });
  });
});

/**
 * Task 4 fix round 2, Important 4 (Rishi's ruling): feed settings are
 * company/farm-level configuration, not LOB-scoped data, so
 * computeForFarm reads (via resolveForFeedPlanning) them outside the restricted
 * LOB assertion FeedSettingsService.resolve() otherwise applies. Unlike
 * every other spec touching this path, this one uses the REAL
 * FeedSettingsService (not a mock) over a real, non-stubbed ClsService
 * (transactionCls + cls.run/.set — useFarmScope would hide the mutation
 * resolveForFeedPlanning makes, the same reasoning as the 'effective farm
 * scope' spec above) so the actual assertLobInScope rule is exercised, not
 * assumed. The DB check behind this ruling: nf_devco.location_master has
 * SILO rows with lob_id NULL today and the column is nullable — one
 * data-entry away for a FARM row too.
 */
describe('FeedSettingsService.resolveForFeedPlanning — feed settings are read outside the restricted LOB assertion (Important 4)', () => {
  function databaseAnswering(...answers: unknown[][]) {
    const queue = [...answers];
    const select = jest.fn(() => {
      const rows = queue.shift() ?? [];
      const chain: any = {
        from: () => chain, leftJoin: () => chain, where: () => chain, orderBy: () => chain,
        limit: async () => rows,
        then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    });
    return { select };
  }

  // FeedSettingsService.resolve reads, in order: company_master (for the
  // timezone), feed_planning_setting (none configured here), then the farm
  // row itself — for the LOB assertion only — with lob_id: null.
  const dbAnswers = () => databaseAnswering(
    [{ company_id: 'co-1', default_timezone_id: 'UTC' }],
    [],
    [{ location_id: 'farm-null-lob', company_id: 'co-1', lob_id: null }],
  );
  const RESTRICTED_SCOPE: FarmScope = { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-1' };

  it('confirms the upstream bug is real: FeedSettingsService.resolve itself 403s a restricted caller on a NULL-lob_id farm', async () => {
    const cls = transactionCls(dbAnswers());
    await cls.run(async () => {
      cls.set(FARM_SCOPE_KEY, RESTRICTED_SCOPE);
      await expect(new FeedSettingsService(cls).resolve('co-1', 'farm-null-lob')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('resolveForFeedPlanning reads the same farm\'s settings without the 403, and restores the caller\'s own scope afterward', async () => {
    const cls = transactionCls(dbAnswers());
    await cls.run(async () => {
      cls.set(FARM_SCOPE_KEY, RESTRICTED_SCOPE);
      const feedSettings = new FeedSettingsService(cls);
      const service = new FeedForecastService(
        cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, feedSettings,
      );

      const result = await feedSettings.resolveForFeedPlanning('co-1', 'farm-null-lob');

      expect(result).toEqual(expect.objectContaining({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 }));
      // The neutralized scope used for the nested read must not leak back out to the caller.
      expect(farmScope(cls)).toEqual(RESTRICTED_SCOPE);
    });
  });
});

describe('projectSegments', () => {
  const stage = (stageId: string, stageCode: string, durationDays: number | null, nextStageId: string | null, isActive = true, minDays: number | null = null): StageInfo => ({
    stageId, stageCode, durationDays, nextStageId, isActive, minDays,
  });
  const stages = new Map([
    ['S1', stage('S1', 'WEANER', 10, 'S2')],
    ['S2', stage('S2', 'GROWER', 5, 'S3')],
    ['S3', stage('S3', 'FINISHER', null, null)],
    ['FLU', stage('FLU', 'FLUSH', 5, 'INS', true, 3)],
    ['INS', stage('INS', 'INSEMINATION', 2, null)],
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

  it('carries the change window on the current segment of an event-based stage (D36)', () => {
    // FLUSH entered 1 Sep, min 3, typical 5: earliest change 4 Sep, planned (latest) 6 Sep.
    // INSEMINATION's segment stays open-ended: it has no successor to date an end from.
    expect(projectSegments('FLU', '2026-09-01', '2026-09-01', '2026-09-20', stages)).toEqual([
      { stageId: 'FLU', stageCode: 'FLUSH', start: '2026-09-01', end: '2026-09-05', projected: false, changeWindowStart: '2026-09-04' },
      { stageId: 'INS', stageCode: 'INSEMINATION', start: '2026-09-06', end: null, projected: true },
    ]);
  });

  it('no window when there is no minimum, or the minimum is 0, or it is not before the latest day (D36)', () => {
    const noWindow = new Map([
      ['A', stage('A', 'A', 5, 'B')], // no min
      ['B', stage('B', 'B', 5, 'C', true, 0)], // min 0
      ['C', stage('C', 'C', 4, 'D', true, 4)], // min == typical
      ['D', stage('D', 'D', 4, 'E', true, 6)], // min past typical — nonsense, but no window either
      ['E', stage('E', 'E', null, null)],
    ]);
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(projectSegments(id, '2026-09-01', '2026-09-01', '2026-09-20', noWindow)[0].changeWindowStart).toBeUndefined();
    }
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

  // Ruling I1: a back-dated planning date (Q8) still reads today's scheduler register — the header cutoff is
  // max(planningDate, today), so a stage entered after the planning date keeps its own start and shed.
  it('a header dated after a back-dated planning date but not after the header cutoff (today) is still used', () => {
    const header = { batch_id: 'b1', stage_id: 'GIL', effective_from: '2026-09-22', location_id: 'pen-2' };
    const pastPlan = { ...base, planningDate: '2026-09-19', batchRows: [batchWise], headers: [header] };
    expect(buildInputBatches({ ...pastPlan, headerCutoff: '2026-09-26' }).batches[0]).toEqual(
      expect.objectContaining({ shedId: 'shed-2', segments: [expect.objectContaining({ start: '2026-09-22' })] }),
    );
    // Without the cutoff the planning date bounds it, and the batch falls back to its own start and shed.
    expect(buildInputBatches(pastPlan).batches[0]).toEqual(
      expect.objectContaining({ shedId: 'shed-1', segments: [expect.objectContaining({ start: '2026-09-01' })] }),
    );
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
    // D1 (3 Oct, Task 9b): `batchId` is the 73-char-capable composite this engine keys its own
    // rows by (never a batch_header PK); `realBatchId` must always be the genuine PK ('b1'), the
    // same for every stage group of this physical batch — this is what every writer must persist.
    expect(batches.every((b) => b.realBatchId === 'b1')).toBe(true);
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

describe('loadDraftTransfers — D19 booked transfers (Q2, Ruling M2; Part E Task 4b)', () => {
  /** Answers the selects in call order: into, out, then shipped and received per line. */
  function draftDb(into: unknown[], out: unknown[], shipped: unknown[] = [], received: unknown[] = []) {
    const wheres: unknown[] = [];
    const results = [into, out, shipped, received];
    const chain = () => {
      const rows = results.shift() ?? [];
      const self: any = {
        from: () => self,
        innerJoin: () => self,
        where: (w: unknown) => { wheres.push(w); return self; },
        groupBy: () => self,
        then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
      };
      return self;
    };
    return { db: { select: () => chain() }, wheres };
  }
  const render = (w: unknown) => new MySqlDialect().sqlToQuery(w as any);
  const load = async (db: unknown, ids: string[], lobId: string | null = null, restricted = false) => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-A', restricted, companyId: 'comp-1', lobId });
    return (new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB) as any)
      .loadDraftTransfers(ids, 'comp-1', 'tenant-1', '2026-09-26', '2026-10-10');
  };
  const R1 = { item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-28' };

  it('reads open transfers up to the horizon, into (+) and out of (−) the farm\'s locations — no lower bound on posting_date (fix round 1, Important 2)', async () => {
    const { db, wheres } = draftDb(
      [{ line_id: 'L1', warehouse_id: 's1', ...R1, qty: '6000.0000' }],
      [{ line_id: 'L1', warehouse_id: 'st', ...R1, qty: '6000.0000' }],
    );
    const out = await load(db, ['s1', 'st']);
    // Nothing shipped yet: the whole line is pending at both ends.
    expect(out).toEqual([
      { warehouse_id: 's1', ...R1, qty: 6000 },
      { warehouse_id: 'st', ...R1, qty: -6000 },
    ]);
    const [into, from] = wheres.map(render);
    for (const q of [into, from]) {
      // An open transfer dated before the stock date must not be dropped by
      // a lower bound — see the test below. Only the upper bound (horizon) remains.
      expect(q.sql).not.toMatch(/`posting_date` >= \?/);
      expect(q.sql).toMatch(/`posting_date` <= \?/);
      expect(q.sql).toMatch(/`status` in \(\?, \?, \?\)/);
      expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'comp-1', 'DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', '2026-10-10']));
      expect(q.params).not.toContain('POSTED');
      expect(q.sql).not.toMatch(/`lob_id`/);
    }
    expect(into.sql).toMatch(/`to_warehouse_id` in/);
    expect(from.sql).toMatch(/`from_warehouse_id` in/);
  });

  // Fix round 1, Important 2: a transfer dated before the stock date, shipped
  // but unreceived, used to vanish — loadDraftTransfers filtered it out with
  // gte(posting_date, stockDate), and even if it had not, the engine's walk
  // only visits dates from stockDate on (feed-forecast.engine.ts: walkDates =
  // dateRange(stockDate, horizonTo)), so a row dated before stockDate would
  // never match any walk date either. The fix drops the lower bound on the
  // query AND dates the outstanding quantity at max(posting_date, stockDate),
  // so it lands on the stock date instead of being silently unreachable.
  it('an open transfer dated before the stock date is dated AT the stock date, not dropped (ordered 10, shipped 6, unreceived)', async () => {
    const early = { ...R1, posting_date: '2026-09-20' }; // before stockDate 2026-09-26
    const { db, wheres } = draftDb(
      [{ line_id: 'L1', warehouse_id: 's1', ...early, qty: '10' }], // destination (into)
      [{ line_id: 'L1', warehouse_id: 'st', ...early, qty: '10' }], // source (out)
      [{ line_id: 'L1', qty: '6' }], // shipped
      [], // nothing received
    );
    const out = await load(db, ['s1', 'st']);
    const clamped = { ...early, posting_date: '2026-09-26' };
    expect(out).toEqual([
      { warehouse_id: 's1', ...clamped, qty: 10 }, // pendingIn = ordered − received = 10
      { warehouse_id: 'st', ...clamped, qty: -4 },  // pendingOut = ordered − shipped = 4
    ]);
    const [into, from] = wheres.map(render);
    for (const q of [into, from]) {
      expect(q.sql).not.toMatch(/`posting_date` >= \?/);
    }
  });

  it('counts only what is outstanding: ordered 10, shipped 6, received 4 → source −4, destination +6', async () => {
    // The shipment already took 6 out of the source in the ledger and the
    // receipt already put 4 into the destination; counting the line in full
    // as well was the double count at both ends.
    const { db, wheres } = draftDb(
      [{ line_id: 'L1', warehouse_id: 's1', ...R1, qty: '10.0000' }],
      [{ line_id: 'L1', warehouse_id: 'st', ...R1, qty: '10.0000' }],
      [{ line_id: 'L1', qty: '6.0000' }],
      [{ line_id: 'L1', qty: '4.0000' }],
    );
    const out = await load(db, ['s1', 'st']);
    expect(out).toEqual([
      { warehouse_id: 's1', ...R1, qty: 6 },   // 2 in transit + 4 not yet shipped
      { warehouse_id: 'st', ...R1, qty: -4 },  // 4 not yet shipped
    ]);
    // The event sums are read for exactly the lines found, cancelled/deleted events excluded.
    const [, , shipped, received] = wheres.map(render);
    for (const q of [shipped, received]) {
      expect(q.params).toEqual(expect.arrayContaining(['L1', 'tenant-1']));
      expect(q.sql).toMatch(/`deleted_at` is null/);
    }
  });

  it('a line fully shipped and received contributes nothing; lines on one key are summed', async () => {
    const { db } = draftDb(
      [
        { line_id: 'L1', warehouse_id: 's1', ...R1, qty: '10' },
        { line_id: 'L2', warehouse_id: 's1', ...R1, qty: '5' },
        { line_id: 'L3', warehouse_id: 's1', ...R1, qty: '3' },
      ],
      [],
      [{ line_id: 'L1', qty: '10' }, { line_id: 'L2', qty: '2' }],
      [{ line_id: 'L1', qty: '10' }],
    );
    const out = await load(db, ['s1']);
    // L1 done (0), L2 5 − 0 received = 5, L3 untouched 3.
    expect(out).toEqual([{ warehouse_id: 's1', ...R1, qty: 8 }]);
  });

  it('no open line means no event reads', async () => {
    const { db, wheres } = draftDb([], []);
    expect(await load(db, ['s1'])).toEqual([]);
    expect(wheres).toHaveLength(2);
  });

  it('a restricted caller only sees drafts of its own LOB\'s items, as the ledger read does', async () => {
    const { db, wheres } = draftDb([], []);
    await load(db, ['s1'], 'lob-1', true);
    for (const q of wheres.map(render)) {
      expect(q.sql).toMatch(/`item_master`\.`lob_id` = \?/);
      expect(q.params).toContain('lob-1');
    }
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

describe('FeedForecastService.getForecast — views, periods and the report (Plan R)', () => {
  let service: FeedForecastService;
  let compute: jest.SpyInstance;
  const daily = (over: Record<string, unknown> = {}) => ({
    date: '2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
    itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', lifecycleId: 'row-r1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
    currentInventoryKg: 1500, heads: 1000, feedRateKg: 2, perDayIntakeKg: 2000,
    daysOfStock: 0, sharedBatchCount: 1, indicative: true,
    runDownDate: '2026-09-23', ...over,
  });
  const computed = {
    planningDate: '2026-09-23', today: '2026-09-23', timeZone: 'Africa/Harare', from: '2026-09-23', to: '2026-09-29', horizonTo: '2026-11-07',
    farm: { id: 'farm-A', code: 'GRS', name: 'Grasmere' },
    settings: { safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 }, rows: [],
    daily: [daily(), daily({ date: '2026-09-24', currentInventoryKg: 0 }), daily({ date: '2026-09-25', currentInventoryKg: 0 })],
    flags: [], sources: [], dietChanges: [], stages: [], sourceNames: { 'GRS/SILO-001': 'Weaner silo' },
  };
  const september = { periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' };

  beforeEach(() => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: null });
    service = new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB);
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-23', timeZone: 'Africa/Harare' });
    compute = jest.spyOn(service, 'computeForFarm').mockResolvedValue(computed as any);
  });

  it('WEEKLY: 7 days from the week start, one row per batch and item with the week\'s totals, run-down looked for 45 days ahead', async () => {
    const report = await service.getForecast({ view: 'WEEKLY' }, 'tenant-1', 'STANDARD_USER');
    expect(compute).toHaveBeenCalledWith(
      'farm-A', 'comp-1', 'tenant-1',
      // Worked Example / Engine §5 row 67: the computed range is the 7-day window; only horizonTo reaches 45 days.
      { from: '2026-09-23', to: '2026-09-29', planningDate: '2026-09-23', horizonTo: '2026-11-07' },
      { today: '2026-09-23', timeZone: 'Africa/Harare' },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ date: '2026-09-23', dateTo: '2026-09-25', days: 3, intakeKg: 6000, currentInventoryKg: 1500, itemNo: 'FEED-R1' });
    expect(report).toMatchObject({
      view: 'WEEKLY', forecastFrom: '2026-09-23', forecastNote: null, period: null, timeZone: 'Africa/Harare',
      settings: { safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 },
    });
  });

  it('first load (no `to`): CUSTOM and WEEKLY compute and return the 7-day window, 23 Sep to 29 Sep, not the 45-day reach (Worked Example; Engine §5 row 67)', async () => {
    for (const view of ['CUSTOM', 'WEEKLY'] as const) {
      compute.mockClear();
      const report = await service.getForecast({ view }, 'tenant-1', 'STANDARD_USER');
      expect(compute.mock.calls[0][3]).toEqual({ from: '2026-09-23', to: '2026-09-29', planningDate: '2026-09-23', horizonTo: '2026-11-07' });
      expect(report).toMatchObject({ from: '2026-09-23', to: '2026-09-29', horizonTo: '2026-11-07' });
    }
  });

  it('an explicit `to` 45 days out is still computed as sent; 46 days is refused', async () => {
    await service.getForecast({ from: '2026-09-23', to: '2026-11-07' }, 'tenant-1', 'STANDARD_USER');
    expect(compute.mock.calls[0][3]).toMatchObject({ from: '2026-09-23', to: '2026-11-07' });
    compute.mockImplementationOnce((...args: Parameters<FeedForecastService['computeForFarm']>) =>
      FeedForecastService.prototype.computeForFarm.apply(service, args));
    await expect(service.getForecast({ from: '2026-09-23', to: '2026-11-08' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(BadRequestException);
  });

  it('keeps true shortage evidence internal to save/draft calculations so ordinary GET source fields stay compatible', async () => {
    compute.mockResolvedValueOnce({
      ...computed,
      sources: [{
        sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 'silo-1', itemId: 'r1', itemName: 'R1',
        balanceKg: 500, planningDayDemandKg: 100, firstDemandDate: '2026-09-23', firstDayDemandKg: 100,
        walkDemandKg: 700, daysLeft: 5, runDownDate: '2026-09-27', shortageDate: '2026-09-29',
        isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['life-1'], thresholdKg: 100,
        incomingKg: 0, shortfallKg: 200, safetyStockKg: 0, deliveryDayOpeningKg: 100,
      }],
    } as any);

    const report = await service.getForecast({ view: 'DAILY' }, 'tenant-1', 'STANDARD_USER');

    expect(report.sources[0]).toMatchObject({ runDownDate: '2026-09-27', sourceName: 'Weaner silo' });
    expect(report.sources[0]).not.toHaveProperty('shortageDate');
    expect(report).not.toHaveProperty('sourceSnapshot');
  });

  it('DAILY: one date, the planning date unless another is chosen', async () => {
    await service.getForecast({ view: 'DAILY', from: '2026-09-25' }, 'tenant-1', 'STANDARD_USER');
    expect(compute.mock.calls[0][3]).toMatchObject({ from: '2026-09-25', to: '2026-09-25', horizonTo: '2026-11-07' });
  });

  it('PERIOD: From/To come from the period covering the planning date; days before the planning date are not forecast (Q7)', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    const report = await service.getForecast({ view: 'PERIOD' }, 'tenant-1', 'STANDARD_USER');
    expect(compute.mock.calls[0][3]).toMatchObject({ from: '2026-08-30', to: '2026-09-26' });
    expect(report).toMatchObject({ from: '2026-08-30', to: '2026-09-26', forecastFrom: '2026-09-23', period: { periodCode: '2026-09' } });
    expect(report.forecastNote).toBe('Days before the planning date (23/09/26) are not forecast.');
  });

  it('refuses a reporting period longer than the 45-day horizon, naming it, and computes nothing (Review Focus 3)', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([{ ...september, periodId: 'p-long', periodCode: '2026-X', startDate: '2026-08-01', endDate: '2026-09-19' }]);
    await expect(service.getForecast({ view: 'PERIOD', periodId: 'p-long' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('Reporting period 2026-X runs 50 days (01/08/26 to 19/09/26); the forecast covers at most 46.'),
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('says where to add a period when none covers the planning date, and refuses an unknown period id', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([]);
    await expect(service.getForecast({ view: 'PERIOD' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('No reporting period covers 23/09/26. Add one under Farm Master → Reporting Periods.'),
    );
    await expect(service.getForecast({ view: 'PERIOD', periodId: 'nope' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('Reporting period not found.'),
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('marks a range that ends before the planning date as not forecast, and says so', async () => {
    const report = await service.getForecast({ from: '2026-09-10', to: '2026-09-15' }, 'tenant-1', 'STANDARD_USER');
    expect(report.forecastFrom).toBeNull();
    expect(report.forecastNote).toBe(
      'Nothing from 10/09/26 to 15/09/26 is forecast: the range ends before the planning date (23/09/26).',
    );
  });

  it('refuses a planning date that is not a calendar day', async () => {
    await expect(service.getForecast({ planningDate: '2026-02-31' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(BadRequestException);
    expect(compute).not.toHaveBeenCalled();
  });

  it('refuses a malformed date even where the view does not use it — never silently ignored', async () => {
    const loadPeriods = jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    await expect(service.getForecast({ view: 'PERIOD', from: '2026-09-23T10:00:00Z' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('from must be a calendar date (YYYY-MM-DD).'),
    );
    await expect(service.getForecast({ view: 'DAILY', to: '2026-09-31' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('to must be a calendar date (YYYY-MM-DD).'),
    );
    await expect(service.getForecast({ view: 'WEEKLY', periodId: september.periodId }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('periodId applies only to the Reporting Period view.'),
    );
    expect(loadPeriods).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
  });

  it('refuses a planning date more than 45 days from today before looking up a period (Q8)', async () => {
    const loadPeriods = jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    await expect(service.getForecast({ view: 'PERIOD', planningDate: '2026-11-08' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('The planning date must be within 45 days of today (23/09/26).'),
    );
    expect(loadPeriods).not.toHaveBeenCalled();
    expect(compute).not.toHaveBeenCalled();
  });

  it('refuses a range that ends more than 45 days past the planning date (Q12: nothing is forecast beyond it)', async () => {
    // The check lives in computeForFarm (follow-up), so this call goes through the real one; it refuses before loading.
    compute.mockImplementationOnce((...args: Parameters<FeedForecastService['computeForFarm']>) =>
      FeedForecastService.prototype.computeForFarm.apply(service, args));
    await expect(service.getForecast({ from: '2026-11-01', to: '2026-11-08' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('The forecast reaches 07/11/26 at most (45 days after the planning date).'),
    );
    await expect(service.getForecast({ from: '2026-11-01', to: '2026-11-07' }, 'tenant-1', 'STANDARD_USER')).resolves.toBeDefined();
  });

  it('CUSTOM with only `from` near the edge: to defaults to from + 6 = Nov7, which is exactly the reach', async () => {
    // from + 6 = Nov7 is the last day inside the 45-day reach, so the default window is accepted.
    expect(compute).not.toHaveBeenCalled(); // sanity guard
    await service.getForecast({ from: '2026-11-01' }, 'tenant-1', 'STANDARD_USER');
    expect(compute).toHaveBeenCalledWith(
      'farm-A', 'comp-1', 'tenant-1',
      { from: '2026-11-01', to: '2026-11-07', planningDate: '2026-09-23', horizonTo: '2026-11-07' },
      { today: '2026-09-23', timeZone: 'Africa/Harare' },
    );
  });

  it('passes the stage block through from the computed forecast', async () => {
    const block = { batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-09-01' };
    compute.mockResolvedValueOnce({ ...computed, stages: [block] } as any);
    const report = await service.getForecast({ view: 'DAILY' }, 'tenant-1', 'STANDARD_USER');
    expect(report.stages).toEqual([block]);
  });

  it('listPeriods answers the farm company\'s periods after resolving the farm', async () => {
    const loadPeriods = jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    await expect(service.listPeriods(undefined, 'tenant-1', 'STANDARD_USER')).resolves.toEqual([september]);
    expect(loadPeriods).toHaveBeenCalledWith('comp-1', 'tenant-1');
    await expect(service.listPeriods('farm-B', 'tenant-1', 'STANDARD_USER')).rejects.toThrow(NotFoundException);
  });

  it('listPeriods holds a caller with no user type to the company-checked branch (resolveFarm fails closed)', async () => {
    const loadPeriods = jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    (activeFarmOfCompany as jest.Mock).mockResolvedValueOnce(false); // farm-B is not an active farm of comp-1
    await expect(service.listPeriods('farm-B', 'tenant-1', undefined)).rejects.toThrow(NotFoundException);
    expect(loadPeriods).not.toHaveBeenCalled();
  });
});

describe('loadPeriods — the company\'s own reporting periods only (Ruling M5)', () => {
  it('reads active, undeleted periods of the company by start date, never a tenant-template row', async () => {
    const wheres: unknown[] = [];
    const rows = [{ period_id: 'p9', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26', production_start_date: '2026-09-27' }];
    const self: any = {
      from: () => self,
      where: (w: unknown) => { wheres.push(w); return self; },
      orderBy: async () => rows,
    };
    const cls = transactionCls({ select: () => self });
    const out = await (new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB) as any).loadPeriods('comp-1', 'tenant-1');
    expect(out).toEqual([{ periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' }]);
    const q = new MySqlDialect().sqlToQuery(wheres[0] as any);
    expect(q.sql).toMatch(/`company_id` = \?/);
    expect(q.sql).not.toMatch(/`company_id` is null/);
    expect(q.sql).toMatch(/`deleted_at` is null/);
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'comp-1']));
    expect(q.params).toContain(true);
  });
});

describe('stageBlocksFor — current / next stage block (field spec supporting block)', () => {
  const stages = new Map<string, StageInfo>([
    ['wean', { stageId: 'wean', stageCode: 'WEANER', durationDays: 42, nextStageId: 'grow', isActive: true }],
    ['grow', { stageId: 'grow', stageCode: 'GROWER', durationDays: 56, nextStageId: null, isActive: true }],
    ['sow', { stageId: 'sow', stageCode: 'DRY_SOW', durationDays: null, nextStageId: 'grow', isActive: true, minDays: 4 }],
    ['flush', { stageId: 'flush', stageCode: 'FLUSH', durationDays: 5, nextStageId: 'ins', isActive: true, minDays: 3 }],
    ['ins', { stageId: 'ins', stageCode: 'INSEMINATION', durationDays: 2, nextStageId: null, isActive: true }],
    ['old', { stageId: 'old', stageCode: 'OLD', durationDays: 10, nextStageId: 'gone', isActive: true }],
    ['gone', { stageId: 'gone', stageCode: 'RETIRED', durationDays: 10, nextStageId: null, isActive: false }],
  ]);
  const sheds = new Map([['h3', 'GRS/SHED-003']]);
  const batch = (stageId: string, stageCode: string, start: string) => ({
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId, stageCode, start, end: null, projected: false }],
  });

  it('dates the current stage from its entry, the next from the day after, and names the change date', () => {
    expect(stageBlocksFor([batch('wean', 'WEANER', '2026-09-01')], stages, sheds, '2026-09-23')).toEqual([{
      batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003',
      currentStageCode: 'WEANER', currentFrom: '2026-09-01', currentTo: '2026-10-12',
      nextStageCode: 'GROWER', nextFrom: '2026-10-13', nextTo: '2026-12-07',
      stageChangeEarliest: null, stageChangeDate: '2026-10-13', stageChangeOverdue: false,
    }]);
  });

  it('marks a change that fell due on or before the planning date but was not posted', () => {
    const [block] = stageBlocksFor([batch('wean', 'WEANER', '2026-08-01')], stages, sheds, '2026-09-23');
    expect(block).toMatchObject({ currentTo: '2026-09-11', stageChangeDate: '2026-09-12', stageChangeOverdue: true });
  });

  it('leaves the dates open when Stage Master gives no duration, and the next stage empty when there is none', () => {
    expect(stageBlocksFor([batch('sow', 'DRY_SOW', '2026-09-01')], stages, sheds, '2026-09-23')[0])
      .toMatchObject({ currentTo: null, nextStageCode: 'GROWER', nextFrom: null, stageChangeDate: null });
    expect(stageBlocksFor([batch('grow', 'GROWER', '2026-09-01')], stages, sheds, '2026-09-23')[0])
      .toMatchObject({ currentTo: '2026-10-26', nextStageCode: null, nextFrom: null, stageChangeDate: null, stageChangeOverdue: false });
  });

  it('sorts by shed, batch and then stage — batchId + currentStageCode is the web row key, so the order must not depend on input order', () => {
    const a = { ...batch('wean', 'WEANER', '2026-09-01'), batchNo: 'B-10' };
    const b = { ...batch('grow', 'GROWER', '2026-09-01'), batchNo: 'B-10' };
    expect(stageBlocksFor([a, b], stages, sheds, '2026-09-23').map((s) => s.currentStageCode)).toEqual(['GROWER', 'WEANER']);
    expect(stageBlocksFor([b, a], stages, sheds, '2026-09-23').map((s) => s.currentStageCode)).toEqual(['GROWER', 'WEANER']);
  });

  it('does not offer a retired successor as the next stage, and a batch on no shed shows an empty shed', () => {
    const noShed = { ...batch('old', 'OLD', '2026-09-20'), shedId: '' };
    expect(stageBlocksFor([noShed], stages, sheds, '2026-09-23')[0])
      .toMatchObject({ shedCode: '', currentTo: '2026-09-29', nextStageCode: null, nextFrom: null, stageChangeDate: null });
  });

  it('an event-based stage shows the change window earliest – latest (expected) (D36)', () => {
    // FLUSH entered 1 Sep: min 3 -> earliest change 4 Sep; typical 5 -> latest 6 Sep (the planned change date).
    const [block] = stageBlocksFor([batch('flush', 'FLUSH', '2026-09-01')], stages, sheds, '2026-09-01');
    expect(block).toMatchObject({
      currentTo: '2026-09-05',
      nextStageCode: 'INSEMINATION',
      stageChangeEarliest: '2026-09-04',
      stageChangeDate: '2026-09-06',
      stageChangeOverdue: false,
    });
  });

  it('no window when the stage has no minimum (earliest = 0) or the minimum is not before the latest (D36)', () => {
    // WEANER has no min_days_before_move: the change date stands alone.
    expect(stageBlocksFor([batch('wean', 'WEANER', '2026-09-01')], stages, sheds, '2026-09-23')[0].stageChangeEarliest).toBeNull();
    // A stage whose minimum equals its typical duration has no range to show.
    const tight = new Map(stages);
    tight.set('tight', { stageId: 'tight', stageCode: 'TIGHT', durationDays: 4, nextStageId: 'ins', isActive: true, minDays: 4 });
    expect(stageBlocksFor([batch('tight', 'TIGHT', '2026-09-01')], tight, sheds, '2026-09-01')[0].stageChangeEarliest).toBeNull();
  });

  it('back-dated planning date: the current stage still starts at today\'s header, not the batch start (Ruling I1)', () => {
    const locationById = new Map([['h3', { location_id: 'h3', location_type: 'SHED', parent_location_id: null }]]);
    const { batches } = buildInputBatches({
      batchRows: [{ batch_id: 'b', batch_no: 'WG-2026-38', breed_id: 'l', stage_id: 'grow', shed_id: 'h3', tracking_mode: 'BATCH_WISE', animal_tracking: null, start_date: '2026-07-01', opening_quantity: '1000', closing_quantity: null }],
      animalGroups: new Map(),
      headers: [{ batch_id: 'b', stage_id: 'grow', effective_from: '2026-09-15', location_id: 'h3' }],
      stages, locationById, activeShedIds: new Set(['h3']),
      planningDate: '2026-09-10', to: '2026-10-25', headerCutoff: '2026-09-23',
    });
    expect(stageBlocksFor(batches, stages, sheds, '2026-09-10')[0]).toMatchObject({ currentStageCode: 'GROWER', currentFrom: '2026-09-15', currentTo: '2026-11-09' });
  });
});

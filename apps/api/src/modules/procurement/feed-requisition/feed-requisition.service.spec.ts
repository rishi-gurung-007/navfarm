import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { ClsService } from 'nestjs-cls';
import { createHash } from 'node:crypto';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { todayInZone, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import { buildRunLineSnapshots, type ForecastRunLineSnapshot } from '../../inventory/feed-forecast/feed-forecast-run.rules';
import { addDaysIso, serverToday } from './feed-requisition.rules';
import { FeedRequisitionService } from './feed-requisition.service';

describe('FeedRequisitionService.createManual', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const selectQueue: unknown[][] = [];
  const db: any = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
  };
  const feedSettingsStub: any = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 })) };
  const service = new FeedRequisitionService(transactionCls(db), forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any, {} as any, {} as any, feedSettingsStub);

  it('refuses a destination that is not an active silo or store of the farm', async () => {
    selectQueue.push(
      [{ location_code: 'GRS' }], // farm — settings now come from FeedSettingsService, not location_master
      [{ location_id: 'shed-1', location_code: 'GRS/SHED-003', location_type: 'SHED', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null }],
    );
    await expect(service.createManual({ lines: [{ destination_location_id: 'shed-1', item_id: 'r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' }] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Destination GRS/SHED-003 must be an active silo or store of farm GRS.'));
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses the same silo and item twice on one requisition (Requisition §1 row 9)', async () => {
    const silo = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null };
    selectQueue.push(
      [{ location_code: 'GRS' }],
      [silo],
    );
    const line = { destination_location_id: 'silo-1', item_id: 'r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' };
    await expect(service.createManual({ lines: [line, { ...line, quantity_kg: 6000 }] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses a manual line ordering an item the lifecycle does not require, without an exception reason (Req. row 13)', async () => {
    const silo = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null };
    selectQueue.push([{ location_code: 'GRS' }], [silo], [{ item_id: 'r2', item_name: 'Grower R2' }]);
    const fc = { ...forecast, computeForFarm: jest.fn(async () => ({ sources: [{ locationId: 'silo-1', itemId: 'r1' }] })) };
    const siloFeed = { currentItems: jest.fn(async () => new Map()) };
    const svc = new FeedRequisitionService(transactionCls(db), fc, {} as any, { evaluateFarmSafely: jest.fn() } as any, siloFeed as any, {} as any, feedSettingsStub);
    const line = { destination_location_id: 'silo-1', item_id: 'r2', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' };
    await expect(svc.createManual({ lines: [line] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow('Line 1: Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).');
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A recording database: every select records its table, where clause and row
// lock; answers come from per-table queues in call order.

interface Entry { op: string; table: unknown; where?: unknown; lock?: string; values?: any; set?: any; inTx?: boolean }

function recordingDb(queues: Map<unknown, unknown[][]>, cls: () => ClsService) {
  const log: Entry[] = [];
  const inTx = () => cls().get('tenantPostingTransaction') === true;
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined, inTx: inTx() };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self,
        innerJoin: () => self,
        where: (c: unknown) => { entry.where = c; return self; },
        orderBy: () => self,
        limit: () => self,
        for: (mode: string) => { entry.lock = mode; return self; },
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async (c: unknown) => { log.push({ op: 'update', table: t, set: v, where: c, inTx: inTx() }); } }) })),
    delete: jest.fn((t: unknown) => ({ where: async (c: unknown) => { log.push({ op: 'delete', table: t, where: c, inTx: inTx() }); } })),
  };
  return { db, log };
}
const render = (c: unknown) => new MySqlDialect().sqlToQuery(c as any);

const source = (over: Partial<ForecastSource> = {}): ForecastSource => ({
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 'silo-1', itemId: 'item-r1', itemName: 'Weaner Diet R1',
  balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000, walkDemandKg: 6000,
  daysLeft: 0, runDownDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['row-r1'],
  thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, safetyStockKg: 0, deliveryDayOpeningKg: 1500, ...over,
  currentDietDaysRemaining: over.currentDietDaysRemaining === undefined ? 3 : over.currentDietDaysRemaining,
});
// Settings (bulk multiple, bag size, truck target, production weekday) come from FeedSettingsService now
// (Task 5) — location_master no longer supplies them, so the farm row carries only what loadFarm still reads.
const FARM_ROW = { location_code: 'GRS' };
const SILO_ROW = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: '1500.00' };

const forecastDaily = (over: Record<string, unknown> = {}) => ({
  // D1 (3 Oct): batchId is the engine's display/grouping key (composite for an
  // ANIMAL_WISE/REGISTERED stage group); realBatchId is the genuine batch_header PK
  // every writer must persist. Equal here by default — a dedicated test below makes
  // them differ to prove the real id, not the composite, is what gets written.
  date: serverToday(), batchId: 'batch-1', stageId: null, groupStageId: null, batchNo: 'BATCH-1', shedId: 'shed-1', shedCode: 'SHED-1', stageCode: 'WEANER',
  destinationLocationId: 'silo-1', itemId: 'item-r1', itemNo: 'R1', itemName: 'Weaner Diet R1', currentItemId: 'item-r1',
  heads: 1000, feedRateKg: 2, openingStockKg: 1500, confirmedReceiptKg: 0, demandKg: 2000,
  projectedClosingKg: 0, runDownDate: serverToday(), shortageDate: serverToday(), recommendedQtyKg: 4500,
  lifecycleId: 'row-r1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
  perDayIntakeKg: 2000, daysOfStock: 0, sharedBatchCount: 1, indicative: false,
  ...over,
  realBatchId: (over.realBatchId ?? 'batch-1') as any,
});

const OUTPUT_HASH_VERSION = 'forecast-run-display:v3';
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
    : value;
const outputSnapshot = (lines: ForecastRunLineSnapshot[]) => {
  const values = lines.map((line) => canonical(line)).sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  const hash = createHash('sha256').update(`${OUTPUT_HASH_VERSION}\n${JSON.stringify(values)}`).digest('hex');
  return { version: OUTPUT_HASH_VERSION, hash, lineCount: values.length };
};
const storedRunLine = (line: ForecastRunLineSnapshot, runLineId: string) => ({
  run_line_id: runLineId,
  forecast_date: line.forecastDate,
  batch_id: line.batchId,
  shed_id: line.shedId,
  destination_location_id: line.destinationLocationId,
  required_item_id: line.requiredItemId,
  current_item_id: line.currentItemId,
  head_count: line.headCount,
  feed_rate_kg: String(line.feedRateKg),
  opening_stock_kg: String(line.openingStockKg),
  confirmed_receipt_kg: String(line.confirmedReceiptKg),
  daily_demand_kg: String(line.dailyDemandKg),
  projected_closing_kg: String(line.projectedClosingKg),
  shortage_date: line.shortageDate,
  recommended_qty_kg: String(line.recommendedQtyKg),
  provenance_snapshot: line.provenanceSnapshot,
});

function setup(sources: ForecastSource[], queues: Map<unknown, unknown[][]>, daily: ReturnType<typeof forecastDaily>[] = [forecastDaily()]) {
  // The recorder asks the CLS whether a write is inside the transaction; the CLS needs the recorder's db.
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const evaluated: Array<{ args: unknown[]; inTx: boolean }> = [];
  const saved: Array<{ inTx: boolean }> = [];
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn((farmId: string, companyId: string, work: () => Promise<unknown>) =>
      cls.run(async () => { cls.set(FARM_SCOPE_KEY, { ...farmScope(cls), farmId, companyId }); return work(); })),
    computeForFarm: jest.fn(async () => ({
      planningDate: serverToday(), to: serverToday(), sources, daily, farm: { id: 'farm-grs', code: 'GRS' },
      sourceSnapshot: { version: 'sha256:fresh-source', hash: 'fresh-source', values: { engineInput: { sources: 'fresh' } } },
    })),
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
    // 9c F4: autoDraft saves the run it drafts from when none matches; recorded with whether it ran inside the draft transaction.
    saveRun: jest.fn(async () => {
      saved.push({ inTx: cls.get('tenantPostingTransaction') === true });
      return { runId: 'run-new', runCode: `RUN-GRS-${serverToday().replace(/-/g, '')}-001`, version: 1 };
    }),
  };
  const alerts: any = {
    evaluateFarmSafely: jest.fn(async (...args: unknown[]) => { evaluated.push({ args, inTx: cls.get('tenantPostingTransaction') === true }); }),
  };
  // Ruling I4: the ledger now. By default silo-1 holds the source's item at the source's own balance.
  const siloFeed: any = {
    currentItems: jest.fn(async (ids: string[]) => new Map(ids.map((id) => {
      const s = sources.find((x) => x.locationId === id);
      return [id, s ? { item_id: s.itemId, item_code: s.itemId, item_description: s.itemName, on_hand_qty: s.balanceKg, uoms: ['KG'] } : null];
    }))),
  };
  const ledger: any = { getStockBalance: jest.fn(async () => []) };
  // Task 5: FeedSettingsService.resolve() is the farm's settings now (bulk multiple, bag size, truck
  // target, production weekday, safety stock) — the fixture matches FARM_ROW's old feed_* defaults.
  const feedSettings: any = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 })) };
  const service = new FeedRequisitionService(cls, forecast, {} as any, alerts, siloFeed, ledger, feedSettings);
  return { service, log, forecast, alerts, evaluated, saved, cls, db, siloFeed, ledger, feedSettings };
}

describe('FeedRequisitionService.autoDraft', () => {
  it('first run: locks the farm row before looking for a draft, numbers under a lock, drafts AUTO_DRAFT/FEED_FORECAST/MILL/INTERNAL_TRANSFER', async () => {
    const year = serverToday().slice(0, 4);
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [{ req_no: `REQ-GRS-${year}-00041` }], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, evaluated } = setup([source()], queues);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    expect(out).toMatchObject({ created: true, linesDrafted: 1, requisition: { farm_code: 'GRS' } });
    const selects = log.filter((e) => e.op === 'select');
    const farmLock = selects.findIndex((e) => e.table === schema.locationMaster && e.lock === 'update');
    const cycleRead = selects.findIndex((e) => e.table === schema.requisition && e.lock === 'update');
    expect(farmLock).toBeGreaterThanOrEqual(0);
    expect(selects[farmLock].inTx).toBe(true);
    expect(render(selects[farmLock].where).params).toEqual(expect.arrayContaining(['farm-grs', 'tenant-1']));
    // M10: the farm row is locked before the open-draft lookup, so two reruns serialize there.
    expect(farmLock).toBeLessThan(cycleRead);
    // M10: the number is read under a lock (never an unlocked MAX()+1).
    const numberRead = selects.find((e) => e.table === schema.requisition && render(e.where).sql.includes('like'));
    expect(numberRead).toMatchObject({ lock: 'update', inTx: true });

    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(header.values).toMatchObject({
      tenant_id: 'tenant-1', company_id: 'co-1', farm_id: 'farm-grs', req_no: `REQ-GRS-${year}-00042`, doc_type: 'FEED',
      status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST', purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL',
      // Task 3 carry: the silo's own low level (1,500 kg, balance 1,500) came through from the DB — first priority.
      priority: 'CRITICAL_FIRST_PRIORITY', created_by: 'u-1',
    });
    expect(header.values.forecast_run_key).toMatch(/^RUN-GRS-\d{8}-\d{6}$/);
    const lines = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    expect(lines.values).toEqual([expect.objectContaining({
      // Requisition §1 row 42: NAV-style 10000-step line numbering (Task 5), not a plain 1, 2, 3...
      line_seq: 10000, item_id: 'item-r1', destination_location_id: 'silo-1', quantity: '6000', recommended_qty_kg: '6000',
      unrounded_need_kg: '4500', feed_type: 'BULK', source_type: 'SILO', uom: 'KG', quantity_edited: false,
    })]);

    // The alert evaluation runs once, after the draft's transaction committed.
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('links a new editable draft only to exact source/config evidence and records every contributing run line', async () => {
    const daily = [forecastDaily(), forecastDaily({ batchId: 'batch-2', realBatchId: 'batch-2', batchNo: 'BATCH-2', heads: 500, demandKg: 1000 })];
    const materialLines = buildRunLineSnapshots({ daily });
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-5', run_code: 'FFR-farm-grs-000005', version: 5,
        source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(materialLines),
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
        // M6: matchingPersistedRun re-checks these in JS after the read, defence-in-depth against
        // a mis-built WHERE — the default computeForFarm stub (setup()) gives planningDate/to
        // serverToday() and no explicit from, so from falls back to planningDate.
        planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
      }]]],
      [schema.feedForecastRunLine, [[
        storedRunLine(materialLines[0], 'run-line-5a'),
        storedRunLine(materialLines[1], 'run-line-5b'),
      ]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log } = setup([source()], queues, daily);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values).toMatchObject({
      status: 'AUTO_DRAFT', feed_forecast_run_id: 'run-5', forecast_run_key: 'FFR-farm-grs-000005',
    });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: ['run-line-5a', 'run-line-5b'] })]);
  });

  // Engine Step 9 "Preserve run ID"; Requisition §4 step 1 ("RUN-GRS-20260923-001 creates 2 draft lines"):
  // a draft with no saved run to cite saves one for the same window, then links header and lines to it.
  it('saves the forecast run for the drafted window when none matches, then links the header and every line to it (9c F4)', async () => {
    const daily = [forecastDaily(), forecastDaily({ batchId: 'batch-2', realBatchId: 'batch-2', batchNo: 'BATCH-2', heads: 500, demandKg: 1000 })];
    const materialLines = buildRunLineSnapshots({ daily });
    const runCode = `RUN-GRS-${serverToday().replace(/-/g, '')}-001`;
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [
        [], // first look: no run for this window yet
        [{ // second look: the run saveRun just wrote
          run_id: 'run-new', run_code: runCode, version: 1,
          source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(materialLines),
          config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
          planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
        }],
      ]],
      [schema.feedForecastRunLine, [[storedRunLine(materialLines[0], 'run-line-new-a'), storedRunLine(materialLines[1], 'run-line-new-b')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, forecast, saved } = setup([source()], queues, daily);
    const to = serverToday();

    await service.autoDraft({ to }, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(forecast.saveRun).toHaveBeenCalledTimes(1);
    expect(forecast.saveRun).toHaveBeenCalledWith(
      { farmId: 'farm-grs', planningDate: serverToday(), view: 'CUSTOM', from: serverToday(), to },
      'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' },
    );
    // Before the draft transaction: saveRun owns its own transaction, and a failed save must not leave a half-written draft.
    expect(saved).toEqual([{ inTx: false }]);
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values).toMatchObject({
      feed_forecast_run_id: 'run-new', forecast_run_key: runCode,
    });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: ['run-line-new-a', 'run-line-new-b'] })]);
  });

  it('reuses a run that already matches the window instead of saving a duplicate (rerun links the newest run, 9c F4)', async () => {
    const daily = [forecastDaily()];
    const materialLines = buildRunLineSnapshots({ daily });
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-9', run_code: 'RUN-GRS-20260923-002', version: 9,
        source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(materialLines),
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
        planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
      }]]],
      [schema.feedForecastRunLine, [[storedRunLine(materialLines[0], 'run-line-9')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, forecast } = setup([source()], queues, daily);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });
    expect(forecast.saveRun).not.toHaveBeenCalled();
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values).toMatchObject({ feed_forecast_run_id: 'run-9' });
  });

  /**
   * M6 (final whole-branch review): matchingPersistedRun's WHERE pins planning_date/from_date/to_date,
   * but this test double records a WHERE without evaluating it (recordingDb's `then` just shifts the
   * table's queue) — the real defence here is the three-line JS re-check added after the read. Without
   * it, a row with a matching hash/config/settings but a DIFFERENT window would be accepted, exactly as
   * a mis-built WHERE would accept it; this is the one path that can prove the re-check works, because
   * the WHERE itself is not reachable through this kind of mock.
   */
  it('rejects a run whose window differs even though it matches on hash/config/settings — the WHERE is not evaluated by this test double, only the JS re-check after it is (M6)', async () => {
    const daily = [forecastDaily()];
    const materialLines = buildRunLineSnapshots({ daily });
    const runCode = `RUN-GRS-${serverToday().replace(/-/g, '')}-001`;
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [
        [{ // a hash/config/settings match, but for a DIFFERENT window — what a mis-built WHERE would let through
          run_id: 'run-wrong-window', run_code: 'RUN-GRS-20260101-009', version: 9,
          source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(materialLines),
          config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
          planning_date: '2020-01-01', from_date: '2020-01-01', to_date: '2020-01-07',
        }],
        [{ // second look: the run saveRun just wrote for the REAL window
          run_id: 'run-new', run_code: runCode, version: 1,
          source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(materialLines),
          config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
          planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
        }],
      ]],
      [schema.feedForecastRunLine, [[storedRunLine(materialLines[0], 'run-line-new')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, forecast } = setup([source()], queues, daily);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    // The first answer's window mismatch must be caught: a run is still saved for the real window,
    // and the requisition links THAT run — never run-wrong-window.
    expect(forecast.saveRun).toHaveBeenCalledTimes(1);
    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values;
    expect(header).toMatchObject({ feed_forecast_run_id: 'run-new', forecast_run_key: runCode });
    expect(header.feed_forecast_run_id).not.toBe('run-wrong-window');
  });

  // 9d D1 (Pass 2): the source hash covers the engine input, horizonTo included. A run saved through
  // Save Run / getForecast is computed with horizonTo = planning date + 45; a draft computed with
  // horizonTo = `to` could never match it, so nothing was linked and every rerun saved another run.
  it('links the run it saves, and a rerun over unchanged inputs saves no second run (9d D1)', async () => {
    const daily = [forecastDaily()];
    const materialLines = buildRunLineSnapshots({ daily });
    const today = serverToday();
    const to = addDaysIso(today, 9);
    // The engine-input hash, as buildSourceSnapshot would give it: it depends on the horizon.
    const hashFor = (range: { from?: string; to?: string; horizonTo?: string }) =>
      `src|${range.from ?? today}|${range.to}|${range.horizonTo ?? range.to}`;
    const stored: { run?: Record<string, unknown>; lines?: Record<string, unknown>[] } = {};
    const queues = new Map<unknown, unknown[][]>([
      // The runs table as it stands: whatever saveRun last wrote.
      [schema.feedForecastRun, { shift: () => (stored.run ? [stored.run] : []) } as unknown as unknown[][]],
      [schema.feedForecastRunLine, { shift: () => stored.lines ?? [] } as unknown as unknown[][]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }], [FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [
        [], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }], // first draft
        [{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }], // rerun
      ]],
      [schema.requisitionLine, [[], [
        { line_id: 'L1', line_seq: 10000, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: false,
          recommended_date: to, proposed_date: to },
      ]]],
    ]);
    const { service, log, forecast } = setup([source()], queues, daily);
    forecast.computeForFarm.mockImplementation(async (_f: string, _c: string, _t: string, range: { from?: string; to?: string; horizonTo?: string }) => ({
      planningDate: today, from: range.from ?? today, to: range.to, sources: [source()], daily, farm: { id: 'farm-grs', code: 'GRS' },
      sourceSnapshot: { version: 'sha256:fresh-source', hash: hashFor(range), values: {} },
    }));
    // Save Run computes through getForecast: the standard horizon, planning date + MAX_SPAN_DAYS.
    forecast.saveRun.mockImplementation(async (query: { from: string; to: string; planningDate: string }) => {
      const runNo = forecast.saveRun.mock.calls.length;
      stored.run = {
        run_id: `run-${runNo}`, run_code: `RUN-GRS-${today.replace(/-/g, '')}-00${runNo}`, version: runNo,
        source_snapshot: { hash: hashFor({ from: query.from, to: query.to, horizonTo: addDaysIso(query.planningDate, 45) }) },
        output_snapshot: outputSnapshot(materialLines),
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
        planning_date: query.planningDate, from_date: query.from, to_date: query.to,
      };
      stored.lines = [storedRunLine(materialLines[0], `run-line-${runNo}`)];
      return { runId: `run-${runNo}`, runCode: stored.run.run_code, version: runNo };
    });
    const user = { userId: 'u-1', userType: 'FARM_MANAGER' };

    await service.autoDraft({ to }, 'tenant-1', user);
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values)
      .toMatchObject({ feed_forecast_run_id: 'run-1', forecast_run_key: `RUN-GRS-${today.replace(/-/g, '')}-001` });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: ['run-line-1'] })]);
    // The draft's forecast is computed over the standard horizon, its order window stays `to`.
    expect(forecast.computeForFarm).toHaveBeenLastCalledWith('farm-grs', 'co-1', 'tenant-1',
      { planningDate: today, from: today, to, horizonTo: addDaysIso(today, 45) }, expect.anything());

    await service.autoDraft({ to }, 'tenant-1', user);
    expect(forecast.saveRun).toHaveBeenCalledTimes(1);
    expect(log.find((e) => e.op === 'update' && e.table === schema.requisition)?.set).toMatchObject({ feed_forecast_run_id: 'run-1' });
    expect(log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)?.set)
      .toMatchObject({ feed_forecast_run_line_ids: ['run-line-1'] });
  });

  /**
   * 9d D1, fix round 1 — the half the suite was missing. Two halves existed and never met:
   * "saves the forecast run for the drafted window when none matches" (9c F4) starts from NO run at
   * all, and "refuses to attach stale run evidence when freshly recalculated source content differs"
   * proves a stale run is rejected but never wires the run saveRun then writes back into the lookup's
   * answers, so it only ever shows the detachment. Neither shows the full cycle: a stale run IS present,
   * the inputs have genuinely changed, the stale run is rejected, a FRESH run is saved, and the
   * requisition links to THAT one.
   *
   * The change here is the realistic one: the farm raised safety stock from 0 to 500 kg after the old
   * run was saved. safetyStockKg is part of the engine input, so the source hash moves — and it is NOT
   * one of the four rounding settings matchingPersistedRun compares, so nothing else can reject the
   * stale run. Its config_snapshot and output_snapshot are deliberately made to still match, leaving
   * the source hash the single reason it is refused. The point of the test is that a too-loose match
   * key would link the requisition to a run that no longer describes it, which is exactly the class of
   * defect D1 was.
   */
  it('rejects a stale run, saves a fresh one for the changed inputs, and links the requisition to the fresh run (9d D1)', async () => {
    const daily = [forecastDaily()];
    const materialLines = buildRunLineSnapshots({ daily });
    const draftSettings = { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 };
    const freshCode = `RUN-GRS-${serverToday().replace(/-/g, '')}-006`;
    // The run on file, saved when safety stock was still 0: same window, same rounding settings, same
    // engine output — only its source hash is from the old input.
    const staleRun = {
      run_id: 'run-stale', run_code: 'RUN-GRS-20260923-005', version: 5,
      source_snapshot: { hash: 'source-at-safety-0' }, output_snapshot: outputSnapshot(materialLines),
      config_snapshot: { values: { requisitionDraftSettings: { ...draftSettings } } },
      planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
    };
    // What saveRun actually wrote, read back by the second lookup — so the link asserted below is the
    // run that was saved, not merely the fact that saveRun was called.
    const stored: { run?: Record<string, unknown> } = {};
    let looks = 0;
    const runLookups = { shift: () => { looks += 1; return looks === 1 ? [staleRun] : (stored.run ? [stored.run] : []); } };
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, runLookups as unknown as unknown[][]],
      [schema.feedForecastRunLine, [[storedRunLine(materialLines[0], 'run-line-fresh')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, forecast, feedSettings } = setup([source()], queues, daily);
    feedSettings.resolveForFeedPlanning.mockResolvedValue({ safetyStockKg: 500, ...draftSettings });
    forecast.computeForFarm.mockImplementation(async () => ({
      planningDate: serverToday(), from: serverToday(), to: serverToday(), sources: [source()], daily, farm: { id: 'farm-grs', code: 'GRS' },
      sourceSnapshot: { version: 'sha256:source-at-safety-500', hash: 'source-at-safety-500', values: { engineInput: { safetyStockKg: 500 } } },
    }));
    forecast.saveRun.mockImplementation(async () => {
      stored.run = {
        run_id: 'run-fresh', run_code: freshCode, version: 6,
        source_snapshot: { hash: 'source-at-safety-500' }, output_snapshot: outputSnapshot(materialLines),
        config_snapshot: { values: { requisitionDraftSettings: { ...draftSettings } } },
        planning_date: serverToday(), from_date: serverToday(), to_date: serverToday(),
      };
      return { runId: 'run-fresh', runCode: freshCode, version: 6 };
    });

    await service.autoDraft({ to: serverToday() }, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    // Exactly once: the stale run is refused, and one fresh run is saved for the window — not one per lookup.
    expect(forecast.saveRun).toHaveBeenCalledTimes(1);
    expect(forecast.saveRun).toHaveBeenCalledWith(
      { farmId: 'farm-grs', planningDate: serverToday(), view: 'CUSTOM', from: serverToday(), to: serverToday() },
      'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' },
    );
    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!.values;
    expect(header).toMatchObject({ feed_forecast_run_id: 'run-fresh', forecast_run_key: freshCode });
    // Said explicitly: the run that no longer describes this draft must not be what the requisition cites.
    expect(header.feed_forecast_run_id).not.toBe('run-stale');
    expect(header.forecast_run_key).not.toBe('RUN-GRS-20260923-005');
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: ['run-line-fresh'] })]);
  });

  it('saves no run when the forecast wants nothing drafted', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[]]],
    ]);
    const { service, forecast } = setup([source({ shortfallKg: 0, walkDemandKg: 0, planningDayDemandKg: 0, balanceKg: 9000, daysLeft: 9 })], queues, []);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(out).toMatchObject({ created: false, linesDrafted: 0 });
    expect(forecast.saveRun).not.toHaveBeenCalled();
  });

  it('refuses to attach stale run evidence when freshly recalculated source content differs', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-stale', run_code: 'FFR-farm-grs-000004', version: 4,
        source_snapshot: { hash: 'old-source' },
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log } = setup([source()], queues);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values).toMatchObject({
      feed_forecast_run_id: null,
    });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: null })]);
  });

  it('detaches an older engine output even when its exact input hash and requisition settings still match', async () => {
    const currentDaily = forecastDaily();
    const oldEngineLines = buildRunLineSnapshots({ daily: [{ ...currentDaily, demandKg: 1999, projectedClosingKg: 1 }] });
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-old-engine', run_code: 'FFR-farm-grs-000004', version: 4,
        source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(oldEngineLines),
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.feedForecastRunLine, [[storedRunLine(oldEngineLines[0], 'run-line-old')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log } = setup([source()], queues, [currentDaily]);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.requisition)?.values)
      .toMatchObject({ feed_forecast_run_id: null });
    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: null })]);
  });

  it('detaches when persisted run lines are only a partial multiset of the saved and freshly computed output', async () => {
    const currentDaily = [forecastDaily(), forecastDaily({ date: serverToday(), batchId: 'batch-2', realBatchId: 'batch-2', batchNo: 'BATCH-2', heads: 500, demandKg: 1000 })];
    const completeLines = buildRunLineSnapshots({ daily: currentDaily });
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-partial', run_code: 'FFR-farm-grs-000005', version: 5,
        source_snapshot: { hash: 'fresh-source' }, output_snapshot: outputSnapshot(completeLines),
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.feedForecastRunLine, [[storedRunLine(completeLines[0], 'run-line-only')]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log } = setup([source()], queues, currentDaily);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.requisition)?.values)
      .toMatchObject({ feed_forecast_run_id: null });
    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: null })]);
  });

  it('detaches a matching run when today\'s live system balance changed after the forecast evidence', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-5', run_code: 'FFR-farm-grs-000005', version: 5,
        source_snapshot: { hash: 'fresh-source' },
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log, siloFeed } = setup([source()], queues);
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-1', {
      item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 1200, uoms: ['KG'],
    }]]));

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values)
      .toMatchObject({ feed_forecast_run_id: null });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ system_balance_kg: '1200', feed_forecast_run_line_ids: null })]);
  });

  it('detaches the whole draft when a wanted aggregate has no contributing line in the run', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-5', run_code: 'FFR-farm-grs-000005', version: 5,
        source_snapshot: { hash: 'fresh-source' },
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.feedForecastRunLine, [[]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, log } = setup([source()], queues);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values)
      .toMatchObject({ feed_forecast_run_id: null });
    expect(log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)?.values)
      .toEqual([expect.objectContaining({ feed_forecast_run_line_ids: null })]);
  });

  it('a later matching run never rewrites an approved requisition or its line links', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{ run_id: 'run-6', run_code: 'FFR-farm-grs-000006', version: 6 }]]],
      [schema.feedForecastRunLine, [[{ run_line_id: 'run-line-6', destination_location_id: 'silo-1', required_item_id: 'item-r1' }]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'approved-1', status: 'APPROVED', requisition_type: 'FEED_FORECAST' }]]],
      [schema.requisitionLine, [[{ dest: 'silo-1', item: 'item-r1' }]]],
    ]);
    const { service, log } = setup([source()], queues);

    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'FARM_MANAGER' });

    expect(log.filter((e) => e.op === 'update' && (e.table === schema.requisition || e.table === schema.requisitionLine))).toEqual([]);
  });

  it('passes every source its destination row from the DB — a source with none fails rather than silently losing its low level (Task 3 carry)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [/* silo-1 row missing */]]],
    ]);
    const { service, log } = setup([source()], queues);
    await expect(service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' })).rejects.toThrow(/GRS\/SILO-001/);
    expect(log.some((e) => e.op === 'insert')).toBe(false);
  });

  it('snapshots the ledger balance now, not the forecast\'s start-of-day opening, and dates the line Required On (Ruling I4, Q4)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW, { ...SILO_ROW, location_id: 'store-1', location_code: 'GRS/STORE-001', location_type: 'STORE', low_level_kg: null }], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const planningDay = serverToday();
    const future = (n: number) => { const d = new Date(`${planningDay}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    // Start of day 1,516 kg — above the 1,500 kg low level — but 16 kg was fed this morning: the ledger holds 1,500.
    const silo = source({ balanceKg: 1516, runDownDate: future(4), shortageDate: future(2) });
    const store = source({ sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'store-1', itemId: 'item-p', balanceKg: 900, shortfallKg: 100,
      runDownDate: future(1), shortageDate: future(-1) });
    const { service, log, siloFeed, ledger, forecast } = setup([silo, store], queues);
    // A seven-day window, so the silo's shortage two days out falls inside it (9d D1: one past `to` is dated `to`).
    const computed = forecast.computeForFarm.getMockImplementation();
    forecast.computeForFarm.mockImplementation(async (...args: unknown[]) => ({ ...(await computed(...args)), to: future(6) }));
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 1500, uoms: ['KG'] }]]));
    ledger.getStockBalance.mockResolvedValueOnce([
      { item_id: 'item-p', uom: 'KG', on_hand_qty: 850 }, { item_id: 'item-p', uom: 'BAG', on_hand_qty: 3 }, { item_id: 'item-q', uom: 'KG', on_hand_qty: 40 },
    ]);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    expect(siloFeed.currentItems).toHaveBeenCalledWith(['silo-1'], 'co-1', 'tenant-1');
    expect(ledger.getStockBalance).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co-1', warehouseId: 'store-1' }), 'tenant-1');
    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(header.values).toMatchObject({ priority: 'CRITICAL_FIRST_PRIORITY', required_date: planningDay });
    const lines = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    expect(lines.values).toEqual([
      expect.objectContaining({ destination_location_id: 'silo-1', system_balance_kg: '1500', unrounded_need_kg: '4500', proposed_delivery_date: future(2) }),
      expect.objectContaining({ destination_location_id: 'store-1', system_balance_kg: '850', unrounded_need_kg: '100', recommended_qty_kg: '100', proposed_delivery_date: planningDay }),
    ]);
  });

  it('rerun: updates the cycle\'s one AUTO_DRAFT in place — no second requisition, an edited quantity kept (M9), a stale unedited line removed', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{
        run_id: 'run-6', run_code: 'FFR-farm-grs-000006', version: 6,
        source_snapshot: { hash: 'fresh-source' },
        config_snapshot: { values: { requisitionDraftSettings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } } },
      }]]],
      [schema.feedForecastRunLine, [[
        { run_line_id: 'run-line-6', destination_location_id: 'silo-1', required_item_id: 'item-r1' },
      ]]],
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[
        { line_id: 'L1', line_seq: 1, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: true },
        { line_id: 'L2', line_seq: 2, dest: 'silo-9', item: 'item-r9', quantity: '3000.0000', recommended: '3000.0000', edited: false },
        { line_id: 'L3', line_seq: 3, dest: 'silo-8', item: 'item-r8', quantity: '3000.0000', recommended: '3000.0000', edited: true },
      ]]],
    ]);
    const { service, log } = setup([source({ walkDemandKg: 9000, shortfallKg: 7500 })], queues);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(out).toMatchObject({ requisitionId: 'req-1', created: false, linesDrafted: 1 });

    // No second requisition and no new line. (B1: the matched line's batch/house breakdown is rewritten — see below.)
    expect(log.filter((e) => e.op === 'insert' && e.table !== schema.requisitionLineBatch)).toEqual([]);
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    // Recommendation refreshed to 9,000; the farm's 6,000 kept.
    expect(lineUpdate.set).toMatchObject({ recommended_qty_kg: '9000', feed_forecast_run_line_ids: null });
    expect(lineUpdate.set).not.toHaveProperty('quantity');
    // line_seq is never written on an update — a matched line keeps the number it already has (see below).
    expect(lineUpdate.set).not.toHaveProperty('line_seq');
    expect(render(lineUpdate.where).params).toEqual(['L1']);
    const removed = log.find((e) => e.op === 'delete' && e.table === schema.requisitionLine)!;
    expect(render(removed.where).params).toEqual(['L2']);
    const detachedKeptLine = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine
      && e.set.feed_forecast_run_line_ids === null && render(e.where).params[0] === 'L3')!;
    expect(render(detachedKeptLine.where).params).toEqual(['L3']);
    const header = log.find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({ updated_by: 'u-1', feed_forecast_run_id: null });
    expect(render(header.where).params).toEqual(['req-1']);
  });

  it('rerun with a reordered draft: a matched line keeps its persisted line_seq instead of renumbering to its new draft-order position, and a freshly inserted line never collides with a surviving one', async () => {
    // Last run drafted item-r1 first (line_seq 10000) and item-r2 second (line_seq 20000). This run item-r1 is no
    // longer short (it drops out of the forecast entirely) while item-r2 is still short and is now the forecast's
    // FIRST source — so recommendLines would hand it lineNo 10000, the number item-r1 used to have. item-r3 is new.
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [
        [FARM_ROW],
        [{ ...SILO_ROW, location_id: 'silo-2', location_code: 'GRS/SILO-002' }, { ...SILO_ROW, location_id: 'silo-3', location_code: 'GRS/SILO-003' }],
        [{ location_id: 'farm-grs' }],
      ]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[
        { line_id: 'L1', line_seq: 10000, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: false },
        { line_id: 'L2', line_seq: 20000, dest: 'silo-2', item: 'item-r2', quantity: '9000.0000', recommended: '9000.0000', edited: false },
      ]]],
    ]);
    const reordered = [
      source({ sourceCode: 'GRS/SILO-002', locationId: 'silo-2', itemId: 'item-r2', itemName: 'Weaner Diet R2', shortfallKg: 9000 }),
      source({ sourceCode: 'GRS/SILO-003', locationId: 'silo-3', itemId: 'item-r3', itemName: 'Weaner Diet R3', shortfallKg: 4500 }),
    ];
    const { service, log } = setup(reordered, queues);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(out).toMatchObject({ requisitionId: 'req-1', created: false });

    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    expect(render(lineUpdate.where).params).toEqual(['L2']);
    // The surviving line is NOT renumbered to 10000 even though item-r2 is now the forecast's first source.
    expect(lineUpdate.set).not.toHaveProperty('line_seq');
    const removed = log.find((e) => e.op === 'delete' && e.table === schema.requisitionLine)!;
    expect(render(removed.where).params).toEqual(['L1']);
    const insert = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    const insertedSeqs: number[] = insert.values.map((v: any) => v.line_seq);
    // maxSeq comes from `existing` (10000, 20000) — L1's stale 10000 counts even though L1 is being removed — so the
    // new line lands at 30000, clear of every line still (or about to be) in play.
    expect(insertedSeqs).toEqual([30000]);
    // The property that actually matters (the missing unique index makes a collision a real, not theoretical, risk):
    // every line still live after this rerun — L2 untouched at 20000, the new insert — has a distinct line_seq.
    const liveSeqs = [20000, ...insertedSeqs];
    expect(new Set(liveSeqs).size).toBe(liveSeqs.length);
  });

  it('rerun keeps a delivery date the farm moved (Requisition row 29: "Farm Manager can edit with reason") and refreshes only the recommended date', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[
        // Drafted for the 20th; the farm moved it to the 25th.
        { line_id: 'L1', line_seq: 10000, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: false,
          recommended_date: '2026-09-20', proposed_date: '2026-09-25' },
      ]]],
    ]);
    const { service, log } = setup([source({ shortageDate: serverToday() })], queues);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    expect(lineUpdate.set).toMatchObject({ recommended_delivery_date: serverToday() });
    expect(lineUpdate.set).not.toHaveProperty('proposed_delivery_date');
    // The header's Required On follows the date the farm actually asked for.
    const header = log.find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({ required_date: '2026-09-25' });
  });

  it('first draft numbers lines by position in the draft, not by the source order a covered line leaves a hole in (Requisition row 42)', async () => {
    const year = serverToday().slice(0, 4);
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW, { ...SILO_ROW, location_id: 'silo-2' }, { ...SILO_ROW, location_id: 'silo-3' }], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [
        [{ requisition_id: 'req-0', status: 'SUBMITTED', requisition_type: 'FEED_FORECAST' }],
        [{ req_no: `REQ-GRS-${year}-00041` }],
        [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }],
      ]],
      // the cycle's other requisition already covers silo-1 / item-r1
      [schema.requisitionLine, [[{ dest: 'silo-1', item: 'item-r1' }]]],
    ]);
    const sources = [
      source(),
      source({ sourceCode: 'GRS/SILO-002', locationId: 'silo-2', itemId: 'item-r2', itemName: 'Weaner Diet R2' }),
      source({ sourceCode: 'GRS/SILO-003', locationId: 'silo-3', itemId: 'item-r3', itemName: 'Weaner Diet R3' }),
    ];
    const { service, log } = setup(sources, queues);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const lines = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    expect(lines.values.map((v: any) => [v.item_id, v.line_seq])).toEqual([['item-r2', 10000], ['item-r3', 20000]]);
  });

  it('a kept farm quantity gets its silo-capacity flag from the quantity stored, not from the recommendation (Engine Step 8)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      // capacity 9,000 kg; opening on the delivery day 1,500 kg
      [schema.locationMaster, [[FARM_ROW], [{ ...SILO_ROW, silo_capacity_kg: '9000.00' }], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[
        // recommendation 6,000 (flag false: 7,500 <= 9,000) but the farm raised it to 9,000 (10,500 > 9,000)
        { line_id: 'L1', line_seq: 10000, dest: 'silo-1', item: 'item-r1', quantity: '9000.0000', recommended: '6000.0000', edited: true },
      ]]],
    ]);
    const { service, log } = setup([source()], queues);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    expect(lineUpdate.set).toMatchObject({ recommended_qty_kg: '6000', exceeds_silo_capacity: true });
    expect(lineUpdate.set).not.toHaveProperty('quantity');
  });

  it('skips a (silo, item) already on a manual requisition of the same cycle', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'man-1', status: 'DRAFT', requisition_type: 'MANUAL' }]]],
      [schema.requisitionLine, [[{ dest: 'silo-1', item: 'item-r1' }]]],
    ]);
    const { service, log, evaluated } = setup([source()], queues);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(out).toEqual({ requisitionId: null, created: false, linesDrafted: 0, requisition: null });
    expect(log.some((e) => e.op === 'insert')).toBe(false);
    expect(evaluated).toHaveLength(1);
  });

  it('numbers into the new year when the farm zone has already turned (31 Dec 23:00 UTC, Africa/Harare) (D16)', async () => {
    // 31 Dec 2026 23:00 UTC is 1 Jan 2027 01:00 in Harare (UTC+2) — the req_no
    // year must follow the farm's day, not the server's still-2026 one.
    const ms = Date.UTC(2026, 11, 31, 23, 0);
    const farmDay = todayInZone('Africa/Harare', ms);
    expect(farmDay).toBe('2027-01-01'); // sanity check on the fixture itself
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    ]);
    const { service, forecast, log } = setup([source()], queues);
    forecast.farmToday.mockResolvedValue({ today: farmDay, timeZone: 'Africa/Harare' });
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const insert = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(insert.values.req_no).toBe('REQ-GRS-2027-00001');
  });

  it('checks `to` against the farm day, after resolving the farm (D16)', async () => {
    const { service, forecast } = setup([source()], new Map());
    forecast.farmToday.mockResolvedValueOnce({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    await expect(service.autoDraft({ to: '2026-11-11' }, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow('to must be between today and 45 days ahead.');
    expect(forecast.resolveFarm).toHaveBeenCalled();
    expect(forecast.farmToday).toHaveBeenCalledWith('co-1', 'tenant-1');
    expect(forecast.computeForFarm).not.toHaveBeenCalled();
  });

  it('plans on the same farm day it validated `to` against: the clock goes to the forecast (M6)', async () => {
    const { service, forecast } = setup([], new Map());
    forecast.farmToday.mockResolvedValueOnce({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    await service.autoDraft({ to: '2026-10-03' }, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }).catch(() => undefined);
    expect(forecast.farmToday).toHaveBeenCalledTimes(1);
    // 9d D1: planned from that farm day, over the standard horizon (planning date + 45), ordering to `to`.
    expect(forecast.computeForFarm).toHaveBeenCalledWith('farm-grs', 'co-1', 'tenant-1',
      { planningDate: '2026-09-26', from: '2026-09-26', to: '2026-10-03', horizonTo: '2026-11-10' }, { today: '2026-09-26', timeZone: 'Africa/Harare' });
  });
});

describe('WP1e — the feed requisition list scopes restricted users by the farm\'s LOB (decisions.md 2026-10-04, last entry)', () => {
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, leftJoin: () => self, orderBy: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };

  it("a restricted user's list query scopes by the farm's LOB and never reads company_master", async () => {
    const whereCalls: unknown[] = [];
    const db: any = { select: jest.fn(() => { const c = chain([]); const innerWhere = c.where; c.where = (cond: unknown) => { whereCalls.push(cond); return innerWhere(cond); }; return c; }) };
    const forecast: any = {
      resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
      withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
    };
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-grs', restricted: true, companyId: 'co-1', lobId: 'lob-pig' } as any);
    const feedSettingsStub: any = { resolveForFeedPlanning: jest.fn() };
    const service = new FeedRequisitionService(cls, forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any, {} as any, {} as any, feedSettingsStub);
    await service.findAll({} as any, 'tenant-1', { userId: 'u', userType: 'FARM_MANAGER' });
    const q = new MySqlDialect().sqlToQuery(whereCalls[0] as any);
    expect(q.sql).toContain('`farm_id` IS NULL');
    expect(q.sql).toContain('location_master');
    expect(q.sql).toContain('rf.lob_id = ?');
    expect(q.params).toContain('lob-pig');
    expect(q.sql).not.toContain('company_master');
  });

  it("an unrestricted caller's list query adds no LOB condition", async () => {
    const whereCalls: unknown[] = [];
    const db: any = { select: jest.fn(() => { const c = chain([]); const innerWhere = c.where; c.where = (cond: unknown) => { whereCalls.push(cond); return innerWhere(cond); }; return c; }) };
    const forecast: any = {
      resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
      withFarmScope: jest.fn(async (_f: string, _c: string, work: () => Promise<unknown>) => work()),
    };
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-grs', restricted: false, companyId: 'co-1', lobId: null } as any);
    const feedSettingsStub: any = { resolveForFeedPlanning: jest.fn() };
    const service = new FeedRequisitionService(cls, forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any, {} as any, {} as any, feedSettingsStub);
    await service.findAll({} as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' });
    expect(new MySqlDialect().sqlToQuery(whereCalls[0] as any).sql).not.toContain('lob_id');
  });
});

describe('FeedRequisitionService.findOne — by id, under the row\'s own farm (Ruling H3)', () => {
  const REQ = { requisition_id: 'req-1', farm_id: 'farm-y', company_id: 'co-1' };

  it('a requisition of another company is not found', async () => {
    const queues = new Map<unknown, unknown[][]>([[schema.requisition, [[{ ...REQ, company_id: 'co-2' }]]]]);
    const { service, forecast } = setup([], queues);
    forecast.resolveFarm.mockRejectedValueOnce(new NotFoundException('Farm not found.'));
    await expect(service.findOne('req-1', 'tenant-1', { userType: 'COMPANY_ADMIN' })).rejects.toThrow(NotFoundException);
    expect(forecast.resolveFarm).toHaveBeenCalledWith('farm-y', 'tenant-1', 'COMPANY_ADMIN');
  });

  it('is not found when the farm resolves to a different company than the row\'s', async () => {
    // The mock would hand the view back if asked: only the company check stands in the way.
    const queues = new Map<unknown, unknown[][]>([[schema.requisition, [[{ ...REQ, company_id: 'co-2' }], [{ req: REQ, farm_code: 'Y', truck_target_kg: 30000 }]]]]);
    const { service, forecast } = setup([], queues);
    forecast.resolveFarm.mockResolvedValueOnce({ farmId: 'farm-y', companyId: 'co-1' });
    await expect(service.findOne('req-1', 'tenant-1', { userType: 'COMPANY_ADMIN' })).rejects.toThrow(NotFoundException);
  });

  it('an admin whose header pins farm X opens a requisition of farm Y — read under farm Y', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[REQ], [{ req: { ...REQ, req_no: 'REQ-Y-2026-00001' }, farm_code: 'Y', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[{ line: { line_id: 'L1', quantity: '6000.0000', feed_type: 'BULK' }, item_code: 'R1', item_name: 'R1', destination_code: 'Y/SILO-1' }]]],
    ]);
    const { service, forecast, log, cls } = setup([], queues);
    forecast.resolveFarm.mockResolvedValueOnce({ farmId: 'farm-y', companyId: 'co-1' });
    // The workspace switcher pinned farm X; withFarmScope must override it for the read.
    const view = await cls.run(async () => {
      cls.set(FARM_SCOPE_KEY, { farmId: 'farm-x', companyId: 'co-1', restricted: false, lobId: null });
      return service.findOne('req-1', 'tenant-1', { userType: 'COMPANY_ADMIN' });
    });
    expect(view).toMatchObject({ req_no: 'REQ-Y-2026-00001', farm_code: 'Y', farm_total_requested_kg: 6000, truck_trips: 1 });
    expect(forecast.withFarmScope).toHaveBeenCalledWith('farm-y', 'co-1', expect.any(Function));
    const read = log.filter((e) => e.op === 'select' && e.table === schema.requisition)[1];
    expect(render(read.where).params).toContain('farm-y');
    expect(render(read.where).params).not.toContain('farm-x');
  });
});

describe('FeedRequisitionService.createManual — row 9 across the cycle, numbering clash', () => {
  const manualLine = { destination_location_id: 'silo-1', item_id: 'item-r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-30' };
  const ITEM = { item_id: 'item-r1', item_name: 'Weaner Diet R1' };
  const year = serverToday().slice(0, 4);
  const queuesWith = (cycle: unknown[], lines: unknown[]) => new Map<unknown, unknown[][]>([
    [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
    [schema.itemMaster, [[ITEM]]],
    [schema.requisition, [cycle, [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
    [schema.requisitionLine, [lines, []]],
    [schema.reasonMaster, [[{ reason_id: 'reason-1', reason_code: 'REQ-01', reason_name: 'Diet exception', is_active: true }]]],
    [schema.userMaster, [[{ user_id: 'u-1', full_name: 'Requesting User', department_id: 'dept-1' }]]],
  ]);
  const line = (over: object) => ({ line_id: 'AL1', requisition_id: 'auto-1', dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: false, ...over });
  const run = (service: FeedRequisitionService) => service.createManual({ lines: [manualLine] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

  it.each([
    ['an APPROVED requisition', { requisition_id: 'r-9', req_no: 'REQ-GRS-2026-00009', status: 'APPROVED', requisition_type: 'FEED_FORECAST' }, {}],
    ['another manual requisition', { requisition_id: 'r-9', req_no: 'REQ-GRS-2026-00009', status: 'DRAFT', requisition_type: 'MANUAL' }, {}],
    ['a PENDING_APPROVAL requisition', { requisition_id: 'r-9', req_no: 'REQ-GRS-2026-00009', status: 'PENDING_APPROVAL', requisition_type: 'FEED_FORECAST' }, {}],
    ['an AUTO_DRAFT line the farm edited', { requisition_id: 'r-9', req_no: 'REQ-GRS-2026-00009', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }, { edited: true }],
  ])('refuses a silo and item already on %s with 409, writing nothing', async (_label, req, over) => {
    const { service, log } = setup([], queuesWith([req], [line({ requisition_id: 'r-9', ...over })]));
    await expect(run(service)).rejects.toThrow(new ConflictException(
      'GRS/SILO-001 already has Weaner Diet R1 on requisition REQ-GRS-2026-00009 (' + (req as any).status + ') this cycle — change that line instead.'));
    expect(log.filter((e) => e.op !== 'select')).toEqual([]);
    // The cycle was read under the farm lock, as a locking read, excluding dead requisitions.
    const cycleRead = log.find((e) => e.table === schema.requisition && e.lock === 'update')!;
    expect(cycleRead.inTx).toBe(true);
    expect(render(cycleRead.where).params).toEqual(expect.arrayContaining(['REJECTED', 'CANCELLED']));
  });

  it('dates the cycle from the farm day, not the server day (D16)', async () => {
    const auto = { requisition_id: 'auto-1', req_no: 'REQ-GRS-2026-00001', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' };
    const { service, forecast } = setup([], queuesWith([auto], [line({})]));
    forecast.farmToday.mockResolvedValueOnce({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    await run(service);
    expect(forecast.farmToday).toHaveBeenCalledWith('co-1', 'tenant-1');
  });

  it('snapshots forecast evidence on a manually created line while keeping the four user inputs authoritative', async () => {
    const { service, log } = setup([source()], queuesWith([], []));
    await run(service);
    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(header.values).toMatchObject({
      doc_type: 'FEED', source: 'MANUAL_ENTRY', priority: 'CRITICAL_FIRST_PRIORITY',
      requester_user_id: 'u-1', requester_name: 'Requesting User', requester_department_id: 'dept-1',
    });
    const inserted = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    expect(inserted.values[0]).toMatchObject({
      destination_location_id: 'silo-1', item_id: 'item-r1', quantity: '3000', proposed_delivery_date: '2026-09-30',
      system_balance_kg: '1500', daily_requirement_kg: '2000', days_remaining: '0', lifecycle_ref_id: 'row-r1',
      unrounded_need_kg: '4500', recommended_qty_kg: '6000', is_next_diet: false,
    });
  });

  it('stores the active company Reason Master identity on a manual feed line', async () => {
    const { service, log } = setup([source()], queuesWith([], []));
    await service.createManual({ lines: [{ ...manualLine, reason_id: 'reason-1' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const inserted = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    expect(inserted.values[0]).toMatchObject({ reason_id: 'reason-1' });
  });

  it('numbers into the new year when the farm zone has already turned (31 Dec 23:00 UTC, Africa/Harare) (D16)', async () => {
    // 31 Dec 2026 23:00 UTC is 1 Jan 2027 01:00 in Harare (UTC+2) — the req_no
    // year must follow the farm's day, not the server's still-2026 one.
    const ms = Date.UTC(2026, 11, 31, 23, 0);
    const farmDay = todayInZone('Africa/Harare', ms);
    expect(farmDay).toBe('2027-01-01'); // sanity check on the fixture itself
    const auto = { requisition_id: 'auto-1', req_no: 'REQ-GRS-2026-00001', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' };
    const { service, forecast, log } = setup([], queuesWith([auto], [line({})]));
    forecast.farmToday.mockResolvedValueOnce({ today: farmDay, timeZone: 'Africa/Harare' });
    await run(service);
    const insert = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(insert.values.req_no).toBe('REQ-GRS-2027-00001');
  });

  it("supersedes an untouched AUTO_DRAFT line: removes it, drops the emptied draft, and writes the manual requisition", async () => {
    const auto = { requisition_id: 'auto-1', req_no: 'REQ-GRS-2026-00001', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' };
    const { service, log } = setup([], queuesWith([auto], [line({})]));
    await run(service);
    const writes = log.filter((e) => e.op !== 'select');
    expect(writes.every((e) => e.inTx)).toBe(true);
    expect(render(writes.find((e) => e.op === 'delete' && e.table === schema.requisitionLine)!.where).params).toEqual(['AL1']);
    const dropped = writes.find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(dropped.set).toHaveProperty('deleted_at');
    expect(render(dropped.where).params).toEqual(['auto-1']);
    expect(writes.find((e) => e.op === 'insert' && e.table === schema.requisition)!.values).toMatchObject({ status: 'DRAFT', requisition_type: 'MANUAL' });
  });

  it('keeps the draft when it still has other lines', async () => {
    const auto = { requisition_id: 'auto-1', req_no: 'REQ-GRS-2026-00001', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' };
    const { service, log } = setup([], queuesWith([auto], [line({}), line({ line_id: 'AL2', dest: 'silo-2', item: 'item-r2' })]));
    await run(service);
    expect(render(log.find((e) => e.op === 'delete')!.where).params).toEqual(['AL1']);
    expect(log.some((e) => e.op === 'update' && e.table === schema.requisition)).toBe(false);
  });

  const dupEntry = () => Object.assign(new Error('Failed query'), { cause: Object.assign(new Error("Duplicate entry 'REQ-GRS' for key 'req_no'"), { code: 'ER_DUP_ENTRY', errno: 1062 }) });

  it('runs the numbering transaction once more when req_no clashed with another farm of the same code', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }], [{ location_id: 'farm-grs' }]]],
      [schema.itemMaster, [[ITEM]]],
      [schema.requisition, [[], [{ req_no: `REQ-GRS-${year}-00041` }], [], [{ req_no: `REQ-GRS-${year}-00042` }], [{ req: { requisition_id: 'new' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[]]],
    ]);
    const { service, log, db } = setup([], queues);
    const insert = db.insert.getMockImplementation();
    let first = true;
    db.insert.mockImplementation((t: unknown) => {
      if (t === schema.requisition && first) { first = false; return { values: jest.fn(async () => { throw dupEntry(); }) }; }
      return insert(t);
    });
    await run(service);
    const header = log.find((e) => e.op === 'insert' && e.table === schema.requisition)!;
    expect(header.values.req_no).toBe(`REQ-GRS-${year}-00043`);
    expect(log.filter((e) => e.table === schema.locationMaster && e.lock === 'update')).toHaveLength(2);
  });

  it('answers 409 when the retry clashes too (deadlock), and does not retry other failures', async () => {
    const deadlock = () => Object.assign(new Error('Failed query'), { cause: { code: 'ER_LOCK_DEADLOCK', errno: 1213 } });
    const twice = queuesWith([], []);
    twice.get(schema.locationMaster)!.push([{ location_id: 'farm-grs' }]); // the retry takes the farm lock again
    const clashing = setup([], twice);
    clashing.db.insert.mockImplementation(() => ({ values: jest.fn(async () => { throw deadlock(); }) }));
    await expect(run(clashing.service)).rejects.toThrow(new ConflictException('Another requisition was numbered at the same moment — try again.'));
    expect(clashing.db.insert).toHaveBeenCalledTimes(2);

    const failing = setup([], queuesWith([], []));
    failing.db.insert.mockImplementation(() => ({ values: jest.fn(async () => { throw new Error('connection lost'); }) }));
    await expect(run(failing.service)).rejects.toThrow('connection lost');
    expect(failing.db.insert).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Task 9 — the requisition as a document: per batch/house breakdown under each
// silo/item order line (B1), Days Remaining to one decimal (B2), item and
// destination changes on a line (Req. row 13, cp. 4), and the header view.

describe('FeedRequisitionService.autoDraft — batch/house breakdown (B1) and one-decimal Days Remaining (B2)', () => {
  const twoBatches = () => [
    forecastDaily(),
    forecastDaily({ batchId: 'batch-2', realBatchId: 'batch-2', batchNo: 'BATCH-2', shedId: 'shed-2', shedCode: 'SHED-2', heads: 500, feedRateKg: 2, demandKg: 1000 }),
  ];

  it('first run: one breakdown row per (batch, house) of the line, written with the line it belongs to', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS' }]]],
    ]);
    const { service, log } = setup([source({ daysLeft: 2.5 })], queues, twoBatches());
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    const lineInsert = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    const lineId = lineInsert.values[0].line_id;
    expect(typeof lineId).toBe('string');
    // B2: Silo Balance row 9 "Displayed to 1 decimal" — stored as 2.5, not rounded to 3.
    expect(lineInsert.values[0].days_remaining).toBe('2.5');
    const breakdown = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLineBatch)!;
    expect(breakdown.inTx).toBe(true);
    expect(breakdown.values).toEqual([
      expect.objectContaining({ line_id: lineId, batch_id: 'batch-1', shed_id: 'shed-1', heads: 1000, feed_rate_kg: '2', lifecycle_ref_id: 'row-r1', demand_kg: '2000', first_demand_date: serverToday() }),
      expect.objectContaining({ line_id: lineId, batch_id: 'batch-2', shed_id: 'shed-2', heads: 500, feed_rate_kg: '2', lifecycle_ref_id: 'row-r1', demand_kg: '1000', first_demand_date: serverToday() }),
    ]);
  });

  /**
   * D1 (3 Oct, Task 9b): auto-draft 500'd on 7 of 9 demo farms —
   * ER_DATA_TOO_LONG on requisition_line_batch.batch_id. An ANIMAL_WISE/
   * REGISTERED batch's engine id is `<batch_id>:<stageId>` (73 chars), never
   * a batch_header PK. This fixture carries that exact shape — two stage
   * groups of the SAME physical batch feeding the SAME shed — and asserts
   * the insert now writes the genuine (36-char) batch id with its own
   * stage_id, and that the two stages are two rows, not one silently merged.
   */
  it('an animal-wise composite batch id (two stages, one shed) writes the real batch id and stage_id, never the composite, as two rows', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS' }]]],
    ]);
    const animalWiseDaily = [
      forecastDaily({
        batchId: 'batch-9:stage-weaner', realBatchId: 'batch-9', stageId: 'stage-weaner', groupStageId: 'stage-weaner',
        batchNo: 'BATCH-9 · WEANER', heads: 60, demandKg: 120,
      }),
      forecastDaily({
        batchId: 'batch-9:stage-grower', realBatchId: 'batch-9', stageId: 'stage-grower', groupStageId: 'stage-grower',
        batchNo: 'BATCH-9 · GROWER', heads: 40, demandKg: 80,
      }),
    ];
    const { service, log } = setup([source({ daysLeft: 2.5 })], queues, animalWiseDaily);
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    const lineInsert = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLine)!;
    const lineId = lineInsert.values[0].line_id;
    const breakdown = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLineBatch)!;
    expect(breakdown.values).toHaveLength(2);
    // Never the 73-char composite the engine keys its own rows by — always the real 36-char PK.
    expect(breakdown.values.every((v: any) => v.batch_id === 'batch-9')).toBe(true);
    expect(breakdown.values.map((v: any) => v.stage_id).sort()).toEqual(['stage-grower', 'stage-weaner']);
    // buildLineBreakdown sorts by batchNo, so "BATCH-9 · GROWER" sorts before "BATCH-9 · WEANER".
    expect(breakdown.values).toEqual([
      expect.objectContaining({ line_id: lineId, batch_id: 'batch-9', stage_id: 'stage-grower', shed_id: 'shed-1', heads: 40, demand_kg: '80' }),
      expect.objectContaining({ line_id: lineId, batch_id: 'batch-9', stage_id: 'stage-weaner', shed_id: 'shed-1', heads: 60, demand_kg: '120' }),
    ]);
  });

  /**
   * Task 9b fix round 1, finding 1: a stage group projected into ANOTHER
   * group's stage inside the window must still be written under its own
   * identity stage. Before the fix the writer stamped the first-demand day's
   * stage, so group A (origin FLUSH, eating r1 only once in INSEM) and group B
   * (origin INSEM) were both inserted as (batch-9, INSEM, shed-1) — a
   * duplicate on uq_requisition_line_batch, so MySQL refused the insert and
   * auto-draft 500'd.
   */
  it('a stage group projected into another group\'s stage writes two rows with distinct (batch_id, stage_id, shed_id)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[], [], [{ req: { requisition_id: 'new' }, farm_code: 'GRS' }]]],
    ]);
    const daily = [
      forecastDaily({ batchId: 'batch-9:FLUSH', realBatchId: 'batch-9', stageId: 'FLUSH', groupStageId: 'FLUSH', batchNo: 'BATCH-9 · FLUSH',
        itemId: 'item-flush', heads: 10, demandKg: 20 }),
      forecastDaily({ date: addDaysIso(serverToday(), 1), batchId: 'batch-9:FLUSH', realBatchId: 'batch-9', stageId: 'INSEM', groupStageId: 'FLUSH',
        batchNo: 'BATCH-9 · FLUSH', heads: 10, demandKg: 20 }),
      forecastDaily({ batchId: 'batch-9:INSEM', realBatchId: 'batch-9', stageId: 'INSEM', groupStageId: 'INSEM', batchNo: 'BATCH-9 · INSEM',
        heads: 12, demandKg: 24 }),
    ];
    const { service, log, forecast } = setup([source({ daysLeft: 2.5 })], queues, daily);
    // The window must reach tomorrow, the day group A has moved into INSEM.
    const computed = forecast.computeForFarm.getMockImplementation();
    forecast.computeForFarm.mockImplementation(async (...args: unknown[]) => ({ ...(await computed(...args)), to: addDaysIso(serverToday(), 1) }));
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    const breakdown = log.find((e) => e.op === 'insert' && e.table === schema.requisitionLineBatch)!;
    const keys = breakdown.values.map((v: any) => `${v.line_id}|${v.batch_id}|${v.stage_id}|${v.shed_id}`);
    expect(breakdown.values).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(breakdown.values.map((v: any) => [v.batch_id, v.stage_id, v.heads]).sort()).toEqual([
      ['batch-9', 'FLUSH', 10],
      ['batch-9', 'INSEM', 12],
    ]);
  });

  it('rerun replaces a matched line\'s breakdown rows inside the same transaction', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS' }]]],
      [schema.requisitionLine, [[
        { line_id: 'L1', line_seq: 10000, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: false },
      ]]],
    ]);
    const { service, log } = setup([source()], queues, twoBatches());
    await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    const deleted = log.findIndex((e) => e.op === 'delete' && e.table === schema.requisitionLineBatch);
    const inserted = log.findIndex((e) => e.op === 'insert' && e.table === schema.requisitionLineBatch);
    expect(deleted).toBeGreaterThanOrEqual(0);
    expect(render(log[deleted].where).params).toEqual(['L1']);
    expect(inserted).toBeGreaterThan(deleted);
    expect(log[inserted].values.map((v: any) => [v.line_id, v.batch_id])).toEqual([['L1', 'batch-1'], ['L1', 'batch-2']]);
    expect(log[deleted].inTx && log[inserted].inTx).toBe(true);
  });
});

describe('FeedRequisitionService.update — item and destination changes (Req. row 13, checkpoint 4)', () => {
  const OWN = { farm_id: 'farm-grs', company_id: 'co-1' };
  const OPEN_ROW = { requisition_id: 'req-1', req_no: 'REQ-GRS-2026-00041', status: 'AUTO_DRAFT', approval_request_id: null, remarks: null };
  const LINE = {
    line_id: 'L1', line_seq: 10000, item_id: 'item-r1', destination_location_id: 'silo-1', lifecycle_ref_id: 'row-r1',
    description: 'Weaner Diet R1', feed_type: 'BULK', quantity: '6000.0000',
  };
  const SILO_2 = { ...SILO_ROW, location_id: 'silo-2', location_code: 'GRS/SILO-002' };
  const queuesFor = () => new Map<unknown, unknown[][]>([
    [schema.requisition, [[OWN], [OPEN_ROW], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS' }]]],
    [schema.locationMaster, [[FARM_ROW], [SILO_2]]],
    [schema.requisitionLine, [[LINE], []]],
    [schema.breedLifecycleStages, [[{ feed_item_id: 'item-r1' }]]],
    [schema.itemMaster, [[{ item_id: 'item-r2', item_name: 'Weaner Diet R2' }]]],
  ]);

  it('refuses an item the lifecycle does not require without an exception reason, writing nothing', async () => {
    const { service, log, siloFeed } = setup([], queuesFor());
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-2', null]]));
    await expect(service.update('req-1', { lines: [{ line_id: 'L1', item_id: 'item-r2', destination_location_id: 'silo-2' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Line 10000: Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).'));
    expect(log.filter((e) => e.op !== 'select')).toEqual([]);
  });

  it('with a reason: moves the line, stores the reason in description, and makes the line the farm\'s own', async () => {
    const { service, log, siloFeed } = setup([], queuesFor());
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-2', null]]));
    await service.update('req-1', { lines: [{ line_id: 'L1', item_id: 'item-r2', destination_location_id: 'silo-2', exception_reason: 'Vet instruction' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(siloFeed.currentItems).toHaveBeenCalledWith(['silo-2'], 'co-1', 'tenant-1');
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    expect(lineUpdate.set).toMatchObject({
      item_id: 'item-r2', destination_location_id: 'silo-2', source_type: 'SILO', feed_type: 'BULK',
      description: 'Exception: Vet instruction', quantity_edited: true,
    });
  });

  it('a destination-only change blanks the old silo\'s forecast-derived columns rather than carrying them over (review finding: stale exceeds_silo_capacity hid a real warning; M5: recommended_delivery_date blanks with its six siblings)', async () => {
    const { service, log, siloFeed } = setup([], queuesFor());
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-2', null]]));
    await service.update('req-1', { lines: [{ line_id: 'L1', destination_location_id: 'silo-2' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    expect(lineUpdate.set).toMatchObject({
      destination_location_id: 'silo-2',
      system_balance_kg: null, daily_requirement_kg: null, days_remaining: null,
      first_shortage_date: null, recommended_qty_kg: null, unrounded_need_kg: null,
      exceeds_silo_capacity: false,
      // M5: left in place, deliveryDateNeedsRemarks would keep comparing a date the
      // farm proposes now against the OLD (destination, item) pair's recommendation.
      recommended_delivery_date: null,
    });
  });

  it('refuses a silo that still holds another feed with stock (checkpoint 4)', async () => {
    const queues = queuesFor();
    const { service, log, siloFeed } = setup([], queues);
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-2', { item_id: 'item-r9', on_hand_qty: 1500 }]]));
    await expect(service.update('req-1', { lines: [{ line_id: 'L1', destination_location_id: 'silo-2' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Line 10000: Silo holds another feed with stock: choose a silo holding this item or an empty one (checkpoint 4).'));
    expect(log.filter((e) => e.op !== 'select')).toEqual([]);
  });

  it('refuses a move into a silo another line of this requisition already targets with a different item (two feeds in one silo, checkpoint 4)', async () => {
    const queues = queuesFor();
    queues.set(schema.requisitionLine, [[LINE], [{ line_seq: 20000, item_id: 'item-r9' }]]);
    const { service, log, siloFeed } = setup([], queues);
    siloFeed.currentItems.mockResolvedValueOnce(new Map([['silo-2', null]]));
    await expect(service.update('req-1', { lines: [{ line_id: 'L1', destination_location_id: 'silo-2' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Line 10000: GRS/SILO-002 already receives a different feed on line 20000; a silo cannot hold two feeds at once (checkpoint 4).'));
    expect(log.filter((e) => e.op !== 'select')).toEqual([]);
  });

  it('refuses a destination that is not an active silo or store of the farm', async () => {
    const queues = queuesFor();
    queues.set(schema.locationMaster, [[FARM_ROW], [{ ...SILO_2, farm_id: 'farm-other' }]]);
    const { service } = setup([], queues);
    await expect(service.update('req-1', { lines: [{ line_id: 'L1', destination_location_id: 'silo-2' }] } as any, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow(BadRequestException);
  });
});

describe('FeedRequisitionService view — the document header and line display fields (Req. §1, §2)', () => {
  it('returns the workbook header and each line with its codes, lifecycle row label and breakdown', async () => {
    const REQ = { requisition_id: 'req-1', farm_id: 'farm-grs', company_id: 'co-1' };
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[REQ], [{
        req: {
          ...REQ, req_no: 'REQ-GRS-2026-00041', requisition_date: null, created_at: '2026-09-23 06:00:00', required_date: '2026-09-23',
          approved_by: 'u-9', approved_at: '2026-09-23 09:30:00', linked_transfer_id: null, feed_forecast_run_id: 'run-1', forecast_run_key: 'FFR-farm-grs-000001',
        },
        farm_code: 'GRS', farm_name: 'Green Ridge', approved_by_name: 'Mill Manager', linked_transfer_no: null, forecast_run_no: 'FFR-farm-grs-000001',
      }]]],
      [schema.requisitionLine, [[
        { line: { line_id: 'L1', line_seq: 10000, quantity: '6000.0000', feed_type: 'BULK', is_next_diet: false, description: 'Weaner Diet R1', days_remaining: '0.8' },
          item_code: 'R1', item_name: 'Weaner Diet R1', destination_code: 'GRS/SILO-001', destination_name: 'Weaner silo', required_item_id: 'item-r1',
          breed_code: 'L-LINE', stage_code: 'WEANER', period_from: 21, period_to: 24, calc_unit: 'DAY' },
        { line: { line_id: 'L2', line_seq: 20000, quantity: '9000.0000', feed_type: 'BULK', is_next_diet: true, description: 'Exception: Vet instruction', days_remaining: null },
          item_code: 'R2', item_name: 'Weaner Diet R2', destination_code: 'GRS/SILO-002', required_item_id: 'item-r2',
          breed_code: 'L-LINE', stage_code: 'WEANER', period_from: 25, period_to: 27, calc_unit: 'DAY' },
      ]]],
      [schema.requisitionLineBatch, [[
        { line_id: 'L2', batch_id: 'b1', batch_no: 'B-001', stage_id: 'st-wean', group_stage_code: 'WEANER', group_stage_name: 'Weaner', shed_id: 'h3', shed_code: 'GRS/SHED-003', heads: 1000, feed_rate_kg: '0.500000',
          lifecycle_ref_id: 'lc-r2', demand_kg: '995.0000', first_demand_date: '2026-09-26', breed_code: 'L-LINE', stage_code: 'WEANER', period_from: 25, period_to: 27, calc_unit: 'DAY' },
      ]]],
    ]);
    const { service } = setup([], queues);
    const view: any = await service.findOne('req-1', 'tenant-1', { userType: 'COMPANY_ADMIN' });
    expect(view.header).toEqual({
      farm_code: 'GRS', farm_name: 'Green Ridge', requisition_date: '2026-09-23', is_next_diet_requisition: true,
      farm_total_requested_kg: 15000, truck_target_kg: 30000, bulk_multiple_kg: 3000, bag_size_kg: 50, trips: 1, required_delivery_date: '2026-09-23',
      approved_by_name: 'Mill Manager', linked_transfer_no: null, forecast_run_no: 'FFR-farm-grs-000001', consolidation_no: null, consolidation_status: null, consolidation_next_action: null,
    });
    expect(view.lines[0]).toMatchObject({
      item_code: 'R1', item_description: 'Weaner Diet R1', destination_code: 'GRS/SILO-001', destination_name: 'Weaner silo', lifecycle_ref_label: 'L-LINE WEANER days 21–24',
      required_item_id: 'item-r1', exception_reason: null, breakdown: [],
    });
    expect(view.lines[1]).toMatchObject({
      item_description: 'Weaner Diet R2', lifecycle_ref_label: 'L-LINE WEANER days 25–27', exception_reason: 'Vet instruction',
      // Rishi, 10 Oct: the stage is its own column, resolved from stage_master like batch_no is from batch_header.
      breakdown: [{ batch_id: 'b1', batch_no: 'B-001', stage_id: 'st-wean', stage_code: 'WEANER', stage_name: 'Weaner', shed_id: 'h3', shed_code: 'GRS/SHED-003', heads: 1000, feed_rate_kg: 0.5,
        lifecycle_ref_label: 'L-LINE WEANER days 25–27', demand_kg: 995, first_demand_date: '2026-09-26' }],
    });
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import type { ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import { serverToday } from './feed-requisition.rules';
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
  const service = new FeedRequisitionService(transactionCls(db), forecast, {} as any, { evaluateFarmSafely: jest.fn() } as any);

  it('refuses a destination that is not an active silo or store of the farm', async () => {
    selectQueue.push(
      [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }], // farm
      [{ location_id: 'shed-1', location_code: 'GRS/SHED-003', location_type: 'SHED', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null }],
    );
    await expect(service.createManual({ lines: [{ destination_location_id: 'shed-1', item_id: 'r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' }] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(new BadRequestException('Destination GRS/SHED-003 must be an active silo or store of farm GRS.'));
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses the same silo and item twice on one requisition (Requisition §1 row 9)', async () => {
    const silo = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: null };
    selectQueue.push(
      [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }],
      [silo],
    );
    const line = { destination_location_id: 'silo-1', item_id: 'r1', quantity_kg: 3000, proposed_delivery_date: '2026-09-26' };
    await expect(service.createManual({ lines: [line, { ...line, quantity_kg: 6000 }] } as any, 'tenant-1', { userId: 'u', userType: 'TENANT_ADMIN' }))
      .rejects.toThrow(BadRequestException);
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
  daysLeft: 0, runDownDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['row-r1'], ...over,
});
const FARM_ROW = { location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 };
const SILO_ROW = { location_id: 'silo-1', location_code: 'GRS/SILO-001', location_type: 'SILO', farm_id: 'farm-grs', is_active: true, feed_in_bags: null, low_level_kg: '1500.00' };

function setup(sources: ForecastSource[], queues: Map<unknown, unknown[][]>) {
  // The recorder asks the CLS whether a write is inside the transaction; the CLS needs the recorder's db.
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const evaluated: Array<{ args: unknown[]; inTx: boolean }> = [];
  const forecast: any = {
    resolveFarm: jest.fn(async () => ({ farmId: 'farm-grs', companyId: 'co-1' })),
    withFarmScope: jest.fn((farmId: string, companyId: string, work: () => Promise<unknown>) =>
      cls.run(async () => { cls.set(FARM_SCOPE_KEY, { ...farmScope(cls), farmId, companyId }); return work(); })),
    computeForFarm: jest.fn(async () => ({ planningDate: serverToday(), to: serverToday(), sources, farm: { id: 'farm-grs', code: 'GRS' } })),
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
  };
  const alerts: any = {
    evaluateFarmSafely: jest.fn(async (...args: unknown[]) => { evaluated.push({ args, inTx: cls.get('tenantPostingTransaction') === true }); }),
  };
  const service = new FeedRequisitionService(cls, forecast, {} as any, alerts);
  return { service, log, forecast, alerts, evaluated, cls, db };
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
      line_seq: 1, item_id: 'item-r1', destination_location_id: 'silo-1', quantity: '6000', recommended_qty_kg: '6000',
      unrounded_need_kg: '4500', feed_type: 'BULK', source_type: 'SILO', uom: 'KG', quantity_edited: false,
    })]);

    // The alert evaluation runs once, after the draft's transaction committed.
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('passes every source its destination row from the DB — a source with none fails rather than silently losing its low level (Task 3 carry)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [/* silo-1 row missing */]]],
    ]);
    const { service, log } = setup([source()], queues);
    await expect(service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' })).rejects.toThrow(/GRS\/SILO-001/);
    expect(log.some((e) => e.op === 'insert')).toBe(false);
  });

  it('rerun: updates the cycle\'s one AUTO_DRAFT in place — no second requisition, an edited quantity kept (M9), a stale unedited line removed', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[FARM_ROW], [SILO_ROW], [{ location_id: 'farm-grs' }]]],
      [schema.requisition, [[{ requisition_id: 'req-1', status: 'AUTO_DRAFT', requisition_type: 'FEED_FORECAST' }], [{ req: { requisition_id: 'req-1' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.requisitionLine, [[
        { line_id: 'L1', line_seq: 1, dest: 'silo-1', item: 'item-r1', quantity: '6000.0000', recommended: '6000.0000', edited: true },
        { line_id: 'L2', line_seq: 2, dest: 'silo-9', item: 'item-r9', quantity: '3000.0000', recommended: '3000.0000', edited: false },
      ]]],
    ]);
    const { service, log } = setup([source({ walkDemandKg: 9000 })], queues);
    const out = await service.autoDraft({}, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });
    expect(out).toMatchObject({ requisitionId: 'req-1', created: false, linesDrafted: 1 });

    expect(log.filter((e) => e.op === 'insert')).toEqual([]);
    const lineUpdate = log.find((e) => e.op === 'update' && e.table === schema.requisitionLine)!;
    // Recommendation refreshed to 9,000; the farm's 6,000 kept.
    expect(lineUpdate.set).toMatchObject({ recommended_qty_kg: '9000' });
    expect(lineUpdate.set).not.toHaveProperty('quantity');
    expect(render(lineUpdate.where).params).toEqual(['L1']);
    const removed = log.find((e) => e.op === 'delete' && e.table === schema.requisitionLine)!;
    expect(render(removed.where).params).toEqual(['L2']);
    const header = log.find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({ updated_by: 'u-1' });
    expect(render(header.where).params).toEqual(['req-1']);
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

  it('checks `to` against the farm day, after resolving the farm (D16)', async () => {
    const { service, forecast } = setup([source()], new Map());
    forecast.farmToday.mockResolvedValueOnce({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    await expect(service.autoDraft({ to: '2026-11-11' }, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow('to must be between today and 45 days ahead.');
    expect(forecast.resolveFarm).toHaveBeenCalled();
    expect(forecast.farmToday).toHaveBeenCalledWith('co-1', 'tenant-1');
    expect(forecast.computeForFarm).not.toHaveBeenCalled();
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

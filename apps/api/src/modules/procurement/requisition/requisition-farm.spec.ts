/**
 * P1 follow-up item 5 — a requisition belongs to the farm of its Main / Farm
 * Location.
 *
 * Found in the P1 end-to-end pass (5 Oct, concern 3): area.admin is not tied
 * to a farm, so its RQ-00033 was stored with farm_id NULL although its Main
 * Location was GRA100. The list then showed no farm, and the LOB scope
 * (requisitionFarmLobCondition: a requisition with no farm is every LOB's)
 * let every LOB see it. The farm is now derived on create and on update: the
 * location itself when it is a FARM, otherwise its farm ancestor through
 * parent_location_id.
 *
 * The recording database keys queued rows by table, as
 * requisition.release.spec.ts does.
 */
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { RequisitionService } from './requisition.service';

const NUMBER_SERIES_STUB = { resolveSeriesFor: async () => null, generateNext: async () => { throw new Error('no series configured'); } };

interface Entry { op: string; table: unknown; values?: any; set?: any }

function recordingDb(queues: Map<unknown, unknown[][]>) {
  const log: Entry[] = [];
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self, groupBy: () => self, limit: () => self, for: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v }); } }) })),
    delete: jest.fn((t: unknown) => ({ where: async () => { log.push({ op: 'delete', table: t }); } })),
  };
  return { db, log };
}

/** A caller tied to no farm (area.admin's shape): no farm, company or LOB narrowing. */
const UNPINNED: FarmScope = { farmId: null, companyId: null, restricted: false, lobId: null };
const AREA_ADMIN = { userId: 'u-area', userType: 'OPERATIONAL_ADMIN' };

const loc = (location_id: string, location_type: string, parent_location_id: string | null) => ({ location_id, location_type, parent_location_id });
const FARM = loc('farm-gra', 'FARM', null);
const SHED = loc('shed-1', 'SHED', 'farm-gra');
const PEN = loc('pen-1', 'PEN', 'shed-1');

const HEADER = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: null, req_no: 'RQ-00033', doc_type: 'FA',
  status: 'DRAFT', source: 'MANUAL_ENTRY', purpose: 'PURCHASE', approval_status: 'OPEN', document_status: 'OPEN',
  fulfilment_status: 'NOT_APPLICABLE', integration_status: 'NOT_APPLICABLE', main_location_id: 'farm-gra',
  requisition_date: '2026-10-05', requester_user_id: 'u-area', requester_department_id: null, sender_department_id: null,
  from_location_id: null, to_location_id: null, direct_transfer: false, created_by: 'u-area', deleted_at: null,
};
const FA_LINES = [{ description: 'Water pump', quantity: 1 }];

function setup(queues: Map<unknown, unknown[][]>) {
  const { db, log } = recordingDb(queues);
  const cls: ClsService = transactionCls(db);
  const service = new RequisitionService(cls, { registerDocumentHandler: () => undefined } as any, {} as any, NUMBER_SERIES_STUB as any);
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, UNPINNED); return work(); });
  const header = () => log.find((e) => e.op === 'insert' && e.table === schema.requisition)?.values;
  const headerUpdate = () => log.find((e) => e.op === 'update' && e.table === schema.requisition)?.set;
  return { service, as, header, headerUpdate };
}

const createQueues = (locations: unknown[][]) => new Map<unknown, unknown[][]>([
  [schema.userMaster, [[{ full_name: 'Area Admin', department_id: null, direct_transfer_allowed: false }]]],
  [schema.locationMaster, locations],
  // nextReqNo (no series: last number, clash check), then findOne's read-back.
  [schema.requisition, [[], [], [HEADER]]],
]);

describe('create — the farm comes from the Main / Farm Location', () => {
  it('a main location that is a FARM is the farm', async () => {
    const { service, as, header } = setup(createQueues([[FARM]]));
    await as(() => service.create({ company_id: 'co-1', doc_type: 'FA', purpose: 'PURCHASE', main_location_id: 'farm-gra', lines: FA_LINES } as any, 'tenant-1', AREA_ADMIN));
    expect(header()).toMatchObject({ main_location_id: 'farm-gra', farm_id: 'farm-gra' });
  });

  it('a main location below a farm takes its farm ancestor through parent_location_id', async () => {
    const { service, as, header } = setup(createQueues([[PEN], [SHED], [FARM]]));
    await as(() => service.create({ company_id: 'co-1', doc_type: 'FA', purpose: 'PURCHASE', main_location_id: 'pen-1', lines: FA_LINES } as any, 'tenant-1', AREA_ADMIN));
    expect(header()).toMatchObject({ main_location_id: 'pen-1', farm_id: 'farm-gra' });
  });

  it('a main location with no farm above it leaves the farm empty for an unpinned caller', async () => {
    const { service, as, header } = setup(createQueues([[loc('hq', 'OFFICE', null)]]));
    await as(() => service.create({ company_id: 'co-1', doc_type: 'FA', purpose: 'PURCHASE', main_location_id: 'hq', lines: FA_LINES } as any, 'tenant-1', AREA_ADMIN));
    expect(header()).toMatchObject({ main_location_id: 'hq', farm_id: null });
  });
});

describe('update — the farm follows the Main / Farm Location', () => {
  const updateQueues = (row: Record<string, unknown>, locations: unknown[][]) => new Map<unknown, unknown[][]>([
    [schema.requisition, [[row], [row]]],
    [schema.locationMaster, locations],
  ]);

  it('fills the farm of a row saved without one when its main location is a farm (RQ-00033)', async () => {
    const { service, as, headerUpdate } = setup(updateQueues(HEADER, [[FARM]]));
    await as(() => service.update('req-1', { purpose: 'PURCHASE', lines: FA_LINES } as any, 'tenant-1', AREA_ADMIN));
    expect(headerUpdate()).toMatchObject({ main_location_id: 'farm-gra', farm_id: 'farm-gra' });
  });

  it('moves the farm when the main location moves to another farm', async () => {
    const { service, as, headerUpdate } = setup(updateQueues({ ...HEADER, farm_id: 'farm-gra' }, [[loc('shed-9', 'SHED', 'farm-vil')], [loc('farm-vil', 'FARM', null)]]));
    await as(() => service.update('req-1', { purpose: 'PURCHASE', main_location_id: 'shed-9', lines: FA_LINES } as any, 'tenant-1', AREA_ADMIN));
    expect(headerUpdate()).toMatchObject({ main_location_id: 'shed-9', farm_id: 'farm-vil' });
  });
});

/**
 * WP1c — the Direct Transfer right. Rishi's 4 Oct list: "Direct Transfer
 * (Checkbox — user needs right in User Setup to tick)" and "If Direct
 * Transfer = True: Shipment + Receipt posted together". The right lives on
 * user_master.direct_transfer_allowed (User Setup) and is the ONE source the
 * requisition reads — previously the checkbox was ungated and the direct
 * posting never happened on the requisition side at all (the one-step post
 * existed only on the standalone transfer panel).
 *
 * Harness: requisition.service.spec.ts's per-call select queue.
 */
import { ForbiddenException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { RequisitionService } from './requisition.service';

const TENANT = 'tenant-1';

const NUMBER_SERIES_STUB = { resolveSeriesFor: async () => null, generateNext: async () => { throw new Error('no series configured'); } };

/** A per-call select queue: every db.select() consumes the next row set. */
function makeDb() {
  const selectResults: unknown[][] = [];
  const setCalls: Array<Record<string, unknown>> = [];
  const insertValues: Array<{ table: unknown; values: any }> = [];
  const select = jest.fn(() => {
    const rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for', 'groupBy']) chain[m] = () => chain;
    chain.where = () => chain;
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const insert = jest.fn((table: unknown) => ({
    values: jest.fn(async (values: any) => { insertValues.push({ table, values }); }),
  }));
  const update = jest.fn(() => ({
    set: jest.fn((values: Record<string, unknown>) => {
      setCalls.push(values);
      return { where: jest.fn(async () => undefined) };
    }),
  }));
  const db: any = { select, insert, update, delete: jest.fn() };
  db.transaction = async (work: (tx: any) => Promise<unknown>) => work(db);
  return { db, selectResults, setCalls, insertValues, select };
}

const approvalsMock = () => ({ create: jest.fn(), approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn() });

const storeDto = (over: Record<string, unknown> = {}) => ({
  company_id: 'co-1',
  doc_type: 'ITEM',
  purpose: 'STORE',
  from_location_id: 'loc-store',
  to_location_id: 'loc-farm',
  lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG' }],
  ...over,
});

const headerRow = (over: Record<string, unknown> = {}) => ({
  requisition_id: 'req-1', tenant_id: TENANT, company_id: 'co-1', farm_id: null,
  req_no: 'REQ-2026-0001', doc_type: 'ITEM', status: 'DRAFT', required_date: null,
  justification: null, approval_request_id: null, linked_po_no: null,
  requisition_type: null, source: null, purpose: 'STORE', supply_source: null,
  priority: null, forecast_run_key: null, feed_forecast_run_id: null,
  production_date: null, submission_deadline: null, remarks: null,
  approved_by: null, approved_at: null, created_by: 'u1', updated_by: null,
  created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00', deleted_at: null,
  requisition_date: '2026-10-01', main_location_id: 'farm-1',
  requester_user_id: 'u1', requester_name: 'Ada Farm',
  requester_department_id: null, sender_department_id: null,
  approval_status: 'OPEN', document_status: 'OPEN',
  fulfilment_status: 'NOT_APPLICABLE', integration_status: 'NOT_APPLICABLE',
  from_location_id: 'loc-store', to_location_id: 'loc-farm',
  direct_transfer: false, released_by: null, released_at: null,
  ...over,
});

const lineRow = (over: Record<string, unknown> = {}) => ({
  line_id: 'line-1', line_seq: 1, item_id: 'item-1', resource_id: null,
  description: null, quantity: '10.0000', uom: 'KG', est_rate: null,
  item_code: 'FDT-001', item_name: 'Grower ration',
  from_location_id: 'loc-store', to_location_id: 'loc-farm',
  qty_to_ship: '10.0000', qty_shipped: null, qty_to_receive: '10.0000', qty_received: null,
  ...over,
});

describe('WP1c — the Direct Transfer checkbox needs the User Setup right', () => {
  it('refuses a create with direct_transfer=true from a user without the right, before any insert', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push([{ full_name: 'Ada', department_id: null, direct_transfer_allowed: false }]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, { create: jest.fn() } as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto({ direct_transfer: true }) as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow(new ForbiddenException('Direct Transfer requires the Direct Transfer right (User Setup).'));
    expect(insertValues).toHaveLength(0);
  });

  it('stores direct_transfer=true for a user who carries the right', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada', department_id: null, direct_transfer_allowed: true }], // the requesting user, with the right
      [{ item_id: 'item-1' }],                                                    // line items belong to the company
      [],                                                                         // number series fallback: no prior REQ
      [],                                                                         // number clash lookup
      [headerRow({ direct_transfer: true })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, { create: jest.fn() } as any, NUMBER_SERIES_STUB as any);
    await service.create(storeDto({ direct_transfer: true }) as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values).toMatchObject({ direct_transfer: true });
  });

  it('refuses an update that turns direct_transfer on without the right', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow()],                                                              // the locked row
      [{ user_id: 'u1', direct_transfer_allowed: false }],                        // the caller has no right
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, { create: jest.fn() } as any, NUMBER_SERIES_STUB as any);
    await expect(service.update('req-1', storeDto({ direct_transfer: true }) as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow(ForbiddenException);
  });
});

describe('WP1c — options carries the caller\'s Direct Transfer right', () => {
  const queuesFor = (flag: boolean) => [
    [{ item_id: 'i1', item_code: 'IT-1', item_name: 'Item', uom_primary: 'KG' }],
    [],
    [{ location_id: 'loc-1', location_code: 'STR', location_name: 'Store', location_type: 'STORE', farm_id: null }],
    [{ cost_center_id: 'cc-1', cost_center_code: 'DEP', cost_center_name: 'Dep' }],
    [{ user_id: 'u1', direct_transfer_allowed: flag }],
  ];

  it('reports may_direct_transfer=true only for a user with the right', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(...queuesFor(true));
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, { create: jest.fn() } as any, NUMBER_SERIES_STUB as any);
    const result = await service.options({ company_id: 'co-1' } as any, TENANT, { userId: 'u1', userType: 'STANDARD_USER' });
    expect(result.may_direct_transfer).toBe(true);
  });

  it('reports may_direct_transfer=false without the right', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(...queuesFor(false));
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, { create: jest.fn() } as any, NUMBER_SERIES_STUB as any);
    const result = await service.options({ company_id: 'co-1' } as any, TENANT, { userId: 'u1', userType: 'STANDARD_USER' });
    expect(result.may_direct_transfer).toBe(false);
  });
});

describe('WP1c — a direct-transfer requisition ships and receives in one post', () => {
  const RELEASED_ROW = {
    ...headerRow({
      status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED',
      fulfilment_status: 'TRANSFER_OPEN', direct_transfer: true, linked_transfer_id: 'tr-1',
      released_by: 'u1', released_at: '2026-10-01 11:00:00', approved_by: 'u-approver', approved_at: '2026-10-01 10:30:00',
    }),
  };
  const VIEW = { ...RELEASED_ROW, lines: [lineRow()], shipments: [] };

  function shipSetup(over: { fromDepartmentId?: string | null; userDepartmentId?: string | null } = {}) {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [RELEASED_ROW],                                                              // releasedStore's lock
      [{ line_id: 'tl-1', requisition_line_id: 'line-1' }],                        // releasedStore's transfer lines
      [{ location_id: 'loc-store', department_id: over.fromDepartmentId ?? 'cc-1' }], // the From location's dimension
      [{ user_id: 'u1', department_id: over.userDepartmentId ?? 'cc-1' }],         // the caller's department
      [VIEW],                                                                       // findOne read-back
      [lineRow()],
      [],
      [],
      [{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }],
      [],
      [],
    );
    const cls = transactionCls(db);
    const stockTransfers = {
      postShipment: jest.fn().mockResolvedValue({ shipment_id: 'sh-1' }),
      postReceipt: jest.fn().mockResolvedValue({ receipt_id: 'rc-1' }),
      postDirectTransfer: jest.fn().mockResolvedValue({ transfer_id: 'tr-1' }),
    };
    const service = new RequisitionService(cls, approvalsMock() as any, stockTransfers as any, NUMBER_SERIES_STUB as any);
    return { service, stockTransfers };
  }

  it('routes the shipment through the one-step direct post', async () => {
    const { service, stockTransfers } = shipSetup();
    await service.ship('req-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 10 }] } as any, TENANT, { userId: 'u1' });
    expect(stockTransfers.postDirectTransfer).toHaveBeenCalledTimes(1);
    expect(stockTransfers.postDirectTransfer).toHaveBeenCalledWith('tr-1',
      { posting_date: '2026-10-02', lines: [{ line_id: 'tl-1', quantity: 10 }] },
      TENANT, { userId: 'u1' });
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('still enforces the From department check on the direct post (no admin bypass)', async () => {
    const { service, stockTransfers } = shipSetup({ fromDepartmentId: 'cc-store', userDepartmentId: 'cc-other' });
    await expect(service.ship('req-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 10 }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow(ForbiddenException);
    expect(stockTransfers.postDirectTransfer).not.toHaveBeenCalled();
  });
});

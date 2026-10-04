/**
 * Task 8 — common requisition service: the supplied header/line fields, the
 * department identities, and the compatibility promise that existing FEED rows
 * and old `status` response values keep working while the three new state
 * dimensions are projected on read.
 *
 * Rule failures must fail before a single query; read compatibility is checked
 * against rows exactly as the legacy writer left them (new columns null).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { RequisitionService } from './requisition.service';
import { useFarmScope } from '../../../test-utils/transaction-cls';

const TENANT = 'tenant-1';

/** No requisition series configured: numbering falls back to REQ-YYYY-NNNN. */
const NUMBER_SERIES_STUB = { resolveSeriesFor: async () => null, generateNext: async () => { throw new Error('no series configured'); } };


/** A per-call select queue: every db.select() consumes the next row set. */
function makeDb() {
  const selectResults: unknown[][] = [];
  const setCalls: Array<Record<string, unknown>> = [];
  const insertValues: Array<{ table: unknown; values: any }> = [];
  const whereCalls: unknown[] = [];
  const select = jest.fn(() => {
    const rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for', 'groupBy']) chain[m] = () => chain;
    chain.where = (condition: unknown) => { whereCalls.push(condition); return chain; };
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
  return { db, selectResults, setCalls, insertValues, select, insert, update, whereCalls };
}

const approvalsMock = () => ({ create: jest.fn(), approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn() });

// Part E: RequisitionService's constructor now requires a StockTransferService
// (not @Optional() — see requisition.service.ts). None of the cases in this
// file exercise Store release, so a stub that is never called is enough.
const STOCK_TRANSFERS_STUB = { create: jest.fn() };

const departmentRow = (id: string, over: Record<string, unknown> = {}) => ({
  cost_center_id: id, tenant_id: TENANT, company_id: 'co-1',
  cost_center_type: 'DEPARTMENT', is_active: true, deleted_at: null, ...over,
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
  from_location_id: null, to_location_id: null,
  direct_transfer: false, released_by: null, released_at: null,
  ...over,
});

const lineRow = (over: Record<string, unknown> = {}) => ({
  line_id: 'line-1', line_seq: 1, item_id: 'item-1', resource_id: null,
  description: null, quantity: '10.0000', uom: 'KG', est_rate: null,
  item_code: 'FDT-001', item_name: 'Grower ration',
  from_location_id: null, to_location_id: null,
  qty_to_ship: null, qty_shipped: null, qty_to_receive: null, qty_received: null,
  ...over,
});

const storeDto = (over: Record<string, unknown> = {}) => ({
  company_id: 'co-1',
  doc_type: 'ITEM',
  purpose: 'STORE',
  from_location_id: 'loc-store',
  to_location_id: 'loc-farm',
  lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG' }],
  ...over,
});

describe('RequisitionService.create — the specification refuses the document before any query', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['an omitted purpose', storeDto({ purpose: undefined }), 'A common requisition needs a purpose: STORE or PURCHASE.'],
    ['a non-spec purpose value', storeDto({ purpose: 'INTERNAL_TRANSFER' }), 'A common requisition needs a purpose: STORE or PURCHASE.'],
    ['Store on a Service requisition', storeDto({ doc_type: 'SERVICE', lines: [{ resource_id: 'res-1', quantity: 1, uom: 'HR' }] }),
      'Store applies only to Item requisitions; Fixed Asset and Service use Purchase.'],
    ['an Item line with no Item Master item', storeDto({ lines: [{ description: 'Bolts', quantity: 1, uom: 'EA' }] }),
      'Requisition line 1 needs an Item Master item.'],
    ['a Store requisition with no source', storeDto({ from_location_id: undefined }), 'A Store requisition needs a source location.'],
    ['a Store requisition whose source is its destination', storeDto({ to_location_id: 'loc-store' }),
      'The source and destination locations must differ.'],
    ['Direct Transfer on a Purchase requisition',
      storeDto({ doc_type: 'FA', purpose: 'PURCHASE', from_location_id: undefined, to_location_id: undefined, direct_transfer: true, lines: [{ description: 'Tractor', quantity: 1, uom: 'EA' }] }),
      'Direct Transfer applies only to Store Item requisitions.'],
  ];

  it.each(cases)('refuses %s with no database work at all', async (_name, dto, message) => {
    const { db, selectResults, insertValues } = makeDb();
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(dto as any, TENANT, { userId: 'u1' })).rejects.toThrow(BadRequestException);
    await expect(service.create(dto as any, TENANT, { userId: 'u1' })).rejects.toThrow(message);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
    expect(selectResults).toHaveLength(0);
  });
});

describe('RequisitionService.create — supplied header and line fields are stored', () => {
  it('persists date, main location, requester snapshot, departments, purpose, locations and line quantities', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: 'cc-dept' }], // the requesting user
      [departmentRow('cc-dept')],                            // requester department identity
      [departmentRow('cc-snd')],                             // sender department identity
      [{ item_id: 'item-1' }],                               // line items belong to the company
      [],                                                    // number series: no prior REQ this year
      [],                                                    // number clash lookup: 0001 is free
      [headerRow({ requester_department_id: 'cc-dept', sender_department_id: 'cc-snd' })],
      [lineRow({ qty_to_ship: '6', qty_to_receive: '6', from_location_id: 'loc-store', to_location_id: 'loc-farm' })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);

    const result = await service.create(storeDto({
      requisition_date: '2026-10-01',
      main_location_id: 'farm-1',
      requester_department_id: 'cc-dept',
      sender_department_id: 'cc-snd',
      remarks: 'Weekly store pull',
      lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG', qty_to_ship: 6, qty_to_receive: 6 }],
    }) as any, TENANT, { userId: 'u1' });

    expect(insertValues).toHaveLength(2);
    expect(insertValues[0].values).toMatchObject({
      status: 'DRAFT',
      approval_status: 'OPEN',
      document_status: 'OPEN',
      fulfilment_status: 'NOT_APPLICABLE',
      integration_status: 'NOT_APPLICABLE',
      purpose: 'STORE',
      requisition_date: '2026-10-01',
      main_location_id: 'farm-1',
      requester_user_id: 'u1',
      requester_name: 'Ada Farm',
      requester_department_id: 'cc-dept',
      sender_department_id: 'cc-snd',
      from_location_id: 'loc-store',
      to_location_id: 'loc-farm',
      direct_transfer: false,
      remarks: 'Weekly store pull',
    });
    expect(insertValues[1].values[0]).toMatchObject({
      line_seq: 1,
      quantity: '10',
      from_location_id: 'loc-store',
      to_location_id: 'loc-farm',
      qty_to_ship: '6',
      qty_to_receive: '6',
      qty_shipped: null,
      qty_received: null,
    });
    // The read back is projected, not raw.
    expect(result).toMatchObject({ status: 'DRAFT', approval_status: 'OPEN', document_status: 'OPEN' });
    expect(result.lines[0]).toMatchObject({ balance_to_ship: 6, remaining_to_receive: 6 });
  });

  it('takes the requester name and department from the signed-in user when none is supplied', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Rudo Moyo', department_id: 'cc-farm-ops' }],
      [departmentRow('cc-farm-ops')],
      [{ item_id: 'item-1' }], // line items belong to the company
      [], // number series
      [], // number clash lookup
      [headerRow({ requester_name: 'Rudo Moyo', requester_department_id: 'cc-farm-ops' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values).toMatchObject({
      requester_user_id: 'u1',
      requester_name: 'Rudo Moyo',
      requester_department_id: 'cc-farm-ops',
      sender_department_id: null,
    });
  });
});

describe('RequisitionService.create — department identities are Cost Center rows of type DEPARTMENT', () => {
  it('refuses a sender department that is not a DEPARTMENT cost center', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: null }],
      [departmentRow('cc-x', { cost_center_type: 'WAREHOUSE' })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto({ sender_department_id: 'cc-x' }) as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('Sender department must be an active DEPARTMENT cost center of this company.');
    expect(insertValues).toHaveLength(0);
  });

  it('refuses a requester department inherited from the user when it is no longer valid', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: 'cc-gone' }],
      [departmentRow('cc-gone', { is_active: false })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto() as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('Requester department must be an active DEPARTMENT cost center of this company.');
    expect(insertValues).toHaveLength(0);
  });

  it('refuses a department belonging to another company', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: null }],
      [departmentRow('cc-other', { company_id: 'co-2' })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto({ sender_department_id: 'cc-other' }) as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow(BadRequestException);
  });
});

describe('RequisitionService read compatibility — existing FEED rows and old status values', () => {
  it('reads a FEED row exactly as the feed writer left it, with projected states', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({
        requisition_id: 'req-feed', req_no: 'FDR-2026-0007', doc_type: 'FEED',
        status: 'AUTO_DRAFT', purpose: 'INTERNAL_TRANSFER',
        approval_status: null, document_status: null, fulfilment_status: null, integration_status: null,
        direct_transfer: null, requisition_date: null, main_location_id: null,
        requester_user_id: null, requester_name: null, from_location_id: null, to_location_id: null,
      })],
      [lineRow({ quantity: '3000.0000', qty_to_ship: null, qty_to_receive: null })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const result = await service.findOne('req-feed', TENANT);

    expect(result.status).toBe('AUTO_DRAFT');
    expect(result.doc_type).toBe('FEED');
    expect(result.approval_status).toBe('OPEN');
    expect(result.document_status).toBe('OPEN');
    expect(result.fulfilment_status).toBe('NOT_APPLICABLE');
    expect(result.integration_status).toBe('NOT_APPLICABLE');
    expect(result.lines[0]).toMatchObject({
      quantity: '3000.0000',
      qty_to_ship: null,
      qty_shipped: 0,
      qty_to_receive: null,
      qty_received: 0,
      balance_to_ship: 3000,
      remaining_to_receive: 3000,
    });
  });

  it.each([
    ['DRAFT', 'OPEN', 'OPEN'],
    ['PENDING_APPROVAL', 'PENDING_APPROVAL', 'OPEN'],
    ['APPROVED', 'APPROVED', 'APPROVED'],
    ['REJECTED', 'REJECTED', 'OPEN'],
  ])('projects an old %s row to %s / %s without changing the returned status', async (status, approval, document) => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ status, approval_status: null, document_status: null })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const result = await service.findOne('req-1', TENANT);
    expect(result.status).toBe(status);
    expect(result.approval_status).toBe(approval);
    expect(result.document_status).toBe(document);
  });

  it('lists rows with projected states alongside the legacy status column', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([
      {
        requisition_id: 'req-1', req_no: 'REQ-2026-0001', doc_type: 'ITEM', status: 'APPROVED',
        farm_id: null, farm_code: null, required_date: null, approval_request_id: null,
        linked_po_no: null, created_at: '2026-10-01 10:00:00', line_count: 1,
        requisition_date: '2026-10-01',
        approval_status: null, document_status: null, fulfilment_status: null, integration_status: null,
      },
    ]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const [row] = await service.findAll({}, TENANT);
    expect(row.status).toBe('APPROVED');
    expect(row.approval_status).toBe('APPROVED');
    expect(row.document_status).toBe('APPROVED');
    expect(row.fulfilment_status).toBe('NOT_APPLICABLE');
    expect(row.requisition_date).toBe('2026-10-01');
  });
});

describe('RequisitionService.submit and decide — the new states are written beside the legacy one', () => {
  it('submit raises the approval request and sets PENDING_APPROVAL on both dimensions', async () => {
    const { db, selectResults, setCalls } = makeDb();
    const approval = approvalsMock();
    approval.submitFarmDocument = jest.fn(async () => 'ar-1');
    selectResults.push(
      [headerRow({ status: 'DRAFT', approval_status: 'OPEN', document_status: 'OPEN' })], // row lock
      [headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' })], // read back
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approval as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const result = await service.submit('req-1', 'weekly pull', TENANT, { userId: 'u1', email: 'a@example.test', userType: 'STANDARD_USER' });

    expect(approval.submitFarmDocument).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'REQUISITION', documentId: 'req-1' }), TENANT, expect.anything(),
    );
    expect(setCalls[0]).toMatchObject({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' });
    expect(result.approval_status).toBe('PENDING_APPROVAL');
  });

  it('rejecting a legacy pending row records the decision on all three dimensions', async () => {
    const { db, selectResults, setCalls } = makeDb();
    const approval = approvalsMock();
    selectResults.push(
      // A row written before Task 8: status only, new columns null.
      [headerRow({ status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', approval_status: null, document_status: null })],
      [headerRow({ status: 'REJECTED', approval_status: 'REJECTED', document_status: 'OPEN' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approval as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const result = await service.decide('req-1', { rejection_reason: 'Not needed this cycle' }, 'REJECTED', TENANT, { userId: 'u2', userType: 'COMPANY_ADMIN' });

    expect(approval.reject).toHaveBeenCalledWith('ar-1', { rejection_reason: 'Not needed this cycle' }, TENANT, expect.anything());
    expect(setCalls[0]).toMatchObject({ status: 'REJECTED', approval_status: 'REJECTED', document_status: 'OPEN' });
    // The document is correctable again: approval is REJECTED, document back to OPEN.
    expect(result.approval_status).toBe('REJECTED');
    expect(result.document_status).toBe('OPEN');
  });

  it('approving records APPROVED on both dimensions and keeps the legacy status', async () => {
    const { db, selectResults, setCalls } = makeDb();
    const approval = approvalsMock();
    selectResults.push(
      [headerRow({ status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', approval_status: null, document_status: null })],
      [headerRow({ status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approval as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u2', userType: 'COMPANY_ADMIN' });
    expect(approval.approve).toHaveBeenCalledWith('ar-1', TENANT, expect.anything());
    expect(setCalls[0]).toMatchObject({ status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' });
  });
});

describe('Part E Task 1 — list filter, manual source, approver stamp', () => {
  it('stamps a common draft MANUAL_ENTRY so the controller approve route sees it as manual', async () => {
    const { db, selectResults, insertValues } = makeDb();
    selectResults.push(
      [{ full_name: 'Ada Farm', department_id: null }], // requesting user
      [{ item_id: 'item-1' }],                         // line items belong to the company
      [],                                              // number series
      [],                                              // number clash lookup
      [headerRow({ source: 'MANUAL_ENTRY' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values.source).toBe('MANUAL_ENTRY');
  });

  it('refuses the creator on POST /requisition/:id/approve even when source was never written', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: null })]);
    const approvals = approvalsMock();
    const service = new RequisitionService(transactionCls(db), approvals as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow('You may not approve a requisition you created. Another authorized approver must decide it.');
    expect(approvals.approve).not.toHaveBeenCalled();
  });

  it('writes approved_by and approved_at with the decision', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push(
      [headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: 'MANUAL_ENTRY' })], // locked row
      [headerRow({ status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' })],                                       // findOne header
      [lineRow()],                                                                                                                           // findOne lines
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u2', userType: 'COMPANY_ADMIN' });
    expect(setCalls[0]).toMatchObject({ status: 'APPROVED', approved_by: 'u2' });
    expect(String(setCalls[0].approved_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('refuses an unknown doc_type filter before any query', async () => {
    const { db } = makeDb();
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.findAll({ doc_type: 'PIGS' }, TENANT)).rejects.toThrow('doc_type must be one of FEED, ITEM, FA, SERVICE.');
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('Part E Task 1 follow-up — the Approvals-inbox path refuses self-approval', () => {
  it('decideFromApproval refuses the creator of a manual common requisition and never calls the engine', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push([headerRow({
      status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: 'MANUAL_ENTRY',
    })]);
    const approvals: any = { ...approvalsMock(), registerDocumentHandler: jest.fn() };
    const service = new RequisitionService(transactionCls(db), approvals, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    service.onModuleInit();
    const handler = approvals.registerDocumentHandler.mock.calls[0][1];
    const request = { request_id: 'ar-1', document_id: 'req-1', company_id: 'co-1', requested_by: 'u1' };

    await expect(handler.decide(request, 'APPROVED', null, TENANT, { userId: 'u1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(approvals.reject).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(0);
  });
});

describe('Part E Task 2 — PUT /requisition/:id', () => {
  it('replaces the header fields and every line of an Open draft', async () => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push(
      [headerRow()],          // the locked row
      [{ item_id: 'item-1' }], // line items belong to the company
      [headerRow({ remarks: 'Changed' })], // findOne header
      [lineRow({ quantity: '4.0000' })],   // findOne lines
    );
    db.delete = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const result = await service.update('req-1', {
      doc_type: 'ITEM', purpose: 'PURCHASE', remarks: 'Changed',
      lines: [{ item_id: 'item-1', quantity: 4, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({ purpose: 'PURCHASE', remarks: 'Changed', from_location_id: null, to_location_id: null, updated_by: 'u1' });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(insertValues[0].values[0]).toMatchObject({ line_seq: 1, quantity: '4', qty_to_ship: null, qty_to_receive: null });
    expect(result.remarks).toBe('Changed');
  });

  it('refuses a submitted document before writing anything', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push([headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL' })]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.update('req-1', { purpose: 'STORE', from_location_id: 'a', to_location_id: 'b', lines: [{ item_id: 'i', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('can no longer be edited');
    expect(setCalls).toHaveLength(0);
  });

  it('refuses a change of document type', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow()]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.update('req-1', { doc_type: 'FA', purpose: 'PURCHASE', lines: [{ description: 'Pump', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('The document type cannot change; create a new requisition instead.');
  });
});

describe('Part E Task 2 fix round 1 — update writes what it says', () => {
  const del = (db: any) => { db.delete = jest.fn(() => ({ where: jest.fn(async () => undefined) })); };

  it('a Store update writes from/to on the header and the to-ship/to-receive targets on the lines', async () => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push([headerRow()], [{ item_id: 'item-1' }], [headerRow()], [lineRow()]);
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await service.update('req-1', {
      purpose: 'STORE', from_location_id: 'loc-store', to_location_id: 'loc-farm',
      lines: [{ item_id: 'item-1', quantity: 7, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({ purpose: 'STORE', from_location_id: 'loc-store', to_location_id: 'loc-farm' });
    expect(insertValues[0].values[0]).toMatchObject({
      from_location_id: 'loc-store', to_location_id: 'loc-farm', qty_to_ship: '7', qty_to_receive: '7',
    });
  });

  it('keeps main location, requester department, date and purpose when omitted; clears the rest', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push(
      [headerRow({
        purpose: 'STORE', main_location_id: 'farm-9', requester_department_id: 'dep-7', sender_department_id: 'dep-8',
        requisition_date: '2026-09-30', remarks: 'old remark', required_date: '2026-10-09', justification: 'old why', direct_transfer: true,
      })],
      [{ item_id: 'item-1' }],
      [headerRow()], [lineRow()],
    );
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    // purpose, main_location_id, requester_department_id, requisition_date and the
    // cleared fields are all omitted; a Store row still needs its locations.
    await service.update('req-1', {
      from_location_id: 'loc-store', to_location_id: 'loc-farm',
      lines: [{ item_id: 'item-1', quantity: 1, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({
      purpose: 'STORE', main_location_id: 'farm-9', requester_department_id: 'dep-7', requisition_date: '2026-09-30',
      sender_department_id: null, remarks: null, required_date: null, justification: null, direct_transfer: false,
    });
  });

  it.each([
    ['a FEED row', { doc_type: 'FEED' }, 'A feed requisition cannot be edited through /requisition; use /feed-requisition.'],
    ['a released row', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED' }, 'Requisition REQ-2026-0001 can no longer be edited; only an Open requisition can change.'],
  ])('refuses %s and writes nothing', async (_n, over, message) => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push([headerRow(over)]);
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.update('req-1', {
      purpose: 'PURCHASE', lines: [{ item_id: 'item-1', quantity: 1, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' })).rejects.toThrow(message);
    expect(setCalls).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('Part E Task 3 — options and display names', () => {
  it('offers the company items, resources, FARM/STORE/SHED/SILO locations and DEPARTMENT cost centres', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [{ item_id: 'i1', item_code: 'IT-1', item_name: 'Bolts', uom_primary: 'EA' }],
      [{ resource_id: 'r1', resource_code: 'RES-1', resource_name: 'Electrician' }],
      [{ location_id: 'st', location_code: 'F1/STORE', location_name: 'Store', location_type: 'STORE', farm_id: 'f1' }],
      [{ cost_center_id: 'cc', cost_center_code: 'D-1', cost_center_name: 'Stores' }],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const out = await service.options({ company_id: 'co-1' }, TENANT);
    expect(out.items.map((i) => i.item_code)).toEqual(['IT-1']);
    expect(out.resources.map((r) => r.resource_code)).toEqual(['RES-1']);
    expect(out.locations.map((l) => l.location_type)).toEqual(['STORE']);
    expect(out.departments.map((d) => d.cost_center_code)).toEqual(['D-1']);
  });

  it('names the locations, departments, approver and transfer on the document', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ from_location_id: 'st', to_location_id: 'sh', requester_department_id: 'cc-r', sender_department_id: 'cc', approved_by: 'u2', released_by: 'u3', linked_transfer_id: 'tr-1' })],
      [lineRow({ from_location_id: 'st', to_location_id: 'sh', resource_id: 'r1' })],
      [{ location_id: 'st', location_code: 'F1/STORE' }, { location_id: 'sh', location_code: 'F1/SHED-1' }, { location_id: 'farm-1', location_code: 'F1' }],
      [{ cost_center_id: 'cc', cost_center_name: 'Stores' }, { cost_center_id: 'cc-r', cost_center_name: 'Farm Ops' }],
      [{ user_id: 'u2', full_name: 'Approver Two' }, { user_id: 'u3', full_name: 'Releaser Three' }],
      [{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }],
      [{ resource_id: 'r1', resource_code: 'RES-1', resource_name: 'Electrician' }],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const view = await service.findOne('req-1', TENANT);
    expect(view).toMatchObject({ from_location_code: 'F1/STORE', to_location_code: 'F1/SHED-1', main_location_code: 'F1', sender_department_name: 'Stores', approved_by_name: 'Approver Two', released_by_name: 'Releaser Three', requester_department_name: 'Farm Ops', linked_transfer_no: 'TR-000001' });
    expect(view.lines[0]).toMatchObject({ from_location_code: 'F1/STORE', to_location_code: 'F1/SHED-1', resource_code: 'RES-1', resource_name: 'Electrician' });
  });

  /**
   * Fix round 1, Important 2: findOne's shipments block (group by
   * shipment_id, match receipts by shipment_line_id, remaining = shipped -
   * received) had no test exercising real rows — the two new select() calls
   * fell through makeDb()'s `?? []` unexercised by the test above. This
   * supplies one shipment with one line and a partial receipt against it.
   */
  it('reports shipped/received/remaining per shipment line from real shipment and receipt events', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ from_location_id: 'st', to_location_id: 'sh', requester_department_id: 'cc-r', sender_department_id: 'cc', approved_by: 'u2', released_by: 'u3', linked_transfer_id: 'tr-1' })],
      [lineRow({ from_location_id: 'st', to_location_id: 'sh', resource_id: 'r1' })],
      [{ location_id: 'st', location_code: 'F1/STORE' }, { location_id: 'sh', location_code: 'F1/SHED-1' }, { location_id: 'farm-1', location_code: 'F1' }],
      [{ cost_center_id: 'cc', cost_center_name: 'Stores' }, { cost_center_id: 'cc-r', cost_center_name: 'Farm Ops' }],
      [{ user_id: 'u2', full_name: 'Approver Two' }, { user_id: 'u3', full_name: 'Releaser Three' }],
      [{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }],
      [{ resource_id: 'r1', resource_code: 'RES-1', resource_name: 'Electrician' }],
      // shipped: one shipment, one line, shipped 6
      [{ shipment_id: 'sh-1', shipment_no: 'SH-2026-0001', shipment_date: '2026-10-02', shipment_line_id: 'sl-1', requisition_line_id: 'line-1', qty: '6' }],
      // receivedRows: 4 received so far against that shipment line
      [{ shipment_line_id: 'sl-1', qty: '4' }],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    const view = await service.findOne('req-1', TENANT);
    expect(view.shipments).toEqual([
      {
        shipment_id: 'sh-1', shipment_no: 'SH-2026-0001', shipment_date: '2026-10-02',
        lines: [{ requisition_line_id: 'line-1', shipped: 6, received: 4, remaining: 2 }],
      },
    ]);
  });

  it('declares GET options before GET :id so the static route is not captured as an id', () => {
    const { RequisitionController } = require('./requisition.controller');
    const methods = Object.getOwnPropertyNames(RequisitionController.prototype).filter((m) => m !== 'constructor');
    const pathOf = (m: string) => Reflect.getMetadata('path', RequisitionController.prototype[m]);
    expect(pathOf('options')).toBe('options');
    expect(methods.indexOf('options')).toBeLessThan(methods.indexOf('findOne'));
  });
});

describe('Part E Task 3 fix round 1 — company-scoped references and LOB scope', () => {
  it('create refuses a resource that is not an active resource of the requisition company', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([]); // the resource belongs to another company
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto({
      doc_type: 'SERVICE', purpose: 'PURCHASE', from_location_id: undefined, to_location_id: undefined,
      lines: [{ resource_id: 'foreign-res', quantity: 1, uom: 'HR' }],
    }) as any, TENANT, undefined)).rejects.toThrow('Line 1: resource is not an active resource of this company.');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('create refuses an item that is not an active item of the company', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.create(storeDto() as any, TENANT, undefined)).rejects.toThrow('Line 1: item is not an active item of this company.');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('update refuses another company\'s resource and writes nothing', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push([headerRow({ doc_type: 'SERVICE' })], []);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any);
    await expect(service.update('req-1', {
      purpose: 'PURCHASE', lines: [{ resource_id: 'foreign-res', quantity: 1, uom: 'HR' }],
    } as any, TENANT, { userId: 'u1' })).rejects.toThrow(BadRequestException);
    expect(setCalls).toHaveLength(0);
  });

  it('options for a restricted caller filters locations to their LOB or no LOB', async () => {
    const { db, selectResults, whereCalls } = makeDb();
    selectResults.push([], [], [], []);
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' } as any);
    await new RequisitionService(cls, approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any).options({ company_id: 'co-1' }, TENANT);
    const dialect = new MySqlDialect();
    const q = dialect.sqlToQuery(whereCalls[2] as any);
    expect(q.sql).toContain('`lob_id` = ?');
    expect(q.sql).toContain('`lob_id` is null');
    expect(q.params).toContain('lob-pig');
  });

  it('options for an unrestricted caller adds no LOB condition', async () => {
    const { db, selectResults, whereCalls } = makeDb();
    selectResults.push([], [], [], []);
    await new RequisitionService(transactionCls(db), approvalsMock() as any, STOCK_TRANSFERS_STUB as any, NUMBER_SERIES_STUB as any).options({ company_id: 'co-1' }, TENANT);
    expect(new MySqlDialect().sqlToQuery(whereCalls[2] as any).sql).not.toContain('lob_id');
  });
});

describe('Part E Task 7 — ship/receive from the requisition; the lines follow the transfer events', () => {
  it('ship() rejects a requisition that is approved but not released, before touching the transfer service', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow({ purpose: 'STORE', status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' })]);
    const stockTransfers = { postShipment: jest.fn(), postReceipt: jest.fn() };
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, stockTransfers as any, NUMBER_SERIES_STUB as any);
    await expect(service.ship('req-1', { posting_date: '2026-10-04', lines: [{ line_id: 'line-1', quantity: 1 }] } as any, TENANT))
      .rejects.toThrow('Only a released Store requisition ships and receives; release it first.');
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('receive() rejects a Purchase requisition the same way, before touching the transfer service', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow({ purpose: 'PURCHASE', status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED', linked_transfer_id: 'tr-1' })]);
    const stockTransfers = { postShipment: jest.fn(), postReceipt: jest.fn() };
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, stockTransfers as any, NUMBER_SERIES_STUB as any);
    await expect(service.receive('req-1', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 1 }] } as any, TENANT))
      .rejects.toThrow('Only a released Store requisition ships and receives; release it first.');
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('ship() translates the requisition line id to its transfer line id before posting the shipment', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ purpose: 'STORE', status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED', linked_transfer_id: 'tr-1' })],
      [{ line_id: 't1', requisition_line_id: 'line-1' }, { line_id: 't2', requisition_line_id: 'line-2' }],
    );
    const stockTransfers = { postShipment: jest.fn().mockResolvedValue({ shipment_id: 'sh-1' }), postReceipt: jest.fn() };
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, stockTransfers as any, NUMBER_SERIES_STUB as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({ requisition_id: 'req-1' } as any);
    const result = await service.ship('req-1', { posting_date: '2026-10-04', lines: [{ line_id: 'line-2', quantity: 4 }] } as any, TENANT);
    expect(stockTransfers.postShipment).toHaveBeenCalledWith(
      'tr-1', { posting_date: '2026-10-04', lines: [{ line_id: 't2', quantity: 4 }] }, TENANT, undefined,
    );
    expect(result).toEqual({ requisition_id: 'req-1' });
  });

  it('ship() refuses a requisition line the linked transfer does not carry, before calling the transfer service', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push(
      [headerRow({ purpose: 'STORE', status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED', linked_transfer_id: 'tr-1' })],
      [{ line_id: 't1', requisition_line_id: 'line-1' }],
    );
    const stockTransfers = { postShipment: jest.fn(), postReceipt: jest.fn() };
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any, stockTransfers as any, NUMBER_SERIES_STUB as any);
    await expect(service.ship('req-1', { posting_date: '2026-10-04', lines: [{ line_id: 'line-9', quantity: 1 }] } as any, TENANT))
      .rejects.toThrow('Requisition line line-9 is not on the linked transfer.');
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });
});

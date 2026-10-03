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
import { RequisitionService } from './requisition.service';

const TENANT = 'tenant-1';

/** A per-call select queue: every db.select() consumes the next row set. */
function makeDb() {
  const selectResults: unknown[][] = [];
  const setCalls: Array<Record<string, unknown>> = [];
  const insertValues: Array<{ table: unknown; values: any }> = [];
  const select = jest.fn(() => {
    const rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'where', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for']) chain[m] = () => chain;
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
  return { db, selectResults, setCalls, insertValues, select, insert, update };
}

const approvalsMock = () => ({ create: jest.fn(), approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn() });

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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
      [],                                                    // number series: no prior REQ this year
      [headerRow({ requester_department_id: 'cc-dept', sender_department_id: 'cc-snd' })],
      [lineRow({ qty_to_ship: '6', qty_to_receive: '6', from_location_id: 'loc-store', to_location_id: 'loc-farm' })],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);

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
      [], // number series
      [headerRow({ requester_name: 'Rudo Moyo', requester_department_id: 'cc-farm-ops' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approval as any);
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
    const service = new RequisitionService(transactionCls(db), approval as any);
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
    const service = new RequisitionService(transactionCls(db), approval as any);
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
      [],                                              // number series
      [headerRow({ source: 'MANUAL_ENTRY' })],
      [lineRow()],
    );
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values.source).toBe('MANUAL_ENTRY');
  });

  it('refuses the creator on POST /requisition/:id/approve even when source was never written', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', approval_request_id: 'ar-1', source: null })]);
    const approvals = approvalsMock();
    const service = new RequisitionService(transactionCls(db), approvals as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await service.decide('req-1', {}, 'APPROVED', TENANT, { userId: 'u2', userType: 'COMPANY_ADMIN' });
    expect(setCalls[0]).toMatchObject({ status: 'APPROVED', approved_by: 'u2' });
    expect(String(setCalls[0].approved_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('refuses an unknown doc_type filter before any query', async () => {
    const { db } = makeDb();
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvals);
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
      [headerRow({ remarks: 'Changed' })], // findOne header
      [lineRow({ quantity: '4.0000' })],   // findOne lines
    );
    db.delete = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
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
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.update('req-1', { purpose: 'STORE', from_location_id: 'a', to_location_id: 'b', lines: [{ item_id: 'i', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('can no longer be edited');
    expect(setCalls).toHaveLength(0);
  });

  it('refuses a change of document type', async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([headerRow()]);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.update('req-1', { doc_type: 'FA', purpose: 'PURCHASE', lines: [{ description: 'Pump', quantity: 1, uom: 'EA' }] } as any, TENANT, { userId: 'u1' }))
      .rejects.toThrow('The document type cannot change; create a new requisition instead.');
  });
});

describe('Part E Task 2 fix round 1 — update writes what it says', () => {
  const del = (db: any) => { db.delete = jest.fn(() => ({ where: jest.fn(async () => undefined) })); };

  it('a Store update writes from/to on the header and the to-ship/to-receive targets on the lines', async () => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push([headerRow()], [headerRow()], [lineRow()]);
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await service.update('req-1', {
      purpose: 'STORE', from_location_id: 'loc-store', to_location_id: 'loc-farm',
      lines: [{ item_id: 'item-1', quantity: 7, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({ purpose: 'STORE', from_location_id: 'loc-store', to_location_id: 'loc-farm' });
    expect(insertValues[0].values[0]).toMatchObject({
      from_location_id: 'loc-store', to_location_id: 'loc-farm', qty_to_ship: '7', qty_to_receive: '7',
    });
  });

  it('keeps main location, requester department, date and purpose when omitted; clears the sender department', async () => {
    const { db, selectResults, setCalls } = makeDb();
    selectResults.push(
      [headerRow({ main_location_id: 'farm-9', requester_department_id: 'dep-7', sender_department_id: 'dep-8', requisition_date: '2026-09-30' })],
      [headerRow()], [lineRow()],
    );
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await service.update('req-1', {
      purpose: 'PURCHASE', lines: [{ item_id: 'item-1', quantity: 1, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' });
    expect(setCalls[0]).toMatchObject({
      main_location_id: 'farm-9', requester_department_id: 'dep-7', requisition_date: '2026-09-30',
      sender_department_id: null, remarks: null, required_date: null, justification: null, direct_transfer: false,
    });
  });

  it.each([
    ['a FEED row', { doc_type: 'FEED' }],
    ['a released row', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED' }],
  ])('refuses %s and writes nothing', async (_n, over) => {
    const { db, selectResults, setCalls, insertValues } = makeDb();
    selectResults.push([headerRow(over)]);
    del(db);
    const service = new RequisitionService(transactionCls(db), approvalsMock() as any);
    await expect(service.update('req-1', {
      purpose: 'PURCHASE', lines: [{ item_id: 'item-1', quantity: 1, uom: 'KG' }],
    } as any, TENANT, { userId: 'u1' })).rejects.toThrow(BadRequestException);
    expect(setCalls).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

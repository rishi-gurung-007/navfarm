/**
 * Task 13 (controller amendment C1) — the common /requisition API is mounted,
 * which lifts Ruling C2. C2 kept the module unregistered because a FEED
 * requisition could otherwise be approved, released or changed through the
 * generic routes, bypassing the feed rules. Mounting is safe only if every
 * generic mutation refuses a FEED row (400, pointing to /feed-requisition)
 * before it writes anything, and the Approvals-inbox handler this service
 * registers answers only REQUISITION approval requests.
 *
 * Every case loads a FEED row in the state the route would otherwise accept,
 * so the refusal is the FEED guard and not an incidental state check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { RequisitionService, COMMON_REQUISITION_DOC_TYPE } from './requisition.service';
import { FEED_APPROVAL_DOC_TYPE } from '../feed-requisition/feed-requisition.service';

/** No requisition series configured: numbering falls back to REQ-YYYY-NNNN. */
const NUMBER_SERIES_STUB = { resolveSeriesFor: async () => null, generateNext: async () => { throw new Error('no series configured'); } };


const TENANT = 'tenant-1';
const FEED_ROUTE = /\/feed-requisition/;

function makeDb() {
  const selectResults: unknown[][] = [];
  const setCalls: Array<Record<string, unknown>> = [];
  const insertValues: unknown[] = [];
  const select = jest.fn(() => {
    const rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for', 'groupBy', 'where']) chain[m] = () => chain;
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const insert = jest.fn(() => ({ values: jest.fn(async (v: unknown) => { insertValues.push(v); }) }));
  const update = jest.fn(() => ({
    set: jest.fn((values: Record<string, unknown>) => { setCalls.push(values); return { where: jest.fn(async () => undefined) }; }),
  }));
  const db: any = { select, insert, update, delete: jest.fn() };
  db.transaction = async (work: (tx: any) => Promise<unknown>) => work(db);
  return { db, selectResults, setCalls, insertValues };
}

const feedRow = (over: Record<string, unknown> = {}) => ({
  requisition_id: 'req-feed', tenant_id: TENANT, company_id: 'co-1', farm_id: 'farm-1',
  req_no: 'FRQ-2026-0001', doc_type: 'FEED', status: 'DRAFT', required_date: null,
  justification: null, approval_request_id: null, linked_po_no: null,
  requisition_type: 'FEED', source: 'AUTO_FORECAST', purpose: null, supply_source: null,
  approved_by: null, approved_at: null, created_by: 'u1', updated_by: null, deleted_at: null,
  approval_status: null, document_status: null, fulfilment_status: null, integration_status: null,
  from_location_id: null, to_location_id: null, direct_transfer: false,
  sender_department_id: null, linked_transfer_id: null,
  ...over,
});

const ADMIN = { userId: 'u2', userType: 'COMPANY_ADMIN' };

function build() {
  const harness = makeDb();
  const approvals: any = {
    approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn(), registerDocumentHandler: jest.fn(),
  };
  const transfers: any = { create: jest.fn(), postShipment: jest.fn(), postReceipt: jest.fn() };
  const service = new RequisitionService(transactionCls(harness.db), approvals, transfers, NUMBER_SERIES_STUB as any);
  return { ...harness, approvals, transfers, service };
}

type Case = [string, Record<string, unknown>, (s: RequisitionService) => Promise<unknown>];

const cases: Case[] = [
  ['PUT :id', { status: 'DRAFT' },
    (s) => s.update('req-feed', { purpose: 'PURCHASE', lines: [{ item_id: 'i1', quantity: 1, uom: 'KG' }, { item_id: 'i2', quantity: 2, uom: 'KG' }] } as any, TENANT, ADMIN)],
  ['submit', { status: 'DRAFT' }, (s) => s.submit('req-feed', undefined, TENANT, ADMIN)],
  ['approve', { status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' }, (s) => s.decide('req-feed', {}, 'APPROVED', TENANT, ADMIN)],
  ['reject', { status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' },
    (s) => s.decide('req-feed', { rejection_reason: 'no' }, 'REJECTED', TENANT, ADMIN)],
  ['release', { status: 'APPROVED', approval_request_id: 'ar-1' }, (s) => s.release('req-feed', TENANT, ADMIN)],
  ['reopen', { status: 'REJECTED' }, (s) => s.reopen('req-feed', TENANT, ADMIN)],
  ['link-po', { status: 'APPROVED' }, (s) => s.linkPo('req-feed', 'PO-1', TENANT, ADMIN)],
  ['shipment', { status: 'APPROVED', purpose: 'STORE', document_status: 'RELEASED', linked_transfer_id: 'tr-1' },
    (s) => s.ship('req-feed', { posting_date: '2026-10-04', lines: [{ requisition_line_id: 'l1', qty: 1 }, { requisition_line_id: 'l2', qty: 2 }] } as any, TENANT, ADMIN)],
  ['receipt', { status: 'APPROVED', purpose: 'STORE', document_status: 'RELEASED', linked_transfer_id: 'tr-1' },
    (s) => s.receive('req-feed', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ requisition_line_id: 'l1', qty: 1 }, { requisition_line_id: 'l2', qty: 2 }] } as any, TENANT, ADMIN)],
];

describe('Task 13 C1 — every generic mutation refuses a FEED requisition and writes nothing', () => {
  it.each(cases)('%s on a FEED row → 400 pointing to /feed-requisition', async (_route, over, call) => {
    const { service, selectResults, setCalls, insertValues, approvals, transfers } = build();
    // Two copies of the row: whichever load the route makes first sees FEED.
    selectResults.push([feedRow(over)], [feedRow(over)]);
    const outcome = call(service);
    await expect(outcome).rejects.toBeInstanceOf(BadRequestException);
    await expect(outcome).rejects.toThrow(FEED_ROUTE);
    expect(setCalls).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(approvals.reject).not.toHaveBeenCalled();
    expect(approvals.submitFarmDocument).not.toHaveBeenCalled();
    expect(transfers.create).not.toHaveBeenCalled();
    expect(transfers.postShipment).not.toHaveBeenCalled();
    expect(transfers.postReceipt).not.toHaveBeenCalled();
  });

  it('create with doc_type FEED → 400 pointing to /feed-requisition, before any query (not silently made an Item)', async () => {
    const { service, db, insertValues } = build();
    const dto = {
      company_id: 'co-1', doc_type: 'FEED', purpose: 'PURCHASE',
      lines: [{ item_id: 'i1', quantity: 1, uom: 'KG' }, { item_id: 'i2', quantity: 2, uom: 'KG' }],
    };
    const outcome = service.create(dto as any, TENANT, ADMIN);
    await expect(outcome).rejects.toBeInstanceOf(BadRequestException);
    await expect(outcome).rejects.toThrow(FEED_ROUTE);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).toHaveLength(0);
  });
});

describe('Task 13 C1 — the Approvals-inbox handler is the common requisition\'s only', () => {
  it('registers under REQUISITION, never under the feed requisition\'s approval doc type', () => {
    const { service, approvals } = build();
    service.onModuleInit();
    const keys = approvals.registerDocumentHandler.mock.calls.map((c: unknown[]) => c[0]);
    expect(keys).toEqual([COMMON_REQUISITION_DOC_TYPE]);
    expect(COMMON_REQUISITION_DOC_TYPE).toBe('REQUISITION');
    expect(keys).not.toContain(FEED_APPROVAL_DOC_TYPE);
  });

  it.each([['APPROVED'], ['REJECTED']] as const)('a REQUISITION request that points at a FEED row is refused on %s and writes nothing', async (decision) => {
    const { service, approvals, selectResults, setCalls } = build();
    selectResults.push([feedRow({ status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' })]);
    service.onModuleInit();
    const handler = approvals.registerDocumentHandler.mock.calls[0][1];
    const request = { request_id: 'ar-1', document_id: 'req-feed', company_id: 'co-1', requested_by: 'u1' };
    const outcome = handler.decide(request, decision, 'reason', TENANT, ADMIN);
    await expect(outcome).rejects.toBeInstanceOf(BadRequestException);
    await expect(outcome).rejects.toThrow(FEED_ROUTE);
    expect(setCalls).toHaveLength(0);
  });
});

describe('Task 13 C1 — RequisitionModule is mounted beside FeedRequisitionModule without a clash', () => {
  const appModule = readFileSync(join(__dirname, '../../../app.module.ts'), 'utf8');

  it('app.module registers RequisitionModule (Ruling C2 lifted)', () => {
    expect(appModule).toMatch(/import \{ RequisitionModule \} from '\.\/modules\/procurement\/requisition\/requisition\.module'/);
    const imports = appModule.slice(appModule.indexOf('imports: ['), appModule.indexOf('controllers: [SystemController]'));
    expect(imports).toMatch(/^\s*RequisitionModule,\s*$/m);
    expect(imports).toMatch(/^\s*FeedRequisitionModule,\s*$/m);
  });

  it('the two controllers own distinct route prefixes', () => {
    const { RequisitionController } = require('./requisition.controller');
    const { FeedRequisitionController } = require('../feed-requisition/feed-requisition.controller');
    expect(Reflect.getMetadata('path', RequisitionController)).toBe('requisition');
    expect(Reflect.getMetadata('path', FeedRequisitionController)).toBe('feed-requisition');
  });
});

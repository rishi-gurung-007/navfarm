/**
 * Task 13 fix round 1 — mounting /requisition must not open a cross-company
 * hole. A selected company is a boundary for company admins as well
 * (farm-scope.ts, batchReferenceScopeConditions): a caller whose scope is
 * company B must not list, read or change company A's requisitions.
 *
 * The fake database below honours a `requisition.company_id = ?` condition the
 * way MySQL would — a queued row whose company is not the one the query asks
 * for is not returned — so "404 with no write" is the service's own outcome,
 * not something the fixture decided.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { RequisitionService } from './requisition.service';

/** No requisition series configured: numbering falls back to REQ-YYYY-NNNN. */
const NUMBER_SERIES_STUB = { resolveSeriesFor: async () => null, generateNext: async () => { throw new Error('no series configured'); } };


const TENANT = 'tenant-1';
const dialect = new MySqlDialect();

function makeDb() {
  const selectResults: any[][] = [];
  const setCalls: unknown[] = [];
  const insertValues: unknown[] = [];
  const renderedWheres: Array<{ sql: string; params: unknown[] }> = [];
  const select = jest.fn(() => {
    let rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for', 'groupBy']) chain[m] = () => chain;
    chain.where = (condition: any) => {
      const q = condition ? dialect.sqlToQuery(condition) : { sql: '', params: [] };
      renderedWheres.push(q);
      const m = q.sql.match(/`requisition`\.`company_id` = \?/g);
      if (m) {
        // Every positional param before each company_id placeholder; the
        // simplest faithful test: the row's company must be among the params.
        rows = rows.filter((r) => !('company_id' in r) || q.params.includes(r.company_id));
      }
      return chain;
    };
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const update = jest.fn(() => ({ set: jest.fn((v: unknown) => { setCalls.push(v); return { where: jest.fn(async () => undefined) }; }) }));
  const insert = jest.fn(() => ({ values: jest.fn(async (v: unknown) => { insertValues.push(v); }) }));
  const db: any = { select, update, insert, delete: jest.fn() };
  db.transaction = async (work: (tx: any) => Promise<unknown>) => work(db);
  return { db, selectResults, setCalls, insertValues, renderedWheres };
}

/** A row of company A, as the DB holds it. */
const rowOfA = (over: Record<string, unknown> = {}) => ({
  requisition_id: 'req-a', tenant_id: TENANT, company_id: 'co-A', farm_id: null, req_no: 'REQ-2026-0009',
  doc_type: 'ITEM', status: 'DRAFT', purpose: 'PURCHASE', approval_status: 'OPEN', document_status: 'OPEN',
  approval_request_id: null, linked_po_no: null, source: 'MANUAL_ENTRY', created_by: 'u-a', requester_user_id: 'u-a',
  deleted_at: null, ...over,
});

/** A company admin of company B (unrestricted inside their company). */
function serviceForCompanyB() {
  const h = makeDb();
  const cls = transactionCls(h.db);
  useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-B', lobId: null } as any);
  const approvals: any = { approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn(), registerDocumentHandler: jest.fn() };
  const transfers: any = { create: jest.fn(), postShipment: jest.fn(), postReceipt: jest.fn() };
  return { ...h, approvals, transfers, service: new RequisitionService(cls, approvals, transfers, NUMBER_SERIES_STUB as any) };
}

const ADMIN_B = { userId: 'u-b', userType: 'COMPANY_ADMIN' };
const lines2 = [{ description: 'Scale', quantity: 1, uom: 'EA' }, { description: 'Trough', quantity: 2, uom: 'EA' }];

describe('Task 13 fix round 1 — a selected company is a boundary on /requisition', () => {
  it('GET /requisition?company_id=<A> from company B → 403 before any query', async () => {
    const { service, db } = serviceForCompanyB();
    await expect(service.findAll({ company_id: 'co-A' }, TENANT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('GET /requisition with no company_id from company B returns none of A\'s rows', async () => {
    const { service, selectResults, renderedWheres } = serviceForCompanyB();
    selectResults.push([rowOfA(), rowOfA({ requisition_id: 'req-a2', doc_type: 'FEED' })]);
    const rows = await service.findAll({}, TENANT);
    expect(rows).toEqual([]);
    expect(renderedWheres[0].params).toContain('co-B');
  });

  it('GET /requisition/:id of A from company B → 404', async () => {
    const { service, selectResults } = serviceForCompanyB();
    selectResults.push([rowOfA()]);
    await expect(service.findOne('req-a', TENANT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PUT /requisition/:id of A from company B → 404 and nothing written', async () => {
    const { service, selectResults, setCalls, insertValues, db } = serviceForCompanyB();
    selectResults.push([rowOfA()]);
    await expect(service.update('req-a', { purpose: 'PURCHASE', lines: lines2 } as any, TENANT, ADMIN_B)).rejects.toBeInstanceOf(NotFoundException);
    expect(setCalls).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['submit', {}, (s: RequisitionService) => s.submit('req-a', undefined, TENANT, ADMIN_B)],
    ['approve', { status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' }, (s: RequisitionService) => s.decide('req-a', {}, 'APPROVED', TENANT, ADMIN_B)],
    ['release', { status: 'APPROVED', approval_status: 'APPROVED', document_status: 'APPROVED' }, (s: RequisitionService) => s.release('req-a', TENANT, ADMIN_B)],
    ['reopen', { status: 'REJECTED', approval_status: 'REJECTED' }, (s: RequisitionService) => s.reopen('req-a', TENANT, ADMIN_B)],
    ['link-po', { status: 'APPROVED' }, (s: RequisitionService) => s.linkPo('req-a', 'PO-1', TENANT, ADMIN_B)],
    ['shipment', { purpose: 'STORE', status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED', linked_transfer_id: 'tr-1' },
      (s: RequisitionService) => s.ship('req-a', { posting_date: '2026-10-04', lines: [{ requisition_line_id: 'l1', qty: 1 }, { requisition_line_id: 'l2', qty: 1 }] } as any, TENANT, ADMIN_B)],
  ] as const)('%s on A from company B → 404 and nothing written', async (_n, over, call) => {
    const { service, selectResults, setCalls, approvals, transfers } = serviceForCompanyB();
    selectResults.push([rowOfA(over)], [rowOfA(over)]);
    await expect(call(service)).rejects.toBeInstanceOf(NotFoundException);
    expect(setCalls).toHaveLength(0);
    expect(approvals.approve).not.toHaveBeenCalled();
    expect(approvals.submitFarmDocument).not.toHaveBeenCalled();
    expect(transfers.create).not.toHaveBeenCalled();
    expect(transfers.postShipment).not.toHaveBeenCalled();
  });

  it('POST /requisition for company A from company B → 403 before any query', async () => {
    const { service, db } = serviceForCompanyB();
    await expect(service.create({ company_id: 'co-A', doc_type: 'FA', purpose: 'PURCHASE', lines: lines2 } as any, TENANT, ADMIN_B))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('company B still reads its own row', async () => {
    const { service, selectResults } = serviceForCompanyB();
    selectResults.push([rowOfA({ company_id: 'co-B', requisition_id: 'req-b' })], [], [], [], [], []);
    const view: any = await service.findOne('req-b', TENANT);
    expect(view.requisition_id).toBe('req-b');
  });
});

/**
 * P1 e2e (5 Oct): a farm-bound Standard User pressing Save on a new requisition
 * got 404 "Requisition '<id>' not found." — create() wrote farm_id NULL (the
 * dialog sends no farm), then read the row back through scopeConditions(), which
 * keeps only the caller's farm, so the transaction rolled back. A requisition
 * made by a farm-pinned caller belongs to that farm.
 */
describe('P1 e2e — a farm-pinned caller\'s new requisition belongs to its farm', () => {
  function serviceForFarm(farmId: string | null) {
    const h = makeDb();
    const cls = transactionCls(h.db);
    useFarmScope(cls, { farmId, restricted: true, companyId: 'co-B', lobId: 'lob-1' } as any);
    const approvals: any = { approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn(), registerDocumentHandler: jest.fn() };
    const transfers: any = { create: jest.fn(), postShipment: jest.fn(), postReceipt: jest.fn() };
    return { ...h, service: new RequisitionService(cls, approvals, transfers, NUMBER_SERIES_STUB as any) };
  }
  const header = (rows: unknown[]) => rows.find((r: any) => r && typeof r === 'object' && 'req_no' in r) as any;

  it('writes the scope farm when the body names none', async () => {
    const { service, insertValues } = serviceForFarm('farm-gra');
    await service.create({ company_id: 'co-B', doc_type: 'FA', purpose: 'PURCHASE', lines: lines2 } as any, TENANT).catch(() => undefined);
    expect(header(insertValues)?.farm_id).toBe('farm-gra');
  });

  it('keeps a NULL farm for a caller with no farm in scope', async () => {
    const { service, insertValues } = serviceForFarm(null);
    await service.create({ company_id: 'co-B', doc_type: 'FA', purpose: 'PURCHASE', lines: lines2 } as any, TENANT).catch(() => undefined);
    expect(header(insertValues)?.farm_id).toBeNull();
  });
});

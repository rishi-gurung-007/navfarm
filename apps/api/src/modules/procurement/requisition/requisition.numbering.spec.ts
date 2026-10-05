/**
 * Task 16 — a common requisition's number comes from the company's own
 * REQUISITION Number Series (decision 2026-10-01: "Common Purchase and Feed
 * Requisitions use separate company-owned Number Series"). With no series
 * configured the long-standing REQ-YYYY-NNNN stays the fallback; nothing is
 * seeded for the client. Feed numbering belongs to feed-requisition.service.
 */
import { BadRequestException } from '@nestjs/common';
import { MASTER_CODE_COLUMNS } from '../../system/number-series/master-code-columns';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { RequisitionService } from './requisition.service';

const TENANT = 'tenant-1';
const YEAR = new Date().getFullYear();

function makeDb(selectResults: unknown[][]) {
  const insertValues: Array<{ values: any }> = [];
  const select = jest.fn(() => {
    const rows = (selectResults.shift() ?? []) as any[];
    const chain: any = {};
    for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'for', 'groupBy', 'where']) chain[m] = () => chain;
    chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  });
  const insert = jest.fn(() => ({ values: jest.fn(async (values: any) => { insertValues.push({ values }); }) }));
  const db: any = { select, insert, update: jest.fn(), delete: jest.fn() };
  db.transaction = async (work: (tx: any) => Promise<unknown>) => work(db);
  return { db, insertValues, select };
}

const storeDto = () => ({
  company_id: 'co-1', doc_type: 'ITEM', purpose: 'STORE', farm_id: 'farm-1',
  from_location_id: 'loc-store', to_location_id: 'loc-farm',
  lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG' }],
});

const header = (req_no: string) => ({
  requisition_id: 'r', tenant_id: TENANT, company_id: 'co-1', req_no, doc_type: 'ITEM', status: 'DRAFT',
  purpose: 'STORE', approval_status: 'OPEN', document_status: 'OPEN',
  fulfilment_status: 'NOT_APPLICABLE', integration_status: 'NOT_APPLICABLE', direct_transfer: false,
});

/** Selects in create(): requester, the main location's farm, line items, [fallback max req_no], header, lines. */
function build(series: 'configured' | 'none', issued: string[] = ['NUM-0001'], taken: string[] = [], lastOfCompany: string | null = `REQ-${YEAR}-0007`, fallbackClashes: string[] = []) {
  const queue: unknown[][] = [
    [{ full_name: 'Ada', department_id: null }],
    [{ location_id: 'farm-1', location_type: 'FARM', parent_location_id: null }],
    [{ item_id: 'item-1' }],
  ];
  if (series === 'none') {
    queue.push(lastOfCompany ? [{ req_no: lastOfCompany }] : []);
    // tenant-wide clash lookup per candidate (req_no is globally unique)
    for (const n of [...fallbackClashes, null]) queue.push(n ? [{ req_no: n }] : []);
  }
  // req_no is globally unique: one lookup per issued number on the series path.
  if (series === 'configured') for (const n of [...taken, null]) queue.push(n ? [{ req_no: n }] : []);
  queue.push([header('x')], []);
  const { db, insertValues, select } = makeDb(queue);
  const numbers = {
    resolveSeriesFor: jest.fn(async () => (series === 'configured' ? 'REQUISITION' : null)),
    generateNext: jest.fn(async () => issued.shift() as string),
  };
  const approvals = { create: jest.fn(), approve: jest.fn(), reject: jest.fn(), submitFarmDocument: jest.fn() };
  const service = new (RequisitionService as any)(transactionCls(db), approvals, { create: jest.fn() }, numbers) as RequisitionService;
  return { service, numbers, insertValues, db, select };
}

describe('RequisitionService.create — number from the company REQUISITION series', () => {
  it('writes the number the company series issues, inside the create transaction', async () => {
    const { service, numbers, insertValues, db } = build('configured', ['RQ-000042']);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values.req_no).toBe('RQ-000042');
    expect(numbers.resolveSeriesFor).toHaveBeenCalledWith('REQUISITION', null, TENANT, 'co-1', db);
    expect(numbers.generateNext).toHaveBeenCalledWith('REQUISITION', TENANT, 'co-1', db);
  });

  it('two creates in sequence get the two consecutive numbers the series issues', async () => {
    const issued = ['RQ-000001', 'RQ-000002'];
    const a = build('configured', issued);
    await a.service.create(storeDto() as any, TENANT, { userId: 'u1' });
    const b = build('configured', issued);
    await b.service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect([a.insertValues[0].values.req_no, b.insertValues[0].values.req_no]).toEqual(['RQ-000001', 'RQ-000002']);
  });

  it('with no series configured keeps REQ-YYYY-NNNN, continuing the company\'s last number', async () => {
    const { service, numbers, insertValues } = build('none');
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(numbers.generateNext).not.toHaveBeenCalled();
    expect(insertValues[0].values.req_no).toBe(`REQ-${YEAR}-0008`);
  });

  it('refuses a FEED requisition before any numbering (feed owns REQ-<Farm>-YYYY-NNNNN)', async () => {
    const { service, numbers } = build('configured');
    await expect(service.create({ ...storeDto(), doc_type: 'FEED' } as any, TENANT, { userId: 'u1' })).rejects.toThrow(BadRequestException);
    expect(numbers.resolveSeriesFor).not.toHaveBeenCalled();
    expect(numbers.generateNext).not.toHaveBeenCalled();
  });

  it('skips a number already held by another requisition (req_no is unique across the tenant)', async () => {
    const { service, numbers, insertValues } = build('configured', ['REQ-2026-0001', 'REQ-2026-0002'], ['REQ-2026-0001']);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(numbers.generateNext).toHaveBeenCalledTimes(2);
    expect(insertValues[0].values.req_no).toBe('REQ-2026-0002');
  });

  it('offers REQUISITION on the Number Series screen, its code living in requisition.req_no', () => {
    expect(MASTER_CODE_COLUMNS.REQUISITION).toBe('req_no');
  });

  it('fallback never returns a number another company already holds (req_no is unique tenant-wide)', async () => {
    // Company B has no requisition yet; company A holds REQ-<yr>-0001.
    const { service, insertValues } = build('none', [], [], null, [`REQ-${YEAR}-0001`]);
    await service.create(storeDto() as any, TENANT, { userId: 'u1' });
    expect(insertValues[0].values.req_no).toBe(`REQ-${YEAR}-0002`);
  });
});

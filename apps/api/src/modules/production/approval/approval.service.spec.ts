import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ApprovalService } from './approval.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';

/**
 * QueryApprovalDto advertises `limit` and `offset`, and the global
 * ValidationPipe accepts them — but findAll ignored both and returned every
 * matching row. A caller asking for ten got the lot, and the list grew without
 * bound as approvals accumulated.
 */
describe('ApprovalService.findAll pagination', () => {
  let service: ApprovalService;

  const chain = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    for (const fn of Object.values(chain)) (fn as jest.Mock).mockClear();
    chain.select.mockReturnThis();
    chain.from.mockReturnThis();
    chain.leftJoin.mockReturnThis();
    chain.where.mockReturnThis();
    chain.orderBy.mockReturnThis();
    chain.limit.mockReturnThis();
    chain.offset.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(chain) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
  });

  it('applies the requested limit and offset', async () => {
    await service.findAll({ limit: 10, offset: 20 } as never, 'tenant-1');

    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(chain.offset).toHaveBeenCalledWith(20);
  });

  it('bounds the result set even when the caller asks for nothing', async () => {
    await service.findAll({} as never, 'tenant-1');

    // A default page size, not "every row that has ever existed".
    expect(chain.limit).toHaveBeenCalled();
    const [applied] = chain.limit.mock.calls[0];
    expect(typeof applied).toBe('number');
    expect(applied).toBeGreaterThan(0);
  });
});

/**
 * Phase 1 access foundation, Task 8: an approval reaches a farm only through
 * its batch (approval_request has no location of its own). findAll's own
 * .where() argument is captured and rendered back to SQL, same approach as
 * batch-transfer.service.spec.ts's findAll tests.
 */
describe('ApprovalService farm scope', () => {
  let service: ApprovalService;
  let cls: ReturnType<typeof transactionCls>;
  const dialect = new MySqlDialect();

  let capturedWhere: unknown;
  const renderedWhere = () => dialect.sqlToQuery(capturedWhere as any).sql;

  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (cond: unknown) => { capturedWhere = cond; return chain; },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve([]),
  };
  const mockDb = { select: jest.fn(() => chain) };

  beforeEach(async () => {
    capturedWhere = undefined;
    cls = transactionCls(mockDb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
  });

  it('hides approvals with no batch from a restricted user', async () => {
    useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    expect(renderedWhere()).toContain('batch_header bf');
  });

  it('shows every approval to an admin with no farm selected', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });

    await service.findAll({} as any, 'tenant-1');

    expect(renderedWhere()).not.toContain('batch_header bf');
  });

  it('limits a restricted user with no farm selected to approvals with a batch in their own LOB', async () => {
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toMatch(/batch_id` IS NOT NULL/);
    expect(where).toContain('batch_header br');
  });

  it('also limits that queue to the active company', async () => {
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toContain('`approval_request`.`company_id` = ?');
    expect(where).toContain('br.company_id = ?');
  });

  it('shows a farm user their own farm\'s documents that have no batch (D25)', async () => {
    useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = dialect.sqlToQuery(capturedWhere as any);
    expect(where.sql).toContain('`approval_request`.`farm_id` IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ? OR lf.farm_id = ?)');
    expect(where.params).toContain('farm-g');
    // The batch path is unchanged.
    expect(where.sql).toContain('batch_header bf');
  });

  it('shows a company admin the company\'s farm documents, but still not batchless farmless rows', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toContain('`approval_request`.`farm_id` IN (SELECT ls.location_id FROM location_master ls WHERE ls.company_id = ?)');
    expect(where).not.toContain('`approval_request`.`farm_id` is null');
  });

  it('shows a tenant admin with nothing selected every row, farmless ones included', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });

    await service.findAll({} as any, 'tenant-1');

    expect(renderedWhere()).toContain('`approval_request`.`farm_id` is null');
  });

  it('refuses a batchless approval from a restricted user because it has no operational scope', async () => {
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    mockDb.select.mockClear();

    await expect(service.create({ company_id: 'co-1' } as any, 'tenant-1')).rejects.toThrow(ForbiddenException);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

/**
 * Recovery review I5: create() checked the body's company only for restricted
 * users, so a COMPANY_ADMIN (or a tenant admin with a company selected) could
 * raise a batchless request into another company's approval queue.
 */
describe('ApprovalService.create company boundary', () => {
  let service: ApprovalService;
  let cls: ReturnType<typeof transactionCls>;
  const rows = new Map<unknown, unknown[]>();
  const queried: unknown[] = [];
  const insert = jest.fn(() => ({ values: jest.fn().mockResolvedValue({}) }));

  const chain = (table: unknown) => {
    const result = rows.get(table) ?? [];
    const self: any = {
      from: () => self, where: () => self, limit: () => self, leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };
  const mockDb = {
    select: jest.fn(() => ({ from: (table: unknown) => { queried.push(table); return chain(table); } })),
    insert,
  };

  const companyAdmin = { userId: 'u-admin', companyId: 'co-a', userType: 'COMPANY_ADMIN' };

  beforeEach(async () => {
    rows.clear();
    queried.length = 0;
    insert.mockClear();
    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
      ],
    }).compile();
    service = module.get<ApprovalService>(ApprovalService);
    // Stop after the guards: read-back and numbering are not under test here.
    jest.spyOn(service as any, 'generateDocNo').mockResolvedValue('REQ-2026-0001');
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
  });

  it('refuses a company admin raising for a company other than the selected one, before any insert', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-a', lobId: null });

    await expect(service.create({ company_id: 'co-b', doc_type: 'FEED_RATION', title: 't' } as any, 'tenant-1', companyAdmin))
      .rejects.toThrow('Not authorized for this company.');
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a company admin raising for a company they are not assigned to, even with no company in scope', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    rows.set(schema.userCompanyAssignments, []);

    await expect(service.create({ company_id: 'co-b', doc_type: 'FEED_RATION', title: 't' } as any, 'tenant-1', companyAdmin))
      .rejects.toThrow(ForbiddenException);
    expect(queried).toContain(schema.userCompanyAssignments);
    expect(insert).not.toHaveBeenCalled();
  });

  it('lets a company admin raise for a company they hold an active assignment to', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    rows.set(schema.userCompanyAssignments, [{ id: 'assign-1' }]);

    await service.create({ company_id: 'co-b', doc_type: 'FEED_RATION', title: 't' } as any, 'tenant-1', companyAdmin);
    expect(insert).toHaveBeenCalledWith(schema.approvalRequest);
  });

  it('refuses a tenant admin raising for a company outside their tenant', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: null, lobId: null });
    rows.set(schema.companyMaster, []);

    await expect(service.create({ company_id: 'co-elsewhere', doc_type: 'FEED_RATION', title: 't' } as any, 'tenant-1',
      { userId: 'u-t', companyId: null, userType: 'TENANT_ADMIN' })).rejects.toThrow(ForbiddenException);
    expect(insert).not.toHaveBeenCalled();
  });
});

/**
 * D25: a farm-level document (a feed requisition) is submitted into this
 * engine and decided in the inbox; the document's own module decides what
 * approval, rejection and withdrawal mean for it (ApprovalDocumentHandler).
 */
describe('ApprovalService farm documents (D25)', () => {
  interface Entry { op: string; table: unknown; values?: any; set?: any; inTx: boolean }
  function setup(queues: Map<unknown, unknown[][]>) {
    const log: Entry[] = [];
    const ref = {} as { cls: ReturnType<typeof transactionCls> };
    const inTx = () => ref.cls.get('tenantPostingTransaction') === true;
    const db: any = {
      select: jest.fn(() => {
        const entry = { table: undefined as unknown };
        const self: any = {
          from: (t: unknown) => { entry.table = t; return self; },
          leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
          then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
        };
        return self;
      }),
      insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
      update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
    };
    const cls = (ref.cls = transactionCls(db));
    const service = new ApprovalService(cls, new AuditLogService(cls), {} as any);
    return { service, log, cls };
  }
  const PENDING = {
    request_id: 'ar-1', tenant_id: 'tenant-1', company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-VIL100-2026-00004',
    status: 'PENDING', batch_id: null, farm_id: 'farm-vil', document_id: 'req-4', deleted_at: null,
  };

  it('submits a farm document as a PENDING request carrying its farm and document', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ code: 'VIL100', name: 'Villa Franca' }]]],
      [schema.approvalRequest, [[]]],
    ]));
    const id = await service.submitFarmDocument({
      documentType: 'FEED_REQUISITION', documentId: 'req-4', documentNo: 'REQ-VIL100-2026-00004', farmId: 'farm-vil', companyId: 'co-1',
      title: 'Feed requisition REQ-VIL100-2026-00004', urgency: 'HIGH', itemOrStage: 'Feed', requestedQty: '9,000', uom: 'KG', justification: null,
    }, 'tenant-1', { userId: 'u-farm', userType: 'STANDARD_USER', email: 'farm@x' });
    const insert = log.find((e) => e.op === 'insert' && e.table === schema.approvalRequest)!;
    expect(insert.values).toMatchObject({
      request_id: id, company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-VIL100-2026-00004', status: 'PENDING',
      farm_id: 'farm-vil', document_id: 'req-4', location_label: 'VIL100 — Villa Franca', requested_qty: '9,000', uom: 'KG', urgency: 'HIGH',
    });
    expect(insert.values.batch_id).toBeUndefined();
    expect(log.filter((e) => e.op === 'insert' && e.table === schema.auditLog).map((e) => e.values.action)).toEqual(['CREATE']);
    expect(log.every((e) => e.inTx)).toBe(true);
  });

  it('refuses a second open request for the same document', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ code: 'VIL100', name: 'Villa Franca' }]]],
      [schema.approvalRequest, [[{ request_id: 'ar-1' }]]],
    ]));
    await expect(service.submitFarmDocument({
      documentType: 'FEED_REQUISITION', documentId: 'req-4', documentNo: 'REQ-VIL100-2026-00004', farmId: 'farm-vil', companyId: 'co-1', title: 't',
    }, 'tenant-1')).rejects.toThrow('REQ-VIL100-2026-00004 is already waiting for approval.');
    expect(log).toEqual([]);
  });

  it('lets the document\'s handler decide inside the transaction, then runs afterDecide once committed', async () => {
    const { service, log, cls } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING], [{ ...PENDING, status: 'APPROVED' }]]]]));
    const seen: Array<{ step: string; inTx: boolean; args?: unknown[] }> = [];
    service.registerDocumentHandler('FEED_REQUISITION', {
      decide: async (...args) => { seen.push({ step: 'decide', inTx: cls.get('tenantPostingTransaction') === true, args }); },
      withdraw: async () => undefined,
      afterDecide: async () => { seen.push({ step: 'after', inTx: cls.get('tenantPostingTransaction') === true }); },
    });
    await service.approve('ar-1', 'tenant-1', { userId: 'u-mgr' }, 'Extra pigs arriving');
    expect(seen.map((s) => [s.step, s.inTx])).toEqual([['decide', true], ['after', false]]);
    expect(seen[0].args!.slice(1, 4)).toEqual(['APPROVED', 'Extra pigs arriving', 'tenant-1']);
    expect(log.find((e) => e.op === 'update' && e.table === schema.approvalRequest)!.set).toMatchObject({ status: 'APPROVED', rejection_reason: null });
  });

  it('writes nothing when the handler refuses the decision', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING]]]]));
    const after = jest.fn();
    service.registerDocumentHandler('FEED_REQUISITION', {
      decide: async () => { throw new BadRequestException('Add remarks to explain.'); },
      withdraw: async () => undefined,
      afterDecide: after,
    });
    await expect(service.approve('ar-1', 'tenant-1', { userId: 'u-mgr' })).rejects.toThrow('Add remarks to explain.');
    expect(log.filter((e) => e.table === schema.approvalRequest)).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('passes the rejection reason, and a withdrawal, to the handler', async () => {
    const { service } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING], [PENDING], [PENDING]]]]));
    const handler = { decide: jest.fn(async () => undefined), withdraw: jest.fn(async () => undefined) };
    service.registerDocumentHandler('FEED_REQUISITION', handler);
    await service.reject('ar-1', { rejection_reason: 'Silo being cleaned' }, 'tenant-1', { userId: 'u-mgr' });
    expect(handler.decide).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'ar-1' }), 'REJECTED', 'Silo being cleaned', 'tenant-1', { userId: 'u-mgr' });
    await service.remove('ar-1', 'tenant-1', { userId: 'u-farm' });
    expect(handler.withdraw).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'ar-1' }), 'tenant-1', { userId: 'u-farm' });
  });

  it('refuses to decide a document request no module handles', async () => {
    const { service, log } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[PENDING]]]]));
    await expect(service.approve('ar-1', 'tenant-1')).rejects.toThrow('No handler is registered for FEED_REQUISITION documents.');
    expect(log).toEqual([]);
  });
});

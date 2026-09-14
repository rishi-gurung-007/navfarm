import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ApprovalService } from './approval.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';

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
    expect(where).toContain('batch_header bl');
  });
});

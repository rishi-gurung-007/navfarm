import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ApprovalService } from './approval.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';

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

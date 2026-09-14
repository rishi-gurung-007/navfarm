import { transactionCls } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { ApprovalService } from '../approval/approval.service';
import * as schema from '../../../core/database/schema';

/**
 * The db mock answers by table rather than by call order. The previous version
 * chained mockReturnValueOnce, which meant any query added anywhere earlier in
 * postEntry silently handed the wrong rows to the query after it — the entry
 * window guard broke all of it by adding three.
 */
describe('BatchDailyDataService', () => {
  let service: BatchDailyDataService;
  let batchService: BatchService;

  const rows = new Map<unknown, unknown[]>();
  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate };

  const approvalService = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    approve: jest.fn(),
    approveUnscheduledHealth: jest.fn(),
    reject: jest.fn(),
  };

  /** Awaitable at any point, so .where(), .limit() and .orderBy() all resolve. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      where: () => self,
      limit: () => self,
      for: () => self,
      orderBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const header = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', lob_id: 'lob-1', effective_from: '2026-09-08', animal_count: '40' };
  const ENTRY_DATE = '2026-09-08';

  // The transaction CLS only resolves 'tenantDb'; farmScope() reads 'farmScope'
  // off the same ClsService, so tests that need a scope wrap .get() to answer it.
  let farmScopeValue: unknown;
  const useFarmScope = (scope: unknown) => { farmScopeValue = scope; };

  beforeEach(async () => {
    rows.clear();
    farmScopeValue = undefined;
    // The batch and its schedule exist; nothing has been entered yet; the user
    // holds no grants, i.e. is the on-ground worker.
    rows.set(schema.batchHeader, [{ batch_id: 'batch-1', tenant_id: 'tenant-123', start_date: ENTRY_DATE, animal_tracking: 'COUNT_ONLY' }]);
    rows.set(schema.schedulerHeader, [header]);
    rows.set(schema.batchDailyData, []);
    rows.set(schema.companyMaster, [{ tz: 'Africa/Harare' }]);
    rows.set(schema.userRoleAssignment, []);

    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    Object.values(approvalService).forEach((fn) => fn.mockReset());
    approvalService.create.mockResolvedValue({ request_id: 'req-1', doc_no: 'HLT-UNS-2026-0001' });
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    const cls = transactionCls(mockDb);
    const baseGet = cls.get.bind(cls);
    cls.get = ((key?: string) => (key === 'farmScope' ? farmScopeValue : baseGet(key as any))) as typeof cls.get;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchDailyDataService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
        { provide: BatchTransferService, useValue: { create: jest.fn() } },
        { provide: GlPostingService, useValue: {} },
        { provide: ApprovalService, useValue: approvalService },
      ],
    }).compile();

    service = module.get<BatchDailyDataService>(BatchDailyDataService);
    batchService = module.get<BatchService>(BatchService);
  });

  const line = (over: Record<string, unknown> = {}) => {
    rows.set(schema.schedulerLine, [{
      line_id: 'line-1', scheduler_id: 'sched-1', is_active: true, lot_required: false,
      occurrence: 'DAILY', start_day: 1, end_day: null, day_of_week: null, is_mandatory: true,
      stage_id: 'stage-1', ...over,
    }]);
  };

  it('answers 404 when the batch is on another farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    rows.set(schema.batchHeader, []); // scoped batch lookup finds nothing
    await expect(service.entryForm('batch-1', undefined as any, 'tenant-123', { userId: 'u' } as any)).rejects.toThrow(NotFoundException);
  });

  it('reverses the prior consumption before posting a corrected daily quantity', async () => {
    line({ line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' });
    jest.spyOn(service as any, 'companyToday').mockResolvedValue(ENTRY_DATE);
    rows.set(schema.batchDailyData, [{ posted: true, posting_reference: 'old-tx', entered_value: '4.6' }]);
    rows.set(schema.itemMaster, [{ item_id: 'item-feed', uom_primary: 'KG' }]);
    (batchService as any).reverseConsumption = jest.fn().mockResolvedValue({});
    (batchService.addTransaction as jest.Mock).mockResolvedValue({ posting_transaction_id: 'new-tx', transactions: [] });
    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 5 } as any, 'tenant-123');
    expect((batchService as any).reverseConsumption).toHaveBeenCalledWith('batch-1', 'old-tx', 'tenant-123', undefined);
  });

  it('rejects an entry against a deactivated line', async () => {
    line({ is_active: false });
    await expect(
      service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 2 } as any, 'tenant-123'),
    ).rejects.toThrow(ConflictException);
  });

  it('delegates a CONSUMPTION entry with its selected lot and the item\'s stock UOM', async () => {
    line({ line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' });
    rows.set(schema.itemMaster, [{ item_id: 'item-feed', uom_primary: 'KG' }]);
    (batchService.addTransaction as jest.Mock).mockResolvedValue({
      posting_transaction_id: 'tx-1',
      transactions: [{ transaction_id: 'tx-1', transaction_date: ENTRY_DATE, item_id: 'item-feed', transaction_type: 'CONSUMPTION' }],
    });

    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 22.5, lot_no: 'selected-lot' } as any, 'tenant-123', { userId: 'user-1' });

    expect(batchService.addTransaction).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ transaction_type: 'CONSUMPTION', item_id: 'item-feed', quantity: 22.5, uom: 'KG', lot_no: 'selected-lot' }),
      'tenant-123',
      { userId: 'user-1' },
    );
  });

  it('flags a DESCRIPTIVE entry that breaches its alert limit without posting a transaction', async () => {
    line({ line_id: 'line-mort', line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Daily Mortality',
      lower_alert_limit: null, upper_alert_limit: '1', alert_severity: 'CRITICAL', std_value: null });

    await service.postEntry('batch-1', { line_id: 'line-mort', entry_date: ENTRY_DATE, entered_value: 3 } as any, 'tenant-123');

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    // First insert is the notification_alert_log write; second is batch_daily_data.
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });

  describe('the entry window', () => {
    it('lets a worker fill in a past day nothing was recorded for', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 40 } as any, 'tenant-123'),
      ).resolves.toBeDefined();
    });

    it('stops a worker changing a past day already recorded', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      rows.set(schema.batchDailyData, [{ entry_id: 'e1', line_id: 'line-1', entry_date: ENTRY_DATE }]);
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 41 } as any, 'tenant-123'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a role holding edit on BATCH_ENTRY change the same past day', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      rows.set(schema.batchDailyData, [{ entry_id: 'e1', line_id: 'line-1', entry_date: ENTRY_DATE }]);
      rows.set(schema.userRoleAssignment, [{
        moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY',
        canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: true, canExport: true, canPrint: true,
      }]);
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 41 } as any, 'tenant-123', { userId: 'u' }),
      ).resolves.toBeDefined();
    });

    it('refuses a day that has not happened yet', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: '2099-01-01', entered_value: 1 } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('unscheduled health events', () => {
    // The schedule is what a worker may enter. Health is the one exception,
    // because a sick animal will not wait for a schedule to be redesigned.
    it('records the observation at once, as a request awaiting approval', async () => {
      rows.set(schema.itemMaster, [{ item_id: 'med-1', item_name: 'Oxytetracycline', uom: 'ML' }]);

      await service.recordUnscheduledHealth('batch-1', {
        entry_date: ENTRY_DATE, observation: 'Lame gilt, pen 4', item_id: 'med-1', quantity: 12,
      } as any, 'tenant-123', { userId: 'u' });

      expect(approvalService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          doc_type: 'UNSCHEDULED_HEALTH',
          batch_id: 'batch-1',
          requested_qty: '12',
          uom: 'ML',
          urgency: 'HIGH',
        }),
        'tenant-123',
        { userId: 'u' },
      );
      // The event itself is the request; nothing was written to the day's
      // entries, which only ever answer a scheduler line.
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    // The backlog gate deliberately does not apply here: it would stop someone
    // reporting a sick animal because a feed record from last Tuesday is
    // missing, which is exactly backwards.
    it('is not held back by a backlog', async () => {
      rows.set(schema.batchDailyData, []);
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: '2026-09-01', observation: 'Scouring piglets',
      } as any, 'tenant-123')).resolves.toBeDefined();
    });

    it('refuses an event dated in the future', async () => {
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: '2099-01-01', observation: 'Lame gilt',
      } as any, 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    // Found by calling the running endpoint, not by reading the code:
    // findAll answers with a bare array, and spreading one into an object
    // produced `{"0": {...}}` — a shape every caller's .map() would choke on.
    it('lists this batch\'s events as an array', async () => {
      approvalService.findAll.mockResolvedValue([
        { request_id: 'req-1', batch_id: 'batch-1', doc_no: 'HLT-UNS-2026-0001' },
        { request_id: 'req-2', batch_id: 'batch-9', doc_no: 'HLT-UNS-2026-0002' },
      ]);

      const list = await service.listUnscheduledHealth('batch-1', 'tenant-123', 'PENDING');

      expect(Array.isArray(list)).toBe(true);
      expect(list.map((r: any) => r.doc_no)).toEqual(['HLT-UNS-2026-0001']);
    });

    it('refuses a medicine that is not in the Item Master', async () => {
      rows.set(schema.itemMaster, []);
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: ENTRY_DATE, observation: 'Lame gilt', item_id: 'nope',
      } as any, 'tenant-123')).rejects.toThrow(NotFoundException);
    });

    it('delegates health approval with the expected batch and current user', async () => {
      approvalService.approveUnscheduledHealth.mockResolvedValue({ status: 'APPROVED' });
      await expect(service.approveUnscheduledHealth('batch-1', 'req-1', 'tenant-123', { userId: 'u' }))
        .resolves.toEqual({ status: 'APPROVED' });
      expect(approvalService.approveUnscheduledHealth).toHaveBeenCalledWith('batch-1', 'req-1', 'tenant-123', { userId: 'u' });
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    it('propagates a failed health approval without approving separately', async () => {
      approvalService.approveUnscheduledHealth.mockRejectedValue(new Error('No stock on hand'));
      await expect(service.approveUnscheduledHealth('batch-1', 'req-1', 'tenant-123')).rejects.toThrow('No stock on hand');
      expect(approvalService.approve).not.toHaveBeenCalled();
    });

  });
});

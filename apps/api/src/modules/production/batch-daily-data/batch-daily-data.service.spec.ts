import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
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

  /** Awaitable at any point, so .where(), .limit() and .orderBy() all resolve. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      where: () => self,
      limit: () => self,
      orderBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const header = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', lob_id: 'lob-1', effective_from: '2026-09-08', animal_count: '40' };
  const ENTRY_DATE = '2026-09-08';

  beforeEach(async () => {
    rows.clear();
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
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchDailyDataService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
        { provide: BatchTransferService, useValue: { create: jest.fn() } },
        { provide: GlPostingService, useValue: {} },
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

  it('rejects an entry against a deactivated line', async () => {
    line({ is_active: false });
    await expect(
      service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 2 } as any, 'tenant-123'),
    ).rejects.toThrow(ConflictException);
  });

  it('delegates a CONSUMPTION entry to BatchService.addTransaction with the item\'s stock UOM', async () => {
    line({ line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' });
    rows.set(schema.itemMaster, [{ item_id: 'item-feed', uom_primary: 'KG' }]);
    (batchService.addTransaction as jest.Mock).mockResolvedValue({
      transactions: [{ transaction_id: 'tx-1', transaction_date: ENTRY_DATE, item_id: 'item-feed', transaction_type: 'CONSUMPTION' }],
    });

    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 22.5 } as any, 'tenant-123', { userId: 'user-1' });

    expect(batchService.addTransaction).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ transaction_type: 'CONSUMPTION', item_id: 'item-feed', quantity: 22.5, uom: 'KG' }),
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
});

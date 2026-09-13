import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';

describe('BatchDailyDataService', () => {
  let service: BatchDailyDataService;
  let batchService: BatchService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();

  const mockDb = { select: mockDbSelect, insert: mockDbInsert };

  const header = {
    scheduler_id: 'sched-1',
    batch_id: 'batch-1',
    company_id: 'comp-1',
    lob_id: 'lob-1',
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }) });

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

  it('rejects an entry against a deactivated line', async () => {
    mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ line_id: 'line-1', is_active: false }]) }) }) });

    await expect(
      service.postEntry('batch-1', { line_id: 'line-1', entry_date: '2026-09-08', entered_value: 2 } as any, 'tenant-123'),
    ).rejects.toThrow(ConflictException);
  });

  it('delegates a CONSUMPTION entry to BatchService.addTransaction with the item\'s stock UOM', async () => {
    mockDbSelect
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([
        { line_id: 'line-1', scheduler_id: 'sched-1', is_active: true, line_type: 'CONSUMPTION', item_id: 'item-feed', lot_required: false, parameter_name: 'Morning Feed' },
      ]) }) }) }) // line lookup
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([header]) }) }) }) // header lookup
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'item-feed', uom_primary: 'KG' }]) }) }) }) // item lookup
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // findForDate at the end

    (batchService.addTransaction as jest.Mock).mockResolvedValue({
      transactions: [{ transaction_id: 'tx-1', transaction_date: '2026-09-08', item_id: 'item-feed', transaction_type: 'CONSUMPTION' }],
    });

    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: '2026-09-08', entered_value: 22.5 } as any, 'tenant-123', { userId: 'user-1' });

    expect(batchService.addTransaction).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ transaction_type: 'CONSUMPTION', item_id: 'item-feed', quantity: 22.5, uom: 'KG' }),
      'tenant-123',
      { userId: 'user-1' },
    );
  });

  it('flags a DESCRIPTIVE entry that breaches its alert limit without posting a transaction', async () => {
    mockDbSelect
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([
        { line_id: 'line-mort', scheduler_id: 'sched-1', is_active: true, line_type: 'DESCRIPTIVE', item_id: null, lot_required: false, parameter_name: 'Daily Mortality', lower_alert_limit: null, upper_alert_limit: '1', alert_severity: 'CRITICAL', std_value: null },
      ]) }) }) }) // line lookup
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([header]) }) }) }) // header lookup
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // findForDate at the end

    await service.postEntry('batch-1', { line_id: 'line-mort', entry_date: '2026-09-08', entered_value: 3 } as any, 'tenant-123');

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    // First insert call is the notification_alert_log write; second is batch_daily_data.
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });
});

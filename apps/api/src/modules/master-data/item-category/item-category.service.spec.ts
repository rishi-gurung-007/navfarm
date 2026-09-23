import { Test, TestingModule } from '@nestjs/testing';
import { ItemCategoryService } from './item-category.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('ItemCategoryService', () => {
  let service: ItemCategoryService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockTransaction = jest.fn();
  const txSelect = jest.fn();
  const txInsert = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockTransaction,
  };

  const numberSeries = {
    resolveSeriesFor: jest.fn(),
    generateNext: jest.fn(),
    lockSeries: jest.fn(),
  };

  const makeSelectResult = (rows: any[]) => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  });

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockTransaction.mockReset();
    txSelect.mockReset();
    txInsert.mockReset();
    numberSeries.resolveSeriesFor.mockReset();
    numberSeries.generateNext.mockReset();
    numberSeries.lockSeries.mockReset();

    // Default: no series configured, so create() falls to today's manual-entry path
    // unless a test explicitly opts a case into auto-generation below.
    numberSeries.resolveSeriesFor.mockResolvedValue(null);
    mockTransaction.mockImplementation(async (callback: (tx: any) => unknown) =>
      callback({ select: txSelect, insert: txInsert }),
    );
    txInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemCategoryService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();

    service = module.get<ItemCategoryService>(ItemCategoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — manual entry (no series configured)', () => {
    it('throws ConflictException if category code already exists in this company scope', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company exists
        .mockReturnValueOnce(makeSelectResult([{ category_code: 'FEED' }])); // duplicate hit

      await expect(
        service.create(
          { company_id: 'comp-1', category_code: 'FEED', category_name: 'Feed Products' },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates using the user-supplied code, exactly as before this feature existed', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company exists
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ category_code: 'FEED', category_name: 'Feed Products' }])); // findOne

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { company_id: 'comp-1', category_code: 'FEED', category_name: 'Feed Products' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(result.category_code).toBe('FEED');
    });
  });

  describe('create — auto-generated (a series is configured for ITEM_CATEGORY)', () => {
    it('generates a root code via generateNext when there is no parent', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_CATEGORY');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'CAT' });
      numberSeries.generateNext.mockResolvedValue('CAT-001');
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company exists
        .mockReturnValueOnce(makeSelectResult([{ category_code: 'CAT-001', category_name: 'Feed' }])); // findOne

      const result = await service.create({ company_id: 'comp-1', category_name: 'Feed' }, 'tenant-123', { userId: 'user-1' });

      expect(numberSeries.generateNext).toHaveBeenCalledWith('ITEM_CATEGORY', 'tenant-123', 'comp-1', expect.anything(), expect.any(Object));
      expect(txInsert).toHaveBeenCalledTimes(1);
      expect(result.category_code).toBe('CAT-001');
    });

    it('generates a composite code under a parent category, prefixed with the parent code', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_CATEGORY');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'CAT' });
      const parentRow = { category_id: 'parent-1', category_code: 'FEED', category_name: 'Feed' };
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company exists
        .mockReturnValueOnce(makeSelectResult([parentRow])) // findOne(parent)
        .mockReturnValueOnce(makeSelectResult([{ category_code: 'FEED/CAT-001', category_name: 'Sub Feed' }])); // findOne after insert
      txSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }), // no existing siblings yet
      });

      const result = await service.create(
        { company_id: 'comp-1', category_name: 'Sub Feed', parent_category_id: 'parent-1' },
        'tenant-123',
      );

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      expect(result.category_code).toBe('FEED/CAT-001');
    });

    it('uses the user-supplied code without generating when the series has allow_manual set', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_CATEGORY');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: true, seq_length: 3, prefix: 'CAT' });
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company exists
        .mockReturnValueOnce(makeSelectResult([{ category_code: 'CUSTOM', category_name: 'Feed' }])); // findOne

      const result = await service.create(
        { company_id: 'comp-1', category_name: 'Feed', category_code: 'custom' },
        'tenant-123',
      );

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      const insertedValues = (txInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
      expect(insertedValues.category_code).toBe('CUSTOM');
      expect(result.category_code).toBe('CUSTOM');
    });

    it('rejects a generated code that would exceed 255 characters, without inserting', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_CATEGORY');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'CAT' });
      numberSeries.generateNext.mockResolvedValue('CAT-' + '9'.repeat(252)); // 256 chars total
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      await expect(service.create({ company_id: 'comp-1', category_name: 'Feed' }, 'tenant-123'))
        .rejects.toThrow(BadRequestException);

      expect(txInsert).not.toHaveBeenCalled();
    });

    it('retries once with a freshly generated code on a duplicate-key collision, then raises ConflictException if it collides again', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_CATEGORY');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'CAT' });
      numberSeries.generateNext.mockResolvedValueOnce('CAT-001').mockResolvedValueOnce('CAT-002');
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      const dupErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      txInsert
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }))
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }));

      await expect(service.create({ company_id: 'comp-1', category_name: 'Feed' }, 'tenant-123'))
        .rejects.toThrow(ConflictException);

      expect(mockTransaction).toHaveBeenCalledTimes(2);
      expect(numberSeries.generateNext).toHaveBeenCalledTimes(2);
    });
  });
});

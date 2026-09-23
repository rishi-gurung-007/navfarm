import { Test, TestingModule } from '@nestjs/testing';
import { GlAccountService } from './gl-account.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('GlAccountService', () => {
  let service: GlAccountService;

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

    numberSeries.resolveSeriesFor.mockResolvedValue(null); // default: manual, as today
    mockTransaction.mockImplementation(async (callback: (tx: any) => unknown) =>
      callback({ select: txSelect, insert: txInsert }),
    );
    txInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlAccountService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();

    service = module.get<GlAccountService>(GlAccountService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — manual entry (no series configured)', () => {
    it('should throw NotFoundException if company does not exist', async () => {
      mockDbSelect.mockReturnValue(makeSelectResult([])); // company not found

      await expect(
        service.create(
          { company_id: 'non-existent-comp', account_code: '101000', account_name: 'Cash at Bank', account_type: 'ASSET' },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if G/L Account code already exists in this company', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ account_code: '101000' }])); // duplicate hit

      await expect(
        service.create(
          { company_id: 'comp-1', account_code: '101000', account_name: 'Cash at Bank', account_type: 'ASSET' },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create G/L Account with the user-supplied code', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ account_code: '101000', account_name: 'Cash at Bank' }])); // findOne

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { company_id: 'comp-1', account_code: '101000', account_name: 'Cash at Bank', account_type: 'ASSET' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(result.account_code).toBe('101000');
    });
  });

  describe('create — auto-generated (a series is configured for GL_ACCOUNT[_type])', () => {
    it('prefers the account_type series and generates a root code with no parent', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('GL_ACCOUNT_ASSET');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 4, prefix: '1' });
      numberSeries.generateNext.mockResolvedValue('1-0001');
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ account_code: '1-0001', account_name: 'Cash at Bank' }])); // findOne

      const result = await service.create(
        { company_id: 'comp-1', account_name: 'Cash at Bank', account_type: 'ASSET' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(numberSeries.resolveSeriesFor).toHaveBeenCalledWith('GL_ACCOUNT', 'ASSET', 'tenant-123', 'comp-1');
      expect(numberSeries.generateNext).toHaveBeenCalledWith('GL_ACCOUNT_ASSET', 'tenant-123', 'comp-1', expect.anything(), expect.any(Object));
      expect(result.account_code).toBe('1-0001');
    });

    it('generates a composite code under a parent account', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('GL_ACCOUNT_ASSET');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'SUB' });
      const parentRow = { gl_account_id: 'parent-1', account_code: '1000', account_name: 'Assets', deleted_at: null };
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([parentRow])) // parent lookup
        .mockReturnValueOnce(makeSelectResult([{ account_code: '1000/SUB-001', account_name: 'Cash' }])); // findOne
      txSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      });

      const result = await service.create(
        { company_id: 'comp-1', account_name: 'Cash', account_type: 'ASSET', parent_account_id: 'parent-1' },
        'tenant-123',
      );

      expect(result.account_code).toBe('1000/SUB-001');
    });

    it('uses the user-supplied code without generating when the series has allow_manual set', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('GL_ACCOUNT_ASSET');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: true, seq_length: 4, prefix: '1' });
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ account_code: '9999', account_name: 'Cash' }])); // findOne

      const result = await service.create(
        { company_id: 'comp-1', account_name: 'Cash', account_type: 'ASSET', account_code: '9999' },
        'tenant-123',
      );

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      expect(result.account_code).toBe('9999');
    });

    it('rejects a generated code that would exceed 255 characters, without inserting', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('GL_ACCOUNT_ASSET');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 4, prefix: '1' });
      numberSeries.generateNext.mockResolvedValue('1-' + '9'.repeat(254));
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      await expect(service.create({ company_id: 'comp-1', account_name: 'Cash', account_type: 'ASSET' }, 'tenant-123'))
        .rejects.toThrow(BadRequestException);
      expect(txInsert).not.toHaveBeenCalled();
    });

    it('retries once on a duplicate-key collision then raises ConflictException on a second collision', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('GL_ACCOUNT_ASSET');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 4, prefix: '1' });
      numberSeries.generateNext.mockResolvedValueOnce('1-0001').mockResolvedValueOnce('1-0002');
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      const dupErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      txInsert
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }))
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }));

      await expect(service.create({ company_id: 'comp-1', account_name: 'Cash', account_type: 'ASSET' }, 'tenant-123'))
        .rejects.toThrow(ConflictException);
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });
  });
});

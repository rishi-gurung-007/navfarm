import { Test, TestingModule } from '@nestjs/testing';
import { CostCenterService } from './cost-center.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('CostCenterService', () => {
  let service: CostCenterService;

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
        CostCenterService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();

    service = module.get<CostCenterService>(CostCenterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — manual entry (no series configured)', () => {
    it('should throw NotFoundException if company does not exist', async () => {
      mockDbSelect.mockReturnValue(makeSelectResult([])); // company not found

      await expect(
        service.create(
          { company_id: 'non-existent-comp', cost_center_code: 'CC01', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if Cost Center code already exists in this company', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ cost_center_code: 'CC01' }])); // duplicate hit

      await expect(
        service.create(
          { company_id: 'comp-1', cost_center_code: 'CC01', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create Cost Center with the user-supplied code', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ cost_center_code: 'CC01', cost_center_name: 'Production Dept' }])); // findOne

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { company_id: 'comp-1', cost_center_code: 'CC01', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(result.cost_center_code).toBe('CC01');
    });
  });

  describe('create — auto-generated (a series is configured for COST_CENTER[_type])', () => {
    it('prefers the cost_center_type series and generates a root code with no parent', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER_DEPARTMENT');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'DEPT' });
      numberSeries.generateNext.mockResolvedValue('DEPT-001');
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ cost_center_code: 'DEPT-001', cost_center_name: 'Production Dept' }])); // findOne

      const result = await service.create(
        { company_id: 'comp-1', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(numberSeries.resolveSeriesFor).toHaveBeenCalledWith('COST_CENTER', 'DEPARTMENT', 'tenant-123', 'comp-1');
      expect(numberSeries.generateNext).toHaveBeenCalledWith('COST_CENTER_DEPARTMENT', 'tenant-123', 'comp-1', expect.anything(), expect.any(Object));
      expect(result.cost_center_code).toBe('DEPT-001');
    });

    it('generates a composite code under a parent cost center', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER_DEPARTMENT');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'SUB' });
      const parentRow = { cost_center_id: 'parent-1', cost_center_code: 'DEPT-001', cost_center_name: 'Production', deleted_at: null };
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([parentRow])) // parent lookup
        .mockReturnValueOnce(makeSelectResult([{ cost_center_code: 'DEPT-001/SUB-001', cost_center_name: 'Line 1' }])); // findOne
      txSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      });

      const result = await service.create(
        { company_id: 'comp-1', cost_center_name: 'Line 1', cost_center_type: 'DEPARTMENT', parent_cost_center_id: 'parent-1' },
        'tenant-123',
      );

      expect(result.cost_center_code).toBe('DEPT-001/SUB-001');
    });

    it('uses the user-supplied code without generating when the series has allow_manual set', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER_DEPARTMENT');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: true, seq_length: 3, prefix: 'DEPT' });
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ cost_center_code: 'CUSTOM-CC', cost_center_name: 'Production Dept' }])); // findOne

      const result = await service.create(
        { company_id: 'comp-1', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT', cost_center_code: 'custom-cc' },
        'tenant-123',
      );

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      expect(result.cost_center_code).toBe('CUSTOM-CC');
    });

    it('rejects a generated code that would exceed 255 characters, without inserting', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER_DEPARTMENT');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'DEPT' });
      numberSeries.generateNext.mockResolvedValue('DEPT-' + '9'.repeat(253));
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      await expect(service.create({ company_id: 'comp-1', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' }, 'tenant-123'))
        .rejects.toThrow(BadRequestException);
      expect(txInsert).not.toHaveBeenCalled();
    });

    it('retries once on a duplicate-key collision then raises ConflictException on a second collision', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER_DEPARTMENT');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, seq_length: 3, prefix: 'DEPT' });
      numberSeries.generateNext.mockResolvedValueOnce('DEPT-001').mockResolvedValueOnce('DEPT-002');
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }]));

      const dupErr = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY', errno: 1062 });
      txInsert
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }))
        .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) }));

      await expect(service.create({ company_id: 'comp-1', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT' }, 'tenant-123'))
        .rejects.toThrow(ConflictException);
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });
  });
});

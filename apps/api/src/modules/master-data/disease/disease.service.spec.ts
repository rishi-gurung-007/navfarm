import { Test, TestingModule } from '@nestjs/testing';
import { DiseaseService } from './disease.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('DiseaseService', () => {
  let service: DiseaseService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
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
    numberSeries.resolveSeriesFor.mockReset();
    numberSeries.generateNext.mockReset();
    numberSeries.lockSeries.mockReset();
    numberSeries.resolveSeriesFor.mockResolvedValue(null); // default: manual, as today

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiseaseService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();

    service = module.get<DiseaseService>(DiseaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — manual entry (no series configured)', () => {
    it('should throw NotFoundException if company does not exist', async () => {
      mockDbSelect.mockReturnValue(makeSelectResult([])); // company not found

      await expect(
        service.create({ company_id: 'non-existent-comp', disease_code: 'DIS01', disease_name: 'Newcastle Disease' }, 'tenant-123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if disease code already exists in this company', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([{ disease_code: 'DIS01' }])); // duplicate hit

      await expect(
        service.create({ company_id: 'comp-1', disease_code: 'DIS01', disease_name: 'Newcastle Disease' }, 'tenant-123'),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create disease definition with the user-supplied code', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ disease_code: 'DIS01', disease_name: 'Newcastle Disease' }])); // findOne

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { company_id: 'comp-1', disease_code: 'DIS01', disease_name: 'Newcastle Disease' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.disease_code).toBe('DIS01');
    });

    it('rejects when neither a series nor a manual code is supplied', async () => {
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])); // company found

      await expect(
        service.create({ company_id: 'comp-1', disease_name: 'Newcastle Disease' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — auto-generated (a series is configured for DISEASE)', () => {
    it('generates the code via the resolved series', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('DISEASE');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false });
      numberSeries.generateNext.mockResolvedValue('DIS-001');
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ disease_code: 'DIS-001', disease_name: 'Newcastle Disease' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create({ company_id: 'comp-1', disease_name: 'Newcastle Disease' }, 'tenant-123');

      expect(numberSeries.resolveSeriesFor).toHaveBeenCalledWith('DISEASE', null, 'tenant-123', 'comp-1');
      expect(numberSeries.generateNext).toHaveBeenCalledWith('DISEASE', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(result.disease_code).toBe('DIS-001');
    });

    it('uses the user-supplied code without generating when the series has allow_manual set', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('DISEASE');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: true });
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ disease_code: 'CUSTOM', disease_name: 'Newcastle Disease' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { company_id: 'comp-1', disease_name: 'Newcastle Disease', disease_code: 'custom' },
        'tenant-123',
      );

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      expect(result.disease_code).toBe('CUSTOM');
    });
  });
});

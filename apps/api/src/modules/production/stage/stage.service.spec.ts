import { Test, TestingModule } from '@nestjs/testing';
import { StageService } from './stage.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('StageService', () => {
  let service: StageService;

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

  // Echoes exactly what's given, same as the real service does when a caller
  // supplies both fields — the derive-from-company path has its own tests in
  // nob-lob-resolution.service.spec.ts.
  const nobLobResolution = {
    resolve: jest.fn(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    })),
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    numberSeries.resolveSeriesFor.mockReset();
    numberSeries.generateNext.mockReset();
    numberSeries.lockSeries.mockReset();
    numberSeries.resolveSeriesFor.mockResolvedValue(null); // default: manual, as today
    nobLobResolution.resolve.mockReset();
    nobLobResolution.resolve.mockImplementation(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StageService,
        {
          provide: ClsService,
          useValue: { get: jest.fn().mockReturnValue(mockDb) },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: NumberSeriesService, useValue: numberSeries },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<StageService>(StageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if nob_id does not exist', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.create(
          {
            nob_id: 'bogus-nob',
            lob_id: 'lob-1',
            stage_code: 'QUARANTINE',
            stage_name: 'Quarantine',
            stage_category: 'PRE_PRODUCTIVE',
            stage_sequence: 1,
            transition_trigger: 'MANUAL',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject AUTO_BY_DAY without auto_move_on_day', async () => {
      // Selects in order: nob found, lob found
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lob_id: 'lob-1' }]) }) }),
        });

      await expect(
        service.create(
          {
            nob_id: 'nob-1',
            lob_id: 'lob-1',
            stage_code: 'QUARANTINE',
            stage_name: 'Quarantine',
            stage_category: 'PRE_PRODUCTIVE',
            stage_sequence: 1,
            transition_trigger: 'AUTO_BY_DAY',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should reject a duplicate stage_code within the same LOB', async () => {
      // Selects in order: nob found, lob found, duplicate stage_code found
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lob_id: 'lob-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_code: 'QUARANTINE' }]) }) }),
        });

      await expect(
        service.create(
          {
            nob_id: 'nob-1',
            lob_id: 'lob-1',
            stage_code: 'QUARANTINE',
            stage_name: 'Quarantine',
            stage_category: 'PRE_PRODUCTIVE',
            stage_sequence: 1,
            transition_trigger: 'MANUAL',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a valid stage with a resolvable next_stage_id', async () => {
      // Selects in order: nob found, lob found, next_stage_id resolves, no duplicate code, findOne() after insert
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lob_id: 'lob-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-next' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_code: 'QUARANTINE', stage_name: 'Quarantine' }]) }) }),
        });

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        {
          nob_id: 'nob-1',
          lob_id: 'lob-1',
          stage_code: 'QUARANTINE',
          stage_name: 'Quarantine',
          stage_category: 'PRE_PRODUCTIVE',
          stage_sequence: 1,
          transition_trigger: 'AUTO_BY_DAY',
          auto_move_on_day: 30,
          next_stage_id: 'stage-next',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.stage_code).toBe('QUARANTINE');
    });

    it('generates the stage code via a stage_category series when one is configured', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('STAGE_PRE_PRODUCTIVE');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false });
      numberSeries.generateNext.mockResolvedValue('STG-001');
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lob_id: 'lob-1' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // no duplicate
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_code: 'STG-001', stage_name: 'Quarantine' }]) }) }) });

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        { nob_id: 'nob-1', lob_id: 'lob-1', stage_name: 'Quarantine', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 1, transition_trigger: 'MANUAL' },
        'tenant-123',
      );

      expect(numberSeries.resolveSeriesFor).toHaveBeenCalledWith('STAGE', 'PRE_PRODUCTIVE', 'tenant-123', undefined);
      expect(numberSeries.generateNext).toHaveBeenCalledWith('STAGE_PRE_PRODUCTIVE', 'tenant-123', undefined, undefined, expect.any(Object));
      expect(result.stage_code).toBe('STG-001');
    });

    it('rejects with a clear error when NOB/LOB cannot be derived and none was supplied', async () => {
      nobLobResolution.resolve.mockResolvedValue({ nob_id: 'nob-1', lob_id: null });

      await expect(
        service.create(
          {
            stage_code: 'QUARANTINE',
            stage_name: 'Quarantine',
            stage_category: 'PRE_PRODUCTIVE',
            stage_sequence: 1,
            transition_trigger: 'MANUAL',
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('rejects when neither a series nor a manual stage_code is supplied', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lob_id: 'lob-1' }]) }) }) });

      await expect(service.create(
        { nob_id: 'nob-1', lob_id: 'lob-1', stage_name: 'Quarantine', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 1, transition_trigger: 'MANUAL' } as any,
        'tenant-123',
      )).rejects.toThrow(BadRequestException);
    });
  });
});

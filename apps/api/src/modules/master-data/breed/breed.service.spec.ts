import { Test, TestingModule } from '@nestjs/testing';
import { BreedService } from './breed.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('BreedService', () => {
  let service: BreedService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: jest.fn((work: (tx: any) => Promise<any>): Promise<any> => work(mockDb)),
  };

  const numberSeries = {
    resolveNewCode: jest.fn(async (_master: string, code?: string) => code?.toUpperCase()),
    resolveSeriesFor: jest.fn(),
    generateNext: jest.fn(),
    lockSeries: jest.fn(),
    // No BREED_LIFECYCLE_STAGE series is configured, so a typed code is kept as
    // entered and a blank one leaves the nullable column null.
    resolveOptionalCode: jest.fn(async (_master: string, code?: string | null) => code?.trim() ? code.trim().toUpperCase() : null),
    editedCode: jest.fn(async (_master: string, code: string | null | undefined, current?: string | null) => {
      if (!code?.trim()) return null;
      const next = code.trim().toUpperCase();
      return next === current ? null : next;
    }),
  };

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
    numberSeries.resolveOptionalCode.mockClear();
    numberSeries.editedCode.mockClear();
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
        BreedService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: NumberSeriesService, useValue: numberSeries },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<BreedService>(BreedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSpecies', () => {
    it('should throw ConflictException if species code already exists', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ species_code: 'CHICKEN' }]),
          }),
        }),
      });

      await expect(
        service.createSpecies(
          {
            species_code: 'CHICKEN',
            species_name: 'Chicken',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create species', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ species_code: 'CHICKEN', species_name: 'Chicken' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.createSpecies(
        {
          species_code: 'CHICKEN',
          species_name: 'Chicken',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.species_code).toBe('CHICKEN');
    });
  });

  describe('createBreed', () => {
    it('should throw ConflictException if breed code already exists', async () => {
      // First mock checkSpecies (finds one)
      // Second mock checkDuplicateBreed (finds duplicate breed)
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ species_id: 'spec-1', species_name: 'Chicken' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ breed_code: 'COBB500' }]),
            }),
          }),
        });

      await expect(
        service.createBreed(
          {
            nob_id: 'nob-1',
            breed_code: 'COBB500',
            breed_name: 'Cobb 500',
            species_id: 'spec-1',
            breed_type: 'BROILER',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully create breed', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ species_id: 'spec-1', species_name: 'Chicken' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ breed_code: 'COBB500', breed_name: 'Cobb 500' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.createBreed(
        {
          nob_id: 'nob-1',
          breed_code: 'COBB500',
          breed_name: 'Cobb 500',
          species_id: 'spec-1',
          breed_type: 'BROILER',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.breed_code).toBe('COBB500');
    });

    it('should persist piggery-specific fields', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ species_id: 'spec-pig', species_name: 'Pig' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ breed_code: 'YORKSHIRE', gestation_days: 114 }]) }) }),
        });

      let insertedValues: any;
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((v) => { insertedValues = v; return Promise.resolve({}); }),
      });

      await service.createBreed(
        {
          nob_id: 'nob-1',
          breed_code: 'YORKSHIRE',
          breed_name: 'Yorkshire',
          species_id: 'spec-pig',
          breed_type: 'MEAT',
          gestation_days: 114,
          lactation_days: 28,
          residual_value_pct: 10.0,
          productive_life_cycles: 7,
          avg_litter_size_born: 11.5,
          avg_litter_size_weaned: 10.0,
        },
        'tenant-123',
      );

      expect(insertedValues.gestation_days).toBe(114);
      expect(insertedValues.lactation_days).toBe(28);
      expect(insertedValues.residual_value_pct).toBe('10');
      expect(insertedValues.productive_life_cycles).toBe(7);
      expect(insertedValues.avg_litter_size_born).toBe('11.5');
    });

    it.each([
      ['FARM-001', [], 'FARM-001/SOW-001'],
      ['FARM-001', [{ code: 'FARM-001/SOW-001' }, { code: 'FARM-001/SOW-003' }], 'FARM-001/SOW-004'],
      ['FARM-002', [], 'FARM-002/SOW-001'],
    ])('generates a type code under location %s', async (parentCode, siblings, expected) => {
      numberSeries.resolveSeriesFor.mockResolvedValue('BREED_SOW');
      numberSeries.lockSeries.mockResolvedValue({ allow_manual: false, prefix: 'SOW', seq_length: 3 });
      const returning = (rows: any[]) => ({ from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) });
      mockDbSelect
        .mockReturnValueOnce(returning([{ species_id: 'pig', species_name: 'Pig' }]))
        .mockReturnValueOnce(returning([{ location_code: parentCode, location_type: 'FARM', parent_location_id: null }]))
        .mockReturnValueOnce(returning(siblings as any[]))
        .mockReturnValueOnce(returning([]))
        .mockReturnValueOnce(returning([{ breed_code: expected }]));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const result = await service.createBreed({
        nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW', location_id: 'location',
      }, 'tenant');
      expect(result.breed_code).toBe(expected);
      expect(numberSeries.lockSeries).toHaveBeenCalledWith('BREED_SOW', 'tenant', null, mockDb);
      expect(numberSeries.generateNext).not.toHaveBeenCalled();
    });

    it.each([
      { location_type: 'PEN', parent_location_id: 'farm' },
      { location_type: 'FARM', parent_location_id: 'another-farm' },
      null,
    ])('rejects a non-root farm even with a manual breed code: %j', async (location) => {
      const returning = (rows: any[]) => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) });
      mockDbSelect.mockReturnValueOnce(returning([{ species_id: 'pig', species_name: 'Pig' }]))
        .mockReturnValueOnce(returning(location ? [location] : []));
      await expect(service.createBreed({ nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW', location_id: 'location', breed_code: 'CUSTOM' }, 'tenant'))
        .rejects.toThrow('first-level farm');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('can generate a breed code without the optional farm', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('BREED');
      numberSeries.lockSeries.mockResolvedValue({ allow_manual: true });
      numberSeries.generateNext.mockResolvedValue('BRD-001');
      const returning = (rows: any[]) => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) });
      mockDbSelect.mockReturnValueOnce(returning([{ species_id: 'pig', species_name: 'Pig' }]))
        .mockReturnValueOnce(returning([])).mockReturnValueOnce(returning([{ breed_code: 'BRD-001' }]));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      await expect(service.createBreed({ nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW' }, 'tenant'))
        .resolves.toMatchObject({ breed_code: 'BRD-001' });
      // The DTO is now the fifth argument: a series configured with
      // code_segments/prefix_field reads its segments out of the record being
      // created, so breed_name can drive the code instead of a fixed prefix.
      expect(numberSeries.generateNext).toHaveBeenCalledWith('BREED', 'tenant', null, mockDb,
        { nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW' });
    });

    it('rejects when neither a series nor a manual breed_code is supplied', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ species_id: 'spec-1', species_name: 'Chicken' }]) }) }),
      });

      await expect(service.createBreed(
        { nob_id: 'nob-1', breed_name: 'Cobb 500', species_id: 'spec-1', breed_type: 'BROILER' } as any,
        'tenant-123',
      )).rejects.toThrow(BadRequestException);
    });
  });

  describe('lifecycle stages', () => {
    it('should reject an unknown breed_id', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
      });

      await expect(
        service.createLifecycleStage(
          { breed_id: 'bogus-breed', stage_id: 'stage-1', calc_unit: 'WEEK', period_from: 1, period_to: 4 },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject an unknown stage_id', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ breed_id: 'breed-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        });

      await expect(
        service.createLifecycleStage(
          { breed_id: 'breed-1', stage_id: 'bogus-stage', calc_unit: 'WEEK', period_from: 1, period_to: 4 },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a valid lifecycle stage', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ breed_id: 'breed-1' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-lactation' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([{ lifecycle_id: 'lc-1', breed_id: 'breed-1', stage_id: 'stage-lactation' }]),
                }),
              }),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.createLifecycleStage(
        {
          breed_id: 'breed-1',
          stage_id: 'stage-lactation',
          calc_unit: 'WEEK',
          period_from: 1,
          period_to: 4,
          feed_qty_per_head_per_day_kg: 2.5,
          std_fcr: 2.4,
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.lifecycle_id).toBe('lc-1');
    });
  });
});

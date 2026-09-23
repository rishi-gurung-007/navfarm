import { Test, TestingModule } from '@nestjs/testing';
import { BreedService } from './breed.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';

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

    it('uses the BREED series unchanged', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('BREED_SOW');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, prefix: 'SOW', seq_length: 3 });
      numberSeries.generateNext.mockResolvedValue('YORKSHIRE');
      const returning = (rows: any[]) => ({ from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) });
      mockDbSelect
        .mockReturnValueOnce(returning([{ species_id: 'pig', species_name: 'Pig' }]))
        .mockReturnValueOnce(returning([]))
        .mockReturnValueOnce(returning([{ breed_code: 'YORKSHIRE' }]));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const result = await service.createBreed({
        nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW',
      }, 'tenant');
      expect(result.breed_code).toBe('YORKSHIRE');
      expect(numberSeries.lockSeries).toHaveBeenCalledWith('BREED_SOW', 'tenant', null, mockDb);
      expect(numberSeries.generateNext).toHaveBeenCalledWith('BREED_SOW', 'tenant', null, mockDb,
        { nob_id: 'livestock', breed_name: 'Yorkshire', species_id: 'pig', breed_type: 'SOW' });
    });

    it('rejects when neither a series nor a manual breed_code is supplied', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ species_id: 'spec-1', species_name: 'Chicken' }]) }) }),
      });

      await expect(service.createBreed(
        { nob_id: 'nob-1', breed_name: 'Cobb 500', species_id: 'spec-1', breed_type: 'BROILER' },
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

    describe('findAllLifecycleStages', () => {
      // Real SQL, not a spy: the list contract is only kept if the rendered
      // ORDER BY and WHERE actually change. Same idiom as master-data-scope.spec.
      const dialect = new MySqlDialect();
      const sqlOf = (chunk: any) => dialect.sqlToQuery(chunk);

      // findAllLifecycleStages joins stage_master and breed_master before the
      // where/orderBy, so the chain needs two leftJoin hops ahead of the rest.
      // The count repeats those joins, because `search` matches on the joined
      // stage/breed columns.
      const mockListChain = () => {
        const limitMock = jest.fn().mockReturnValue({ offset: jest.fn().mockResolvedValue([]) });
        const orderByMock = jest.fn().mockReturnValue({ limit: limitMock });
        const dataWhereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
        const leftJoin2Mock = jest.fn().mockReturnValue({ where: dataWhereMock });
        const leftJoin1Mock = jest.fn().mockReturnValue({ leftJoin: leftJoin2Mock });
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ leftJoin: leftJoin1Mock }) });

        const countWhereMock = jest.fn().mockResolvedValue([{ total: 6 }]);
        const countLeftJoin2Mock = jest.fn().mockReturnValue({ where: countWhereMock });
        const countLeftJoin1Mock = jest.fn().mockReturnValue({ leftJoin: countLeftJoin2Mock });
        mockDbSelect.mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ leftJoin: countLeftJoin1Mock }),
        });
        return { orderByMock, dataWhereMock, countLeftJoin1Mock, countLeftJoin2Mock };
      };

      it('orders by the requested column and direction — was hardcoded to period_from asc, ignoring sort and dir', async () => {
        const asc = mockListChain();
        await service.findAllLifecycleStages({ sort: 'period_from', dir: 'asc' } as any, 'tenant-123');
        const desc = mockListChain();
        await service.findAllLifecycleStages({ sort: 'period_from', dir: 'desc' } as any, 'tenant-123');

        const ascSql = sqlOf(asc.orderByMock.mock.calls[0][0]).sql;
        const descSql = sqlOf(desc.orderByMock.mock.calls[0][0]).sql;

        expect(ascSql).toContain('`period_from`');
        expect(ascSql).toContain('asc');
        expect(descSql).toContain('`period_from`');
        expect(descSql).toContain('desc');
        expect(ascSql).not.toEqual(descSql);
      });

      it('narrows by filter[calc_unit] via the shared list contract — was never applied before', async () => {
        const { dataWhereMock } = mockListChain();

        await service.findAllLifecycleStages({ filter: { calc_unit: 'WEEK' } } as any, 'tenant-123');

        const where = sqlOf(dataWhereMock.mock.calls[0][0]);
        expect(where.sql).toContain('`calc_unit`');
        expect(where.params).toContain('WEEK');
      });

      it('counts through the same joins it pages through — a search matches stage_master and breed_master columns', async () => {
        const chain = mockListChain();

        const result = await service.findAllLifecycleStages({ search: 'sow' } as any, 'tenant-123');

        // Counting from the bare table would ask MySQL for stage_master.stage_name
        // with no stage_master in the FROM, so a searched list 500s instead of paging.
        expect(chain.countLeftJoin1Mock).toHaveBeenCalled();
        expect(chain.countLeftJoin2Mock).toHaveBeenCalled();
        expect(result.total).toBe(6);
      });

      // I1: `stage` is a select alias (COALESCE(stage_name, stage_code)), not a
      // real column on breed_lifecycle_stages. Before the fix this reached
      // listOrderBy/listFilterConditions unchanged, and both throw
      // BadRequestException for any key absent from getTableColumns() — so
      // clicking the "Stage" column header or typing into its filter 400ed.
      // These calls would reject against the unfixed service.
      it('sorts by the "Stage" column without 400ing — stage is a computed alias, not a table column', async () => {
        const chain = mockListChain();

        await expect(
          service.findAllLifecycleStages({ sort: 'stage', dir: 'desc' } as any, 'tenant-123')
        ).resolves.toBeDefined();

        const orderSql = sqlOf(chain.orderByMock.mock.calls[0][0]).sql;
        expect(orderSql).toContain('COALESCE');
        expect(orderSql).toContain('desc');
      });

      it('filters by the "Stage" column without 400ing — stage is a computed alias, not a table column', async () => {
        const chain = mockListChain();

        await expect(
          service.findAllLifecycleStages({ filter: { stage: 'Weaner' } } as any, 'tenant-123')
        ).resolves.toBeDefined();

        const where = sqlOf(chain.dataWhereMock.mock.calls[0][0]);
        expect(where.sql).toContain('COALESCE');
        expect(where.params).toContain('Weaner');
      });
    });
  });
});

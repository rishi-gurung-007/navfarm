import { Test, TestingModule } from '@nestjs/testing';
import { NoSeriesService } from './no-series.service';
import { ClsService } from 'nestjs-cls';
import { BadRequestException, NotFoundException, HttpException, HttpStatus, ConflictException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';

describe('NoSeriesService', () => {
  let service: NoSeriesService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb: any = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: jest.fn(async (cb) => cb(mockDb)),
    execute: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue({}),
      }),
    });
    mockDb.transaction.mockClear();
    mockDb.execute.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoSeriesService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
      ],
    }).compile();

    service = module.get<NoSeriesService>(NoSeriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new No. Series with valid data', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      mockDbInsert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue({}),
      });

      // findOne mock
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              id: 'series-1',
              code: 'FEED',
              no_series_code: 'FEED-',
              increment_by: 1,
              manual_nos: false,
              last_no_used: null,
              blocked: false,
            }]),
          }),
        }),
      });

      const result = await service.create({
        code: 'FEED',
        no_series_code: 'FEED-',
      });

      expect(result.code).toBe('FEED');
    });

    it('should reject duplicate code', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'existing' }]),
          }),
        }),
      });

      await expect(service.create({ code: 'FEED' })).rejects.toThrow(ConflictException);
    });
  });

  describe('generateNextNumber', () => {
    it('should generate next number sequentially from last_no_used', async () => {
      const seriesRow = {
        id: 'series-1',
        code: 'FEED',
        no_series_code: 'FEED-',
        increment_by: 1,
        manual_nos: false,
        last_no_used: 'FEED-0025',
        blocked: false,
      };

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([seriesRow]),
            }),
          }),
        }),
      });

      mockDbUpdate.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue({}),
        }),
      });

      const { next_number, series } = await service.generateNextNumber('series-1');
      expect(next_number).toBe('FEED-0026');
      expect(series.code).toBe('FEED');
    });

    it('should generate first number when last_no_used is null', async () => {
      const seriesRow = {
        id: 'series-1',
        code: 'FEED',
        no_series_code: 'FEED-',
        increment_by: 1,
        manual_nos: false,
        last_no_used: null,
        blocked: false,
      };

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([seriesRow]),
            }),
          }),
        }),
      });

      mockDbUpdate.mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue({}),
        }),
      });

      const { next_number } = await service.generateNextNumber('series-1');
      expect(next_number).toBe('FEED-0001');
    });

    it('should reject when No. Series is blocked', async () => {
      const seriesRow = {
        id: 'series-1',
        code: 'FEED',
        blocked: true,
      };

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([seriesRow]),
            }),
          }),
        }),
      });

      await expect(service.generateNextNumber('series-1')).rejects.toThrow(
        new BadRequestException('No. Series [FEED] is blocked. Cannot generate item number.')
      );
    });

    it('should return HTTP 503 when lock wait timeout occurs', async () => {
      const lockError: any = new Error('Lock wait timeout exceeded; try restarting transaction');
      lockError.code = 'ER_LOCK_WAIT_TIMEOUT';
      lockError.errno = 1205;

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              for: jest.fn().mockRejectedValue(lockError),
            }),
          }),
        }),
      });

      await expect(service.generateNextNumber('series-1')).rejects.toThrow(
        new HttpException('Item code generation busy, please retry.', HttpStatus.SERVICE_UNAVAILABLE)
      );
    });
  });

  describe('is_default auto-uncheck', () => {
    it('should automatically unset is_default on existing series for same master type on create', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      mockDbInsert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue({}),
      });

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              id: 'series-2',
              code: 'NS-VEND',
              document_type: 'SUPPLIER',
              is_default: true,
            }]),
          }),
        }),
      });

      await service.create({
        code: 'NS-VEND',
        document_type: 'SUPPLIER',
        is_default: true,
      });

      expect(mockDbUpdate).toHaveBeenCalledWith(schema.noSeries);
    });
  });

  describe('update', () => {
    it('should automatically unset is_default on other series for same master type when updated to is_default = true', async () => {
      // findOne mock
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'series-1',
                code: 'NS-SUP-1',
                document_type: 'SUPPLIER',
                is_default: false,
              }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'series-1',
                code: 'NS-SUP-1',
                document_type: 'SUPPLIER',
                is_default: true,
              }]),
            }),
          }),
        });

      await service.update('series-1', {
        is_default: true,
      });

      expect(mockDbUpdate).toHaveBeenCalledWith(schema.noSeries);
    });
  });
});

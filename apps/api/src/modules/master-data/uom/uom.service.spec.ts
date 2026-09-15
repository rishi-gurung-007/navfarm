import { Test, TestingModule } from '@nestjs/testing';
import { UomService } from './uom.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';

describe('UomService', () => {
  let service: UomService;
  let auditLogService: AuditLogService;

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
        UomService,
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
      ],
    }).compile();

    service = module.get<UomService>(UomService);
    auditLogService = module.get<AuditLogService>(AuditLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rechecks base uniqueness when an existing base changes type', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({ uom_id: 'id', tenant_id: 'tenant', company_id: null, uom_code: 'KG', uom_type: 'WEIGHT', is_base_uom: true } as any);
    mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ uom_code: 'LITER' }] }) }) });
    await expect(service.update('id', { uom_type: 'VOLUME' }, 'tenant')).rejects.toThrow('A base UOM');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('should throw ConflictException if UOM code already exists', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ uom_code: 'KG' }]),
          }),
        }),
      });

      await expect(
        service.create(
          {
            uom_code: 'KG',
            uom_name: 'Kilogram',
            uom_type: 'WEIGHT',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if base UOM of this type already exists', async () => {
      // First select (check duplicate code) returns empty
      // Second select (check base UOM) returns existing base UOM
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
              limit: jest.fn().mockResolvedValue([{ uom_code: 'KILOGRAM', is_base_uom: true }]),
            }),
          }),
        });

      await expect(
        service.create(
          {
            uom_code: 'KG',
            uom_name: 'Kilogram',
            uom_type: 'WEIGHT',
            is_base_uom: true,
          },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully insert UOM and log audit trail', async () => {
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
              limit: jest.fn().mockResolvedValue([{ uom_code: 'KG', uom_name: 'Kilogram' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          uom_code: 'KG',
          uom_name: 'Kilogram',
          uom_type: 'WEIGHT',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(auditLogService.log).toHaveBeenCalled();
      expect(result.uom_code).toBe('KG');
    });

    it('generates the code via a uom_type series when one is configured', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('UOM_WEIGHT');
      numberSeries.lockSeries.mockResolvedValue({ allow_manual: false });
      numberSeries.generateNext.mockResolvedValue('WGT-001');
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // no duplicate
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ uom_code: 'WGT-001', uom_name: 'Weight unit' }]) }) }) }); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create({ uom_name: 'Weight unit', uom_type: 'WEIGHT' }, 'tenant-123');

      expect(numberSeries.resolveSeriesFor).toHaveBeenCalledWith('UOM', 'WEIGHT', 'tenant-123', null);
      expect(numberSeries.generateNext).toHaveBeenCalledWith('UOM_WEIGHT', 'tenant-123', null, undefined, expect.any(Object));
      expect(result.uom_code).toBe('WGT-001');
    });

    it('rejects when neither a series nor a manual code is supplied', async () => {
      await expect(service.create({ uom_name: 'Weight unit', uom_type: 'WEIGHT' } as any, 'tenant-123'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if UOM not found', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveConversionFactor & convertQuantity', () => {
    it('returns 1.0 when fromUom equals toUom', async () => {
      const res = await service.convertQuantity('KG', 'KG', 10);
      expect(res.conversionFactor).toBe(1.0);
      expect(res.convertedQuantity).toBe(10);
    });

    it('resolves item-specific conversion factor', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              { conversion_factor: '50.00000000', from_uom: 'BAG', to_uom: 'KG', item_id: 'item-feed' },
            ]),
          }),
        }),
      });

      const res = await service.convertQuantity('BAG', 'KG', 3, 'item-feed');
      expect(res.conversionFactor).toBe(50);
      expect(res.convertedQuantity).toBe(150);
    });
  });

  describe('findAllConversions', () => {
    // Real SQL, not a spy: the list contract is only kept if the rendered
    // ORDER BY and WHERE actually change. Same idiom as master-data-scope.spec.
    const dialect = new MySqlDialect();
    const sqlOf = (chunk: any) => dialect.sqlToQuery(chunk);

    // Builds a fresh select() chain the two queries findAllConversions issues
    // (page + count) consume in order.
    const mockListChain = () => {
      const limitMock = jest.fn().mockReturnValue({ offset: jest.fn().mockResolvedValue([]) });
      const orderByMock = jest.fn().mockReturnValue({ limit: limitMock });
      const dataWhereMock = jest.fn().mockReturnValue({ orderBy: orderByMock });
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: dataWhereMock }) });
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ total: 4 }]) }),
      });
      return { orderByMock, dataWhereMock };
    };

    it('orders by the requested column and direction — was hardcoded to from_uom asc, ignoring sort and dir', async () => {
      const asc = mockListChain();
      await service.findAllConversions({ sort: 'conversion_code', dir: 'asc' } as any, 'tenant-1');
      const desc = mockListChain();
      await service.findAllConversions({ sort: 'conversion_code', dir: 'desc' } as any, 'tenant-1');

      const ascSql = sqlOf(asc.orderByMock.mock.calls[0][0]).sql;
      const descSql = sqlOf(desc.orderByMock.mock.calls[0][0]).sql;

      expect(ascSql).toContain('`conversion_code`');
      expect(ascSql).toContain('asc');
      expect(descSql).toContain('`conversion_code`');
      expect(descSql).toContain('desc');
      expect(ascSql).not.toEqual(descSql);
    });

    it('narrows by filter[from_uom] via the shared list contract — was never applied before', async () => {
      const { dataWhereMock } = mockListChain();

      await service.findAllConversions({ filter: { from_uom: 'KG' } } as any, 'tenant-1');

      const where = sqlOf(dataWhereMock.mock.calls[0][0]);
      expect(where.sql).toContain('`from_uom`');
      expect(where.params).toContain('KG');
    });

    it('applies ?search across the code and both units — the list screen sends it on every keystroke', async () => {
      const { dataWhereMock } = mockListChain();

      await service.findAllConversions({ search: 'KG' } as any, 'tenant-1');

      // Undeclared on the DTO this 400s the whole screen instead, because the
      // global pipe runs forbidNonWhitelisted.
      const where = sqlOf(dataWhereMock.mock.calls[0][0]);
      expect(where.sql).toContain('`conversion_code` like');
      expect(where.sql).toContain('`from_uom` like');
      expect(where.sql).toContain('`to_uom` like');
      expect(where.params).toContain('%KG%');
    });

    it('reports the total alongside the page, so the screen can page in SQL', async () => {
      mockListChain();

      const result = await service.findAllConversions({ limit: 25, offset: 50 } as any, 'tenant-1');

      expect(result).toEqual({ data: [], total: 4, limit: 25, offset: 50 });
    });
  });
});

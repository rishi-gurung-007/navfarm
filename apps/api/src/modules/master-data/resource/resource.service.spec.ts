import { Test, TestingModule } from '@nestjs/testing';
import { ResourceService } from './resource.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';

describe('ResourceService', () => {
  let service: ResourceService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockEnsureCompanySeries = jest.fn();
  const mockGenerateNext = jest.fn();
  const mockEditedCode = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
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
    mockEnsureCompanySeries.mockReset().mockResolvedValue(undefined);
    mockGenerateNext.mockReset().mockResolvedValue('RES-001');
    mockEditedCode.mockReset().mockImplementation((_master, supplied) => Promise.resolve(supplied));
    nobLobResolution.resolve.mockReset();
    nobLobResolution.resolve.mockImplementation(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceService,
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
        {
          provide: NumberSeriesService,
          useValue: {
            ensureCompanySeries: mockEnsureCompanySeries,
            generateNext: mockGenerateNext,
            editedCode: mockEditedCode,
          },
        },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<ResourceService>(ResourceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if company does not exist', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]), // company not found
          }),
        }),
      });

      await expect(
        service.create(
          {
            company_id: 'non-existent-comp',
            resource_code: 'LBR-01',
            resource_name: 'Senior Laborer',
            resource_type: 'LABOR',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a resource with the per-company generated code', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ resource_code: 'RES-001', resource_name: 'Senior Laborer' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          company_id: 'comp-1',
          resource_name: 'Senior Laborer',
          resource_type: 'LABOR',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockEnsureCompanySeries).toHaveBeenCalledWith(
        'tenant-123',
        'comp-1',
        expect.objectContaining({ seriesCode: 'RESOURCE', prefix: 'RES', seqLength: 3 }),
        expect.any(Function),
      );
      expect(mockGenerateNext).toHaveBeenCalledWith('RESOURCE', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(result.resource_code).toBe('RES-001');
    });
  });

  describe('update', () => {
    it('refuses to change the resource code after it is created', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ resource_id: 'r-1', company_id: 'comp-1', resource_code: 'RES-001', resource_type: 'EQUIPMENT' }]) }) }),
      });

      await expect(service.update('r-1', { resource_code: 'RES-099' }, 'tenant-123')).rejects.toThrow(BadRequestException);
      expect(mockEditedCode).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('accepts an update that repeats the stored resource code', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ resource_id: 'r-1', company_id: 'comp-1', resource_code: 'RES-001', resource_type: 'EQUIPMENT' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ resource_id: 'r-1', company_id: 'comp-1', resource_code: 'RES-001', resource_type: 'EQUIPMENT' }]) }) }),
        });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const res = await service.update('r-1', { resource_code: 'res-001' }, 'tenant-123');
      expect(res.resource_code).toBe('RES-001');
    });
  });
});

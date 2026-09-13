import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';

describe('ActivityService', () => {
  let service: ActivityService;
  let mockCls: any;
  let mockAudit: any;
  let mockNobLobResolution: any;
  let mockDb: any;

  beforeEach(async () => {
    mockDb = {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
    };

    mockCls = {
      get: jest.fn((key: string) => {
        if (key === 'tenantDb') return mockDb;
        if (key === 'masterScope') return { kind: 'OPERATIONAL', companyId: 'comp-1', nobId: 'nob-pig', lobId: 'lob-pig', tenantId: 'tenant-1' };
        return null;
      }),
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    mockNobLobResolution = {
      resolve: jest.fn().mockResolvedValue({
        nob_id: 'nob-pig',
        lob_id: 'lob-pig',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityService,
        { provide: ClsService, useValue: mockCls },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: NobLobResolutionService, useValue: mockNobLobResolution },
      ],
    }).compile();

    service = module.get<ActivityService>(ActivityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('auto-resolves company, nob, and lob when creating in operational workspace', async () => {
      // Mock duplicate check returning empty
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // Mock insert
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      // Mock findOne inside log
      const createdRow = {
        activity_id: 'act-1',
        activity_code: 'MORN_FEED',
        activity_name: 'Morning Feed',
        line_type: 'CONSUMPTION',
        company_id: 'comp-1',
        nob_id: 'nob-pig',
        lob_id: 'lob-pig',
        tenant_id: 'tenant-1',
        is_active: true,
      };

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([createdRow]),
          }),
        }),
      });

      const result = await service.create(
        {
          activity_code: 'MORN_FEED',
          activity_name: 'Morning Feed',
          line_type: 'CONSUMPTION',
        },
        'tenant-1',
        { userId: 'user-1' },
      );

      expect(mockNobLobResolution.resolve).toHaveBeenCalledWith('tenant-1', 'comp-1', {
        nob_id: undefined,
        lob_id: undefined,
      });
      expect(result.activity_code).toBe('MORN_FEED');
      expect(result.company_id).toBe('comp-1');
      expect(result.nob_id).toBe('nob-pig');
      expect(result.lob_id).toBe('lob-pig');
    });

    it('throws ConflictException if code already exists in scope', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ activity_id: 'dup-1' }]),
          }),
        }),
      });

      await expect(
        service.create(
          {
            activity_code: 'MORN_FEED',
            activity_name: 'Morning Feed',
            line_type: 'CONSUMPTION',
          },
          'tenant-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException if not found', async () => {
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne('non-existent', 'tenant-1')).rejects.toThrow(NotFoundException);
    });
  });
});

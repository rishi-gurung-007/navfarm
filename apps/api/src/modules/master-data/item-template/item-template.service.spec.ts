import { Test, TestingModule } from '@nestjs/testing';
import { ItemTemplateService } from './item-template.service';
import { ClsService } from 'nestjs-cls';
import { BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';

describe('ItemTemplateService', () => {
  let service: ItemTemplateService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb: any = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemTemplateService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
      ],
    }).compile();

    service = module.get<ItemTemplateService>(ItemTemplateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should reject when no_series_id is missing', async () => {
      await expect(
        service.create({
          template_code: 'TMPL-FEED',
          template_description: 'Feed Template',
          no_series_id: '',
        } as any)
      ).rejects.toThrow(new BadRequestException('No. Series is mandatory on Item Template.'));
    });

    it('should reject when item_tracking is LOT and item_tracking_no_series_id is missing', async () => {
      await expect(
        service.create({
          template_code: 'TMPL-MED',
          no_series_id: 'series-1',
          item_tracking: 'LOT',
        } as any)
      ).rejects.toThrow(
        new BadRequestException('Item Tracking No. Series is required when Item Tracking is LOT or SERIAL.')
      );
    });

    it('should reject when linked no_series_id does not exist', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.create({
          template_code: 'TMPL-FEED',
          no_series_id: 'series-nonexistent',
        })
      ).rejects.toThrow(NotFoundException);
    });

    it('should create template successfully', async () => {
      // 1. check noSeries exists
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'series-1' }]),
          }),
        }),
      });

      // 2. check duplicate template_code
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // 3. insert
      mockDbInsert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue({}),
      });

      // 4. findOne
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                id: 'tmpl-1',
                template_code: 'TMPL-FEED',
                template_description: 'Feed Template',
                is_active: true,
              }]),
            }),
          }),
        }),
      });

      const result = await service.create({
        template_code: 'TMPL-FEED',
        template_description: 'Feed Template',
        no_series_id: 'series-1',
      });

      expect(result.template_code).toBe('TMPL-FEED');
    });
  });

  describe('findAllActive', () => {
    it('should return active templates joined with no_series', async () => {
      const activeTemplates = [
        {
          id: 'tmpl-1',
          template_code: 'TMPL-FEED',
          template_description: 'Feed Template',
          item_type: 'FEED',
          no_series_code: 'FEED',
          no_series_description: 'Feed Series',
          valuation_method: 'FIFO',
          is_active: true,
        },
      ];

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(activeTemplates),
          }),
        }),
      });

      const result = await service.findAllActive('tenant-1', 'comp-1');
      expect(result).toHaveLength(1);
      expect(result[0].template_code).toBe('TMPL-FEED');
    });
  });
});

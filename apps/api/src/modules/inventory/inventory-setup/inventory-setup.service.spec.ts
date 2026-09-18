import { Test, TestingModule } from '@nestjs/testing';
import { InventorySetupService } from './inventory-setup.service';
import { ClsService } from 'nestjs-cls';

describe('InventorySetupService', () => {
  let service: InventorySetupService;

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
    mockDbUpdate.mockReset().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue({}),
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventorySetupService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
      ],
    }).compile();

    service = module.get<InventorySetupService>(InventorySetupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSetup', () => {
    it('should return merged setup with default series when no record exists', async () => {
      // 1. inventory_setup select -> empty
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // 2. no_series select -> some series
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              {
                id: 'item-series-1',
                code: 'ITEM',
                document_type: 'ITEM',
                is_default: true,
                manual_nos: false,
              },
            ]),
          }),
        }),
      });

      const res = await service.getSetup('tenant-1', 'company-1');
      expect(res.company_id).toBe('company-1');
      expect(res.numbering_config.ITEM.enabled).toBe(true);
      expect(res.numbering_config.ITEM.default_series_id).toBe('item-series-1');
      expect(res.numbering_config.CUSTOMER.enabled).toBe(false);
    });
  });

  describe('updateSetup', () => {
    it('should save numbering config and update default series', async () => {
      // 1. check existing setup -> none
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

      // inside getSetup after update
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              id: 'setup-1',
              tenant_id: 'tenant-1',
              company_id: 'company-1',
              numbering_config: { ITEM: { enabled: true, default_series_id: 'item-series-1' } },
            }]),
          }),
        }),
      });

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              {
                id: 'item-series-1',
                code: 'ITEM',
                document_type: 'ITEM',
                is_default: true,
              },
            ]),
          }),
        }),
      });

      const res = await service.updateSetup('tenant-1', 'company-1', {
        company_id: 'company-1',
        numbering_config: {
          ITEM: { enabled: true, default_series_id: 'item-series-1' },
        },
      });

      expect(res.numbering_config.ITEM.enabled).toBe(true);
      expect(mockDbUpdate).toHaveBeenCalled();
    });
  });
});

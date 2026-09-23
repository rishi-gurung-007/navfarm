import { Test, TestingModule } from '@nestjs/testing';
import { FeedFormulaService } from './feed-formula.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('FeedFormulaService', () => {
  let service: FeedFormulaService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockTransaction: jest.Mock = jest.fn((callback) => callback(mockDb));

  // Annotated because `transaction` hands the callback this same object,
  // which makes the type circular and otherwise implicitly `any`.
  const mockDb: any = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockTransaction,
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
    mockTransaction.mockClear();
    numberSeries.resolveSeriesFor.mockReset();
    numberSeries.generateNext.mockReset();
    numberSeries.lockSeries.mockReset();
    numberSeries.resolveSeriesFor.mockResolvedValue(null); // default: manual, as today

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedFormulaService,
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

    service = module.get<FeedFormulaService>(FeedFormulaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw BadRequestException if no ingredients are provided', async () => {
      await expect(
        service.create(
          {
            company_id: 'comp-1',
            formula_code: 'FORM01',
            formula_name: 'Broiler Starter',
            target_item_id: 'item-target',
            batch_size: 1000,
            batch_unit: 'KG',
            ingredients: [],
          },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

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
            formula_code: 'FORM01',
            formula_name: 'Broiler Starter',
            target_item_id: 'item-target',
            batch_size: 1000,
            batch_unit: 'KG',
            ingredients: [{ item_id: 'raw-1', quantity: 500, unit: 'KG' }],
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if target item does not exist', async () => {
      // First select: finds company
      // Second select: does not find target item
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
              limit: jest.fn().mockResolvedValue([]), // item not found
            }),
          }),
        });

      await expect(
        service.create(
          {
            company_id: 'comp-1',
            formula_code: 'FORM01',
            formula_name: 'Broiler Starter',
            target_item_id: 'non-existent-item',
            batch_size: 1000,
            batch_unit: 'KG',
            ingredients: [{ item_id: 'raw-1', quantity: 500, unit: 'KG' }],
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should successfully create feed formula header and ingredients inside transaction', async () => {
      // 1. Company select -> found
      // 2. Target item select -> found
      // 3. Formula duplicate code check select -> empty
      // 4. Ingredient item select -> found
      // 5. FindOne selects (formula & ingredients)
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
              limit: jest.fn().mockResolvedValue([{ item_id: 'item-target' }]),
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
              limit: jest.fn().mockResolvedValue([{ item_id: 'raw-1' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ formula_id: 'form-1', formula_code: 'FORM01' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ ingredient_id: 'ingr-1', item_id: 'raw-1' }]),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          company_id: 'comp-1',
          formula_code: 'FORM01',
          formula_name: 'Broiler Starter',
          target_item_id: 'item-target',
          batch_size: 1000,
          batch_unit: 'KG',
          ingredients: [{ item_id: 'raw-1', quantity: 500, unit: 'KG' }],
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockDbInsert).toHaveBeenCalledTimes(2); // 1 header + 1 ingredient
      expect(result.formula_code).toBe('FORM01');
      expect(result.ingredients.length).toBe(1);
    });

    it('generates the formula code via the resolved series when one is configured', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('FEED_FORMULA');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false });
      numberSeries.generateNext.mockResolvedValue('FF-001');

      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) }) // company
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'item-target' }]) }) }) }) // target item
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }) // duplicate check (none)
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'raw-1' }]) }) }) }) // ingredient item
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ formula_id: 'form-1', formula_code: 'FF-001' }]) }) }) }) // findOne formula
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ ingredient_id: 'ingr-1', item_id: 'raw-1' }]) }) }); // findOne ingredients

      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create(
        {
          company_id: 'comp-1',
          formula_name: 'Broiler Starter',
          target_item_id: 'item-target',
          batch_size: 1000,
          batch_unit: 'KG',
          ingredients: [{ item_id: 'raw-1', quantity: 500, unit: 'KG' }],
        },
        'tenant-123',
      );

      expect(numberSeries.generateNext).toHaveBeenCalledWith('FEED_FORMULA', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(result.formula_code).toBe('FF-001');
    });
  });
});

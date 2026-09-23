import { Test, TestingModule } from '@nestjs/testing';
import { ItemTypeService } from './item-type.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('ItemTypeService', () => {
  let service: ItemTypeService;

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
    renameCode: jest.fn(),
  };

  const makeSelectResult = (rows: any[]) => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  });

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    numberSeries.resolveSeriesFor.mockReset();
    numberSeries.generateNext.mockReset();
    numberSeries.lockSeries.mockReset();
    numberSeries.renameCode.mockReset();
    numberSeries.resolveSeriesFor.mockResolvedValue(null); // default: manual, as today
    numberSeries.renameCode.mockResolvedValue('RENAMED');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemTypeService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: numberSeries },
      ],
    }).compile();

    service = module.get<ItemTypeService>(ItemTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — manual entry (no series configured)', () => {
    it('throws ConflictException on a duplicate type code in scope', async () => {
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ type_code: 'RAW_MATERIAL' }])); // duplicate hit

      await expect(
        service.create({ type_code: 'RAW_MATERIAL', type_name: 'Raw Material' }, 'tenant-123'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when neither a series nor a manual type_code is supplied', async () => {
      await expect(service.create({ type_name: 'Raw Material' } as any, 'tenant-123'))
        .rejects.toThrow(BadRequestException);
    });

    it('creates using the user-supplied code and defaults code_prefix to it when not given', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ type_code: 'RAW_MATERIAL', code_prefix: 'RAW_MATERIAL', type_name: 'Raw Material' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create({ type_code: 'raw_material', type_name: 'Raw Material' }, 'tenant-123', { userId: 'user-1' });

      const inserted = (mockDbInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
      expect(inserted.type_code).toBe('RAW_MATERIAL');
      expect(inserted.code_prefix).toBe('RAW_MATERIAL');
      expect(result.type_code).toBe('RAW_MATERIAL');
    });

    it('uses the explicit code_prefix over the type_code default when supplied', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ type_code: 'RAW_MATERIAL', code_prefix: 'RAW', type_name: 'Raw Material' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.create({ type_code: 'RAW_MATERIAL', code_prefix: 'raw', type_name: 'Raw Material' }, 'tenant-123');

      const inserted = (mockDbInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
      expect(inserted.code_prefix).toBe('RAW');
    });
  });

  describe('update', () => {
    const systemType = {
      item_type_id: 'type-1', type_code: 'MEDICINE', type_name: 'Medicine',
      company_id: null, is_system: true, is_active: true, status: 'ACTIVE',
    };
    const tenantType = { ...systemType, item_type_id: 'type-2', type_code: 'FEED', type_name: 'Feed', is_system: false };

    const mockUpdateChain = () => {
      const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) });
      mockDbUpdate.mockReturnValue({ set });
      return set;
    };

    // item.service.ts gates withdrawal_days on the literal strings 'MEDICINE'
    // and 'VACCINE', so a caller-supplied code smuggled past the DTO must
    // never reach the database — the series rename is the only writer.
    it('never writes a type_code when no name change is requested, even when a caller smuggles one past the DTO', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([systemType])) // findOne
        .mockReturnValueOnce(makeSelectResult([systemType])); // findOne after update
      const set = mockUpdateChain();

      await service.update('type-1', { type_name: 'Medicine', type_code: 'MED' } as any, 'tenant-123');

      expect(set.mock.calls[0][0].type_code).toBeUndefined();
      expect(numberSeries.renameCode).not.toHaveBeenCalled();
    });

    // The ITEM_TYPE series is a named one: the code derives from the type
    // name, so renaming the type recomposes the code from the new name.
    it('recomposes the type_code from the new name via the series rename on a real rename', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([tenantType])) // findOne
        .mockReturnValueOnce(makeSelectResult([{ ...tenantType, type_name: 'Feed concentrate' }])); // findOne after update
      const set = mockUpdateChain();

      await service.update('type-2', { type_name: 'Feed concentrate' }, 'tenant-123');

      expect(numberSeries.renameCode).toHaveBeenCalledWith(
        'ITEM_TYPE',
        expect.objectContaining({ type_name: 'Feed concentrate' }),
        'tenant-123',
        tenantType.company_id,
      );
      expect(set.mock.calls[0][0].type_code).toBe('RENAMED');
    });

    it('refuses to deactivate a system item type', async () => {
      mockDbSelect.mockReturnValueOnce(makeSelectResult([systemType]));

      await expect(service.update('type-1', { is_active: false }, 'tenant-123'))
        .rejects.toThrow(ConflictException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses to move a system item type off ACTIVE status', async () => {
      mockDbSelect.mockReturnValueOnce(makeSelectResult([systemType]));

      await expect(service.update('type-1', { status: 'INACTIVE' }, 'tenant-123'))
        .rejects.toThrow(ConflictException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('still allows the editable fields on a system item type', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([systemType]))
        .mockReturnValueOnce(makeSelectResult([{ ...systemType, description: 'Vet supplies' }]));
      const set = mockUpdateChain();

      const result = await service.update('type-1', { description: 'Vet supplies' }, 'tenant-123');

      expect(set.mock.calls[0][0].description).toBe('Vet supplies');
      expect(result.description).toBe('Vet supplies');
    });

    it('still allows a non-system type to be deactivated', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([tenantType]))
        .mockReturnValueOnce(makeSelectResult([{ ...tenantType, is_active: false }]));
      const set = mockUpdateChain();

      await service.update('type-2', { is_active: false }, 'tenant-123');

      expect(set.mock.calls[0][0].is_active).toBe(false);
    });
  });

  describe('remove', () => {
    const inUseType = {
      item_type_id: 'type-2', type_code: 'FEED', type_name: 'Feed',
      company_id: 'comp-1', is_system: false, is_active: true, status: 'ACTIVE',
    };

    it('refuses to delete an item type that items still reference', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([inUseType])) // findOne
        .mockReturnValueOnce(makeSelectResult([{ id: 'item-1' }])); // usage probe

      await expect(service.remove('type-2', 'tenant-123'))
        .rejects.toThrow(/is already used by an item and cannot be deleted/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('soft-deletes an item type no item references', async () => {
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([inUseType])) // findOne
        .mockReturnValueOnce(makeSelectResult([])); // usage probe: none
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const result = await service.remove('type-2', 'tenant-123');

      expect(result.success).toBe(true);
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it('still refuses to delete a system item type', async () => {
      mockDbSelect.mockReturnValueOnce(makeSelectResult([{ ...inUseType, is_system: true }]));

      await expect(service.remove('type-2', 'tenant-123')).rejects.toThrow(ConflictException);
    });
  });

  describe('create — auto-generated (a series is configured for ITEM_TYPE)', () => {
    it('generates the type_code via the resolved series', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_TYPE');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: false });
      numberSeries.generateNext.mockResolvedValue('ITYPE-001');
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ type_code: 'ITYPE-001', code_prefix: 'ITYPE-001', type_name: 'Raw Material' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create({ type_name: 'Raw Material' }, 'tenant-123');

      expect(numberSeries.generateNext).toHaveBeenCalledWith('ITEM_TYPE', 'tenant-123', null, undefined, expect.any(Object));
      expect(result.type_code).toBe('ITYPE-001');
    });

    it('uses the user-supplied code without generating when the series has allow_manual set', async () => {
      numberSeries.resolveSeriesFor.mockResolvedValue('ITEM_TYPE');
      numberSeries.lockSeries.mockResolvedValue({ manual_nos: true });
      mockDbSelect
        .mockReturnValueOnce(makeSelectResult([])) // no duplicate
        .mockReturnValueOnce(makeSelectResult([{ type_code: 'CUSTOM', code_prefix: 'CUSTOM', type_name: 'Raw Material' }])); // findOne
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create({ type_name: 'Raw Material', type_code: 'custom' }, 'tenant-123');

      expect(numberSeries.generateNext).not.toHaveBeenCalled();
      expect(result.type_code).toBe('CUSTOM');
    });
  });
});

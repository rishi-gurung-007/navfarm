import { Test, TestingModule } from '@nestjs/testing';
import { AnimalMedicationLogService } from './animal-medication-log.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NotFoundException } from '@nestjs/common';

describe('AnimalMedicationLogService', () => {
  let service: AnimalMedicationLogService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();

  const mockDb = { select: mockDbSelect, insert: mockDbInsert };

  const found = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnimalMedicationLogService,
        { provide: ClsService, useValue: { get: jest.fn((key: string) => key === 'tenantDb' ? mockDb : undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<AnimalMedicationLogService>(AnimalMedicationLogService);
  });

  describe('create', () => {
    it('rejects an unknown animal', async () => {
      mockDbSelect.mockReturnValueOnce(found([]));

      await expect(
        service.create('missing-animal', { item_id: 'item-1', administered_date: '2026-06-01' }, 'tenant-123'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('rejects an unknown item', async () => {
      mockDbSelect
        .mockReturnValueOnce(found([{ animal_id: 'a-1', company_id: 'comp-1' }]))
        .mockReturnValueOnce(found([]));

      await expect(
        service.create('a-1', { item_id: 'missing-item', administered_date: '2026-06-01' }, 'tenant-123'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('inserts and returns the new log row', async () => {
      mockDbSelect
        .mockReturnValueOnce(found([{ animal_id: 'a-1', company_id: 'comp-1' }]))
        .mockReturnValueOnce(found([{ item_id: 'item-1', item_type: 'MEDICINE' }]))
        .mockReturnValueOnce(found([{ log_id: 'log-1', animal_id: 'a-1', item_id: 'item-1', administered_date: '2026-06-01' }]));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.create('a-1', { item_id: 'item-1', administered_date: '2026-06-01' }, 'tenant-123', { userId: 'user-1' });

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result.log_id).toBe('log-1');
    });
  });

  describe('findByAnimal', () => {
    it('returns the medication log ordered most-recent-first', async () => {
      mockDbSelect
        .mockReturnValueOnce(found([{ animal_id: 'a-1' }]))
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockResolvedValue([{ log_id: 'log-1' }]) }),
          }),
        });

      const result = await service.findByAnimal('a-1');

      expect(result).toEqual([{ log_id: 'log-1' }]);
    });
  });
});

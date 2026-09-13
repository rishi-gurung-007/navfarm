import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchTransferService } from './batch-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import * as schema from '../../../core/database/schema';

describe('BatchTransferService', () => {
  let service: BatchTransferService;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  };

  const draftTransfer = {
    transfer_id: 'tr-1',
    tenant_id: 'tenant-123',
    company_id: 'comp-1',
    from_batch_id: 'batch-gest',
    to_batch_id: 'batch-farrow',
    status: 'DRAFT',
    transfer_date: '2026-08-01',
    lines: [
      { animal_id: 'a-1', book_value: '28000.0000', to_location_id: 'loc-farrow-1' },
      { animal_id: 'a-2', book_value: '28000.0000', to_location_id: 'loc-farrow-1' },
    ],
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchTransferService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn().mockResolvedValue('BTR-2026-0001') } },
        { provide: SchedulerHeaderService, useValue: { createForStage: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<BatchTransferService>(BatchTransferService);
  });

  describe('splitBatch', () => {
    const parent = {
      batch_id: 'batch-gest', batch_no: 'PIG-BAT-2026-0001', tenant_id: 'tenant-123', company_id: 'comp-1',
      nob_id: 'nob-1', lob_id: 'lob-1', breed_id: 'breed-1',
      costing_method: 'BIO_ASSET', current_stage_code: 'DRY_SOW_GESTATION', stage_id: 'stage-gest',
      shed_id: 'shed-1', location_id: 'pen-1', status: 'ACTIVE',
      opening_quantity: '11.0000', closing_quantity: '11.0000', uom: 'HEAD',
      start_date: '2026-03-06', operational_area_id: 'area-1',
    };

    it('creates a child batch that records the cohort it came out of', async () => {
      // The three sows that failed the scan stay behind as their own batch, so
      // they keep a stage, a schedule and a pen of their own — but the link back
      // to the cohort is what lets a report roll them together again.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      const result = await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1', 'a-2'], transfer_date: '2026-09-01', reason: 'PREGNANCY_FAILED' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const childHeader = inserted.find((v) => v.parent_batch_id);
      expect(childHeader.parent_batch_id).toBe('batch-gest');
      expect(childHeader.current_stage_code).toBe('DRY_SOW_GESTATION');
      expect(childHeader.opening_quantity).toBe('2.0000');
      expect(childHeader.breed_id).toBe('breed-1');
      expect(result.child.batch_no).toBeDefined();
    });

    it('delegates the animal movement to a PARTIAL transfer rather than repeating it', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      const create = jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1', 'a-2'], transfer_date: '2026-09-01' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const [dto, , fromBatchId] = create.mock.calls[0];
      expect(fromBatchId).toBe('batch-gest');
      expect(dto.transfer_type).toBe('PARTIAL');
      expect(dto.animal_ids).toEqual(['a-1', 'a-2']);
    });

    it('refuses an empty selection', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      await expect(
        service.splitBatch('batch-gest', { animal_ids: [], transfer_date: '2026-09-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves the held stage to a real stage id so the animals actually move to it', async () => {
      // post() sets each moved animal's current_stage_id from the destination
      // batch's stage_id. Leaving that null meant the group's animals silently
      // kept the parent's stage while the child batch claimed another one.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({} as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-flush' }]) }),
        }),
      });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', hold_stage_code: 'FLUSH_SERVICE' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(inserted.find((v) => v.parent_batch_id).stage_id).toBe('stage-flush');
    });

    it('can hold the split group at a different stage from the parent', async () => {
      // Sows returned to service sit at FLUSH_SERVICE while the cohort gestates.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({} as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-flush' }]) }),
        }),
      });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', hold_stage_code: 'FLUSH_SERVICE' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(inserted.find((v) => v.parent_batch_id).current_stage_code).toBe('FLUSH_SERVICE');
    });
  });

  describe('mergeBatch', () => {
    const child = {
      batch_id: 'batch-hold', batch_no: 'PIG-BAT-2026-0003', tenant_id: 'tenant-123', company_id: 'comp-1',
      parent_batch_id: 'batch-gest', status: 'ACTIVE', closing_quantity: '2.0000',
    };

    it('moves the group back to its parent and closes the child', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      const create = jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-2' } as any);
      jest.spyOn(service as any, 'liveAnimalIds').mockResolvedValue(['a-1', 'a-2']);
      const sets: any[] = [];
      mockDbUpdate.mockReturnValue({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) });

      const result = await service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123', { userId: 'u' });

      const [dto, , fromBatchId] = create.mock.calls[0];
      expect(fromBatchId).toBe('batch-hold');
      expect(dto.to_batch_id).toBe('batch-gest');
      expect(dto.animal_ids).toEqual(['a-1', 'a-2']);
      expect(sets.some((v) => v.status === 'CLOSED')).toBe(true);
      expect(result.merged).toBe(2);
    });

    it('refuses to merge a batch that was never split out of anything', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue({ ...child, parent_batch_id: null });
      await expect(
        service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to merge a group with no live animals left', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      jest.spyOn(service as any, 'liveAnimalIds').mockResolvedValue([]);
      await expect(
        service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('post', () => {
    it('moves the transferred animals onto the destination batch stage', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any) // load for posting
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any); // final return

      // Isolate the value/ledger side effects — this test is about the animals.
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ animal_id: 'a-1' }, { animal_id: 'a-2' }]),
          }),
        }) // stillLive guard
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-farrowing' }]),
            }),
          }),
        }); // destination batch stage

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      expect(mockDbUpdate.mock.calls[0][0]).toBe(schema.animalRegister);
      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(animalSet.current_batch_id).toBe('batch-farrow');
      expect(animalSet.current_stage_id).toBe('stage-farrowing');
    });
  });
});

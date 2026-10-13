import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchTransferService } from './batch-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import * as schema from '../../../core/database/schema';

describe('BatchTransferService', () => {
  let service: BatchTransferService;
  let module: TestingModule;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbTransaction = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
    transaction: mockDbTransaction,
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
      {
        animal_id: 'a-1',
        book_value: '28000.0000',
        to_location_id: 'loc-farrow-1',
      },
      {
        animal_id: 'a-2',
        book_value: '28000.0000',
        to_location_id: 'loc-farrow-1',
      },
    ],
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();
    mockDbTransaction.mockReset();
    mockDbTransaction.mockImplementation(async (cb: any) => cb(mockDb));

    module = await Test.createTestingModule({
      providers: [
        BatchTransferService,
        {
          provide: ClsService,
          // 'tenantPostingTransaction' true: a post joins the transaction the unit test stands in for.
          useValue: { get: jest.fn((key: string) => (key === 'tenantPostingTransaction' ? true : mockDb)) },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: NumberSeriesService,
          useValue: {
            generateNext: jest.fn().mockResolvedValue('BTR-2026-0001'),
          },
        },
        {
          provide: SchedulerHeaderService,
          useValue: { createForStage: jest.fn().mockResolvedValue({}), syncAnimalWiseCounts: jest.fn().mockResolvedValue(undefined), alignToStageEntry: jest.fn().mockResolvedValue(null), stageEntryDate: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
      ],
    }).compile();

    service = module.get<BatchTransferService>(BatchTransferService);
  });

  describe('stage must belong to the destination line of business (D5)', () => {
    const batch = (over: object) => ({ batch_id: 'b', batch_no: 'B', tenant_id: 'tenant-123', company_id: 'comp-1', status: 'ACTIVE', tracking_mode: 'ANIMAL_WISE', lob_id: 'lob-pig', stage_id: null, ...over });
    const lim = (rows: object[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }) });
    const setup = (pool: object[]) => {
      jest.spyOn(service as any, 'loadBatch')
        .mockResolvedValueOnce(batch({ batch_id: 'src', batch_no: 'SRC' }))
        .mockResolvedValueOnce(batch({ batch_id: 'dst', batch_no: 'DST', lob_id: 'lob-pig' }));
      jest.spyOn(service, 'listTransferableAnimals').mockResolvedValue(pool as any);
    };
    const dto = (over: object = {}) => ({ company_id: 'comp-1', to_batch_id: 'dst', transfer_date: '2026-10-01', animal_ids: ['a-1'], ...over }) as any;

    it("refuses an animal whose stage belongs to another line of business, asking for a destination stage", async () => {
      setup([{ animal_id: 'a-1', animal_code: 'CH-1', current_stage_id: 'st-poultry', gender: 'F' }]);
      mockDbSelect.mockReturnValueOnce(lim([{ stage_id: 'st-poultry', lob_id: 'lob-poultry' }]));
      await expect(service.create(dto(), 'tenant-123', 'src')).rejects.toThrow("CH-1 has no stage that belongs to DST's line of business");
    });

    it('refuses an animal with no stage at all', async () => {
      setup([{ animal_id: 'a-1', animal_code: 'PIG-1', current_stage_id: null, gender: 'F' }]);
      await expect(service.create(dto(), 'tenant-123', 'src')).rejects.toThrow('Choose a destination stage');
    });

    it('lets a named destination stage stand in for the animals’ own', async () => {
      setup([{ animal_id: 'a-1', animal_code: 'PIG-1', current_stage_id: null, gender: 'F' }]);
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'st-x', stage_name: 'X', applicable_gender: null }]) }) }) }); // named stage lookup
      // anything after the stage checks is not this test's business — it stops at the bio-asset state read
      mockDbSelect.mockImplementation(() => { throw new Error('reached past the stage checks'); });
      await expect(service.create(dto({ to_stage_id: 'st-x' }), 'tenant-123', 'src')).rejects.toThrow('reached past the stage checks');
    });
  });

  describe('reversing a posted transfer (D7)', () => {
    const posted = (over: object = {}) => ({
      transfer_id: 'tr-1', transfer_no: 'BTR-2026-0001', status: 'POSTED', transfer_basis: 'ANIMALS', company_id: 'comp-1',
      from_batch_id: 'src', to_batch_id: 'dst', transfer_date: '2026-10-01', reason: 'x', head_count: '2.0000',
      lines: [{ animal_id: 'a-1' }, { animal_id: 'a-2' }], ...over,
    });
    const noPriorReversal = () => mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) });

    it('moves the same animals straight back as a transfer of its own, naming what it undoes', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted() as any);
      noPriorReversal();
      // Where each animal stood before the transfer, from its movement log: a-1 was in Gestation, a-2 in Flush.
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ animal_id: 'a-1', from_stage_id: 'st-gest' }, { animal_id: 'a-2', from_stage_id: 'st-flush' }]) }) });
      const create = jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-2026-0002' } as any);

      await service.reverse('tr-1', { transfer_date: '2026-10-02' }, 'tenant-123', { userId: 'u' });

      const [dto, , fromBatch, , options] = create.mock.calls[0] as [any, any, any, any, any];
      expect(fromBatch).toBe('dst');
      expect(dto).toMatchObject({ to_batch_id: 'src', transfer_date: '2026-10-02', animal_ids: ['a-1', 'a-2'], reason: 'REVERSAL OF BTR-2026-0001' });
      // Each goes back to her own stage, not to one the transfer may have named — passed beside the request, never in it.
      expect(dto.return_stages).toBeUndefined();
      expect(options).toEqual({ returnStages: { 'a-1': 'st-gest', 'a-2': 'st-flush' } });
    });

    it('moves the same head back for a head-count transfer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted({ transfer_basis: 'HEADCOUNT', head_count: '40.0000', transfer_value: '84000.0000', lines: [] }) as any);
      noPriorReversal();
      const create = jest.spyOn(service, 'create').mockResolvedValue({} as any);

      await service.reverse('tr-1', {}, 'tenant-123');

      const [dto, , , , options] = create.mock.calls[0] as [any, any, any, any, any];
      expect(dto.quantity).toBe(40);
      expect(dto.animal_ids).toBeUndefined();
      // The same value goes back as the transfer moved — not the destination's average carrying value now.
      expect(options.value).toBe(84000);
    });

    it('refuses a draft (it is cancelled, not reversed)', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted({ status: 'DRAFT' }) as any);
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow('Only a POSTED transfer can be reversed');
    });

    it('refuses to reverse a reversal', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted({ reason: 'REVERSAL OF BTR-2026-0000' }) as any);
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow('cannot itself be reversed');
    });

    it('refuses a second reversal of the same transfer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted() as any);
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ transfer_no: 'BTR-2026-0002' }]) }) }) });
      const create = jest.spyOn(service, 'create');
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow('already reversed by BTR-2026-0002');
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a date before the transfer or in the future', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(posted() as any);
      noPriorReversal();
      await expect(service.reverse('tr-1', { transfer_date: '2026-09-01' }, 'tenant-123')).rejects.toThrow('before the transfer it undoes');
      noPriorReversal();
      await expect(service.reverse('tr-1', { transfer_date: '2999-01-01' }, 'tenant-123')).rejects.toThrow('in the future');
    });
  });

  describe('head-count transfer between batch-wise batches', () => {
    const batchWise = (over: object = {}) => ({
      batch_id: 'b-a', batch_no: 'WEAN-A', tenant_id: 'tenant-123', company_id: 'comp-1', status: 'ACTIVE',
      tracking_mode: 'BATCH_WISE', costing_method: 'BIO_ASSET', lob_id: 'lob-1', nob_id: 'nob-1',
      closing_quantity: '100.0000', opening_quantity: '100.0000', stage_id: 'st-1', current_stage_code: 'WEANER', ...over,
    });
    const fromTo = (source: object, destination: object) =>
      jest.spyOn(service as any, 'loadBatch').mockResolvedValueOnce(source).mockResolvedValueOnce(destination);
    const dto = (over: object = {}) => ({ company_id: 'comp-1', to_batch_id: 'b-b', transfer_date: '2026-10-01', quantity: 40, ...over }) as any;

    it('refuses a head count out of an animal-wise batch', async () => {
      fromTo(batchWise({ tracking_mode: 'ANIMAL_WISE' }), batchWise({ batch_id: 'b-b' }));
      await expect(service.create(dto(), 'tenant-123', 'b-a')).rejects.toThrow('batch-wise batches only');
    });

    it('refuses cost-accumulated batches, whose accumulated cost would also have to move', async () => {
      fromTo(batchWise({ costing_method: 'STANDARD' }), batchWise({ batch_id: 'b-b' }));
      await expect(service.create(dto(), 'tenant-123', 'b-a')).rejects.toThrow('Only bio-asset batches');
    });

    it('refuses more head than the batch holds', async () => {
      fromTo(batchWise(), batchWise({ batch_id: 'b-b' }));
      jest.spyOn(service as any, 'headOnHand').mockResolvedValue({ quantity: 30, value: 3000, perHead: 100 });
      await expect(service.create(dto({ quantity: 40 }), 'tenant-123', 'b-a')).rejects.toThrow('has 30 head; 40 cannot be moved');
    });

    it('moves the average carrying value of the head with them, and posts nothing per animal', async () => {
      fromTo(batchWise(), batchWise({ batch_id: 'b-b' }));
      jest.spyOn(service as any, 'headOnHand').mockResolvedValue({ quantity: 100, value: 25000, perHead: 250 });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      const post = jest.spyOn(service, 'post').mockResolvedValue({ status: 'POSTED' } as any);

      await service.create(dto({ quantity: 40 }), 'tenant-123', 'b-a');

      expect(inserted[0]).toMatchObject({ transfer_basis: 'HEADCOUNT', transfer_type: 'PARTIAL', head_count: '40.0000', transfer_value: '10000.0000' });
      expect(inserted.some((v) => Array.isArray(v))).toBe(false); // no transfer lines
      expect(post).toHaveBeenCalled();
    });

    it('posts: shifts head and value, writes both ledger legs, recounts the schedulers, marks it POSTED', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        transfer_id: 'tr-h', transfer_no: 'BTR-9', status: 'DRAFT', transfer_basis: 'HEADCOUNT', company_id: 'comp-1',
        from_batch_id: 'b-a', to_batch_id: 'b-b', head_count: '40.0000', transfer_value: '10000.0000', transfer_date: '2026-10-01', lines: [],
      } as any).mockResolvedValueOnce({ status: 'POSTED' } as any);
      const forUpdate = (row: object) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ for: jest.fn().mockResolvedValue([row]) }) }) }) });
      const limited = (rows: object[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
      mockDbSelect
        .mockReturnValueOnce(forUpdate(batchWise()))
        .mockReturnValueOnce(forUpdate(batchWise({ batch_id: 'b-b', batch_no: 'WEAN-B' })))
        .mockReturnValueOnce(limited([{ item_id: 'herd-item' }])) // source herd item
        .mockReturnValueOnce(limited([{ item_id: 'herd-item' }])); // destination herd item
      jest.spyOn(service as any, 'headOnHand').mockResolvedValue({ quantity: 100, value: 25000, perHead: 250 });
      const shiftValue = jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      const shiftQty = jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      const recount = jest.spyOn(service as any, 'syncBatchWiseCount').mockResolvedValue(undefined);
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));

      await service.post('tr-h', 'tenant-123', { userId: 'user-1' });

      expect(shiftValue).toHaveBeenCalledWith('b-a', -40, -10000);
      expect(shiftValue).toHaveBeenCalledWith('b-b', 40, 10000);
      expect(shiftQty).toHaveBeenCalledWith('b-a', -40);
      expect(shiftQty).toHaveBeenCalledWith('b-b', 40);
      const legs = inserted.find((v) => Array.isArray(v));
      expect(legs.map((l: any) => [l.entry_type, l.quantity, l.cost_amount])).toEqual([
        ['TRANSFER_OUT', '-40.0000', '-10000.0000'],
        ['TRANSFER_IN', '40.0000', '10000.0000'],
      ]);
      expect(legs.every((l: any) => l.animal_id === undefined)).toBe(true);
      expect(recount).toHaveBeenCalledWith('b-a');
      expect(recount).toHaveBeenCalledWith('b-b');
      expect(sets.find((v) => v.status === 'POSTED')).toBeDefined();
    });
  });

  describe('post', () => {
    it('moves the transferred animals onto the destination batch stage', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any) // load for posting
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any); // final return

      // Isolate the value/ledger side effects — this test is about the animals.
      jest
        .spyOn(service as any, 'shiftBioAssetState')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'shiftClosingQuantity')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'writeLedgerLegs')
        .mockResolvedValue(undefined);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ stage_id: 'stage-farrowing' }]),
            }),
          }),
        }) // destination batch stage
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest
                .fn()
                .mockResolvedValue([
                  { animal_id: 'a-1' },
                  { animal_id: 'a-2' },
                ]),
            }),
          }),
        }); // stillLive guard (locked, inside transaction)

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      expect(mockDbUpdate.mock.calls[0][0]).toBe(schema.animalRegister);
      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock)
        .mock.calls[0][0];
      expect(animalSet.current_batch_id).toBe('batch-farrow');
      expect(animalSet.current_stage_id).toBe('stage-farrowing');
    });

    const destinationRows = (row: object) =>
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([
                { animal_id: 'a-1', current_stage_id: 'stage-gest', current_location_id: 'loc-1' },
                { animal_id: 'a-2', current_stage_id: 'stage-gest', current_location_id: 'loc-1' },
              ]),
            }),
          }),
        });
    const isolateValueSideEffects = () => {
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
    };

    it("keeps each animal's own stage when the destination is an animal-wise batch", async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({ stage_id: 'stage-quarantine', tracking_mode: 'ANIMAL_WISE' });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(animalSet.current_batch_id).toBe('batch-farrow');
      expect(animalSet).not.toHaveProperty('current_stage_id');
      const movement = module.get(AnimalMovementLogService).record as jest.Mock;
      expect(movement.mock.calls[0][0]).toMatchObject({ fromStageId: 'stage-gest', toStageId: 'stage-gest' });
    });

    it('puts the animals in the stage the caller names, even in an animal-wise batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({ stage_id: 'stage-quarantine', tracking_mode: 'ANIMAL_WISE' });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' }, undefined, undefined, 'stage-farrowing');

      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(animalSet.current_stage_id).toBe('stage-farrowing');
    });

    it("recounts both batches' stage headcounts once the animals have moved", async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({ stage_id: 'stage-farrowing', tracking_mode: 'ANIMAL_WISE' });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      const sync = module.get(SchedulerHeaderService).syncAnimalWiseCounts as jest.Mock;
      expect(sync).toHaveBeenCalledWith('batch-gest');
      expect(sync).toHaveBeenCalledWith('batch-farrow');
    });

    it('refuses to post when a concurrent request already moved one of the animals off the source batch', async () => {
      // BBP §37: the locked re-check runs inside the transaction, immediately
      // before the repoint — if it finds fewer still-live animals than the
      // transfer expects (one got claimed elsewhere between draft and post),
      // this post must fail rather than silently transfer the rest.
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ stage_id: 'stage-farrowing' }]),
            }),
          }),
        }) // destination batch stage
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([{ animal_id: 'a-1' }]),
            }), // only 1 of 2 still live
          }),
        });

      await expect(
        service.post('tr-1', 'tenant-123', { userId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });
});

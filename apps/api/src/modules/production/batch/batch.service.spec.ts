import { Test, TestingModule } from '@nestjs/testing';
import { BatchService } from './batch.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { BadRequestException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';

describe('BatchService', () => {
  let service: BatchService;
  let numberSeriesService: NumberSeriesService;
  let module: TestingModule;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbTransaction = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockDbTransaction,
  };

  const activeBatch = {
    batch_id: 'batch-1',
    tenant_id: 'tenant-123',
    company_id: 'comp-1',
    lob_id: 'lob-piggery',
    status: 'ACTIVE',
    current_stage_code: null,
    sub_location_id: null,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbTransaction.mockReset();

    module = await Test.createTestingModule({
      providers: [
        BatchService,
        {
          provide: ClsService,
          useValue: { get: jest.fn().mockReturnValue(mockDb) },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: GlPostingService, useValue: {} },
        {
          provide: NumberSeriesService,
          useValue: {
            generateNext: jest.fn().mockResolvedValue('BATCH-000001'),
          },
        },
        {
          provide: SchedulerHeaderService,
          useValue: {
            createForStage: jest.fn().mockResolvedValue({}),
            generateForBatchCurrentStage: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
        {
          provide: 'BATCH_DAILY_DATA_POSTER',
          useValue: { postEntry: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<BatchService>(BatchService);
    numberSeriesService = module.get<NumberSeriesService>(NumberSeriesService);
  });

  describe('create', () => {
    it('delegates batch_no generation to NumberSeriesService and persists the result', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([
                { nob_id: 'nob-1', costing_method_allowed: 'FIFO,STANDARD' },
              ]),
          }),
        }),
      });

      mockDbTransaction.mockImplementation(async (cb: any) => cb(mockDb));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        batch_no: 'BATCH-000001',
      } as any);

      const result = await service.create(
        {
          company_id: 'comp-1',
          lob_id: 'lob-piggery',
          costing_method: 'FIFO',
          start_date: '2026-01-01',
          opening_quantity: 100,
          uom: 'HEAD',
          input_lines: [{ item_id: 'item-1', quantity: 100, uom: 'HEAD' }],
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(numberSeriesService.generateNext).toHaveBeenCalledWith(
        'BATCH',
        'tenant-123',
        'comp-1',
        mockDb,
      );
      expect(result.batch_no).toBe('BATCH-000001');
    });

    it('rejects an ANIMAL_WISE batch with no animal_ids', async () => {
      await expect(
        service.create(
          {
            tracking_mode: 'ANIMAL_WISE',
            company_id: 'comp-1',
            lob_id: 'lob-piggery',
            costing_method: 'FIFO',
            start_date: '2026-01-01',
            uom: 'HEAD',
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('animal_ids is required for ANIMAL_WISE batches.');
    });

    it('rejects an ANIMAL_WISE batch that includes an already-assigned animal', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([
                  { nob_id: 'nob-1', costing_method_allowed: 'FIFO,STANDARD' },
                ]),
            }),
          }),
        }) // lob lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                animal_id: 'a-1',
                animal_code: 'PIG-0001',
                lob_id: 'lob-piggery',
                current_batch_id: 'batch-old',
                current_stage_id: 'stage-1',
                current_location_id: null,
              },
            ]),
          }),
        }); // animal_register lookup

      await expect(
        service.create(
          {
            tracking_mode: 'ANIMAL_WISE',
            animal_ids: ['a-1'],
            company_id: 'comp-1',
            lob_id: 'lob-piggery',
            costing_method: 'FIFO',
            start_date: '2026-01-01',
            uom: 'HEAD',
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('Animal(s) already assigned to a batch: PIG-0001.');
    });

    it('assigns unassigned animals to the new batch, keyed by their own stage, without input_lines', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([
                  { nob_id: 'nob-1', costing_method_allowed: 'FIFO,STANDARD' },
                ]),
            }),
          }),
        }) // lob lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                animal_id: 'a-1',
                animal_code: 'PIG-0001',
                lob_id: 'lob-piggery',
                current_batch_id: null,
                current_stage_id: 'stage-nursery',
                current_location_id: 'loc-1',
              },
              {
                animal_id: 'a-2',
                animal_code: 'PIG-0002',
                lob_id: 'lob-piggery',
                current_batch_id: null,
                current_stage_id: 'stage-grower',
                current_location_id: 'loc-2',
              },
            ]),
          }),
        }) // animal_register lookup (pre-transaction validation)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([
                {
                  animal_id: 'a-1',
                  animal_code: 'PIG-0001',
                  current_batch_id: null,
                },
                {
                  animal_id: 'a-2',
                  animal_code: 'PIG-0002',
                  current_batch_id: null,
                },
              ]),
            }),
          }),
        }); // locked re-check inside the transaction

      mockDbTransaction.mockImplementation(async (cb: any) => cb(mockDb));
      const insertedValues: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn((v: any) => {
          insertedValues.push(v);
          return Promise.resolve({});
        }),
      });
      const updateSets: any[] = [];
      mockDbUpdate.mockReturnValue({
        set: jest.fn((v: any) => {
          updateSets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      });

      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        batch_no: 'BATCH-000002',
        tracking_mode: 'ANIMAL_WISE',
      } as any);

      const movementLog = module.get<AnimalMovementLogService>(
        AnimalMovementLogService,
      );
      const schedulerHeaderService = module.get<SchedulerHeaderService>(
        SchedulerHeaderService,
      );

      const result = await service.create(
        {
          tracking_mode: 'ANIMAL_WISE',
          animal_ids: ['a-1', 'a-2'],
          company_id: 'comp-1',
          lob_id: 'lob-piggery',
          costing_method: 'FIFO',
          start_date: '2026-01-01',
          uom: 'HEAD',
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      // no batch_input_line row is written for ANIMAL_WISE
      expect(
        insertedValues.some((v) => Array.isArray(v) && v[0]?.item_id),
      ).toBe(false);
      expect(updateSets.some((v) => v.current_batch_id)).toBe(true);
      expect(movementLog.record).toHaveBeenCalledTimes(2);
      expect((movementLog.record as jest.Mock).mock.calls[0][0]).toMatchObject({
        animalId: 'a-1',
        movementType: 'ASSIGN',
        toStageId: 'stage-nursery',
        toLocationId: 'loc-1',
      });
      expect(schedulerHeaderService.createForStage).toHaveBeenCalledWith(
        expect.any(String),
        'stage-nursery',
        'tenant-123',
        { userId: 'user-1' },
      );
      expect(schedulerHeaderService.createForStage).toHaveBeenCalledWith(
        expect.any(String),
        'stage-grower',
        'tenant-123',
        { userId: 'user-1' },
      );
      expect(result.batch_no).toBe('BATCH-000002');
    });
  });

  describe('activate', () => {
    it('activates an ANIMAL_WISE batch with no input lines, activating every DRAFT scheduler for the batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce({
          ...activeBatch,
          status: 'DRAFT',
          tracking_mode: 'ANIMAL_WISE',
          input_lines: [],
          stage_id: null,
        } as any)
        .mockResolvedValueOnce({
          ...activeBatch,
          status: 'ACTIVE',
          tracking_mode: 'ANIMAL_WISE',
        } as any);

      const updateCalls: { table: any; set: any; where: any }[] = [];
      mockDbUpdate.mockImplementation((table: any) => ({
        set: (set: any) => ({
          where: (where: any) => {
            updateCalls.push({ table, set, where });
            return Promise.resolve({});
          },
        }),
      }));

      await service.activate('batch-1', 'tenant-123', { userId: 'user-1' });

      const headerUpdate = updateCalls.find(
        (c) => c.table === schema.batchHeader,
      );
      expect(headerUpdate?.set.status).toBe('ACTIVE');
      const schedulerUpdate = updateCalls.find(
        (c) => c.table === schema.schedulerHeader,
      );
      expect(schedulerUpdate?.set.scheduler_status).toBe('ACTIVE');
    });

    it('still rejects a BATCH_WISE batch with no input lines', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        status: 'DRAFT',
        tracking_mode: 'BATCH_WISE',
        input_lines: [],
      } as any);

      await expect(service.activate('batch-1', 'tenant-123')).rejects.toThrow(
        'Cannot activate a batch with no input lines.',
      );
    });
  });

  describe('postStageDay / reopenStageDay', () => {
    const animalWiseBatch = { ...activeBatch, tracking_mode: 'ANIMAL_WISE' };

    it('refuses to post a BATCH_WISE batch — stage-level posting only applies to ANIMAL_WISE', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        tracking_mode: 'BATCH_WISE',
      } as any);

      await expect(
        service.postStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          'tenant-123',
        ),
      ).rejects.toThrow(
        'Stage-level posting only applies to ANIMAL_WISE batches.',
      );
    });

    it('refuses to post a stage with no animals currently in it', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // no live animals

      await expect(
        service.postStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          'tenant-123',
        ),
      ).rejects.toThrow('No animals are currently in this stage');
    });

    it('refuses to post while a mandatory activity is still missing for an animal', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        scheduler_id: 'sched-1',
        is_active: true,
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
        is_mandatory: true,
        activity_name: 'Feed',
      };

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
              ]),
          }),
        }) // live animals
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }) // already posted entries
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  scheduler_id: 'sched-1',
                  effective_from: '2026-09-01',
                  animal_count: '1',
                },
              ]),
            }),
          }),
        }) // scheduler header
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mandatoryLine]),
          }),
        }) // due lines
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // no batch_daily_data rows entered at all

      await expect(
        service.postStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          'tenant-123',
        ),
      ).rejects.toThrow(/PIG-0001 — Feed/);
    });

    it('locks the stage/date once every mandatory activity is entered for every animal', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        scheduler_id: 'sched-1',
        is_active: true,
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
        is_mandatory: true,
        activity_name: 'Feed',
      };

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
              ]),
          }),
        }) // live animals
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }) // already posted entries
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  scheduler_id: 'sched-1',
                  effective_from: '2026-09-01',
                  animal_count: '1',
                },
              ]),
            }),
          }),
        }) // scheduler header
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mandatoryLine]),
          }),
        }) // due lines
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ line_id: 'line-feed', animal_id: 'a-1' }]),
          }),
        }) // entered — Feed present for a-1
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // no still-draft rows to finalize

      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }),
      });

      const result = await service.postStageDay(
        'batch-1',
        'stage-flush',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.status).toBe('LOCKED');
      expect(mockDbInsert).toHaveBeenCalledWith(schema.batchDataEntryLock);
      expect(onDuplicateKeyUpdate).toHaveBeenCalled();
    });

    it('posts data for a single animal without requiring other animals to be entered', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        scheduler_id: 'sched-1',
        is_active: true,
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
        is_mandatory: true,
        activity_name: 'Feed',
      };

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
                { animal_id: 'a-2', animal_code: 'PIG-0002' },
              ]),
          }),
        }) // live animals in stage (a-1 and a-2)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }) // already posted entries (none yet)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  scheduler_id: 'sched-1',
                  effective_from: '2026-09-01',
                  animal_count: '2',
                },
              ]),
            }),
          }),
        }) // scheduler header
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mandatoryLine]),
          }),
        }) // due lines
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ line_id: 'line-feed', animal_id: 'a-1' }]),
          }),
        }) // entered — Feed present for a-1 only
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // draft rows for a-1
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mandatoryLine]),
          }),
        }) // activePairs for lock check
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ line_id: 'line-feed', animal_id: 'a-1', posted: true }]),
          }),
        }); // allEntries for stage lock check (a-2 not posted yet)

      const result = await service.postStageDay(
        'batch-1',
        'stage-flush',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
        'a-1',
      );

      expect(result.status).toBe('POSTED');
      expect(result.stage_locked).toBe(false);
      expect(result.animal_id).toBe('a-1');
    });

    it('refuses to post again when an animal is already posted on that date', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
              ]),
          }),
        }) // live animals
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ animal_id: 'a-1' }]),
          }),
        }); // a-1 is already posted!

      await expect(
        service.postStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          'tenant-123',
          { userId: 'user-1' },
          'a-1',
        ),
      ).rejects.toThrow("Data entry for animal 'PIG-0001' has already been posted on 2026-09-11.");
    });

    it('skips already posted animals and only posts the remaining animals when posting all', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        scheduler_id: 'sched-1',
        is_active: true,
        occurrence: 'DAILY',
        start_day: 1,
        end_day: null,
        is_mandatory: true,
        activity_name: 'Feed',
      };

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
                { animal_id: 'a-2', animal_code: 'PIG-0002' },
              ]),
          }),
        }) // live animals (a-1 and a-2)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ animal_id: 'a-1' }]),
          }),
        }) // a-1 already posted, so remaining is a-2 only!
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  scheduler_id: 'sched-1',
                  effective_from: '2026-09-01',
                  animal_count: '2',
                },
              ]),
            }),
          }),
        }) // scheduler header
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([mandatoryLine]),
          }),
        }) // due lines
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ line_id: 'line-feed', animal_id: 'a-2' }]),
          }),
        }) // mandatory entered check only requires a-2!
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // draft rows for a-2

      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }),
      });

      const result = await service.postStageDay(
        'batch-1',
        'stage-flush',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
      );

      // Now all animals are posted, so the entire stage is locked
      expect(result.status).toBe('LOCKED');
      expect(result.target_animal_count).toBe(1); // Only targeted a-2
    });

    it('reopen requires a reason', async () => {
      await expect(
        service.reopenStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          '',
          'tenant-123',
        ),
      ).rejects.toThrow('A reason is required to reopen posted data.');
    });

    it('reopen refuses when the stage/date is not currently locked', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      });

      await expect(
        service.reopenStageDay(
          'batch-1',
          'stage-flush',
          '2026-09-11',
          'Typo in feed qty',
          'tenant-123',
        ),
      ).rejects.toThrow('This stage/date is not currently locked.');
    });

    it('reopens a locked stage/date, recording who and why', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ lock_id: 'lock-1', status: 'LOCKED' }]),
          }),
        }),
      });
      const sets: any[] = [];
      mockDbUpdate.mockReturnValue({
        set: jest.fn((v: any) => {
          sets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      });

      const result = await service.reopenStageDay(
        'batch-1',
        'stage-flush',
        '2026-09-11',
        'Typo in feed qty',
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.status).toBe('REOPENED');
      expect(sets[0]).toMatchObject({
        status: 'REOPENED',
        reopened_by: 'user-1',
        reopen_reason: 'Typo in feed qty',
      });
    });
  });

  describe('postBatchDay', () => {
    const batchWiseBatch = {
      ...activeBatch,
      tracking_mode: 'BATCH_WISE',
      stage_id: 'stage-gest',
      company_id: 'comp-1',
    };

    it('refuses to post an ANIMAL_WISE batch — that mode posts per stage', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        tracking_mode: 'ANIMAL_WISE',
      } as any);

      await expect(
        service.postBatchDay('batch-1', '2026-09-11', 'tenant-123'),
      ).rejects.toThrow('ANIMAL_WISE batches post per stage');
    });

    it('refuses to post a batch that has not transferred into a stage yet', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        tracking_mode: 'BATCH_WISE',
        stage_id: null,
      } as any);

      await expect(
        service.postBatchDay('batch-1', '2026-09-11', 'tenant-123'),
      ).rejects.toThrow('This batch has not transferred into a stage yet');
    });

    it('refuses to post while a mandatory activity has not been entered for the whole batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(batchWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        is_mandatory: true,
        activity_name: 'Feed',
      };
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValueOnce([{ header: {}, line: mandatoryLine }]);

      mockDbSelect.mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // no whole-batch entries at all

      await expect(
        service.postBatchDay('batch-1', '2026-09-11', 'tenant-123'),
      ).rejects.toThrow(/required activities not yet entered: Feed/);
    });

    it('locks the batch/date once every mandatory activity is entered whole-batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(batchWiseBatch as any);
      const mandatoryLine = {
        line_id: 'line-feed',
        is_mandatory: true,
        activity_name: 'Feed',
      };
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValueOnce([{ header: {}, line: mandatoryLine }]);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ line_id: 'line-feed' }]),
          }),
        }) // whole-batch entry present (mandatory check)
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // no still-draft rows to finalize

      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }),
      });

      const result = await service.postBatchDay(
        'batch-1',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.status).toBe('LOCKED');
      expect(result.stage_id).toBe('stage-gest');
      expect(mockDbInsert).toHaveBeenCalledWith(schema.batchDataEntryLock);
      expect(onDuplicateKeyUpdate).toHaveBeenCalled();
    });

    it('finalizes every still-draft row for the day through BatchDailyDataService.postEntry before locking', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(batchWiseBatch as any);
      const feedLine = {
        line_id: 'line-feed',
        is_mandatory: true,
        activity_name: 'Feed',
      };
      const overheadLine = {
        line_id: 'line-oh',
        is_mandatory: false,
        activity_name: 'Utilities',
      };
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValueOnce([
          { header: {}, line: feedLine },
          { header: {}, line: overheadLine },
        ]);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ line_id: 'line-feed' }]),
          }),
        }) // mandatory check — Feed entered
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                line_id: 'line-feed',
                entry_date: '2026-09-11',
                entered_value: '40.0000',
                entered_text: null,
                lot_no: null,
                remarks: null,
              },
              {
                line_id: 'line-oh',
                entry_date: '2026-09-11',
                entered_value: '500.0000',
                entered_text: null,
                lot_no: null,
                remarks: 'Electricity',
              },
            ]),
          }),
        }); // both are still draft (posted: false)

      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }),
      });

      const dailyDataPoster = module.get('BATCH_DAILY_DATA_POSTER');

      const result = await service.postBatchDay(
        'batch-1',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.status).toBe('LOCKED');
      expect(dailyDataPoster.postEntry).toHaveBeenCalledTimes(2);
      expect(dailyDataPoster.postEntry).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({
          line_id: 'line-feed',
          entry_date: '2026-09-11',
          entered_value: 40,
        }),
        'tenant-123',
        { userId: 'user-1' },
      );
      expect(dailyDataPoster.postEntry).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({
          line_id: 'line-oh',
          entered_value: 500,
          remarks: 'Electricity',
        }),
        'tenant-123',
        { userId: 'user-1' },
      );
      // Neither dispatch call carries `draft` — this is the real, final post.
      const calledDtos = (
        dailyDataPoster.postEntry as jest.Mock
      ).mock.calls.map((c) => c[1]);
      expect(calledDtos.every((dto) => dto.draft === undefined)).toBe(true);
    });

    it('locks cleanly when there are no mandatory lines due at all', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(batchWiseBatch as any);
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValueOnce([]);

      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }),
      });

      const result = await service.postBatchDay(
        'batch-1',
        '2026-09-11',
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.status).toBe('LOCKED');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  describe('transferStage', () => {
    it('sets stage_id when a matching stage_master row exists for the batch LOB', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any) // initial load
        .mockResolvedValueOnce({
          ...activeBatch,
          current_stage_code: 'QUARANTINE',
          stage_id: 'stage-quarantine',
        } as any); // final return

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ stage_id: 'stage-quarantine' }]),
            }),
          }),
        }) // stage_master lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }); // in-step animals (none on this bare fixture)
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage(
        'batch-1',
        { to_stage_code: 'QUARANTINE' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbUpdate).toHaveBeenCalled();
      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock
        .calls[0][0];
      expect(setArg.stage_id).toBe('stage-quarantine');
      expect(result.stage_id).toBe('stage-quarantine');
    });

    it('leaves stage_id null when no stage_master row matches the code for this LOB', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({
          ...activeBatch,
          current_stage_code: 'CUSTOM_STAGE',
          stage_id: null,
        } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]), // no matching stage_master row
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }), // LOB has no stages configured
        });
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage(
        'batch-1',
        { to_stage_code: 'CUSTOM_STAGE' },
        'tenant-123',
        { userId: 'user-1' },
      );

      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock
        .calls[0][0];
      expect(setArg.stage_id).toBeNull();
      expect(result.stage_id).toBeNull();
    });

    const gestatingBatch = {
      ...activeBatch,
      current_stage_code: 'DRY_SOW_GESTATION',
      stage_id: 'stage-gestation',
    };

    it('cascades the new stage to the animals that were in step with the batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(gestatingBatch as any)
        .mockResolvedValueOnce({
          ...gestatingBatch,
          current_stage_code: 'LACTATION',
          stage_id: 'stage-lactation',
        } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ stage_id: 'stage-lactation' }]),
            }),
          }),
        }) // stage_master lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([
                  { min_days_before_move: 0, stage_name: 'Dry Sow Gestation' },
                ]),
            }),
          }),
        }) // current stage's min-days lookup — no floor set, so no further check needed
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ animal_id: 'a-1' }, { animal_id: 'a-2' }]),
          }),
        }); // animals still standing at the batch's previous stage

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage(
        'batch-1',
        { to_stage_code: 'LACTATION' },
        'tenant-123',
        { userId: 'user-1' },
      );

      // First update is batch_header; second repoints in-step animals; third completes prior scheduler.
      expect(mockDbUpdate).toHaveBeenCalledTimes(3);
      expect(mockDbUpdate.mock.calls[1][0]).toBe(schema.animalRegister);
      const setMock = mockDbUpdate.mock.results[0].value.set as jest.Mock;
      expect(setMock.mock.calls[1][0].current_stage_id).toBe('stage-lactation');
    });

    it('leaves animals that have diverged from the batch stage where they are', async () => {
      // A few head held back in a hospital pen at an earlier stage: they are in
      // this batch but not at its stage, so a batch-level move must not drag
      // them along.
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(gestatingBatch as any)
        .mockResolvedValueOnce({
          ...gestatingBatch,
          current_stage_code: 'LACTATION',
          stage_id: 'stage-lactation',
        } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ stage_id: 'stage-lactation' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([
                  { min_days_before_move: 0, stage_name: 'Dry Sow Gestation' },
                ]),
            }),
          }),
        }) // current stage's min-days lookup — no floor set, so no further check needed
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]), // nobody is in step
          }),
        });

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage(
        'batch-1',
        { to_stage_code: 'LACTATION' },
        'tenant-123',
        { userId: 'user-1' },
      );

      // batch_header and prior stage scheduler_header are updated — no animal write at all.
      expect(mockDbUpdate).toHaveBeenCalledTimes(2);
    });

    it('does not touch animals when no stage_master row matches the code', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({
          ...activeBatch,
          current_stage_code: 'CUSTOM_STAGE',
          stage_id: null,
        } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }), // LOB has no stages configured
        });
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage(
        'batch-1',
        { to_stage_code: 'CUSTOM_STAGE' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects a stage code that matches nothing for a LOB that has stages configured', async () => {
      // The batch-stages screen once posted its own display codes (ST-01..ST-08)
      // instead of domain codes, writing "ST-05" into current_stage_code and
      // leaving stage_id null. Accepting an unmatched code silently is what let
      // that corrupt a batch.
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(gestatingBatch as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // no stage_master row matches 'ST-05'
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockResolvedValue([{ stage_code: 'DRY_SOW_GESTATION' }]),
          }),
        }); // ...but this LOB does have stages configured

      await expect(
        service.transferStage(
          'batch-1',
          { to_stage_code: 'ST-05' },
          'tenant-123',
          { userId: 'u' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('still allows a free-text stage for a LOB with no stage master data', async () => {
      // Stages are LOB-defined; a line of business that has configured none must
      // keep working with hand-entered codes.
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({
          ...activeBatch,
          current_stage_code: 'CUSTOM',
          stage_id: null,
        } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // LOB has no stages at all
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage(
        'batch-1',
        { to_stage_code: 'CUSTOM' },
        'tenant-123',
        { userId: 'u' },
      );

      expect(result.current_stage_code).toBe('CUSTOM');
    });

    it('rejects transferring a non-ACTIVE batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...activeBatch, status: 'DRAFT' } as any);

      await expect(
        service.transferStage(
          'batch-1',
          { to_stage_code: 'QUARANTINE' },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addTransaction — clinical detail', () => {
    // The guards run before any write, so a mismatched detail must leave
    // nothing behind — not a transaction row with an orphaned narrative.
    it('refuses mortality_detail on a transaction that is not a death', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        costing_method: 'STANDARD',
      } as any);

      await expect(
        service.addTransaction(
          'batch-1',
          {
            transaction_date: '2026-08-01',
            transaction_type: 'CONSUMPTION',
            quantity: 10,
            mortality_detail: { cause_of_death: 'Lameness' },
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses treatment_detail on a transaction that does not issue medicine', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        costing_method: 'STANDARD',
      } as any);

      await expect(
        service.addTransaction(
          'batch-1',
          {
            transaction_date: '2026-08-01',
            transaction_type: 'OVERHEAD',
            quantity: 4,
            treatment_detail: { withdrawal_days: 28 },
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('addTransaction — bio-asset OUTPUT leaves a ledger movement', () => {
    // Harvesting from a matured bio-asset herd reduces
    // batch_bio_asset_state.nca_book_value. Without a matching bio_asset_ledger
    // row the IAS 41 roll-forward shows the carrying value fall with nothing to
    // explain it — every other bio-asset movement (acquisition, consumption,
    // mortality, overhead, maturation, amortisation, fair value, disposal)
    // writes one.
    it('writes a bio_asset_ledger row when OUTPUT is recorded on a matured bio-asset batch', async () => {
      const bioBatch = {
        ...activeBatch,
        batch_no: 'BATCH-000001',
        costing_method: 'BIO_ASSET',
        nob_id: 'nob-1',
        input_lines: [{ item_id: 'item-piglet' }],
        transactions: [],
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '50000.0000',
              },
            ]),
          }),
        }),
      });

      (service as any).ledgerService = {
        writePositiveEntry: jest.fn().mockResolvedValue({
          ledger_id: 'led-1',
          rate: '1200.000000',
          amount: '12000.0000',
        }),
      };
      (service as any).glPostingService = {
        postInventoryLedgerEntry: jest.fn().mockResolvedValue({}),
        postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
      };

      const inserted: Array<{ table: unknown; values: any }> = [];
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn((v: any) => {
          inserted.push({ table, values: v });
          return Promise.resolve({});
        }),
      }));
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });

      await service.addTransaction(
        'batch-1',
        {
          transaction_date: '2026-08-20',
          transaction_type: 'OUTPUT',
          item_id: 'item-weaner',
          quantity: 10,
          uom: 'HEAD',
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const ledgerRow = inserted.find((i) => i.table === schema.bioAssetLedger);
      expect(ledgerRow).toBeDefined();
      // TRANSFORMATION is the entry type the IAS 41 roll-forward maps to its
      // harvest-transfers bucket, which is otherwise always zero.
      expect(ledgerRow!.values.entry_type).toBe('TRANSFORMATION');
      expect(ledgerRow!.values.batch_id).toBe('batch-1');
      // The movement must equal the reduction in carrying value.
      expect(Number(ledgerRow!.values.cost_amount)).toBe(-12000);
    });
  });

  describe('findAll', () => {
    it('reports accumulated cost as wip_value so the dashboard tile is not structurally zero', async () => {
      // The console's WIP tile reads b.wip_value. Nothing in the API ever
      // returned that field, so Number(undefined) || 0 made the tile read
      // "₹ 0" no matter how much cost a batch had accumulated.
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  {
                    ...activeBatch,
                    batch_id: 'b1',
                    total_cost: null,
                    closing_quantity: '20.0000',
                  },
                ]),
              }),
            }),
          }),
        }) // batch rows
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                batch_id: 'b1',
                transaction_type: 'CONSUMPTION',
                amount: '1232.0000',
              },
              {
                batch_id: 'b1',
                transaction_type: 'OVERHEAD',
                amount: '3300.0000',
              },
              {
                batch_id: 'b1',
                transaction_type: 'MORTALITY',
                amount: '0.0000',
              },
            ]),
          }),
        }); // cost-bearing transactions

      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');

      expect(rows[0].wip_value).toBe(4532);
    });

    it('prefers the posted total_cost once a batch is closed', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  {
                    ...activeBatch,
                    batch_id: 'b2',
                    status: 'CLOSED',
                    total_cost: '999999.0000',
                  },
                ]),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              {
                batch_id: 'b2',
                transaction_type: 'CONSUMPTION',
                amount: '10.0000',
              },
            ]),
          }),
        });

      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');

      expect(rows[0].wip_value).toBe(999999);
    });
  });

  describe('getDataEntry', () => {
    const scheduledBatch = {
      ...activeBatch,
      stage_id: 'stage-gest',
      start_date: '2026-07-01',
      opening_quantity: '20.0000',
      current_stage_code: 'GESTATION',
    };

    const schedulerHeader = {
      scheduler_id: 'sched-1',
      batch_id: 'batch-1',
      stage_id: 'stage-gest',
      effective_from: '2026-09-01',
      animal_count: '20.0000',
    };

    const feedLine = {
      line_id: 'line-feed',
      line_type: 'CONSUMPTION',
      parameter_name: 'Mid Gestation Ration',
      item_id: 'item-feed',
      resource_id: null,
      qty_basis: 'PER_HEAD',
      // kilograms per head per day — a quantity, emphatically not a price
      standard_qty: '2.2000',
      occurrence: 'DAILY',
      kpi_uom: null,
    };

    // Every getDataEntry query in order: lock lookup, same-day transactions,
    // same-day batch_daily_data entries, item rows, resource rows, uom
    // conversions.
    const setup = (line: any, itemRow: any | null) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(scheduledBatch as any);
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValue([{ header: schedulerHeader, line }]);
      jest
        .spyOn(service as any, 'loadBatchScheduledStages')
        .mockResolvedValue([]);
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // lock lookup
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // same-day transactions
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // same-day daily-data entries
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(itemRow ? [itemRow] : []),
          }),
        }) // item rows
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // resource rows
        .mockReturnValueOnce({ from: jest.fn().mockResolvedValue([]) }); // uom conversions
    };

    it('reports the item standard cost as the line rate', async () => {
      setup(feedLine, {
        item_id: 'item-feed',
        item_code: 'FEED-GEST-SOW',
        item_name: 'Dry Sow Gestation Mash',
        item_type: 'FEED',
        standard_cost: '28.000000',
        uom_primary: 'KG',
      });

      const result = (await service.getDataEntry(
        'batch-1',
        '2026-09-01',
      )) as any;

      // 28/kg, not 2.2 — the per-head quantity was being surfaced as a price,
      // so the data-entry screen costed 6 labour hours at ₹6.
      expect(result.lines[0].std_rate).toBe(28);
      // 2.2 kg/head * 20 animals (scheduler_header.animal_count)
      expect(result.lines[0].expected_qty).toBe(44);
    });

    // The old model's uom_override — dosing in ML from stock priced per VIAL —
    // is gone: the new scheduler_line schema (Master Templates/
    // Schedule_master_template.xlsx) marks `uom` CALC, auto-flowing from
    // item_master.uom_primary with no per-line override, so a line's unit is
    // now always its item's stock unit and the conversion branch in
    // getDataEntry's standardRate() is unreachable for CONSUMPTION/OUTPUT.

    it('reports no rate rather than a quantity when the line has no item or resource', async () => {
      setup(
        {
          ...feedLine,
          line_id: 'line-labour',
          line_type: 'DESCRIPTIVE',
          item_id: null,
          qty_basis: null,
          standard_qty: null,
          kpi_uom: 'HRS',
        },
        null,
      );

      const result = (await service.getDataEntry(
        'batch-1',
        '2026-09-01',
      )) as any;

      expect(result.lines[0].std_rate).toBeNull();
    });

    it('surfaces lock info from batch_data_entry_lock alongside the lines', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(scheduledBatch as any);
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValue([{ header: schedulerHeader, line: feedLine }]);
      jest
        .spyOn(service as any, 'loadBatchScheduledStages')
        .mockResolvedValue([]);
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  status: 'LOCKED',
                  locked_by: 'user-1',
                  locked_at: '2026-09-01 10:00:00',
                  reopen_reason: null,
                },
              ]),
            }),
          }),
        }) // lock lookup
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // same-day transactions
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // same-day daily-data entries
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // item rows
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }) // resource rows
        .mockReturnValueOnce({ from: jest.fn().mockResolvedValue([]) }); // uom conversions

      const result = (await service.getDataEntry(
        'batch-1',
        '2026-09-01',
      )) as any;

      expect(result.lock_status).toBe('LOCKED');
      expect(result.locked_by).toBe('user-1');
    });
  });

  describe('matureBioAsset', () => {
    const bioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      breed_id: 'breed-1',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('transitions PREMATURE batch to MATURE, calculates amortization rate, and posts BIO_TRANSFORMATION', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      const mockGlService = {
        postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
      };
      (service as any).glPostingService = mockGlService;

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  state_id: 'state-1',
                  batch_id: 'batch-1',
                  stage: 'PREMATURE',
                  current_quantity: '10.0000',
                  nca_book_value: '50000.0000',
                },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([
                  { breed_id: 'breed-1', productive_life_months: 24 },
                ]),
            }),
          }),
        });

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.matureBioAsset(
        'batch-1',
        { residual_value_per_unit: 500, productive_life_months: 24 },
        'tenant-123',
        { userId: 'user-1' },
      );

      // ncaValue: 50000, residualTotal: 500 * 10 = 5000
      // monthlyRate: (50000 - 5000) / 24 / 10 = 187.5
      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_TRANSFORMATION',
          amount: 50000,
        }),
      );

      expect(mockDbUpdate).toHaveBeenCalled();
      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock
        .calls[0][0];
      expect(setCall.stage).toBe('MATURE');
      expect(Number(setCall.monthly_amortization_rate)).toBeCloseTo(187.5);
    });

    it('rejects maturing a batch that is already MATURE', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '50000.0000',
              },
            ]),
          }),
        }),
      });

      await expect(
        service.matureBioAsset(
          'batch-1',
          { residual_value_per_unit: 500 },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('amortizeBioAsset', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('posts BIO_AMORTIZATION and reduces nca_book_value', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockGlService = {
        postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
      };
      (service as any).glPostingService = mockGlService;

      // 1. getBioAssetState
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '45000.0000',
                monthly_amortization_rate: '187.500000',
              },
            ]),
          }),
        }),
      });
      // 2. existingEntries check
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.amortizeBioAsset(
        'batch-1',
        { posting_date: '2026-02-15' },
        'tenant-123',
        { userId: 'user-1' },
      );

      // 187.5 * 10 = 1875
      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_AMORTIZATION',
          amount: 1875,
          postingDate: '2026-02-15',
        }),
      );

      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock
        .calls[0][0];
      expect(Number(setCall.nca_book_value)).toBeCloseTo(43125);
    });

    it('rejects duplicate amortization for the same month', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '45000.0000',
                monthly_amortization_rate: '187.500000',
              },
            ]),
          }),
        }),
      });
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue([
              { posting_date: '2026-02-01', entry_type: 'AMORTIZATION' },
            ]),
        }),
      });

      await expect(
        service.amortizeBioAsset(
          'batch-1',
          { posting_date: '2026-02-28' },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordFairValue', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('posts BIO_FAIR_VALUE with reverseDirection for fair value loss', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockGlService = {
        postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
      };
      (service as any).glPostingService = mockGlService;

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '40000.0000', // 4000/unit
              },
            ]),
          }),
        }),
      });

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      // Fair value drops to 3500/unit -> loss of 500 * 10 = 5000
      await service.recordFairValue(
        'batch-1',
        { fair_value_per_unit: 3500, posting_date: '2026-03-01' },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_FAIR_VALUE',
          amount: 5000,
          reverseDirection: true,
        }),
      );

      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock
        .calls[0][0];
      expect(Number(setCall.nca_book_value)).toBeCloseTo(35000);
    });
  });

  describe('disposeBioAsset', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('auto-closes the batch when the last animals are disposed', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockLedgerService = {
        writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'l-1' }),
      };
      const mockGlService = {
        postInventoryLedgerEntry: jest
          .fn()
          .mockResolvedValue({ journal_id: 'j-1' }),
      };
      (service as any).ledgerService = mockLedgerService;
      (service as any).glPostingService = mockGlService;

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '5.0000',
                nca_book_value: '20000.0000',
              },
            ]),
          }),
        }),
      });

      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.disposeBioAsset(
        'batch-1',
        {
          disposal_type: 'HARVEST',
          quantity: 5,
          posting_date: '2026-04-01',
          output_item_id: 'item-dressed-pork',
          output_uom: 'KG',
          output_quantity: 400,
          warehouse_id: 'wh-1',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockLedgerService.writePositiveEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_HARVEST',
          quantity: 400,
          rate: 50, // 20000 / 400
        }),
      );

      // Verify that batchHeader was updated to CLOSED
      const setMock = mockDbUpdate.mock.results[0].value.set as jest.Mock;
      const allSetCalls = setMock.mock.calls.map((call) => call[0]);
      const batchHeaderCloseCall = allSetCalls.find(
        (call) => call.status === 'CLOSED',
      );
      expect(batchHeaderCloseCall).toBeDefined();
      expect(batchHeaderCloseCall.status).toBe('CLOSED');
    });
  });

  describe('bulkAddDailyTransactions', () => {
    it('iterates rows and dispatches addTransaction for feed, mortality, and temperature', async () => {
      const addTxSpy = jest
        .spyOn(service, 'addTransaction')
        .mockResolvedValue({ transaction_id: 'tx-1' } as any);

      const res = await service.bulkAddDailyTransactions(
        {
          company_id: 'comp-1',
          entry_date: '2026-08-19',
          entries: [
            {
              batch_id: 'b-1',
              feed_item_id: 'item-feed',
              feed_qty: 450,
              mortality_count: 2,
              temperature: 24.5,
              water_qty: 1200,
              remarks: 'Normal routine',
            },
            {
              batch_id: 'b-2',
              feed_item_id: 'item-feed',
              feed_qty: 600,
              mortality_count: 0,
            },
          ],
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(res.totalEntries).toBe(2);
      expect(res.successCount).toBe(5); // 4 for b-1 (feed, mort, water, temp) + 1 for b-2 (feed)
      expect(res.errorCount).toBe(0);
      expect(addTxSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe('generateSchedulerForBatch', () => {
    // The heavy lifting (breed lifecycle lookup, line generation) now lives in
    // SchedulerHeaderService.generateForBatchCurrentStage() — see
    // scheduler-header.service.spec.ts. This is a thin delegator, so the only
    // thing worth asserting here is that the delegation happens.
    it('delegates to SchedulerHeaderService.generateForBatchCurrentStage', async () => {
      const schedulerHeaderService = module.get<SchedulerHeaderService>(
        SchedulerHeaderService,
      );
      const spy = jest
        .spyOn(schedulerHeaderService, 'generateForBatchCurrentStage')
        .mockResolvedValue({ scheduler_id: 'sched-1' } as any);

      const res = await service.generateSchedulerForBatch('b-1', 'tenant-123', {
        userId: 'user-1',
      });

      expect(spy).toHaveBeenCalledWith('b-1', 'tenant-123', {
        userId: 'user-1',
      });
      expect(res).toEqual({ scheduler_id: 'sched-1' });
    });
  });

  describe('getBatchPerformanceCurves', () => {
    it('returns structured standard curves vs actual metrics', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        batch_id: 'b-1',
        batch_no: 'BATCH-2026-0001',
        start_date: new Date(Date.now() - 5 * 86400000)
          .toISOString()
          .slice(0, 10),
        initial_quantity: 100,
        current_quantity: 98,
      } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([
                  {
                    tx: {
                      transaction_date: new Date(Date.now() - 3 * 86400000)
                        .toISOString()
                        .slice(0, 10),
                      transaction_type: 'CONSUMPTION',
                      quantity: '120.00',
                    },
                    item: { item_type: 'FEED' },
                  },
                  {
                    tx: {
                      transaction_date: new Date(Date.now() - 2 * 86400000)
                        .toISOString()
                        .slice(0, 10),
                      transaction_type: 'MORTALITY',
                      quantity: '2.00',
                    },
                    item: null,
                  },
                ]),
              }),
            }),
          }),
        }) // batch transactions
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // scheduler_header rows for this batch — none, so schedulerLines is never queried

      const res = await service.getBatchPerformanceCurves('b-1', 'tenant-123');

      expect(res.batch.batch_no).toBe('BATCH-2026-0001');
      expect(res.curves.length).toBeGreaterThan(0);
      expect(res.summary.totalActFeedKg).toBe(120);
      expect(res.summary.totalMortality).toBe(2);
    });
  });

  describe('Daily data entry progression & Stage transitions', () => {
    it('returns batch start_date as next pending date when no locks exist', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      const nextDate = await service.getNextPendingDate({
        batch_id: 'batch-1',
        start_date: '2026-09-01',
        tracking_mode: 'BATCH_WISE',
      });

      expect(nextDate).toBe('2026-09-01');
    });

    it('advances next pending date to next day when previous day is locked', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { entry_date: '2026-09-01', status: 'LOCKED' },
          ]),
        }),
      });

      const nextDate = await service.getNextPendingDate({
        batch_id: 'batch-1',
        start_date: '2026-09-01',
        tracking_mode: 'BATCH_WISE',
      });

      expect(nextDate).toBe('2026-09-02');
    });

    it('refuses to post if trying to skip dates beyond next pending date', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        tracking_mode: 'BATCH_WISE',
        stage_id: 'stage-gest',
        start_date: '2026-09-01',
      } as any);

      jest.spyOn(service, 'getNextPendingDate').mockResolvedValueOnce('2026-09-01');

      await expect(
        service.postBatchDay('batch-1', '2026-09-03', 'tenant-123'),
      ).rejects.toThrow('Daily data entry is mandatory. You cannot skip dates');
    });

    it('refuses to post if entry date is before batch start date', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        tracking_mode: 'BATCH_WISE',
        stage_id: 'stage-gest',
        start_date: '2026-09-05',
      } as any);

      await expect(
        service.postBatchDay('batch-1', '2026-09-02', 'tenant-123'),
      ).rejects.toThrow('before batch start date');
    });

    it('evaluates stage transition rules: flags auto_transition_due when days reach auto_move_on_day', async () => {
      const currentStage = {
        stage_id: 'stage-weaner',
        stage_code: 'WEANER',
        stage_name: 'Weaner',
        stage_sequence: 12,
        typical_duration_days: 42,
        min_days_before_move: 14,
        transition_trigger: 'AUTO_BY_DAY',
        auto_move_on_day: 42,
      };
      const nextStage = {
        stage_id: 'stage-grower',
        stage_code: 'GROWER',
        stage_name: 'Grower',
        stage_sequence: 13,
        typical_duration_days: 70,
        min_days_before_move: 0,
      };

      // 1. Stage master lookup
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([currentStage]),
            }),
          }),
        })
        // 2. Batch stage log lookup (transferred 45 days ago)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([
                  {
                    transferred_at: new Date(Date.now() - 45 * 86400000)
                      .toISOString()
                      .slice(0, 19)
                      .replace('T', ' '),
                  },
                ]),
              }),
            }),
          }),
        })
        // 3. Next stage lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([nextStage]),
              }),
            }),
          }),
        })
        // 4. Valid next stages lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([nextStage]),
            }),
          }),
        });

      const info = await service.getStageTransitionInfo({
        batch_id: 'batch-1',
        lob_id: 'lob-1',
        stage_id: 'stage-weaner',
        current_stage_code: 'WEANER',
        start_date: '2026-08-01',
      });

      expect(info?.auto_transition_due).toBe(true);
      expect(info?.next_stage?.stage_code).toBe('GROWER');
      expect(info?.can_move_without_remarks).toBe(true);
      expect(info?.min_days_before_move).toBe(14);
      expect(info?.days_in_stage).toBeGreaterThanOrEqual(42);
    });
  });
});


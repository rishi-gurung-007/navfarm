import { Test, TestingModule } from '@nestjs/testing';
import { BatchService } from './batch.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { BioCostingExitService } from '../../finance/bio-costing/bio-costing-exit.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { BatchDayReversalService } from './batch-day-reversal.service';
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
          // 'tenantPostingTransaction' true: a day's posting joins the transaction the unit test stands in for.
          useValue: { get: jest.fn((key: string) => (key === 'tenantPostingTransaction' ? true : mockDb)) },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        { provide: BioCostingExitService, useValue: { clearOnDeath: jest.fn().mockResolvedValue({ cleared: 0, reason: 'NO_PROFILE' }) } },
        { provide: AnimalBookValueService, useValue: { valueOf: jest.fn().mockResolvedValue({ acquisition: 0, capitalised: 0, amortised: 0, fairValue: 0, exits: 0, bookValue: 0, hasRows: false }), valuesFor: jest.fn().mockResolvedValue(new Map()), refreshCache: jest.fn().mockResolvedValue(undefined) } },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: GlPostingService, useValue: { animalAssetAccountId: jest.fn().mockResolvedValue(undefined), animalAssetAccountIds: jest.fn().mockResolvedValue(new Map()) } },
        {
          provide: NumberSeriesService,
          useValue: {
            generateNext: jest.fn().mockResolvedValue('BATCH-000001'),
            ensureCompanySeries: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SchedulerHeaderService,
          useValue: {
            createForStage: jest.fn().mockResolvedValue({}),
            generateForBatchCurrentStage: jest.fn().mockResolvedValue({}),
            syncAnimalWiseCounts: jest.fn().mockResolvedValue(undefined),
            countLiveAnimalsAtStage: jest.fn().mockResolvedValue(0),
            alignToStageEntry: jest.fn().mockResolvedValue(null),
            stageEntryDate: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
        {
          provide: BatchDayReversalService,
          useValue: { unpostDay: jest.fn().mockResolvedValue({ unposted: 0, kept: [], consumption_reversed: false }) },
        },
        {
          provide: 'BATCH_DAILY_DATA_POSTER',
          useValue: { postEntry: jest.fn().mockResolvedValue({}), postCollected: jest.fn().mockResolvedValue(undefined), reevaluateFeedLevels: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<BatchService>(BatchService);
    numberSeriesService = module.get<NumberSeriesService>(NumberSeriesService);
    // The closed-period guard reads reporting_period; specs that are not about it leave the period open.
    jest.spyOn(service as any, 'assertBioPeriodOpen').mockResolvedValue(undefined);
  });

  describe('create', () => {
    describe('an opening quantity of zero', () => {
      const bioDto = (over: object = {}) => ({
        company_id: 'comp-1', lob_id: 'lob-piggery', costing_method: 'BIO_ASSET', tracking_mode: 'BATCH_WISE', start_date: '2026-11-06',
        uom: 'HEAD', opening_quantity: 0, input_lines: [{ item_id: 'item-1', quantity: 0, uom: 'HEAD' }], ...over,
      }) as any;

      it('is refused for an ordinary create, bio-asset or not', async () => {
        await expect(service.create(bioDto(), 'tenant-123')).rejects.toThrow('opening quantity greater than zero');
        await expect(service.create(bioDto({ costing_method: 'FIFO' }), 'tenant-123')).rejects.toThrow('opening quantity greater than zero');
      });

      it('is still refused for a non-bio-asset batch when an internal caller asks for an empty opening', async () => {
        await expect(service.create(bioDto({ costing_method: 'FIFO' }), 'tenant-123', undefined, { opensEmpty: true })).rejects.toThrow('opening quantity greater than zero');
      });

      it('still refuses a line with no quantity when the opening is not empty-allowed, and a negative quantity always', async () => {
        await expect(service.create(bioDto({ opening_quantity: 5 }), 'tenant-123')).rejects.toThrow('greater than zero for all batch input lines');
        await expect(service.create(bioDto({ opening_quantity: -1 }), 'tenant-123', undefined, { opensEmpty: true })).rejects.toThrow('opening quantity greater than zero');
        await expect(service.create(bioDto({ input_lines: [{ item_id: 'item-1', quantity: -2, uom: 'HEAD' }] }), 'tenant-123', undefined, { opensEmpty: true })).rejects.toThrow('greater than zero for all batch input lines');
      });
    });

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

    it('numbers a litter lot from its own LITTER_LOT series, makes that series first if the company has none, and marks the header', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1', costing_method_allowed: 'BIO_ASSET' }]),
          }),
        }),
      });
      const insertValues = jest.fn().mockResolvedValue({});
      mockDbTransaction.mockImplementation(async (cb: any) => cb(mockDb));
      mockDbInsert.mockReturnValue({ values: insertValues });
      (numberSeriesService.generateNext as jest.Mock).mockClear();
      (numberSeriesService.generateNext as jest.Mock).mockResolvedValueOnce('LIT-000001');
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...activeBatch, batch_no: 'LIT-000001' } as any);

      const result = await service.create(
        {
          company_id: 'comp-1', lob_id: 'lob-piggery', costing_method: 'BIO_ASSET', start_date: '2026-05-29', opening_quantity: 10, uom: 'HEAD',
          input_lines: [{ item_id: 'item-1', quantity: 10, uom: 'HEAD', rate: 0 }],
        } as any,
        'tenant-123',
        { userId: 'user-1' },
        { litterLot: true },
      );

      expect((numberSeriesService as any).ensureCompanySeries).toHaveBeenCalledWith('tenant-123', 'comp-1', expect.objectContaining({ seriesCode: 'LITTER_LOT', prefix: 'LIT' }), expect.any(Function));
      expect(numberSeriesService.generateNext).toHaveBeenCalledWith('LITTER_LOT', 'tenant-123', 'comp-1', mockDb);
      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ batch_no: 'LIT-000001', is_litter_lot: true }));
      expect(result.batch_no).toBe('LIT-000001');
    });

    it('leaves an ordinary batch unmarked and numbered from the BATCH series', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nob_id: 'nob-1', costing_method_allowed: 'FIFO' }]) }) }),
      });
      const insertValues = jest.fn().mockResolvedValue({});
      mockDbTransaction.mockImplementation(async (cb: any) => cb(mockDb));
      mockDbInsert.mockReturnValue({ values: insertValues });
      (numberSeriesService.generateNext as jest.Mock).mockClear();
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...activeBatch, batch_no: 'BATCH-000001' } as any);

      await service.create(
        { company_id: 'comp-1', lob_id: 'lob-piggery', costing_method: 'FIFO', start_date: '2026-01-01', opening_quantity: 100, uom: 'HEAD', input_lines: [{ item_id: 'item-1', quantity: 100, uom: 'HEAD' }] } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(numberSeriesService.generateNext).toHaveBeenCalledWith('BATCH', 'tenant-123', 'comp-1', mockDb);
      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ is_litter_lot: false }));
    });

    it('saves an ANIMAL_WISE draft with no animals, opening quantity 0 and nothing claimed', async () => {
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
      const values = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({ values });
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        batch_no: 'BATCH-000001',
        tracking_mode: 'ANIMAL_WISE',
      } as any);

      await service.create(
        {
          tracking_mode: 'ANIMAL_WISE',
          company_id: 'comp-1',
          lob_id: 'lob-piggery',
          costing_method: 'FIFO',
          start_date: '2026-01-01',
          uom: 'HEAD',
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DRAFT', tracking_mode: 'ANIMAL_WISE', opening_quantity: '0' }),
      );
      expect(mockDbUpdate).not.toHaveBeenCalled();
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
      ).rejects.toThrow('These animals already belong to a batch: PIG-0001.');
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
          // The user declined the system scheduler copy — passed to every stage's header.
          scheduler_source: 'EMPTY',
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
        { source: 'EMPTY' },
      );
      expect(schedulerHeaderService.createForStage).toHaveBeenCalledWith(
        expect.any(String),
        'stage-grower',
        'tenant-123',
        { userId: 'user-1' },
        { source: 'EMPTY' },
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
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ animal_id: 'a-1' }]) }),
        }),
      });

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

    it('refuses to activate an ANIMAL_WISE batch that has no animals', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({
        ...activeBatch,
        status: 'DRAFT',
        tracking_mode: 'ANIMAL_WISE',
        input_lines: [],
        stage_id: null,
      } as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      });

      await expect(service.activate('batch-1', 'tenant-123', { userId: 'user-1' })).rejects.toThrow(
        'Add at least one animal to this batch before creating it.',
      );
      expect(mockDbUpdate).not.toHaveBeenCalled();
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

  // A7: the fallbacks are for mocks without a query method, not for a database that failed.
  describe('errors that are not a mock\'s missing method', () => {
    it('lets a database error through instead of guessing the next pending date', async () => {
      const dbError = Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockRejectedValue(dbError) }) });
      await expect(service.getNextPendingDate({ batch_id: 'b-1', start_date: '2026-10-01' })).rejects.toThrow('Lock wait timeout');
    });

    it('still falls back when the mock has no such method', async () => {
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({}) }); // .where is not a function → TypeError
      await expect(service.getNextPendingDate({ batch_id: 'b-1', start_date: '2026-10-01' })).resolves.toBe('2026-10-01');
    });
  });

  // BBP-1: an INFO alert when an animal has been out of production more than 14 days without being culled.
  describe('the cull-hold alert', () => {
    const batch = { batch_id: 'b-1', batch_no: 'BATCH-000005', tenant_id: 't', company_id: 'c', lob_id: 'l' };
    const held = (since: string) => ({ animal_id: 'a-1', animal_code: 'PIG-0024', is_active: true, out_of_production_date: since });
    const noAlertYet = () => mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) });

    it('raises one INFO alert after 14 days, none before, and not twice', async () => {
      const values = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({ values });

      await (service as any).raiseCullHoldAlerts(batch, [held('2026-09-25')], '2026-10-09'); // 14 days: not yet
      expect(values).not.toHaveBeenCalled();

      noAlertYet();
      await (service as any).raiseCullHoldAlerts(batch, [held('2026-09-20')], '2026-10-09'); // 19 days
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ alert_type: 'CULL_HOLD', severity: 'INFO', batch_id: 'b-1', actual_value: '19' }));

      values.mockClear();
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ alert_id: 'x' }]) }) }) });
      await (service as any).raiseCullHoldAlerts(batch, [held('2026-09-20')], '2026-10-10');
      expect(values).not.toHaveBeenCalled();
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

    // Ruling M6 on the ANIMAL_WISE day post: every draft line defers its own
    // silo re-check, and the call makes one for the batch's farm — also when a
    // later line throws after earlier ones have already moved stock.
    describe('feed level re-check', () => {
      const optionalLine = { line_id: 'line-feed', is_mandatory: false, activity_name: 'Feed' };
      const arrange = () => {
        jest
          .spyOn(service, 'findOne')
          .mockResolvedValueOnce({ ...animalWiseBatch, farm_id: 'farm-1' } as any);
        jest
          .spyOn(service as any, 'loadScheduleLinesForHeader')
          .mockResolvedValueOnce([{ header: {}, line: optionalLine }]);
        mockDbSelect
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                { animal_id: 'a-1', animal_code: 'PIG-0001' },
                { animal_id: 'a-2', animal_code: 'PIG-0002' },
              ]),
            }),
          }) // live animals
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
          }) // none posted yet today (the single-animal post's check)
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1' }]),
              }),
            }),
          }) // scheduler header
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                { line_id: 'line-feed', animal_id: 'a-1', entered_value: '2.0000' },
                { line_id: 'line-feed', animal_id: 'a-2', entered_value: '2.5000' },
              ]),
            }),
          }); // two still-draft rows
        mockDbInsert.mockReturnValue({
          values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }),
        });
        return module.get('BATCH_DAILY_DATA_POSTER');
      };

      it('defers every line and re-checks the farm once', async () => {
        const poster = arrange();
        const result = await service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123', { userId: 'user-1' });
        expect(result.status).toBe('LOCKED');
        expect(poster.postEntry).toHaveBeenCalledTimes(2);
        for (const call of (poster.postEntry as jest.Mock).mock.calls) expect(call[4]).toEqual({ deferFeedAlerts: true, collector: expect.any(Array) });
        expect(poster.reevaluateFeedLevels).toHaveBeenCalledTimes(1);
        expect(poster.reevaluateFeedLevels).toHaveBeenCalledWith('farm-1', 'tenant-123');
      });

      it('does not re-check when a later line throws — the whole day rolls back, then rethrows', async () => {
        const poster = arrange();
        (poster.postEntry as jest.Mock)
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new BadRequestException('line 2 refused'));
        await expect(
          service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123', { userId: 'user-1' }),
        ).rejects.toThrow('line 2 refused');
        // The day posts together or not at all: line 1 went back with line 2, so no silo moved.
        expect(poster.reevaluateFeedLevels).not.toHaveBeenCalled();
        expect(mockDbInsert).not.toHaveBeenCalled(); // the day was not locked
      });

      it('does not re-check when the first line throws — nothing moved', async () => {
        const poster = arrange();
        (poster.postEntry as jest.Mock).mockRejectedValueOnce(new BadRequestException('line 1 refused'));
        await expect(
          service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123'),
        ).rejects.toThrow('line 1 refused');
        expect(poster.reevaluateFeedLevels).not.toHaveBeenCalled();
      });
    });

    // A weaning moves the sow to Dry Sow and a transfer takes the animal out of the batch: her other entries of the day
    // must post first, while she is still where they were entered, with their consumption issued before she moves.
    it('posts the day’s outputs and transfers after everything else, once the consumption is issued', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...animalWiseBatch, farm_id: 'farm-1' } as any);
      jest.spyOn(service as any, 'loadScheduleLinesForHeader').mockResolvedValueOnce([
        { header: {}, line: { line_id: 'line-xfer', line_type: 'TRANSFER', is_mandatory: false } },
        { header: {}, line: { line_id: 'line-out', line_type: 'OUTPUT', is_mandatory: false } },
        { header: {}, line: { line_id: 'line-feed', line_type: 'CONSUMPTION', is_mandatory: false } },
      ]);
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ animal_id: 'a-1', animal_code: 'PIG-0001' }]) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1' }]) }) }) })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { line_id: 'line-xfer', animal_id: 'a-1', entered_value: '1', destination_batch_id: 'b-2' },
              { line_id: 'line-out', animal_id: 'a-1', entered_value: '8', item_id: 'item-piglet', destination_batch_id: 'b-3' },
              { line_id: 'line-feed', animal_id: 'a-1', entered_value: '2' },
            ]),
          }),
        });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }) });
      const poster = module.get('BATCH_DAILY_DATA_POSTER');
      (poster.postEntry as jest.Mock).mockClear();
      (poster.postCollected as jest.Mock).mockClear();

      await service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123', { userId: 'user-1' });

      const posted = (poster.postEntry as jest.Mock).mock.calls.map((c) => c[1]);
      expect(posted.map((dto: any) => dto.line_id)).toEqual(['line-feed', 'line-out', 'line-xfer']);
      // What the draft chose travels with it: the output's item and destination, the transfer's destination.
      expect(posted[1]).toMatchObject({ item_id: 'item-piglet', destination_batch_id: 'b-3' });
      expect(posted[2]).toMatchObject({ destination_batch_id: 'b-2' });
      const feedIssued = (poster.postCollected as jest.Mock).mock.invocationCallOrder[0];
      const outputPosted = (poster.postEntry as jest.Mock).mock.invocationCallOrder[1];
      expect(feedIssued).toBeLessThan(outputPosted);
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

    // 13 Oct: every animal posted (one at a time, or by the demo seed) but the stage never locked left the date
    // "next pending" for good. Posting the stage now checks every animal's mandatory entries and locks it.
    const lockOnlyChain = (existingLock: unknown[]) => {
      // A locked stage stops at the lock read, so only the first three reads are queued for it.
      const full = existingLock.length === 0;
      const mandatoryLine = { line_id: 'line-feed', scheduler_id: 'sched-1', is_active: true, occurrence: 'DAILY', start_day: 1, end_day: null, is_mandatory: true, activity_name: 'Feed' };
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ animal_id: 'a-1', animal_code: 'PIG-0001' }, { animal_id: 'a-2', animal_code: 'PIG-0002' }]) }) }) // live animals
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ animal_id: 'a-1', posted: true }, { animal_id: 'a-2', posted: true }]) }) }) // both posted
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(existingLock) }) }) }); // stage lock
      if (!full) return;
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ scheduler_id: 'sched-1', effective_from: '2026-09-01', animal_count: '2' }]) }) }) }) // scheduler header
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([mandatoryLine]) }) }) // due lines
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ line_id: 'line-feed', animal_id: 'a-1' }, { line_id: 'line-feed', animal_id: 'a-2' }]) }) }) // mandatory present for both
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // no drafts
    };

    it('locks a stage whose animals are all posted but which was never locked', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      lockOnlyChain([]);
      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate }) });

      const result = await service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('LOCKED');
      expect(onDuplicateKeyUpdate).toHaveBeenCalled();
    });

    it('still refuses a stage that is already locked with every animal posted', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      lockOnlyChain([{ status: 'LOCKED' }]);
      await expect(
        service.postStageDay('batch-1', 'stage-flush', '2026-09-11', 'tenant-123', { userId: 'user-1' }),
      ).rejects.toThrow('All animals in this stage have already been posted on 2026-09-11.');
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

    it('reverses what the day posted before it unlocks, and says what it had to leave posted', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...animalWiseBatch, farm_id: 'farm-1' } as any);
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lock_id: 'lock-1', status: 'LOCKED' }]) }) }) });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      const reversal = module.get(BatchDayReversalService).unpostDay as jest.Mock;
      reversal.mockResolvedValueOnce({
        unposted: 3,
        kept: [{ activity_name: 'Move to growers', animal_id: 'a-1', reason: 'it moved animals — use "Reverse transfer" on the transfer' }],
        consumption_reversed: true,
      });
      const recheck = (module.get('BATCH_DAILY_DATA_POSTER') as any).reevaluateFeedLevels as jest.Mock;
      recheck.mockClear();

      const result: any = await service.reopenStageDay('batch-1', 'stage-flush', '2026-09-11', 'Wrong feed qty', 'tenant-123', { userId: 'user-1' });

      expect(reversal).toHaveBeenCalledWith('batch-1', 'stage-flush', '2026-09-11', 'Wrong feed qty', 'tenant-123', 'user-1');
      expect(result.unposted).toBe(3);
      expect(result.kept_posted).toHaveLength(1);
      expect(recheck).toHaveBeenCalledWith('farm-1', 'tenant-123'); // stock went back into a silo
    });

    it('does not unlock when the day cannot be reversed — a failed reversal propagates and the lock stays', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ lock_id: 'lock-1', status: 'LOCKED' }]) }) }) });
      mockDbUpdate.mockReset();
      (module.get(BatchDayReversalService).unpostDay as jest.Mock).mockRejectedValueOnce(new BadRequestException('Some of the output has already been used.'));

      await expect(
        service.reopenStageDay('batch-1', 'stage-flush', '2026-09-11', 'Fix', 'tenant-123', { userId: 'user-1' }),
      ).rejects.toThrow('already been used');
      expect(mockDbUpdate).not.toHaveBeenCalled();
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

  describe('expected quantity of a scheduler line', () => {
    const expected = (line: object, animals: number, stageAnimals?: number) =>
      (service as any).computeExpectedQty({ standard_qty: '2', ...line }, animals, stageAnimals);

    it('per head is the standard times the animals — and a line with no basis reads as per head', () => {
      expect(expected({ qty_basis: 'PER_HEAD' }, 4)).toBe(8);
      expect(expected({ qty_basis: null }, 4)).toBe(8);
      expect(expected({ qty_basis: 'PER_HEAD' }, 1)).toBe(2);
    });

    it('per batch is the whole stage\'s standard, shared out per animal in an animal-wise stage', () => {
      expect(expected({ qty_basis: 'TOTAL_BATCH' }, 4)).toBe(2);
      expect(expected({ qty_basis: 'TOTAL_BATCH' }, 1, 2)).toBe(1);
      expect(expected({ qty_basis: 'TOTAL_BATCH' }, 1, 3)).toBeCloseTo(0.6667, 4);
    });
  });

  describe('postBatchDay', () => {
    const batchWiseBatch = {
      ...activeBatch,
      tracking_mode: 'BATCH_WISE',
      stage_id: 'stage-gest',
      company_id: 'comp-1',
      farm_id: 'farm-1',
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
                empty_bags: 12,
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
          empty_bags: 12, // checkpoint 28: the count saved on the draft reaches the post
        }),
        'tenant-123',
        { userId: 'user-1' },
        { deferFeedAlerts: true, collector: expect.any(Array) },
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
        { deferFeedAlerts: true, collector: expect.any(Array) },
      );
      // Ruling M6: the lines defer their silo-level re-check, and the day
      // makes it once, for the batch's farm, after every line has posted.
      expect(dailyDataPoster.reevaluateFeedLevels).toHaveBeenCalledTimes(1);
      expect(dailyDataPoster.reevaluateFeedLevels).toHaveBeenCalledWith('farm-1', 'tenant-123');
      // Neither dispatch call carries `draft` — this is the real, final post.
      const calledDtos = (
        dailyDataPoster.postEntry as jest.Mock
      ).mock.calls.map((c) => c[1]);
      expect(calledDtos.every((dto) => dto.draft === undefined)).toBe(true);
    });

    it('does not re-check silo levels when a later draft line throws — the whole day rolls back, then rethrows', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(batchWiseBatch as any);
      jest
        .spyOn(service as any, 'loadActiveScheduleLines')
        .mockResolvedValueOnce([{ header: {}, line: { line_id: 'line-feed', is_mandatory: false, activity_name: 'Feed' } }]);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { line_id: 'line-feed', entered_value: '40.0000' },
            { line_id: 'line-feed', entered_value: '41.0000' },
          ]),
        }),
      }); // two still-draft rows
      const poster = module.get('BATCH_DAILY_DATA_POSTER');
      (poster.postEntry as jest.Mock)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new BadRequestException('line 2 refused'));

      await expect(
        service.postBatchDay('batch-1', '2026-09-11', 'tenant-123', { userId: 'user-1' }),
      ).rejects.toThrow('line 2 refused');
      // Line 1 went back with line 2, so no silo moved and nothing is re-checked.
      expect(poster.reevaluateFeedLevels).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled(); // the day was not locked
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
      // Nothing was dispatched, so no stock moved and no silo needs re-checking.
      expect(module.get('BATCH_DAILY_DATA_POSTER').reevaluateFeedLevels).not.toHaveBeenCalled();
    });
  });

  describe('transferStage — animal-wise batch', () => {
    const lim = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
    const setup = () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ ...activeBatch, tracking_mode: 'ANIMAL_WISE', stage_id: 'st-old', current_stage_code: 'GESTATION' } as any);
      mockDbSelect
        .mockReturnValueOnce(lim([{ stage_id: 'st-new' }])) // destination stage
        .mockReturnValueOnce(lim([{ min_days_before_move: 0, stage_name: 'Gestation' }])) // stage being left
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // animals in step
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      return sets;
    };

    it('leaves the stage being left open while animals are still in it, and recounts the headcounts', async () => {
      const sets = setup();
      const scheduler = module.get(SchedulerHeaderService) as any;
      scheduler.countLiveAnimalsAtStage.mockResolvedValueOnce(2);

      await service.transferStage('batch-1', { to_stage_code: 'FARROWING' } as any, 'tenant-123');

      expect(sets.find((v) => v.scheduler_status === 'COMPLETED')).toBeUndefined();
      expect(scheduler.syncAnimalWiseCounts).toHaveBeenCalledWith('batch-1');
    });

    it('closes the stage being left once nobody is in it', async () => {
      const sets = setup();

      await service.transferStage('batch-1', { to_stage_code: 'FARROWING', transfer_date: '2026-09-01' } as any, 'tenant-123');

      expect(sets.find((v) => v.scheduler_status === 'COMPLETED')).toMatchObject({ actual_end_date: '2026-09-01' });
    });

    it('leaves behind animals of the other sex when the new stage is set to one sex', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...activeBatch, tracking_mode: 'ANIMAL_WISE', stage_id: 'st-old', current_stage_code: 'GESTATION' } as any);
      mockDbSelect
        .mockReturnValueOnce(lim([{ stage_id: 'st-farrow', applicable_gender: 'F' }]))
        .mockReturnValueOnce(lim([{ min_days_before_move: 0, stage_name: 'Gestation' }]))
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([
          { animal_id: 'sow-1', gender: 'F' }, { animal_id: 'boar-1', gender: 'M' },
        ]) }) });
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const movement = module.get(AnimalMovementLogService).record as jest.Mock;
      movement.mockClear();

      await service.transferStage('batch-1', { to_stage_code: 'FARROWING' } as any, 'tenant-123');

      expect(movement).toHaveBeenCalledTimes(1);
      expect(movement.mock.calls[0][0]).toMatchObject({ animalId: 'sow-1' });
    });

    it('refuses a move dated in the future', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(activeBatch as any);
      await expect(
        service.transferStage('batch-1', { to_stage_code: 'FARROWING', transfer_date: '2999-01-01' } as any, 'tenant-123'),
      ).rejects.toThrow('cannot be dated in the future');
    });
  });

  describe('transferStage — which stage_master row the move lands on', () => {
    /**
     * A stage code exists more than once per LOB: the tenant template row (company_id NULL) and each company's own
     * copy. The move matched on LOB and code alone and took the first row, so it could land the batch on the
     * template — a row belonging to no company. BATCH-000012 did exactly that on 15 Oct: batch_header.stage_id and
     * the scheduler the move created pointed at the template FLUSH while the batch's earlier scheduler pointed at
     * Blank Test Co's FLUSH, so Data Entry drew two "Flush" stages and the one-scheduler-per-(batch, stage) check
     * never saw a duplicate.
     */
    const stageLookupReturning = (rows: Record<string, unknown>[]) => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }),
          }),
        })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    };
    const stageIdWritten = () =>
      (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0].stage_id;

    beforeEach(() => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({ ...activeBatch, current_stage_code: 'FLUSH' } as any);
    });

    it("takes the batch's own company's row even when the tenant template comes back first", async () => {
      stageLookupReturning([
        { stage_id: 'stage-flush-template', company_id: null },
        { stage_id: 'stage-flush-comp-1', company_id: 'comp-1' },
      ]);
      await service.transferStage('batch-1', { to_stage_code: 'FLUSH' } as any, 'tenant-123', { userId: 'user-1' });
      expect(stageIdWritten()).toBe('stage-flush-comp-1');
    });

    it('falls back to the tenant template when the company has no copy of its own', async () => {
      stageLookupReturning([{ stage_id: 'stage-flush-template', company_id: null }]);
      await service.transferStage('batch-1', { to_stage_code: 'FLUSH' } as any, 'tenant-123', { userId: 'user-1' });
      expect(stageIdWritten()).toBe('stage-flush-template');
    });

    it("never takes another company's row", async () => {
      stageLookupReturning([
        { stage_id: 'stage-flush-other-co', company_id: 'comp-2' },
        { stage_id: 'stage-flush-template', company_id: null },
      ]);
      await service.transferStage('batch-1', { to_stage_code: 'FLUSH' } as any, 'tenant-123', { userId: 'user-1' });
      expect(stageIdWritten()).not.toBe('stage-flush-other-co');
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

  describe('addTransaction — mortality', () => {
    const chain = (rows: any[]) => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
          for: jest.fn().mockResolvedValue(rows),
        }),
      }),
    });
    const animalWiseBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000002',
      costing_method: 'STANDARD',
      tracking_mode: 'ANIMAL_WISE',
      stage_id: 'st-header',
      closing_quantity: '3',
      opening_quantity: '3',
      location_id: 'pen-1',
    };
    const liveSow = {
      animal_id: 'a-1',
      animal_code: 'PIG-0001',
      company_id: 'comp-1',
      current_batch_id: 'batch-1',
      current_stage_id: 'st-gest',
      current_location_id: 'pen-2',
      is_active: true,
      status: 'ACTIVE',
      book_value: null,
    };

    it('refuses an anonymous head count on an animal-wise batch — the register would keep the dead animal alive', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      await expect(
        service.addTransaction(
          'batch-1',
          { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', quantity: 2 } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('choose the animal(s) that died');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses an animal that is not a member of the batch, before anything is posted', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce(chain([{ ...liveSow, current_batch_id: 'other-batch' }]));
      await expect(
        service.addTransaction(
          'batch-1',
          { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('not a member of batch');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses an animal that is already dead', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce(chain([{ ...liveSow, is_active: false, status: 'DEAD' }]));
      await expect(
        service.addTransaction(
          'batch-1',
          { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('already dead');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses a reason that is not a MORTALITY reason', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(animalWiseBatch as any);
      mockDbSelect.mockReturnValueOnce(chain([{ reason_id: 'r-cull', category: 'CULL', reason_name: 'Unsound legs' }]));
      await expect(
        service.addTransaction(
          'batch-1',
          {
            transaction_date: '2026-10-01',
            transaction_type: 'MORTALITY',
            animal_id: 'a-1',
            mortality_detail: { reason_id: 'r-cull' },
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow('not MORTALITY');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('posts one animal as a whole: transaction, cause from the reason, register flip, movement, stage headcount', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(animalWiseBatch as any);
      jest.spyOn(service as any, 'computeRunningUnitCost').mockResolvedValue(10);
      jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
      const gl = module.get(GlPostingService) as any;
      gl.postBatchCostEntry = jest.fn().mockResolvedValue({});
      const movement = module.get(AnimalMovementLogService) as any;

      mockDbSelect
        .mockReturnValueOnce(chain([{ reason_id: 'r-mrt', category: 'MORTALITY', reason_name: 'Pneumonia' }]))
        .mockReturnValueOnce(chain([liveSow]));
      const inserted: any[] = [];
      mockDbInsert.mockImplementation(() => ({
        values: jest.fn((v: any) => {
          inserted.push(v);
          return Promise.resolve({});
        }),
      }));
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({
        set: jest.fn((v: any) => {
          sets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      }));

      await service.addTransaction(
        'batch-1',
        {
          transaction_date: '2026-10-01',
          transaction_type: 'MORTALITY',
          animal_id: 'a-1',
          mortality_detail: { reason_id: 'r-mrt' },
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const txn = inserted.find((v) => v.transaction_type === 'MORTALITY');
      expect(txn).toMatchObject({ quantity: '1', animal_id: 'a-1', amount: '-10' });
      expect(inserted.find((v) => v.cause_of_death)).toMatchObject({ cause_of_death: 'Pneumonia', location_id: 'pen-1' });
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'MORTALITY', amount: 10 }));
      expect(sets.find((v) => v.status === 'DEAD')).toMatchObject({
        is_active: false,
        disposal_type: 'DIED',
        disposal_date: '2026-10-01',
        disposal_reason_id: 'r-mrt',
      });
      expect(movement.record).toHaveBeenCalledWith(
        expect.objectContaining({ animalId: 'a-1', movementType: 'MORTALITY', fromStageId: 'st-gest', reason: 'Pneumonia' }),
      );
      // An animal-wise batch is recounted from the register (each header = live animals at its
      // own stage), not decremented from a number that may have drifted.
      expect(sets.find((v) => v.animal_count !== undefined)).toBeUndefined();
      expect(module.get(SchedulerHeaderService).syncAnimalWiseCounts).toHaveBeenCalledWith('batch-1');
    });

    // F5 + bio-asset costing Phase 2 (X5): a death writes off ONE figure on her own ledger, her whole derived book value;
    // the herd and the GL give up her own capitalised cost, not the herd's per-head average.
    describe('a named animal dies in a BIO_ASSET batch (X5)', () => {
      const countSelect = (n: string) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ n }]) }) });
      // `inGl`: her acquisition was journalled (the receipt's, or her registration's), so what leaves the GL is her whole book value.
      const prime = (animalLevelRows: string, derived: Record<string, unknown>, inGl = false) => {
        jest.spyOn(service as any, 'animalAcquisitionIsInGl').mockResolvedValue(inGl);
        jest.spyOn(service, 'findOne').mockResolvedValue({ ...animalWiseBatch, costing_method: 'BIO_ASSET', input_lines: [] } as any);
        jest.spyOn(service as any, 'ensureBioState').mockResolvedValue({ current_quantity: '4', nca_book_value: '3772', stage: 'PREMATURE' });
        jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
        const gl = { postBatchCostEntry: jest.fn().mockResolvedValue({}) };
        (module.get(GlPostingService) as any).postBatchCostEntry = gl.postBatchCostEntry;
        (module.get(AnimalBookValueService) as any).valueOf = jest.fn().mockResolvedValue(derived);
        mockDbSelect
          .mockReturnValueOnce(chain([{ ...liveSow, item_id: 'item-sow', book_value: '28000', nob_id: 'n', lob_id: 'l' }]))
          .mockReturnValueOnce(countSelect(animalLevelRows));
        const inserted: any[] = [];
        const sets: any[] = [];
        mockDbInsert.mockImplementation(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) }));
        mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));
        return { gl, inserted, sets };
      };
      const sow = { acquisition: 28000, capitalised: 500, amortised: 0, fairValue: 0, exits: 0, bookValue: 28500, hasRows: true };

      it('writes ONE ledger row for her: the whole book value, 28 500, not a share row and a register row', async () => {
        const { inserted } = prime('12', sow);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        const ledger = inserted.filter((v) => v.document_type === 'MORTALITY');
        expect(ledger).toHaveLength(1);
        expect(ledger[0]).toMatchObject({ animal_id: 'a-1', bio_asset_item_id: 'item-sow', cost_amount: '-28500', batch_id: 'batch-1' });
        expect((module.get(AnimalBookValueService) as any).refreshCache).toHaveBeenCalledWith(['a-1']);
      });

      it('clears what the costing runs amortised her to date against the acquisition cost (the BBP\'s accumulated-amortisation leg), with the death date', async () => {
        prime('12', sow);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123', { userId: 'u-1' } as any);
        expect(module.get(BioCostingExitService).clearOnDeath).toHaveBeenCalledWith('a-1', '2026-10-01', 'tenant-123', 'u-1');
      });

      it('takes her OWN capitalised cost (500) out of the herd and the journal, where the batch holds animal-level cost', async () => {
        const { gl, sets } = prime('12', sow);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_MORTALITY_PREMATURE', amount: 500 }));
        expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ nca_book_value: '3272', current_quantity: '3' });
      });

      it('takes her whole book value (28 500: what she cost, plus her capitalised cost) out of the GL once her acquisition is journalled, and only her capitalised 500 out of the herd', async () => {
        const { gl, sets } = prime('12', sow, true);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_MORTALITY_PREMATURE', amount: 28500 }));
        expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ nca_book_value: '3272', current_quantity: '3' });
      });

      it('never writes off less than her capitalised cost, whatever her book value says', async () => {
        const { gl } = prime('12', { ...sow, capitalised: 600, bookValue: 100 }, true);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 600 }));
      });

      it('falls back to the herd average (3772 / 4 = 943) where the batch has no animal-level cost, still one ledger row', async () => {
        const { gl, inserted } = prime('0', sow);
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 943 }));
        expect(inserted.filter((v) => v.document_type === 'MORTALITY')).toHaveLength(1);
      });

      it('never takes more out of the herd than the herd holds', async () => {
        const { gl } = prime('12', { ...sow, capitalised: 9999 });
        await service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', animal_id: 'a-1' } as any, 'tenant-123');
        expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 3772 }));
      });
    });

    describe('whether an animal\'s acquisition is in the GL', () => {
      const chainOf = (rows: unknown[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
      const isInGl = () => (service as any).animalAcquisitionIsInGl('a-1');

      it('is, for an animal registered with no receipt, when her registration has a posted journal', async () => {
        mockDbSelect.mockReturnValueOnce(chainOf([{ animal_code: 'PIG-2026-0009', source_receipt_id: null }])).mockReturnValueOnce(chainOf([{ id: 'j-1' }]));
        await expect(isInGl()).resolves.toBe(true);
      });

      it('is, for an animal from a receipt, when the receipt has a posted journal', async () => {
        mockDbSelect.mockReturnValueOnce(chainOf([{ animal_code: 'PIG-2026-0009', source_receipt_id: 'r-1' }])).mockReturnValueOnce(chainOf([{ receipt_no: 'GR-000007' }])).mockReturnValueOnce(chainOf([{ id: 'j-1' }]));
        await expect(isInGl()).resolves.toBe(true);
      });

      it('is not, for an animal registered before those journals existed', async () => {
        mockDbSelect.mockReturnValueOnce(chainOf([{ animal_code: 'PIG-2025-0001', source_receipt_id: null }])).mockReturnValueOnce(chainOf([]));
        await expect(isInGl()).resolves.toBe(false);
      });
    });

    it('leaves the stage headcount to the caller when told to', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...animalWiseBatch, tracking_mode: 'BATCH_WISE' } as any);
      jest.spyOn(service as any, 'computeRunningUnitCost').mockResolvedValue(10);
      jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
      (module.get(GlPostingService) as any).postBatchCostEntry = jest.fn().mockResolvedValue({});
      mockDbInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({
        set: jest.fn((v: any) => {
          sets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      }));

      await service.addTransaction(
        'batch-1',
        { transaction_date: '2026-10-01', transaction_type: 'MORTALITY', quantity: 2, skip_scheduler_count: true } as any,
        'tenant-123',
      );

      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(sets.find((v) => v.animal_count !== undefined)).toBeUndefined();
      expect(sets.find((v) => v.closing_quantity !== undefined)).toMatchObject({ closing_quantity: '1' });
    });
  });

  describe('addTransaction — output goes into a store with a lot, and leaves an output line', () => {
    const chainOf = (rows: unknown[]) => {
      const self: any = {
        from: () => self, where: () => self, limit: () => self, orderBy: () => self, innerJoin: () => self,
        then: (ok: any, err: any) => Promise.resolve(rows).then(ok, err),
      };
      return self;
    };
    const standardBatch = { ...activeBatch, batch_no: 'BATCH-000009', costing_method: 'STANDARD', farm_id: 'farm-1', nob_id: 'nob-1', input_lines: [], transactions: [] };
    let writePositiveEntry: jest.Mock;
    let inserted: Array<{ table: unknown; values: any }>;

    const arrange = (item: object) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(standardBatch as any);
      jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
      mockDbSelect.mockImplementation(() => ({
        from: (table: unknown) =>
          chainOf(table === schema.itemMaster ? [item] : table === schema.locationMaster ? [{ location_id: 'store-1' }] : []),
      }));
      writePositiveEntry = jest.fn().mockResolvedValue({ ledger_id: 'led-1', rate: '10.000000', amount: '100.0000' });
      (service as any).ledgerService = { writePositiveEntry };
      (service as any).glPostingService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), animalAssetAccountId: jest.fn().mockResolvedValue(undefined), animalAssetAccountIds: jest.fn().mockResolvedValue(new Map()) };
      inserted = [];
      mockDbInsert.mockImplementation((table: unknown) => ({ values: jest.fn((v: any) => { inserted.push({ table, values: v }); return Promise.resolve({}); }) }));
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
    };
    const output = (extra: object = {}) =>
      service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'OUTPUT', item_id: 'item-weaner', quantity: 10, uom: 'HEAD', rate: 10, ...extra } as any, 'tenant-123');

    it("posts into the farm's store, generates the lot of a lot-tracked item and dates its expiry", async () => {
      arrange({ is_lot_tracked: true, shelf_life_days: 30 });
      const generateNext = (service as any).numberSeriesService.generateNext as jest.Mock;
      generateNext.mockResolvedValueOnce('LOT-00007');

      await output();

      expect(generateNext).toHaveBeenCalledWith('ITEM_LOT', 'tenant-123', 'comp-1');
      expect(writePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'store-1', lotNo: 'LOT-00007', expiryDate: '2026-10-31' }));
    });

    it('keeps a lot the caller typed', async () => {
      arrange({ is_lot_tracked: true, shelf_life_days: null });
      const generateNext = (service as any).numberSeriesService.generateNext as jest.Mock;
      generateNext.mockClear();

      await output({ lot_no: 'MY-LOT' });

      expect(generateNext).not.toHaveBeenCalled();
      expect(writePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ lotNo: 'MY-LOT', expiryDate: undefined }));
    });

    it('leaves an output line with the transaction id, so a pack or a QC result has something to attach to', async () => {
      arrange({ is_lot_tracked: false, shelf_life_days: null });

      await output();

      const line = inserted.find((i) => i.table === schema.batchOutputLine)!.values;
      const txn = inserted.find((i) => i.table === schema.batchTransaction)!.values;
      expect(line).toMatchObject({ batch_id: 'batch-1', item_id: 'item-weaner', output_type: 'MAIN', quantity: '10', warehouse_id: 'store-1', computed_cost: '100' });
      expect(line.line_id).toBe(txn.transaction_id);
    });

    it('refuses a consumption with no item rather than guessing one from the remarks', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(standardBatch as any);
      const writeNegativeEntry = jest.fn();
      (service as any).ledgerService = { writeNegativeEntry };
      await expect(
        service.addTransaction('batch-1', { transaction_date: '2026-10-01', transaction_type: 'CONSUMPTION', quantity: 5, uom: 'ML', remarks: 'ivermectin dose' } as any, 'tenant-123'),
      ).rejects.toThrow('needs an item');
      expect(writeNegativeEntry).not.toHaveBeenCalled();
      expect(mockDbSelect).not.toHaveBeenCalled();
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
      expect(ledgerRow!.values).toMatchObject({ entry_type: 'NEGATIVE', transaction_type: 'CONSUMPTION', document_type: 'BATCH_HARVEST' });
      expect(ledgerRow!.values.batch_id).toBe('batch-1');
      // The movement must equal the reduction in carrying value.
      expect(Number(ledgerRow!.values.cost_amount)).toBe(-12000);
    });
  });

  describe('findAll', () => {
    it('names a litter lot by the litter it holds, and any other batch by its number', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  { ...activeBatch, batch_id: 'lot1', batch_no: 'LIT-000001', is_litter_lot: true, total_cost: null, closing_quantity: '10.0000' },
                  { ...activeBatch, batch_id: 'b9', batch_no: 'BATCH-000009', is_litter_lot: false, total_cost: null, closing_quantity: '20.0000' },
                ]),
              }), }),
            }),
          }),
        }) // batch rows
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // cost-bearing transactions
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([{ batch_id: 'lot1', sow: 'PIG-2025-0013', farrowed: '2026-05-29', lot_no: 'LOT-00004' }]),
            }),
          }),
        }); // the litters the lots hold

      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');

      expect(rows.find((r) => r.batch_id === 'lot1')?.display_name).toBe('Litter of PIG-2025-0013, farrowed 2026-05-29 (LOT-00004)');
      expect(rows.find((r) => r.batch_id === 'b9')?.display_name).toBe('BATCH-000009');
    });

    it('reports accumulated cost as wip_value so the dashboard tile is not structurally zero', async () => {
      // The console's WIP tile reads b.wip_value. Nothing in the API ever
      // returned that field, so Number(undefined) || 0 made the tile read
      // "₹ 0" no matter how much cost a batch had accumulated.
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  {
                    ...activeBatch,
                    batch_id: 'b1',
                    total_cost: null,
                    closing_quantity: '20.0000',
                  },
                ]),
              }), }),
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

    it('counts consumption and overhead stored as outflows (negative) as positive WIP (13 Oct)', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([{ ...activeBatch, batch_id: 'b1', total_cost: null, closing_quantity: '20.0000' }]),
              }), }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { batch_id: 'b1', transaction_type: 'CONSUMPTION', amount: '-1232.0000' },
              { batch_id: 'b1', transaction_type: 'OVERHEAD', amount: '-3300.0000' },
            ]),
          }),
        });
      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');
      expect(rows[0].wip_value).toBe(4532);
    });

    it('prefers the posted total_cost once a batch is closed', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  {
                    ...activeBatch,
                    batch_id: 'b2',
                    status: 'CLOSED',
                    total_cost: '999999.0000',
                  },
                ]),
              }), }),
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

    it('refuses to mature a batch of registered animals: each animal is costed from her own start age, not by one herd switch', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...bioBatch, tracking_mode: 'ANIMAL_WISE', animal_tracking: 'REGISTERED' } as any);
      await expect(
        service.matureBioAsset('batch-1', { residual_value_per_unit: 500, productive_life_months: 24 }, 'tenant-123'),
      ).rejects.toThrow(/holds registered animals.*Bio-Asset Costing Runs/);
      expect(mockDbSelect).not.toHaveBeenCalled(); // refused before the bio-asset state is read
      expect(mockDbUpdate).not.toHaveBeenCalled();
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
              { posting_date: '2026-02-01', entry_type: 'NEGATIVE', transaction_type: 'VARIANCE_NEGATIVE', document_type: 'BATCH_AMORTIZATION' },
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

  describe('amortizeBioAsset — guards (bio-asset costing Phase 1, X2/X4)', () => {
    const bioBatch = { ...activeBatch, batch_no: 'BATCH-000001', costing_method: 'BIO_ASSET', input_lines: [{ item_id: 'item-piglet' }] };
    const state = (extra: Record<string, unknown> = {}) => ({
      state_id: 'state-1', batch_id: 'batch-1', stage: 'MATURE', current_quantity: '10.0000', nca_book_value: '45000.0000',
      monthly_amortization_rate: '187.500000', residual_value_per_unit: '0', productive_life_months: 36, matured_at: '2026-01-15', ...extra,
    });
    const prime = (st: Record<string, unknown>) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);
      const gl = { postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).glPostingService = gl;
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([st]) }) }) });
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      return { gl, inserted };
    };

    it('refuses a posting date before the batch matured, and posts nothing', async () => {
      const { gl, inserted } = prime(state());
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-01-10' }, 'tenant-123')).rejects.toThrow(/matured on 2026-01-15/);
      expect(gl.postBatchCostEntry).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('allows the last month of the useful life and refuses the month after it', async () => {
      const ok = prime(state({ productive_life_months: 3 }));
      await service.amortizeBioAsset('batch-1', { posting_date: '2026-03-31' }, 'tenant-123'); // months 0,1,2 are the three runs
      expect(ok.gl.postBatchCostEntry).toHaveBeenCalledTimes(1);

      mockDbSelect.mockReset();
      const late = prime(state({ productive_life_months: 3 }));
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-04-30' }, 'tenant-123')).rejects.toThrow(/useful life of 3 months/);
      expect(late.gl.postBatchCostEntry).not.toHaveBeenCalled();
    });

    it('never takes the herd below its residual: the journal, the ledger row and the carrying value share the capped charge', async () => {
      // 10 head x 90 residual = 900; carrying 1000 leaves 100 of room, the schedule would charge 1875.
      const { gl, inserted } = prime(state({ nca_book_value: '1000.0000', residual_value_per_unit: '90.000000' }));
      await service.amortizeBioAsset('batch-1', { posting_date: '2026-02-15' }, 'tenant-123');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_AMORTIZATION', amount: 100 }));
      const set = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(Number(set.nca_book_value)).toBe(900);
      expect(Number(inserted[0].cost_amount)).toBe(-100);
    });

    it('reads a negative residual as none, so it cannot lift the cap above the carrying value', async () => {
      const { gl, inserted } = prime(state({ nca_book_value: '1000.0000', residual_value_per_unit: '-12.000000' }));
      await service.amortizeBioAsset('batch-1', { posting_date: '2026-02-15' }, 'tenant-123');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ amount: 1000 }));
      expect(Number(inserted[0].cost_amount)).toBe(-1000);
    });

    it('refuses when the carrying value is already at the residual', async () => {
      const { gl, inserted } = prime(state({ nca_book_value: '900.0000', residual_value_per_unit: '90.000000' }));
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-02-15' }, 'tenant-123')).rejects.toThrow(/already at the residual/);
      expect(gl.postBatchCostEntry).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });

    it('stops at a closed reporting period before anything is posted', async () => {
      const { gl, inserted } = prime(state());
      (service as any).assertBioPeriodOpen.mockRejectedValueOnce(new BadRequestException('Reporting period 2026-02 is closed.'));
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-02-15' }, 'tenant-123')).rejects.toThrow(/closed/);
      expect(gl.postBatchCostEntry).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
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

  describe('a herd costed animal by animal is not also amortised or revalued as a batch (Phase 4)', () => {
    const registered = { ...activeBatch, batch_no: 'BATCH-000001', costing_method: 'BIO_ASSET', animal_tracking: 'REGISTERED', input_lines: [] };
    const countOf = (n: string) => mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ n }]) }) });

    it('refuses to amortise it when any of its animals has a costing profile, and writes nothing', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(registered as any);
      countOf('3');
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-10-20' }, 'tenant-123')).rejects.toThrow(/costed one by one by their costing profiles/);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses a batch fair-value change the same way', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(registered as any);
      countOf('1');
      await expect(service.recordFairValue('batch-1', { posting_date: '2026-10-20', fair_value_per_unit: 100 }, 'tenant-123')).rejects.toThrow(/Bio-Asset Costing Runs/);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('lets a registered herd with no profiled animal carry on down the batch path', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(registered as any);
      countOf('0');
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }); // no bio state: the next step's own refusal
      await expect(service.amortizeBioAsset('batch-1', { posting_date: '2026-10-20' }, 'tenant-123')).rejects.toThrow(/Bio-asset state not found/);
    });
  });

  describe('recordFairValue — stage account and rate (bio-asset costing Phase 1, X3)', () => {
    const bioBatch = { ...activeBatch, batch_no: 'BATCH-000001', costing_method: 'BIO_ASSET', input_lines: [{ item_id: 'item-piglet' }] };
    const prime = (st: Record<string, unknown>, amortizationRuns?: number) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);
      const gl = { postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).glPostingService = gl;
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([st]) }) }) });
      if (amortizationRuns !== undefined) {
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ runs: String(amortizationRuns) }]) }) });
      }
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      return { gl, inserted };
    };

    it('posts a pre-mature herd\'s revaluation to the pre-mature account type, not the mature one', async () => {
      const { gl } = prime({ state_id: 's', batch_id: 'batch-1', stage: 'PREMATURE', current_quantity: '10.0000', nca_book_value: '1000.0000' });
      await service.recordFairValue('batch-1', { fair_value_per_unit: 150, posting_date: '2026-03-01' }, 'tenant-123');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_FAIR_VALUE_PREMATURE', amount: 500 }));
    });

    it('re-spreads a mature herd\'s charge over the runs that remain, from the new carrying value', async () => {
      // 10 head, carrying 40 000 -> fair value 3 500 each = 35 000. Residual 500 x 10 = 5 000. 36-month life, 6 runs done.
      const { gl } = prime({
        state_id: 's', batch_id: 'batch-1', stage: 'MATURE', current_quantity: '10.0000', nca_book_value: '40000.0000',
        monthly_amortization_rate: '187.500000', residual_value_per_unit: '500.000000', productive_life_months: 36,
      }, 6);
      await service.recordFairValue('batch-1', { fair_value_per_unit: 3500, posting_date: '2026-03-01' }, 'tenant-123');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_FAIR_VALUE', amount: 5000, reverseDirection: true }));
      const set = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(Number(set.nca_book_value)).toBe(35000);
      expect(set.monthly_amortization_rate).toBe('100.000000'); // (35 000 - 5 000) / 30 runs / 10 head
    });

    it('refuses a negative fair value, so the carrying value never needs flooring', async () => {
      const { gl } = prime({ state_id: 's', batch_id: 'batch-1', stage: 'MATURE', current_quantity: '10.0000', nca_book_value: '1000.0000' });
      await expect(service.recordFairValue('batch-1', { fair_value_per_unit: -1, posting_date: '2026-03-01' }, 'tenant-123')).rejects.toThrow(/negative/);
      expect(gl.postBatchCostEntry).not.toHaveBeenCalled();
    });
  });

  describe('ensureBioState — a mature herd is opened at its ledger value, never at a made-up one (X1)', () => {
    const matureGroup = { ...activeBatch, batch_no: 'BATCH-000009', current_stage_code: 'GESTATION', closing_quantity: '8', opening_quantity: '8' };
    const noState = () => mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) });
    const ledgerTotal = (total: string) => mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ total }]) }) });

    it('refuses to open a mature herd that has nothing on the bio-asset ledger, and creates no state row', async () => {
      noState();
      ledgerTotal('0');
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      await expect((service as any).ensureBioState(matureGroup, 'batch-9')).rejects.toThrow(/no carrying value/);
      expect(inserted).toEqual([]);
    });

    it('opens it at the ledger total, not heads x 28 000', async () => {
      noState();
      ledgerTotal('25000.5');
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nca_book_value: '25000.5000' }]) }) }) });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      await (service as any).ensureBioState(matureGroup, 'batch-9');
      expect(inserted[0]).toMatchObject({ stage: 'MATURE', nca_book_value: '25000.5000' });
      expect(inserted[0].nca_book_value).not.toBe('224000');
    });

    it('still opens a pre-mature herd at nil without asking the ledger', async () => {
      noState();
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ nca_book_value: '0.0000' }]) }) }) });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });
      await (service as any).ensureBioState({ ...matureGroup, current_stage_code: 'FLUSH' }, 'batch-9');
      expect(inserted[0]).toMatchObject({ stage: 'PREMATURE', nca_book_value: '0.0000' });
    });
  });

  describe('postConsumptionGroup — a pre-mature bio-asset issue is capitalised onto each animal\'s own ledger (Phase 2)', () => {
    const bioBatch = { ...activeBatch, batch_no: 'BATCH-000002', costing_method: 'BIO_ASSET', tracking_mode: 'ANIMAL_WISE', input_lines: [] };

    it('writes one CONSUMPTION row per share, carrying the animal and the issue it belongs to, and the shares add up to the capitalised cost', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);
      jest.spyOn(service as any, 'ensureBioState').mockResolvedValue({ current_quantity: '2', nca_book_value: '10', stage: 'PREMATURE' });
      jest.spyOn(service as any, 'animalsPastCostingStart').mockResolvedValue(new Set());
      jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
      const written: any[] = [];
      (service as any).ledgerService = { writeNegativeEntry: jest.fn((p: any) => { written.push(p); return Promise.resolve({ ledger_id: 'L1', amount: '-6.0000', rate: '0.2' }); }) };
      (service as any).glPostingService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), animalAssetAccountId: jest.fn().mockResolvedValue(undefined), animalAssetAccountIds: jest.fn().mockResolvedValue(new Map()) };
      const inserted: any[] = [];
      const sets: any[] = [];
      mockDbInsert.mockImplementation(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) }));
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));

      await service.postConsumptionGroup('batch-1', {
        item_id: 'feed', uom: 'KG', transaction_date: '2026-10-01',
        shares: [{ animal_id: 'a1', quantity: 10 }, { animal_id: 'a2', quantity: 20 }],
      }, 'tenant-123');

      const rows = inserted.filter((v) => v.document_type === 'BATCH' && v.entry_type === 'OVERHEAD');
      expect(rows.map((r) => [r.animal_id, r.cost_amount, r.quantity])).toEqual([['a1', '2', '10'], ['a2', '4', '20']]);
      expect(new Set(rows.map((r) => r.document_line_id))).toEqual(new Set([written[0].documentLineId]));
      expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ nca_book_value: '16' }); // 10 + 6, once
      expect((module.get(AnimalBookValueService) as any).refreshCache).toHaveBeenCalledWith(['a1', 'a2']);
    });

    it('writes nothing to the ledger for a mature herd, whose feed is expensed, not capitalised', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);
      jest.spyOn(service as any, 'ensureBioState').mockResolvedValue({ current_quantity: '2', nca_book_value: '10', stage: 'MATURE' });
      jest.spyOn(service as any, 'animalsPastCostingStart').mockResolvedValue(new Set());
      jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
      (service as any).ledgerService = { writeNegativeEntry: jest.fn().mockResolvedValue({ ledger_id: 'L1', amount: '-6.0000', rate: '0.2' }) };
      (service as any).glPostingService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), animalAssetAccountId: jest.fn().mockResolvedValue(undefined), animalAssetAccountIds: jest.fn().mockResolvedValue(new Map()) };
      const inserted: any[] = [];
      mockDbInsert.mockImplementation(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) }));
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue({}) })) }));
      await service.postConsumptionGroup('batch-1', { item_id: 'feed', uom: 'KG', transaction_date: '2026-10-01', shares: [{ animal_id: 'a1', quantity: 10 }] }, 'tenant-123');
      expect(inserted.filter((v) => v.document_type === 'BATCH' && v.entry_type === 'OVERHEAD')).toEqual([]);
    });

    describe('per animal: capitalised until her costing start date, expensed after (Phase 2)', () => {
      const setup = (pastStart: string[]) => {
        jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);
        jest.spyOn(service as any, 'ensureBioState').mockResolvedValue({ current_quantity: '2', nca_book_value: '10', stage: 'PREMATURE' });
        jest.spyOn(service as any, 'animalsPastCostingStart').mockResolvedValue(new Set(pastStart));
        jest.spyOn(service as any, 'evaluateKpi').mockResolvedValue(undefined);
        const written: any[] = [];
        (service as any).ledgerService = {
          writeNegativeEntry: jest.fn((p: any) => {
            written.push(p);
            return Promise.resolve({ ledger_id: `L${written.length}`, amount: `-${(p.quantity * 0.2).toFixed(4)}`, rate: '0.2' });
          }),
        };
        (service as any).glPostingService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), animalAssetAccountId: jest.fn().mockResolvedValue(undefined), animalAssetAccountIds: jest.fn().mockResolvedValue(new Map()) };
        const inserted: any[] = [];
        const sets: any[] = [];
        mockDbInsert.mockImplementation(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) }));
        mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));
        return { written, inserted, sets };
      };
      const group = (shares: Array<{ animal_id: string; quantity: number }>, extra: object = {}) =>
        service.postConsumptionGroup('batch-1', { item_id: 'feed', uom: 'KG', transaction_date: '2026-10-01', shares, ...extra }, 'tenant-123');

      it('an animal past her start is issued as an expense entry and writes nothing to the bio-asset ledger', async () => {
        const { written, inserted, sets } = setup(['a1']);
        await group([{ animal_id: 'a1', quantity: 10 }]);
        expect(written.map((w) => [w.transactionType, w.glMappingType])).toEqual([['CONSUMPTION', 'BIO_CONSUMPTION_MATURE']]);
        expect(inserted.filter((v) => v.document_type === 'BATCH' && v.entry_type === 'OVERHEAD')).toEqual([]);
        expect(sets.find((v) => v.nca_book_value !== undefined)).toBeUndefined();
      });

      it('a group of one animal before and one after her start becomes two entries: only the first is capitalised', async () => {
        const { written, inserted, sets } = setup(['a2']);
        const result = await group([{ animal_id: 'a1', quantity: 10 }, { animal_id: 'a2', quantity: 20 }]);
        expect(written.map((w) => [w.transactionType, w.glMappingType, w.quantity])).toEqual([['CONSUMPTION', 'BIO_CONSUMPTION_PREMATURE', 10], ['CONSUMPTION', 'BIO_CONSUMPTION_MATURE', 20]]);
        const rows = inserted.filter((v) => v.document_type === 'BATCH' && v.entry_type === 'OVERHEAD');
        expect(rows.map((r) => [r.animal_id, r.cost_amount])).toEqual([['a1', '2']]);
        expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ nca_book_value: '12' }); // 10 + 2, not + 6
        expect(result.transactions.map((t) => [t.animal_id, t.quantity])).toEqual([['a1', 10], ['a2', 20]]);
        expect((module.get(AnimalBookValueService) as any).refreshCache).toHaveBeenCalledWith(['a1']);
      });

      it('splits the lots between the two entries in the order given', async () => {
        const { written } = setup(['a2']);
        await group([{ animal_id: 'a1', quantity: 10 }, { animal_id: 'a2', quantity: 20 }], { lots: [{ lotNo: 'L-1', quantity: 15 }, { lotNo: 'L-2', quantity: 15 }] });
        expect(written[0].lots).toEqual([{ lotNo: 'L-1', quantity: 10 }]);
        expect(written[1].lots).toEqual([{ lotNo: 'L-1', quantity: 5 }, { lotNo: 'L-2', quantity: 15 }]);
      });
    });
  });

  describe('releaseHeadToAnimals (gilt selection, Phase 5)', () => {
    const lot = { ...activeBatch, batch_no: 'BATCH-000008', costing_method: 'BIO_ASSET', tracking_mode: 'BATCH_WISE', closing_quantity: '10', opening_quantity: '10', input_lines: [{ item_id: 'piglet' }] };
    const setup = (state: { current_quantity: string; nca_book_value: string }, batch: object = lot) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(batch as any);
      jest.spyOn(service as any, 'ensureBioState').mockResolvedValue({ stage: 'PREMATURE', ...state });
      jest.spyOn(service as any, 'applyMortalityEffects').mockResolvedValue(undefined);
      mockDbSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ orderBy: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'piglet', lot_no: 'LOT-1' }]) }) }) }) });
      const inserted: any[] = [];
      const sets: any[] = [];
      mockDbInsert.mockImplementation(() => ({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) }));
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) }));
      return { inserted, sets };
    };
    const release = (quantity: number) => service.releaseHeadToAnimals('b-8', { quantity, date: '2026-10-20', reference: 'GS-2026-00001' }, 'tenant-123');

    it('takes the average value of the head it releases, and one ledger row records the head and the value leaving', async () => {
      const { inserted, sets } = setup({ current_quantity: '10', nca_book_value: '18.334' });
      const r = await release(4);
      expect(r).toEqual({ per_head: 1.8334, total: 7.3336, remaining: 6 });
      expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ current_quantity: '6', nca_book_value: '11.0004' });
      expect(inserted[0]).toMatchObject({ entry_type: 'TRANSFER', transaction_type: 'TRANSFER_SHIPMENT', document_type: 'GILT_SELECTION', document_no: 'GS-2026-00001', quantity: '-4', cost_amount: '-7.3336', batch_id: 'b-8', lot_no: 'LOT-1' });
      expect(sets.find((v) => v.status === 'CLOSED')).toBeUndefined();
    });

    it('releases at a given value per head (a litter\'s own cost) and the batch loses just that, not its average', async () => {
      const { inserted, sets } = setup({ current_quantity: '98', nca_book_value: '6189.47' });
      const r = await service.releaseHeadToAnimals('b-8', { quantity: 3, date: '2026-10-20', reference: 'GS-2026-00001', value_per_head: 1.8334 }, 'tenant-123');
      expect(r).toEqual({ per_head: 1.8334, total: 5.5002, remaining: 95 });
      expect(sets.find((v) => v.nca_book_value !== undefined)).toMatchObject({ current_quantity: '95', nca_book_value: '6183.9698' });
      expect(inserted[0]).toMatchObject({ cost_amount: '-5.5002', cost_amount_each_unit: '1.8334' });
    });

    it('lets the last head take whatever is left and closes the emptied batch', async () => {
      const { sets } = setup({ current_quantity: '3', nca_book_value: '10' });
      const r = await release(3);
      expect(r).toMatchObject({ total: 10, remaining: 0 });
      expect(sets.find((v) => v.status === 'CLOSED')).toBeDefined();
    });

    it('refuses more head than the batch holds, and a batch of registered animals', async () => {
      setup({ current_quantity: '3', nca_book_value: '10' });
      await expect(release(4)).rejects.toThrow('holds 3 head; 4 cannot be selected');
      setup({ current_quantity: '3', nca_book_value: '10' }, { ...lot, tracking_mode: 'ANIMAL_WISE' });
      await expect(release(1)).rejects.toThrow('already holds registered animals');
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
          transactionType: 'OUTPUT',
          glMappingType: 'BIO_HARVEST',
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

  describe('a pre-mature herd\'s exits leave the pre-mature asset account', () => {
    const prime = (stage: string) => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...activeBatch, batch_no: 'BATCH-000001', costing_method: 'BIO_ASSET', tracking_mode: 'BATCH_WISE', stage_id: 'stage-weaner', input_lines: [{ item_id: 'item-piglet' }] } as any);
      const gl = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), postBatchCostEntry: jest.fn().mockResolvedValue({}), mappedAccount: jest.fn().mockResolvedValue('acct-1050') };
      (service as any).glPostingService = gl;
      (service as any).ledgerService = { writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'l-1' }) };
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ state_id: 's-1', batch_id: 'batch-1', stage, current_quantity: '10.0000', nca_book_value: '40000.0000' }]) }) }) });
      mockDbUpdate.mockImplementation(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue({}) })) }));
      mockDbInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));
      return gl;
    };

    it('credits the pre-mature account for a sale\'s proceeds and takes the gain or loss against it', async () => {
      const gl = prime('PREMATURE');
      await service.disposeBioAsset('batch-1', { disposal_type: 'SOLD', quantity: 4, posting_date: '2026-10-01', sale_proceeds: 5000 } as any, 'tenant-123');
      expect(gl.mappedAccount).toHaveBeenCalledWith('tenant-123', expect.anything(), 'BIO_MORTALITY_PREMATURE', 'credit', expect.anything());
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_SALE_PROCEEDS', creditAccountId: 'acct-1050' }));
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_DISPOSAL_SOLD', debitAccountId: 'acct-1050' }));
    });

    it('leaves a mature herd to the mapping\'s mature account', async () => {
      const gl = prime('MATURE');
      await service.disposeBioAsset('batch-1', { disposal_type: 'SOLD', quantity: 4, posting_date: '2026-10-01', sale_proceeds: 5000 } as any, 'tenant-123');
      expect(gl.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({ transactionType: 'BIO_SALE_PROCEEDS', creditAccountId: undefined }));
    });
  });

  describe('disposeBioAsset — a part of the herd', () => {
    it('lowers the batch closing quantity and the stage scheduler count with the bio-asset head', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...activeBatch,
        batch_no: 'BATCH-000001',
        costing_method: 'BIO_ASSET',
        tracking_mode: 'BATCH_WISE',
        stage_id: 'stage-weaner',
        input_lines: [{ item_id: 'item-piglet' }],
      } as any);
      (service as any).ledgerService = { writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'l-1' }) };
      (service as any).glPostingService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }), mappedAccount: jest.fn().mockResolvedValue('acct-1050') };
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              { state_id: 'state-1', batch_id: 'batch-1', stage: 'PREMATURE', current_quantity: '10.0000', nca_book_value: '40000.0000' },
            ]),
          }),
        }),
      });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.disposeBioAsset(
        'batch-1',
        { disposal_type: 'HARVEST', quantity: 4, posting_date: '2026-04-01', output_item_id: 'item-dressed-pork', output_uom: 'KG', output_quantity: 300, warehouse_id: 'wh-1' },
        'tenant-123',
        { userId: 'user-1' },
      );

      const sets = mockDbUpdate.mock.results.flatMap((r) => (r.value.set as jest.Mock).mock.calls.map((c) => c[0]));
      // 10 head less 4 harvested: the header and the scheduler both say 6, and the batch stays open.
      expect(sets.find((c) => c.closing_quantity === '6')).toBeDefined();
      expect(sets.find((c) => c.animal_count === '6')).toBeDefined();
      expect(sets.find((c) => c.status === 'CLOSED')).toBeUndefined();
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

    it('animal-wise: a stage that has animals but no scheduler is not owed an entry, so it cannot pin the pending date (sows moved to Farrowing before its scheduler existed)', async () => {
      const rows = (r: unknown[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(r) }) });
      mockDbSelect
        .mockReturnValueOnce(rows([{ entry_date: '2026-01-14', stage_id: 'q', status: 'LOCKED' }])) // locks: only Quarantine was locked on the 14th
        .mockReturnValueOnce(rows([{ animal_id: 'boar', current_stage_id: 'q' }, { animal_id: 'sow', current_stage_id: 'f' }])) // live animals
        .mockReturnValueOnce(rows([{ stage_id: 'q' }, { stage_id: 'i' }])) // schedulers of the batch: Quarantine and Insemination, none for Farrowing
        .mockReturnValueOnce(rows([{ stage_id: 'q', stage_code: 'QUARANTINE' }, { stage_id: 'f', stage_code: 'FARROWING' }, { stage_id: 'i', stage_code: 'INSEMINATION' }]));

      const nextDate = await service.getNextPendingDate({ batch_id: 'batch-1', start_date: '2026-01-14', tracking_mode: 'ANIMAL_WISE' });

      expect(nextDate).toBe('2026-01-15');
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


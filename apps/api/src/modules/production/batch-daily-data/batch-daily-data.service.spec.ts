import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';

describe('BatchDailyDataService', () => {
  let service: BatchDailyDataService;
  let batchService: BatchService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();

  const mockDb = { select: mockDbSelect, insert: mockDbInsert };

  const header = {
    scheduler_id: 'sched-1',
    batch_id: 'batch-1',
    company_id: 'comp-1',
    lob_id: 'lob-1',
    // The batch's shed. Every CONSUMPTION entry now resolves its source
    // warehouse from this — the shed's silo, or the farm store behind it.
    location_id: 'shed-1',
  };

  /** One `.from().where().limit()` answer, in the order postEntry asks for them. */
  const answers = (...results: unknown[][]) => {
    for (const result of results) {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(result),
          }),
        }),
      });
    }
  };

  /** findForDate's trailing read — no .limit(), so it resolves off .where(). */
  const answerFindForDate = () => {
    mockDbSelect.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    });
  };

  const consumptionLine = {
    line_id: 'line-1',
    scheduler_id: 'sched-1',
    is_active: true,
    line_type: 'CONSUMPTION',
    item_id: 'item-feed',
    lot_required: false,
    activity_name: 'Morning Feed',
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbInsert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}),
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchDailyDataService,
        {
          provide: ClsService,
          useValue: { get: jest.fn().mockReturnValue(mockDb) },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: BatchService,
          useValue: {
            addTransaction: jest.fn(),
            findOne: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: BatchTransferService, useValue: { create: jest.fn() } },
        { provide: GlPostingService, useValue: {} },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
      ],
    }).compile();

    service = module.get<BatchDailyDataService>(BatchDailyDataService);
    batchService = module.get<BatchService>(BatchService);
  });

  it('rejects an entry against a deactivated line', async () => {
    mockDbSelect.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest
            .fn()
            .mockResolvedValue([{ line_id: 'line-1', is_active: false }]),
        }),
      }),
    });

    await expect(
      service.postEntry(
        'batch-1',
        {
          line_id: 'line-1',
          entry_date: '2026-09-08',
          entered_value: 2,
        } as any,
        'tenant-123',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it("delegates a CONSUMPTION entry to BatchService.addTransaction with the item's stock UOM", async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                line_id: 'line-1',
                scheduler_id: 'sched-1',
                is_active: true,
                line_type: 'CONSUMPTION',
                item_id: 'item-feed',
                lot_required: false,
                parameter_name: 'Morning Feed',
              },
            ]),
          }),
        }),
      }) // line lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([header]),
          }),
        }),
      }) // header lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ tracking_mode: 'BATCH_WISE' }]),
          }),
        }),
      }) // batch tracking_mode lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      }) // idempotency check — no existing row
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ item_id: 'item-feed', uom_primary: 'KG' }]),
          }),
        }),
      }) // item lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                location_id: 'shed-1',
                location_type: 'SHED',
                parent_location_id: 'farm-1',
                farm_id: 'farm-1',
                feed_silo_id: 'silo-1',
              },
            ]),
          }),
        }),
      }) // feed source — the shed and the silo attached to it
      .mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // findForDate at the end

    (batchService.addTransaction as jest.Mock).mockResolvedValue({
      transactions: [
        {
          transaction_id: 'tx-1',
          transaction_date: '2026-09-08',
          item_id: 'item-feed',
          transaction_type: 'CONSUMPTION',
        },
      ],
    });

    await service.postEntry(
      'batch-1',
      {
        line_id: 'line-1',
        entry_date: '2026-09-08',
        entered_value: 22.5,
      } as any,
      'tenant-123',
      { userId: 'user-1' },
    );

    expect(batchService.addTransaction).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({
        transaction_type: 'CONSUMPTION',
        item_id: 'item-feed',
        quantity: 22.5,
        uom: 'KG',
      }),
      'tenant-123',
      { userId: 'user-1' },
    );
  });

  // Regression test for the inventory-ledger duplication bug: the frontend's
  // "Post Entry" flow saves a draft and then posts in the same click, so any
  // line the user already saved is resubmitted with the exact same value —
  // without this guard each resubmission dispatched a brand new
  // addTransaction()/ledger entry even though batch_daily_data itself only
  // ever showed one row for that (line_id, entry_date).
  it('skips addTransaction on an identical resubmission of an already-posted line', async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                line_id: 'line-1',
                scheduler_id: 'sched-1',
                is_active: true,
                line_type: 'CONSUMPTION',
                item_id: 'item-feed',
                lot_required: false,
                parameter_name: 'Morning Feed',
              },
            ]),
          }),
        }),
      }) // line lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([header]),
          }),
        }),
      }) // header lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ tracking_mode: 'BATCH_WISE' }]),
          }),
        }),
      }) // batch tracking_mode lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                entry_id: 'entry-1',
                entered_value: '22.5000',
                entered_text: null,
                lot_no: null,
                posted: true,
              },
            ]),
          }),
        }),
      }) // idempotency check — already posted with the same value
      .mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // findForDate — the early-return path still reports the existing row

    await service.postEntry(
      'batch-1',
      {
        line_id: 'line-1',
        entry_date: '2026-09-08',
        entered_value: 22.5,
      } as any,
      'tenant-123',
      { userId: 'user-1' },
    );

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // "Save Draft" on the data-entry screen sends `draft: true` — the value
  // must land on batch_daily_data (posted: false) without touching the
  // ledger/GL at all. Only re-submitting later without `draft` (done by
  // BatchService.postBatchDay() for every still-draft row) dispatches it.
  it('records a draft entry without touching inventory/GL, and marks it not posted', async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                line_id: 'line-1',
                scheduler_id: 'sched-1',
                is_active: true,
                line_type: 'CONSUMPTION',
                item_id: 'item-feed',
                lot_required: false,
                parameter_name: 'Morning Feed',
              },
            ]),
          }),
        }),
      }) // line lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([header]),
          }),
        }),
      }) // header lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ tracking_mode: 'BATCH_WISE' }]),
          }),
        }),
      }) // batch tracking_mode lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      }) // idempotency check — no existing row
      .mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // findForDate at the end

    const insertedValues: any[] = [];
    mockDbInsert.mockReturnValue({
      values: jest.fn((v: any) => {
        insertedValues.push(v);
        return { onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) };
      }),
    });

    await service.postEntry(
      'batch-1',
      {
        line_id: 'line-1',
        entry_date: '2026-09-08',
        entered_value: 40,
        draft: true,
      } as any,
      'tenant-123',
      { userId: 'user-1' },
    );

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    expect(insertedValues[0]).toMatchObject({
      posted: false,
      entered_value: '40',
    });
  });

  it('flags a DESCRIPTIVE entry that breaches its alert limit without posting a transaction', async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                line_id: 'line-mort',
                scheduler_id: 'sched-1',
                is_active: true,
                line_type: 'DESCRIPTIVE',
                item_id: null,
                lot_required: false,
                parameter_name: 'Daily Mortality',
                lower_alert_limit: null,
                upper_alert_limit: '1',
                alert_severity: 'CRITICAL',
                std_value: null,
              },
            ]),
          }),
        }),
      }) // line lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([header]),
          }),
        }),
      }) // header lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ tracking_mode: 'BATCH_WISE' }]),
          }),
        }),
      }) // batch tracking_mode lookup
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      }) // idempotency check — no existing row
      .mockReturnValueOnce({
        from: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
      }); // findForDate at the end

    await service.postEntry(
      'batch-1',
      {
        line_id: 'line-mort',
        entry_date: '2026-09-08',
        entered_value: 3,
      } as any,
      'tenant-123',
    );

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    // First insert call is the notification_alert_log write; second is batch_daily_data.
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });

  describe('ANIMAL_WISE batches', () => {
    const stageHeader = {
      ...header,
      stage_id: 'stage-flush',
      animal_count: '3',
    };

    it('rejects an entry with no animal_id against an ANIMAL_WISE batch', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  line_id: 'line-1',
                  scheduler_id: 'sched-1',
                  is_active: true,
                  line_type: 'CONSUMPTION',
                  item_id: 'item-feed',
                  lot_required: false,
                },
              ]),
            }),
          }),
        }) // line lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([stageHeader]),
            }),
          }),
        }) // header lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ tracking_mode: 'ANIMAL_WISE' }]),
            }),
          }),
        }); // batch tracking_mode lookup

      await expect(
        service.postEntry(
          'batch-1',
          {
            line_id: 'line-1',
            entry_date: '2026-09-08',
            entered_value: 2,
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an animal_id that is at a different stage than this line', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  line_id: 'line-1',
                  scheduler_id: 'sched-1',
                  is_active: true,
                  line_type: 'CONSUMPTION',
                  item_id: 'item-feed',
                  lot_required: false,
                },
              ]),
            }),
          }),
        }) // line lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([stageHeader]),
            }),
          }),
        }) // header lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ tracking_mode: 'ANIMAL_WISE' }]),
            }),
          }),
        }) // batch tracking_mode lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  animal_id: 'a-1',
                  animal_code: 'PIG-0001',
                  current_batch_id: 'batch-1',
                  current_stage_id: 'stage-gestation',
                },
              ]),
            }),
          }),
        }); // animal lookup — wrong stage

      await expect(
        service.postEntry(
          'batch-1',
          {
            line_id: 'line-1',
            entry_date: '2026-09-08',
            entered_value: 2,
            animal_id: 'a-1',
          } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the exact named animal dead for a MORTALITY_COUNT entry, without touching other animals at the stage', async () => {
      const mortLine = {
        line_id: 'line-mort',
        scheduler_id: 'sched-1',
        is_active: true,
        line_type: 'DESCRIPTIVE',
        item_id: null,
        lot_required: false,
        kpi_metric: 'MORTALITY_COUNT',
        lower_alert_limit: null,
        upper_alert_limit: null,
      };
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mortLine]),
            }),
          }),
        }) // line lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([stageHeader]),
            }),
          }),
        }) // header lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ tracking_mode: 'ANIMAL_WISE' }]),
            }),
          }),
        }) // batch tracking_mode lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  animal_id: 'a-1',
                  animal_code: 'PIG-0001',
                  current_batch_id: 'batch-1',
                  current_stage_id: 'stage-flush',
                },
              ]),
            }),
          }),
        }) // animal lookup — correct stage
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // stage/date lock check — none
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // idempotency check — no existing row
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // previous same-day entry (none)
        .mockReturnValueOnce({
          from: jest
            .fn()
            .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // findForDate at the end

      const updateSets: any[] = [];
      const mockDbUpdate = jest.fn().mockReturnValue({
        set: jest.fn((v: any) => {
          updateSets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      });
      (mockDb as any).update = mockDbUpdate;

      await service.postEntry(
        'batch-1',
        {
          line_id: 'line-mort',
          entry_date: '2026-09-08',
          entered_value: 1,
          animal_id: 'a-1',
        } as any,
        'tenant-123',
      );

      expect(mockDbUpdate).toHaveBeenCalledWith(expect.anything());
      const animalUpdate = updateSets.find((v) => v.status === 'DEAD');
      expect(animalUpdate).toBeDefined();
      delete (mockDb as any).update;
    });
  });

  /**
   * Client rule of 2026-09-24: feed flows farm STORE -> (stock transfer) ->
   * SILO -> (daily entry) -> shed. Until now the CONSUMPTION leg wrote its
   * ledger row with no warehouse_id at all, so applyFifo drew the feed from
   * whichever layer in the company happened to be oldest — the silo standing
   * next to the shed was not consulted. The entry now names the source.
   */
  describe('a feed entry draws from the shed’s silo', () => {
    const postFeed = () =>
      service.postEntry(
        'batch-1',
        { line_id: 'line-1', entry_date: '2026-09-08', entered_value: 22.5 } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

    beforeEach(() => {
      (batchService.addTransaction as jest.Mock).mockResolvedValue({
        transactions: [
          {
            transaction_id: 'tx-1',
            transaction_date: '2026-09-08',
            item_id: 'item-feed',
            transaction_type: 'CONSUMPTION',
          },
        ],
      });
    });

    it('passes the silo attached to the shed as the source warehouse', async () => {
      answers(
        [consumptionLine],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [{ location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm-1', farm_id: 'farm-1', feed_silo_id: 'silo-1' }],
      );
      answerFindForDate();

      await postFeed();

      expect(batchService.addTransaction).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'silo-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    // Data entry happens at PEN level on some farms; the silo is attached to
    // the shed above it, never to the individual pen.
    it('walks a PEN up to its shed to find the silo', async () => {
      answers(
        [consumptionLine],
        [{ ...header, location_id: 'pen-3' }],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [{ location_id: 'pen-3', location_type: 'PEN', parent_location_id: 'shed-1', farm_id: 'farm-1', feed_silo_id: null }],
        [{ location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm-1', farm_id: 'farm-1', feed_silo_id: 'silo-1' }],
      );
      answerFindForDate();

      await postFeed();

      expect(batchService.addTransaction).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'silo-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it("falls back to the farm's store when the shed has no silo attached", async () => {
      answers(
        [consumptionLine],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [{ location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm-1', farm_id: 'farm-1', feed_silo_id: null }],
        [{ location_id: 'store-1' }],
      );
      answerFindForDate();

      await postFeed();

      expect(batchService.addTransaction).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'store-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it('refuses the entry when neither a silo nor a store can be found', async () => {
      answers(
        [consumptionLine],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [{ location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm-1', farm_id: 'farm-1', feed_silo_id: null }],
        [],
      );

      await expect(postFeed()).rejects.toThrow(BadRequestException);
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    it('refuses the entry when the stage has no location at all', async () => {
      answers(
        [consumptionLine],
        [{ ...header, location_id: null }],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
      );

      await expect(postFeed()).rejects.toThrow(BadRequestException);
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    // OUTPUT lines put stock IN and carry no FIFO draw, so they resolve
    // nothing and keep behaving exactly as before.
    it('resolves no warehouse for an OUTPUT line', async () => {
      answers(
        [{ ...consumptionLine, line_type: 'OUTPUT' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
      );
      answerFindForDate();

      await postFeed();

      expect(batchService.addTransaction).toHaveBeenCalledWith(
        'batch-1',
        expect.not.objectContaining({ source_warehouse_id: expect.anything() }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });
  });
});

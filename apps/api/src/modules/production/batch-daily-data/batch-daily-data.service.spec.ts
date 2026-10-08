import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';

describe('BatchDailyDataService', () => {
  let service: BatchDailyDataService;
  let batchService: BatchService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();

  const mockDb: any = { select: mockDbSelect, insert: mockDbInsert, transaction: async (work: (tx: unknown) => unknown) => work(mockDb) };

  const header = {
    scheduler_id: 'sched-1',
    batch_id: 'batch-1',
    company_id: 'comp-1',
    lob_id: 'lob-1',
    // The batch's shed. Every CONSUMPTION entry now resolves its source
    // warehouse from this — the shed's silo, or the farm store behind it.
    location_id: 'shed-1',
  };

  /** One `.from().where()[.orderBy()].limit()` answer, in the order postEntry asks for them. */
  const answers = (...results: unknown[][]) => {
    for (const result of results) {
      const limit = jest.fn().mockResolvedValue(result);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit,
            orderBy: jest.fn().mockReturnValue({ limit }),
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

  /** silo_shed_link lookup (joined to the silo row) — no .limit() either, a
   * shed can have several rows. Returns the where() mock so a test can read
   * the condition it was handed. */
  const answerSiloLinks = (siloIds: string[]) => {
    const where = jest.fn().mockResolvedValue(siloIds.map((silo_id) => ({ silo_id })));
    mockDbSelect.mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({ where }),
      }),
    });
    return where;
  };


  /**
   * The check, before a consumption posts, for a silo that holds less than the entry needs
   * (splitSiloShortfall): it reads the source's type, and for a silo its stock. A store ends it at once.
   * `heldKg` is what the silo holds — enough to cover the entry unless a test says otherwise.
   */
  const answerSplitCheck = (sourceType: 'SILO' | 'STORE', heldKg = 1000) => {
    const limit = jest.fn().mockResolvedValue([{ type: sourceType, code: sourceType === 'SILO' ? 'SILO-1' : 'STORE-1' }]);
    mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit }) }) });
    if (sourceType === 'SILO') {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ total: String(heldKg) }]) }),
      });
    }
  };

  const siloFeedService = { currentItems: jest.fn() };
  const feedAlerts = { evaluateLevelsSafely: jest.fn() };

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
    siloFeedService.currentItems.mockReset();
    feedAlerts.evaluateLevelsSafely.mockReset().mockResolvedValue(undefined);
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
          useValue: { get: jest.fn().mockReturnValue(mockDb), run: (work: () => unknown) => work(), set: jest.fn() },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: BatchService,
          useValue: {
            addTransaction: jest.fn(),
            postConsumptionGroup: jest.fn(),
            findOne: jest.fn().mockResolvedValue({}),
          },
        },
        { provide: BatchTransferService, useValue: { create: jest.fn() } },
        { provide: GlPostingService, useValue: {} },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
        { provide: SiloFeedService, useValue: siloFeedService },
        { provide: FeedAlertService, useValue: feedAlerts },
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

  // Ruling M6: a lone entry re-checks its farm's silo levels itself; a day
  // post (BatchService.postBatchDay/postStageDay) defers it and checks once.
  it.each([
    ['re-checks the farm\'s silo levels afterwards', {}, [[['farm-1'], 'tenant-123']]],
    ['leaves the silo re-check to the day post when deferred', { deferFeedAlerts: true }, []],
  ])("issues a CONSUMPTION entry through BatchService.postConsumptionGroup with the item's stock UOM, and %s", async (_label, opts, alertCalls) => {
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
              .mockResolvedValue([{ tracking_mode: 'BATCH_WISE', farm_id: 'farm-1' }]),
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
              },
            ]),
          }),
        }),
      }); // feed source — the batch's shed
    answerSiloLinks(['silo-1']);
    siloFeedService.currentItems.mockResolvedValueOnce(
      new Map([
        [
          'silo-1',
          { item_id: 'item-feed', item_code: 'FEED', item_description: null, on_hand_qty: 200 },
        ],
      ]),
    );
    answerSplitCheck('SILO');
    answerFindForDate();

    (batchService.postConsumptionGroup as jest.Mock).mockResolvedValue({
      ledgerEntry: { ledger_id: 'led-1' },
      transactions: [{ transaction_id: 'tx-1', quantity: 22.5, amount: -100 }],
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
      opts,
    );

    expect(feedAlerts.evaluateLevelsSafely.mock.calls).toEqual(alertCalls);
    expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({
        item_id: 'item-feed',
        uom: 'KG',
        transaction_date: '2026-09-08',
        shares: [{ animal_id: undefined, quantity: 22.5 }],
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
    // First insert call is notification_alert_log, second is batch_daily_data, third is inventory_ledger (DESCRIPTIVE).
    expect(mockDbInsert).toHaveBeenCalledTimes(3);
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
   * SILO -> (daily entry) -> shed. A shed may now draw from several silos
   * (silo_shed_link, Task 1) — the source is whichever attached silo
   * currently holds the item this line posts (D9: a silo holds one item, so
   * at most one attached silo can). Until now the CONSUMPTION leg wrote its
   * ledger row with no warehouse_id at all, so applyFifo drew the feed from
   * whichever layer in the company happened to be oldest.
   */
  describe('lot rules on a consumption', () => {
    const FUTURE = '2099-01-01';
    const PAST = '2020-01-01';
    /**
     * What planLots reads (lotBalances): per-lot sums off the entries, then per-lot sums off the ledger lines —
     * both `.from().where().groupBy()`. `remaining` is the lot's stock; the lines read as empty.
     */
    const lotsAtLocation = (rows: Array<{ lot_no: string; remaining: string; expiry_date: string | null; receipt_date: string }>) => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockResolvedValue(rows.map((r) => ({ lot_no: r.lot_no, quantity: r.remaining, expiry_date: r.expiry_date, receipt_date: r.receipt_date }))),
          }),
        }),
      });
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ groupBy: jest.fn().mockResolvedValue([]) }) }),
      });
    };
    const plan = (itemType: string, lotNo: string, quantity = 4) =>
      (service as any).planLots(
        { lot_no: lotNo, entered_value: quantity },
        { line_type: 'CONSUMPTION', activity_name: 'Morning Feed' },
        itemType, 'item-1', 'wh-1', 'comp-1', 'tenant-123',
      );

    it('refuses an expired lot of a medicine or vaccine', async () => {
      lotsAtLocation([
        { lot_no: 'OLD', remaining: '10', expiry_date: PAST, receipt_date: '2019-06-01' },
        { lot_no: 'NEW', remaining: '10', expiry_date: FUTURE, receipt_date: '2026-01-01' },
      ]);
      await expect(plan('MEDICINE', 'OLD')).rejects.toThrow('OLD (expired 2020-01-01) — expired medicine and vaccine cannot be used');
    });

    it('allows an expired lot of feed and notes it', async () => {
      lotsAtLocation([
        { lot_no: 'OLD', remaining: '10', expiry_date: PAST, receipt_date: '2019-06-01' },
        { lot_no: 'NEW', remaining: '10', expiry_date: FUTURE, receipt_date: '2026-01-01' },
      ]);
      const result = await plan('FEED', 'OLD');
      expect(result.shares).toEqual([{ lot_no: 'OLD', quantity: 4 }]);
      expect(result.notes).toEqual(expect.arrayContaining(['Expired lot used: OLD']));
    });

    it('notes a lot chosen against the suggestion, and nothing when the suggested lot is used', async () => {
      const rows = [
        { lot_no: 'A', remaining: '10', expiry_date: '2098-01-01', receipt_date: '2026-01-01' },
        { lot_no: 'B', remaining: '10', expiry_date: '2099-06-01', receipt_date: '2026-02-01' },
      ];
      lotsAtLocation(rows);
      expect((await plan('FEED', 'B')).notes).toEqual(['Lot override: used B, suggested A']);
      lotsAtLocation(rows);
      expect((await plan('FEED', 'A')).notes).toEqual([]);
    });

    describe('a lot-tracked item posted with no lot named', () => {
      const planTracked = (quantity: number, lotTracked = true) =>
        (service as any).planLots(
          { entered_value: quantity },
          { line_type: 'CONSUMPTION', activity_name: 'Morning Feed' },
          'FEED', 'item-1', 'wh-1', 'comp-1', 'tenant-123', lotTracked,
        );
      const rows = [
        { lot_no: 'FAR', remaining: '10', expiry_date: '2099-06-01', receipt_date: '2026-01-01' },
        { lot_no: 'NEAR', remaining: '6', expiry_date: '2098-01-01', receipt_date: '2026-02-01' },
        { lot_no: 'GONE', remaining: '50', expiry_date: PAST, receipt_date: '2019-01-01' },
      ];

      it('takes the in-date lot with the nearest expiry first, then the next, and says so', async () => {
        lotsAtLocation(rows);
        const result = await planTracked(9);
        expect(result.shares).toEqual([{ lot_no: 'NEAR', quantity: 6 }, { lot_no: 'FAR', quantity: 3 }]);
        expect(result.notes).toEqual(['Lots chosen by nearest expiry: NEAR 6, FAR 3']);
      });

      it('never takes an expired lot on its own choice, even when only it could cover the entry', async () => {
        lotsAtLocation(rows);
        await expect(planTracked(20)).rejects.toThrow('16 in date at this location, 4 short of 20');
      });

      it('does nothing for an item that is not lot tracked — the costing method alone prices it', async () => {
        const result = await planTracked(9, false);
        expect(result).toEqual({ shares: [{ lot_no: undefined, quantity: 9 }], notes: [] });
      });
    });

    it('fills several ticked lots in order and refuses when they cannot cover the entry', async () => {
      const rows = [
        { lot_no: 'A', remaining: '10', expiry_date: '2098-01-01', receipt_date: '2026-01-01' },
        { lot_no: 'B', remaining: '6', expiry_date: '2099-06-01', receipt_date: '2026-02-01' },
      ];
      lotsAtLocation(rows);
      expect((await plan('FEED', 'B, A', 12)).shares).toEqual([{ lot_no: 'A', quantity: 10 }, { lot_no: 'B', quantity: 2 }]);
      lotsAtLocation(rows);
      await expect(plan('FEED', 'A, B', 18)).rejects.toThrow('2 short of 18');
    });
  });

  describe('a feed entry draws from the silo holding the posted item', () => {
    const shed = { location_id: 'shed-1', location_type: 'SHED', parent_location_id: 'farm-1', farm_id: 'farm-1' };

    const postFeed = (itemId = 'item-feed') =>
      service.postEntry(
        'batch-1',
        { line_id: 'line-1', entry_date: '2026-09-08', entered_value: 22.5 } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

    beforeEach(() => {
      (batchService.postConsumptionGroup as jest.Mock).mockResolvedValue({
        ledgerEntry: { ledger_id: 'led-1' },
        transactions: [{ transaction_id: 'tx-1', quantity: 22.5, amount: -100 }],
      });
    });

    // Shed with two silos: S1 holds R1, S2 holds R2 — each posting must draw
    // from the one silo actually carrying the item being posted, not "the"
    // attached silo (D9 guarantees at most one of them can hold it).
    it('draws from S2 when posting item R2 and the shed has two silos (S1=R1, S2=R2)', async () => {
      answers(
        [{ ...consumptionLine, item_id: 'item-r2' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-r2', uom_primary: 'KG' }],
        [shed],
      );
      answerSiloLinks(['silo-1', 'silo-2']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([
          ['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 100 }],
          ['silo-2', { item_id: 'item-r2', item_code: 'R2', item_description: null, on_hand_qty: 50 }],
        ]),
      );
      answerSplitCheck('SILO');
    answerFindForDate();

      await postFeed('item-r2');

      expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'silo-2' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it('draws from S1 when posting item R1 and the shed has two silos (S1=R1, S2=R2)', async () => {
      answers(
        [{ ...consumptionLine, item_id: 'item-r1' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-r1', uom_primary: 'KG' }],
        [shed],
      );
      answerSiloLinks(['silo-1', 'silo-2']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([
          ['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 100 }],
          ['silo-2', { item_id: 'item-r2', item_code: 'R2', item_description: null, on_hand_qty: 50 }],
        ]),
      );
      answerSplitCheck('SILO');
    answerFindForDate();

      await postFeed('item-r1');

      expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'silo-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it("takes what the silo holds and the rest from the farm's store when the silo is short", async () => {
      answers(
        [{ ...consumptionLine, item_id: 'item-r1' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE', farm_id: 'farm-1' }],
        [],
        [{ item_id: 'item-r1', uom_primary: 'KG' }],
        [shed],
      );
      answerSiloLinks(['silo-1']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 10 }]]),
      );
      answerSplitCheck('SILO', 10);
      answers([{ location_id: 'store-1' }], [{ code: 'STORE-1' }]);
      answerFindForDate();

      await postFeed('item-r1');

      const calls = (batchService.postConsumptionGroup as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toEqual(expect.objectContaining({ source_warehouse_id: 'silo-1', shares: [{ animal_id: undefined, quantity: 10 }] }));
      expect(calls[1][1]).toEqual(expect.objectContaining({ source_warehouse_id: 'store-1', shares: [{ animal_id: undefined, quantity: 12.5 }] }));
    });

    // Data entry happens at PEN level on some farms; a silo is attached to
    // the shed above it, never to the individual pen.
    it('walks a PEN up to its shed, then draws from the silo holding the item', async () => {
      answers(
        [consumptionLine],
        [{ ...header, location_id: 'pen-3' }],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [{ location_id: 'pen-3', location_type: 'PEN', parent_location_id: 'shed-1', farm_id: 'farm-1' }],
        [shed],
      );
      answerSiloLinks(['silo-1']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([['silo-1', { item_id: 'item-feed', item_code: 'FEED', item_description: null, on_hand_qty: 200 }]]),
      );
      answerSplitCheck('SILO');
    answerFindForDate();

      await postFeed();

      expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'silo-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    // Medicine M: neither attached silo holds it, so the draw falls through
    // to the farm store exactly as it does with no silo attached at all.
    it("falls back to the farm's store when no attached silo holds the posted item", async () => {
      answers(
        [{ ...consumptionLine, item_id: 'item-medicine' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-medicine', uom_primary: 'PCS' }],
        [shed],
      );
      answerSiloLinks(['silo-1', 'silo-2']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([
          ['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 100 }],
          ['silo-2', { item_id: 'item-r2', item_code: 'R2', item_description: null, on_hand_qty: 50 }],
        ]),
      );
      answers([{ location_id: 'store-1' }]);
      answerSplitCheck('STORE');
    answerFindForDate();

      await postFeed('item-medicine');

      expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'store-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it("falls back to the farm's store when the shed has no silos linked", async () => {
      answers(
        [consumptionLine],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [shed],
      );
      answerSiloLinks([]);
      answers([{ location_id: 'store-1' }]);
      answerSplitCheck('STORE');
    answerFindForDate();

      await postFeed();

      expect(batchService.postConsumptionGroup).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ source_warehouse_id: 'store-1' }),
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    // Minor 1 of the final review: the same silo rows the forecast reads —
    // this tenant's links, to silos still active and not deleted.
    it('reads only this tenant\'s links to active, undeleted silos', async () => {
      answers(
        [consumptionLine],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-feed', uom_primary: 'KG' }],
        [shed],
      );
      const where = answerSiloLinks([]);
      answers([{ location_id: 'store-1' }]);
      answerSplitCheck('STORE');
    answerFindForDate();

      await postFeed();

      const { sql: text, params } = new MySqlDialect().sqlToQuery(where.mock.calls[0][0]);
      expect(text).toContain('`silo_shed_link`.`tenant_id` = ?');
      expect(text).toContain('`location_master`.`is_active` = ?');
      expect(text).toContain('`location_master`.`deleted_at` is null');
      expect(params).toContain('tenant-123');
    });

    it('refuses the entry when no attached silo holds the item and there is no store', async () => {
      answers(
        [{ ...consumptionLine, item_id: 'item-medicine' }],
        [header],
        [{ tracking_mode: 'BATCH_WISE' }],
        [],
        [{ item_id: 'item-medicine', uom_primary: 'PCS' }],
        [shed],
      );
      answerSiloLinks(['silo-1']);
      siloFeedService.currentItems.mockResolvedValueOnce(
        new Map([['silo-1', { item_id: 'item-r1', item_code: 'R1', item_description: null, on_hand_qty: 100 }]]),
      );
      answers([]);

      await expect(postFeed('item-medicine')).rejects.toThrow(BadRequestException);
      expect(batchService.postConsumptionGroup).not.toHaveBeenCalled();
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
      expect(batchService.postConsumptionGroup).not.toHaveBeenCalled();
    });

    // OUTPUT lines put stock IN and carry no FIFO draw, so they resolve
    // nothing and keep behaving exactly as before.
    it('resolves no location for an OUTPUT line', async () => {
      (batchService.addTransaction as jest.Mock).mockResolvedValue({
        transactions: [{ transaction_id: 'tx-1', transaction_date: '2026-09-08', item_id: 'item-feed', transaction_type: 'OUTPUT' }],
      });
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

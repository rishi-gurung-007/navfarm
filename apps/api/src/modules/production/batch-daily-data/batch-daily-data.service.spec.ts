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

import { BreedingService } from '../../piggery/breeding/breeding.service';

// The block on entries for an empty batch is tested on its own (entry-blocked.spec.ts); these suites mock the
// database read by read, so the extra read is taken out of their way.
jest.mock('./entry-blocked', () => ({ entryBlockedReason: jest.fn().mockResolvedValue(null) }));
// Where an animal stood on the entry date is read from the movement log (animal-membership.spec.ts). These suites
// queue the animal's own row; the placement is taken from it, as the register's current state always was.
const mockPlacements = new Map<string, { batch_id: string | null; stage_id: string | null }>();
const placed = <T extends { animal_id: string; current_batch_id: string | null; current_stage_id: string | null }>(animal: T): T => {
  mockPlacements.set(animal.animal_id, { batch_id: animal.current_batch_id, stage_id: animal.current_stage_id });
  return animal;
};
jest.mock('./animal-membership', () => ({
  animalPlacementOn: jest.fn(async (_db: unknown, animalId: string) => mockPlacements.get(animalId) ?? { batch_id: null, stage_id: null }),
}));

const breedingMock = { recordFarrowing: jest.fn(), recordWeaning: jest.fn(), recordSemenCollection: jest.fn() };
// The closed-period guard (r32) is its own unit (monthly-stock-take.rules.spec.ts); these
// tests queue db.select results in order, so the guard's read is stubbed here.
jest.mock('../../../common/period-close', () => ({ assertPostingPeriodOpen: jest.fn().mockResolvedValue(undefined) }));

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
    mockPlacements.clear();
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
        { provide: BreedingService, useValue: breedingMock },
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

  // KPI alerts come from the scheduler line's own limits (Rishi, 14 Oct): the stage's KPIs & Alerts are filled onto the
  // scheduler as lines when it is created, so a breach is one alert — the line's — and the stage is not checked again.
  it('a KPI line breaching its own limit writes the alert from the line', async () => {
    const single = (row: unknown[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(row) }) }) });
    mockDbSelect
      .mockReturnValueOnce(single([{ line_id: 'line-kpi', scheduler_id: 'sched-1', is_active: true, line_type: 'DESCRIPTIVE', item_id: null, lot_required: false, kpi_metric: 'BODY_WEIGHT', activity_name: 'Weight', lower_alert_limit: null, upper_alert_limit: '1', alert_severity: 'WARNING', std_value: null }]))
      .mockReturnValueOnce(single([header]))
      .mockReturnValueOnce(single([{ tracking_mode: 'BATCH_WISE' }]))
      .mockReturnValueOnce(single([]))
      .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

    await service.postEntry('batch-1', { line_id: 'line-kpi', entry_date: '2026-09-08', entered_value: 3 } as any, 'tenant-123');

    // the line's KPI_DEVIATION alert (notification_alert_log), batch_daily_data and the ledger
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
                placed({
                  animal_id: 'a-1',
                  animal_code: 'PIG-0001',
                  current_batch_id: 'batch-1',
                  current_stage_id: 'stage-gestation',
                }),
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

    describe('an animal-wise entry is judged by where the animal was ON the entry date (Rishi, 21 Oct)', () => {
      const readOnce = (rows: unknown[]) =>
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
      const queueToAnimal = () => {
        readOnce([{ line_id: 'line-1', scheduler_id: 'sched-1', is_active: true, line_type: 'DESCRIPTIVE', item_id: null, lot_required: false }]);
        readOnce([stageHeader]);
        readOnce([{ tracking_mode: 'ANIMAL_WISE', batch_no: 'BATCH-000132' }]);
        // The register has her in flush now - she was in gestation on the entry date.
        readOnce([{ animal_id: 'a-1', animal_code: 'PIG-2025-0019', current_batch_id: 'batch-1', current_stage_id: 'stage-flush' }]);
      };
      const post = () =>
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: '2026-08-09', entered_value: 190, animal_id: 'a-1' } as any, 'tenant-123');
      const asked = () => post().then(() => '', (e) => String(e?.message ?? e));

      it('accepts a past-dated entry for an animal that was at the line\'s stage then and has moved on since', async () => {
        queueToAnimal();
        mockPlacements.set('a-1', { batch_id: 'batch-1', stage_id: 'stage-flush' });
        const { animalPlacementOn } = jest.requireMock('./animal-membership');
        expect(await asked()).not.toMatch(/was not (in batch|at this line)/);
        expect(animalPlacementOn).toHaveBeenCalledWith(expect.anything(), 'a-1', '2026-08-09');
      });

      it('refuses it, naming the animal and the date, when she was in another batch then', async () => {
        queueToAnimal();
        mockPlacements.set('a-1', { batch_id: 'batch-other', stage_id: 'stage-flush' });
        expect(await asked()).toBe("Animal 'PIG-2025-0019' was not in batch 'BATCH-000132' on 2026-08-09, so no entry can be recorded for it that day.");
      });

      it('refuses it, naming the animal and the date, when she was at another stage then', async () => {
        queueToAnimal();
        mockPlacements.set('a-1', { batch_id: 'batch-1', stage_id: 'stage-gestation' });
        expect(await asked()).toMatch(/Animal 'PIG-2025-0019' was not at this line's stage on 2026-08-09/);
      });
    });

    it('posts the exact named animal as a MORTALITY through the batch path for a MORTALITY_COUNT entry, leaving the stage headcount to the register', async () => {
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
                placed({
                  animal_id: 'a-1',
                  animal_code: 'PIG-0001',
                  current_batch_id: 'batch-1',
                  current_stage_id: 'stage-flush',
                }),
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
      (mockDb as any).delete = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) });

      await service.postEntry(
        'batch-1',
        {
          line_id: 'line-mort',
          entry_date: '2026-09-08',
          entered_value: 1,
          animal_id: 'a-1',
          // Rishi, 13 Oct: an animal-wise death carries its dead weight and reason too.
          mortality_animals: [{ dead_weight_kg: 10, reason_text: 'Crushed' }],
        } as any,
        'tenant-123',
      );

      // The register flip, movement log, batch count and write-off are addTransaction's job now.
      expect(batchService.addTransaction).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({
          transaction_type: 'MORTALITY',
          quantity: 1,
          animal_id: 'a-1',
          transaction_date: '2026-09-08',
          // The reason entered for the death goes with it (typed here, so as its cause), with its dead weight.
          mortality_detail: { cause_of_death: 'Crushed' },
          remarks: expect.stringContaining('Dead weight 10 kg'),
          skip_scheduler_count: false, // a named animal is counted by the register, not by this line
        }),
        'tenant-123',
        undefined,
      );
      expect(updateSets.find((v) => v.status === 'DEAD')).toBeUndefined();
      expect(updateSets.find((v) => v.animal_count !== undefined)).toBeUndefined();
      delete (mockDb as any).update;
      delete (mockDb as any).delete;
    });
  });

  describe("a sow's piglet output", () => {
    const outLine = { line_id: 'line-out', scheduler_id: 'sched-1', is_active: true, line_type: 'OUTPUT', item_id: 'item-piglet', lot_required: false, activity_name: 'Piglet Output (Live Born)' };
    const hdr = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', stage_id: 'st-farrow', animal_count: '2' };
    const lim = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
    const piglet = { item_id: 'item-piglet', item_type: 'LIVING_ASSET', is_biological_asset: true, uom_primary: 'HEAD' };
    // line, header, batch, [the animal named], lock, idempotency, item, then what sowLitterEvent reads
    const arrange = (animal: object, stageForm: string, openLitter: object[]) => {
      mockDbSelect
        .mockReturnValueOnce(lim([outLine]))
        .mockReturnValueOnce(lim([hdr]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'sow-1', animal_code: 'SOW-1', current_batch_id: 'batch-1', current_stage_id: 'st-farrow' })]))
        .mockReturnValueOnce(lim([])) // lock
        .mockReturnValueOnce(lim([])) // idempotency
        .mockReturnValueOnce(lim([piglet])) // item
        .mockReturnValueOnce(lim([animal])) // gender and parity
        .mockReturnValueOnce(lim(openLitter)); // an open litter makes it a weaning, wherever she is
      if (!openLitter.length) mockDbSelect.mockReturnValueOnce(lim([{ data_entry_form: stageForm }]));
      mockDbSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
    };
    const post = () => service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'sow-1', entered_value: 11 } as any, 'tenant-123', { userId: 'u1' });

    beforeEach(() => {
      breedingMock.recordFarrowing.mockReset().mockResolvedValue({ farrow_id: 'f-1', message: 'Farrowing recorded: 11 live piglets.' });
      breedingMock.recordWeaning.mockReset().mockResolvedValue({ farrow_id: 'f-1', message: 'Weaning recorded.' });
      breedingMock.recordSemenCollection.mockReset().mockResolvedValue({ semen_batch_id: 'sb-1', message: 'Semen collection logged.' });
    });

    it('is a farrowing on a stage whose data-entry form is FARROWING: the Breeding screen’s posting, with the line’s item as the piglet item', async () => {
      arrange({ gender: 'F', parity_count: 1 }, 'FARROWING', []);
      await post();
      expect(breedingMock.recordFarrowing).toHaveBeenCalledWith(
        expect.objectContaining({ sow_animal_id: 'sow-1', farrowing_date: '2026-10-09', piglets_born_live: 11, piglet_item_id: 'item-piglet' }),
        'tenant-123',
        { userId: 'u1' },
      );
      expect(batchService.addTransaction).not.toHaveBeenCalled(); // no OUTPUT into the sow’s own batch
    });

    it('is the weaning of the litter she still nurses even on the farrowing stage — she cannot farrow again before it', async () => {
      arrange({ gender: 'F', parity_count: 1 }, 'FARROWING', [{ farrow_id: 'f-9' }]);
      await post();
      expect(breedingMock.recordWeaning).toHaveBeenCalledWith('f-9', expect.objectContaining({ piglets_weaned: 11 }), 'tenant-123', { userId: 'u1' });
      expect(breedingMock.recordFarrowing).not.toHaveBeenCalled();
    });

    it('is the weaning of the litter she is nursing on any other stage', async () => {
      arrange({ gender: 'F', parity_count: 1 }, 'STANDARD', [{ farrow_id: 'f-9' }]);
      await post();
      expect(breedingMock.recordWeaning).toHaveBeenCalledWith('f-9', { weaning_date: '2026-10-09', piglets_weaned: 11 }, 'tenant-123', { userId: 'u1' });
      expect(breedingMock.recordFarrowing).not.toHaveBeenCalled();
    });

    it('will not change a posted farrowing in place, and says it is the litter’s record', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([outLine]))
        .mockReturnValueOnce(lim([hdr]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'sow-1', animal_code: 'SOW-1', current_batch_id: 'batch-1', current_stage_id: 'st-farrow' })]))
        .mockReturnValueOnce(lim([])) // lock
        .mockReturnValueOnce(lim([{ entry_id: 'x', posted: true, posting_reference: 'f-1', entered_value: '9.000000', entered_text: null, lot_no: null, serial_no: null }]))
        .mockReturnValueOnce(lim([{ farrow_id: 'f-1' }])); // the reference is a farrowing record
      await expect(post()).rejects.toThrow('recorded a farrowing or weaning, so it cannot be changed in place');
      expect(breedingMock.recordFarrowing).not.toHaveBeenCalled();
    });

    it('is ordinary output when there is no litter to wean', async () => {
      arrange({ gender: 'F', parity_count: 1 }, 'STANDARD', []);
      (batchService.addTransaction as jest.Mock).mockResolvedValue({ transactions: [] });
      await post();
      expect(breedingMock.recordFarrowing).not.toHaveBeenCalled();
      expect(breedingMock.recordWeaning).not.toHaveBeenCalled();
      expect(breedingMock.recordSemenCollection).not.toHaveBeenCalled();
      expect(batchService.addTransaction).toHaveBeenCalledTimes(1);
    });

    it('is a semen collection for a boar, of whatever item the line names — the Breeding screen’s posting', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([{ ...outLine, item_id: 'item-semen', activity_name: 'Boar Semen Collection' }]))
        .mockReturnValueOnce(lim([hdr]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'boar-1', animal_code: 'B-1', current_batch_id: 'batch-1', current_stage_id: 'st-farrow' })]))
        .mockReturnValueOnce(lim([])) // lock
        .mockReturnValueOnce(lim([])) // idempotency
        .mockReturnValueOnce(lim([{ item_id: 'item-semen', item_type: 'RAW_MATERIAL', is_biological_asset: false, uom_primary: 'DOSE' }]))
        .mockReturnValueOnce(lim([{ gender: 'M', parity_count: 0 }]))
        .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([{ value: '82.5' }]) }) }) }) }) // same-day motility
        .mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

      await service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'boar-1', entered_value: 40 } as any, 'tenant-123', { userId: 'u1' });

      expect(breedingMock.recordSemenCollection).toHaveBeenCalledWith(
        expect.objectContaining({ boar_animal_id: 'boar-1', collection_date: '2026-10-09', doses_collected: 40, output_item_id: 'item-semen', motility_pct: 82.5 }),
        'tenant-123',
        { userId: 'u1' },
      );
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    // Pooled semen: the entry is made against one boar and names the others whose semen is mixed into the same lot.
    describe('a boar’s collection pooled with other boars', () => {
      const semenLine = { ...outLine, item_id: 'item-semen', activity_name: 'Boar Semen Collection' };
      const semenItem = { item_id: 'item-semen', item_type: 'FINISHED_GOODS', is_biological_asset: false, uom_primary: 'DOSE' };
      /** What the guard reads: the pooled boars' own entries on this line and day. */
      const ownEntries = (found: object[]) => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(found) }) }) });
      /** `guard` is what the pooled-boar check reads; null when the entry names no pool, so the check never runs. */
      const arrangeBoar = (guard: object[] | null) =>
        mockDbSelect
          .mockReturnValueOnce(lim([semenLine]))
          .mockReturnValueOnce(lim([hdr]))
          .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
          .mockReturnValueOnce(lim([placed({ animal_id: 'boar-1', animal_code: 'B-1', current_batch_id: 'batch-1', current_stage_id: 'st-farrow' })]))
          .mockReturnValueOnce(lim([])) // lock
          .mockReturnValueOnce(lim([])) // idempotency
          .mockReturnValueOnce(lim([semenItem]))
          .mockReturnValueOnce(lim([{ gender: 'M', parity_count: 0 }]))
          .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) }) // same-day motility
          .mockReturnValueOnce(guard ? ownEntries(guard) : { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) })
          .mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
      const postPooled = (over: object = {}) =>
        service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'boar-1', entered_value: 40, pool_animal_ids: ['boar-2'], ...over } as any, 'tenant-123', { userId: 'u1' });

      it('makes one collection with the other boars named, so one lot is mixed from all of them', async () => {
        arrangeBoar([]);
        await postPooled();
        expect(breedingMock.recordSemenCollection).toHaveBeenCalledTimes(1);
        expect(breedingMock.recordSemenCollection).toHaveBeenCalledWith(
          expect.objectContaining({ boar_animal_id: 'boar-1', doses_collected: 40, output_item_id: 'item-semen', pool_boar_animal_ids: ['boar-2'] }),
          'tenant-123',
          { userId: 'u1' },
        );
      });

      it('names no pool on an ordinary single-boar collection', async () => {
        arrangeBoar(null);
        await postPooled({ pool_animal_ids: undefined });
        expect(breedingMock.recordSemenCollection.mock.calls[0][0]).not.toHaveProperty('pool_boar_animal_ids');
      });

      it('is refused when a pooled boar already has a collection of his own on this line and day — his doses would count twice', async () => {
        arrangeBoar([{ animal_id: 'boar-2', code: 'B-2' }]);
        await expect(postPooled()).rejects.toThrow('B-2 already has a collection of their own');
        expect(breedingMock.recordSemenCollection).not.toHaveBeenCalled();
      });

      it('cannot be asked of an output that is not a boar’s semen', async () => {
        arrange({ gender: 'F', parity_count: 1 }, 'FARROWING', []);
        await expect(
          service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'sow-1', entered_value: 11, pool_animal_ids: ['boar-2'] } as any, 'tenant-123', { userId: 'u1' }),
        ).rejects.toThrow('Only a boar');
        expect(breedingMock.recordFarrowing).not.toHaveBeenCalled();
      });
    });
  });

  // Decision 8 / Phase 7: the item an output takes out of the batch is chosen when it is entered.
  describe('the output item chosen at entry', () => {
    const lim = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
    const hdr = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', stage_id: 'st-boar', animal_count: '1' };
    const outLine = { line_id: 'line-out', scheduler_id: 'sched-1', is_active: true, line_type: 'OUTPUT', item_id: null, lot_required: true, activity_name: 'Boar Semen Collection' };

    beforeEach(() => {
      breedingMock.recordSemenCollection.mockReset().mockResolvedValue({ semen_batch_id: 'sb-1', message: 'Semen lot LOT-00007.' });
      breedingMock.recordWeaning.mockReset().mockResolvedValue({ farrow_id: 'f-1', message: 'Weaning recorded.' });
    });

    it('posts the item the entry names when the line has none — and asks no lot of an output, whose lot is made at posting', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([outLine]))
        .mockReturnValueOnce(lim([hdr]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'STANDARD' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'boar-1', animal_code: 'B-1', current_batch_id: 'batch-1', current_stage_id: 'st-boar' })]))
        .mockReturnValueOnce(lim([])) // lock
        .mockReturnValueOnce(lim([])) // idempotency
        .mockReturnValueOnce(lim([{ item_id: 'item-semen', tenant_id: 'tenant-123', is_active: true, is_biological_asset: false, uom_primary: 'DOSE' }]))
        .mockReturnValueOnce(lim([{ gender: 'M', parity_count: 0 }]))
        .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve([{ value: '82.5' }]) }) }) }) }) // same-day motility
        .mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

      await service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'boar-1', entered_value: 30, item_id: 'item-semen' } as any, 'tenant-123', { userId: 'u1' });

      expect(breedingMock.recordSemenCollection).toHaveBeenCalledWith(
        expect.objectContaining({ boar_animal_id: 'boar-1', doses_collected: 30, output_item_id: 'item-semen' }),
        'tenant-123',
        { userId: 'u1' },
      );
    });

    it('refuses an item from another tenant, or one no longer active', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([outLine]))
        .mockReturnValueOnce(lim([hdr]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'boar-1', animal_code: 'B-1', current_batch_id: 'batch-1', current_stage_id: 'st-boar' })]))
        .mockReturnValueOnce(lim([]))
        .mockReturnValueOnce(lim([]))
        .mockReturnValueOnce(lim([{ item_id: 'item-x', tenant_id: 'other-tenant', is_active: true }]));
      await expect(
        service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'boar-1', entered_value: 30, item_id: 'item-x' } as any, 'tenant-123'),
      ).rejects.toThrow('The chosen output item was not found');
      expect(breedingMock.recordSemenCollection).not.toHaveBeenCalled();
    });

    it('takes no item chosen at entry on a line that is not an output', async () => {
      mockDbSelect.mockReturnValueOnce(lim([{ ...outLine, line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' }])).mockReturnValueOnce(lim([hdr]));
      await expect(
        service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-09', animal_id: 'boar-1', entered_value: 2, item_id: 'item-semen' } as any, 'tenant-123'),
      ).rejects.toThrow("'Morning Feed' is not an output line");
    });

    it('sends the weaned piglets to the batch a weaning entry names', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([{ ...outLine, item_id: 'item-piglet', lot_required: false, activity_name: 'Piglet Output' }]))
        .mockReturnValueOnce(lim([{ ...hdr, stage_id: 'st-lact' }]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'sow-1', animal_code: 'S-1', current_batch_id: 'batch-1', current_stage_id: 'st-lact' })]))
        .mockReturnValueOnce(lim([]))
        .mockReturnValueOnce(lim([]))
        .mockReturnValueOnce(lim([{ item_id: 'item-piglet', is_biological_asset: true, uom_primary: 'HEAD' }]))
        .mockReturnValueOnce(lim([{ gender: 'F', parity_count: 1 }]))
        .mockReturnValueOnce(lim([{ farrow_id: 'f-9', parity_number: 2, piglet_lot_no: null, piglet_batch_id: null }]))
        .mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });

      await service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-11-06', animal_id: 'sow-1', entered_value: 10, destination_batch_id: 'b-weaners' } as any, 'tenant-123', { userId: 'u1' });

      expect(breedingMock.recordWeaning).toHaveBeenCalledWith(
        'f-9',
        expect.objectContaining({ weaning_date: '2026-11-06', piglets_weaned: 10, move_to_batch_id: 'b-weaners' }),
        'tenant-123',
        { userId: 'u1' },
      );
    });
  });

  describe('TRANSFER lines', () => {
    const transferLine = { line_id: 'line-xfer', scheduler_id: 'sched-1', is_active: true, line_type: 'TRANSFER', item_id: null, lot_required: false, activity_name: 'Move to growers', standard_qty: null, auto_triggers_stage: false };
    const xferHeader = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', stage_id: 'st-1', animal_count: '50' };
    const lim = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });
    const selects = (trackingMode: string, extra: any[] = []) => {
      mockDbSelect
        .mockReturnValueOnce(lim([transferLine])) // line
        .mockReturnValueOnce(lim([xferHeader])) // header
        .mockReturnValueOnce(lim([{ tracking_mode: trackingMode, company_id: 'comp-1' }])); // batch
      for (const rows of extra) mockDbSelect.mockReturnValueOnce(lim(rows));
      mockDbSelect
        .mockReturnValueOnce(lim([])) // stage/date lock
        .mockReturnValueOnce(lim([])) // idempotency
        .mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // findForDate
    };
    let transfers: { create: jest.Mock };
    beforeEach(() => {
      transfers = (service as any).batchTransferService;
      transfers.create.mockReset().mockResolvedValue({ transfer_id: 'tr-1' });
    });

    it('keeps the destination of a TRANSFER saved as a draft, so posting the day still knows where the head go', async () => {
      selects('BATCH_WISE');
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn((v: any) => { inserted.push(v); return { onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }; }),
      });
      await service.postEntry('batch-1', { line_id: 'line-xfer', entry_date: '2026-10-01', entered_value: 5, destination_batch_id: 'batch-2', draft: true } as any, 'tenant-123');
      expect(inserted[0]).toMatchObject({ posted: false, destination_batch_id: 'batch-2', item_id: null });
      expect(transfers.create).not.toHaveBeenCalled();
    });

    it('asks for the item when an OUTPUT line has none and the entry names none, instead of posting the first livestock item it finds', async () => {
      mockDbSelect
        .mockReturnValueOnce(lim([{ ...transferLine, line_id: 'line-out', line_type: 'OUTPUT', item_id: null, activity_name: 'Boar Semen Collection' }]))
        .mockReturnValueOnce(lim([xferHeader]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'BATCH_WISE', company_id: 'comp-1' }]))
        .mockReturnValueOnce(lim([])) // lock
        .mockReturnValueOnce(lim([])); // idempotency
      await expect(
        service.postEntry('batch-1', { line_id: 'line-out', entry_date: '2026-10-01', entered_value: 40 } as any, 'tenant-123'),
      ).rejects.toThrow("Choose the item 'Boar Semen Collection' takes out of the batch.");
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    it('will not change a posted death or transfer in place — a reopen leaves them posted, so a re-post would count them twice', async () => {
      const death = { ...transferLine, line_id: 'line-death', line_type: 'DESCRIPTIVE', kpi_metric: 'MORTALITY_COUNT', activity_name: 'Daily Mortality Check' };
      mockDbSelect
        .mockReturnValueOnce(lim([death]))
        .mockReturnValueOnce(lim([xferHeader]))
        .mockReturnValueOnce(lim([{ tracking_mode: 'ANIMAL_WISE', company_id: 'comp-1', costing_method: 'BIO_ASSET' }]))
        .mockReturnValueOnce(lim([placed({ animal_id: 'a-7', animal_code: 'PIG-7', current_batch_id: 'batch-1', current_stage_id: 'st-1' })]))
        .mockReturnValueOnce(lim([])) // lock (reopened)
        .mockReturnValueOnce(lim([{ entry_id: 'x', posted: true, entered_value: '1.000000', entered_text: null, lot_no: null, serial_no: null }])); // already posted: 1 death

      await expect(
        service.postEntry('batch-1', { line_id: 'line-death', entry_date: '2026-10-01', animal_id: 'a-7', entered_value: 0 } as any, 'tenant-123'),
      ).rejects.toThrow("'Daily Mortality Check' is already posted and it recorded a death, which is final, so it cannot be changed in place.");
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    it('moves exactly the named animal of an animal-wise batch — nobody is picked for the farmer', async () => {
      selects('ANIMAL_WISE', [[placed({ animal_id: 'a-7', animal_code: 'PIG-7', current_batch_id: 'batch-1', current_stage_id: 'st-1' })]]);

      await service.postEntry('batch-1', { line_id: 'line-xfer', entry_date: '2026-10-01', animal_id: 'a-7', destination_batch_id: 'batch-2' } as any, 'tenant-123');

      const [dto] = transfers.create.mock.calls[0];
      expect(dto.animal_ids).toEqual(['a-7']);
      expect(dto.quantity).toBeUndefined();
    });

    it('moves a head count out of a batch-wise batch, which has no animals to pick', async () => {
      selects('BATCH_WISE');

      await service.postEntry('batch-1', { line_id: 'line-xfer', entry_date: '2026-10-01', entered_value: 12, destination_batch_id: 'batch-2' } as any, 'tenant-123');

      const [dto, , fromBatch] = transfers.create.mock.calls[0];
      expect(fromBatch).toBe('batch-1');
      expect(dto).toMatchObject({ quantity: 12, transfer_type: 'PARTIAL', to_batch_id: 'batch-2' });
      expect(dto.animal_ids).toBeUndefined();
    });

    it('asks how many head when a batch-wise line gives neither a value nor a standard quantity', async () => {
      selects('BATCH_WISE');
      await expect(
        service.postEntry('batch-1', { line_id: 'line-xfer', entry_date: '2026-10-01', destination_batch_id: 'batch-2' } as any, 'tenant-123'),
      ).rejects.toThrow('how many head');
      expect(transfers.create).not.toHaveBeenCalled();
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
      // Master r8: only the links effective on the entry date count (the shared helper).
      expect(text).toContain('`silo_shed_link`.`effective_from`');
      expect(text).toContain('`silo_shed_link`.`effective_to`');
      expect(params).toContain('2026-09-08');
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
  // Workbook checkpoint 28: empty bags x bag size vs posted consumption on POST Day. A flag, never a refusal.
  describe('empty-bag reconciliation (checkpoint 28)', () => {
    const settings = (rows: unknown[]) =>
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }) });
    const group = (empty_bags?: number) =>
      [{ dto: { empty_bags }, header, tenantId: 'tenant-123', batchId: 'batch-1', line: { line_id: 'line-1', activity_name: 'Feeding' }, farmId: null }] as any;
    const alertValues = jest.fn().mockResolvedValue({});

    beforeEach(() => {
      alertValues.mockClear();
      mockDbInsert.mockReturnValue({ values: alertValues });
    });

    it('flags 98 bags of 50 KG against 5,000 KG posted when the tolerance is 1%, and logs an alert', async () => {
      settings([{ farm_id: null, bag_size_kg: '50.00', bag_tolerance_pct: '1.00' }]);
      const warning = await (service as any).reconcileEmptyBags(group(98), 5000);
      expect(warning).toBe('98 empty bags imply 4,900 KG versus 5,000 KG posted use; review tolerance (1%).');
      expect(alertValues).toHaveBeenCalledWith(expect.objectContaining({ alert_type: 'BAG_RECONCILIATION', severity: 'WARNING' }));
    });

    it('allows the same count inside a 2% tolerance, and does nothing when no count was entered', async () => {
      settings([{ farm_id: null, bag_size_kg: '50.00', bag_tolerance_pct: '2.00' }]);
      await expect((service as any).reconcileEmptyBags(group(98), 5000)).resolves.toBeNull();
      await expect((service as any).reconcileEmptyBags(group(undefined), 5000)).resolves.toBeNull();
      expect(alertValues).not.toHaveBeenCalled();
    });

    it('returns null, never throws, when the settings read fails (flag only, never block)', async () => {
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockRejectedValue(new Error('db down')) }) });
      await expect((service as any).reconcileEmptyBags(group(98), 5000)).resolves.toBeNull();
    });

    it('returns null, never throws, when the alert log insert fails', async () => {
      settings([{ farm_id: null, bag_size_kg: '50.00', bag_tolerance_pct: '1.00' }]);
      alertValues.mockRejectedValueOnce(new Error('insert failed'));
      await expect((service as any).reconcileEmptyBags(group(98), 5000)).resolves.toBeNull();
    });
  });
});

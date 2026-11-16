import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BatchTransferService, spreadToTotal } from './batch-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import * as schema from '../../../core/database/schema';

describe('BatchTransferService', () => {
  let service: BatchTransferService;
  let module: TestingModule;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbTransaction = jest.fn();
  // An animal with no ledger rows by default; a test that cares sets its own.
  const mockValuesFor = jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, { bookValue: 0, hasRows: false }])));
  const mockGl = {
    mappedAccount: jest.fn(),
    postAccountTransfer: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
  };

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
    mockGl.postAccountTransfer.mockClear();

    module = await Test.createTestingModule({
      providers: [
        BatchTransferService,
        {
          provide: ClsService,
          // 'tenantPostingTransaction' true: a post joins the transaction the unit test stands in for.
          useValue: {
            get: jest.fn((key: string) =>
              key === 'tenantPostingTransaction' ? true : mockDb,
            ),
          },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: NumberSeriesService,
          useValue: {
            generateNext: jest.fn().mockResolvedValue('BTR-0001'),
            seriesCodeForDocument: jest
              .fn()
              .mockResolvedValue('BATCH_TRANSFER'),
          },
        },
        {
          provide: SchedulerHeaderService,
          useValue: {
            createForStage: jest.fn().mockResolvedValue({}),
            syncAnimalWiseCounts: jest.fn().mockResolvedValue(undefined),
            alignToStageEntry: jest.fn().mockResolvedValue(null),
            stageEntryDate: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: AnimalMovementLogService,
          useValue: { record: jest.fn().mockResolvedValue('movement-1') },
        },
        {
          provide: AnimalBookValueService,
          useValue: { valuesFor: mockValuesFor },
        },
        { provide: GlPostingService, useValue: mockGl },
      ],
    }).compile();

    service = module.get<BatchTransferService>(BatchTransferService);
  });

  describe('stage must belong to the destination line of business (D5)', () => {
    const batch = (over: object) => ({
      batch_id: 'b',
      batch_no: 'B',
      tenant_id: 'tenant-123',
      company_id: 'comp-1',
      status: 'ACTIVE',
      tracking_mode: 'ANIMAL_WISE',
      lob_id: 'lob-pig',
      stage_id: null,
      ...over,
    });
    const lim = (rows: object[]) => ({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }),
    });
    const setup = (pool: object[]) => {
      jest
        .spyOn(service as any, 'loadBatch')
        .mockResolvedValueOnce(batch({ batch_id: 'src', batch_no: 'SRC' }))
        .mockResolvedValueOnce(
          batch({ batch_id: 'dst', batch_no: 'DST', lob_id: 'lob-pig' }),
        );
      jest
        .spyOn(service, 'listTransferableAnimals')
        .mockResolvedValue(pool as any);
    };
    const dto = (over: object = {}) =>
      ({
        company_id: 'comp-1',
        to_batch_id: 'dst',
        transfer_date: '2026-10-01',
        animal_ids: ['a-1'],
        ...over,
      }) as any;

    it('refuses an animal whose stage belongs to another line of business, asking for a destination stage', async () => {
      setup([
        {
          animal_id: 'a-1',
          animal_code: 'CH-1',
          current_stage_id: 'st-poultry',
          gender: 'F',
        },
      ]);
      mockDbSelect.mockReturnValueOnce(
        lim([{ stage_id: 'st-poultry', lob_id: 'lob-poultry' }]),
      );
      await expect(service.create(dto(), 'tenant-123', 'src')).rejects.toThrow(
        "CH-1 has no stage that belongs to DST's line of business",
      );
    });

    it('refuses an animal with no stage at all', async () => {
      setup([
        {
          animal_id: 'a-1',
          animal_code: 'PIG-1',
          current_stage_id: null,
          gender: 'F',
        },
      ]);
      await expect(service.create(dto(), 'tenant-123', 'src')).rejects.toThrow(
        'Choose a destination stage',
      );
    });

    it('lets a named destination stage stand in for the animals’ own', async () => {
      setup([
        {
          animal_id: 'a-1',
          animal_code: 'PIG-1',
          current_stage_id: null,
          gender: 'F',
        },
      ]);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                stage_id: 'st-x',
                stage_name: 'X',
                applicable_gender: null,
              },
            ]),
          }),
        }),
      }); // named stage lookup
      // anything after the stage checks is not this test's business — it stops at the bio-asset state read
      mockDbSelect.mockImplementation(() => {
        throw new Error('reached past the stage checks');
      });
      await expect(
        service.create(dto({ to_stage_id: 'st-x' }), 'tenant-123', 'src'),
      ).rejects.toThrow('reached past the stage checks');
    });
  });

  describe('each animal moves at its own book value', () => {
    // BTR-0001 on nf_devco (10 Nov 2026, undone): two boars bought at 1,200 and amortised to 0 moved at 1,200, because a
    // book value of 0 was read as "no value". Three boars at 352.50 moved correctly.
    const boars = [
      { animal_id: 'b-amortised', animal_code: 'PIG-2024-0015', current_stage_id: 'st-q', gender: 'M', book_value: '0.0000', total_opening_asset_value: '1200.0000', acquisition_cost: '1200.0000' },
      { animal_id: 'b-valued', animal_code: 'PIG-2024-0018', current_stage_id: 'st-q', gender: 'M', book_value: '352.5000', total_opening_asset_value: '700.0000', acquisition_cost: '700.0000' },
    ];
    let inserted: any[];
    beforeEach(() => {
      inserted = [];
      const batch = (over: object) => ({ tenant_id: 'tenant-123', company_id: 'comp-1', status: 'ACTIVE', tracking_mode: 'ANIMAL_WISE', lob_id: 'lob-pig', stage_id: null, ...over });
      jest
        .spyOn(service as any, 'loadBatch')
        .mockResolvedValueOnce(batch({ batch_id: 'src', batch_no: 'BATCH-000001' }))
        .mockResolvedValueOnce(batch({ batch_id: 'dst', batch_no: 'BATCH-000003', status: 'DRAFT' }));
      jest.spyOn(service, 'listTransferableAnimals').mockResolvedValue(boars as any);
      jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ stage_id: 'st-q', lob_id: 'lob-pig' }]) }) }) // stage line of business
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ current_quantity: '17.0000', nca_book_value: '1927.7698' }]) }) }) }); // source state
      mockDbInsert.mockImplementation(() => ({ values: jest.fn(async (v: any) => { inserted.push(v); }) }));
    });
    const draft = () =>
      service.create({ company_id: 'comp-1', to_batch_id: 'dst', transfer_date: '2026-11-10', animal_ids: ['b-amortised', 'b-valued'], post_immediately: false } as any, 'tenant-123', 'src');

    it('moves a fully amortised animal at 0, not at its purchase price', async () => {
      mockValuesFor.mockResolvedValueOnce(new Map([
        ['b-amortised', { bookValue: 0, hasRows: true }],
        ['b-valued', { bookValue: 352.5, hasRows: true }],
      ]) as any);
      await draft();
      const [header, lines] = inserted;
      expect(lines.map((l: any) => [l.animal_id, l.book_value])).toEqual([['b-amortised', '0.0000'], ['b-valued', '352.5000']]);
      expect(header.transfer_value).toBe('352.5000');
      expect(mockValuesFor).toHaveBeenCalledWith(['b-amortised', 'b-valued']);
    });

    it('takes the ledger book value over the register cache', async () => {
      mockValuesFor.mockResolvedValueOnce(new Map([
        ['b-amortised', { bookValue: 12.75, hasRows: true }],
        ['b-valued', { bookValue: 340, hasRows: true }],
      ]) as any);
      await draft();
      expect(inserted[1].map((l: any) => l.book_value)).toEqual(['12.7500', '340.0000']);
    });
  });

  describe('reversing a posted transfer (D7)', () => {
    const posted = (over: object = {}) => ({
      transfer_id: 'tr-1',
      transfer_no: 'BTR-2026-0001',
      status: 'POSTED',
      transfer_basis: 'ANIMALS',
      company_id: 'comp-1',
      from_batch_id: 'src',
      to_batch_id: 'dst',
      transfer_date: '2026-10-01',
      reason: 'x',
      head_count: '2.0000',
      lines: [{ animal_id: 'a-1' }, { animal_id: 'a-2' }],
      ...over,
    });
    const noPriorReversal = () =>
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
        }),
      });

    it('moves the same animals straight back as a transfer of its own, naming what it undoes', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(
        posted({ lines: [{ animal_id: 'a-1', from_location_id: 'pen-g1' }, { animal_id: 'a-2', from_location_id: 'pen-f4' }] }) as any,
      );
      noPriorReversal();
      // Where each animal stood before the transfer, from its movement log: a-1 was in Gestation, a-2 in Flush.
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { animal_id: 'a-1', from_stage_id: 'st-gest' },
            { animal_id: 'a-2', from_stage_id: 'st-flush' },
          ]),
        }),
      });
      const create = jest
        .spyOn(service, 'create')
        .mockResolvedValue({ transfer_no: 'BTR-2026-0002' } as any);

      await service.reverse(
        'tr-1',
        { transfer_date: '2026-10-02' },
        'tenant-123',
        { userId: 'u' },
      );

      const [dto, , fromBatch, , options] = create.mock.calls[0] as [
        any,
        any,
        any,
        any,
        any,
      ];
      expect(fromBatch).toBe('dst');
      expect(dto).toMatchObject({
        to_batch_id: 'src',
        transfer_date: '2026-10-02',
        animal_ids: ['a-1', 'a-2'],
        reason: 'REVERSAL OF BTR-2026-0001',
      });
      // Each goes back to her own stage, not to one the transfer may have named — passed beside the request, never in it.
      expect(dto.return_stages).toBeUndefined();
      // ...and to the pen she left from (10 Nov 2026: a reversed boar used to stay in the new pen).
      expect(options).toEqual({
        returnStages: { 'a-1': 'st-gest', 'a-2': 'st-flush' },
        returnLocations: { 'a-1': 'pen-g1', 'a-2': 'pen-f4' },
      });
    });

    it('moves the same head back for a head-count transfer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(
        posted({
          transfer_basis: 'HEADCOUNT',
          head_count: '40.0000',
          transfer_value: '84000.0000',
          lines: [],
        }) as any,
      );
      noPriorReversal();
      const create = jest.spyOn(service, 'create').mockResolvedValue({} as any);

      await service.reverse('tr-1', {}, 'tenant-123');

      const [dto, , , , options] = create.mock.calls[0] as [
        any,
        any,
        any,
        any,
        any,
      ];
      expect(dto.quantity).toBe(40);
      expect(dto.animal_ids).toBeUndefined();
      // The same value goes back as the transfer moved — not the destination's average carrying value now.
      expect(options.value).toBe(84000);
    });

    it('refuses a draft (it is cancelled, not reversed)', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(posted({ status: 'DRAFT' }) as any);
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow(
        'Only a POSTED transfer can be reversed',
      );
    });

    it('refuses to reverse a reversal', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(
          posted({ reason: 'REVERSAL OF BTR-2026-0000' }) as any,
        );
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow(
        'cannot itself be reversed',
      );
    });

    it('refuses a second reversal of the same transfer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(posted() as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockResolvedValue([{ transfer_no: 'BTR-2026-0002' }]),
          }),
        }),
      });
      const create = jest.spyOn(service, 'create');
      await expect(service.reverse('tr-1', {}, 'tenant-123')).rejects.toThrow(
        'already reversed by BTR-2026-0002',
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a date before the transfer or in the future', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(posted() as any);
      noPriorReversal();
      await expect(
        service.reverse('tr-1', { transfer_date: '2026-09-01' }, 'tenant-123'),
      ).rejects.toThrow('before the transfer it undoes');
      noPriorReversal();
      await expect(
        service.reverse('tr-1', { transfer_date: '2999-01-01' }, 'tenant-123'),
      ).rejects.toThrow('in the future');
    });
  });

  describe('head-count transfer between batch-wise batches', () => {
    const batchWise = (over: object = {}) => ({
      batch_id: 'b-a',
      batch_no: 'WEAN-A',
      tenant_id: 'tenant-123',
      company_id: 'comp-1',
      status: 'ACTIVE',
      tracking_mode: 'BATCH_WISE',
      costing_method: 'BIO_ASSET',
      lob_id: 'lob-1',
      nob_id: 'nob-1',
      closing_quantity: '100.0000',
      opening_quantity: '100.0000',
      stage_id: 'st-1',
      current_stage_code: 'WEANER',
      ...over,
    });
    const fromTo = (source: object, destination: object) =>
      jest
        .spyOn(service as any, 'loadBatch')
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(destination);
    const dto = (over: object = {}) =>
      ({
        company_id: 'comp-1',
        to_batch_id: 'b-b',
        transfer_date: '2026-10-01',
        quantity: 40,
        ...over,
      }) as any;

    it('refuses a head count out of an animal-wise batch', async () => {
      fromTo(
        batchWise({ tracking_mode: 'ANIMAL_WISE' }),
        batchWise({ batch_id: 'b-b' }),
      );
      await expect(service.create(dto(), 'tenant-123', 'b-a')).rejects.toThrow(
        'batch-wise batches only',
      );
    });

    it('refuses cost-accumulated batches, whose accumulated cost would also have to move', async () => {
      fromTo(
        batchWise({ costing_method: 'STANDARD' }),
        batchWise({ batch_id: 'b-b' }),
      );
      await expect(service.create(dto(), 'tenant-123', 'b-a')).rejects.toThrow(
        'Only bio-asset batches',
      );
    });

    it('refuses more head than the batch holds', async () => {
      fromTo(batchWise(), batchWise({ batch_id: 'b-b' }));
      jest
        .spyOn(service as any, 'headOnHand')
        .mockResolvedValue({ quantity: 30, value: 3000, perHead: 100 });
      await expect(
        service.create(dto({ quantity: 40 }), 'tenant-123', 'b-a'),
      ).rejects.toThrow('has 30 head; 40 cannot be moved');
    });

    it('moves the average carrying value of the head with them, and posts nothing per animal', async () => {
      fromTo(batchWise(), batchWise({ batch_id: 'b-b' }));
      jest
        .spyOn(service as any, 'headOnHand')
        .mockResolvedValue({ quantity: 100, value: 25000, perHead: 250 });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn((v: any) => {
          inserted.push(v);
          return Promise.resolve({});
        }),
      });
      const post = jest
        .spyOn(service, 'post')
        .mockResolvedValue({ status: 'POSTED' } as any);

      await service.create(dto({ quantity: 40 }), 'tenant-123', 'b-a');

      expect(inserted[0]).toMatchObject({
        transfer_basis: 'HEADCOUNT',
        transfer_type: 'PARTIAL',
        head_count: '40.0000',
        transfer_value: '10000.0000',
      });
      expect(inserted.some((v) => Array.isArray(v))).toBe(false); // no transfer lines
      expect(post).toHaveBeenCalled();
    });

    // A draft head-count transfer of 40 head worth 10,000 from WEAN-A (b-a) to WEAN-B (b-b), posted. accounts: the account each
    // batch's carrying value sits in (carryingAccount, herd-account.ts).
    const postHeadcount = async (
      accounts: Record<string, string | undefined> = { 'b-a': 'acct-herd', 'b-b': 'acct-herd' },
    ) => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce({
          transfer_id: 'tr-h',
          transfer_no: 'BTR-9',
          status: 'DRAFT',
          transfer_basis: 'HEADCOUNT',
          company_id: 'comp-1',
          from_batch_id: 'b-a',
          to_batch_id: 'b-b',
          head_count: '40.0000',
          transfer_value: '10000.0000',
          transfer_date: '2026-10-01',
          lines: [],
        } as any)
        .mockResolvedValueOnce({ status: 'POSTED' } as any);
      const forUpdate = (row: object) => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest
              .fn()
              .mockReturnValue({ for: jest.fn().mockResolvedValue([row]) }),
          }),
        }),
      });
      const limited = (rows: object[]) => ({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }),
        }),
      });
      mockDbSelect
        .mockReturnValueOnce(forUpdate(batchWise()))
        .mockReturnValueOnce(
          forUpdate(batchWise({ batch_id: 'b-b', batch_no: 'WEAN-B' })),
        )
        .mockReturnValueOnce(limited([{ item_id: 'herd-item' }])) // source herd item
        .mockReturnValueOnce(limited([{ item_id: 'herd-item' }])); // destination herd item
      jest
        .spyOn(service as any, 'headOnHand')
        .mockResolvedValue({ quantity: 100, value: 25000, perHead: 250 });
      const shiftValue = jest
        .spyOn(service as any, 'shiftBioAssetState')
        .mockResolvedValue(undefined);
      const shiftQty = jest
        .spyOn(service as any, 'shiftClosingQuantity')
        .mockResolvedValue(undefined);
      const recount = jest
        .spyOn(service as any, 'syncBatchWiseCount')
        .mockResolvedValue(undefined);
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn((v: any) => {
          inserted.push(v);
          return Promise.resolve({});
        }),
      });
      const sets: any[] = [];
      mockDbUpdate.mockImplementation(() => ({
        set: jest.fn((v: any) => {
          sets.push(v);
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      }));
      jest
        .spyOn(service as any, 'carryingAccount')
        .mockImplementation(async (batch: any) => accounts[batch.batch_id]);

      await service.post('tr-h', 'tenant-123', { userId: 'user-1' });
      return { shiftValue, shiftQty, recount, inserted, sets };
    };

    it('posts: shifts head and value, writes both ledger legs, recounts the schedulers, marks it POSTED', async () => {
      const { shiftValue, shiftQty, recount, inserted, sets } =
        await postHeadcount();

      expect(shiftValue).toHaveBeenCalledWith('b-a', -40, -10000);
      expect(shiftValue).toHaveBeenCalledWith('b-b', 40, 10000);
      expect(shiftQty).toHaveBeenCalledWith('b-a', -40);
      expect(shiftQty).toHaveBeenCalledWith('b-b', 40);
      const legs = inserted.find((v) => Array.isArray(v)) ?? [];
      expect(
        legs.map((l: any) => [
          l.entry_type,
          l.transaction_type,
          l.quantity,
          l.cost_amount,
        ]),
      ).toEqual([
        ['TRANSFER', 'TRANSFER_SHIPMENT', '-40.0000', '-10000.0000'],
        ['TRANSFER', 'TRANSFER_RECEIPT', '40.0000', '10000.0000'],
      ]);
      expect(legs.every((l: any) => l.animal_id === undefined)).toBe(true);
      expect(recount).toHaveBeenCalledWith('b-a');
      expect(recount).toHaveBeenCalledWith('b-b');
      expect(sets.find((v) => v.status === 'POSTED')).toBeDefined();
      // Both herds in one account: a reclassification with nothing to post.
      expect(mockGl.postAccountTransfer).not.toHaveBeenCalled();
    });

    it("moves the value between the accounts when the herds are carried in different ones (a piglet lot weaned into a weaner batch)", async () => {
      await postHeadcount({ 'b-a': 'acct-weaners', 'b-b': 'acct-premature' });
      expect(mockGl.postAccountTransfer).toHaveBeenCalledTimes(1);
      expect(mockGl.postAccountTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-123',
          companyId: 'comp-1',
          postingDate: '2026-10-01',
          sourceDocumentType: 'BATCH_TRANSFER',
          documentNo: 'BTR-9',
          debitAccountId: 'acct-premature',
          creditAccountId: 'acct-weaners',
          amount: 10000,
          userId: 'user-1',
        }),
      );
    });

    it('posts nothing where either herd has no one account (a mature herd)', async () => {
      await postHeadcount({ 'b-a': 'acct-weaners', 'b-b': undefined });
      expect(mockGl.postAccountTransfer).not.toHaveBeenCalled();
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
      jest
        .spyOn(service as any, 'sweepIfEmptied')
        .mockImplementation(async (_t, total) => total);

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
            where: jest
              .fn()
              .mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockResolvedValue([
                {
                  animal_id: 'a-1',
                  current_stage_id: 'stage-gest',
                  current_location_id: 'loc-1',
                },
                {
                  animal_id: 'a-2',
                  current_stage_id: 'stage-gest',
                  current_location_id: 'loc-1',
                },
              ]),
            }),
          }),
        });
    const isolateValueSideEffects = () => {
      jest
        .spyOn(service as any, 'shiftBioAssetState')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'shiftClosingQuantity')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'writeLedgerLegs')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'sweepIfEmptied')
        .mockImplementation(async (_t, total) => total);
      mockDbUpdate.mockReturnValue({
        set: jest
          .fn()
          .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
      });
    };

    it("keeps each animal's own stage when the destination is an animal-wise batch", async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({
        stage_id: 'stage-quarantine',
        tracking_mode: 'ANIMAL_WISE',
      });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock)
        .mock.calls[0][0];
      expect(animalSet.current_batch_id).toBe('batch-farrow');
      expect(animalSet).not.toHaveProperty('current_stage_id');
      const movement = module.get(AnimalMovementLogService).record as jest.Mock;
      expect(movement.mock.calls[0][0]).toMatchObject({
        fromStageId: 'stage-gest',
        toStageId: 'stage-gest',
      });
    });

    it('puts the animals in the stage the caller names, even in an animal-wise batch', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({
        stage_id: 'stage-quarantine',
        tracking_mode: 'ANIMAL_WISE',
      });

      await service.post(
        'tr-1',
        'tenant-123',
        { userId: 'user-1' },
        undefined,
        undefined,
        'stage-farrowing',
      );

      const animalSet = (mockDbUpdate.mock.results[0].value.set as jest.Mock)
        .mock.calls[0][0];
      expect(animalSet.current_stage_id).toBe('stage-farrowing');
    });

    it("recounts both batches' stage headcounts once the animals have moved", async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(draftTransfer as any)
        .mockResolvedValueOnce({ ...draftTransfer, status: 'POSTED' } as any);
      isolateValueSideEffects();
      destinationRows({
        stage_id: 'stage-farrowing',
        tracking_mode: 'ANIMAL_WISE',
      });

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      const sync = module.get(SchedulerHeaderService)
        .syncAnimalWiseCounts as jest.Mock;
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

  describe('a transfer that empties its source takes all of its carrying value', () => {
    const rows = (r: object[]) => ({
      from: jest.fn().mockReturnValue({
        where: jest
          .fn()
          .mockReturnValue({ limit: jest.fn().mockResolvedValue(r) }),
      }),
    });
    const transfer = () => ({
      ...draftTransfer,
      transfer_id: 'tr-1',
      lines: [
        { line_id: 'l-1', animal_id: 'a-1', book_value: '300.0000' },
        { line_id: 'l-2', animal_id: 'a-2', book_value: '300.0000' },
      ],
    });
    let sets: Array<Record<string, unknown>>;
    beforeEach(() => {
      sets = [];
      mockDbUpdate.mockReturnValue({
        set: jest.fn(
          (v) => (sets.push(v), { where: jest.fn().mockResolvedValue({}) }),
        ),
      });
    });

    it('spreads what the batch capitalised over the lines, rewriting them and the transfer', async () => {
      mockDbSelect
        .mockReturnValueOnce(
          rows([{ current_quantity: '2.0000', nca_book_value: '659.3912' }]),
        ) // source state
        .mockReturnValueOnce(rows([])); // no live animal left in the source
      const t = transfer();

      const total = await (service as any).sweepIfEmptied(t, 600);

      expect(total).toBe(659.3912);
      expect(t.lines.map((l) => l.book_value)).toEqual([
        '329.6956',
        '329.6956',
      ]);
      expect(sets).toEqual([
        { book_value: '329.6956' },
        { book_value: '329.6956' },
        { transfer_value: '659.3912' },
      ]);
    });

    it('never moves the animals at less than their own values when the batch holds less', async () => {
      mockDbSelect
        .mockReturnValueOnce(
          rows([{ current_quantity: '1.0000', nca_book_value: '100.0000' }]),
        )
        .mockReturnValueOnce(rows([]));

      expect(await (service as any).sweepIfEmptied(transfer(), 600)).toBe(600);
      expect(sets).toHaveLength(0);
    });

    it('leaves a partial transfer at the animals’ own values', async () => {
      mockDbSelect
        .mockReturnValueOnce(
          rows([{ current_quantity: '9.0000', nca_book_value: '3000.0000' }]),
        )
        .mockReturnValueOnce(rows([{ animal_id: 'a-9' }])); // an animal is still in the source

      expect(await (service as any).sweepIfEmptied(transfer(), 600)).toBe(600);
      expect(sets).toHaveLength(0);
    });

    it('splits a total over the lines by their values, the last taking the rounding', () => {
      expect(spreadToTotal([100, 200], 400)).toEqual({
        values: [133.3333, 266.6667],
        total: 400,
      });
      expect(spreadToTotal([0, 0, 0], 10)).toEqual({
        values: [3.3333, 3.3333, 3.3334],
        total: 10,
      });
    });
  });
});

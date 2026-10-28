import { BatchService } from './batch.service';
import * as schema from '../../../core/database/schema';

/**
 * One registered animal leaving or joining a batch outside a transfer: the batch's head, its bio-asset head and
 * value, and — for a sale or cull — the journal. Each read is queued in order; a read resolves to its rows
 * whether it ends at where(), limit() or for().
 */
describe('BatchService — one animal leaving or joining a batch', () => {
  const reads: unknown[][] = [];
  const read = () => {
    const rows = reads.shift() ?? [];
    const chain: any = {};
    for (const k of ['from', 'where', 'limit', 'orderBy'])
      chain[k] = () => chain;
    chain.for = () => Promise.resolve(rows);
    chain.then = (ok: any, ko: any) => Promise.resolve(rows).then(ok, ko);
    return chain;
  };
  let updates: Array<{ table: unknown; set: Record<string, unknown> }>;
  let inserts: Array<{ table: unknown; values: Record<string, unknown> }>;
  let postBatchCostEntry: jest.Mock;
  let record: jest.Mock;
  let service: BatchService;

  beforeEach(() => {
    reads.length = 0;
    updates = [];
    inserts = [];
    postBatchCostEntry = jest.fn().mockResolvedValue({});
    record = jest.fn().mockResolvedValue('m-1');
    const db = {
      select: jest.fn(() => read()),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return { where: () => Promise.resolve({}) };
        },
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table, values });
          return Promise.resolve({});
        },
      })),
    };
    service = new BatchService(
      { get: () => db } as any,
      { log: jest.fn() } as any,
      {} as any,
      { postBatchCostEntry } as any,
      {} as any,
      { syncAnimalWiseCounts: jest.fn().mockResolvedValue(undefined) } as any,
      { record } as any,
      {} as any,
      {} as any,
    );
  });

  const sow = {
    animal_id: 'a-1',
    company_id: 'c-1',
    current_batch_id: 'b-1',
    current_stage_id: 's-1',
    current_location_id: 'l-1',
    book_value: '300.0000',
  };
  const batch = {
    batch_id: 'b-1',
    batch_no: 'BATCH-000140',
    status: 'ACTIVE',
    costing_method: 'BIO_ASSET',
    stage_id: 'st-g',
  };
  const stateSet = () =>
    updates.find((u) => u.table === schema.batchBioAssetState)!.set;

  describe('recordAnimalExit', () => {
    it('takes her own book value out of the batch while other animals remain', async () => {
      reads.push(
        [batch],
        [{ current_quantity: '8.0000', nca_book_value: '2765.2000' }],
        [{ animal_id: 'a-2' }],
      );

      const exit = await service.recordAnimalExit(
        sow,
        'SOLD',
        '2026-10-17',
        't-1',
      );

      expect(exit.valueRelieved).toBe(300);
      expect(stateSet().nca_book_value).toBe('2465.2000');
    });

    it('takes everything the batch still carries when she is its last live animal', async () => {
      reads.push(
        [batch],
        [{ current_quantity: '1.0000', nca_book_value: '425.2000' }],
        [],
      );

      const exit = await service.recordAnimalExit(
        sow,
        'CULLED',
        '2026-10-17',
        't-1',
      );

      expect(exit.valueRelieved).toBe(425.2);
      expect(stateSet().nca_book_value).toBe('0.0000');
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ movementType: 'CULL', fromBatchId: 'b-1' }),
      );
    });

    it('leaves at her own value even when the batch holds less, and the batch stops at nil', async () => {
      reads.push(
        [batch],
        [{ current_quantity: '1.0000', nca_book_value: '100.0000' }],
        [],
      );

      const exit = await service.recordAnimalExit(
        sow,
        'SOLD',
        '2026-10-17',
        't-1',
      );

      expect(exit.valueRelieved).toBe(300);
      expect(stateSet().nca_book_value).toBe('0.0000');
    });

    it('relieves the batch average when she has no book value of her own', async () => {
      reads.push(
        [batch],
        [{ current_quantity: '4.0000', nca_book_value: '1000.0000' }],
        [{ animal_id: 'a-2' }],
      );

      const exit = await service.recordAnimalExit(
        { ...sow, book_value: null },
        'SOLD',
        '2026-10-17',
        't-1',
      );

      expect(exit.valueRelieved).toBe(250);
    });

    it('relieves nothing from a batch that is not ACTIVE, leaving the caller her own value', async () => {
      reads.push([{ ...batch, status: 'CLOSED' }]);

      const exit = await service.recordAnimalExit(
        sow,
        'SOLD',
        '2026-10-17',
        't-1',
      );

      expect(exit).toEqual({ valueRelieved: null, batch: null });
      expect(updates).toHaveLength(0);
    });
  });

  describe('recordAnimalEntry', () => {
    it('raises the closing quantity, the bio-asset head and value, and logs the assignment', async () => {
      reads.push([batch], [{ state_id: 'st-1' }]);

      const joined = await service.recordAnimalEntry(sow, '2026-10-18', 't-1');

      expect(joined).toBe(batch);
      expect(updates.map((u) => u.table)).toEqual([
        schema.batchHeader,
        schema.batchBioAssetState,
      ]);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ movementType: 'ASSIGN', toBatchId: 'b-1' }),
      );
    });

    it('creates the state row when the batch has none yet', async () => {
      reads.push([batch], []);

      await service.recordAnimalEntry(sow, '2026-10-18', 't-1');

      expect(inserts[0]).toEqual({
        table: schema.batchBioAssetState,
        values: expect.objectContaining({
          batch_id: 'b-1',
          current_quantity: '1.0000',
          nca_book_value: '300.0000',
        }),
      });
    });

    it('leaves a DRAFT batch alone — it counts its animals when it activates', async () => {
      reads.push([{ ...batch, status: 'DRAFT' }]);

      expect(
        await service.recordAnimalEntry(sow, '2026-10-18', 't-1'),
      ).toBeNull();
      expect(updates).toHaveLength(0);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('postAnimalDisposalJournal', () => {
    const base = {
      tenantId: 't-1',
      companyId: 'c-1',
      documentNo: 'PIG-1',
      postingDate: '2026-10-17',
      label: 'Sale',
    };

    it('posts the proceeds and the gain over book value, as the batch-level sale does', async () => {
      await service.postAnimalDisposalJournal({
        ...base,
        bookValue: 300,
        proceeds: 450,
      });

      expect(postBatchCostEntry).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          transactionType: 'BIO_SALE_PROCEEDS',
          amount: 450,
        }),
      );
      expect(postBatchCostEntry).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          transactionType: 'BIO_DISPOSAL_SOLD',
          amount: 150,
          reverseDirection: false,
        }),
      );
    });

    it('posts a loss the other way round', async () => {
      await service.postAnimalDisposalJournal({
        ...base,
        bookValue: 300,
        proceeds: 200,
      });

      expect(postBatchCostEntry).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          transactionType: 'BIO_DISPOSAL_SOLD',
          amount: 100,
          reverseDirection: true,
        }),
      );
    });

    it('writes off the whole book value of a cull with no proceeds', async () => {
      await service.postAnimalDisposalJournal({
        ...base,
        label: 'Cull',
        bookValue: 300,
        proceeds: 0,
      });

      expect(postBatchCostEntry).toHaveBeenCalledTimes(1);
      expect(postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_DISPOSAL_SOLD',
          amount: 300,
          reverseDirection: true,
        }),
      );
    });
  });
});

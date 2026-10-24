import { animalsInBatchOn } from './animal-membership';
import { entryBlockedReason } from './entry-blocked';

jest.mock('./animal-membership', () => ({ animalsInBatchOn: jest.fn() }));

const chain = (rows: unknown[]) => {
  const c: any = {};
  for (const m of ['from', 'where']) c[m] = jest.fn(() => c);
  c.limit = jest.fn().mockResolvedValue(rows);
  c.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, fail);
  return c;
};

describe('entryBlockedReason (Rishi, 19 Oct)', () => {
  it('blocks an animal-wise batch with no live animal in it', async () => {
    const db: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(
          chain([{ batch_no: 'B-1', tracking_mode: 'ANIMAL_WISE' }]),
        )
        .mockReturnValueOnce(chain([{ live: 0 }])),
    };
    await expect(entryBlockedReason(db, 'b-1')).resolves.toBe(
      "Batch 'B-1' has no animals in it, so it takes no data entry.",
    );
  });

  it('lets an animal-wise batch with live animals take entries', async () => {
    const db: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(
          chain([{ batch_no: 'B-1', tracking_mode: 'ANIMAL_WISE' }]),
        )
        .mockReturnValueOnce(chain([{ live: 3 }])),
    };
    await expect(entryBlockedReason(db, 'b-1')).resolves.toBeNull();
  });

  it('blocks a batch-wise batch whose head count is nil, and not one with head', async () => {
    const db: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(
          chain([
            {
              batch_no: 'L-1',
              tracking_mode: 'BATCH_WISE',
              closing_quantity: '0.0000',
              opening_quantity: '12.0000',
            },
          ]),
        )
        .mockReturnValueOnce(
          chain([
            {
              batch_no: 'L-2',
              tracking_mode: 'BATCH_WISE',
              closing_quantity: null,
              opening_quantity: '12.0000',
            },
          ]),
        ),
    };
    await expect(entryBlockedReason(db, 'l-1')).resolves.toBe(
      "Batch 'L-1' has a head count of 0, so it takes no data entry.",
    );
    await expect(entryBlockedReason(db, 'l-2')).resolves.toBeNull();
  });

  describe('for a date (21 Oct)', () => {
    const batchRow = [{ batch_no: 'B-1', tracking_mode: 'ANIMAL_WISE' }];

    it('lets an emptied batch take an entry for a past day it had animals', async () => {
      (animalsInBatchOn as jest.Mock).mockResolvedValueOnce([
        { animal_id: 'a', stage_id: 's' },
      ]);
      const db: any = {
        select: jest.fn().mockReturnValueOnce(chain(batchRow)),
      };
      await expect(
        entryBlockedReason(db, 'b-1', '2020-01-02'),
      ).resolves.toBeNull();
      expect(animalsInBatchOn).toHaveBeenCalledWith(db, 'b-1', '2020-01-02');
    });

    it('blocks a past day the batch had no animal, even though it has animals now', async () => {
      (animalsInBatchOn as jest.Mock).mockResolvedValueOnce([]);
      const db: any = {
        select: jest.fn().mockReturnValueOnce(chain(batchRow)),
      };
      await expect(entryBlockedReason(db, 'b-1', '2020-01-02')).resolves.toBe(
        "Batch 'B-1' had no animals in it on 2020-01-02, so it takes no data entry for that day.",
      );
    });

    it('judges today, and a batch-wise batch, as it stands', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const db: any = {
        select: jest
          .fn()
          .mockReturnValueOnce(chain(batchRow))
          .mockReturnValueOnce(chain([{ live: 0 }])),
      };
      await expect(entryBlockedReason(db, 'b-1', today)).resolves.toBe(
        "Batch 'B-1' has no animals in it, so it takes no data entry.",
      );
      const wise: any = {
        select: jest.fn().mockReturnValueOnce(
          chain([
            {
              batch_no: 'L-1',
              tracking_mode: 'BATCH_WISE',
              closing_quantity: '5',
              opening_quantity: '5',
            },
          ]),
        ),
      };
      await expect(
        entryBlockedReason(wise, 'l-1', '2020-01-02'),
      ).resolves.toBeNull();
    });
  });
});

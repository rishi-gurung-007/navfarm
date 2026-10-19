import { entryBlockedReason } from './entry-blocked';

const chain = (rows: unknown[]) => {
  const c: any = {};
  for (const m of ['from', 'where']) c[m] = jest.fn(() => c);
  c.limit = jest.fn().mockResolvedValue(rows);
  c.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, fail);
  return c;
};

describe('entryBlockedReason (Rishi, 19 Oct)', () => {
  it('blocks an animal-wise batch with no live animal in it', async () => {
    const db: any = { select: jest.fn().mockReturnValueOnce(chain([{ batch_no: 'B-1', tracking_mode: 'ANIMAL_WISE' }])).mockReturnValueOnce(chain([{ live: 0 }])) };
    await expect(entryBlockedReason(db, 'b-1')).resolves.toBe("Batch 'B-1' has no animals in it, so it takes no data entry.");
  });

  it('lets an animal-wise batch with live animals take entries', async () => {
    const db: any = { select: jest.fn().mockReturnValueOnce(chain([{ batch_no: 'B-1', tracking_mode: 'ANIMAL_WISE' }])).mockReturnValueOnce(chain([{ live: 3 }])) };
    await expect(entryBlockedReason(db, 'b-1')).resolves.toBeNull();
  });

  it('blocks a batch-wise batch whose head count is nil, and not one with head', async () => {
    const db: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(chain([{ batch_no: 'L-1', tracking_mode: 'BATCH_WISE', closing_quantity: '0.0000', opening_quantity: '12.0000' }]))
        .mockReturnValueOnce(chain([{ batch_no: 'L-2', tracking_mode: 'BATCH_WISE', closing_quantity: null, opening_quantity: '12.0000' }])),
    };
    await expect(entryBlockedReason(db, 'l-1')).resolves.toBe("Batch 'L-1' has a head count of 0, so it takes no data entry.");
    await expect(entryBlockedReason(db, 'l-2')).resolves.toBeNull();
  });
});

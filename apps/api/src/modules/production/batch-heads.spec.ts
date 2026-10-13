import { headsAt, headsAtStartOfDate, loadBatchDeaths } from './batch-heads';

/** Queue-answered db: the first select is the batch_transaction rows, the second the posted daily-data rows. */
function fakeDb(answers: unknown[][]) {
  return {
    select: () => {
      const rows = answers.shift() ?? [];
      const c: any = { from: () => c, innerJoin: () => c, where: () => c, then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej) };
      return c;
    },
  } as any;
}

describe('batch heads', () => {
  const posted = [
    { batchId: 'b1', date: '2026-10-01', quantity: '2.000000' },
    { batchId: 'b1', date: '2026-10-03', quantity: '3.000000' },
  ];

  it('opening 500, posted deaths 2 on day 1 and 3 on day 3 -> 495 at the start of day 4', async () => {
    expect(await headsAtStartOfDate(fakeDb([[], posted]), 'b1', '500.0000', '2026-10-04')).toBe(495);
  });

  it('a death on the date itself is not yet counted at the start of that date', async () => {
    expect(await headsAtStartOfDate(fakeDb([[], posted]), 'b1', 500, '2026-10-03')).toBe(498);
  });

  it('batch_transaction MORTALITY is subtracted too, on top of the posted entries', async () => {
    const tx = [{ batchId: 'b1', date: '2026-10-02', quantity: '4.0000' }];
    expect(await headsAtStartOfDate(fakeDb([tx, posted]), 'b1', 500, '2026-10-04')).toBe(491);
  });

  it('unposted entries are left out by the query (posted = true), and an empty source changes nothing', async () => {
    // the db only ever returns posted rows; with none returned the heads are the opening quantity
    expect(await headsAtStartOfDate(fakeDb([[], []]), 'b1', 500, '2026-10-04')).toBe(500);
  });

  it('the forecast basis is inclusive of the entry date and never goes below zero', () => {
    const deaths = [{ date: '2026-10-03', quantity: 3 }, { date: '2026-10-05', quantity: 10 }];
    expect(headsAt(500, deaths, '2026-10-03', true)).toBe(497);
    expect(headsAt(5, deaths, '2026-10-05', true)).toBe(0);
  });

  it('loadBatchDeaths groups per batch and skips the query for no batches', async () => {
    const db = fakeDb([[{ batchId: 'b2', date: '2026-10-02', quantity: '1' }], posted]);
    const ledger = await loadBatchDeaths(db, ['b1', 'b2']);
    expect(ledger.get('b1')).toHaveLength(2);
    expect(ledger.get('b2')).toEqual([{ date: '2026-10-02', quantity: 1 }]);
    expect((await loadBatchDeaths({ select: () => { throw new Error('no query'); } } as any, [])).size).toBe(0);
  });

  // 13 Oct (system-schedulers merge): Data Entry posts each death as a transaction too; it must count once.
  it('a posted entry whose deaths became transactions counts once; an older entry without one still counts', async () => {
    const tx = [
      { batchId: 'b1', date: '2026-10-03', quantity: '1.0000', remarks: 'Mortality — scheduled entry. Dead weight 12 kg', reversedAt: null },
      { batchId: 'b1', date: '2026-10-03', quantity: '1.0000', remarks: 'Mortality — scheduled entry', reversedAt: null },
    ];
    // 3 Oct: 2 entered, 2 transactions -> 2. 1 Oct: 2 entered, no transaction (before the merge) -> 2.
    expect(await headsAtStartOfDate(fakeDb([tx, posted]), 'b1', 500, '2026-10-04')).toBe(495);
  });

  it('a reversed death no longer counts, and its entry is not counted in its place', async () => {
    const tx = [{ batchId: 'b1', date: '2026-10-03', quantity: '3.0000', remarks: 'Mortality — scheduled entry', reversedAt: '2026-10-04 09:00:00' }];
    expect(await headsAtStartOfDate(fakeDb([tx, posted]), 'b1', 500, '2026-10-04')).toBe(498);
  });
});


import {
  fetchAllPages,
  batchHead,
  activeBatches,
  biologicalCensus,
  activeBatchValuation,
} from './dashboard-counts';

describe('dashboard counts', () => {
  it('batchHead: closing 0 counts as 0, opening only when closing is null', () => {
    expect(batchHead({ closing_quantity: 0, opening_quantity: 50 })).toBe(0);
    expect(
      batchHead({ closing_quantity: '0.000', opening_quantity: '50' }),
    ).toBe(0);
    expect(batchHead({ closing_quantity: null, opening_quantity: 50 })).toBe(
      50,
    );
    expect(batchHead({ opening_quantity: '12' })).toBe(12);
    expect(batchHead({ closing_quantity: 7, opening_quantity: 50 })).toBe(7);
  });

  it('In Progress counts only ACTIVE batches', () => {
    const batches = [
      { status: 'ACTIVE' },
      { status: 'CLOSED' },
      { status: 'DRAFT' },
      {},
    ];
    expect(activeBatches(batches)).toHaveLength(1);
  });

  it('census = live animals + ACTIVE batch-wise head; closed batches add nothing', () => {
    const batches = [
      {
        status: 'ACTIVE',
        tracking_mode: 'BATCH_WISE',
        closing_quantity: 30,
        opening_quantity: 40,
      },
      {
        status: 'ACTIVE',
        tracking_mode: 'BATCH_WISE',
        closing_quantity: null,
        opening_quantity: 10,
      },
      {
        status: 'ACTIVE',
        tracking_mode: 'ANIMAL_WISE',
        closing_quantity: 5,
        opening_quantity: 5,
      },
      {
        status: 'CLOSED',
        tracking_mode: 'BATCH_WISE',
        closing_quantity: 0,
        opening_quantity: 900,
      },
    ];
    expect(biologicalCensus(batches, [{}, {}, {}])).toBe(3 + 30 + 10);
  });

  it('valuation covers ACTIVE batches only', () => {
    expect(
      activeBatchValuation([
        { status: 'ACTIVE', wip_value: '100.5' },
        { status: 'CLOSED', wip_value: 999 },
      ]),
    ).toBe(100.5);
  });

  it('fetchAllPages walks past the first page', async () => {
    const all = Array.from({ length: 210 }, (_, i) => ({ i }));
    const fetchPage = jest.fn(async (limit: number, offset: number) =>
      all.slice(offset, offset + limit),
    );
    const rows = await fetchAllPages(fetchPage, 100);
    expect(rows).toHaveLength(210);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('fetchAllPages accepts { data } envelopes', async () => {
    const rows = await fetchAllPages(async () => ({ data: [{ a: 1 }] }), 100);
    expect(rows).toEqual([{ a: 1 }]);
  });
});

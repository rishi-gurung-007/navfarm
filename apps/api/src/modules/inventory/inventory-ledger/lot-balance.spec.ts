import { lotBalances, lotCostLayers, serialsInStock } from './lot-balance';

/** A db that answers each `.select().from().where()[.groupBy()]` read, in order. */
const dbAnswering = (...answers: any[][]) => {
  const queue = [...answers];
  const next = () => queue.shift() ?? [];
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const result = next();
          return Object.assign(Promise.resolve(result), { groupBy: async () => result });
        },
      }),
    }),
  } as any;
};

describe('lot balances', () => {
  const scope = { tenantId: 't', itemId: 'i' };

  it('adds what the entries say to what the ledger lines say', async () => {
    // entries: LOT-A received 20, 6 issued on an entry that names it; lines: 4 more issued from it on a multi-lot entry
    const db = dbAnswering(
      [{ lot_no: 'LOT-A', quantity: '14', expiry_date: '2027-01-01', receipt_date: '2026-10-01' }],
      [{ lot_no: 'LOT-A', quantity: '-4' }, { lot_no: 'LOT-B', quantity: '-3' }],
    );
    const result = await lotBalances(db, scope);
    expect(result.find((r) => r.lot_no === 'LOT-A')).toEqual({ lot_no: 'LOT-A', quantity: 10, expiry_date: '2027-01-01', receipt_date: '2026-10-01' });
    // a lot known only from lines (its receipt is elsewhere) is still reported, as it stands
    expect(result.find((r) => r.lot_no === 'LOT-B')?.quantity).toBe(-3);
  });

  it('is not the receipts\' remaining quantity: a lot can be empty while its receipt still has cost layers left', async () => {
    const db = dbAnswering([{ lot_no: 'LOT-A', quantity: '0', expiry_date: null, receipt_date: '2026-10-01' }], []);
    expect((await lotBalances(db, scope))[0].quantity).toBe(0);
  });
});

describe('serials in stock', () => {
  const scope = { tenantId: 't', itemId: 'i' };
  const entry = (serial_no: string, quantity: string, extra: object = {}) => ({ serial_no, quantity, warehouse_id: 'w1', expiry_date: null, posting_date: '2026-10-01', rate: '10', entry_no: 1, ...extra });

  it('counts a serial in when received and out when issued — on the entry or on a ledger line', async () => {
    const db = dbAnswering(
      [entry('SN1, SN2, SN3', '3'), entry('SN1', '-1')], // received three, SN1 issued on its entry
      [{ serial_no: 'SN2', quantity: '-1', warehouse_id: 'w1' }], // SN2 issued on a line
    );
    expect((await serialsInStock(db, scope)).map((s) => s.serial_no)).toEqual(['SN3']);
  });

  it('a reversal brings the serial back', async () => {
    const db = dbAnswering([entry('SN1', '1'), entry('SN1', '-1'), entry('SN1', '1')], []);
    expect((await serialsInStock(db, scope)).map((s) => s.serial_no)).toEqual(['SN1']);
  });

  it('matches whole serials only', async () => {
    const db = dbAnswering([entry('SN10', '1'), entry('SN1', '-1')], []);
    // SN1 was never received, so issuing it is a deficit of its own; SN10 is untouched and in stock
    expect((await serialsInStock(db, scope)).map((s) => s.serial_no)).toEqual(['SN10']);
  });
});

describe('lotCostLayers — a lot drawn at its own cost (D3)', () => {
  const layer = (id: string, lot: string | null, remaining: number) => ({ id, lot_no: lot, remaining_quantity: String(remaining) });
  const layers = [layer('older', 'LOT-00053', 51), layer('other', 'LOT-00054', 12), layer('own', 'LOT-00057', 4)];

  it('draws only the receipts that carry the lot, when they hold the quantity', () => {
    expect(lotCostLayers(layers, 'LOT-00057', 4).map((l) => l.id)).toEqual(['own']);
  });

  it('keeps every receipt of the lot, oldest first (a lot received in twice)', () => {
    const two = [layer('a', 'L1', 2), layer('b', 'L2', 5), layer('c', 'L1', 3)];
    expect(lotCostLayers(two, 'L1', 4).map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('falls back to every layer when the lot\'s receipts were already costed away, the lot\'s own first', () => {
    expect(lotCostLayers([layer('older', 'LOT-00053', 51), layer('own', 'LOT-00057', 0)], 'LOT-00057', 4).map((l) => l.id)).toEqual(['own', 'older']);
  });

  it('draws what the lot\'s receipts still hold before any other lot\'s, when they hold only part of the quantity', () => {
    // 4 wanted, the lot's receipt holds 2: the 2 come from it at the lot's cost, only the other 2 from the older lot's receipt.
    const partly = [layer('older', 'LOT-00053', 51), layer('other', 'LOT-00054', 12), layer('own', 'LOT-00057', 2)];
    expect(lotCostLayers(partly, 'LOT-00057', 4).map((l) => l.id)).toEqual(['own', 'older', 'other']);
  });

  it('is the ordinary order without a lot', () => {
    expect(lotCostLayers(layers, undefined, 4)).toBe(layers);
  });
});

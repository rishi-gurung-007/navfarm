import { lotBalances, serialsInStock } from './lot-balance';

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

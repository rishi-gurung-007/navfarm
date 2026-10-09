import { costingMethodOf, explainCosting, type ExplainDraw } from './costing-explanation';

const draw = (inbound_entry_no: number, quantity: number, amount: number, receipt_rate: number): ExplainDraw => ({
  inbound_entry_no, document_no: `GR-${inbound_entry_no}`, posting_date: '2026-10-05', lot_no: null, receipt_rate, quantity, amount,
});

describe('explainCosting', () => {
  it('FIFO: each receipt at its own rate — 470 @ 20 + 40 @ 30 = 10,600', () => {
    const e = explainCosting({ method: 'FIFO', quantity: 510, totalCost: 10600, standardCost: null, draws: [draw(65, 470, 9400, 20), draw(66, 40, 1200, 30)] });
    expect(e.draws.map((d) => [d.inbound_entry_no, d.unit_cost, d.formula_amount])).toEqual([[65, 20, 9400], [66, 30, 1200]]);
    expect(e.recomputed_cost).toBe(10600);
    expect(e.unit_cost).toBe(20.7843);
    expect(e.matches).toBe(true);
    expect(e.average).toBeNull();
  });

  it('Average: book value over book quantity before the issue, times the quantity', () => {
    // 3 receipts of 500 (₹20, ₹30, ₹40) less an earlier 30 kg issue costed at ₹30.
    const e = explainCosting({
      method: 'AVG', quantity: 510, totalCost: 15300, standardCost: null,
      draws: [draw(64, 470, 14100, 20), draw(69, 40, 1200, 30)],
      book: { receipts: [], receiptsQuantity: 1500, receiptsValue: 45000, issuedQuantity: 30, issuedValue: 900 },
    });
    expect(e.average).toEqual(expect.objectContaining({ book_quantity: 1470, book_value: 44100, average_rate: 30, fallback: false }));
    expect(e.recomputed_cost).toBe(15300);
    expect(e.matches).toBe(true);
  });

  it('Average moves with a later receipt: (28,800 + 5,000) ÷ 1,060', () => {
    const e = explainCosting({
      method: 'AVG', quantity: 10, totalCost: 318.8679, standardCost: null, draws: [draw(1, 10, 318.8679, 20)],
      book: { receipts: [], receiptsQuantity: 1560, receiptsValue: 50000, issuedQuantity: 500, issuedValue: 16200 },
    });
    expect(e.average?.average_rate).toBe(31.8868);
    expect(e.matches).toBe(true);
  });

  it('Average with nothing on the book falls back to each receipt\'s own rate and says so', () => {
    const e = explainCosting({
      method: 'AVG', quantity: 15, totalCost: 350, standardCost: null,
      draws: [draw(1, 10, 200, 20), draw(2, 5, 150, 30)],
      book: { receipts: [], receiptsQuantity: 0, receiptsValue: 0, issuedQuantity: 0, issuedValue: 0 },
    });
    expect(e.average?.fallback).toBe(true);
    expect(e.recomputed_cost).toBe(350);
    expect(e.matches).toBe(true);
  });

  it('Standard: quantity × the standard cost', () => {
    const e = explainCosting({ method: 'STANDARD', quantity: 5, totalCost: 60, standardCost: 12, draws: [draw(1, 5, 60, 20)] });
    expect(e.recomputed_cost).toBe(60);
    expect(e.matches).toBe(true);
  });

  it('flags an entry the item\'s current method would not have priced that way (method changed since)', () => {
    // Posted FIFO (3,250), but the item now reads Average over a 2,250 ÷ 100 book.
    const e = explainCosting({
      method: 'AVG', quantity: 150, totalCost: 3250, standardCost: null, draws: [draw(1, 100, 2000, 20), draw(2, 50, 1250, 25)],
      book: { receipts: [], receiptsQuantity: 200, receiptsValue: 4500, issuedQuantity: 0, issuedValue: 0 },
    });
    expect(e.recomputed_cost).toBe(3375);
    expect(e.matches).toBe(false);
  });
});

describe('costingMethodOf', () => {
  it.each([[null, 'FIFO'], ['FIFO', 'FIFO'], ['BIO_ASSET', 'FIFO'], ['AVG', 'AVG'], ['average', 'AVG'], ['STANDARD', 'STANDARD']])('%s -> %s', (v, expected) => {
    expect(costingMethodOf(v as string | null)).toBe(expected);
  });
});

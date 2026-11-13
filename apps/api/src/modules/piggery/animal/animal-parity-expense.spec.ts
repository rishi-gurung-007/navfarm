import { buildParityExpense, parityWindows, type ExpenseEvent, type ParityFacts } from './animal-parity-expense';

const parity = (n: number, mating: string, weaning: string | null, weaned: number | null = null): ParityFacts => ({
  parity_number: n, mating_date: mating, farrowing_date: null, weaning_date: weaning, piglets_born_live: null, piglets_weaned: weaned,
});
const ev = (date: string, kind: ExpenseEvent['kind'], amount: number): ExpenseEvent => ({ date, kind, amount });

describe('parity windows', () => {
  it('runs a parity from its mating to its weaning, and a running one to the day the figures are read', () => {
    const w = parityWindows([parity(2, '2026-06-01', null), parity(1, '2026-01-10', '2026-04-30')], '2026-07-15');
    expect(w.map((x) => [x.parity_number, x.start, x.end, x.running])).toEqual([
      [1, '2026-01-10', '2026-04-30', false],
      [2, '2026-06-01', '2026-07-15', true],
    ]);
  });

  it('stops a window the day before the next mating, so no day is in two parities', () => {
    const w = parityWindows([parity(1, '2026-01-10', '2026-05-20'), parity(2, '2026-05-10', '2026-09-01')], '2026-10-01');
    expect(w[0].end).toBe('2026-05-09');
  });
});

describe('parity expense', () => {
  const parities = [parity(1, '2026-01-10', '2026-04-30', 10), parity(2, '2026-06-01', null)];

  it('puts each cost in the parity whose window holds its date, and the rest on the outside row', () => {
    const r = buildParityExpense({
      parities, costingStartDate: null, asOf: '2026-07-01',
      events: [ev('2026-01-09', 'FEED', 5), ev('2026-02-01', 'FEED', 10), ev('2026-03-01', 'OVERHEAD', 4), ev('2026-05-15', 'FEED', 7), ev('2026-06-02', 'OTHER_CONSUMPTION', 3)],
    });
    expect(r.rows.map((x) => [x.row_type, x.parity_number, x.total])).toEqual([['PARITY', 1, 14], ['PARITY', 2, 3], ['OUTSIDE', null, 12]]);
    expect(r.total.total).toBe(29);
  });

  it('adds the rows up to the whole cost, whatever the windows', () => {
    const r = buildParityExpense({
      parities, costingStartDate: '2026-03-01', asOf: '2026-07-01',
      events: [ev('2026-01-01', 'FEED', 1.1111), ev('2026-02-02', 'FEED', 2.2222), ev('2026-05-05', 'AMORTISATION', 3.3333), ev('2026-06-30', 'OVERHEAD', 4.4444)],
    });
    const sum = r.rows.reduce((n, x) => n + x.total, 0);
    expect(Math.round(sum * 1e4) / 1e4).toBe(r.total.total);
  });

  it('splits capitalised from expensed at the costing start date; amortisation is always expensed', () => {
    const r = buildParityExpense({
      parities: [parity(1, '2026-01-01', '2026-12-31', 10)], costingStartDate: '2026-03-01', asOf: '2026-12-31',
      events: [ev('2026-02-28', 'FEED', 100), ev('2026-03-01', 'FEED', 50), ev('2026-04-01', 'OVERHEAD', 20), ev('2026-02-01', 'AMORTISATION', 8)],
    });
    expect(r.rows[0]).toMatchObject({ feed: 150, overhead: 20, amortisation: 8, total: 178, capitalised: 100, expensed: 78 });
  });

  it('capitalises everything when she has no costing start date', () => {
    const r = buildParityExpense({ parities: [], costingStartDate: null, asOf: '2026-07-01', events: [ev('2026-06-01', 'FEED', 9)] });
    expect(r.total).toMatchObject({ capitalised: 9, expensed: 0 });
  });

  it('gives cost per day and per piglet weaned only where both can be worked', () => {
    const r = buildParityExpense({ parities, costingStartDate: null, asOf: '2026-07-01', events: [ev('2026-02-01', 'FEED', 120), ev('2026-06-05', 'FEED', 30)] });
    const [p1, p2] = r.rows;
    expect(p1.days).toBe(111);
    expect(p1.cost_per_piglet_weaned).toBe(12);
    expect(p1.per_day).toBe(Math.round((120 / 111) * 1e4) / 1e4);
    expect(p2.status).toBe('IN_PROGRESS');
    expect(p2.cost_per_piglet_weaned).toBeNull();
  });

  it('shows only the outside row for a gilt with no parity yet', () => {
    const r = buildParityExpense({ parities: [], costingStartDate: null, asOf: '2026-07-01', events: [ev('2026-06-01', 'FEED', 9)] });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ row_type: 'OUTSIDE', total: 9 });
  });

  it('ignores a zero or invalid amount', () => {
    const r = buildParityExpense({ parities: [], costingStartDate: null, asOf: '2026-07-01', events: [ev('2026-06-01', 'FEED', 0), ev('2026-06-02', 'FEED', NaN)] });
    expect(r.total.total).toBe(0);
  });
});

/**
 * A sow's cost, parity by parity: what was spent on her inside each parity's window, split by kind and by whether it went into her book value or
 * straight to the period's expense. Pure: the queries live in AnimalActivityService, so the windows and the sums can be proved on their own.
 *
 * The window is OURS, not the client's (awaiting Rishi / Finance): a parity runs from its mating date to its weaning date, or to the day the figures
 * are read while the litter is not yet weaned. Cost on any day outside every window (before her first service, or the dry days between a weaning and
 * the next mating) is shown on its own row, so the rows always add up to her whole cost.
 */

export type ExpenseKind = 'FEED' | 'OTHER_CONSUMPTION' | 'OVERHEAD' | 'AMORTISATION';

/** One cost on one day. `amount` is what it cost, positive. */
export interface ExpenseEvent {
  date: string;
  kind: ExpenseKind;
  amount: number;
}

export interface ParityFacts {
  parity_number: number;
  mating_date: string;
  farrowing_date: string | null;
  weaning_date: string | null;
  piglets_born_live: number | null;
  piglets_weaned: number | null;
}

export interface ParityExpenseRow {
  /** 'PARITY' for a parity's window; 'OUTSIDE' for all cost that falls in no window. */
  row_type: 'PARITY' | 'OUTSIDE';
  parity_number: number | null;
  window_start: string | null;
  window_end: string | null;
  /** A parity with no weaning date is still running; its window ends on `as_of`. */
  status: 'COMPLETE' | 'IN_PROGRESS' | null;
  days: number | null;
  feed: number;
  other_consumption: number;
  overhead: number;
  amortisation: number;
  total: number;
  /** Feed and overhead before her costing start date went into her book value (TDD rows 7 and 9). */
  capitalised: number;
  /** Everything else: feed and overhead from her costing start date, and every amortisation charge. It never reached her book value. */
  expensed: number;
  per_day: number | null;
  piglets_born_live: number | null;
  piglets_weaned: number | null;
  cost_per_piglet_weaned: number | null;
}

export interface ParityExpense {
  as_of: string;
  costing_start_date: string | null;
  rows: ParityExpenseRow[];
  total: ParityExpenseRow;
}

const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (v: string) => String(v).slice(0, 10);
const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const daysInclusive = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / DAY_MS) + 1;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

const blank = (row_type: ParityExpenseRow['row_type']): ParityExpenseRow => ({
  row_type, parity_number: null, window_start: null, window_end: null, status: null, days: null,
  feed: 0, other_consumption: 0, overhead: 0, amortisation: 0, total: 0, capitalised: 0, expensed: 0, per_day: null,
  piglets_born_live: null, piglets_weaned: null, cost_per_piglet_weaned: null,
});

/**
 * Where the rule puts a cost: feed and overhead dated before her costing start date are capitalised, from it they are expensed; with no start date
 * they are capitalised, as the batch posts them. Amortisation is an expense whatever its date.
 */
function isCapitalised(e: ExpenseEvent, costingStart: string | null): boolean {
  if (e.kind === 'AMORTISATION') return false;
  return !costingStart || day(e.date) < day(costingStart);
}

function add(row: ParityExpenseRow, e: ExpenseEvent, costingStart: string | null) {
  if (e.kind === 'FEED') row.feed += e.amount;
  else if (e.kind === 'OTHER_CONSUMPTION') row.other_consumption += e.amount;
  else if (e.kind === 'OVERHEAD') row.overhead += e.amount;
  else row.amortisation += e.amount;
  if (isCapitalised(e, costingStart)) row.capitalised += e.amount;
  else row.expensed += e.amount;
}

function settle(row: ParityExpenseRow): ParityExpenseRow {
  row.feed = r4(row.feed);
  row.other_consumption = r4(row.other_consumption);
  row.overhead = r4(row.overhead);
  row.amortisation = r4(row.amortisation);
  row.total = r4(row.feed + row.other_consumption + row.overhead + row.amortisation);
  row.capitalised = r4(row.capitalised);
  row.expensed = r4(row.expensed);
  row.per_day = row.days && row.days > 0 ? r4(row.total / row.days) : null;
  row.cost_per_piglet_weaned = row.piglets_weaned && row.piglets_weaned > 0 ? r4(row.total / row.piglets_weaned) : null;
  return row;
}

/**
 * The windows, in mating order. A window that would run into the next parity's mating date stops the day before it, so no day is counted twice;
 * a parity with no weaning date is still running and ends on `asOf`.
 */
export function parityWindows(parities: ParityFacts[], asOf: string): Array<ParityFacts & { start: string; end: string; running: boolean }> {
  const sorted = [...parities].sort((a, b) => (day(a.mating_date) < day(b.mating_date) ? -1 : day(a.mating_date) > day(b.mating_date) ? 1 : a.parity_number - b.parity_number));
  return sorted.map((p, i) => {
    const start = day(p.mating_date);
    const running = !p.weaning_date;
    let end = running ? day(asOf) : day(p.weaning_date!);
    const next = sorted[i + 1];
    if (next && day(next.mating_date) <= end) end = addDays(day(next.mating_date), -1);
    if (end < start) end = start;
    return { ...p, start, end, running };
  });
}

export function buildParityExpense(input: {
  parities: ParityFacts[];
  events: ExpenseEvent[];
  costingStartDate: string | null;
  asOf: string;
}): ParityExpense {
  const costingStart = input.costingStartDate ? day(input.costingStartDate) : null;
  const windows = parityWindows(input.parities, input.asOf);
  const rows = windows.map((w) => {
    const r = blank('PARITY');
    r.parity_number = w.parity_number;
    r.window_start = w.start;
    r.window_end = w.end;
    r.status = w.running ? 'IN_PROGRESS' : 'COMPLETE';
    r.days = daysInclusive(w.start, w.end);
    r.piglets_born_live = w.piglets_born_live;
    r.piglets_weaned = w.piglets_weaned;
    return r;
  });
  const outside = blank('OUTSIDE');
  const total = blank('OUTSIDE');
  for (const e of input.events) {
    if (!(e.amount !== 0) || !Number.isFinite(e.amount)) continue;
    const d = day(e.date);
    const i = windows.findIndex((w) => d >= w.start && d <= w.end);
    add(i >= 0 ? rows[i] : outside, e, costingStart);
    add(total, e, costingStart);
  }
  rows.forEach(settle);
  settle(outside);
  settle(total);
  return { as_of: day(input.asOf), costing_start_date: costingStart, rows: [...rows, outside], total };
}

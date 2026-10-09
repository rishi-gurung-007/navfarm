/**
 * How an issue was priced, laid out step by step so the ledger screen can show the working.
 *
 * The explanation is rebuilt from what the ledger holds — the receipts the issue drew from (its
 * applications) and, for Average, the stock book before the issue — using the same rules `applyFifo` priced
 * it with. It also re-prices the issue and reports whether that agrees with what was posted, so an entry
 * posted before the item's costing method was changed is flagged rather than explained wrongly.
 */
export type CostingMethodName = 'FIFO' | 'AVG' | 'STANDARD';

const round4 = (n: number) => Number(n.toFixed(4));
/** Per-draw rounding may leave a few paise between the formula and the posted total. */
const TOLERANCE = 0.05;

export interface ExplainDraw {
  inbound_entry_no: number | null;
  document_no: string | null;
  posting_date: string | null;
  lot_no: string | null;
  /** The receipt's own rate. */
  receipt_rate: number;
  quantity: number;
  amount: number;
}

export interface ExplainBookReceipt {
  entry_no: number | null;
  document_no: string | null;
  posting_date: string | null;
  transaction_type: string | null;
  quantity: number;
  rate: number;
  amount: number;
}

export interface ExplainInput {
  method: CostingMethodName;
  quantity: number;
  totalCost: number;
  standardCost: number | null;
  draws: ExplainDraw[];
  /** Average only: every stock movement before this entry, summed. */
  book?: {
    receipts: ExplainBookReceipt[];
    receiptsQuantity: number;
    receiptsValue: number;
    issuedQuantity: number;
    issuedValue: number;
  };
}

export interface CostingExplanation {
  method: CostingMethodName;
  quantity: number;
  total_cost: number;
  /** The unit cost the whole entry came to. */
  unit_cost: number;
  draws: Array<ExplainDraw & { unit_cost: number; formula_amount: number }>;
  average: null | {
    receipts: ExplainBookReceipt[];
    receipts_quantity: number;
    receipts_value: number;
    issued_quantity: number;
    issued_value: number;
    book_quantity: number;
    book_value: number;
    average_rate: number;
    /** No quantity on the book to average over: the issue was priced at each receipt's own rate. */
    fallback: boolean;
  };
  standard_cost: number | null;
  /** The total the method's rule gives for this quantity. */
  recomputed_cost: number;
  /** False when the posted cost is not what the item's current method gives — the method may have changed since. */
  matches: boolean;
}

export function explainCosting(input: ExplainInput): CostingExplanation {
  const draws = input.draws.map((d) => ({
    ...d,
    unit_cost: d.quantity > 0 ? round4(d.amount / d.quantity) : 0,
    formula_amount: round4(d.quantity * d.receipt_rate),
  }));

  let average: CostingExplanation['average'] = null;
  let recomputed: number;
  if (input.method === 'AVG') {
    const b = input.book ?? { receipts: [], receiptsQuantity: 0, receiptsValue: 0, issuedQuantity: 0, issuedValue: 0 };
    const bookQuantity = round4(b.receiptsQuantity - b.issuedQuantity);
    const bookValue = round4(b.receiptsValue - b.issuedValue);
    const fallback = bookQuantity <= 0.00005;
    const averageRate = fallback ? 0 : round4(bookValue / bookQuantity);
    average = {
      receipts: b.receipts,
      receipts_quantity: round4(b.receiptsQuantity),
      receipts_value: round4(b.receiptsValue),
      issued_quantity: round4(b.issuedQuantity),
      issued_value: round4(b.issuedValue),
      book_quantity: bookQuantity,
      book_value: bookValue,
      average_rate: averageRate,
      fallback,
    };
    recomputed = fallback ? round4(draws.reduce((n, d) => n + d.formula_amount, 0)) : round4(input.quantity * (bookValue / bookQuantity));
  } else if (input.method === 'STANDARD' && input.standardCost != null) {
    recomputed = round4(input.quantity * input.standardCost);
  } else {
    recomputed = round4(draws.reduce((n, d) => n + d.formula_amount, 0));
  }

  return {
    method: input.method,
    quantity: round4(input.quantity),
    total_cost: round4(input.totalCost),
    unit_cost: input.quantity > 0 ? round4(input.totalCost / input.quantity) : 0,
    draws,
    average,
    standard_cost: input.standardCost,
    recomputed_cost: recomputed,
    matches: Math.abs(recomputed - input.totalCost) <= TOLERANCE,
  };
}

/** The method an item's `valuation_method` means, as applyFifo reads it. */
export function costingMethodOf(valuationMethod: string | null | undefined): CostingMethodName {
  const m = String(valuationMethod ?? 'FIFO').toUpperCase();
  if (m === 'AVG' || m === 'AVERAGE') return 'AVG';
  if (m === 'STANDARD') return 'STANDARD';
  return 'FIFO';
}

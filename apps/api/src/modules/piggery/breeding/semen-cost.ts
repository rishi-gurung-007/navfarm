/**
 * The cost behind a semen collection, worked out from what was posted for the boar over the period (audit G7), for a
 * collection whose period costs were not typed. It replaces typing four figures by hand; the stock value of the doses
 * is unchanged — they still enter inventory at nil (decision 6 is the client's).
 *
 *  - feed and drugs: what the boar himself consumed (his own share of each consumption), medicine and vaccine items
 *    counting as drugs;
 *  - overhead: what was posted against him, plus his equal share of what was posted against his batch as a whole;
 *  - amortisation: what was posted for him, plus his equal share of his batch's amortisation.
 *
 * Reversed postings never reach here (the caller reads only live ones).
 */
export interface PostedCost {
  kind: 'CONSUMPTION' | 'OVERHEAD' | 'AMORTIZATION';
  /** Posted against this boar (true), or against his batch as a whole (false). */
  own: boolean;
  amount: number;
  item_type?: string | null;
}

export interface PeriodCosts {
  feed: number;
  drug: number;
  overhead: number;
  amortisation: number;
}

const DRUG_ITEM_TYPES = new Set(['MEDICINE', 'VACCINE']);

export function periodCostsOf(postings: PostedCost[], headInBatch: number): PeriodCosts {
  const share = headInBatch > 0 ? 1 / headInBatch : 0;
  const totals: PeriodCosts = { feed: 0, drug: 0, overhead: 0, amortisation: 0 };
  for (const p of postings) {
    const value = Math.abs(Number(p.amount) || 0) * (p.own ? 1 : share);
    if (p.kind === 'CONSUMPTION') {
      if (!p.own) continue; // a consumption is always someone's; the batch's other animals' feed is not his
      if (DRUG_ITEM_TYPES.has(String(p.item_type ?? '').toUpperCase())) totals.drug += value;
      else totals.feed += value;
    } else if (p.kind === 'OVERHEAD') totals.overhead += value;
    else totals.amortisation += value;
  }
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return { feed: round(totals.feed), drug: round(totals.drug), overhead: round(totals.overhead), amortisation: round(totals.amortisation) };
}

/** The day after a date, as YYYY-MM-DD. */
export function dayAfter(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

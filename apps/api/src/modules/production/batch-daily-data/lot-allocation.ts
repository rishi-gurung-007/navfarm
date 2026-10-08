/**
 * Spreading one consumption over the lots the user ticked. A lot-tracked item is drawn from the
 * lot(s) the user chose — never from a lot they did not — so when one lot cannot cover the quantity
 * the entry continues into the next ticked lot, in the same order the pickers list them: usable lots
 * first, earliest expiry, then oldest receipt, expired lots last. Each lot is then costed FIFO inside
 * itself when its share is posted, and one ledger entry is written per lot.
 */
export interface LotStock {
  lot_no: string;
  /** What the lot holds at the location the entry draws from. */
  remaining: number;
  expiry_date: string | null;
  /** Date of the lot's earliest receipt there. */
  receipt_date: string;
}

export interface LotAllocation {
  lot_no: string;
  quantity: number;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** The order lots are used in; the same order the lot lists use. */
export function orderLots<T extends LotStock>(lots: T[], today: string): T[] {
  const expired = (l: LotStock) => !!l.expiry_date && String(l.expiry_date).slice(0, 10) < today;
  return [...lots].sort((a, b) => {
    if (expired(a) !== expired(b)) return expired(a) ? 1 : -1;
    if (a.expiry_date && b.expiry_date) {
      const d = new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime();
      if (d !== 0) return d;
    } else if (a.expiry_date) return -1;
    else if (b.expiry_date) return 1;
    return new Date(a.receipt_date).getTime() - new Date(b.receipt_date).getTime();
  });
}

/**
 * Takes `quantity` from the ticked lots in order. Lots not needed are left out; a lot is never
 * over-drawn. `shortBy` is what the ticked lots could not cover.
 */
export function allocateAcrossLots(lots: LotStock[], quantity: number, today: string): { allocations: LotAllocation[]; shortBy: number } {
  const allocations: LotAllocation[] = [];
  let left = round4(quantity);
  for (const lot of orderLots(lots, today)) {
    if (left <= 0) break;
    const take = round4(Math.min(lot.remaining, left));
    if (take <= 0) continue;
    allocations.push({ lot_no: lot.lot_no, quantity: take });
    left = round4(left - take);
  }
  return { allocations, shortBy: Math.max(0, left) };
}

/** The lot numbers in a daily entry's `lot_no`: one lot, or several separated by commas. */
export function parseLotList(lotNo?: string | null): string[] {
  const lots = (lotNo ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set(lots)];
}

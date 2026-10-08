/**
 * What ticking several lots will do to one consumption, shown before saving. The ticked lots are
 * used in the order the picker lists them (usable lots first, earliest expiry, then oldest receipt)
 * until the quantity is covered; the server makes the same split when it posts, one ledger entry per
 * lot, so what the user sees here is what is posted. Cost is the lot's current unit cost; the exact
 * figure is settled by FIFO inside each lot at posting.
 */
export interface LotChoice {
  lot_no: string;
  remaining_quantity: number | string;
  unit_cost?: number;
  expired?: boolean;
}

export interface LotSplitPart {
  lot_no: string;
  quantity: number;
  unit_cost: number | null;
  cost: number | null;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** `options` are in the picker's own order; `selected` are the ticked lot numbers. */
export function planLotSplit(options: LotChoice[], selected: string[], quantity: number): { parts: LotSplitPart[]; shortBy: number; totalCost: number | null } {
  const chosen = options.filter((o) => selected.includes(o.lot_no));
  const parts: LotSplitPart[] = [];
  let left = round4(quantity);
  for (const lot of chosen) {
    if (left <= 0) break;
    const take = round4(Math.min(Number(lot.remaining_quantity), left));
    if (take <= 0) continue;
    const unit = lot.unit_cost ?? null;
    parts.push({ lot_no: lot.lot_no, quantity: take, unit_cost: unit, cost: unit == null ? null : round4(take * unit) });
    left = round4(left - take);
  }
  const costed = parts.every((p) => p.cost != null);
  return { parts, shortBy: Math.max(0, left), totalCost: costed && parts.length ? round4(parts.reduce((n, p) => n + (p.cost ?? 0), 0)) : null };
}

/**
 * The lots to tick on their own for a quantity: from the top of the list — usable lots, nearest expiry
 * first, then oldest receipt — as many as it takes to cover it. Expired lots are never picked for the
 * user. With no quantity yet it is the one suggested lot. When the usable lots together cannot cover
 * the quantity, all of them are picked and the split preview says how far short that is.
 */
export function lotsToCover(options: LotChoice[], quantity: number): string[] {
  const usable = options.filter((o) => !o.expired && Number(o.remaining_quantity) > 0);
  if (usable.length === 0) return [];
  if (!(quantity > 0)) return [usable[0].lot_no];
  const picked: string[] = [];
  let covered = 0;
  for (const lot of usable) {
    picked.push(lot.lot_no);
    covered = round4(covered + Number(lot.remaining_quantity));
    if (covered >= quantity) break;
  }
  return picked;
}

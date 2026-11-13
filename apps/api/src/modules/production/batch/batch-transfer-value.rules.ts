/**
 * The value an animal carries when it is transferred between batches. Pure, so it is tested without a database.
 *
 * The bio-asset ledger is the record of an animal's book value (AGENTS.md §9); the register's book_value column is a cache of
 * it. So an animal the ledger has seen moves at its ledger book value, and a book value of 0 is a value: a boar amortised
 * down to nothing moves at 0. Before 10 Nov 2026 the value was `book_value || opening value || acquisition cost || ...`,
 * which read 0 as "no value" and moved two fully amortised boars at their purchase price of 1,200, overdrawing the source
 * batch (BTR-0001 on nf_devco, undone).
 *
 * Only an animal with no recorded value at all (no ledger rows, and no book value on the register) falls back, in order, to
 * its opening asset value, its acquisition cost, and the batch's carrying value per head.
 */
export interface TransferValueInput {
  /** The animal's book value from its bio-asset ledger rows; null when the ledger has no rows for it. */
  ledger_book_value: number | null;
  book_value: string | number | null;
  total_opening_asset_value: string | number | null;
  acquisition_cost: string | number | null;
}

const recorded = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

export function transferValueOf(animal: TransferValueInput, perHeadFromState: number): number {
  if (animal.ledger_book_value !== null) return animal.ledger_book_value;
  const cached = recorded(animal.book_value);
  if (cached !== null) return cached;
  // Nothing recorded for this animal: the first figure that is set and non-zero, as before.
  return (
    recorded(animal.total_opening_asset_value) ||
    recorded(animal.acquisition_cost) ||
    perHeadFromState ||
    0
  );
}

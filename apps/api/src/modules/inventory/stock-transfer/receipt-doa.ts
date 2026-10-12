/**
 * How a Transfer Receipt ledger row says some of what arrived was DOA (dead on arrival), through its
 * external_reference_no. Three shapes exist:
 *
 *   gross   `Incl. DOA:10` — current. One receipt for everything that arrived (good + DOA); the DOA is then
 *           written off against this same receipt by a Variance_Negative entry, so the receipt's remaining
 *           quantity is the good stock left.
 *   marker  `DOA:10`       — legacy. The receipt holds only the good quantity; the DOA sits on a twin row.
 *   twin    `DOA_IN_TRANSIT` — legacy. The DOA-only receipt row that went with a `DOA:n` marker row.
 *
 * Legacy rows stay readable so transfers posted before the change keep their received/DOA split.
 */
export const DOA_TWIN_REF = 'DOA_IN_TRANSIT';

const GROSS_PREFIX = 'Incl. DOA:';
const MARKER_PREFIX = 'DOA:';

export type ReceiptDoa =
  | { kind: 'none' }
  | { kind: 'twin' }
  | { kind: 'marker'; doa: number }
  | { kind: 'gross'; doa: number };

export const grossDoaRef = (doaQty: number) => `${GROSS_PREFIX}${doaQty}`;

export function parseReceiptDoa(externalReferenceNo: string | null | undefined): ReceiptDoa {
  const ref = (externalReferenceNo || '').trim();
  if (ref === DOA_TWIN_REF) return { kind: 'twin' };
  const gross = ref.startsWith(GROSS_PREFIX);
  if (gross || ref.startsWith(MARKER_PREFIX)) {
    const doa = Number(ref.slice((gross ? GROSS_PREFIX : MARKER_PREFIX).length));
    if (Number.isFinite(doa) && doa > 0) return gross ? { kind: 'gross', doa } : { kind: 'marker', doa };
  }
  return { kind: 'none' };
}

/** What a receipt row's quantity splits into: good stock, and DOA written off against it. */
export function receiptSplit(quantity: number, externalReferenceNo: string | null | undefined): { good: number; doa: number } {
  const parsed = parseReceiptDoa(externalReferenceNo);
  if (parsed.kind === 'twin') return { good: 0, doa: quantity };
  if (parsed.kind === 'gross') return { good: Math.max(0, quantity - parsed.doa), doa: parsed.doa };
  if (parsed.kind === 'marker') return { good: quantity, doa: parsed.doa };
  return { good: quantity, doa: 0 };
}

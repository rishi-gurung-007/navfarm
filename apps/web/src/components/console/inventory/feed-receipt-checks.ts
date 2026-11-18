/**
 * A feed requisition's receipt checks, kept out of the Transfer Order dialog so they can be tested on plain rows
 * (Silo TO Receipt rows 24-27, Requisition rows 139-150; the API decides, these keep the form honest):
 *  - every short receipt needs a variance reason, even with more still to come (Rishi, 11 Oct);
 *  - a BAGGED line needs a whole bag count within 1 percent of the kilograms received (checkpoint 27);
 *  - the delivery note is optional.
 */
export const BAG_TOLERANCE = 0.01;

export interface FeedReceiptInput {
  bags: string;
  reason: string;
  note: string;
}

export interface FeedReceiptLine {
  line_id?: string;
  requisition_line_id?: string | null;
  qty_in_transit?: number | string | null;
  qty_to_receive?: number | string | null;
  doa_quantity?: number | string | null;
}

export interface FeedReceiptControls {
  bagSizeKg: number;
  baggedRequisitionLineIds: string[];
}

/** Whole bags times the bag size land within 1 percent of the kilograms received. */
export function bagsWithinTolerance(
  bags: number | null,
  kg: number,
  bagSizeKg: number,
): boolean {
  return (
    bags !== null &&
    Number.isInteger(bags) &&
    bags > 0 &&
    Math.abs(bags * bagSizeKg - kg) <= kg * BAG_TOLERANCE + 1e-9
  );
}

export function feedReceiptRows<L extends FeedReceiptLine>(
  lines: L[],
  inputs: Record<string, FeedReceiptInput>,
  controls: FeedReceiptControls,
) {
  return lines
    .filter((l) => Number(l.qty_in_transit || 0) > 0 && !!l.line_id)
    .map((line) => {
      const inTransit = Number(line.qty_in_transit || 0);
      const good = Number(
        line.qty_to_receive !== undefined && line.qty_to_receive !== null
          ? line.qty_to_receive
          : inTransit,
      );
      const doa = Number(line.doa_quantity || 0);
      // What is neither received good nor written off as DOA is short.
      const short = inTransit - good - doa > 1e-9;
      const bagged = controls.baggedRequisitionLineIds.includes(
        line.requisition_line_id ?? '',
      );
      const input = inputs[line.line_id!] ?? { bags: '', reason: '', note: '' };
      const bags = input.bags.trim() === '' ? null : Number(input.bags);
      const bagsOk =
        !bagged ||
        good <= 0 ||
        bagsWithinTolerance(bags, good, controls.bagSizeKg);
      const reasonOk = !short || input.reason.trim() !== '';
      return { line, good, doa, short, bagged, bags, bagsOk, reasonOk, input };
    });
}

/** The receipt-line fields these checks add to what the Transfer Order dialog already sends. */
export function feedReceiptExtras(
  row: ReturnType<typeof feedReceiptRows>[number] | undefined,
  doaRemarks: string | undefined,
  doaQuantity: number,
) {
  return {
    ...(row?.short
      ? { variance_reason: row.input.reason.trim() }
      : doaQuantity > 0
        ? { variance_reason: doaRemarks || 'DOA quantity recorded on receipt.' }
        : {}),
    ...(row?.bagged && row.bags !== null ? { bag_count: row.bags } : {}),
    ...(row?.input.note.trim()
      ? { delivery_note_no: row.input.note.trim() }
      : {}),
  };
}

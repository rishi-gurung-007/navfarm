/**
 * Rishi, 31 Oct: an open requisition the forecast did not count, for the same silo and feed, arriving by the first
 * shortage date and together bringing at least the need, already solves that run-down — so a requisition for it is
 * not offered again. The same rule as the API's requisitionCover (feed-requisition.rules.ts), for a calculation
 * not saved yet; a saved one gets it from the from-run preview.
 */

export interface OpenRequisitionLine {
  requisition_id: string;
  req_no: string;
  destination_location_id: string | null;
  item_id: string | null;
  quantity: number;
  proposed_delivery_date: string | null;
}

/** A source the forecast ran short: the silo, the feed, its unrounded need and its first shortage date. */
export interface ShortSource {
  locationId: string;
  sourceCode?: string | null;
  itemId: string;
  itemName?: string | null;
  shortfallKg: number;
  shortageDate: string | null;
}

/** The requisitions a forecast already counted, by its source balances' incoming references. */
export function countedRequisitions(sourceBalances: Array<{ incomingReferences?: Array<{ kind?: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string }> }>) {
  const ids = new Set<string>();
  const nos = new Set<string>();
  for (const point of sourceBalances) {
    for (const ref of point.incomingReferences ?? []) {
      if (ref.kind === 'PLANNED_REQUISITION') {
        if (ref.referenceId) ids.add(ref.referenceId);
        if (ref.referenceNo) nos.add(ref.referenceNo);
      }
      if (ref.kind === 'OPEN_TRANSFER' && ref.relatedReferenceNo) nos.add(ref.relatedReferenceNo);
    }
  }
  return { ids, nos };
}

export function requisitionCover(source: ShortSource, open: OpenRequisitionLine[], counted: { ids: Set<string>; nos: Set<string> }) {
  const by = open.filter((r) =>
    r.destination_location_id === source.locationId
    && r.item_id === source.itemId
    && !counted.ids.has(r.requisition_id) && !counted.nos.has(r.req_no)
    && !!r.proposed_delivery_date
    && (!source.shortageDate || r.proposed_delivery_date.slice(0, 10) <= source.shortageDate));
  const kg = by.reduce((sum, r) => sum + Number(r.quantity), 0);
  return { covered: source.shortfallKg > 0 && kg + 1e-6 >= source.shortfallKg, by: [...new Set(by.map((r) => r.req_no))] };
}

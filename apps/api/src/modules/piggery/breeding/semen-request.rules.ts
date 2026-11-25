/**
 * Semen requests (Phase 4, 24 Nov 2026): a farm's Store requisition naming a breeding line. The AI Station plans a collection from the
 * approved ones and allocates the collected lot to them. Pure rules; the service reads and writes.
 */

export interface RequestLine {
  line_id: string;
  requisition_id: string;
  req_no: string;
  breed_id: string | null;
  approval_status: string | null;
  document_status: string | null;
  required_date: string | null;
  doses: number;
  from_location_id: string | null;
  released: boolean;
  lot_no: string | null;
  plan_id: string | null;
}

/** Why these request lines cannot be planned as one collection of `breedId`, or an empty list. */
export function planRequestProblems(lines: RequestLine[], breedId: string, breedCode: string): string[] {
  const problems: string[] = [];
  for (const l of lines) {
    if (l.breed_id !== breedId) problems.push(`${l.req_no} asks for another breeding line, not ${breedCode}.`);
    else if (l.approval_status !== 'APPROVED') problems.push(`${l.req_no} is not approved yet.`);
    else if (l.document_status === 'CANCELLED') problems.push(`${l.req_no} is cancelled.`);
    else if (l.plan_id) problems.push(`${l.req_no} is already planned in another collection.`);
  }
  return problems;
}

const byNeed = (a: RequestLine, b: RequestLine) =>
  (a.required_date ?? '9999-12-31').localeCompare(b.required_date ?? '9999-12-31') || a.req_no.localeCompare(b.req_no);

/**
 * Which request lines a lot is allocated to: the earliest needed first, each line whole, while the lot has the doses. A line is skipped,
 * with the reason, when it is not released yet (no transfer to put the lot on), asks for semen from another store, already has a lot, or
 * needs more doses than are left. Nothing is split: a line the lot cannot fill waits for the next lot.
 */
export function allocationPlan(
  lines: RequestLine[],
  lot: { lot_no: string; store_id: string; doses: number },
): { allocate: { line_id: string; requisition_id: string; req_no: string; doses: number }[]; skipped: { req_no: string; reason: string }[]; left: number } {
  const allocate: { line_id: string; requisition_id: string; req_no: string; doses: number }[] = [];
  const skipped: { req_no: string; reason: string }[] = [];
  let left = lot.doses;
  for (const l of [...lines].sort(byNeed)) {
    if (l.lot_no) skipped.push({ req_no: l.req_no, reason: `already has lot ${l.lot_no}` });
    else if (!l.released) skipped.push({ req_no: l.req_no, reason: 'not released yet: release it so it has a transfer' });
    else if (l.from_location_id !== lot.store_id) skipped.push({ req_no: l.req_no, reason: 'asks for semen from another store' });
    else if (l.doses > left + 1e-9) skipped.push({ req_no: l.req_no, reason: `needs ${round(l.doses)} doses, ${round(left)} left in ${lot.lot_no}` });
    else {
      allocate.push({ line_id: l.line_id, requisition_id: l.requisition_id, req_no: l.req_no, doses: l.doses });
      left -= l.doses;
    }
  }
  return { allocate, skipped, left: round(left) };
}

const round = (n: number) => Math.round(n * 100) / 100;

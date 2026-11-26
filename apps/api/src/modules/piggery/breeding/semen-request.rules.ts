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

/**
 * Why a request line cannot take a lot of `lotBreedId`, or null when it can. A semen request always names its breeding line, so a lot
 * with no line (a boar with no breed, collected without a plan) matches none. Before 26 Nov a lot with no line skipped the check and
 * could be allocated to a request of any line.
 */
export function lineMismatch(lotBreedId: string | null, line: { breed_id: string | null; breed_code: string | null }): string | null {
  if (line.breed_id === lotBreedId && lotBreedId !== null) return null;
  const asked = line.breed_code ?? 'another line';
  return lotBreedId === null ? `asks for ${asked}; this lot has no breeding line` : `asks for ${asked}, not this lot's line`;
}

/**
 * The doses a lot has promised to requests and not shipped yet: still in its store, but not free. A request that was cancelled or
 * rejected (or deleted, which the caller leaves out) will not ship, so it has given its doses back. Before 26 Nov a cancelled request
 * kept its doses promised for good, and every later request on the lot was refused as short.
 */
export function owedDoses(promised: { doses: number; shipped: number; approval_status: string | null; document_status: string | null }[]): number {
  return promised
    .filter((p) => p.document_status !== 'CANCELLED' && p.approval_status !== 'REJECTED')
    .reduce((n, p) => n + Math.max(0, p.doses - p.shipped), 0);
}

const byNeed = (a: RequestLine, b: RequestLine) =>
  (a.required_date ?? '9999-12-31').localeCompare(b.required_date ?? '9999-12-31') || a.req_no.localeCompare(b.req_no);

/**
 * Which request lines a lot is allocated to: the earliest needed first, each line whole, while the lot has the doses. A line is skipped,
 * with the reason, when it already has a lot, is cancelled or not approved, is not released yet (no transfer to put the lot on), asks for
 * semen from another store, or needs more doses than are left. Nothing is split: a line the lot cannot fill waits for the next lot.
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
    else if (l.document_status === 'CANCELLED') skipped.push({ req_no: l.req_no, reason: 'is cancelled' });
    else if (l.approval_status !== 'APPROVED') skipped.push({ req_no: l.req_no, reason: 'is not approved' });
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

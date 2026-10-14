/**
 * Which posted entries of a reopened day can be reversed, and which must stay as they are. Pure, so the rule is
 * proved on its own; the reversing itself is in batch-day-reversal.service.ts.
 *
 * Reversible: consumption (the issue is reversed at its own cost and the layers it drew are restored), a main
 * output that nothing has used yet, overhead and resource cost, and observations. Not reversible, and so left
 * posted: a transfer (it has "Reverse transfer"), a recorded death (the animal would have to be revived), and the
 * output, overhead and resource postings of a bio-asset batch (they move its carrying value, and the stage that
 * decided how is not recorded on the posting).
 */
export type ReversibleKind = 'CONSUMPTION' | 'OUTPUT' | 'COST' | 'OBSERVATION';

export interface PostedRowFacts {
  line_type: string;
  kpi_metric?: string | null;
  entered_value?: number | string | null;
}

export type Verdict = { reversible: true; kind: ReversibleKind } | { reversible: false; reason: string };

export function classifyPostedRow(row: PostedRowFacts, costingMethod?: string | null): Verdict {
  const bio = costingMethod === 'BIO_ASSET';
  switch (row.line_type) {
    case 'CONSUMPTION':
      return { reversible: true, kind: 'CONSUMPTION' };
    case 'OUTPUT':
      return bio
        ? { reversible: false, reason: "output from a bio-asset batch changes the herd's carrying value and cannot be reversed here" }
        : { reversible: true, kind: 'OUTPUT' };
    case 'OVERHEAD':
    case 'RESOURCE':
      return bio
        ? { reversible: false, reason: 'cost posted to a bio-asset batch is capitalised or expensed by its stage at the time, which was not recorded, so it cannot be reversed here' }
        : { reversible: true, kind: 'COST' };
    case 'TRANSFER':
      return { reversible: false, reason: 'it moved animals — use "Reverse transfer" on the transfer' };
    case 'DESCRIPTIVE':
      return row.kpi_metric === 'MORTALITY_COUNT' && Number(row.entered_value ?? 0) > 0
        ? { reversible: false, reason: 'it recorded a death, which is final' }
        : { reversible: true, kind: 'OBSERVATION' };
    default:
      return { reversible: false, reason: `unknown line type '${row.line_type}'` };
  }
}

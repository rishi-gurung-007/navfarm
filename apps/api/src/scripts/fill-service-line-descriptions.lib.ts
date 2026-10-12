/**
 * Pure planning for fill-service-line-descriptions.ts (review p1f, concern 1).
 *
 * Rishi, 5 Oct: Service lines are "Description + Qty only", and the Resource
 * picker is gone. A Service line saved before that with a Resource and no
 * description (RQ-00008) now shows an empty line. This plans copying the
 * Resource's name into the empty description, so the line obeys "Description
 * + Qty" in its data rather than through a legacy display branch. A
 * description that is already set is never touched. resource_id itself is
 * left as stored history.
 */
export interface ServiceLineRow {
  line_id: string;
  req_no: string;
  line_seq: number;
  doc_type: string;
  description: string | null;
  resource_id: string | null;
  resource_code: string | null;
  resource_name: string | null;
}

/** requisition_line.description is varchar(200). */
const DESCRIPTION_MAX = 200;

export function planServiceDescriptions(rows: ServiceLineRow[]) {
  const set: Array<{ line_id: string; at: string; description: string }> = [];
  const skipped: Array<{ at: string; reason: string }> = [];
  for (const r of rows) {
    if (r.doc_type !== 'SERVICE' || !r.resource_id || (r.description ?? '').trim() !== '') continue;
    const at = `${r.req_no} line ${r.line_seq}`;
    const name = (r.resource_name ?? '').trim();
    if (!name) { skipped.push({ at, reason: `resource ${r.resource_code ?? r.resource_id} has no name` }); continue; }
    set.push({ line_id: r.line_id, at, description: name.slice(0, DESCRIPTION_MAX) });
  }
  return { set, skipped };
}

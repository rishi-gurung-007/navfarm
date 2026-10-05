/**
 * Pure planning for fix-requisition-farm.ts (P1 follow-up item 5).
 *
 * A requisition belongs to the farm of its Main / Farm Location.
 * RequisitionService derives this on create and update with the shared
 * farmOfLocation (common/farm-scope.ts). The script passes that same helper
 * in as `farmOf`, so the planner never defines the rule itself (review p1f,
 * I2). Rows saved before the fix by a caller tied to no farm (area.admin's
 * RQ-00033) have farm_id NULL. This plans filling exactly those rows. A
 * stored farm is never overwritten; a stored farm that disagrees is only
 * reported.
 */
export interface RequisitionFarmRow { requisition_id: string; req_no: string; main_location_id: string | null; farm_id: string | null }

export async function planRequisitionFarms(
  rows: RequisitionFarmRow[],
  farmOf: (locationId: string) => Promise<string | null>,
  codeOf: (locationId: string) => string,
) {
  const set: Array<{ requisition_id: string; req_no: string; farm_id: string; farm_code: string }> = [];
  const unresolved: Array<{ req_no: string; reason: string }> = [];
  const mismatched: Array<{ req_no: string; farm_id: string; derived: string }> = [];
  for (const r of rows) {
    const derived = r.main_location_id ? await farmOf(r.main_location_id) : null;
    if (r.farm_id) {
      if (derived && derived !== r.farm_id) mismatched.push({ req_no: r.req_no, farm_id: r.farm_id, derived: codeOf(derived) });
      continue;
    }
    if (!r.main_location_id) unresolved.push({ req_no: r.req_no, reason: 'no main location' });
    else if (!derived) unresolved.push({ req_no: r.req_no, reason: `main location ${codeOf(r.main_location_id)} has no farm` });
    else set.push({ requisition_id: r.requisition_id, req_no: r.req_no, farm_id: derived, farm_code: codeOf(derived) });
  }
  return { set, unresolved, mismatched };
}

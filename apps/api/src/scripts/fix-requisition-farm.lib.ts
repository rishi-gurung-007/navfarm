/**
 * Pure planning for fix-requisition-farm.ts (P1 follow-up item 5).
 *
 * A requisition belongs to the farm of its Main / Farm Location: the location
 * itself when it is a FARM, otherwise its farm ancestor via
 * parent_location_id. RequisitionService now derives this on create and
 * update. Rows saved before that by a caller tied to no farm (area.admin's
 * RQ-00033) have farm_id NULL. This plans filling exactly those rows. A
 * stored farm is never overwritten; a stored farm that disagrees with the
 * derived one is only reported.
 */
export interface LocationRow { location_id: string; location_code: string; location_type: string | null; parent_location_id: string | null }
export interface RequisitionFarmRow { requisition_id: string; req_no: string; main_location_id: string | null; farm_id: string | null }

export function farmOf(locationId: string, byId: Map<string, LocationRow>): string | null {
  const seen = new Set<string>();
  let current: string | null = locationId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const loc = byId.get(current);
    if (!loc) return null;
    if (loc.location_type === 'FARM') return loc.location_id;
    current = loc.parent_location_id;
  }
  return null;
}

export function planRequisitionFarms(rows: RequisitionFarmRow[], locations: LocationRow[]) {
  const byId = new Map(locations.map((l) => [l.location_id, l]));
  const code = (id: string) => byId.get(id)?.location_code ?? id;
  const set: Array<{ requisition_id: string; req_no: string; farm_id: string; farm_code: string }> = [];
  const unresolved: Array<{ req_no: string; reason: string }> = [];
  const mismatched: Array<{ req_no: string; farm_id: string; derived: string }> = [];
  for (const r of rows) {
    const derived = r.main_location_id ? farmOf(r.main_location_id, byId) : null;
    if (r.farm_id) {
      if (derived && derived !== r.farm_id) mismatched.push({ req_no: r.req_no, farm_id: r.farm_id, derived: code(derived) });
      continue;
    }
    if (!r.main_location_id) unresolved.push({ req_no: r.req_no, reason: 'no main location' });
    else if (!derived) unresolved.push({ req_no: r.req_no, reason: `main location ${code(r.main_location_id)} has no farm above it` });
    else set.push({ requisition_id: r.requisition_id, req_no: r.req_no, farm_id: derived, farm_code: code(derived) });
  }
  return { set, unresolved, mismatched };
}

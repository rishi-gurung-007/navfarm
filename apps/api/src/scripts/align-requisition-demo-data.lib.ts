/**
 * Pure planning for align-requisition-demo-data.ts (WP4a; no database access,
 * unit-tested in the .spec next to it).
 *
 * Why the data is needed: the department checks on Transfer Shipment and
 * Transfer Receipt (Rishi's 4 Oct list, common-requisition-spec.md:
 * "Validation: user dept (from User Setup) must match From/To Sub-Location
 * dimension") return early when a location carries no department, and the
 * local demo database had no DEPARTMENT cost centres at all — so the check had
 * never run live. Item Tracking ("If Lot or Serial tracked: MANDATORY before
 * Transfer Shipment post") likewise had no tracked item to run on.
 *
 * Everything planned here is illustrative demo data, labelled so on screen:
 * no client department or item is being claimed.
 */
import { SYSTEM_NO_SERIES_SEED } from '../core/database/system-master-data-seed';

export type DepartmentKey = 'STORES' | 'FARM_OPS';

/**
 * Cost-centre codes are typed in this tenant: the COST_CENTER number series is
 * seeded blocked ("Cost Center Code (typed, not generated)",
 * system-master-data-seed.ts — "CC-FEEDMILL-A says which mill, CC-001 says
 * nothing"), so CostCenterService.create() falls back to the caller's code.
 */
export const DEMO_DEPARTMENTS: ReadonlyArray<{ key: DepartmentKey; code: string; name: string }> = [
  { key: 'STORES', code: 'DEPT-STORES', name: 'Stores (illustrative)' },
  { key: 'FARM_OPS', code: 'DEPT-FARM-OPS', name: 'Farm Operations (illustrative)' },
];

/**
 * Which sub-locations carry which department. The common requisition form
 * offers FARM, STORE, SHED and SILO (RequisitionService.REQUISITION_LOCATION_TYPES,
 * read through GET /requisition/options). A Store requisition moves stock out
 * of a store to where it is used, so stores are the Stores department and the
 * farm and its sheds are Farm Operations. Silos are left untagged: they hold
 * feed, which never goes through the common requisition (FEED is refused on
 * /requisition), and a NULL department passes the check by design.
 */
export const LOCATION_TYPE_DEPARTMENT: Readonly<Record<string, DepartmentKey>> = {
  STORE: 'STORES',
  SHED: 'FARM_OPS',
  FARM: 'FARM_OPS',
};

/**
 * The seeded local users (apps/api/src/scripts/seed-dev-tenant.ts, USERS):
 * the company admin keeps the store; the operational admin and the standard
 * user are on the farm side. Those three hold the permissions a live check
 * needs — INVENTORY/STOCK_TRANSFER edit is held by SUPER_ADMIN and MANAGER
 * only, so the shipping and receiving users must be company.admin and
 * area.admin. tenant.admin is left without a department: it is the approver
 * (open defect D1 keeps company-wide approvals with the tenant-scoped user).
 */
export const DEMO_USER_DEPARTMENTS: Readonly<Record<string, DepartmentKey>> = {
  'company.admin@triplec.local': 'STORES',
  'area.admin@triplec.local': 'FARM_OPS',
  'user@triplec.local': 'FARM_OPS',
};

export const DEMO_TRACKED_ITEMS: ReadonlyArray<{ item_code: string; item_name: string; tracking: 'LOT' | 'SERIAL'; uom: string }> = [
  { item_code: 'ILL-LOT-001', item_name: 'Lot-tracked medicine (illustrative)', tracking: 'LOT', uom: 'VIAL' },
  { item_code: 'ILL-SER-001', item_name: 'Serial-tracked item (illustrative)', tracking: 'SERIAL', uom: 'PCS' },
];

export interface CompanyLocationRow {
  location_id: string;
  location_code: string;
  location_type: string;
  company_id: string | null;
  is_active: number | boolean;
  department_id: string | null;
}

export interface CostCenterRow {
  cost_center_id: string;
  company_id: string | null;
  cost_center_code: string;
  cost_center_type: string;
  deleted_at: string | Date | null;
}

export interface SeriesRow {
  code: string;
  company_id: string | null;
  blocked?: number | boolean;
  deleted_at: string | Date | null;
}

export function storeCapableCompanies(locations: CompanyLocationRow[]): string[] {
  const out = new Set<string>();
  for (const l of locations) {
    if (l.company_id && Number(l.is_active) === 1 && l.location_type === 'STORE') out.add(l.company_id);
  }
  return [...out].sort();
}

export interface DepartmentPlan {
  create: Array<{ company_id: string; key: DepartmentKey; cost_center_code: string; cost_center_name: string }>;
  existing: Array<{ company_id: string; key: DepartmentKey; cost_center_id: string }>;
  blocked: Array<{ company_id: string; key: DepartmentKey; why: string }>;
}

/** An unblocked COST_CENTER (or COST_CENTER_DEPARTMENT) series in the company's or the tenant's scope issues codes. */
function activeCostCenterSeries(series: SeriesRow[], companyId: string): SeriesRow | undefined {
  return series.find((s) => ['COST_CENTER', 'COST_CENTER_DEPARTMENT'].includes(s.code)
    && !s.deleted_at && !Number(s.blocked ?? 0) && (s.company_id === companyId || s.company_id === null));
}

export function planDepartmentCostCenters(companies: string[], costCenters: CostCenterRow[], series: SeriesRow[]): DepartmentPlan {
  const plan: DepartmentPlan = { create: [], existing: [], blocked: [] };
  for (const companyId of companies) {
    const active = activeCostCenterSeries(series, companyId);
    for (const d of DEMO_DEPARTMENTS) {
      const same = costCenters.find((c) => c.company_id === companyId && c.cost_center_code.toUpperCase() === d.code && !c.deleted_at);
      if (same) {
        if (same.cost_center_type === 'DEPARTMENT') plan.existing.push({ company_id: companyId, key: d.key, cost_center_id: same.cost_center_id });
        else plan.blocked.push({ company_id: companyId, key: d.key, why: `code ${d.code} is held by a ${same.cost_center_type} cost centre` });
        continue;
      }
      if (active) {
        plan.blocked.push({
          company_id: companyId, key: d.key,
          why: `the ${active.code} number series is active, so codes are issued by it — create this department through the Cost Center master instead`,
        });
        continue;
      }
      plan.create.push({ company_id: companyId, key: d.key, cost_center_code: d.code, cost_center_name: d.name });
    }
  }
  return plan;
}

export type DepartmentIds = Map<string, Partial<Record<DepartmentKey, string>>>;

export function planLocationDepartments(locations: CompanyLocationRow[], departments: DepartmentIds) {
  const set: Array<{ location_id: string; location_code: string; department_id: string; department: DepartmentKey }> = [];
  let keptExisting = 0;
  for (const l of locations) {
    const key = LOCATION_TYPE_DEPARTMENT[l.location_type];
    if (!key || !l.company_id || Number(l.is_active) !== 1) continue;
    const departmentId = departments.get(l.company_id)?.[key];
    if (!departmentId) continue;
    if (l.department_id) { keptExisting += 1; continue; }
    set.push({ location_id: l.location_id, location_code: l.location_code, department_id: departmentId, department: key });
  }
  return { set, keptExisting };
}

export function planUserDepartments(
  users: Array<{ user_id: string; email: string; company_id: string | null; department_id: string | null }>,
  departments: DepartmentIds,
) {
  const set: Array<{ user_id: string; email: string; department_id: string; department: DepartmentKey }> = [];
  const keptExisting: string[] = [];
  for (const u of users) {
    const key = DEMO_USER_DEPARTMENTS[u.email.toLowerCase()];
    if (!key || !u.company_id) continue;
    const departmentId = departments.get(u.company_id)?.[key];
    if (!departmentId) continue;
    if (u.department_id) { keptExisting.push(u.email); continue; }
    set.push({ user_id: u.user_id, email: u.email, department_id: departmentId, department: key });
  }
  return { set, keptExisting };
}

/**
 * ITEM_LOT / ITEM_SERIAL (PR #13, merged in 6f28462f) exist in
 * SYSTEM_NO_SERIES_SEED, so a freshly seeded tenant has them at tenant scope;
 * this database predates them. Same row shape seed-dev-tenant.ts writes.
 */
export function planTrackingSeries(existing: SeriesRow[], tenantId: string) {
  const wanted = SYSTEM_NO_SERIES_SEED.filter((s) => s.series_code === 'ITEM_LOT' || s.series_code === 'ITEM_SERIAL');
  return wanted
    .filter((s) => !existing.some((e) => e.code === s.series_code && !e.deleted_at))
    .map((s) => ({
      tenant_id: tenantId,
      company_id: null as string | null,
      code: s.series_code,
      description: s.series_name,
      document_type: s.document_type,
      master_type: s.document_type,
      no_series_code: s.prefix || null,
      prefix: s.prefix || null,
      separator: s.separator,
      seq_length: Math.max(s.seq_length, 1),
      reset_frequency: s.reset_frequency,
      manual_nos: s.allow_manual ?? false,
      blocked: s.is_active === false,
    }));
}

export interface ItemSourceRow {
  item_id: string;
  company_id: string | null;
  item_code: string;
  item_type: string;
  category_id: string | null;
  nob_id: string | null;
  lob_id: string | null;
  sub_category: string | null;
  valuation_method: string | null;
}

/**
 * The GL posting of a transfer resolves its accounts from the item's category,
 * NOB and LOB (GlPostingService.postInventoryLedgerEntry), so each illustrative
 * item copies those from the company's first active MEDICINE item — a set-up
 * that has already posted transfers in this database (RQ-00005).
 */
export function planTrackedItems(
  companies: string[],
  sources: ItemSourceRow[],
  existing: Array<{ company_id: string | null; item_code: string }>,
  seriesIds: { LOT?: string; SERIAL?: string },
) {
  const create: Array<{
    company_id: string; item_code: string; item_name: string; item_type: string; uom_primary: string;
    category_id: string; nob_id: string | null; lob_id: string | null; sub_category: string | null; valuation_method: string;
    is_lot_tracked: boolean; is_serial_tracked: boolean; tracking_series_id: string | null; cloned_from: string;
  }> = [];
  const skipped: Array<{ company_id: string; why: string }> = [];
  for (const companyId of companies) {
    const source = sources
      .filter((s) => s.company_id === companyId && s.item_type === 'MEDICINE' && s.category_id)
      .sort((a, b) => a.item_code.localeCompare(b.item_code))[0];
    if (!source) {
      skipped.push({ company_id: companyId, why: 'no active MEDICINE item with a category to clone the posting set-up from' });
      continue;
    }
    for (const t of DEMO_TRACKED_ITEMS) {
      if (existing.some((e) => e.company_id === companyId && e.item_code === t.item_code)) continue;
      create.push({
        company_id: companyId, item_code: t.item_code, item_name: t.item_name, item_type: source.item_type, uom_primary: t.uom,
        category_id: source.category_id as string, nob_id: source.nob_id, lob_id: source.lob_id, sub_category: source.sub_category,
        valuation_method: source.valuation_method || 'FIFO',
        is_lot_tracked: t.tracking === 'LOT', is_serial_tracked: t.tracking === 'SERIAL',
        tracking_series_id: seriesIds[t.tracking] ?? null, cloned_from: source.item_code,
      });
    }
  }
  return { create, skipped };
}

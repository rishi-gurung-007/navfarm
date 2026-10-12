/**
 * Pure planning for seed-feed-mill-demo.ts: what a company needs so the Feed
 * Mill, BIN and BIN Diet Assignment screens have something to show. Rows are
 * shaped exactly as LocationService.create / BinDietAssignmentService.create
 * write them; the plan only adds what is missing, so a second run plans nothing.
 */
import { feedFormFromItemType, type FeedForm } from '../modules/master-data/bin-diet-assignment/bin-diet-assignment.rules';

export const MILL_CODE = 'MILL-001';
export const BIN_COUNT = 4;
export const PLAN_DAYS = 28;
/** Demo capacities, the workbook's mill: 178,000 bulk + 60,000 bagged = 238,000 KG/day. */
export const MILL_DAILY_KG = '238000.00';
export const MILL_HOURLY_KG = '9917.00';
export const MILL_BULK_KG = '178000.00';
export const MILL_BAGGED_KG = '60000.00';
export const BIN_CAPACITY_KG = '30000.00';

export interface TypeSpec { code: string; name: string; prefix: string; allowedParents: string[] }
export const TYPE_SPECS: TypeSpec[] = [
  { code: 'MILL', name: 'Feed Mill', prefix: 'MILL', allowedParents: [] },
  { code: 'BIN', name: 'Bin', prefix: 'BIN', allowedParents: ['MILL'] },
];

export interface ExistingLocation { location_id: string; location_code: string; location_type: string; parent_location_id: string | null; is_active: boolean; bin_feed_type: string | null }
export interface FeedItemFact { item_id: string; item_code: string; item_type: string | null; item_type_name: string | null; diet_no: number | null; is_active: boolean; order: number }
export interface PlanFacts {
  tenantId: string; companyId: string; nobId: string | null; lobId: string | null;
  /** type_code values already visible to the company (company-owned or tenant-wide). */
  existingTypes: string[];
  locations: ExistingLocation[];
  /** distinct feed items of the company's active lifecycle stages with the stage order of their earliest use */
  feedItems: FeedItemFact[];
  /** `${bin_location_id}|${yyyy-mm-dd}` of active assignments */
  assignments: string[];
  today: string; // yyyy-mm-dd
  newId: () => string;
}

export interface PlannedRow { table: 'location_type_master' | 'location_master' | 'bin_diet_assignment'; label: string; row: Record<string, any> }
export interface DemoPlan { rows: PlannedRow[]; exists: Record<string, number>; notes: string[] }

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

export function planFeedMillDemo(f: PlanFacts): DemoPlan {
  const rows: PlannedRow[] = [];
  const exists: Record<string, number> = { location_type_master: 0, location_master: 0, bin_diet_assignment: 0 };
  const notes: string[] = [];

  for (const t of TYPE_SPECS) {
    if (f.existingTypes.includes(t.code)) { exists.location_type_master += 1; continue; }
    rows.push({ table: 'location_type_master', label: `location type ${t.code}`, row: {
      location_type_id: f.newId(), tenant_id: f.tenantId, company_id: f.companyId, nob_id: f.nobId, lob_id: f.lobId,
      type_code: t.code, type_name: t.name, code_prefix: t.prefix, allowed_parent_types: JSON.stringify(t.allowedParents),
      is_system: true, is_active: true, status: 'ACTIVE',
    } });
  }

  // Feed items a BIN may be assigned: the service requires an active item with an explicit Bulk/Bagged type and a Diet No.
  const eligible: (FeedItemFact & { form: FeedForm })[] = [];
  for (const it of [...f.feedItems].sort((a, b) => a.order - b.order || a.item_code.localeCompare(b.item_code))) {
    const form = feedFormFromItemType(it.item_type, it.item_type_name);
    if (!it.is_active || !form || it.diet_no == null) { notes.push(`feed item ${it.item_code} skipped: needs to be active, a Bulk/Bagged feed type and have a Diet No.`); continue; }
    eligible.push({ ...it, form });
  }

  // MILL
  const byCode = new Map(f.locations.map((l) => [l.location_code, l]));
  let mill = byCode.get(MILL_CODE);
  let millId: string | undefined = mill?.location_id;
  if (mill) {
    exists.location_master += 1;
    if (mill.location_type !== 'MILL' || !mill.is_active) { notes.push(`${MILL_CODE} exists but is not an active MILL; BINs and assignments not planned.`); return { rows, exists, notes }; }
  } else {
    millId = f.newId();
    rows.push({ table: 'location_master', label: MILL_CODE, row: {
      ...locationBase(f, millId, MILL_CODE, 'Feed Mill', 'MILL', 1), farm_id: millId, warehouse_id: null, parent_location_id: null,
      mill_daily_capacity_kg: MILL_DAILY_KG, mill_hourly_capacity_kg: MILL_HOURLY_KG,
      mill_bulk_daily_allocation_kg: MILL_BULK_KG, mill_bagged_daily_allocation_kg: MILL_BAGGED_KG,
    } });
  }

  // BINs: BIN-001..N, the last one BAGGED when the company has a bagged diet, the rest BULK.
  const hasBagged = eligible.some((e) => e.form === 'BAGGED');
  const bins: { id: string; code: string; form: string | null }[] = [];
  for (let i = 1; i <= BIN_COUNT; i += 1) {
    const code = `${MILL_CODE}/BIN-${String(i).padStart(3, '0')}`;
    const found = byCode.get(code);
    if (found) {
      exists.location_master += 1;
      if (found.location_type === 'BIN' && found.is_active) bins.push({ id: found.location_id, code, form: found.bin_feed_type });
      else notes.push(`${code} exists but is not an active BIN; left alone.`);
      continue;
    }
    const id = f.newId();
    const form = hasBagged && i === BIN_COUNT ? 'BAGGED' : 'BULK';
    rows.push({ table: 'location_master', label: code, row: {
      ...locationBase(f, id, code, `Bin ${i}`, 'BIN', 2), farm_id: millId, warehouse_id: id, parent_location_id: millId,
      bin_capacity_kg: BIN_CAPACITY_KG, bin_feed_type: form,
    } });
    bins.push({ id, code, form });
  }

  // BIN Diet Assignments: per feed form, BIN j of that form takes item (j + day number) mod items — round-robin, rotating by date.
  if (!eligible.length) notes.push('No assignable feed item found in the company\'s breed lifecycle stages; no BIN Diet Assignments planned.');
  const taken = new Set(f.assignments);
  for (let d = 0; d < PLAN_DAYS && eligible.length; d += 1) {
    const date = addDays(f.today, d);
    const rot = dayNumber(date);
    let priority = 0;
    const perForm = new Map<string, number>();
    for (const bin of [...bins].sort((a, b) => a.code.localeCompare(b.code))) {
      const items = eligible.filter((e) => e.form === bin.form);
      if (!items.length) continue;
      const j = perForm.get(bin.form!) || 0; perForm.set(bin.form!, j + 1);
      const item = items[(j + rot) % items.length];
      priority += 1;
      if (taken.has(`${bin.id}|${date}`)) { exists.bin_diet_assignment += 1; continue; }
      rows.push({ table: 'bin_diet_assignment', label: `${bin.code} ${date} ${item.item_code}`, row: {
        assignment_id: f.newId(), tenant_id: f.tenantId, company_id: f.companyId, bin_location_id: bin.id, feed_item_id: item.item_id,
        production_date: date, production_slot_id: null, diet_priority: priority, is_active: true, status: 'ACTIVE',
      } });
    }
  }
  return { rows, exists, notes };
}

function locationBase(f: PlanFacts, id: string, code: string, name: string, type: string, level: number): Record<string, any> {
  return {
    location_id: id, tenant_id: f.tenantId, company_id: f.companyId, nob_id: f.nobId, lob_id: f.lobId,
    location_code: code, location_name: name, location_level: level, location_type: type,
    current_count: '0.00', is_quarantine_zone: false, is_active: true, status: 'ACTIVE', shed_id: null,
  };
}

export function countByTable(rows: PlannedRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.table] = (out[r.table] || 0) + 1;
  return out;
}

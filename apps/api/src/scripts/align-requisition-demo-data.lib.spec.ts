import {
  DEMO_DEPARTMENTS,
  DEMO_TRACKED_ITEMS,
  DEMO_USER_DEPARTMENTS,
  planAreaAssignments,
  planDepartmentCostCenters,
  planLocationDepartments,
  planTrackedItems,
  planTrackingSeries,
  planUserDepartments,
  storeCapableCompanies,
  type CompanyLocationRow,
} from './align-requisition-demo-data.lib';

/**
 * WP4a: demo data for the common requisition, so the department checks on
 * Transfer Shipment / Receipt (assertPostingDepartment) and Item Tracking can
 * be shown live. Every rule here is about what the script may touch: only
 * companies with Store sub-locations, only NULL departments, never a second
 * row for something that already exists, and never a code invented while a
 * cost-centre number series would issue one.
 */

const CO = 'co-1';
const TENANT = 't-1';
const loc = (over: Partial<CompanyLocationRow> = {}): CompanyLocationRow => ({
  location_id: 'l-1', location_code: 'F1/STORE-001', location_type: 'STORE', company_id: CO, is_active: 1, department_id: null, ...over,
});

describe('storeCapableCompanies — only companies that hold an active Store sub-location', () => {
  it('keeps a company with an active STORE and drops one without', () => {
    expect(storeCapableCompanies([
      loc(),
      loc({ location_id: 'l-2', company_id: 'co-2', location_type: 'SHED' }),
      loc({ location_id: 'l-3', company_id: 'co-3', is_active: 0 }),
      loc({ location_id: 'l-4', company_id: null }),
    ])).toEqual([CO]);
  });
});

describe('planDepartmentCostCenters — two illustrative DEPARTMENT cost centres per company', () => {
  it('labels both rows illustrative and gives them clear typed codes', () => {
    expect(DEMO_DEPARTMENTS.map((d) => d.name)).toEqual(['Stores (illustrative)', 'Farm Operations (illustrative)']);
    const plan = planDepartmentCostCenters([CO], [], []);
    expect(plan.create).toEqual([
      { company_id: CO, key: 'STORES', cost_center_code: 'DEPT-STORES', cost_center_name: 'Stores (illustrative)' },
      { company_id: CO, key: 'FARM_OPS', cost_center_code: 'DEPT-FARM-OPS', cost_center_name: 'Farm Operations (illustrative)' },
    ]);
    expect(plan.blocked).toEqual([]);
  });

  it('reuses an existing DEPARTMENT row with the same code instead of adding a second one', () => {
    const plan = planDepartmentCostCenters([CO], [
      { cost_center_id: 'cc-s', company_id: CO, cost_center_code: 'DEPT-STORES', cost_center_type: 'DEPARTMENT', deleted_at: null },
    ], []);
    expect(plan.create.map((c) => c.key)).toEqual(['FARM_OPS']);
    expect(plan.existing).toEqual([{ company_id: CO, key: 'STORES', cost_center_id: 'cc-s' }]);
  });

  it('refuses a code already taken by a cost centre of another type', () => {
    const plan = planDepartmentCostCenters([CO], [
      { cost_center_id: 'cc-x', company_id: CO, cost_center_code: 'DEPT-STORES', cost_center_type: 'OPERATIONAL', deleted_at: null },
    ], []);
    expect(plan.create.map((c) => c.key)).toEqual(['FARM_OPS']);
    expect(plan.blocked).toEqual([{ company_id: CO, key: 'STORES', why: "code DEPT-STORES is held by a OPERATIONAL cost centre" }]);
  });

  it('types no code while an active cost-centre number series would issue one (the master must be used instead)', () => {
    const plan = planDepartmentCostCenters([CO], [], [
      { code: 'COST_CENTER', company_id: CO, blocked: 0, deleted_at: null },
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.blocked).toHaveLength(2);
    expect(plan.blocked[0].why).toContain('COST_CENTER number series is active');
  });

  it('types the codes when the cost-centre series exists but is blocked ("typed, not generated")', () => {
    const plan = planDepartmentCostCenters([CO], [], [
      { code: 'COST_CENTER', company_id: CO, blocked: 1, deleted_at: null },
      { code: 'COST_CENTER', company_id: null, blocked: 1, deleted_at: null },
    ]);
    expect(plan.create).toHaveLength(2);
  });

  it('also honours an active type-scoped COST_CENTER_DEPARTMENT series', () => {
    const plan = planDepartmentCostCenters([CO], [], [
      { code: 'COST_CENTER_DEPARTMENT', company_id: null, blocked: 0, deleted_at: null },
    ]);
    expect(plan.create).toEqual([]);
  });
});

describe('planLocationDepartments — Stores on STORE, Farm Operations on SHED and FARM, only where NULL', () => {
  const depts = new Map([[CO, { STORES: 'cc-s', FARM_OPS: 'cc-f' }]]);

  it('tags a NULL store with Stores and a NULL shed and farm with Farm Operations', () => {
    const plan = planLocationDepartments([
      loc(),
      loc({ location_id: 'l-2', location_code: 'F1/SHED-001', location_type: 'SHED' }),
      loc({ location_id: 'l-3', location_code: 'F1', location_type: 'FARM' }),
    ], depts);
    expect(plan.set).toEqual([
      { location_id: 'l-1', location_code: 'F1/STORE-001', department_id: 'cc-s', department: 'STORES' },
      { location_id: 'l-2', location_code: 'F1/SHED-001', department_id: 'cc-f', department: 'FARM_OPS' },
      { location_id: 'l-3', location_code: 'F1', department_id: 'cc-f', department: 'FARM_OPS' },
    ]);
  });

  it('never overwrites a location that already carries a department', () => {
    const plan = planLocationDepartments([loc({ department_id: 'someone-else' })], depts);
    expect(plan.set).toEqual([]);
    expect(plan.keptExisting).toBe(1);
  });

  it('leaves silos, pens and inactive locations alone', () => {
    const plan = planLocationDepartments([
      loc({ location_type: 'SILO' }), loc({ location_type: 'PEN' }), loc({ is_active: 0 }),
    ], depts);
    expect(plan.set).toEqual([]);
  });

  it('touches nothing in a company that has no planned departments', () => {
    expect(planLocationDepartments([loc({ company_id: 'co-2' })], depts).set).toEqual([]);
  });
});

describe('planUserDepartments — the seeded demo users, only where NULL', () => {
  const depts = new Map([[CO, { STORES: 'cc-s', FARM_OPS: 'cc-f' }]]);
  const user = (email: string, department_id: string | null = null) => ({ user_id: `u-${email}`, email, company_id: CO, department_id });

  it('names one Stores user and two Farm Operations users from seed-dev-tenant.ts', () => {
    expect(DEMO_USER_DEPARTMENTS).toEqual({
      'company.admin@triplec.local': 'STORES',
      'area.admin@triplec.local': 'FARM_OPS',
      'user@triplec.local': 'FARM_OPS',
    });
  });

  it('sets the department of a NULL demo user and ignores everyone else', () => {
    const plan = planUserDepartments([
      user('company.admin@triplec.local'), user('area.admin@triplec.local'), user('gra100.entry@triplec.local'),
    ], depts);
    expect(plan.set).toEqual([
      { user_id: 'u-company.admin@triplec.local', email: 'company.admin@triplec.local', department_id: 'cc-s', department: 'STORES' },
      { user_id: 'u-area.admin@triplec.local', email: 'area.admin@triplec.local', department_id: 'cc-f', department: 'FARM_OPS' },
    ]);
  });

  it('never overwrites a user who already has a department', () => {
    const plan = planUserDepartments([user('company.admin@triplec.local', 'cc-other')], depts);
    expect(plan.set).toEqual([]);
    expect(plan.keptExisting).toEqual(['company.admin@triplec.local']);
  });

  it('matches the email case-insensitively', () => {
    expect(planUserDepartments([user('Company.Admin@TripleC.local')], depts).set).toHaveLength(1);
  });
});

describe('planTrackingSeries — ITEM_LOT and ITEM_SERIAL as SYSTEM_NO_SERIES_SEED defines them', () => {
  it('adds both at tenant scope when neither exists', () => {
    const plan = planTrackingSeries([], TENANT);
    expect(plan.map((s) => [s.code, s.document_type, s.prefix, s.seq_length, s.manual_nos, s.company_id])).toEqual([
      ['ITEM_LOT', 'LOT', 'LOT', 5, true, null],
      ['ITEM_SERIAL', 'SERIAL', 'SN', 5, true, null],
    ]);
  });

  it('adds nothing for a code that already exists in any scope', () => {
    expect(planTrackingSeries([{ code: 'ITEM_LOT', company_id: CO, deleted_at: null }], TENANT).map((s) => s.code)).toEqual(['ITEM_SERIAL']);
  });
});

describe('planTrackedItems — one lot-tracked and one serial-tracked illustrative item per company', () => {
  const source = {
    item_id: 'src', company_id: CO, item_code: 'ICAT-005-ITM-0002', item_type: 'MEDICINE', category_id: 'cat-med',
    nob_id: 'nob', lob_id: 'lob', sub_category: 'ICAT-018', valuation_method: 'FIFO',
  };

  it('labels both items illustrative and gives them clear codes', () => {
    expect(DEMO_TRACKED_ITEMS.map((i) => [i.item_code, i.tracking])).toEqual([['ILL-LOT-001', 'LOT'], ['ILL-SER-001', 'SERIAL']]);
    for (const i of DEMO_TRACKED_ITEMS) expect(i.item_name).toContain('(illustrative)');
  });

  it('clones category, NOB/LOB and valuation from the company medicine item so GL mapping resolves', () => {
    const plan = planTrackedItems([CO], [source], [], { LOT: 'ser-lot', SERIAL: 'ser-sn' });
    expect(plan.create).toEqual([
      expect.objectContaining({ company_id: CO, item_code: 'ILL-LOT-001', is_lot_tracked: true, is_serial_tracked: false, tracking_series_id: 'ser-lot', category_id: 'cat-med', nob_id: 'nob', lob_id: 'lob', item_type: 'MEDICINE', valuation_method: 'FIFO' }),
      expect.objectContaining({ company_id: CO, item_code: 'ILL-SER-001', is_lot_tracked: false, is_serial_tracked: true, tracking_series_id: 'ser-sn' }),
    ]);
  });

  it('skips an item code that already exists', () => {
    const plan = planTrackedItems([CO], [source], [{ company_id: CO, item_code: 'ILL-LOT-001' }], { LOT: 'ser-lot', SERIAL: 'ser-sn' });
    expect(plan.create.map((i) => i.item_code)).toEqual(['ILL-SER-001']);
  });

  it('creates nothing for a company without a medicine item to clone, and says so', () => {
    const plan = planTrackedItems([CO], [], [], { LOT: 'ser-lot', SERIAL: 'ser-sn' });
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ company_id: CO, why: 'no active MEDICINE item with a category to clone the posting set-up from' }]);
  });
});

describe('planAreaAssignments — the operational admin persona gets a standing area (progress.md, "Flagged for WP4")', () => {
  const area = { area_id: 'a-1', company_id: CO, area_code: 'PIGGERY-01', is_active: 1, deleted_at: null };
  const admin = { user_id: 'u-area', email: 'area.admin@triplec.local', user_type: 'OPERATIONAL_ADMIN', company_id: CO };

  it('assigns every active area of the company to area.admin when it holds none', () => {
    expect(planAreaAssignments([admin], [], [area, { ...area, area_id: 'a-2', area_code: 'OLD', is_active: 0 }])).toEqual([
      { user_id: 'u-area', email: 'area.admin@triplec.local', area_id: 'a-1', area_code: 'PIGGERY-01', company_id: CO },
    ]);
  });

  it('adds nothing once the persona holds any area — a standing choice is never second-guessed', () => {
    expect(planAreaAssignments([admin], [{ user_id: 'u-area', area_id: 'a-9' }], [area])).toEqual([]);
  });

  it('touches no other user, and not an area.admin whose type is not OPERATIONAL_ADMIN', () => {
    expect(planAreaAssignments([
      { ...admin, user_id: 'u-x', email: 'user@triplec.local', user_type: 'STANDARD_USER' },
      { ...admin, user_type: 'COMPANY_ADMIN' },
    ], [], [area])).toEqual([]);
  });

  it('never assigns an area of another company', () => {
    expect(planAreaAssignments([admin], [], [{ ...area, company_id: 'co-2' }])).toEqual([]);
  });
});

import { addDays, countByTable, planFeedMillDemo, type PlanFacts } from './seed-feed-mill-demo.lib';

let n = 0;
const base = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  tenantId: 't', companyId: 'c', nobId: null, lobId: null, existingTypes: [], locations: [], assignments: [], today: '2026-10-12',
  newId: () => `id${++n}`,
  feedItems: [
    { item_id: 'i1', item_code: 'F1', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 1, is_active: true, order: 1 },
    { item_id: 'i2', item_code: 'F2', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 2, is_active: true, order: 2 },
    { item_id: 'i3', item_code: 'F3', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 3, is_active: true, order: 3 },
    { item_id: 'i4', item_code: 'F4', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 4, is_active: true, order: 4 },
    { item_id: 'i5', item_code: 'F5', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 5, is_active: true, order: 5 },
    { item_id: 'x', item_code: 'PLAIN', item_type: 'FEED', item_type_name: 'Feed', diet_no: 9, is_active: true, order: 6 },
  ],
  ...over,
});

describe('planFeedMillDemo', () => {
  it('plans types, one mill, four bins and 28 days of assignments for a blank company', () => {
    const plan = planFeedMillDemo(base());
    expect(countByTable(plan.rows)).toEqual({ location_type_master: 2, location_master: 5, bin_diet_assignment: 4 * 28 });
    const mill = plan.rows.find((r) => r.label === 'MILL-001')!.row;
    expect(mill).toMatchObject({ location_level: 1, parent_location_id: null, farm_id: mill.location_id, mill_daily_capacity_kg: '238000.00' });
    const bin = plan.rows.find((r) => r.label === 'MILL-001/BIN-001')!.row;
    expect(bin).toMatchObject({ location_level: 2, parent_location_id: mill.location_id, farm_id: mill.location_id, warehouse_id: bin.location_id, bin_feed_type: 'BULK', bin_capacity_kg: '30000.00' });
    expect(plan.notes.join()).toContain('PLAIN');
  });

  it('gives each bin one diet per date, priority 1..n, rotating the 5 items over the 4 bins', () => {
    const plan = planFeedMillDemo(base());
    const a = plan.rows.filter((r) => r.table === 'bin_diet_assignment').map((r) => r.row);
    expect(new Set(a.map((r) => `${r.bin_location_id}|${r.production_date}`)).size).toBe(a.length);
    const day0 = a.filter((r) => r.production_date === '2026-10-12');
    expect(day0.map((r) => r.diet_priority)).toEqual([1, 2, 3, 4]);
    const day1 = a.filter((r) => r.production_date === '2026-10-13');
    expect(day1.map((r) => r.feed_item_id)).not.toEqual(day0.map((r) => r.feed_item_id));
    expect(a[a.length - 1].production_date).toBe(addDays('2026-10-12', 27));
  });

  it('plans nothing when everything already exists', () => {
    const first = planFeedMillDemo(base());
    const locations = first.rows.filter((r) => r.table === 'location_master').map((r) => ({
      location_id: r.row.location_id, location_code: r.row.location_code, location_type: r.row.location_type,
      parent_location_id: r.row.parent_location_id, is_active: true, bin_feed_type: r.row.bin_feed_type ?? null,
    }));
    const assignments = first.rows.filter((r) => r.table === 'bin_diet_assignment').map((r) => `${r.row.bin_location_id}|${r.row.production_date}`);
    const second = planFeedMillDemo(base({ existingTypes: ['MILL', 'BIN'], locations, assignments }));
    expect(second.rows).toEqual([]);
    expect(second.exists.bin_diet_assignment).toBe(112);
  });

  it('makes the last bin BAGGED and routes bagged diets only to it', () => {
    const plan = planFeedMillDemo(base({ feedItems: [
      { item_id: 'b', item_code: 'B', item_type: 'FEED_BULK', item_type_name: 'Bulk Feed', diet_no: 1, is_active: true, order: 1 },
      { item_id: 'g', item_code: 'G', item_type: 'FEED_BAGGED', item_type_name: 'Bagged Feed', diet_no: 2, is_active: true, order: 2 },
    ] }));
    const last = plan.rows.find((r) => r.label === 'MILL-001/BIN-004')!.row;
    expect(last.bin_feed_type).toBe('BAGGED');
    expect(plan.rows.filter((r) => r.table === 'bin_diet_assignment' && r.row.bin_location_id === last.location_id).every((r) => r.row.feed_item_id === 'g')).toBe(true);
  });

  it('plans no assignments when no feed item qualifies', () => {
    const plan = planFeedMillDemo(base({ feedItems: [] }));
    expect(countByTable(plan.rows).bin_diet_assignment).toBeUndefined();
    expect(plan.notes.join()).toContain('No assignable feed item');
  });
});

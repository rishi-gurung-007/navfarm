import { validateFourFarmFixture, fixtureTopologyReport } from './demo/four-farm-feed-fixture';
import {
  KEEP_TABLES, assertTargetIsNotSource, batchesForFarm, buildChildDeleteSql, buildTestCompanyPlan, dayAt, deathSchedule, deathsOn,
  feedReceiptKg, historyDates, parseTestCompanyArgs, placeBatchesInSheds, planChildPaths, planCounts, planDeleteOrder, planKeptReferences, spreadOverStages,
  type FkEdge,
} from './seed-test-company.lib';

const fk = (table: string, refTable: string, nullable = false, column = `${refTable}_id`, refColumn = `${refTable}_id`): FkEdge => ({ table, column, refTable, refColumn, nullable });

describe('parseTestCompanyArgs', () => {
  it('needs --tenant and --company', () => {
    expect(() => parseTestCompanyArgs([])).toThrow(/--tenant is required/);
    expect(() => parseTestCompanyArgs(['--tenant', 'devco'])).toThrow(/--company is required/);
  });
  it('defaults to a read-only plan from devco / TRIPLEC over 14 days', () => {
    expect(parseTestCompanyArgs(['--tenant', 'devco', '--company', 'BLANKTST'])).toEqual({
      tenant: 'devco', company: 'BLANKTST', sourceTenant: 'devco', sourceCompany: 'TRIPLEC', days: 14, mode: 'plan',
    });
  });
  it('reads modes, source and days; refuses both --verify and --apply, unknown flags and bad values', () => {
    expect(parseTestCompanyArgs(['--tenant', 'a', '--company', 'b', '--apply', '--days', '7', '--source-company', 'X']).mode).toBe('apply');
    expect(parseTestCompanyArgs(['--tenant', 'a', '--company', 'b', '--verify']).mode).toBe('verify');
    expect(() => parseTestCompanyArgs(['--tenant', 'a', '--company', 'b', '--verify', '--apply'])).toThrow(/not both/);
    expect(() => parseTestCompanyArgs(['--tenant', 'a', '--company', 'b', '--force'])).toThrow(/Unknown argument/);
    expect(() => parseTestCompanyArgs(['--tenant', 'a', '--company'])).toThrow(/needs a value/);
    expect(() => parseTestCompanyArgs(['--tenant', 'a', '--company', 'b', '--days', '1'])).toThrow(/--days/);
  });
  it('refuses a target that is the source', () => {
    expect(() => assertTargetIsNotSource({ db: 'nf_devco', companyId: 'c1' }, { db: 'nf_devco', companyId: 'c1' })).toThrow(/source company/);
    expect(() => assertTargetIsNotSource({ db: 'nf_devco', companyId: 'c1' }, { db: 'nf_devco', companyId: 'c2' })).not.toThrow();
    expect(() => assertTargetIsNotSource({ db: 'nf_devco', companyId: 'c1' }, { db: 'nf_other', companyId: 'c1' })).not.toThrow();
  });
});

describe('planDeleteOrder', () => {
  it('deletes children before the tables they reference', () => {
    const { order, nullify } = planDeleteOrder(['batch_header', 'batch_daily_data', 'scheduler_line', 'scheduler_header', 'location_master'], [
      fk('batch_daily_data', 'batch_header'), fk('batch_daily_data', 'scheduler_line'), fk('scheduler_line', 'scheduler_header'),
      fk('scheduler_header', 'batch_header'), fk('batch_header', 'location_master'), fk('scheduler_header', 'location_master'),
    ]);
    const at = (t: string) => order.indexOf(t);
    expect(order).toHaveLength(5);
    expect(at('batch_daily_data')).toBeLessThan(at('scheduler_line'));
    expect(at('scheduler_line')).toBeLessThan(at('scheduler_header'));
    expect(at('scheduler_header')).toBeLessThan(at('batch_header'));
    expect(at('batch_header')).toBeLessThan(at('location_master'));
    expect(nullify).toEqual([]);
  });
  it('ignores edges to tables outside the delete set', () => {
    expect(planDeleteOrder(['a'], [fk('a', 'kept_table')]).order).toEqual(['a']);
  });
  it('unlinks a self reference through its nullable column', () => {
    const p = planDeleteOrder(['location_master'], [fk('location_master', 'location_master', true, 'parent_location_id', 'location_id')]);
    expect(p.order).toEqual(['location_master']);
    expect(p.nullify).toEqual([{ table: 'location_master', column: 'parent_location_id' }]);
  });
  it('breaks a cycle at a nullable key and still orders the rest', () => {
    const p = planDeleteOrder(['stage_master', 'breed_lifecycle', 'item'], [
      fk('stage_master', 'breed_lifecycle', true, 'default_lifecycle_id'), fk('breed_lifecycle', 'stage_master'), fk('breed_lifecycle', 'item'),
    ]);
    expect(p.nullify).toEqual([{ table: 'stage_master', column: 'default_lifecycle_id' }]);
    expect(p.order.indexOf('breed_lifecycle')).toBeLessThan(p.order.indexOf('stage_master'));
    expect(p.order.indexOf('breed_lifecycle')).toBeLessThan(p.order.indexOf('item'));
  });
  it('refuses a cycle with no nullable column, and a NOT NULL self reference', () => {
    expect(() => planDeleteOrder(['a', 'b'], [fk('a', 'b'), fk('b', 'a')])).toThrow(/cycle/);
    expect(() => planDeleteOrder(['a'], [fk('a', 'a')])).toThrow(/references itself/);
  });
});

describe('kept tables and tables without company_id', () => {
  it('lists kept tables that point into wiped ones', () => {
    const edges = [fk('user_master', 'cost_center_master', true, 'department_id', 'cost_center_id'), fk('batch_header', 'location_master'), fk('role_master', 'company_master')];
    const kept = planKeptReferences(new Set(['cost_center_master', 'batch_header', 'location_master']), new Set(['user_master', 'role_master', 'company_master']), edges);
    expect(kept.map((e) => `${e.table}.${e.column}`)).toEqual(['user_master.department_id']);
  });
  it('reaches a line table through its parent and a grandchild through two', () => {
    const edges = [
      fk('goods_receipt_line', 'goods_receipt', false, 'receipt_id', 'receipt_id'),
      fk('goods_receipt_line_detail', 'goods_receipt_line', false, 'line_id', 'line_id'),
      fk('lonely', 'kept_thing'),
    ];
    const paths = planChildPaths(new Set(['goods_receipt']), ['goods_receipt_line', 'goods_receipt_line_detail', 'lonely'], edges);
    expect(paths.map((p) => `${p.table}:${p.chain.length}`).sort()).toEqual(['goods_receipt_line:1', 'goods_receipt_line_detail:2']);
    const sql = buildChildDeleteSql(paths.find((p) => p.table === 'goods_receipt_line_detail')!);
    expect(sql).toBe('DELETE t0 FROM `goods_receipt_line_detail` t0 JOIN `goods_receipt_line` t1 ON t0.`line_id` = t1.`line_id` JOIN `goods_receipt` t2 ON t1.`receipt_id` = t2.`receipt_id` WHERE t2.company_id = ?');
  });
  it('never deletes the company, its people or their access', () => {
    for (const t of ['company_master', 'user_master', 'role_master', 'user_company_assignments', 'user_operational_area_assignment', 'operational_area_master', '__drizzle_migrations']) {
      expect(KEEP_TABLES.has(t)).toBe(true);
    }
    expect(KEEP_TABLES.has('batch_header')).toBe(false);
  });
});

describe('the test structure plan', () => {
  const plan = buildTestCompanyPlan();
  const counts = planCounts(plan);
  it('has 4 farms, 20 sheds (4/5/6/5), 20 stores/silos structure and 4-6 pens a shed', () => {
    expect(counts.farms).toBe(4);
    expect(counts.sheds).toBe(20);
    expect(plan.fixture.farms.map((f) => f.sheds.length)).toEqual([4, 5, 6, 5]);
    for (const f of plan.fixture.farms) for (const s of f.sheds) { expect(s.pens.length).toBeGreaterThanOrEqual(4); expect(s.pens.length).toBeLessThanOrEqual(6); }
    expect(counts.stores).toBe(4);
    expect(counts.pens).toBe(plan.fixture.farms.reduce((n, f) => n + f.sheds.reduce((m, s) => m + s.pens.length, 0), 0));
  });
  it('names farms clearly as test data, uniquely', () => {
    expect(plan.farmNames).toEqual(['TEST FARM 1', 'TEST FARM 2', 'TEST FARM 3', 'TEST FARM 4']);
    const names = plan.fixture.farms.flatMap((f) => [f.name, ...f.sheds.flatMap((s) => [s.name, ...s.pens.map((p) => p.name)]), ...f.silos.map((s) => s.name)]);
    expect(new Set(names).size).toBe(names.length);
  });
  it('passes the four-farm fixture validation with the four approved topologies', () => {
    expect(validateFourFarmFixture(plan.fixture)).toEqual([]);
    expect(fixtureTopologyReport(plan.fixture).map((t) => t.topology)).toEqual(['1:1', 'SHARED_SILO', 'MANY_TO_MANY', 'MIXED']);
  });
  it('has 16 batches and 160 registered animals: A animal-wise x4, B/C/D batch-wise', () => {
    expect(counts.batches).toBe(16);
    expect(counts.animalWiseBatches).toBe(4);
    expect(counts.batchWiseBatches).toBe(12);
    expect(counts.countOnlyBatches).toBe(8);
    expect(counts.registeredAnimals).toBe(160);
    for (const b of plan.batches.filter((x) => x.kind === 'C' || x.kind === 'D')) {
      expect(b.openingHead).toBeGreaterThanOrEqual(80);
      expect(b.openingHead).toBeLessThanOrEqual(120);
      expect(b.animals).toBe(0);
    }
  });
  it('puts every batch of a farm in its own shed, preferring a shed with a silo for its feed', () => {
    for (const farmNo of [1, 2, 3, 4]) {
      const placed = placeBatchesInSheds(farmNo, batchesForFarm(farmNo));
      expect(new Set(placed.values()).size).toBe(4);
    }
    // farm 2: batch A (gestation) goes where the gestation silo reaches, B (grower) where the grower silo reaches
    const f2 = placeBatchesInSheds(2, batchesForFarm(2));
    expect([1, 2, 3]).toContain(f2.get('A'));
    expect([4, 5]).toContain(f2.get('B'));
  });
});

describe('the history plan', () => {
  it('ends yesterday and never includes today', () => {
    const d = historyDates('2026-10-13', 14);
    expect(d).toHaveLength(14);
    expect(d[0]).toBe('2026-09-29');
    expect(d[13]).toBe('2026-10-12');
    expect(d).not.toContain('2026-10-13');
  });
  it('plans 1-2 deaths on two different days for count-only batches, two registered-animal events for B and one animal for A', () => {
    for (const farmNo of [1, 2, 3, 4]) {
      for (const kind of ['C', 'D'] as const) {
        const s = deathSchedule(kind, farmNo, 14);
        expect(s).toHaveLength(2);
        expect(s[0].dayNo).not.toBe(s[1].dayNo);
        for (const e of s) { expect(e.deaths).toBeGreaterThanOrEqual(1); expect(e.deaths).toBeLessThanOrEqual(2); expect(e.dayNo).toBeGreaterThanOrEqual(1); expect(e.dayNo).toBeLessThanOrEqual(14); }
      }
      const b = deathSchedule('B', farmNo, 14);
      expect(b).toHaveLength(2);
      expect(b[0].dayNo).not.toBe(b[1].dayNo);
      expect(deathSchedule('A', farmNo, 14)).toEqual([{ dayNo: expect.any(Number), deaths: 1 }]);
    }
    expect(deathsOn('A', 1, 14, deathSchedule('A', 1, 14)[0].dayNo)).toBe(1);
    expect(deathsOn('A', 1, 14, 1)).toBe(0);
  });
  it('keeps death days inside a shorter window', () => {
    expect(dayAt(3, 0.9)).toBeLessThanOrEqual(3);
    expect(dayAt(3, 0.01)).toBe(1);
  });
  it('sizes a receipt above the window demand but inside a silo', () => {
    expect(feedReceiptKg(1000, null)).toBe(2000);
    expect(feedReceiptKg(3000, null)).toBe(4800);
    expect(feedReceiptKg(30000, 12000)).toBe(9600);
  });
  it('spreads animals round-robin over stages', () => {
    const s = spreadOverStages(20, ['G', 'F', 'L']);
    expect(s.filter((x) => x === 'G')).toHaveLength(7);
    expect(s.filter((x) => x === 'F')).toHaveLength(7);
    expect(s.filter((x) => x === 'L')).toHaveLength(6);
  });
});

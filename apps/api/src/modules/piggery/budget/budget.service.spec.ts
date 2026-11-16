import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BudgetService } from './budget.service';

/** GM Dashboard Budget master, Task 3. The db double answers by table and records every insert and update. */
describe('BudgetService', () => {
  let service: BudgetService;
  let cls: ClsService;
  const rows = new Map<unknown, any[]>();
  const inserts: { table: unknown; values: any }[] = [];
  const updates: { table: unknown; set: any }[] = [];
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const lastWhere = new Map<unknown, { sql: string; params: unknown[] }>();
  /** Farms the scope lets through, standing in for the database answering locationOnFarm. */
  let visibleFarms: string[] | null = null;
  const render = (cond: any) => new MySqlDialect().sqlToQuery(cond);

  const chain = (table: unknown) => {
    let where: { sql: string; params: unknown[] } | undefined;
    const result = () => {
      let all = rows.get(table) ?? [];
      if (where && visibleFarms) {
        const scoped = where.sql.includes('farm_location_tree') || where.sql.includes('location_master');
        if (scoped && table === schema.gmBudget) all = all.filter((r) => visibleFarms!.includes(r.farm_id));
        if (scoped && table === schema.locationMaster) all = all.filter((r) => visibleFarms!.includes(r.location_id));
      }
      if (where && table === schema.locationMaster) {
        const hit = all.filter((l) => where!.params.includes(l.location_id));
        return hit.length ? hit : [];
      }
      if (where && table === schema.reportingPeriod) return all.filter((p) => where!.params.includes(p.period_id));
      if (where && table === schema.gmBudget && where.sql.includes('`budget_id` = ?')) {
        return all.filter((r) => where!.params.includes(r.budget_id));
      }
      if (where && table === schema.gmBudget && where.sql.includes('`budget_id` <> ?')) {
        return all.filter((r) => !where!.params.includes(r.budget_id));
      }
      return all;
    };
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, orderBy: () => self,
      where: (cond: unknown) => {
        if (cond) { where = render(cond); lastWhere.set(table, where); }
        return self;
      },
      limit: () => self, offset: () => self, for: () => self,
      then: (ok: any, err: any) => Promise.resolve(result()).then(ok, err),
    };
    return self;
  };
  const db: any = {
    select: jest.fn(() => ({ from: (t: unknown) => chain(t) })),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        inserts.push({ table, values: v });
        rows.get(table)?.push(...(Array.isArray(v) ? v : [v]));
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((set: any) => {
        updates.push({ table, set });
        return { where: jest.fn(async () => {
          // Apply to the only row of the table so a re-read sees the change.
          for (const r of rows.get(table) ?? []) Object.assign(r, set);
          return [{ affectedRows: 1 }];
        }) };
      }),
    })),
  };

  const farm = (over: any = {}) => ({
    location_id: 'farm-1', tenant_id: 't1', company_id: 'co-1', location_type: 'FARM', parent_location_id: null,
    is_active: true, deleted_at: null, location_code: 'F1', location_name: 'Farm One', ...over,
  });
  const period = (over: any = {}) => ({ period_id: 'p-1', tenant_id: 't1', company_id: 'co-1', period_code: '2026-P01', ...over });
  const line = (over: any = {}) => ({
    budget_id: 'b-1', tenant_id: 't1', company_id: 'co-1', period_id: 'p-1', farm_id: 'farm-1', metric_code: 'PIGS_TO_SLAUGHTER',
    amount_type: 'NUMBER', amount: '1000.0000', tolerance_pct: null, notes: null, is_active: true, deleted_at: null,
    period_code: '2026-P01', farm_code: 'F1', farm_name: 'Farm One', ...over,
  });
  const body = (over: any = {}) => ({ period_id: 'p-1', farm_id: 'farm-1', metric_code: 'PIGS_TO_SLAUGHTER', amount: 1000, ...over });
  const user = { userId: 'u-1' };

  beforeEach(async () => {
    rows.clear(); lastWhere.clear(); inserts.length = 0; updates.length = 0; visibleFarms = null;
    audit.log.mockClear();
    rows.set(schema.locationMaster, [farm()]);
    rows.set(schema.reportingPeriod, [period()]);
    rows.set(schema.gmBudget, []);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: ClsService, useValue: (cls = transactionCls(db)) },
        { provide: AuditLogService, useValue: audit },
      ],
    }).compile();
    service = module.get(BudgetService);
  });

  it("creates a line with the farm's company and the metric's amount type", async () => {
    rows.set(schema.locationMaster, [farm({ company_id: 'co-9' })]);
    rows.set(schema.reportingPeriod, [period({ company_id: 'co-9' })]);
    await service.create(body({ metric_code: 'GROSS_MARGIN_PCT', amount: 12.5, amount_type: 'NUMBER', company_id: 'co-evil' }), 't1', user);
    const ins = inserts.find((i) => i.table === schema.gmBudget)!;
    expect(ins.values).toMatchObject({ tenant_id: 't1', company_id: 'co-9', farm_id: 'farm-1', metric_code: 'GROSS_MARGIN_PCT', amount_type: 'PERCENT', created_by: 'u-1' });
    expect(ins.values.amount).toBe('12.5');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE' }));
  });

  it('refuses a period of another company', async () => {
    rows.set(schema.reportingPeriod, [period({ company_id: 'co-2' })]);
    await expect(service.create(body(), 't1', user)).rejects.toThrow('That period belongs to another company than the farm.');
    expect(inserts).toHaveLength(0);
  });

  it('refuses an unknown period', async () => {
    rows.set(schema.reportingPeriod, []);
    await expect(service.create(body(), 't1', user)).rejects.toThrow('That reporting period does not exist in this workspace.');
  });

  it('refuses a farm that is not a top-level FARM, or not the user\'s to see', async () => {
    rows.set(schema.locationMaster, []);
    await expect(service.create(body(), 't1', user)).rejects.toThrow('Choose an active farm that you can work with.');
    // The farm query itself carries the FARM / top-level / live conditions.
    expect(lastWhere.get(schema.locationMaster)!.sql).toContain('`location_type` = ?');
    expect(lastWhere.get(schema.locationMaster)!.sql).toContain('`parent_location_id` is null');
    expect(lastWhere.get(schema.locationMaster)!.sql).toContain('`is_active` = ?');
    // Outside the user's scope the farm is not found.
    rows.set(schema.locationMaster, [farm()]);
    useFarmScope(cls, { farmId: 'farm-2', restricted: true, farmBound: true, companyId: 'co-1', lobId: null });
    visibleFarms = ['farm-2'];
    await expect(service.create(body(), 't1', user)).rejects.toThrow('Choose an active farm that you can work with.');
    expect(lastWhere.get(schema.locationMaster)!.sql).toContain('farm_location_tree');
    expect(inserts).toHaveLength(0);
  });

  it('refuses a second live line for the same period, farm and metric', async () => {
    rows.set(schema.gmBudget, [line()]);
    await expect(service.create(body(), 't1', user)).rejects.toThrow('already has a budget');
    expect(inserts).toHaveLength(0);
    // The duplicate check looks only at live lines.
    const w = lastWhere.get(schema.gmBudget)!;
    expect(w.sql).toContain('`is_active` = ?');
    expect(w.sql).toContain('`deleted_at` is null');
  });

  it('allows a new line after the old one was deactivated', async () => {
    rows.set(schema.gmBudget, [line()]);
    await service.deactivate('b-1', 't1', user);
    expect(updates.find((u) => u.table === schema.gmBudget)!.set).toMatchObject({ is_active: false });
    // The double does not apply the duplicate filter, so an empty live set stands for "only a deactivated line exists".
    rows.set(schema.gmBudget, []);
    await service.create(body(), 't1', user);
    expect(inserts.filter((i) => i.table === schema.gmBudget)).toHaveLength(1);
  });

  it('edit cannot change period, farm or metric', async () => {
    rows.set(schema.gmBudget, [line()]);
    await expect(service.update('b-1', { metric_code: 'PBT' }, 't1', user)).rejects.toThrow('cannot be changed');
    await expect(service.update('b-1', { farm_id: 'farm-2' }, 't1', user)).rejects.toThrow('cannot be changed');
    await expect(service.update('b-1', { period_id: 'p-2' }, 't1', user)).rejects.toThrow('cannot be changed');
    expect(updates).toHaveLength(0);
    // Repeating the stored values is harmless; amount, tolerance and notes change.
    await service.update('b-1', { metric_code: 'PIGS_TO_SLAUGHTER', farm_id: 'farm-1', period_id: 'p-1', amount: 1200, tolerance_pct: 5, notes: 'Revised' }, 't1', user);
    expect(updates.find((u) => u.table === schema.gmBudget)!.set).toMatchObject({ amount: '1200', tolerance_pct: '5', notes: 'Revised', updated_by: 'u-1' });
    expect(Object.keys(updates[0].set)).not.toContain('metric_code');
  });

  it("list and read hide lines of farms outside the user's scope", async () => {
    rows.set(schema.gmBudget, [line(), line({ budget_id: 'b-2', farm_id: 'farm-2' })]);
    useFarmScope(cls, { farmId: 'farm-1', restricted: true, farmBound: true, companyId: 'co-1', lobId: null });
    visibleFarms = ['farm-1'];
    const page = await service.findAll({}, 't1');
    expect(page.data.map((r: any) => r.budget_id)).toEqual(['b-1']);
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({ period_code: '2026-P01', farm_code: 'F1', farm_name: 'Farm One', metric_label: 'Pigs to Slaughter', unit: 'head' });
    expect(lastWhere.get(schema.gmBudget)!.sql).toContain('farm_location_tree');
    await expect(service.findOne('b-2', 't1')).rejects.toThrow('That budget line is not available in this workspace.');
    expect((await service.findOne('b-1', 't1')).budget_id).toBe('b-1');
  });

  it('deactivate then restore', async () => {
    rows.set(schema.gmBudget, [line()]);
    await service.deactivate('b-1', 't1', user);
    expect(rows.get(schema.gmBudget)![0].is_active).toBe(false);
    await service.restore('b-1', 't1', user);
    expect(rows.get(schema.gmBudget)![0].is_active).toBe(true);
    expect(audit.log.mock.calls.map((c) => c[0].action)).toEqual(['DEACTIVATE', 'RESTORE']);
  });

  it('restore refuses when a live line for the same key now exists', async () => {
    rows.set(schema.gmBudget, [line({ is_active: false }), line({ budget_id: 'b-2' })]);
    await expect(service.restore('b-1', 't1', user)).rejects.toThrow('already has a budget');
    expect(updates).toHaveLength(0);
  });

  it('amount and tolerance are validated through budgetProblems', async () => {
    await expect(service.create(body({ amount: 'abc' }), 't1', user)).rejects.toThrow('Pigs to Slaughter needs a number as its budget.');
    await expect(service.create(body({ amount: -1 }), 't1', user)).rejects.toThrow('cannot be negative');
    await expect(service.create(body({ tolerance_pct: 101 }), 't1', user)).rejects.toThrow('Tolerance must be blank or between 0 and 100.');
    await expect(service.create(body({ metric_code: 'NOPE' }), 't1', user)).rejects.toThrow('Metric must be one of');
    await expect(service.create(body({ amount: 1e14 }), 't1', user)).rejects.toThrow('too large');
    await expect(service.create(body({ notes: 'x'.repeat(501) }), 't1', user)).rejects.toThrow('500 characters');
    expect(inserts).toHaveLength(0);
  });

  it('the metric catalogue shows no bound as null, never the safe-integer floor', () => {
    const list = service.metrics();
    const gm = list.find((m) => m.code === 'GROSS_MARGIN')!;
    expect(gm.min).toBeNull();
    expect(gm.max).toBeNull();
    expect(list.find((m) => m.code === 'PIGS_TO_SLAUGHTER')!.min).toBe(0);
    expect(list.find((m) => m.code === 'GROSS_MARGIN_PCT')).toMatchObject({ min: -100, max: 100 });
  });
});

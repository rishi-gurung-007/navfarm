import { MySqlDialect } from 'drizzle-orm/mysql-core';
import * as schema from '../../../core/database/schema';
import { PiggeryAnalyticsService } from './piggery-analytics.service';

/** GM Dashboard Budget master, Task 5: the dashboard reads its budget lines in one query. */
describe('PiggeryAnalyticsService budget lines', () => {
  const render = (cond: any) => new MySqlDialect().sqlToQuery(cond);
  let tables: unknown[];
  let wheres: { sql: string; params: unknown[] }[];
  let answer: any[];
  const db: any = {
    select: jest.fn(() => ({
      from: (t: unknown) => {
        tables.push(t);
        const self: any = {
          where: (cond: unknown) => {
            wheres.push(render(cond));
            return self;
          },
          then: (ok: any, err: any) => Promise.resolve(answer).then(ok, err),
        };
        return self;
      },
    })),
  };
  const service = new PiggeryAnalyticsService({ get: () => db } as any, {} as any);
  const budgetLines = (farmIds: string[], periodIds: string[]) =>
    (service as any).budgetLines('t1', farmIds, periodIds);

  beforeEach(() => {
    tables = [];
    wheres = [];
    answer = [];
    db.select.mockClear();
  });

  it("reads all budget lines of the visible farms and the business year's periods in one query", async () => {
    answer = [
      { period_id: 'p1', farm_id: 'f1', metric_code: 'GROSS_MARGIN', amount: '1200.5000', tolerance_pct: '5.00' },
      { period_id: 'p2', farm_id: 'f2', metric_code: 'AVG_CDM', amount: '80.0000', tolerance_pct: null },
      { period_id: 'p2', farm_id: 'f2', metric_code: 'NOT_A_METRIC', amount: '1.0000', tolerance_pct: null },
    ];
    const lines = await budgetLines(['f1', 'f2'], ['p1', 'p2']);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(tables).toEqual([schema.gmBudget]);
    const w = wheres[0];
    expect(w.sql).toContain('`gm_budget`.`tenant_id` = ?');
    expect(w.sql).toContain('`gm_budget`.`farm_id` in (?, ?)');
    expect(w.sql).toContain('`gm_budget`.`period_id` in (?, ?)');
    expect(w.sql).toContain('`gm_budget`.`is_active` = ?');
    expect(w.sql).toContain('`gm_budget`.`deleted_at` is null');
    expect(w.params).toEqual(expect.arrayContaining(['t1', 'f1', 'f2', 'p1', 'p2', true]));
    expect(lines).toEqual([
      { period_id: 'p1', farm_id: 'f1', metric_code: 'GROSS_MARGIN', amount: 1200.5, tolerance_pct: 5 },
      { period_id: 'p2', farm_id: 'f2', metric_code: 'AVG_CDM', amount: 80, tolerance_pct: null },
    ]);
  });

  it('no visible farm or no period asks nothing', async () => {
    expect(await budgetLines([], ['p1'])).toEqual([]);
    expect(await budgetLines(['f1'], [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

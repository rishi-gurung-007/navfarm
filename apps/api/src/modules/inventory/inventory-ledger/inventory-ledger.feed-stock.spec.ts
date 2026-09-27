import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { InventoryLedgerService } from './inventory-ledger.service';

describe('InventoryLedgerService.getFeedStockAsOf (Plan R, D19 / Q6)', () => {
  const wheres: unknown[] = [];
  const results: unknown[][] = [];
  const chain = () => {
    const rows = results.shift() ?? [];
    const self: any = {
      from: () => self,
      where: (w: unknown) => { wheres.push(w); return self; },
      groupBy: () => self,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const db = { select: jest.fn(() => chain()) };
  const render = (w: unknown) => new MySqlDialect().sqlToQuery(w as any);

  beforeEach(() => {
    wheres.length = 0;
    results.length = 0;
    db.select.mockClear();
  });

  it('sums what was posted before the stock date, and reads non-feeding movements from it to the horizon', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-1', restricted: false, companyId: 'co-1', lobId: null });
    results.push(
      [
        { warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', qty: '1500.0000' },
        { warehouse_id: null, item_id: 'i9', item_code: 'X', uom: 'KG', qty: '5.0000' },
      ],
      [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-27', qty: '3000.0000' }],
    );
    const out = await new InventoryLedgerService(cls).getFeedStockAsOf(
      { companyId: 'co-1', warehouseIds: ['s1'], stockDate: '2026-09-26', horizonTo: '2026-11-10' }, 'tenant-1',
    );
    expect(out).toEqual({
      opening: [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 }],
      movements: [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-27', qty: 3000 }],
    });
    const [opening, movements] = wheres.map(render);
    expect(opening.sql).toMatch(/`posting_date` < \?/);
    expect(opening.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1', 's1', 'POSITIVE', 'NEGATIVE', '2026-09-26']));
    expect(movements.sql).toMatch(/`posting_date` >= \?/);
    expect(movements.sql).toMatch(/`document_type` <> \?/);
    expect(movements.sql).toMatch(/`transaction_type` <> \?/);
    expect(movements.params).toEqual(expect.arrayContaining(['2026-09-26', '2026-11-10', 'BATCH', 'CONSUMPTION']));
  });

  it('stays inside the effective farm and, for a restricted caller, the LOB (farmConditions)', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-1', restricted: true, companyId: 'co-1', lobId: 'lob-1' });
    results.push([], []);
    await new InventoryLedgerService(cls).getFeedStockAsOf(
      { companyId: 'co-1', warehouseIds: ['s1'], stockDate: '2026-09-26', horizonTo: '2026-09-30' }, 'tenant-1',
    );
    for (const w of wheres.map(render)) {
      expect(w.sql).toMatch(/`lob_id` = \?/);
      expect(w.params).toEqual(expect.arrayContaining(['farm-1', 'lob-1']));
    }
  });

  it('reads nothing for no locations', async () => {
    const out = await new InventoryLedgerService(transactionCls(db)).getFeedStockAsOf(
      { companyId: 'co-1', warehouseIds: [], stockDate: '2026-09-26', horizonTo: '2026-09-30' }, 'tenant-1',
    );
    expect(out).toEqual({ opening: [], movements: [] });
    expect(db.select).not.toHaveBeenCalled();
  });
});

import { InventoryLedgerService } from './inventory-ledger.service';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';

/**
 * Item 3: reverseEntry used to stamp its two inserts with
 * `new Date().toISOString().slice(0,19)` — UTC — while every other ledger
 * write (writePositiveEntry, writeNegativeEntry, applyFifo) leaves created_at
 * to the column's own DEFAULT, which resolves to the DB server's local time.
 * On a server whose local time is ahead of UTC, a same-day reversal's
 * created_at could sort *before* the entry it reverses. Asserting no
 * created_at key at all (rather than a specific value) is the direct
 * regression check: before the fix the insert always carried one.
 */
describe('InventoryLedgerService reverseEntry — created_at', () => {
  const original = {
    ledger_id: 'ledger-1', tenant_id: 'tenant-1', entry_type: 'NEGATIVE',
    quantity: '0', amount: '0', created_at: '2026-09-14 08:00:00',
  };

  it('lets the column default supply created_at on the reversal ledger row instead of stamping UTC', async () => {
    const insertedValues: any[] = [];
    const db: any = {
      select: jest.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ for: async () => [original] }) }) }) // original, locked
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) // not already reversed
        .mockReturnValueOnce({ from: () => ({ where: async () => [] }) }) // no FIFO applications to unwind
        .mockReturnValueOnce({ from: () => ({ where: async () => [] }) }) // no ledger lines to give back
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ ledger_id: 'reversal-1' }] }) }) }), // loadOne read-back
      insert: jest.fn(() => ({ values: async (v: any) => { insertedValues.push(v); return undefined; } })),
      update: jest.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    const service = new InventoryLedgerService(transactionCls(db));

    await service.reverseEntry('ledger-1', 'tenant-1', 'user-1');

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).not.toHaveProperty('created_at');
    // The reversal is a new entry: copying the original's Entry No. would break the unique key.
    expect(insertedValues[0]).not.toHaveProperty('entry_no');
    // The original row's own created_at must not leak through the `...original`
    // spread either — that would silently backdate the reversal to look as if
    // it were written when the original entry was.
    expect(insertedValues[0].created_at).not.toBe('2026-09-14 08:00:00');
  });
});

/**
 * A query-builder double for applyFifo: every `.where()` answers the same chain whatever it is asked, and the
 * reads are told apart by what they select. It reads, in order, the item, the receipt layers (`.orderBy().for()`),
 * the lots' balances (`.groupBy()`, entries then lines) and, for a layer drawn empty, what was already applied to it.
 */
const costingDb = (opts: { item?: object; layers: any[]; lotBalanceRows?: any[]; book?: { quantity: string; value: string }; onWhere?: (condition: any) => void }) => {
  const applications: any[] = [];
  const db: any = { current: '' };
  const chain = (result: any, cols?: any) => {
    const done = Promise.resolve(result);
    return Object.assign(done, {
      limit: async () => result,
      orderBy: () => ({ for: async () => opts.layers }),
      groupBy: async () => (cols && 'quantity' in cols && !('expiry_date' in cols) ? [] : result),
    });
  };
  db.select = (cols?: any) => ({
    from: () => ({
      where: (condition: any) => {
        opts.onWhere?.(condition);
        if (cols && 'valuation_method' in cols) return chain([opts.item ?? { valuation_method: 'FIFO', standard_cost: null }]);
        if (cols && 'applied' in cols) {
          return chain([{ applied: String(applications.filter((a) => a.inbound_ledger_id === db.current).reduce((n, a) => n + Number(a.applied_cost_amount), 0)) }]);
        }
        // The signed ledger totals the moving average is taken from.
        if (cols && 'value' in cols) return chain([opts.book ?? { quantity: String(opts.layers.reduce((n, l) => n + Number(l.remaining_quantity), 0)), value: String(opts.layers.reduce((n, l) => n + Number(l.remaining_quantity) * Number(l.rate), 0)) }]);
        if (cols && 'lot_no' in cols) return chain(opts.lotBalanceRows ?? [], cols);
        if (cols && 'code' in cols) return chain([]);
        return chain(opts.layers);
      },
    }),
  });
  db.insert = () => ({ values: async (v: any) => { db.current = v.inbound_ledger_id; applications.push(v); } });
  db.update = () => ({ set: (v: any) => ({ where: async () => { opts.layers.forEach((l) => { if (l.ledger_id === db.current) l.remaining_quantity = v.remaining_quantity; }); } }) });
  return { db, applications };
};

describe('Inventory costing — by the item\'s costing method', () => {
  const base = { tenantId: 't', companyId: 'c', itemId: 'i', outboundLedgerId: 'out', applicationDate: '2026-10-01' };
  const make = (opts: Parameters<typeof costingDb>[0]) => {
    const { db, applications } = costingDb(opts);
    const service = new InventoryLedgerService({ get: () => db } as any);
    return { db, applications, service };
  };
  const two = () => [
    { ledger_id: 'a', quantity: '100', remaining_quantity: '100', rate: '20', amount: '2000', warehouse_id: 'w' },
    { ledger_id: 'b', quantity: '100', remaining_quantity: '100', rate: '25', amount: '2500', warehouse_id: 'w' },
  ];

  it('FIFO draws the oldest receipt first and costs 100 @ 20 then 50 @ 25 as 3,250', async () => {
    const layers = two();
    const { db, applications, service } = make({ layers });
    const result = await service.applyFifo({ ...base, quantity: 150 }, db);
    expect(result.totalCost).toBe(3250);
    expect(applications.map((a) => [a.inbound_ledger_id, a.applied_qty, a.applied_cost_amount])).toEqual([['a', '100', '2000'], ['b', '50', '1250']]);
    expect(layers.map((l) => l.remaining_quantity)).toEqual(['0', '50']);
  });

  it('FIFO costs 3 units received for 10.00 consumed 1 + 1 + 1 as exactly 10.00', async () => {
    const layers = [{ ledger_id: 'a', quantity: '3', remaining_quantity: '3', rate: '3.333333', amount: '10', warehouse_id: 'w' }];
    const { db, service } = make({ layers });
    const costs = [(await service.applyFifo({ ...base, quantity: 1 }, db)).totalCost, (await service.applyFifo({ ...base, quantity: 1 }, db)).totalCost, (await service.applyFifo({ ...base, quantity: 1 }, db)).totalCost];
    expect(costs).toEqual([3.3333, 3.3333, 3.3334]);
    expect(Number(costs.reduce((n, c) => n + c, 0).toFixed(4))).toBe(10);
  });

  it('the lot chosen does not move the cost: stock issued from the newer lot is still costed from the oldest receipt', async () => {
    const layers = [
      { ledger_id: 'old', quantity: '20', remaining_quantity: '20', rate: '120', amount: '2400', warehouse_id: 'w', lot_no: 'LOT-OLD' },
      { ledger_id: 'new', quantity: '30', remaining_quantity: '30', rate: '80', amount: '2400', warehouse_id: 'w', lot_no: 'LOT-NEW' },
    ];
    const { db, applications, service } = make({
      layers,
      lotBalanceRows: [{ lot_no: 'LOT-NEW', quantity: '30', expiry_date: null, receipt_date: '2026-10-02' }],
    });
    const result = await service.applyFifo({ ...base, quantity: 10, lots: [{ lotNo: 'LOT-NEW', quantity: 10 }] }, db);
    // LOT-NEW is where the stock came out of; FIFO still prices it at the oldest receipt, 10 x 120.
    expect(result.totalCost).toBe(1200);
    expect(applications.map((a) => [a.inbound_ledger_id, a.applied_qty])).toEqual([['old', '10']]);
  });

  describe('AVERAGE is a moving average of the ledger', () => {
    const avg = { valuation_method: 'AVG', standard_cost: null };
    const layers = () => [
      { ledger_id: 'a', quantity: '10', remaining_quantity: '10', rate: '10', amount: '100', warehouse_id: 'w' },
      { ledger_id: 'b', quantity: '10', remaining_quantity: '10', rate: '20', amount: '200', warehouse_id: 'w' },
    ];

    it('prices the draw at the average of what is on hand', async () => {
      const { db, applications, service } = make({ layers: layers(), item: avg });
      const result = await service.applyFifo({ ...base, quantity: 10 }, db);
      expect(result.totalCost).toBe(150);
      expect(applications.reduce((n, a) => n + Number(a.applied_cost_amount), 0)).toBe(150);
    });

    it('does not move the average after an earlier draw: 10 @ 10 + 10 @ 20, issue 5 then 10 costs 75 then 150', async () => {
      // After the first issue the receipts' layers are 5 @ 10 and 10 @ 20 (a layer average of 16.67), but the
      // ledger holds 15 units worth 225: still 15 each.
      const afterFirstIssue = [
        { ledger_id: 'a', quantity: '10', remaining_quantity: '5', rate: '10', amount: '100', warehouse_id: 'w' },
        { ledger_id: 'b', quantity: '10', remaining_quantity: '10', rate: '20', amount: '200', warehouse_id: 'w' },
      ];
      const { db, service } = make({ layers: afterFirstIssue, item: avg, book: { quantity: '15', value: '225' } });
      expect((await service.applyFifo({ ...base, quantity: 10 }, db)).totalCost).toBe(150);
    });

    it('is taken from the ledger without the issue being priced', async () => {
      const queries: any[] = [];
      const { db, service } = make({ layers: layers(), item: avg, onWhere: (c) => queries.push(new MySqlDialect().sqlToQuery(c)) });
      await service.applyFifo({ ...base, quantity: 1 }, db);
      const bookQuery = queries.find((q) => q.sql.includes('`entry_type` in') && q.sql.includes('`ledger_id` <> ?') && !q.sql.includes('`lot_no`'));
      expect(bookQuery.params).toEqual(expect.arrayContaining(['POSITIVE', 'NEGATIVE', 'TRANSFER', 'out']));
    });

    it('falls back to each receipt\'s own price when the ledger holds no quantity to average over', async () => {
      const { db, service } = make({ layers: layers(), item: avg, book: { quantity: '0', value: '0' } });
      expect((await service.applyFifo({ ...base, quantity: 15 }, db)).totalCost).toBe(200);
    });
  });

  it('STANDARD prices the draw at the item\'s standard cost, whatever the receipts cost', async () => {
    const { db, service } = make({ layers: two(), item: { valuation_method: 'STANDARD', standard_cost: '12' } });
    expect((await service.applyFifo({ ...base, quantity: 5 }, db)).totalCost).toBe(60);
  });

  it('refuses a lot that holds less than asked, naming it, and draws nothing', async () => {
    const { db, applications, service } = make({
      layers: two(),
      lotBalanceRows: [{ lot_no: 'LOT-A', quantity: '4', expiry_date: null, receipt_date: '2026-10-01' }],
    });
    await expect(service.applyFifo({ ...base, quantity: 6, lots: [{ lotNo: 'LOT-A', quantity: 6 }] }, db)).rejects.toThrow(/Insufficient stock/);
    expect(applications).toHaveLength(0);
  });

  it('does not count the entry being posted against the lot it is taking from', async () => {
    // The outbound row is inserted before the check runs; a lot holding exactly what is asked must still pass.
    const queries: any[] = [];
    const { db } = make({
      layers: two(),
      lotBalanceRows: [{ lot_no: 'LOT-A', quantity: '6', expiry_date: null, receipt_date: '2026-10-01' }],
      onWhere: (c) => queries.push(new MySqlDialect().sqlToQuery(c)),
    });
    const service = new InventoryLedgerService({ get: () => db } as any);
    await service.applyFifo({ ...base, quantity: 6, lots: [{ lotNo: 'LOT-A', quantity: 6 }] }, db);
    const lotQuery = queries.find((q) => q.sql.includes('`lot_no` in'));
    expect(lotQuery.sql).toContain('`ledger_id` <> ?');
    expect(lotQuery.params).toContain('out');
  });

  it('refuses lots that do not add up to the quantity', async () => {
    const { db, service } = make({ layers: two() });
    await expect(service.applyFifo({ ...base, quantity: 10, lots: [{ lotNo: 'A', quantity: 4 }, { lotNo: 'B', quantity: 4 }] }, db))
      .rejects.toThrow('The lots add up to 8 but the quantity is 10');
  });
});

describe('Inventory FIFO — serial-tracked draws', () => {
  const params = { tenantId: 't', companyId: 'c', itemId: 'i', outboundLedgerId: 'out', applicationDate: '2026-10-01' };
  const noDb: any = { select: jest.fn(), insert: jest.fn(), update: jest.fn() };
  const service = new InventoryLedgerService({ get: () => noDb } as any);

  it('refuses a quantity that does not equal the number of serials, before touching stock', async () => {
    await expect(service.applyFifo({ ...params, quantity: 2, serialNo: 'SN1' }, noDb))
      .rejects.toThrow('1 serial number(s) selected but the quantity is 2');
    expect(noDb.select).not.toHaveBeenCalled();
  });

  it('refuses the same serial listed twice', async () => {
    await expect(service.applyFifo({ ...params, quantity: 2, serialNo: 'SN1, SN1' }, noDb))
      .rejects.toThrow('A serial number is listed twice: SN1');
    expect(noDb.insert).not.toHaveBeenCalled();
  });
});

describe('Inventory FIFO', () => {
  const params = { tenantId: 'tenant', companyId: 'company', itemId: 'item', outboundLedgerId: 'out', quantity: 1, applicationDate: '2026-09-14' };

  it('checks the selected lot against what the lot holds, refusing its shortage without drawing anything', async () => {
    const queries: any[] = [];
    const { db, applications } = costingDb({ layers: [], onWhere: (c) => queries.push(new MySqlDialect().sqlToQuery(c)) });
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.applyFifo({ ...params, lotNo: 'selected-lot' }, db)).rejects.toThrow(/Insufficient stock/);
    // The lot is looked up by name, on its own; the receipt layers are not filtered by it (cost follows the item's method).
    expect(queries.some((q) => q.sql.includes('`lot_no` in') && q.params.includes('selected-lot'))).toBe(true);
    expect(queries.filter((q) => q.sql.includes('`entry_type`') && q.sql.includes('`remaining_quantity`')).every((q) => !q.params.includes('selected-lot'))).toBe(true);
    expect(applications).toHaveLength(0);
  });

  it('persists the outbound lot and forwards it to FIFO', async () => {
    const insert = jest.fn(async () => undefined);
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
        item_id: 'item', item_code: 'item', item_name: 'Item',
      }] }) }) }),
      transaction: async (work: any) => work(db),
      insert: () => ({ values: insert }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const service = new InventoryLedgerService({ get: () => db } as any);
    const fifo = jest.spyOn(service, 'applyFifo').mockResolvedValue({ totalCost: 10, averageRate: 10 });
    await service.writeNegativeEntry({ tenantId: 'tenant', companyId: 'company', itemId: 'item',
      documentType: 'BATCH', documentNo: 'batch', postingDate: '2026-09-14',
      transactionType: 'CONSUMPTION', quantity: 1, uom: 'KG', lotNo: 'selected-lot' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ lot_no: 'selected-lot' }));
    expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ lotNo: 'selected-lot' }), db);
  });

  it('writes one ledger entry for several lots, with a line per lot and no lot on the entry', async () => {
    const inserted: Array<{ table: unknown; values: any }> = [];
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
        item_id: 'item', item_code: 'item', item_name: 'Item',
      }] }) }) }),
      transaction: async (work: any) => work(db),
      insert: (table: unknown) => ({ values: async (values: any) => { inserted.push({ table, values }); } }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const service = new InventoryLedgerService({ get: () => db } as any);
    jest.spyOn(service, 'applyFifo').mockResolvedValue({ totalCost: 3440, averageRate: 95.56, lotExpiry: new Map([['A', '2027-01-01'], ['B', null]]) } as any);
    await service.writeNegativeEntry({ tenantId: 'tenant', companyId: 'company', itemId: 'item',
      documentType: 'BATCH', documentNo: 'batch', postingDate: '2026-09-14',
      transactionType: 'CONSUMPTION', quantity: 36, uom: 'KG', lots: [{ lotNo: 'A', quantity: 30 }, { lotNo: 'B', quantity: 6 }] });
    const header = inserted.find((i) => !Array.isArray(i.values))!.values;
    expect(header).toEqual(expect.objectContaining({ quantity: '-36', lot_no: null }));
    const lines = inserted.find((i) => Array.isArray(i.values))!.values;
    expect(lines.map((l: any) => [l.line_no, l.lot_no, l.quantity, l.expiry_date])).toEqual([[1, 'A', '-30', '2027-01-01'], [2, 'B', '-6', null]]);
  });

  it('refuses naming one lot on the entry and several as lines', async () => {
    const db: any = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ item_id: 'item', item_code: 'item', item_name: 'Item' }] }) }) }) };
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.writeNegativeEntry({ tenantId: 'tenant', companyId: 'company', itemId: 'item', documentType: 'BATCH', documentNo: 'b', postingDate: '2026-09-14',
      transactionType: 'CONSUMPTION', quantity: 2, uom: 'KG', lotNo: 'A', lots: [{ lotNo: 'A', quantity: 2 }] })).rejects.toThrow('Name either one lot on the entry or several lots as lines');
  });

  it('refuses a shortfall without manufacturing an opening layer', async () => {
    const { db, applications } = costingDb({ layers: [] });
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.applyFifo(params, db)).rejects.toThrow(/Insufficient stock/);
    expect(applications).toHaveLength(0);
  });

  it('restricts source layers to the issuing company', async () => {
    let layerQuery: any;
    const { db } = costingDb({ layers: [], onWhere: (c) => { const q = new MySqlDialect().sqlToQuery(c); if (q.sql.includes('`entry_type`') && !layerQuery) layerQuery = q; } });
    const service = new InventoryLedgerService({ get: () => db } as any);
    await service.applyFifo(params, db).catch(() => undefined);
    expect(layerQuery.sql).toContain('`company_id` = ?');
    expect(layerQuery.params).toContain('company');
  });
});

/**
 * Phase 1 access foundation, Task 8: a ledger row's farm comes from its
 * warehouse when it has one, or from its batch when it doesn't (a batch
 * consumption entry — see writeNegativeEntry's callers in batch.service.ts —
 * carries no warehouse_id). findAll's own .where() argument is captured and
 * rendered back to SQL, same approach as breeding.service.spec.ts and
 * batch-transfer.service.spec.ts.
 */
describe('InventoryLedgerService farm scope', () => {
  let service: InventoryLedgerService;
  let cls: ReturnType<typeof transactionCls>;
  const dialect = new MySqlDialect();

  let capturedWhere: unknown;
  const renderedWhere = () => dialect.sqlToQuery(capturedWhere as any).sql;

  const chain: any = {
    from: () => chain,
    where: (cond: unknown) => { capturedWhere = cond; return chain; },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve([]),
  };
  const mockDb = { select: jest.fn(() => chain) };

  beforeEach(() => {
    capturedWhere = undefined;
    cls = transactionCls(mockDb);
    service = new InventoryLedgerService(cls);
  });

  it('includes batch issues with no location through their batch farm', async () => {
    useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toContain('location_master lf');
    expect(where).toMatch(/warehouse_id` is null.*batch_header b/s);
  });

  it('returns every ledger row when no farm is selected', async () => {
    useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });

    await service.findAll({} as any, 'tenant-1');

    expect(renderedWhere()).not.toContain('location_master lf');
  });

  it('bounds ledger rows by company and LOB when an operational admin selects no farm', async () => {
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

    await service.findAll({} as any, 'tenant-1');

    const where = renderedWhere();
    expect(where).toContain('`inventory_ledger`.`company_id` = ?');
    expect(where).toContain('`inventory_ledger`.`lob_id` = ?');
  });

  it('returns a newly written destination-farm entry without applying the HTTP read scope to its internal read-back', async () => {
    const insertedLedger = { ledger_id: 'ledger-new', warehouse_id: 'warehouse-k', rate: '12.5' };
    const readBackQueries: string[] = [];
    const tableDb: any = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            if (table === schema.inventoryLedger) {
              readBackQueries.push(dialect.sqlToQuery(condition as any).sql);
              return { limit: async () => [insertedLedger] };
            }
            return { limit: async () => [{ item_id: 'item-1', item_code: 'FEED-1', item_name: 'Feed' }] };
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    };
    const scopedCls = transactionCls(tableDb);
    useFarmScope(scopedCls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    const scopedService = new InventoryLedgerService(scopedCls);

    const result = await scopedService.writePositiveEntry({
      tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1',
      documentType: 'STOCK_TRANSFER', documentNo: 'ST-1', postingDate: '2026-09-14',
      transactionType: 'TRANSFER_RECEIPT', quantity: 5, uom: 'KG', rate: 12.5,
      warehouseId: 'warehouse-k',
    });

    expect(result).toBe(insertedLedger);
    expect(readBackQueries).toHaveLength(1);
    expect(readBackQueries[0]).not.toContain('location_master lf');
    expect(readBackQueries[0]).not.toContain('`inventory_ledger`.`company_id` = ?');
  });
});

/**
 * Part E Task 4: a receipt values its stock at the rate its shipment carried
 * out of the source — |Σamount| ÷ |Σquantity| of that shipment line's
 * TRANSFER_SHIPMENT rows — and refuses a shipment line with no posted leg.
 */
describe('InventoryLedgerService transferShipmentRate', () => {
  const dialect = new MySqlDialect();
  function serviceReturning(rows: unknown[]) {
    const seen: { where?: unknown } = {};
    const db: any = { select: jest.fn(() => ({ from: () => ({ where: async (cond: unknown) => { seen.where = cond; return rows; } }) })) };
    return { service: new InventoryLedgerService(transactionCls(db)), seen };
  }

  it('divides the shipment line\'s total cost by its total quantity', async () => {
    const { service, seen } = serviceReturning([{ amount: '-15', qty: '-6' }]);
    await expect(service.transferShipmentRate({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1' })).resolves.toBe(2.5);
    const q = dialect.sqlToQuery(seen.where as any);
    expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'STOCK_TRANSFER', 'SH-2026-0001', 'line-1', 'TRANSFER_SHIPMENT']));
  });

  it('refuses a shipment line with no posted ledger entry', async () => {
    const { service } = serviceReturning([{ amount: '0', qty: '0' }]);
    await expect(service.transferShipmentRate({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1' }))
      .rejects.toThrow('Shipment SH-2026-0001 has no posted ledger entry for this line.');
  });
});

/**
 * Part E Task 4, fix round 1: each transfer event writes exactly one leg, and
 * the receipt that closes a shipment line takes its remaining value so
 * Inventory in Transit (1040) nets to zero.
 */
describe('InventoryLedgerService transfer legs', () => {
  const dialect = new MySqlDialect();
  const ITEM = { item_id: 'item-1', item_code: 'ITM-1', item_name: 'Item', is_lot_tracked: 0, is_serial_tracked: 0 };

  /** A db that records ledger inserts and answers SUM(amount) from them, stored at decimal(18,4) like MySQL. */
  function ledgerDb(shippedAmount: string) {
    const inserted: any[] = [];
    const db: any = {
      select: jest.fn(() => ({ from: () => ({ where: (cond: any) => {
        const params = dialect.sqlToQuery(cond).params as unknown[];
        const sum = () => {
          if (params.includes('TRANSFER_SHIPMENT')) return [{ amount: shippedAmount }];
          const nos = params.filter((p) => typeof p === 'string' && p.startsWith('RC-'));
          const total = inserted.filter((r) => r.transaction_type === 'TRANSFER_RECEIPT' && nos.includes(r.document_no))
            .reduce((s, r) => s + Number(r.amount), 0);
          return [{ amount: total.toFixed(4) }];
        };
        return {
          limit: async () => [ITEM],
          then: (ok: any, err: any) => Promise.resolve(sum()).then(ok, err),
        };
      } }) })),
      transaction: async (work: any) => work(db),
      insert: jest.fn(() => ({ values: async (v: any) => { inserted.push({ ...v, amount: v.amount === undefined ? undefined : Number(v.amount).toFixed(4) }); } })),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    return { db, inserted, service: new InventoryLedgerService(transactionCls(db)) };
  }
  const base = { tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1', documentLineId: 'line-1', postingDate: '2026-10-04', uom: 'PCS' };

  it('a shipment inserts exactly one NEGATIVE TRANSFER_SHIPMENT row, at the source', async () => {
    const { service, inserted } = ledgerDb('0');
    jest.spyOn(service, 'applyFifo').mockResolvedValue({ totalCost: 10, averageRate: 10 / 3 });
    await service.writeTransferShipment({ ...base, documentNo: 'SH-2026-0001', quantity: 3, fromWarehouseId: 'wh-src' });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ entry_type: 'NEGATIVE', transaction_type: 'TRANSFER_SHIPMENT', warehouse_id: 'wh-src', quantity: '-3' });
  });

  it('a receipt inserts exactly one POSITIVE TRANSFER_RECEIPT row, at the destination, amount = qty × rate', async () => {
    const { service, inserted } = ledgerDb('0');
    await service.writeTransferReceipt({ ...base, documentNo: 'RC-2026-0001', quantity: 4, toWarehouseId: 'wh-dst', rate: 2.5 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ entry_type: 'POSITIVE', transaction_type: 'TRANSFER_RECEIPT', warehouse_id: 'wh-dst', quantity: '4', amount: '10.0000' });
  });

  it('10.0000 shipped as 3 units and received 1+1+1 lands exactly 10.0000 — no residue in In Transit', async () => {
    const { service, inserted } = ledgerDb('-10.0000');
    const rate = 10 / 3;
    const receiptNos: string[] = [];
    for (const [i, closing] of [[1, false], [2, false], [3, true]] as const) {
      const documentNo = `RC-2026-000${i}`;
      const amount = closing
        ? await service.transferShipmentRemainingValue({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1', receiptNos })
        : undefined;
      await service.writeTransferReceipt({ ...base, documentNo, quantity: 1, toWarehouseId: 'wh-dst', rate, amount });
      receiptNos.push(documentNo);
    }
    expect(inserted.map((r) => r.amount)).toEqual(['3.3333', '3.3333', '3.3334']);
    expect(inserted.reduce((s, r) => s + Number(r.amount), 0).toFixed(4)).toBe('10.0000');
  });

  /**
   * Part E Task 4b, requirement 4: the closing receipt takes the remainder,
   * and a POSITIVE row must never carry a negative amount. A remainder just
   * below zero is rounding and is clamped to 0; anything further below means
   * the receipts already took more than the shipment carried — a data
   * inconsistency that must stop the receipt, not be written.
   */
  it('clamps a remainder within ±0.0005 of zero to 0 (rounding), never negative', async () => {
    const { service, inserted } = ledgerDb('-10.0000');
    inserted.push({ transaction_type: 'TRANSFER_RECEIPT', document_no: 'RC-2026-0001', amount: '10.0004' });
    const remaining = await service.transferShipmentRemainingValue({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1', receiptNos: ['RC-2026-0001'] });
    expect(remaining).toBe(0);
    expect(Object.is(remaining, -0)).toBe(false);
  });

  it('throws on a remainder below −0.0005: the receipts already exceed what the shipment carried', async () => {
    const { service, inserted } = ledgerDb('-10.0000');
    inserted.push({ transaction_type: 'TRANSFER_RECEIPT', document_no: 'RC-2026-0001', amount: '10.0100' });
    await expect(service.transferShipmentRemainingValue({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1', receiptNos: ['RC-2026-0001'] }))
      .rejects.toThrow('Shipment SH-2026-0001 has already been received for 0.0100 more than it carried on this line');
  });

  it('a remainder of exactly 0 or above is returned as it is', async () => {
    const { service, inserted } = ledgerDb('-10.0000');
    inserted.push({ transaction_type: 'TRANSFER_RECEIPT', document_no: 'RC-2026-0001', amount: '6.0000' });
    await expect(service.transferShipmentRemainingValue({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1', receiptNos: ['RC-2026-0001'] })).resolves.toBe(4);
  });
});

/**
 * WP4a fix round 1, Important 4 (coordinator's ruling on the review's ⚠️):
 * origin/main's applyFifo (f776836f) falls back COMPANY-WIDE for serials not
 * found in the requested warehouse, and writeNegativeEntry then re-stamps the
 * outbound row's warehouse with wherever it found them. For a stock-transfer
 * shipment that consumed stock outside the From sub-location and slipped past
 * the From-department check. A transfer shipment now draws only from its From
 * location and refuses instead; every other caller keeps the fallback.
 */
describe('applyFifo — a transfer shipment never falls back outside its From location', () => {
  function serialDb() {
    const queries: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: (condition: any) => {
        queries.push(new MySqlDialect().sqlToQuery(condition));
        // The serial sits elsewhere: nothing at the requested warehouse; the company-wide read would find it.
        const rows = (queries.length === 2 || queries.length >= 4)
          ? [{ serial_no: 'SN1', quantity: '1', remaining_quantity: '1', ledger_id: 'l-elsewhere', warehouse_id: 'wh-other', posting_date: '2026-10-01', rate: '5', amount: '5', entry_no: 1 }]
          : [];
        const result: any = Promise.resolve(rows);
        result.limit = async () => [{ valuation_method: 'FIFO', standard_cost: null }];
        result.orderBy = () => ({ for: async () => rows });
        return result;
      } }) }),
      insert: jest.fn(() => ({ values: async () => undefined })),
      update: jest.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    return { db, queries };
  }
  const args = { tenantId: 'tenant', companyId: 'company', itemId: 'item', outboundLedgerId: 'out', quantity: 1, applicationDate: '2026-10-05', serialNo: 'SN1', warehouseId: 'wh-store' };

  it('refuses a transfer whose serial sits in another location, reading only the From location', async () => {
    const { db, queries } = serialDb();
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.applyFifo({ ...args, strictWarehouse: true }, db))
      .rejects.toThrow("Item 'item' is not in stock at the From sub-location for the requested lot/serial (short by 1); a transfer ships only from its From sub-location.");
    expect(queries).toHaveLength(3);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('leaves the company-wide serial fallback of every other caller unchanged', async () => {
    const { db, queries } = serialDb();
    const service = new InventoryLedgerService({ get: () => db } as any);
    const out = await service.applyFifo(args, db);
    expect(queries).toHaveLength(6);
    expect(out.appliedWarehouseId).toBe('wh-other');
  });

  it('writeTransferShipment asks FIFO for the strict From-location draw', async () => {
    const insert = jest.fn(async () => undefined);
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ item_id: 'item', item_code: 'item', item_name: 'Item', is_serial_tracked: 1 }] }) }) }),
      transaction: async (work: any) => work(db),
      insert: () => ({ values: insert }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const service = new InventoryLedgerService(transactionCls(db));
    const fifo = jest.spyOn(service, 'applyFifo').mockResolvedValue({ totalCost: 5, averageRate: 5, appliedWarehouseId: 'wh-store' });
    await service.writeTransferShipment({ tenantId: 'tenant', companyId: 'company', itemId: 'item', documentNo: 'SH-1', documentLineId: 'line-1',
      postingDate: '2026-10-05', quantity: 1, uom: 'PCS', fromWarehouseId: 'wh-store', serialNo: 'SN1' });
    expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'wh-store', serialNo: 'SN1', strictWarehouse: true }), db);
  });
});

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
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ ledger_id: 'reversal-1' }] }) }) }), // loadOne read-back
      insert: jest.fn(() => ({ values: async (v: any) => { insertedValues.push(v); return undefined; } })),
      update: jest.fn(() => ({ set: () => ({ where: async () => undefined }) })),
    };
    const service = new InventoryLedgerService(transactionCls(db));

    await service.reverseEntry('ledger-1', 'tenant-1', 'user-1');

    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).not.toHaveProperty('created_at');
    // The original row's own created_at must not leak through the `...original`
    // spread either — that would silently backdate the reversal to look as if
    // it were written when the original entry was.
    expect(insertedValues[0].created_at).not.toBe('2026-09-14 08:00:00');
  });
});

describe('Inventory FIFO', () => {
  it('requires the selected lot and refuses its shortage without retrying unrestricted FIFO', async () => {
    const queries: any[] = [];
    const db: any = {
      select: () => ({ from: () => ({ where: (condition: any) => {
        queries.push(new MySqlDialect().sqlToQuery(condition));
        return { orderBy: () => ({ for: async () => [] }) };
      } }) }),
      insert: jest.fn(() => ({ values: async () => undefined })),
    };
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.applyFifo({ tenantId: 'tenant', companyId: 'company', itemId: 'item',
      outboundLedgerId: 'out', quantity: 1, applicationDate: '2026-09-14', lotNo: 'selected-lot' }, db))
      .rejects.toThrow(/Insufficient stock/);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('`lot_no` = ?');
    expect(queries[0].params).toContain('selected-lot');
    expect(db.insert).not.toHaveBeenCalled();
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
      transactionType: 'BATCH_CONSUMPTION', quantity: 1, uom: 'KG', lotNo: 'selected-lot' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ lot_no: 'selected-lot' }));
    expect(fifo).toHaveBeenCalledWith(expect.objectContaining({ lotNo: 'selected-lot' }), db);
  });

  it('refuses a shortfall without manufacturing an opening layer', async () => {
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ for: async () => [] }), limit: async () => [{ standard_cost: '25' }] }) }) }),
      insert: jest.fn(() => ({ values: async () => undefined })),
    };
    const service = new InventoryLedgerService({ get: () => db } as any);
    await expect(service.applyFifo({ tenantId: 'tenant', companyId: 'company', itemId: 'item',
      outboundLedgerId: 'out', quantity: 1, applicationDate: '2026-09-14' }, db)).rejects.toThrow(/Insufficient stock/);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('restricts source layers to the issuing company', async () => {
    let query: any;
    const db: any = { select: () => ({ from: () => ({ where: (condition: any) => {
      query ??= new MySqlDialect().sqlToQuery(condition);
      return { orderBy: () => ({ for: async () => [] }), limit: async () => [] };
    } }) }), insert: () => ({ values: async () => undefined }) };
    const service = new InventoryLedgerService({ get: () => db } as any);
    await service.applyFifo({ tenantId: 'tenant', companyId: 'company', itemId: 'item',
      outboundLedgerId: 'out', quantity: 1, applicationDate: '2026-09-14' }, db).catch(() => undefined);
    expect(query.sql).toContain('`company_id` = ?');
    expect(query.params).toContain('company');
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

  it('includes batch issues with no warehouse through their batch farm', async () => {
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

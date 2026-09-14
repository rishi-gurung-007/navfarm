import { InventoryLedgerService } from './inventory-ledger.service';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';

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

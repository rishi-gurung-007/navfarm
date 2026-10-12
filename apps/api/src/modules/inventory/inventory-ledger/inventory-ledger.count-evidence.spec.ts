import { getTableConfig, MySqlDialect } from 'drizzle-orm/mysql-core';
import * as schema from '../../../core/database/schema';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { InventoryLedgerService } from './inventory-ledger.service';

describe('InventoryLedgerService.getSiloStockEvidenceAsOf', () => {
  it('derives item quantity and unit cost from ledger rows visible at the exact count timestamp', async () => {
    let where: unknown;
    const rows = [{
      warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG',
      system_qty_kg: '95.0000', base_value: '380.0000', valued_entries: 3, costed_entries: 3, total_entries: 3,
    }];
    const chain: any = {
      from: () => chain,
      where: (value: unknown) => { where = value; return chain; },
      groupBy: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (error: unknown) => unknown) => Promise.resolve(rows).then(ok, fail),
    };
    const db = { select: jest.fn(() => chain) };
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });

    await expect(new InventoryLedgerService(cls).getSiloStockEvidenceAsOf({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-01', countedAtEpochSeconds: 1790842500,
    }, 'tenant-1')).resolves.toEqual([{
      warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG',
      system_qty_kg: 95, unit_cost_base: 4,
    }]);

    const rendered = new MySqlDialect().sqlToQuery(where as any);
    expect(rendered.sql).toMatch(/`posting_date` <= \?/);
    expect(rendered.sql.toLowerCase()).toMatch(/`created_at` <= from_unixtime\(\?\)/);
    expect(rendered.sql).toMatch(/`warehouse_id` in \(\?\)/);
    expect(rendered.params).toEqual(expect.arrayContaining([
      'tenant-1', 'company-1', 'silo-1', '2026-10-01', 1790842500, 'farm-1', 'lob-piggery',
    ]));
  });

  it('returns explicit missing cost when any contributing ledger row lacks monetary evidence', async () => {
    const rows = [{
      warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG',
      system_qty_kg: '10.0000', base_value: '20.0000', valued_entries: 1, costed_entries: 1, total_entries: 2,
    }];
    const chain: any = {
      from: () => chain, where: () => chain, groupBy: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (error: unknown) => unknown) => Promise.resolve(rows).then(ok, fail),
    };
    const service = new InventoryLedgerService(transactionCls({ select: jest.fn(() => chain) }));
    await expect(service.getSiloStockEvidenceAsOf({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-01', countedAtEpochSeconds: 1790842500,
    }, 'tenant-1')).resolves.toEqual([expect.objectContaining({ unit_cost_base: null })]);
  });

  it('does not treat the ledger writer\'s zero fallback rate as real cost evidence', async () => {
    const rows = [{
      warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG',
      system_qty_kg: '10.0000', base_value: '0.0000', valued_entries: 2, costed_entries: 0, total_entries: 2,
    }];
    const chain: any = {
      from: () => chain, where: () => chain, groupBy: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (error: unknown) => unknown) => Promise.resolve(rows).then(ok, fail),
    };
    const service = new InventoryLedgerService(transactionCls({ select: jest.fn(() => chain) }));
    await expect(service.getSiloStockEvidenceAsOf({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-01', countedAtEpochSeconds: 1790842500,
    }, 'tenant-1')).resolves.toEqual([expect.objectContaining({ unit_cost_base: null })]);
  });

  it.each([
    ['mixed KG and BAG evidence', [
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'KG', system_qty_kg: '100', base_value: '400', valued_entries: 1, costed_entries: 1, total_entries: 1 },
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'BAG', system_qty_kg: '2', base_value: '80', valued_entries: 1, costed_entries: 1, total_entries: 1 },
    ]],
    ['non-KG evidence', [
      { warehouse_id: 'silo-1', item_id: 'item-1', item_code: 'FEED-1', uom: 'TON', system_qty_kg: '1', base_value: '4000', valued_entries: 1, costed_entries: 1, total_entries: 1 },
    ]],
  ])('refuses %s rather than reporting raw units as kilograms', async (_label, rows) => {
    const chain: any = {
      from: () => chain, where: () => chain, groupBy: () => chain,
      then: (ok: (value: unknown[]) => unknown, fail: (error: unknown) => unknown) => Promise.resolve(rows).then(ok, fail),
    };
    const service = new InventoryLedgerService(transactionCls({ select: jest.fn(() => chain) }));
    await expect(service.getSiloStockEvidenceAsOf({
      companyId: 'company-1', siloIds: ['silo-1'], postingDate: '2026-10-01', countedAtEpochSeconds: 1790842500,
    }, 'tenant-1')).rejects.toThrow('KG');
  });

  it('declares the migration-ready ledger cutoff index used by batched count evidence', () => {
    const index = getTableConfig(schema.inventoryLedger).indexes
      .find((candidate) => candidate.config.name === 'idx_inventory_ledger_count_cutoff');
    expect(index?.config.columns.map((column: any) => column.name)).toEqual([
      'tenant_id', 'company_id', 'warehouse_id', 'posting_date', 'created_at',
    ]);
  });
});

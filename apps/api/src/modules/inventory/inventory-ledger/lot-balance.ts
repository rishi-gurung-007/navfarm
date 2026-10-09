/**
 * What each lot of an item holds, at a location or everywhere. A lot's stock is the sum of its signed
 * quantities: inbound entries (receipts, transfer receipts, positive adjustments, reversals), outbound
 * entries that name the lot on the entry itself (single-lot postings, and everything posted before ledger
 * lines existed), and the lines of entries that issued from several lots. This is deliberately not the
 * receipt's remaining quantity: that belongs to costing (which receipt the cost came from) and no longer
 * says which lot the stock physically left.
 */
import { and, eq, inArray, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

export interface LotBalanceRow {
  lot_no: string;
  quantity: number;
  /** Earliest expiry among the lot's receipts. */
  expiry_date: string | null;
  /** Date of the lot's earliest receipt. */
  receipt_date: string;
}

/** Extra conditions, written once against the columns every source table has (farm scope, for example). */
export type ScopeConditions = (cols: { warehouse_id: AnyMySqlColumn; company_id: AnyMySqlColumn }) => SQL[];

export async function lotBalances(
  db: MySql2Database<typeof schema>,
  /**
   * `excludeLedgerId`: an entry being posted right now. Its own row is already in the ledger when the check
   * runs, so it must not be counted against the stock it is about to take.
   */
  scope: { tenantId: string; companyId?: string; itemId: string; warehouseId?: string; lotNos?: string[]; scopeConditions?: ScopeConditions; excludeLedgerId?: string },
): Promise<LotBalanceRow[]> {
  const L = schema.inventoryLedger;
  const headerWhere = and(
    eq(L.tenant_id, scope.tenantId),
    eq(L.item_id, scope.itemId),
    isNotNull(L.lot_no),
    inArray(L.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
    ...(scope.companyId ? [eq(L.company_id, scope.companyId)] : []),
    ...(scope.warehouseId ? [eq(L.warehouse_id, scope.warehouseId)] : []),
    ...(scope.lotNos?.length ? [inArray(L.lot_no, scope.lotNos)] : []),
    ...(scope.scopeConditions?.({ warehouse_id: L.warehouse_id, company_id: L.company_id }) ?? []),
    ...(scope.excludeLedgerId ? [ne(L.ledger_id, scope.excludeLedgerId)] : []),
  );
  const fromHeaders = await db
    .select({
      lot_no: L.lot_no,
      quantity: sql<string>`COALESCE(SUM(${L.quantity}), 0)`,
      expiry_date: sql<string | null>`MIN(CASE WHEN ${L.quantity} > 0 THEN ${L.expiry_date} END)`,
      receipt_date: sql<string | null>`MIN(CASE WHEN ${L.quantity} > 0 THEN ${L.posting_date} END)`,
    })
    .from(L)
    .where(headerWhere)
    .groupBy(L.lot_no);

  const N = schema.inventoryLedgerLine;
  const fromLines = await db
    .select({ lot_no: N.lot_no, quantity: sql<string>`COALESCE(SUM(${N.quantity}), 0)` })
    .from(N)
    .where(
      and(
        eq(N.tenant_id, scope.tenantId),
        eq(N.item_id, scope.itemId),
        isNotNull(N.lot_no),
        ...(scope.companyId ? [eq(N.company_id, scope.companyId)] : []),
        ...(scope.warehouseId ? [eq(N.warehouse_id, scope.warehouseId)] : []),
        ...(scope.lotNos?.length ? [inArray(N.lot_no, scope.lotNos)] : []),
        ...(scope.scopeConditions?.({ warehouse_id: N.warehouse_id, company_id: N.company_id }) ?? []),
        ...(scope.excludeLedgerId ? [ne(N.ledger_id, scope.excludeLedgerId)] : []),
      ),
    )
    .groupBy(N.lot_no);

  const byLot = new Map<string, LotBalanceRow>();
  for (const r of fromHeaders) {
    byLot.set(r.lot_no!, {
      lot_no: r.lot_no!,
      quantity: Number(r.quantity),
      expiry_date: r.expiry_date,
      receipt_date: r.receipt_date ?? '9999-12-31',
    });
  }
  for (const r of fromLines) {
    const row = byLot.get(r.lot_no!) ?? { lot_no: r.lot_no!, quantity: 0, expiry_date: null, receipt_date: '9999-12-31' };
    row.quantity += Number(r.quantity);
    byLot.set(r.lot_no!, row);
  }
  return [...byLot.values()].map((r) => ({ ...r, quantity: Math.round(r.quantity * 1e4) / 1e4 }));
}

/**
 * The serials of an item in stock: one unit each, counted in by the entries that carry them (receipts,
 * transfer receipts, reversals) and out by the entries that issue them, on the entry or on its lines.
 * A serial is in stock while it has been counted in more often than out.
 */
export async function serialsInStock(
  db: MySql2Database<typeof schema>,
  scope: { tenantId: string; companyId?: string; itemId: string; warehouseId?: string; scopeConditions?: ScopeConditions; excludeLedgerId?: string },
): Promise<Array<{ serial_no: string; warehouse_id: string | null; expiry_date: string | null; receipt_date: string; unit_cost: number }>> {
  const L = schema.inventoryLedger;
  const rows = await db
    .select({
      serial_no: L.serial_no,
      quantity: L.quantity,
      warehouse_id: L.warehouse_id,
      expiry_date: L.expiry_date,
      posting_date: L.posting_date,
      rate: L.rate,
      entry_no: L.entry_no,
    })
    .from(L)
    .where(
      and(
        eq(L.tenant_id, scope.tenantId),
        eq(L.item_id, scope.itemId),
        isNotNull(L.serial_no),
        inArray(L.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
        ...(scope.companyId ? [eq(L.company_id, scope.companyId)] : []),
        ...(scope.warehouseId ? [eq(L.warehouse_id, scope.warehouseId)] : []),
        ...(scope.scopeConditions?.({ warehouse_id: L.warehouse_id, company_id: L.company_id }) ?? []),
        ...(scope.excludeLedgerId ? [ne(L.ledger_id, scope.excludeLedgerId)] : []),
      ),
    );
  const N = schema.inventoryLedgerLine;
  const lineRows = await db
    .select({ serial_no: N.serial_no, quantity: N.quantity, warehouse_id: N.warehouse_id })
    .from(N)
    .where(
      and(
        eq(N.tenant_id, scope.tenantId),
        eq(N.item_id, scope.itemId),
        isNotNull(N.serial_no),
        ...(scope.companyId ? [eq(N.company_id, scope.companyId)] : []),
        ...(scope.warehouseId ? [eq(N.warehouse_id, scope.warehouseId)] : []),
        ...(scope.scopeConditions?.({ warehouse_id: N.warehouse_id, company_id: N.company_id }) ?? []),
        ...(scope.excludeLedgerId ? [ne(N.ledger_id, scope.excludeLedgerId)] : []),
      ),
    );

  const split = (text: string | null) => (text ? text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : []);
  const state = new Map<string, { net: number; warehouse_id: string | null; expiry_date: string | null; receipt_date: string; unit_cost: number }>();
  const touch = (serial: string, delta: number, row: { warehouse_id: string | null; expiry_date?: string | null; posting_date?: string; rate?: string | null }) => {
    const cur = state.get(serial) ?? { net: 0, warehouse_id: row.warehouse_id, expiry_date: null, receipt_date: '9999-12-31', unit_cost: 0 };
    cur.net += delta;
    if (delta > 0) {
      cur.warehouse_id = row.warehouse_id;
      if (row.expiry_date) cur.expiry_date = row.expiry_date;
      if (row.posting_date && row.posting_date < cur.receipt_date) cur.receipt_date = row.posting_date;
      if (row.rate != null) cur.unit_cost = Number(row.rate);
    }
    state.set(serial, cur);
  };
  for (const r of rows) {
    const sign = Number(r.quantity) >= 0 ? 1 : -1;
    for (const sn of split(r.serial_no)) touch(sn, sign, r);
  }
  for (const r of lineRows) {
    const sign = Number(r.quantity) >= 0 ? 1 : -1;
    for (const sn of split(r.serial_no)) touch(sn, sign, { warehouse_id: r.warehouse_id });
  }
  return [...state.entries()]
    .filter(([, v]) => v.net > 0)
    .map(([serial_no, v]) => ({ serial_no, warehouse_id: v.warehouse_id, expiry_date: v.expiry_date, receipt_date: v.receipt_date, unit_cost: v.unit_cost }));
}

/**
 * One head-count rule for a batch, shared by the feed forecast's history and the lifecycle KPI evaluator.
 *
 * Heads at a date = the batch's opening quantity less the deaths recorded before it. Deaths come from two sources
 * that exist side by side and are never the same row:
 *  - batch_transaction MORTALITY rows (stock movements), and
 *  - POSTED batch_daily_data entries on MORTALITY_COUNT scheduler lines (what Data Entry writes; it lowers
 *    scheduler_header.animal_count but creates no batch_transaction).
 * Unposted entries do not count. Transfers are not subtracted (the forecast never did).
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../core/database/schema';

export interface DeathEvent { date: string; quantity: number }
export type DeathLedger = Map<string, DeathEvent[]>;

/** Deaths per batch from both sources, optionally only up to and including `upTo` (YYYY-MM-DD). */
export async function loadBatchDeaths(db: MySql2Database<typeof schema>, batchIds: string[], upTo?: string): Promise<DeathLedger> {
  const ledger: DeathLedger = new Map();
  const ids = [...new Set(batchIds.filter(Boolean))];
  if (!ids.length) return ledger;
  const add = (batchId: string, date: unknown, quantity: unknown) => {
    const q = Number(quantity) || 0;
    if (!q) return;
    const list = ledger.get(batchId) ?? [];
    list.push({ date: String(date).slice(0, 10), quantity: q });
    ledger.set(batchId, list);
  };

  const transactions = await db.select({
    batchId: schema.batchTransaction.batch_id,
    date: schema.batchTransaction.transaction_date,
    quantity: schema.batchTransaction.quantity,
  }).from(schema.batchTransaction).where(and(
    inArray(schema.batchTransaction.batch_id, ids),
    eq(schema.batchTransaction.transaction_type, 'MORTALITY'),
    ...(upTo ? [lte(schema.batchTransaction.transaction_date, upTo)] : []),
  ));
  for (const row of transactions) add(row.batchId, row.date, row.quantity);

  const entries = await db.select({
    batchId: schema.batchDailyData.batch_id,
    date: schema.batchDailyData.entry_date,
    quantity: schema.batchDailyData.entered_value,
  }).from(schema.batchDailyData)
    .innerJoin(schema.schedulerLine, eq(schema.schedulerLine.line_id, schema.batchDailyData.line_id))
    .where(and(
      inArray(schema.batchDailyData.batch_id, ids),
      eq(schema.batchDailyData.posted, true),
      eq(schema.schedulerLine.kpi_metric, 'MORTALITY_COUNT'),
      ...(upTo ? [sql`${schema.batchDailyData.entry_date} <= ${upTo}`] : []),
    ));
  for (const row of entries) add(row.batchId, row.date, row.quantity);
  return ledger;
}

/**
 * Heads at the start of `date` (deaths strictly before it) from a loaded ledger; with `inclusive`, deaths on `date`
 * count too (the feed forecast subtracts through the entry date). Never below zero.
 */
export function headsAt(opening: number | string | null | undefined, deaths: DeathEvent[] | undefined, date: string, inclusive = false): number {
  const open = Number(opening);
  if (!Number.isFinite(open)) return 0;
  const dead = (deaths ?? []).filter((d) => (inclusive ? d.date <= date : d.date < date)).reduce((n, d) => n + d.quantity, 0);
  return Math.max(0, open - dead);
}

/** Heads of one batch at the start of `date`. */
export async function headsAtStartOfDate(db: MySql2Database<typeof schema>, batchId: string, opening: number | string | null | undefined, date: string): Promise<number> {
  const ledger = await loadBatchDeaths(db, [batchId], date);
  return headsAt(opening, ledger.get(batchId), date);
}

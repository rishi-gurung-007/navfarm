/**
 * One head-count rule for a batch, shared by the feed forecast's history and the lifecycle KPI evaluator.
 *
 * Heads at a date = the batch's opening quantity less the deaths recorded before it:
 *  - every batch_transaction MORTALITY row not reversed, and
 *  - POSTED batch_daily_data entries on MORTALITY_COUNT scheduler lines, only for the deaths that have no
 *    transaction of their own. Since the system-schedulers merge (13 Oct) Data Entry posts each death as a
 *    transaction with "— scheduled entry" in its remarks; entries posted before that have none, so without this
 *    rule a death would count twice, and before it a merged batch would lose the older ones.
 * Unposted entries do not count. Transfers are not subtracted (the forecast never did).
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../core/database/schema';

export interface DeathEvent {
  date: string;
  quantity: number;
}
export type DeathLedger = Map<string, DeathEvent[]>;

/** Deaths per batch from both sources, optionally only up to and including `upTo` (YYYY-MM-DD). */
export async function loadBatchDeaths(
  db: MySql2Database<typeof schema>,
  batchIds: string[],
  upTo?: string,
): Promise<DeathLedger> {
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

  const transactions = await db
    .select({
      batchId: schema.batchTransaction.batch_id,
      date: schema.batchTransaction.transaction_date,
      quantity: schema.batchTransaction.quantity,
      remarks: schema.batchTransaction.remarks,
      reversedAt: schema.batchTransaction.reversed_at,
    })
    .from(schema.batchTransaction)
    .where(
      and(
        inArray(schema.batchTransaction.batch_id, ids),
        eq(schema.batchTransaction.transaction_type, 'MORTALITY'),
        ...(upTo ? [lte(schema.batchTransaction.transaction_date, upTo)] : []),
      ),
    );
  // Deaths a Data Entry post already turned into transactions, reversed or not, per batch and day.
  const fromEntries = new Map<string, number>();
  for (const row of transactions) {
    if (String(row.remarks ?? '').includes('— scheduled entry')) {
      const key = `${row.batchId}|${String(row.date).slice(0, 10)}`;
      fromEntries.set(
        key,
        (fromEntries.get(key) ?? 0) + (Number(row.quantity) || 0),
      );
    }
    if (!row.reversedAt) add(row.batchId, row.date, row.quantity);
  }

  const entries = await db
    .select({
      batchId: schema.batchDailyData.batch_id,
      date: schema.batchDailyData.entry_date,
      quantity: schema.batchDailyData.entered_value,
    })
    .from(schema.batchDailyData)
    .innerJoin(
      schema.schedulerLine,
      eq(schema.schedulerLine.line_id, schema.batchDailyData.line_id),
    )
    .where(
      and(
        inArray(schema.batchDailyData.batch_id, ids),
        eq(schema.batchDailyData.posted, true),
        eq(schema.schedulerLine.kpi_metric, 'MORTALITY_COUNT'),
        ...(upTo ? [sql`${schema.batchDailyData.entry_date} <= ${upTo}`] : []),
      ),
    );
  // Summed per batch and day first: an animal-wise day has one row per animal.
  const entered = new Map<string, number>();
  for (const row of entries) {
    const key = `${row.batchId}|${String(row.date).slice(0, 10)}`;
    entered.set(key, (entered.get(key) ?? 0) + (Number(row.quantity) || 0));
  }
  for (const [key, quantity] of entered) {
    const [batchId, date] = key.split('|');
    add(batchId, date, Math.max(0, quantity - (fromEntries.get(key) ?? 0)));
  }
  return ledger;
}

/**
 * Heads at the start of `date` (deaths strictly before it) from a loaded ledger; with `inclusive`, deaths on `date`
 * count too (the feed forecast subtracts through the entry date). Never below zero.
 */
export function headsAt(
  opening: number | string | null | undefined,
  deaths: DeathEvent[] | undefined,
  date: string,
  inclusive = false,
): number {
  const open = Number(opening);
  if (!Number.isFinite(open)) return 0;
  const dead = (deaths ?? [])
    .filter((d) => (inclusive ? d.date <= date : d.date < date))
    .reduce((n, d) => n + d.quantity, 0);
  return Math.max(0, open - dead);
}

/** Heads of one batch at the start of `date`. */
export async function headsAtStartOfDate(
  db: MySql2Database<typeof schema>,
  batchId: string,
  opening: number | string | null | undefined,
  date: string,
): Promise<number> {
  const ledger = await loadBatchDeaths(db, [batchId], date);
  return headsAt(opening, ledger.get(batchId), date);
}

/** A posted head-count move between batches: heads leave `fromBatchId` and join `toBatchId` on `date`. */
export interface HeadMove {
  fromBatchId: string | null;
  toBatchId: string | null;
  date: string;
  heads: number;
}

/**
 * Heads a feed entry stands for, for the feed plan's Lifecycle Expected KG. An entry on one animal (an animal-wise
 * batch posts one per animal) is that animal: 1. A cohort's entry is its heads on the day, deaths and moves through
 * the entry date counted: opening less deaths, plus heads moved in, less heads moved out. headsAt alone would
 * leave an animal-wise batch at 0 (its sows join by transfer) and a cohort at its first litter.
 */
export function entryHeads(
  entry: {
    batchId: string;
    animalId: string | null | undefined;
    date: string;
    opening: number | string | null | undefined;
  },
  deaths: DeathEvent[] | undefined,
  moves: HeadMove[] | undefined,
): number {
  if (entry.animalId) return 1;
  const moved = (moves ?? [])
    .filter((m) => m.date <= entry.date)
    .reduce(
      (n, m) =>
        n +
        (m.toBatchId === entry.batchId ? m.heads : 0) -
        (m.fromBatchId === entry.batchId ? m.heads : 0),
      0,
    );
  return Math.max(0, headsAt(entry.opening, deaths, entry.date, true) + moved);
}

/** Posted head-count moves into or out of the batches, up to and including `upTo`. */
export async function loadHeadMoves(
  db: MySql2Database<typeof schema>,
  batchIds: string[],
  upTo: string,
): Promise<HeadMove[]> {
  const ids = [...new Set(batchIds.filter(Boolean))];
  if (!ids.length) return [];
  const T = schema.batchTransfer;
  const rows = await db
    .select({
      fromBatchId: T.from_batch_id,
      toBatchId: T.to_batch_id,
      date: T.transfer_date,
      heads: T.head_count,
    })
    .from(T)
    .where(
      and(
        eq(T.status, 'POSTED'),
        sql`(${inArray(T.from_batch_id, ids)} OR ${inArray(T.to_batch_id, ids)})`,
        sql`${T.transfer_date} <= ${upTo}`,
      ),
    );
  return rows.map((r) => ({
    fromBatchId: r.fromBatchId,
    toBatchId: r.toBatchId,
    date: String(r.date).slice(0, 10),
    heads: Number(r.heads) || 0,
  }));
}

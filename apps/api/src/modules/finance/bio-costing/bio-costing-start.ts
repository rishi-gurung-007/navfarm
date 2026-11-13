import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { bioEventsCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';
import { costingStartDate } from './bio-costing.rules';
import { itemStartAge } from './bio-costing-subject';

type Db = MySql2Database<typeof schema>;

/**
 * Whether anything has been booked to an animal on the basis of her costing start date: a costing run line, a capitalised or amortised ledger row,
 * or a feed or overhead entry against her. Once so, her start date cannot move without leaving those entries wrong.
 */
export async function animalHasCostingBookings(db: Db, animalId: string): Promise<boolean> {
  const [run] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioCostingRunLine).where(eq(schema.bioCostingRunLine.animal_id, animalId));
  const [ledger] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(
    eq(schema.bioAssetLedger.animal_id, animalId), bioEventsCondition(schema.bioAssetLedger, ['CONSUMPTION', 'OVERHEAD_COST', 'AMORTIZATION', 'FAIR_VALUE_ADJMT'])));
  const [tx] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.batchTransaction).where(and(
    eq(schema.batchTransaction.animal_id, animalId), inArray(schema.batchTransaction.transaction_type, ['CONSUMPTION', 'OVERHEAD'])));
  return Number(run?.n ?? 0) + Number(ledger?.n ?? 0) + Number(tx?.n ?? 0) > 0;
}

/**
 * The item's start period was changed: move the costing start date of each of its animals to birth + the new period, except an animal that already has
 * something booked on the old date, who keeps hers (reported, so she can be dealt with). Run in the same transaction as the item's update.
 */
export async function recomputeStartsForItem(db: Db, item: { item_id: string; tenant_id: string; bio_start_age_weeks?: number | null; bio_start_age_days?: number | null }): Promise<{ moved: number; kept: Array<{ animal_code: string }> }> {
  const { weeks, days } = itemStartAge(item);
  const A = schema.animalRegister;
  const animals = await db.select().from(A).where(and(eq(A.item_id, item.item_id), eq(A.tenant_id, item.tenant_id), eq(A.is_active, true)));
  let moved = 0;
  const kept: Array<{ animal_code: string }> = [];
  for (const a of animals) {
    const start = costingStartDate({ dob: a.dob, entry_date: String(a.entry_date).slice(0, 10), age_at_entry_weeks: a.age_at_entry_weeks }, weeks, days);
    if ((start ?? null) === (a.costing_start_date ? String(a.costing_start_date).slice(0, 10) : null)) continue;
    if (await animalHasCostingBookings(db, a.animal_id)) { kept.push({ animal_code: a.animal_code }); continue; }
    await db.update(A).set({ costing_start_date: start }).where(eq(A.animal_id, a.animal_id));
    moved++;
  }
  return { moved, kept };
}

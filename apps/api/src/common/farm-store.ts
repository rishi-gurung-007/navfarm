import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

type Db = MySql2Database<typeof schema>;

/**
 * Of the given stores, the one holding the most of the given items — what a draw of those items comes out of.
 * Null when none of them holds any. A farm keeps feed, medicines and semen in different stores, and the first
 * store by code (the AI store, on a farm whose stores are PSTORE-AI, -FEED, -GEN, -MED) holds none of its feed.
 */
export async function storeHoldingMost(
  db: Db,
  storeIds: string[],
  itemIds: string[],
): Promise<string | null> {
  if (!storeIds.length || !itemIds.length) return null;
  const L = schema.inventoryLedger;
  const qty = sql<string>`SUM(${L.quantity})`;
  const [best] = await db
    .select({ warehouse_id: L.warehouse_id, qty })
    .from(L)
    .where(
      and(
        inArray(L.warehouse_id, storeIds),
        inArray(L.item_id, itemIds),
        inArray(L.entry_type, ['POSITIVE', 'NEGATIVE', 'TRANSFER']),
      ),
    )
    .groupBy(L.warehouse_id)
    .having(sql`${qty} > 0`)
    .orderBy(desc(qty))
    .limit(1);
  return best?.warehouse_id ?? null;
}

/**
 * The store of a farm — where stock the farm produces or receives is kept. Given an item, the farm's store
 * that holds the most of it; otherwise (or when none holds any) the first active STORE under the farm by
 * code. Null when the farm has none (or no farm is given).
 */
export async function farmStoreOf(
  db: Db,
  farmId: string | null | undefined,
  itemId?: string | null,
): Promise<string | null> {
  if (!farmId) return null;
  const stores = await db
    .select({ location_id: schema.locationMaster.location_id })
    .from(schema.locationMaster)
    .where(
      and(
        eq(schema.locationMaster.location_type, 'STORE'),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
        or(
          eq(schema.locationMaster.farm_id, farmId),
          eq(schema.locationMaster.parent_location_id, farmId),
        ),
      ),
    )
    .orderBy(schema.locationMaster.location_code)
    .limit(100);
  if (!stores.length) return null;
  // One store is the store: nothing to choose between, so no stock to read.
  if (itemId && stores.length > 1) {
    const holding = await storeHoldingMost(
      db,
      stores.map((s) => s.location_id),
      [itemId],
    );
    if (holding) return holding;
  }
  return stores[0].location_id;
}

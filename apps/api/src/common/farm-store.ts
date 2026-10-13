import { and, eq, isNull, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

/**
 * The store of a farm — where stock the farm produces or receives is kept: the first active STORE under it,
 * by code, the same pick the feed forecast makes, so a farm that somehow carries two uses the one the forecast
 * reports. Null when the farm has none (or no farm is given).
 */
export async function farmStoreOf(
  db: MySql2Database<typeof schema>,
  farmId: string | null | undefined,
): Promise<string | null> {
  if (!farmId) return null;
  const [store] = await db
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
    .limit(1);
  return store?.location_id ?? null;
}

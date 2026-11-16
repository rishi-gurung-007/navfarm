import { eq, inArray } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import type { Place } from './animal-placement.rules';

/**
 * Locations by id, each with the farm it belongs to (itself for a farm), for the placement rules
 * (animal-placement.rules.ts). Shared by the batch transfer and the location move, so both read a location's farm the
 * same way: parent_location_id is the canonical tree, and farm_id is a denormalised shortcut older rows may lack.
 */
export async function loadPlaces(
  db: MySql2Database<typeof schema>,
  ids: Array<string | null | undefined>,
): Promise<Map<string, Place>> {
  const L = schema.locationMaster;
  const cols = {
    location_id: L.location_id,
    location_code: L.location_code,
    location_type: L.location_type,
    parent_location_id: L.parent_location_id,
    farm_id: L.farm_id,
    company_id: L.company_id,
    is_active: L.is_active,
    deleted_at: L.deleted_at,
  };
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const out = new Map<string, Place>();
  if (!wanted.length) return out;
  const rows = await db.select(cols).from(L).where(inArray(L.location_id, wanted));
  const farmIdOf = async (row: (typeof rows)[number]): Promise<string | null> => {
    if (row.parent_location_id === null) return row.location_id;
    if (row.farm_id) return row.farm_id;
    let parentId: string | null = row.parent_location_id;
    for (let depth = 0; parentId && depth < 8; depth += 1) {
      const [parent] = await db.select(cols).from(L).where(eq(L.location_id, parentId)).limit(1);
      if (!parent) return null;
      if (parent.parent_location_id === null) return parent.location_id;
      parentId = parent.parent_location_id;
    }
    return null;
  };
  const farmIds = new Map<string, string | null>();
  for (const row of rows) farmIds.set(row.location_id, await farmIdOf(row));
  const farmIdList = [...new Set([...farmIds.values()].filter((id): id is string => !!id))];
  const farmCodes = new Map(
    farmIdList.length
      ? (await db.select({ id: L.location_id, code: L.location_code }).from(L).where(inArray(L.location_id, farmIdList))).map(
          (f) => [f.id, f.code] as const,
        )
      : [],
  );
  for (const row of rows) {
    const farmId = farmIds.get(row.location_id) ?? null;
    out.set(row.location_id, {
      location_id: row.location_id,
      location_code: row.location_code,
      location_type: row.location_type,
      farm_id: farmId,
      farm_code: farmId ? (farmCodes.get(farmId) ?? null) : null,
      company_id: row.company_id,
      is_active: !!row.is_active && !row.deleted_at,
    });
  }
  return out;
}

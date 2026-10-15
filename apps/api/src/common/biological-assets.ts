import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

/**
 * A biological asset is not stock (Rishi, 14 Oct): its GRN posts no inventory entry, and the animals are counted by the
 * Bio Asset Ledger as they are registered. So no stock document may move one — there is nothing in stock to move.
 */
export async function assertNoBiologicalAssets(db: MySql2Database<typeof schema>, itemIds: Array<string | null | undefined>, document: string): Promise<void> {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const [bio] = await db
    .select({ item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name })
    .from(schema.itemMaster)
    .where(and(inArray(schema.itemMaster.item_id, ids), eq(schema.itemMaster.is_biological_asset, true)))
    .limit(1);
  if (bio) {
    throw new BadRequestException(
      `${bio.item_code} — ${bio.item_name} is a biological asset. Biological assets are not held in stock, so they cannot be on a ${document}; animals are registered from their GRN in the Animal Register.`,
    );
  }
}

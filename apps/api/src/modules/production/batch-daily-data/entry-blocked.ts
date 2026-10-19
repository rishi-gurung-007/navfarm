import { and, count, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

/**
 * Why a batch takes no data entry, or null when it does (Rishi, 19 Oct): an animal-wise batch with no live animal
 * in it, or a batch-wise batch whose head count is nil. Such a batch stays ACTIVE until a user closes it; nothing is
 * recorded against it meanwhile. Posting refuses it and the Data Entry screen shows the same reason.
 */
export async function entryBlockedReason(db: MySql2Database<typeof schema>, batchId: string): Promise<string | null> {
  const [batch] = await db
    .select({
      batch_no: schema.batchHeader.batch_no,
      tracking_mode: schema.batchHeader.tracking_mode,
      closing_quantity: schema.batchHeader.closing_quantity,
      opening_quantity: schema.batchHeader.opening_quantity,
    })
    .from(schema.batchHeader)
    .where(eq(schema.batchHeader.batch_id, batchId))
    .limit(1);
  if (!batch) return null;
  if (batch.tracking_mode === 'ANIMAL_WISE') {
    const [{ live }] = await db
      .select({ live: count() })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
    return Number(live) > 0 ? null : `Batch '${batch.batch_no}' has no animals in it, so it takes no data entry.`;
  }
  const head = Number(batch.closing_quantity ?? batch.opening_quantity ?? 0);
  return head > 1e-9 ? null : `Batch '${batch.batch_no}' has a head count of 0, so it takes no data entry.`;
}

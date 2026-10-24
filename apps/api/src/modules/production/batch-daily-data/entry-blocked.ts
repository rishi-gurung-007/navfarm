import { and, count, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { animalsInBatchOn } from './animal-membership';

/**
 * Why a batch takes no data entry, or null when it does (Rishi, 19 Oct): an animal-wise batch with no live animal
 * in it, or a batch-wise batch whose head count is nil. Such a batch stays ACTIVE until a user closes it; nothing is
 * recorded against it meanwhile. Posting refuses it and the Data Entry screen shows the same reason.
 *
 * For a date before today (21 Oct) the question is who was in the batch THEN: an animal-wise batch that is empty now
 * still takes entries for the days it had animals, and one that has animals now takes none for a day it had none.
 * Today and later are decided as before. A batch-wise batch keeps no dated head count, so it is judged as it stands.
 */
export async function entryBlockedReason(
  db: MySql2Database<typeof schema>,
  batchId: string,
  date?: string,
): Promise<string | null> {
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
    if (date && date < new Date().toISOString().slice(0, 10)) {
      const members = await animalsInBatchOn(db, batchId, date);
      return members.length
        ? null
        : `Batch '${batch.batch_no}' had no animals in it on ${date}, so it takes no data entry for that day.`;
    }
    const [{ live }] = await db
      .select({ live: count() })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
        ),
      );
    return Number(live) > 0
      ? null
      : `Batch '${batch.batch_no}' has no animals in it, so it takes no data entry.`;
  }
  const head = Number(batch.closing_quantity ?? batch.opening_quantity ?? 0);
  return head > 1e-9
    ? null
    : `Batch '${batch.batch_no}' has a head count of 0, so it takes no data entry.`;
}

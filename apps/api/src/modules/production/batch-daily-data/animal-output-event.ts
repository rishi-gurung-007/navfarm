import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';

/**
 * What an output entered against one animal of an animal-wise batch is. A boar's output is a semen collection, of
 * whatever item is chosen. A sow's output of a bio-asset item (her piglets) is the weaning of the litter she is nursing
 * (a farrowing numbered above her parity) wherever she is — she cannot farrow again before it is weaned, and sows are
 * often weaned in the farrowing house — else a farrowing on a stage whose data-entry form is FARROWING. Anything else is
 * ordinary output into stock.
 *
 * Posting (BatchDailyDataService) and the data-entry screen (BatchService's stage view) both ask here, so the screen
 * says what the entry will do and the posting does exactly that.
 */
export type AnimalOutputEvent =
  | { kind: 'SEMEN' }
  | { kind: 'FARROWING' }
  | {
      kind: 'WEANING';
      farrow_id: string;
      litter: number;
      piglet_lot_no: string | null;
      piglet_batch_id: string | null;
      piglets_on_hand: number | null;
    };

/** The animal's output event, before an item is chosen — what its output would be if the item is a fitting one. */
export async function animalOutputEvent(
  db: MySql2Database<typeof schema>,
  animalId: string,
  stageId: string | null,
): Promise<AnimalOutputEvent | null> {
  const [animal] = await db
    .select({ gender: schema.animalRegister.gender, parity_count: schema.animalRegister.parity_count })
    .from(schema.animalRegister)
    .where(eq(schema.animalRegister.animal_id, animalId))
    .limit(1);
  if (animal?.gender === 'M') return { kind: 'SEMEN' };
  if (animal?.gender !== 'F') return null;

  // A sow cannot farrow again until her last litter is weaned, so she has at most one open litter.
  const [open] = await db
    .select({
      farrow_id: schema.farrowingRecord.farrow_id,
      parity_number: schema.farrowingRecord.parity_number,
      piglet_lot_no: schema.farrowingRecord.piglet_lot_no,
      piglet_batch_id: schema.farrowingRecord.piglet_batch_id,
    })
    .from(schema.farrowingRecord)
    .where(
      and(
        eq(schema.farrowingRecord.sow_animal_id, animalId),
        sql`${schema.farrowingRecord.parity_number} > ${animal.parity_count || 0}`,
      ),
    )
    .limit(1);
  if (!open) {
    const [stage] = stageId
      ? await db
          .select({ data_entry_form: schema.stageMaster.data_entry_form })
          .from(schema.stageMaster)
          .where(eq(schema.stageMaster.stage_id, stageId))
          .limit(1)
      : [];
    if (stage?.data_entry_form === 'FARROWING') return { kind: 'FARROWING' };
    return null;
  }

  let onHand: number | null = null;
  if (open.piglet_batch_id) {
    const [state] = await db
      .select({ current_quantity: schema.batchBioAssetState.current_quantity })
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, open.piglet_batch_id))
      .limit(1);
    if (state?.current_quantity != null) onHand = Number(state.current_quantity);
  }
  return {
    kind: 'WEANING',
    farrow_id: open.farrow_id,
    litter: Number(open.parity_number),
    piglet_lot_no: open.piglet_lot_no ?? null,
    piglet_batch_id: open.piglet_batch_id ?? null,
    piglets_on_hand: onHand,
  };
}

/** The boars a pooled semen entry is mixed with, as the draft keeps them (a JSON array of animal ids, or nothing). */
export function parsePoolIds(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}

/** A sow's litter is a lot of a bio-asset item: her output of anything else is ordinary output. */
export function outputEventForItem(
  event: AnimalOutputEvent | null,
  item: { is_biological_asset?: boolean | null } | undefined,
): AnimalOutputEvent | null {
  if (!event) return null;
  if (event.kind === 'SEMEN') return event;
  return item?.is_biological_asset ? event : null;
}

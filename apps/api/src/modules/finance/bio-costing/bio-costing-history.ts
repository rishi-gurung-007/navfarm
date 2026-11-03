import { eq, or, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';

/**
 * The runs that are an item's history: those made for the item, and those a costing profile made that charged (or skipped) one of the item's animals.
 * When an item takes over from the profile that costed its animals, the periods that profile already ran are the item's too: without them the scheduler
 * would find nothing posted and ask for every period since its Costing From date, and a period could be run behind a later one already posted.
 * Nothing is rewritten: the run keeps its profile, and is read as the item's through its lines.
 */
export function runsOfItem(itemId: string) {
  const R = schema.bioCostingRun;
  return or(
    eq(R.item_id, itemId),
    sql`${R.run_id} IN (SELECT l.run_id FROM ${schema.bioCostingRunLine} l JOIN ${schema.animalRegister} a ON a.animal_id = l.animal_id WHERE a.item_id = ${itemId})`,
  )!;
}

/**
 * The runs that charged (or skipped) any animal this run did: the history a run made before items costed animals has, since it names no item. The run itself
 * is included, so a caller that means "another run" adds its own exclusion.
 */
export function runsSharingAnimalsWith(runId: string) {
  const R = schema.bioCostingRun;
  return sql`${R.run_id} IN (SELECT l2.run_id FROM ${schema.bioCostingRunLine} l2 WHERE l2.animal_id IN (SELECT l1.animal_id FROM ${schema.bioCostingRunLine} l1 WHERE l1.run_id = ${runId}))`;
}

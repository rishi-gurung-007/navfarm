import { asc, eq, inArray, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

/**
 * Who was in a batch, and at which stage, on a given day (Rishi, 21 Oct): every data-entry decision about a past date
 * asks this, not who is in the batch now. animal_register holds only current state; animal_movement_log is the
 * append-only record of every move, so the answer is a replay of it.
 */

export interface MovementRow {
  movement_type: string;
  event_date: string;
  created_at: string;
  from_batch_id: string | null;
  to_batch_id: string | null;
  from_stage_id: string | null;
  to_stage_id: string | null;
}

export interface AnimalNow {
  current_batch_id: string | null;
  current_stage_id: string | null;
  is_active: boolean | null;
}

export interface Placement {
  batch_id: string | null;
  stage_id: string | null;
}

// Moves that put the animal into the batch named by to_batch_id. A stage change or relocation happens inside the batch
// the animal is in and never decides which batch that is.
const JOINS = new Set(['PURCHASE', 'ASSIGN', 'TRANSFER']);
// Moves after which the animal is in no batch at all.
const LEAVES = new Set(['UNASSIGN', 'MORTALITY', 'CULL', 'DISPOSAL']);
// Moves whose to_stage_id is where the animal stands afterwards.
const RESTAGES = new Set(['PURCHASE', 'ASSIGN', 'TRANSFER', 'STAGE_CHANGE']);

const day = (value: string) => String(value).slice(0, 10);

/**
 * Where one animal stood on `date`. The latest move on or before the date decides the batch, so on the day it moves an
 * animal belongs to the batch it moved INTO; the latest move that set a stage decides the stage. Rows of one day run in
 * the order they were written. Before its first move the animal was where that move says it came from (the stage from
 * the first row that names one); an animal the log never mentions is where the register has it, if it is still live.
 */
export function placementOn(movements: MovementRow[], now: AnimalNow, date: string): Placement {
  if (!movements.length) {
    return now.is_active
      ? { batch_id: now.current_batch_id, stage_id: now.current_stage_id }
      : { batch_id: null, stage_id: null };
  }
  const rows = [...movements].sort(
    (a, b) => day(a.event_date).localeCompare(day(b.event_date)) || String(a.created_at).localeCompare(String(b.created_at)),
  );
  let batch = rows[0].from_batch_id ?? null;
  let stage = rows.find((r) => r.from_stage_id)?.from_stage_id ?? now.current_stage_id ?? null;
  for (const row of rows) {
    if (day(row.event_date) > date) break;
    if (JOINS.has(row.movement_type)) batch = row.to_batch_id ?? null;
    else if (LEAVES.has(row.movement_type)) batch = null;
    else if (row.movement_type === 'MORTALITY_REVERSED') batch = row.to_batch_id ?? row.from_batch_id ?? null;
    if (RESTAGES.has(row.movement_type) && row.to_stage_id) stage = row.to_stage_id;
  }
  return { batch_id: batch, stage_id: stage };
}

export interface BatchMembership {
  /** Every animal that was in the batch on `date`, with the stage it was at that day. */
  on(date: string): Array<{ animal_id: string; stage_id: string | null }>;
}

const CHUNK = 400;

async function loadAnimals(db: MySql2Database<typeof schema>, animalIds: string[]) {
  const registers: Array<{ animal_id: string } & AnimalNow> = [];
  const moves = new Map<string, MovementRow[]>();
  for (let i = 0; i < animalIds.length; i += CHUNK) {
    const ids = animalIds.slice(i, i + CHUNK);
    registers.push(
      ...(await db
        .select({
          animal_id: schema.animalRegister.animal_id,
          current_batch_id: schema.animalRegister.current_batch_id,
          current_stage_id: schema.animalRegister.current_stage_id,
          is_active: schema.animalRegister.is_active,
        })
        .from(schema.animalRegister)
        .where(inArray(schema.animalRegister.animal_id, ids))),
    );
    const rows = await db
      .select({
        animal_id: schema.animalMovementLog.animal_id,
        movement_type: schema.animalMovementLog.movement_type,
        event_date: schema.animalMovementLog.event_date,
        created_at: schema.animalMovementLog.created_at,
        from_batch_id: schema.animalMovementLog.from_batch_id,
        to_batch_id: schema.animalMovementLog.to_batch_id,
        from_stage_id: schema.animalMovementLog.from_stage_id,
        to_stage_id: schema.animalMovementLog.to_stage_id,
      })
      .from(schema.animalMovementLog)
      .where(inArray(schema.animalMovementLog.animal_id, ids))
      .orderBy(asc(schema.animalMovementLog.event_date), asc(schema.animalMovementLog.created_at));
    for (const row of rows) {
      const list = moves.get(row.animal_id) ?? [];
      list.push(row);
      moves.set(row.animal_id, list);
    }
  }
  return { registers, moves };
}

/**
 * The batch's membership over time, loaded once: the animals the log says were ever in it, plus those the register
 * holds in it now (an animal the log never mentions). Ask it for as many dates as needed.
 */
export async function loadBatchMembership(db: MySql2Database<typeof schema>, batchId: string): Promise<BatchMembership> {
  const logged = await db
    .selectDistinct({ animal_id: schema.animalMovementLog.animal_id })
    .from(schema.animalMovementLog)
    .where(or(eq(schema.animalMovementLog.from_batch_id, batchId), eq(schema.animalMovementLog.to_batch_id, batchId)));
  const held = await db
    .select({ animal_id: schema.animalRegister.animal_id })
    .from(schema.animalRegister)
    .where(eq(schema.animalRegister.current_batch_id, batchId));
  const ids = [...new Set([...logged, ...held].map((r) => r.animal_id))];
  const { registers, moves } = await loadAnimals(db, ids);
  return {
    on(date: string) {
      const out: Array<{ animal_id: string; stage_id: string | null }> = [];
      for (const animal of registers) {
        const at = placementOn(moves.get(animal.animal_id) ?? [], animal, date);
        if (at.batch_id === batchId) out.push({ animal_id: animal.animal_id, stage_id: at.stage_id });
      }
      return out;
    },
  };
}

/** The animals in the batch on `date`, each with the stage it was at that day. */
export async function animalsInBatchOn(db: MySql2Database<typeof schema>, batchId: string, date: string) {
  return (await loadBatchMembership(db, batchId)).on(date);
}

/** One animal's batch and stage on `date`; both null when it was in none. */
export async function animalPlacementOn(db: MySql2Database<typeof schema>, animalId: string, date: string): Promise<Placement> {
  const { registers, moves } = await loadAnimals(db, [animalId]);
  const [animal] = registers;
  if (!animal) return { batch_id: null, stage_id: null };
  return placementOn(moves.get(animalId) ?? [], animal, date);
}

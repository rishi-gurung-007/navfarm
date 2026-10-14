/**
 * Puts a stage's AGE_WEEKS vaccinations on a batch scheduler as one-day CONSUMPTION lines (Rishi, 14 Oct), and keeps
 * them in step when the stage's protocol changes: a wanted line that is missing is added; an AUTO vaccination line that
 * is no longer wanted is removed only while nothing has been entered on it (an entered vaccination is history).
 */
import { randomUUID } from 'crypto';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { wantedVaccinations } from './vaccination-lines';

export interface VaccinationHeader {
  scheduler_id: string;
  batch_id: string;
  stage_id: string;
  effective_from: string;
  nob_id?: string | null;
  lob_id?: string | null;
}

/** Returns how many lines were added and removed. */
export async function syncVaccinationLines(
  db: MySql2Database<typeof schema>,
  header: VaccinationHeader,
  protocol: unknown,
  lifecycleId: string | null,
): Promise<{ added: number; removed: number }> {
  const [stage] = await db.select({ stage_name: schema.stageMaster.stage_name, days: schema.stageMaster.typical_duration_days })
    .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, header.stage_id)).limit(1);
  const [{ dob }] = await db.select({ dob: sql<string | null>`MIN(${schema.animalRegister.dob})` }).from(schema.animalRegister)
    .where(and(eq(schema.animalRegister.current_batch_id, header.batch_id), eq(schema.animalRegister.is_active, true)));
  const wanted = wantedVaccinations(protocol, dob ? String(dob).slice(0, 10) : null, String(header.effective_from).slice(0, 10), stage?.days ?? null);

  const sl = schema.schedulerLine;
  const existing = await db.select({ line_id: sl.line_id, item_id: sl.item_id, start_day: sl.start_day })
    .from(sl)
    .where(and(eq(sl.scheduler_id, header.scheduler_id), eq(sl.source, 'AUTO'), eq(sl.line_type, 'CONSUMPTION'),
      eq(sl.occurrence, 'CUSTOM'), like(sl.activity_name, 'Vaccination:%')));
  const key = (itemId: string | null, day: number) => `${itemId}|${day}`;
  const have = new Set(existing.map((l) => key(l.item_id, l.start_day)));
  const want = new Set(wanted.map((w) => key(w.itemId, w.day)));

  const stale = existing.filter((l) => !want.has(key(l.item_id, l.start_day)));
  let removed = 0;
  if (stale.length) {
    const entered = new Set((await db.select({ line_id: schema.batchDailyData.line_id }).from(schema.batchDailyData)
      .where(inArray(schema.batchDailyData.line_id, stale.map((l) => l.line_id)))).map((r) => r.line_id));
    const drop = stale.filter((l) => !entered.has(l.line_id)).map((l) => l.line_id);
    if (drop.length) {
      await db.delete(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, drop));
      await db.delete(sl).where(inArray(sl.line_id, drop));
      removed = drop.length;
    }
  }

  const add = wanted.filter((w) => !have.has(key(w.itemId, w.day)));
  if (!add.length) return { added: 0, removed };
  const items = await db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, lot: schema.itemMaster.is_lot_tracked, serial: schema.itemMaster.is_serial_tracked })
    .from(schema.itemMaster).where(and(inArray(schema.itemMaster.item_id, add.map((w) => w.itemId)), isNull(schema.itemMaster.deleted_at)));
  const itemById = new Map(items.map((i) => [i.item_id, i]));
  const [{ maxSeq }] = await db.select({ maxSeq: sql<number>`COALESCE(MAX(${sl.line_seq}), 0)` }).from(sl).where(eq(sl.scheduler_id, header.scheduler_id));
  let seq = Number(maxSeq) + 1;
  let added = 0;
  for (const w of add) {
    const item = itemById.get(w.itemId);
    if (!item) continue; // a vaccine no longer in the item master: nothing to schedule
    const lineId = randomUUID();
    await db.insert(sl).values({
      line_id: lineId, scheduler_id: header.scheduler_id, line_seq: seq++, line_type: 'CONSUMPTION',
      activity_name: `Vaccination: ${item.item_name} (age ${w.weeks} weeks)`, stage_id: header.stage_id, occurrence: 'CUSTOM',
      start_day: w.day, end_day: w.day, is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycleId,
      nob_id: header.nob_id ?? null, lob_id: header.lob_id ?? null, item_id: w.itemId, item_description: item.item_name,
      standard_qty: w.doseMl == null ? null : String(w.doseMl), qty_basis: 'PER_HEAD', allow_qty_edit: true,
      lot_required: Boolean(item.lot || item.serial),
    });
    await db.insert(schema.schedulerLineCustomDays).values({ custom_day_id: randomUUID(), line_id: lineId, day_number: w.day });
    added++;
  }
  return { added, removed };
}

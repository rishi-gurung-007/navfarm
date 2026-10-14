/**
 * Existing batch schedulers follow a stage's feed when it changes (Rishi, 13 Oct).
 *
 * A scheduler's feed lines are generated from the breed lifecycle rows when the batch enters the stage. When the
 * stage's feed is changed later (a new feed line, other days, another feed or rate, the stage deactivated), the open
 * schedulers of that breed and stage are brought in line with it for the days not yet entered.
 *
 * Days already entered keep their line as it is: a posted feed entry stores no item of its own, it is read through
 * its scheduler line, so changing that line would rewrite history. Such a line is cut back to the last entered day
 * and the current feed takes over from the next day.
 */
import { randomUUID } from 'crypto';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { syncVaccinationLines } from './vaccination-sync';
import { stageDayRange } from './feed-row-days';

/** A scheduler feed line as the refresh sees it. */
export interface ExistingFeedLine {
  lineId: string;
  startDay: number;
  endDay: number;
  itemId: string | null;
  qty: number;
  /** Last stage day with an entry on this line; 0 = nothing entered. */
  lastEnteredDay: number;
  /** The lifecycle row the line was made from. */
  lifecycleRefId?: string | null;
}

/** The feed the stage asks for now, over stage days. */
export interface WantedFeedLine {
  /** The lifecycle row this line follows. Absent on a line edited on the scheduler itself. */
  lifecycleId?: string | null;
  fromDay: number;
  toDay: number;
  itemId: string;
  qty: number;
}

export interface FeedLinePlan {
  /** Lines kept, with the end day they get and the lifecycle row they now follow (when it changes). */
  update: Array<{ lineId: string; endDay: number; lifecycleId?: string | null }>;
  remove: string[];
  insert: WantedFeedLine[];
}

const sameFeed = (a: { itemId: string | null; qty: number }, b: { itemId: string | null; qty: number }) =>
  a.itemId === b.itemId && Math.abs(a.qty - b.qty) < 1e-9;

/** What to change on one scheduler so its feed lines match `wanted` from the first day not yet entered. */
export function planFeedLineRefresh(existing: ExistingFeedLine[], wanted: WantedFeedLine[]): FeedLinePlan {
  const cutoff = Math.max(0, ...existing.map((l) => l.lastEnteredDay));
  const entered = existing.filter((l) => l.lastEnteredDay > 0);
  const open = existing.filter((l) => l.lastEnteredDay === 0);
  const plan: FeedLinePlan = { update: [], remove: [], insert: [] };

  // Lines with entries keep their days up to the last entered day.
  const kept = entered.map((l) => ({ ...l, newEnd: Math.min(l.endDay, cutoff), lifecycleId: (l.lifecycleRefId ?? null) as string | null }));
  const unmatched = new Set(open.map((l) => l.lineId));

  for (const w of [...wanted].sort((a, b) => a.fromDay - b.fromDay)) {
    const fromDay = Math.max(w.fromDay, cutoff + 1);
    if (fromDay > w.toDay) continue;
    // The same feed carrying on from an entered line: extend that line rather than start another.
    const carry = kept.find((k) => k.newEnd === fromDay - 1 && sameFeed(k, w));
    if (carry) {
      carry.newEnd = w.toDay;
      carry.lifecycleId = w.lifecycleId ?? null;
      continue;
    }
    // A line not entered yet that already says exactly this stays untouched.
    const same = open.find((l) => unmatched.has(l.lineId) && l.startDay === fromDay && l.endDay === w.toDay && sameFeed(l, w));
    if (same) {
      unmatched.delete(same.lineId);
      // Only a real new reference is worth an update. A feed edit made on the scheduler has no
      // lifecycle row, and recording that as a change would write a line's own end_day back to
      // itself on every save.
      if (w.lifecycleId && same.lifecycleRefId !== w.lifecycleId) plan.update.push({ lineId: same.lineId, endDay: same.endDay, lifecycleId: w.lifecycleId });
      continue;
    }
    plan.insert.push({ ...w, fromDay });
  }

  for (const k of kept) {
    const refChanged = Boolean(k.lifecycleId) && k.lifecycleId !== (k.lifecycleRefId ?? null);
    if (k.newEnd !== k.endDay || refChanged) plan.update.push({ lineId: k.lineId, endDay: k.newEnd, ...(refChanged ? { lifecycleId: k.lifecycleId } : {}) });
  }
  plan.remove.push(...unmatched);
  return plan;
}

/**
 * Refresh the feed lines of every open, lifecycle-generated scheduler of this breed and stage. Returns the ids of the
 * schedulers that changed. Schedulers copied from a system scheduler, declined (empty) ones and completed ones are
 * left alone, as are manual lines and protocol (medication / vaccination) lines.
 */
export async function refreshSchedulerFeedLines(
  db: MySql2Database<typeof schema>,
  args: { tenantId: string; breedId: string; stageId: string },
): Promise<string[]> {
  const { tenantId, breedId, stageId } = args;
  const sh = schema.schedulerHeader;
  const sl = schema.schedulerLine;

  const headers = await db
    .select({ scheduler_id: sh.scheduler_id, batch_id: sh.batch_id, effective_from: sh.effective_from, nob_id: sh.nob_id, lob_id: sh.lob_id })
    .from(sh)
    .where(and(
      eq(sh.tenant_id, tenantId),
      eq(sh.breed_id, breedId),
      eq(sh.stage_id, stageId),
      eq(sh.auto_generated, true),
      isNull(sh.system_scheduler_id),
      inArray(sh.scheduler_status, ['DRAFT', 'ACTIVE', 'SUSPENDED']),
      // Generated from the breed lifecycle: it holds lines that point at lifecycle rows.
      sql`EXISTS (SELECT 1 FROM scheduler_line x WHERE x.scheduler_id = ${sh.scheduler_id} AND x.source = 'AUTO' AND x.lifecycle_ref_id IS NOT NULL)`,
    ));
  if (!headers.length) return [];

  // The stage's feed now: the same rows and rule the scheduler is generated with (scheduler-header.service).
  const [stage] = await db.select({ stage_name: schema.stageMaster.stage_name }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
  const rows = await db
    .select()
    .from(schema.breedLifecycleStages)
    .where(and(
      eq(schema.breedLifecycleStages.breed_id, breedId),
      eq(schema.breedLifecycleStages.stage_id, stageId),
      eq(schema.breedLifecycleStages.is_active, true),
      isNotNull(schema.breedLifecycleStages.feed_item_id),
    ))
    .orderBy(asc(schema.breedLifecycleStages.period_from));
  const wanted: WantedFeedLine[] = rows
    .filter((r) => Number(r.feed_qty_per_head_per_day_kg) > 0)
    .map((r) => {
      const { fromDay, toDay } = stageDayRange(r.calc_unit, r.period_from, r.period_to);
      return { lifecycleId: r.lifecycle_id, fromDay, toDay, itemId: r.feed_item_id as string, qty: Number(r.feed_qty_per_head_per_day_kg) };
    });
  const itemIds = [...new Set(wanted.map((w) => w.itemId))];
  const items = itemIds.length
    ? await db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked })
      .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds))
    : [];
  const itemById = new Map(items.map((i) => [i.item_id, i]));

  // The stage's vaccinations (shared by all its rows) follow too (Rishi, 14 Oct: AGE_WEEKS from the date of birth).
  const [protocolRow] = await db
    .select({ lifecycle_id: schema.breedLifecycleStages.lifecycle_id, vaccination_protocol: schema.breedLifecycleStages.vaccination_protocol })
    .from(schema.breedLifecycleStages)
    .where(and(
      eq(schema.breedLifecycleStages.breed_id, breedId),
      eq(schema.breedLifecycleStages.stage_id, stageId),
      eq(schema.breedLifecycleStages.is_active, true),
    ))
    .orderBy(asc(schema.breedLifecycleStages.period_from))
    .limit(1);

  const changed: string[] = [];
  for (const h of headers) {
    const fed = await applySchedulerFeedLines(db, { header: { ...h, stage_id: stageId }, wanted, stageName: stage?.stage_name ?? null, itemById });
    const vac = await syncVaccinationLines(db, { ...h, stage_id: stageId }, protocolRow?.vaccination_protocol ?? null, protocolRow?.lifecycle_id ?? null);
    if (fed || vac.added || vac.removed) changed.push(h.scheduler_id);
  }
  return changed;
}

/** One scheduler, as the feed apply needs to see it. */
export interface SchedulerForFeed {
  scheduler_id: string;
  effective_from: unknown;
  nob_id: string | null;
  lob_id: string | null;
  stage_id: string;
}

/**
 * Bring one scheduler's feed lines in line with `wanted`, protecting days already entered.
 * Returns whether anything changed.
 *
 * Shared by the lifecycle refresh above and by a feed edit made on the scheduler itself
 * (Rishi, 14 Oct), so the history rule has one implementation: a line with entries keeps its
 * item and rate up to the last entered day, and the new feed starts the day after.
 */
export async function applySchedulerFeedLines(
  db: MySql2Database<typeof schema>,
  args: {
    header: SchedulerForFeed;
    wanted: WantedFeedLine[];
    stageName?: string | null;
    /** Preloaded items, to save a query when a caller already has them. */
    itemById?: Map<string, { item_name: string; is_lot_tracked?: boolean | null; is_serial_tracked?: boolean | null }>;
  },
): Promise<boolean> {
  const { header: h, wanted, stageName } = args;
  const sl = schema.schedulerLine;

  let itemById = args.itemById;
  if (!itemById) {
    const itemIds = [...new Set(wanted.map((w) => w.itemId))];
    const items = itemIds.length
      ? await db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked })
        .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds))
      : [];
    itemById = new Map(items.map((i) => [i.item_id, i]));
  }

  // Every AUTO daily feed line, whether it still points at a lifecycle row or was written here.
  // A line the user edited has no lifecycle_ref_id; leaving it out would let a later lifecycle
  // refresh insert a second line over the same days.
  const feedLines = await db
    .select({ line_id: sl.line_id, start_day: sl.start_day, end_day: sl.end_day, item_id: sl.item_id, standard_qty: sl.standard_qty, lifecycle_ref_id: sl.lifecycle_ref_id })
    .from(sl)
    .where(and(eq(sl.scheduler_id, h.scheduler_id), eq(sl.source, 'AUTO'), eq(sl.line_type, 'CONSUMPTION'), eq(sl.occurrence, 'DAILY')));

  const lastDays = feedLines.length
    ? await db
      .select({ line_id: schema.batchDailyData.line_id, last_day: sql<number>`MAX(DATEDIFF(${schema.batchDailyData.entry_date}, ${h.effective_from}) + 1)` })
      .from(schema.batchDailyData)
      .where(inArray(schema.batchDailyData.line_id, feedLines.map((l) => l.line_id)))
      .groupBy(schema.batchDailyData.line_id)
    : [];
  const lastByLine = new Map(lastDays.map((d) => [d.line_id, Math.max(0, Number(d.last_day))]));
  const existing: ExistingFeedLine[] = feedLines.map((l) => ({
    lineId: l.line_id, startDay: l.start_day, endDay: l.end_day ?? Number.MAX_SAFE_INTEGER, itemId: l.item_id, qty: Number(l.standard_qty ?? 0),
    lastEnteredDay: lastByLine.get(l.line_id) ?? 0, lifecycleRefId: l.lifecycle_ref_id,
  }));

  const plan = planFeedLineRefresh(existing, wanted);
  if (!plan.update.length && !plan.remove.length && !plan.insert.length) return false;

  for (const u of plan.update) {
    // Only a real id is written: a line kept for history stays on the lifecycle row it was posted against.
    await db.update(sl).set({ end_day: u.endDay, ...(u.lifecycleId ? { lifecycle_ref_id: u.lifecycleId } : {}) }).where(eq(sl.line_id, u.lineId));
  }
  if (plan.remove.length) {
    await db.delete(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, plan.remove));
    await db.delete(sl).where(inArray(sl.line_id, plan.remove));
  }
  const [{ maxSeq }] = await db.select({ maxSeq: sql<number>`COALESCE(MAX(${sl.line_seq}), 0)` }).from(sl).where(eq(sl.scheduler_id, h.scheduler_id));
  let seq = Number(maxSeq) + 1;
  for (const w of plan.insert) {
    const item = itemById.get(w.itemId);
    await db.insert(sl).values({
      line_id: randomUUID(), scheduler_id: h.scheduler_id, line_seq: seq++, line_type: 'CONSUMPTION',
      activity_name: `${stageName ?? 'Stage'} Feed — ${item?.item_name ?? 'Unknown Item'}`, stage_id: h.stage_id, occurrence: 'DAILY',
      start_day: w.fromDay, end_day: w.toDay, is_mandatory: true, source: 'AUTO', lifecycle_ref_id: w.lifecycleId ?? null,
      nob_id: h.nob_id ?? null, lob_id: h.lob_id ?? null, item_id: w.itemId, item_description: item?.item_name ?? null,
      standard_qty: String(w.qty), qty_basis: 'PER_HEAD', allow_qty_edit: true,
      lot_required: Boolean(item?.is_lot_tracked || item?.is_serial_tracked),
    });
  }
  return true;
}

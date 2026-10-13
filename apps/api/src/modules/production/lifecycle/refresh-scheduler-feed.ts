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
  lifecycleId: string;
  fromDay: number;
  toDay: number;
  itemId: string;
  qty: number;
}

export interface FeedLinePlan {
  /** Lines kept, with the end day they get and the lifecycle row they now follow (when it changes). */
  update: Array<{ lineId: string; endDay: number; lifecycleId?: string }>;
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
  const kept = entered.map((l) => ({ ...l, newEnd: Math.min(l.endDay, cutoff), lifecycleId: l.lifecycleRefId ?? undefined }));
  const unmatched = new Set(open.map((l) => l.lineId));

  for (const w of [...wanted].sort((a, b) => a.fromDay - b.fromDay)) {
    const fromDay = Math.max(w.fromDay, cutoff + 1);
    if (fromDay > w.toDay) continue;
    // The same feed carrying on from an entered line: extend that line rather than start another.
    const carry = kept.find((k) => k.newEnd === fromDay - 1 && sameFeed(k, w));
    if (carry) {
      carry.newEnd = w.toDay;
      carry.lifecycleId = w.lifecycleId;
      continue;
    }
    // A line not entered yet that already says exactly this stays untouched.
    const same = open.find((l) => unmatched.has(l.lineId) && l.startDay === fromDay && l.endDay === w.toDay && sameFeed(l, w));
    if (same) {
      unmatched.delete(same.lineId);
      if (same.lifecycleRefId !== w.lifecycleId) plan.update.push({ lineId: same.lineId, endDay: same.endDay, lifecycleId: w.lifecycleId });
      continue;
    }
    plan.insert.push({ ...w, fromDay });
  }

  for (const k of kept) {
    const refChanged = k.lifecycleId !== (k.lifecycleRefId ?? undefined);
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
    .select({ scheduler_id: sh.scheduler_id, effective_from: sh.effective_from, nob_id: sh.nob_id, lob_id: sh.lob_id })
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

  const changed: string[] = [];
  for (const h of headers) {
    const feedLines = await db
      .select({ line_id: sl.line_id, start_day: sl.start_day, end_day: sl.end_day, item_id: sl.item_id, standard_qty: sl.standard_qty, lifecycle_ref_id: sl.lifecycle_ref_id })
      .from(sl)
      .where(and(eq(sl.scheduler_id, h.scheduler_id), eq(sl.source, 'AUTO'), eq(sl.line_type, 'CONSUMPTION'), eq(sl.occurrence, 'DAILY'), isNotNull(sl.lifecycle_ref_id)));
    const lastDays = feedLines.length
      ? await db
        .select({ line_id: schema.batchDailyData.line_id, last_day: sql<number>`MAX(DATEDIFF(${schema.batchDailyData.entry_date}, ${h.effective_from}) + 1)` })
        .from(schema.batchDailyData)
        .where(inArray(schema.batchDailyData.line_id, feedLines.map((l) => l.line_id)))
        .groupBy(schema.batchDailyData.line_id)
      : [];
    const lastByLine = new Map(lastDays.map((d) => [d.line_id, Math.max(0, Number(d.last_day))]));
    const existing: ExistingFeedLine[] = feedLines.map((l) => ({
      lineId: l.line_id, startDay: l.start_day, endDay: l.end_day ?? Number.MAX_SAFE_INTEGER, itemId: l.item_id, qty: Number(l.standard_qty ?? 0), lastEnteredDay: lastByLine.get(l.line_id) ?? 0,
      lifecycleRefId: l.lifecycle_ref_id,
    }));

    const plan = planFeedLineRefresh(existing, wanted);
    if (!plan.update.length && !plan.remove.length && !plan.insert.length) continue;

    for (const u of plan.update) {
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
        activity_name: `${stage?.stage_name ?? 'Stage'} Feed — ${item?.item_name ?? 'Unknown Item'}`, stage_id: stageId, occurrence: 'DAILY',
        start_day: w.fromDay, end_day: w.toDay, is_mandatory: true, source: 'AUTO', lifecycle_ref_id: w.lifecycleId,
        nob_id: h.nob_id ?? null, lob_id: h.lob_id ?? null, item_id: w.itemId, item_description: item?.item_name ?? null,
        standard_qty: String(w.qty), qty_basis: 'PER_HEAD', allow_qty_edit: true,
        lot_required: Boolean(item?.is_lot_tracked || item?.is_serial_tracked),
      });
    }
    changed.push(h.scheduler_id);
  }
  return changed;
}

/**
 * Chapter `04-daily-entries` — Phase 3 Task 6. Posts a 14-day owed history
 * ending yesterday (company timezone, Africa/Harare) for each demo batch
 * through `BatchDailyDataService.postEntry` — never raw inserts (Ruling 1):
 *
 *   - Feed lines (CONSUMPTION): the line's standard_qty × the scheduler's
 *     animal_count, varied by a small deterministic day pattern (± 2%),
 *     so the demo has real, non-flat consumption and FIFO draws.
 *   - Mortality (DESCRIPTIVE / MORTALITY_COUNT): 0 every day except two
 *     single deaths on the Grasmere Count-Only grower batch.
 *   - One mandatory line deliberately skipped on two distinct days on the
 *     Grasmere registered batch, so the History rail shows Missing.
 *
 * A Grasmere feed top-up goods receipt is posted first: 14 days ×
 * (2.2 kg × 9) + (2.5 kg × 120) ≈ 4,477 kg against ~4,000 kg on-farm, and
 * `consumptionWarehouse` bounds FIFO draws to the batch's farm — the refusal
 * is correct engine behavior, so the demo stocks the farm instead of
 * bypassing the check.
 *
 * The scheduler's feed lines are `lot_required` (the harness's first run
 * proved the refusal works), so every feed entry carries a lot picked per
 * batch as the on-farm lot with the most remaining stock — `consumptionWarehouse`
 * bounds FIFO to the batch's farm and the ledger filters by lot, so a lot
 * that is not on the batch's farm would be correctly refused.
 *
 * Resume semantics: every postEntry is idempotent (posting the same value on
 * an already-posted line/date is a no-op that returns the day view), so the
 * chapter simply skips day/line pairs that already have a POSTED row.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=04-daily-entries
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchDailyDataService } from '../../../modules/production/batch-daily-data/batch-daily-data.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

/** The two days the Grasmere registered batch shows a Missing mandatory line. */
const SKIP_DAYS_ON_REGISTERED = [4, 9];

/** Deterministic ±2% feed variation: +2% on odd days, −2% on even days. */
const feedFactor = (day: number): number => (day % 2 === 1 ? 1.02 : 0.98);

/** The two single deaths: day 6 and day 11 on the Grasmere grower batch. */
const mortalityDays = (day: number): number => (day === 6 || day === 11 ? 1 : 0);

function dateNdaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

interface DemoLine {
  line_id: string;
  activity_name: string;
  line_type: string | null;
  kpi_metric: string | null;
  occurrence: string | null;
  start_day: number | null;
  is_mandatory: boolean;
  standard_qty: string | null;
  item_id: string | null;
}

export const dailyEntriesChapter: DemoChapter = {
  name: '04-daily-entries',

  async run(ctx: DemoContext): Promise<void> {
    const entries = ctx.app.get(BatchDailyDataService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('04-daily-entries: tenantDb is not set — run through the harness.');

    // The three demo batches, by their chapter-03 remarks tokens.
    const batchRefs = ['DEMO-BATCH-REG-GRASMERE', 'DEMO-BATCH-CO-GRASMERE', 'DEMO-BATCH-CO-KINTYRE'];
    const batches = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, remarks: schema.batchHeader.remarks, farm_id: schema.batchHeader.farm_id })
      .from(schema.batchHeader)
      .where(inArray(schema.batchHeader.remarks, batchRefs));
    if (batches.length !== batchRefs.length) {
      throw new Error(`04-daily-entries: expected ${batchRefs.length} demo batches, found ${batches.length} — run 03-batches-and-animals first.`);
    }
    const registered = batches.find((b) => b.remarks === 'DEMO-BATCH-REG-GRASMERE')!;
    const growerGrasmere = batches.find((b) => b.remarks === 'DEMO-BATCH-CO-GRASMERE')!;
    const growerKintyre = batches.find((b) => b.remarks === 'DEMO-BATCH-CO-KINTYRE')!;

    // The 14-day window ends yesterday (Harare is UTC+2 — 1h offset from the
    // server; yesterday is yesterday either way, but compute it honestly).
    const yesterdayHarare = dateNdaysAgo(1);
    const firstDay = dateNdaysAgo(14);

    // ── Feed top-up: FIFO on a farm is bounded to that farm's warehouses, and
    // 14 days of Grasmere demand exceeds what 02-inventory receipted.
    const feedItemCode = 'FEED-FINISHED_SWINE_FEEDS_DIETS-GESTATION-ITM-0001';
    const [feedItem] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_code, feedItemCode), eq(schema.itemMaster.is_active, true)))
      .limit(1);
    if (!feedItem) throw new Error(`04-daily-entries: item ${feedItemCode} not found.`);
    if (!growerGrasmere.farm_id) throw new Error('04-daily-entries: Grasmere grower batch carries no farm_id.');

    const ref = 'DEMO-MUL100-FEED-TOPUP';
    const [existingTopup] = await db
      .select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
      .from(schema.goodsReceipt)
      .where(eq(schema.goodsReceipt.external_reference_no, ref))
      .limit(1);
    if (!existingTopup) {
      const created = await receipts.create(
        {
          company_id: ctx.companyId,
          warehouse_id: growerGrasmere.farm_id,
          posting_date: firstDay,
          external_reference_no: ref,
          remarks: 'DEMO feed top-up so the 14-day consumption history can draw on-farm',
          lines: [
            { item_id: feedItem.item_id, quantity: 2000, uom: 'KG', rate: feedItem.standard_cost ?? undefined, lot_no: 'DEMO-FEED-TOPUP' },
          ],
        },
        ctx.tenantId,
      );
      await receipts.post(created.receipt_id, ctx.tenantId);
      ctx.log('MUL100: feed top-up receipt posted (+2,000 kg gestation feed)');
    } else {
      ctx.log('MUL100: feed top-up receipt already present — skipped');
    }

    // ── Lines per batch (the schedulers chapter 03 generated).
    const allLines = await db
      .select({
        batch_id: schema.schedulerHeader.batch_id,
        line_id: schema.schedulerLine.line_id,
        activity_name: schema.schedulerLine.activity_name,
        line_type: schema.schedulerLine.line_type,
        kpi_metric: schema.schedulerLine.kpi_metric,
        occurrence: schema.schedulerLine.occurrence,
        start_day: schema.schedulerLine.start_day,
        is_mandatory: schema.schedulerLine.is_mandatory,
        standard_qty: schema.schedulerLine.standard_qty,
        item_id: schema.schedulerLine.item_id,
      })
      .from(schema.schedulerLine)
      .innerJoin(schema.schedulerHeader, eq(schema.schedulerHeader.scheduler_id, schema.schedulerLine.scheduler_id))
      .where(inArray(schema.schedulerHeader.batch_id, batches.map((b) => b.batch_id)))
      .orderBy(schema.schedulerLine.line_seq);

    const linesByBatch = new Map<string, DemoLine[]>();
    for (const line of allLines) {
      const list = linesByBatch.get(line.batch_id) ?? [];
      list.push(line);
      linesByBatch.set(line.batch_id, list);
    }

    // Headcount per batch (scheduler_header.animal_count), read once.
    const headcountByBatch = new Map<string, number>();
    for (const [batchId] of linesByBatch) {
      const [header] = await db
        .select({ animal_count: schema.schedulerHeader.animal_count })
        .from(schema.schedulerHeader)
        .where(eq(schema.schedulerHeader.batch_id, batchId))
        .limit(1);
      headcountByBatch.set(batchId, Number(header?.animal_count ?? 0));
    }

    /**
     * Lot per entry: the on-farm lot (locationOnFarm — the warehouse is the
     * farm itself or hangs off it) holding the most remaining stock. Pinned
     * per batch once, a lot can run dry mid-window and the FIFO check correctly
     * refuses — so each feed entry picks the fullest on-farm lot at post time.
     */
    async function pickLot(batchId: string, farmId: string, itemId: string, needed: number): Promise<string | undefined> {
      const lots = await db
        .select({ lot_no: schema.inventoryLedger.lot_no, total: sql<number>`SUM(${schema.inventoryLedger.remaining_quantity})` })
        .from(schema.inventoryLedger)
        .where(and(
          eq(schema.inventoryLedger.item_id, itemId),
          eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
          sql`${schema.inventoryLedger.remaining_quantity} > 0`,
          sql`${schema.inventoryLedger.warehouse_id} IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ${farmId} OR lf.farm_id = ${farmId})`,
        ))
        .groupBy(schema.inventoryLedger.lot_no)
        .orderBy(desc(sql`SUM(${schema.inventoryLedger.remaining_quantity})`));
      const usable = lots.filter((l) => l.lot_no && Number(l.total) >= needed);
      const chosen = usable[0] ?? lots.find((l) => l.lot_no);
      if (!chosen?.lot_no) throw new Error(`04-daily-entries: no lot on farm for batch ${batchId} — receipt stock first.`);
      return chosen.lot_no;
    }

    // Already-posted day/line pairs — the resume probe.
    const posted = await db
      .select({ line_id: schema.batchDailyData.line_id, entry_date: schema.batchDailyData.entry_date })
      .from(schema.batchDailyData)
      .where(and(
        inArray(schema.batchDailyData.batch_id, batches.map((b) => b.batch_id)),
        eq(schema.batchDailyData.status, 'POSTED'),
      ));
    const postedKeys = new Set(posted.map((p) => `${p.line_id}|${p.entry_date}`));

    // Day index within the window: the scheduler's effective_from is day 1
    // (day-completeness convention), and the demo schedulers' effective_from
    // equals the batch start date (14 days back = firstDay).
    const days: string[] = [];
    for (let i = 14; i >= 1; i--) days.push(dateNdaysAgo(i));
    const dayIndexOf = (date: string): number =>
      Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000) + 1;

    let postedCount = 0;
    let skippedCount = 0;

    for (const batch of batches) {
      const lines = linesByBatch.get(batch.batch_id) ?? [];
      if (lines.length === 0) {
        ctx.log(`${batch.batch_no}: scheduler has no lines — nothing to post (run the scheduler repair first)`);
        continue;
      }

      for (const date of days) {
        const day = dayIndexOf(date);
        for (const line of lines) {
          // Feed lines post only once a line has started (start_day); the
          // day-56 medication CUSTOM line is far outside the window.
          if (!isDue(line, day, date)) continue;

          const key = `${line.line_id}|${date}`;
          if (postedKeys.has(key)) {
            skippedCount += 1;
            continue;
          }

          // The plan's Missing days: skip one mandatory line on two distinct
          // days on the registered batch.
          if (batch.batch_id === registered.batch_id && line.is_mandatory && SKIP_DAYS_ON_REGISTERED.includes(day)) {
            skippedCount += 1;
            continue;
          }

          const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

          if (line.line_type === 'CONSUMPTION' && line.item_id) {
            // standard_qty is per-head-per-day; the scheduler's animal_count is
            // the batch's headcount. Deterministic ±2% day pattern.
            const headcount = headcountByBatch.get(batch.batch_id) ?? 0;
            const standard = Number(line.standard_qty ?? 0);
            if (standard <= 0) {
              ctx.log(`${batch.batch_no}: feed line '${line.activity_name}' has standard_qty 0 — skipped`);
              continue;
            }
            const value = round2(standard * headcount * feedFactor(day));
            const lot = await pickLot(batch.batch_id, batch.farm_id!, feedItem.item_id, value);
            await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: value, lot_no: lot }, ctx.tenantId, actor);
            postedCount += 1;
          } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'MORTALITY_COUNT') {
            // Mortality mostly 0; two single deaths on the Grasmere grower.
            const value = batch.batch_id === growerGrasmere.batch_id ? mortalityDays(day) : 0;
            await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: value }, ctx.tenantId, actor);
            postedCount += 1;
          } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'BODY_WEIGHT') {
            // Weekly non-mandatory check — a plausible weight for the stock:
            // mature breeding stock on the registered batch, growing pigs on
            // the grower batches.
            const value = batch.batch_id === registered.batch_id ? 160 + day : 62 + day;
            await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: value }, ctx.tenantId, actor);
            postedCount += 1;
          } else {
            skippedCount += 1;
          }
        }
      }
    }

    ctx.log(`04-daily-entries: posted ${postedCount} entr(ies), skipped ${skippedCount} line-day(s) (window ${firstDay} … ${yesterdayHarare})`);
  },
};

/** Feed lines are DAILY from start_day; weekly body-weight lines due on their
 * weekday; CUSTOM lines resolve via scheduler_line_custom_days (none here).
 * Mirrors day-completeness.ts's rule loosely enough for the demo's line set. */
function isDue(line: DemoLine, day: number, date: string): boolean {
  const start = line.start_day ?? 1;
  if (day < start) return false;
  switch ((line.occurrence || 'DAILY').toUpperCase()) {
    case 'ONCE':
      return day === start;
    case 'WEEKLY':
      return weekdayOf(date) === weekdayOf(demoEffectiveFrom());
    case 'CUSTOM':
      return false; // no CUSTOM line falls inside the 14-day window
    default:
      return true;
  }
}

function demoEffectiveFrom(): string {
  return new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const js = new Date(`${date}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

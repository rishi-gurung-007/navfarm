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
 * Before any entry posts, every warehouse the window's feed draws come out
 * of is topped up (final review, C1). Batches stand in sheds, so each feed
 * entry draws from the silo attached to its shed and applyFifo confines the
 * draw to that one warehouse; chapter 02 stocked each silo with a flat
 * 2,000 kg before any batch existed, and a 120-sow gestation batch eats
 * ~300 kg a day — the rebuild died on day seven with "Insufficient stock".
 * This chapter is the first point at which the batches, schedulers and head
 * counts all exist, so the demand is summed here from the very draws it is
 * about to post, against the very warehouse BatchDailyDataService will draw
 * each from (its own resolveConsumptionWarehouse), and topped up to demand ×
 * 1.5 — at least 2,000 kg, at most the silo's capacity (daily-entry-plan.ts).
 * Where capacity caps it, a further receipt is posted mid-window, just before
 * the draw that would otherwise come up short. Chapter 02 was not changed to
 * do this sizing itself because it runs before chapter 03 creates a batch:
 * it would have had to re-derive 03's batches, stages, sheds and head counts,
 * a second copy of that logic to drift from the first.
 *
 * The scheduler's feed lines are `lot_required` (the harness's first run
 * proved the refusal works), so every feed entry carries the lot holding the
 * most stock in the warehouse it draws from — the ledger filters by lot as
 * well as by warehouse, so a lot picked anywhere else would be refused. A
 * top-up is received under the lot that warehouse already holds, so the
 * silo's stock stays in one lot a single draw can use all of.
 *
 * Resume semantics: every postEntry is idempotent (posting the same value on
 * an already-posted line/date is a no-op that returns the day view), so the
 * chapter simply skips day/line pairs that already have a POSTED row. Top-up
 * receipts are found by their DEMO external reference like chapter 02's
 * (absent -> create + post, DRAFT -> post, POSTED -> skip), and are sized
 * net of what the warehouse already holds against only the draws still to
 * post, so a re-run receives nothing it has already received.
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
import { tagOf } from '../farms';
import { isDue, midwayTopUpKg, topUpKg } from '../daily-entry-plan';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}


/** The two days the Grasmere registered batch shows a Missing mandatory line. */
const SKIP_DAYS_ON_REGISTERED = [4, 9];

/** Deterministic ±2% feed variation: +2% on odd days, −2% on even days. */
const feedFactor = (day: number): number => (day % 2 === 1 ? 1.02 : 0.98);

/** The two single deaths: day 6 and day 11 on the Grasmere headcount batch. */
const mortalityDays = (day: number): number => (day === 6 || day === 11 ? 1 : 0);

/** Grasmere's (MUL100) bulk batch: the legacy token its first run used, or the stage-keyed one a rebuild now gives it. */
const isGrasmereHeadcountBatch = (remarks: string | null): boolean =>
  remarks === 'DEMO-BATCH-CO-GRASMERE' || (remarks?.startsWith('DEMO-MUL100-CO-') ?? false);

function dateNdaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

interface DemoLine {
  scheduler_id: string;
  stage_id: string | null;
  effective_from: string | Date;
  location_id: string | null;
  animal_count: string | null;
  line_id: string;
  activity_name: string;
  line_type: string | null;
  kpi_metric: string | null;
  occurrence: string | null;
  start_day: number | null;
  end_day: number | null;
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

    // All active demo batches across the nine farms
    const batches = await db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        remarks: schema.batchHeader.remarks,
        farm_id: schema.batchHeader.farm_id,
        start_date: schema.batchHeader.start_date,
        tracking_mode: schema.batchHeader.tracking_mode,
      })
      .from(schema.batchHeader)
      .where(and(
        sql`${schema.batchHeader.remarks} LIKE 'DEMO-%'`,
        eq(schema.batchHeader.status, 'ACTIVE'),
      ));

    if (batches.length === 0) {
      throw new Error('04-daily-entries: no demo batches found — run 03-batches-and-animals first.');
    }

    const registeredBatches = new Set(batches.filter((b) => b.remarks?.includes('-REG')).map((b) => b.batch_id));

    // The 14-day window ends yesterday (Harare is UTC+2 — 1h offset from the
    // server; yesterday is yesterday either way, but compute it honestly).
    const yesterdayHarare = dateNdaysAgo(1);
    const firstDay = dateNdaysAgo(14);

    // ── Lines per batch (the schedulers chapters 03 generated — one scheduler
    // per stage the batch's flow walked, so a batch carries several, each with
    // its own effective_from: day 3 of farrowing is not day 3 of gestation).
    // Day numbers are computed per scheduler below, from that scheduler's own
    // effective_from, the same way day-completeness.ts counts them.
    const allLines = await db
      .select({
        batch_id: schema.schedulerHeader.batch_id,
        stage_id: schema.schedulerHeader.stage_id,
        scheduler_id: schema.schedulerHeader.scheduler_id,
        effective_from: schema.schedulerHeader.effective_from,
        location_id: schema.schedulerHeader.location_id,
        animal_count: schema.schedulerHeader.animal_count,
        line_id: schema.schedulerLine.line_id,
        activity_name: schema.schedulerLine.activity_name,
        line_type: schema.schedulerLine.line_type,
        kpi_metric: schema.schedulerLine.kpi_metric,
        occurrence: schema.schedulerLine.occurrence,
        start_day: schema.schedulerLine.start_day,
        end_day: schema.schedulerLine.end_day,
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

    // An Animal Wise batch takes its entries per animal, and only for the animals
    // standing in that scheduler's stage right now (BatchDailyDataService refuses
    // any other). Group them by batch and stage once, up front.
    const animalWiseIds = batches.filter((b) => b.tracking_mode === 'ANIMAL_WISE').map((b) => b.batch_id);
    const animalsByBatchStage = new Map<string, string[]>();
    if (animalWiseIds.length) {
      const standing = await db
        .select({ animal_id: schema.animalRegister.animal_id, batch_id: schema.animalRegister.current_batch_id, stage_id: schema.animalRegister.current_stage_id })
        .from(schema.animalRegister)
        .where(and(inArray(schema.animalRegister.current_batch_id, animalWiseIds), eq(schema.animalRegister.is_active, true)))
        .orderBy(schema.animalRegister.animal_code);
      for (const a of standing) {
        const key = `${a.batch_id}|${a.stage_id}`;
        animalsByBatchStage.set(key, [...(animalsByBatchStage.get(key) ?? []), a.animal_id]);
      }
    }

    // Headcount per scheduler, not per batch: each stage's scheduler snapshots
    // the head standing in its own stage, and a feed line draws against the
    // stage it is scheduled in.
    const headcountByScheduler = new Map<string, number>();
    for (const line of allLines) {
      if (!headcountByScheduler.has(line.scheduler_id)) {
        headcountByScheduler.set(line.scheduler_id, Number(line.animal_count ?? 0));
      }
    }

    /**
     * Lot per entry: the lot holding the most remaining stock in the warehouse
     * the entry draws from. The ledger filters by warehouse and lot together,
     * so the fullest lot anywhere else on the farm — the store's, say, when
     * the draw comes out of a silo — would be refused however much it held.
     */
    async function pickLot(warehouseId: string, itemId: string): Promise<string | null> {
      const [lot] = await db
        .select({ lot_no: schema.inventoryLedger.lot_no })
        .from(schema.inventoryLedger)
        .where(and(
          eq(schema.inventoryLedger.tenant_id, ctx.tenantId),
          eq(schema.inventoryLedger.warehouse_id, warehouseId),
          eq(schema.inventoryLedger.item_id, itemId),
          eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
          sql`${schema.inventoryLedger.lot_no} IS NOT NULL`,
          sql`${schema.inventoryLedger.remaining_quantity} > 0`,
        ))
        .groupBy(schema.inventoryLedger.lot_no)
        .orderBy(desc(sql`SUM(${schema.inventoryLedger.remaining_quantity})`))
        .limit(1);
      return lot?.lot_no ?? null;
    }

    /** What applyFifo can draw on: remaining quantity of POSITIVE layers of the item in the warehouse. */
    async function onHandKg(warehouseId: string, itemId: string): Promise<number> {
      const [row] = await db
        .select({ total: sql<string | null>`SUM(${schema.inventoryLedger.remaining_quantity})` })
        .from(schema.inventoryLedger)
        .where(and(
          eq(schema.inventoryLedger.tenant_id, ctx.tenantId),
          eq(schema.inventoryLedger.company_id, ctx.companyId),
          eq(schema.inventoryLedger.warehouse_id, warehouseId),
          eq(schema.inventoryLedger.item_id, itemId),
          eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
        ));
      return Number(row?.total ?? 0);
    }

    // Already-posted day/line pairs — the resume probe.
    const posted = await db
      .select({ line_id: schema.batchDailyData.line_id, entry_date: schema.batchDailyData.entry_date, animal_id: schema.batchDailyData.animal_id })
      .from(schema.batchDailyData)
      .where(and(
        inArray(schema.batchDailyData.batch_id, batches.map((b) => b.batch_id)),
        eq(schema.batchDailyData.posted, true),
      ));
    const postedKeys = new Set(posted.map((p) => `${p.line_id}|${p.entry_date}|${p.animal_id ?? ''}`));

    // The calendar days of the window, ending yesterday.
    const days: string[] = [];
    for (let i = 14; i >= 1; i--) days.push(dateNdaysAgo(i));
    // Day number within a scheduler: its own effective_from is day 1 (the
    // day-completeness convention). Each scheduler counts from the day its
    // stage began, so the same calendar day is a different day number under
    // different stages of the same batch.
    const dayIndexOf = (effectiveFrom: string, date: string): number =>
      Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${effectiveFrom}T00:00:00Z`)) / 86_400_000) + 1;

    let postedCount = 0;
    let skippedCount = 0;
    const weeklyAnchor = dateNdaysAgo(14);

    // ── 1. The work: every due, unposted line-day, in the order it will post.
    // Enumerated once, up front, so the top-up below sums exactly the draws
    // the posting loop is about to make — not an estimate of them.
    interface Work { batch: (typeof batches)[number]; line: DemoLine; date: string; day: number; animalId?: string; draw?: { value: number; warehouseId: string } }
    const work: Work[] = [];
    for (const batch of batches) {
      const lines = linesByBatch.get(batch.batch_id) ?? [];
      for (const date of days) {
        for (const line of lines) {
          // Day number under this line's own scheduler — a batch with several
          // schedulers counts each from its own effective_from.
          const effectiveFrom = String(line.effective_from).slice(0, 10);
          const day = dayIndexOf(effectiveFrom, date);
          if (day < 1) continue; // the stage had not begun on this calendar day
          if (!isDue(line, day, date, weeklyAnchor)) continue;

          // Batch Wise: one whole-batch entry. Animal Wise: one entry per animal in this stage.
          const targets: Array<string | undefined> = batch.tracking_mode === 'ANIMAL_WISE'
            ? (animalsByBatchStage.get(`${batch.batch_id}|${line.stage_id}`) ?? [])
            : [undefined];
          for (const animalId of targets) {
            if (postedKeys.has(`${line.line_id}|${date}|${animalId ?? ''}`)) {
              skippedCount += 1;
              continue;
            }
            // Skip one mandatory line on two distinct days on registered batches for missing backlog demonstration
            if (registeredBatches.has(batch.batch_id) && line.is_mandatory && SKIP_DAYS_ON_REGISTERED.includes(day)) {
              skippedCount += 1;
              continue;
            }
            work.push({ batch, line, date, day, animalId });
          }
        }
      }
    }

    // ── 2. Each feed draw's value and source warehouse, resolved by the
    // service that will post it.
    const sourceCache = new Map<string, string>();
    const demand = new Map<string, { warehouseId: string; itemId: string; farmId: string; kg: number }>();
    for (const w of work) {
      const { batch, line } = w;
      if (line.line_type !== 'CONSUMPTION' || !line.item_id || !batch.farm_id) continue;
      const standard = Number(line.standard_qty ?? 0);
      if (standard <= 0) continue;
      const heads = w.animalId ? 1 : headcountByScheduler.get(line.scheduler_id) ?? 0;
      const value = round2(standard * heads * feedFactor(w.day));
      if (value <= 0) continue;
      const cacheKey = `${line.location_id}|${line.item_id}|${batch.farm_id}`;
      let warehouseId = sourceCache.get(cacheKey);
      if (!warehouseId) {
        warehouseId = await entries.resolveConsumptionWarehouse(line.location_id, line.item_id, line.activity_name, batch.farm_id, ctx.companyId, ctx.tenantId);
        sourceCache.set(cacheKey, warehouseId);
      }
      w.draw = { value, warehouseId };
      const key = `${warehouseId}|${line.item_id}`;
      const entry = demand.get(key) ?? { warehouseId, itemId: line.item_id, farmId: batch.farm_id, kg: 0 };
      entry.kg = round2(entry.kg + value);
      demand.set(key, entry);
    }

    // ── 3. Top every source up to the window's demand x 1.5 (daily-entry-plan.ts).
    const warehouseIds = [...new Set([...demand.values()].map((d) => d.warehouseId))];
    const warehouseRows = warehouseIds.length
      ? await db
        .select({
          location_id: schema.locationMaster.location_id,
          location_code: schema.locationMaster.location_code,
          location_type: schema.locationMaster.location_type,
          silo_capacity_kg: schema.locationMaster.silo_capacity_kg,
        })
        .from(schema.locationMaster)
        .where(inArray(schema.locationMaster.location_id, warehouseIds))
      : [];
    const warehouseById = new Map(warehouseRows.map((w) => [w.location_id, w]));
    const capacityOf = (warehouseId: string): number | null => {
      const row = warehouseById.get(warehouseId);
      return row?.location_type === 'SILO' && row.silo_capacity_kg != null ? Number(row.silo_capacity_kg) : null;
    };
    const farmById = new Map(ctx.demoFarms.map((f) => [f.farmId, f]));
    const itemCost = new Map<string, number | undefined>();
    async function rateOfItem(itemId: string): Promise<number | undefined> {
      if (!itemCost.has(itemId)) {
        const [item] = await db
          .select({ standard_cost: schema.itemMaster.standard_cost })
          .from(schema.itemMaster)
          .where(eq(schema.itemMaster.item_id, itemId))
          .limit(1);
        itemCost.set(itemId, rateOf(item?.standard_cost));
      }
      return itemCost.get(itemId);
    }

    /**
     * Receive `quantityKg` of the item into the warehouse under `ref`, resume-
     * safe like chapter 02: an existing receipt is posted if an earlier run
     * left it DRAFT and otherwise left alone; `quantityKg` is only read when
     * the receipt has to be created.
     */
    async function ensureTopUp(ref: string, d: { warehouseId: string; itemId: string; farmId: string }, quantityKg: () => Promise<number>, postingDate: string, why: string): Promise<void> {
      const farm = farmById.get(d.farmId);
      const tag = farm ? tagOf(farm) : `  ${d.farmId}:`;
      const code = warehouseById.get(d.warehouseId)?.location_code ?? d.warehouseId;
      const [existing] = await db
        .select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
        .from(schema.goodsReceipt)
        .where(eq(schema.goodsReceipt.external_reference_no, ref))
        .limit(1);
      if (existing) {
        if (existing.status === 'DRAFT') {
          await receipts.post(existing.receipt_id, ctx.tenantId);
          ctx.log(`${tag} feed top-up ${ref} was DRAFT — posted now`);
        }
        return;
      }
      const quantity = await quantityKg();
      if (quantity <= 0) return;
      const created = await receipts.create({
        company_id: ctx.companyId,
        warehouse_id: d.warehouseId,
        posting_date: postingDate,
        external_reference_no: ref,
        remarks: `DEMO feed top-up into ${code} for the 14-day daily-entry history — ${why}`,
        lines: [{
          item_id: d.itemId,
          quantity,
          uom: 'KG',
          rate: await rateOfItem(d.itemId),
          // The lot the warehouse already holds, so its stock stays in one
          // lot a single draw can take all of (see pickLot).
          lot_no: (await pickLot(d.warehouseId, d.itemId)) ?? `DEMO-${farm?.code ?? 'FARM'}-FEED-TOPUP`,
        }],
      }, ctx.tenantId);
      await receipts.post(created.receipt_id, ctx.tenantId);
      ctx.log(`${tag} feed top-up into ${code}: +${quantity} kg (${why})`);
    }

    const refBase = (d: { warehouseId: string; farmId: string }) =>
      `DEMO-${farmById.get(d.farmId)?.code ?? d.farmId}-FEEDTOP-${warehouseById.get(d.warehouseId)?.location_code ?? d.warehouseId}`;

    const balance = new Map<string, number>();
    const remaining = new Map<string, number>();
    for (const [key, d] of demand) {
      await ensureTopUp(refBase(d), d, async () => {
        const onHand = await onHandKg(d.warehouseId, d.itemId);
        return topUpKg({ demandKg: d.kg, onHandKg: onHand, capacityKg: capacityOf(d.warehouseId) });
      }, firstDay, `window demand ${d.kg} kg x 1.5`);
      balance.set(key, await onHandKg(d.warehouseId, d.itemId));
      remaining.set(key, d.kg);
    }

    // ── 4. Post.
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };
    for (const { batch, line, date, day, draw, animalId } of work) {
      if (line.line_type === 'CONSUMPTION' && line.item_id) {
        if (!draw) {
          skippedCount += 1;
          continue;
        }
        const key = `${draw.warehouseId}|${line.item_id}`;
        const d = demand.get(key)!;
        const held = balance.get(key) ?? 0;
        if (held < draw.value) {
          // Capacity capped the up-front top-up and the silo has run down to
          // less than this draw: refill it now, dated the day of the draw,
          // rather than fail the rebuild. The suffix counts earlier mid-window
          // receipts into this silo, so each gets its own reference.
          const base = `${refBase(d)}-MID`;
          const [{ n }] = await db
            .select({ n: sql<number>`COUNT(*)` })
            .from(schema.goodsReceipt)
            .where(sql`${schema.goodsReceipt.external_reference_no} LIKE ${`${base}-%`}`);
          await ensureTopUp(`${base}-${Number(n) + 1}`, d, async () =>
            midwayTopUpKg({ drawKg: draw.value, balanceKg: held, remainingDemandKg: remaining.get(key) ?? draw.value, capacityKg: capacityOf(draw.warehouseId) }),
          date, `mid-window, ${held} kg left before a ${draw.value} kg draw`);
          balance.set(key, await onHandKg(draw.warehouseId, line.item_id));
        }
        const lot = await pickLot(draw.warehouseId, line.item_id);
        if (!lot) {
          skippedCount += 1;
          continue;
        }
        await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: draw.value, lot_no: lot, ...(animalId ? { animal_id: animalId } : {}) }, ctx.tenantId, actor);
        balance.set(key, round2((balance.get(key) ?? 0) - draw.value));
        remaining.set(key, round2((remaining.get(key) ?? 0) - draw.value));
        postedCount += 1;
      } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'MORTALITY_COUNT') {
        const value = isGrasmereHeadcountBatch(batch.remarks) ? mortalityDays(day) : 0;
        await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: value, ...(animalId ? { animal_id: animalId } : {}) }, ctx.tenantId, actor);
        postedCount += 1;
      } else if (line.line_type === 'DESCRIPTIVE' && line.kpi_metric === 'BODY_WEIGHT') {
        const isReg = registeredBatches.has(batch.batch_id);
        const value = isReg ? 160 + day : 62 + day;
        await entries.postEntry(batch.batch_id, { line_id: line.line_id, entry_date: date, entered_value: value, ...(animalId ? { animal_id: animalId } : {}) }, ctx.tenantId, actor);
        postedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    ctx.log(`04-daily-entries: posted ${postedCount} entr(ies), skipped ${skippedCount} line-day(s) (window ${firstDay} … ${yesterdayHarare})`);
  },
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

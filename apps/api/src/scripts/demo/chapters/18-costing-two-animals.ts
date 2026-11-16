/**
 * Chapter `18-costing-two-animals` — the SMALLEST costing seed (`pnpm seed:costing-two`, or `pnpm nx run api:db-costing-two` on an existing database). Two animals
 * and nothing else, so that every number on the Bio Asset Ledger, the costing runs and the journals can be checked by hand. Posted through the application's own
 * services, dated in order, nothing in the future; `verify-costing-two.ts` reads it back from MySQL against its own arithmetic.
 *
 *   TWO-SOW   imported sow, born 6 Oct 2025, bought 850 on 6 Apr 2026   costing starts 25 May (birth + 33 weeks): feed and overhead before it are CAPITALISED, after it EXPENSED
 *   TWO-BOAR  imported boar, born 2 Jun 2025, bought 1200 on 6 Apr 2026  costing starts on arrival (older than 26 weeks): everything is expensed from day one
 *
 * One animal-wise batch holds both. Every Monday their feed is issued as ONE group issue (on 25 May that one issue holds the sow on the day her costing
 * starts and the boar already running: it is split in two entries). A monthly overhead of 12 per animal is booked on the 15th. After each month, one
 * amortisation run per item is calculated and posted (April to September). No mating, litter, death, medicine or reversal: only the costing.
 *
 * Resume-safe: the receipts by reference, animals by RFID, the batch by remarks, entries by (batch, animal, date, kind, remarks), runs by (item, period, batch).
 * Prices and rations are demo facts, not real data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { BioCostingStartService } from '../../../modules/finance/bio-costing/bio-costing-start.service';
import { BioCostingRunService } from '../../../modules/finance/bio-costing/bio-costing-run.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { pensForRole } from '../farms';
import { createAnimalWiseBatchEnsurer, createItemLookup, shedForStage } from '../batch-helpers';

export const TWO_BATCH = 'TWO-BATCH';
const GRN_ANIMALS = 'DEMO-TWO-GRN';
const GRN_FEED = 'DEMO-TWO-FEED';

const ENTRY_DATE = '2026-04-06'; // Monday
const LAST_FEED_DATE = '2026-09-28';
const FIRST_MONTH = '2026-04';
const LAST_MONTH = '2026-09';

const SOW_ITEM = 'Mature Parity Breeding Sow';
const BOAR_ITEM = 'Mature Herd Sire Boar';
const FEED_ITEM = 'Dry Sow Gestation Mash (14% CP)';

export const TWO_SOW_KG_PER_DAY = 2.5;
export const TWO_BOAR_KG_PER_DAY = 2.8;
export const TWO_OVERHEAD_PER_MONTH = 12;
export const TWO_ANIMALS = [
  { tag: 'TWO-SOW', kind: 'SOW', gender: 'F', dob: '2025-10-06', price: 850, teats: 14, sire: 'DK-LR-91207', dam: 'DK-LR-80455', tsi: 120, grading: 87, note: 'Imported Danish Landrace sow' },
  { tag: 'TWO-BOAR', kind: 'BOAR', gender: 'M', dob: '2025-06-02', price: 1200, teats: undefined, sire: 'DK-DU-60118', dam: 'DK-DU-59340', tsi: 127, grading: 91, note: 'Imported Danish Duroc boar' },
] as const;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const isMonday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const costingTwoAnimalsChapter: DemoChapter = {
  name: '18-costing-two-animals',

  async run(ctx: DemoContext) {
    const animals = ctx.app.get(AnimalService);
    const batches = ctx.app.get(BatchService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const starts = ctx.app.get(BioCostingStartService);
    const runs = ctx.app.get(BioCostingRunService);
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('18-costing-two-animals: tenantDb is not set — run through the harness.');
    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email };

    const farm = ctx.demoFarms.find((f) => f.code === 'MUL100');
    const breed = farm?.sowBreed;
    if (!farm || !breed) throw new Error('18-costing-two-animals: MUL100 and its sow breed are needed — run with DEMO_FARMS=MUL100,POR100.');
    if (!farm.storeId) throw new Error('18-costing-two-animals: MUL100 has no store to receive the feed into.');
    const store = { id: farm.storeId };
    const item = createItemLookup(db, ctx.companyId);
    const last = today();

    // ── 1. One receipt for the two animals (the purchase price is each animal's cost) and one for the feed.
    const sowItem = await item(SOW_ITEM);
    const boarItem = await item(BOAR_ITEM);
    const receive = async (ref: string, warehouseId: string, remarks: string, lines: Array<{ item_id: string; quantity: number; uom: string; rate?: number; lot_no?: string }>) => {
      let [receipt] = await db.select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status }).from(schema.goodsReceipt).where(eq(schema.goodsReceipt.external_reference_no, ref)).limit(1);
      if (!receipt) {
        const created = await receipts.create({ company_id: ctx.companyId, warehouse_id: warehouseId, posting_date: ENTRY_DATE, external_reference_no: ref, remarks, lines } as any, ctx.tenantId);
        receipt = { receipt_id: created.receipt_id, status: 'DRAFT' };
      }
      if (receipt.status === 'DRAFT') { await receipts.post(receipt.receipt_id, ctx.tenantId); ctx.log(`  goods receipt ${ref} posted (${ENTRY_DATE})`); }
      return receipt.receipt_id;
    };
    const animalsReceipt = await receive(GRN_ANIMALS, farm.farmId, 'DEMO costing (two animals): 1 imported sow and 1 imported boar', [
      { item_id: sowItem.item_id, quantity: 1, uom: 'HEAD', rate: 850, lot_no: 'DEMO-TWO-SOW-LOT' },
      { item_id: boarItem.item_id, quantity: 1, uom: 'HEAD', rate: 1200, lot_no: 'DEMO-TWO-BOAR-LOT' },
    ]);
    const feed = await item(FEED_ITEM);
    await receive(GRN_FEED, store.id, `DEMO costing (two animals): ${FEED_ITEM}`, [{ item_id: feed.item_id, quantity: 1500, uom: 'KG', rate: Number(feed.standard_cost ?? 0) || undefined }]);

    // ── 2. The two animals.
    const sowStage = breed.lifecycleStages.get('INSEMINATION');
    const boarStage = breed.lifecycleStages.get('QUARANTINE');
    if (!sowStage || !boarStage) throw new Error('18-costing-two-animals: the sow breed needs INSEMINATION and QUARANTINE lifecycle rows.');
    const sowPens = shedForStage(farm, 'INSEMINATION')?.penIds ?? pensForRole(farm, 'DRY_SOW', 'GILT');
    const boarPens = shedForStage(farm, 'QUARANTINE')?.penIds ?? pensForRole(farm, 'BOAR');
    const ids = new Map<string, string>();
    for (const a of TWO_ANIMALS) {
      let [row] = await db.select({ animal_id: schema.animalRegister.animal_id }).from(schema.animalRegister).where(eq(schema.animalRegister.rfid_tag, a.tag)).limit(1);
      if (!row) {
        const sow = a.kind === 'SOW';
        const created: any = await animals.create({
          company_id: ctx.companyId, animal_type: a.kind, breed_id: breed.breedId, gender: a.gender, entry_type: 'PURCHASED_IMPORTED', entry_date: ENTRY_DATE, dob: a.dob,
          source_receipt_id: animalsReceipt, item_id: sow ? sowItem.item_id : boarItem.item_id, rfid_tag: a.tag, sire_serial_no: a.sire, dam_serial_no: a.dam,
          current_location_id: (sow ? sowPens : boarPens)[0], current_stage_id: sow ? sowStage : boarStage, no_of_teats: a.teats, tsi: a.tsi, grading: a.grading, notes: a.note,
          expected_cull_date: addDays(ENTRY_DATE, 365 * 3),
        } as any, ctx.tenantId);
        row = { animal_id: created.animal_id };
        ctx.log(`  registered ${created.animal_code} (${a.tag}): ${a.kind}, born ${a.dob}, bought at ${a.price}`);
      }
      ids.set(a.tag, row.animal_id);
    }
    const sowId = ids.get('TWO-SOW')!;
    const boarId = ids.get('TWO-BOAR')!;

    // ── 3. The batch that holds them, starting the day they arrived; the costing start dates are given from their items.
    const ensureBatch = createAnimalWiseBatchEnsurer(db, batches, ctx);
    const batchId = await ensureBatch({ ref: TWO_BATCH, farm, breedId: breed.breedId, shed: shedForStage(farm, 'INSEMINATION'), startDate: ENTRY_DATE, animalIds: [sowId, boarId] });
    await db.update(schema.schedulerHeader).set({ effective_from: ENTRY_DATE }).where(eq(schema.schedulerHeader.batch_id, batchId));
    await starts.assignAnimals({ animal_ids: [sowId, boarId] } as any, ctx.tenantId, ctx.companyId);

    // ── 4. The months in order: that month's feed and overhead, then that month's runs (one per item).
    const doneKeys = new Set(
      (await db.select({ d: schema.batchTransaction.transaction_date, t: schema.batchTransaction.transaction_type, r: schema.batchTransaction.remarks, a: schema.batchTransaction.animal_id })
        .from(schema.batchTransaction).where(eq(schema.batchTransaction.batch_id, batchId)))
        .map((t) => `${String(t.d).slice(0, 10)}|${t.t}|${t.r ?? ''}|${t.a ?? ''}`),
    );
    const feedRemarks = 'TWO weekly feed';
    const overheadRemarks = 'TWO housing and labour allocation';
    const runMonth = async (month: string) => {
      let result: { runs: any[]; failed: Array<{ item_code: string; error: string }> };
      try {
        result = await runs.calculateBatch({ batch_id: batchId, period_key: month } as any, ctx.tenantId, ctx.companyId, ctx.actor.userId) as any;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`  run ${month}: ${/already been run|already posted after/.test(message) ? 'already posted - skipped' : `NOT MADE - ${message}`}`);
        return;
      }
      for (const f of result.failed) ctx.log(`  run ${month} ${f.item_code}: ${/already been run|already posted after/.test(f.error) ? 'already posted - skipped' : `NOT MADE - ${f.error}`}`);
      for (const run of result.runs) {
        if (run.status === 'POSTED') continue;
        const posted: any = await runs.post(run.run_id, ctx.tenantId, ctx.actor.userId);
        ctx.log(`  run ${month} ${posted.run_no}: ${posted.charged_count} charged, ${posted.skipped_count} skipped, total ${posted.total_charge}`);
      }
    };
    for (let month = FIRST_MONTH; month <= LAST_MONTH; month = nextMonth(month)) {
      const end = monthEnd(month);
      for (let date = `${month}-01`; date <= end && date <= last; date = addDays(date, 1)) {
        if (isMonday(date) && date >= ENTRY_DATE && date <= LAST_FEED_DATE && !doneKeys.has(`${date}|CONSUMPTION|${feedRemarks}|${sowId}`)) {
          await batches.postConsumptionGroup(batchId, {
            item_id: feed.item_id, uom: 'KG', transaction_date: date, source_warehouse_id: store.id, remarks: feedRemarks,
            shares: [{ animal_id: sowId, quantity: round2(TWO_SOW_KG_PER_DAY * 7) }, { animal_id: boarId, quantity: round2(TWO_BOAR_KG_PER_DAY * 7) }],
          }, ctx.tenantId, actor as any);
        }
        if (date === `${month}-15`) {
          for (const animalId of [sowId, boarId]) {
            if (doneKeys.has(`${date}|OVERHEAD|${overheadRemarks}|${animalId}`)) continue;
            await batches.addTransaction(batchId, { transaction_type: 'OVERHEAD', transaction_date: date, quantity: 1, uom: 'MONTH', rate: TWO_OVERHEAD_PER_MONTH, animal_id: animalId, remarks: overheadRemarks } as any, ctx.tenantId, actor);
          }
        }
      }
      if (end > last) break;
      await runMonth(month);
    }

    const rows = await db.select({ code: schema.animalRegister.animal_code, tag: schema.animalRegister.rfid_tag, start: schema.animalRegister.costing_start_date, bv: schema.animalRegister.book_value })
      .from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, [sowId, boarId]));
    ctx.log(`  costing: ${rows.map((r) => `${r.code} (${r.tag}) start=${r.start ?? 'NONE'} book value=${r.bv}`).join(' | ')}`);
    void and;
  },
};

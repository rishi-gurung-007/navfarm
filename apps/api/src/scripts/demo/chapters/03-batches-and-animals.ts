/**
 * Chapter `03-batches-and-animals` — Phase 3 Task 5, now over all nine farms.
 * Everything through the services (Ruling 1):
 *
 *   - one **Registered Animals** batch per farm that may hold breeding stock
 *     (BIO_ASSET costing, the farm's own breed profile,
 *     `auto_generate_scheduler`), whose sows, gilts and boars are then created
 *     one by one through `AnimalService.create` with explicit demo facts —
 *     never derived from opening quantity (Ruling 3). This half lives in
 *     register-breeding-stock.ts, shared with the standalone `db-seed-animals`
 *     script so both call the exact same, already-tested logic;
 *   - one to three **Count Only** batches per farm, one per stage the farm's
 *     role allows *and* the farm's breed actually carries a lifecycle row for.
 *
 * What a farm may do comes from its role (docs/decisions.md, last section):
 *   MUL100  multiplier — gilt production, no grow-out;
 *   AI100   boars only — no farrowing and no grow-out, so one registered boar
 *           batch at Boar AI and one quarantine intake, nothing else;
 *   LEX100  weaners and growers only — count-only batches, no registered
 *           breeding stock at all;
 *   the other six farrow-to-finish.
 * A stage the farm's breed has no `breed_lifecycle_stages` row for is skipped
 * rather than invented: without one the auto-generated scheduler is born empty
 * and chapter 04 would have nothing to post.
 *
 * Batch create leaves the batch DRAFT; `BatchService.activate` takes it
 * through BIO_ACQUISITION GL + bio-asset ledger posting.
 *
 * Resume semantics like 02-inventory: batches are located by their DEMO
 * remarks token; DRAFT batches are activated, absent batches are created.
 */
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { SchedulerHeaderService } from '../../../modules/production/scheduler-header/scheduler-header.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { batchBreedOf, batchRef, tagOf } from '../farms';
import { createItemLookup, createBatchEnsurer, rateOf } from '../batch-helpers';
import { registerBreedingStock } from '../register-breeding-stock';

/**
 * Livestock items resolve by the shared catalog's item NAME (the one property
 * code generation cannot move), not by literal item_code: the ITEM series
 * composes codes from the category tree, and these literal codes went stale
 * the moment the catalog step composed its own. Mapped to names at lookup.
 */
const ITEM_BOAR = 'Mature Herd Sire Boar';
const ITEM_GILT = 'Replacement Breeding Gilt';
const ITEM_SUCKLING = 'Suckling Live Piglet (0-4 Wks)';
const ITEM_WEANED = 'Weaned Feeder Piglet (7-10kg)';

type FarmRole = 'MULTIPLIER' | 'AI_STATION' | 'GROW_OUT' | 'FARROW_TO_FINISH';

/** Count-only stages a farm of each role may run, in priority order. */
const COUNT_ONLY_STAGE_PREFERENCE: Record<FarmRole, string[]> = {
  MULTIPLIER: ['GESTATION', 'WEANER', 'LACTATION'],
  FARROW_TO_FINISH: ['GESTATION', 'WEANER', 'GROWER', 'FINISHER'],
  AI_STATION: ['QUARANTINE'],
  GROW_OUT: ['WEANER', 'GROWER'],
};

/** What a count-only batch of a stage opens with, before the farm's herd scale. */
const COUNT_ONLY_STAGE_FACTS: Record<string, { baseQuantity: number; itemCode: string }> = {
  GESTATION: { baseQuantity: 120, itemCode: ITEM_GILT },
  WEANER: { baseQuantity: 240, itemCode: ITEM_WEANED },
  GROWER: { baseQuantity: 200, itemCode: ITEM_WEANED },
  FINISHER: { baseQuantity: 180, itemCode: ITEM_WEANED },
  LACTATION: { baseQuantity: 60, itemCode: ITEM_SUCKLING },
  QUARANTINE: { baseQuantity: 8, itemCode: ITEM_BOAR },
};

export interface BatchRefs {
  /** Farm code -> the remarks tokens of every demo batch on that farm. */
  byFarm: Map<string, { registered?: string; countOnly: string[] }>;
}

export const batchesAndAnimalsChapter: DemoChapter<BatchRefs> = {
  name: '03-batches-and-animals',

  async run(ctx: DemoContext): Promise<BatchRefs> {
    const batches = ctx.app.get(BatchService);
    const animals = ctx.app.get(AnimalService);
    const schedulers = ctx.app.get(SchedulerHeaderService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('03-batches-and-animals: tenantDb is not set — run through the harness.');

    const item = createItemLookup(db, ctx.companyId);
    const ensureBatch = createBatchEnsurer(db, batches, ctx);

    const byFarm = new Map<string, { registered?: string; countOnly: string[] }>();

    for (const farm of ctx.demoFarms) {
      const tag = tagOf(farm);
      const breed = batchBreedOf(farm);
      const refs: { registered?: string; countOnly: string[] } = { countOnly: [] };
      byFarm.set(farm.code, refs);

      if (!breed) {
        ctx.log(`${tag} no active breed profile on this farm — no batches (nothing to grow a scheduler from)`);
        continue;
      }

      // ── Registered breeding stock (shared with db-seed-animals).
      refs.registered = (await registerBreedingStock(ctx, farm, { db, animals, schedulers, receipts, item, ensureBatch })) ?? undefined;

      // ── Count-only batches, one per allowed stage the breed carries.
      const startDate = new Date(Date.now() - farm.volume.days * 86_400_000).toISOString().slice(0, 10);
      const stageCodes = COUNT_ONLY_STAGE_PREFERENCE[farm.role]
        .filter((code) => breed.lifecycleStages.has(code))
        .slice(0, farm.volume.countOnlyBatches);
      const unavailable = COUNT_ONLY_STAGE_PREFERENCE[farm.role].filter((code) => !breed.lifecycleStages.has(code));
      if (unavailable.length) {
        ctx.log(`${tag} no lifecycle row on ${breed.code} for ${unavailable.join(', ')} — those count-only batches skipped`);
      }

      for (const stageCode of stageCodes) {
        const facts = COUNT_ONLY_STAGE_FACTS[stageCode];
        if (!facts) {
          ctx.log(`${tag} no demo opening quantity defined for stage ${stageCode} — skipped`);
          continue;
        }
        const input = await item(facts.itemCode);
        const quantity = Math.max(1, Math.round(facts.baseQuantity * farm.volume.herdScale));
        const ref = batchRef(farm.code, `CO-${stageCode}`);
        refs.countOnly.push(ref);
        await ensureBatch({
          ref,
          farm,
          animalTracking: 'COUNT_ONLY',
          stageId: breed.lifecycleStages.get(stageCode)!,
          stageCode,
          // A count-only batch still carries its farm's breed: the
          // auto-generated scheduler only grows lines from
          // breed_lifecycle_stages, which are keyed by breed — without it the
          // scheduler is born empty.
          breedId: breed.breedId,
          startDate,
          openingQuantity: quantity,
          inputLines: [{ item_id: input.item_id, quantity, uom: 'HEAD', rate: rateOf(input.standard_cost) }],
        });
      }
    }

    return { byFarm };
  },
};

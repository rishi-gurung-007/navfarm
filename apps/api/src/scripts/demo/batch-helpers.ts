/**
 * Small helpers shared by every demo step that reads the livestock item
 * catalog or creates a batch through BatchService — factored out of chapter
 * `03-batches-and-animals` so `db-seed-animals` (registered breeding stock
 * only, no count-only batches) can reuse the exact same, already-tested
 * logic rather than a second copy that could drift from it.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { BatchService } from '../../modules/production/batch/batch.service';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';
import type { DemoFarm } from './farms';
import { tagOf } from './farms';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
export function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}

export type ItemLookup = (name: string) => Promise<{ item_id: string; standard_cost: string | null }>;

/** Livestock item rows, read once per name and cached, by item NAME — see the
 * constants in register-breeding-stock.ts for why name, not item_code. */
export function createItemLookup(db: MySql2Database<typeof schema>, companyId: string): ItemLookup {
  const cache = new Map<string, { item_id: string; standard_cost: string | null }>();
  return async function item(name: string) {
    const cached = cache.get(name);
    if (cached) return cached;
    const [row] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(
        eq(schema.itemMaster.item_name, name),
        eq(schema.itemMaster.company_id, companyId),
        eq(schema.itemMaster.is_active, true),
        isNull(schema.itemMaster.deleted_at),
      ))
      .limit(1);
    if (!row) throw new Error(`demo: item '${name}' not found for the demo company — run db-seed-demo-item-catalog first.`);
    cache.set(name, row);
    return row;
  };
}

export interface EnsureBatchOpts {
  ref: string;
  farm: DemoFarm;
  animalTracking: 'REGISTERED' | 'COUNT_ONLY';
  stageId: string;
  stageCode: string;
  breedId: string;
  startDate: string;
  openingQuantity: number;
  inputLines: { item_id: string; quantity: number; uom: string; rate?: number }[];
}

export type BatchEnsurer = (opts: EnsureBatchOpts) => Promise<string>;

const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

/** Create-activate a batch per its DEMO remarks token, resume-safe. */
export function createBatchEnsurer(db: MySql2Database<typeof schema>, batches: BatchService, ctx: DemoContext): BatchEnsurer {
  return async function ensureBatch(opts: EnsureBatchOpts): Promise<string> {
    const tag = tagOf(opts.farm);
    const [existing] = await db
      .select({ batch_id: schema.batchHeader.batch_id, status: schema.batchHeader.status })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, opts.ref))
      .limit(1);
    if (existing) {
      if (existing.status === 'DRAFT') {
        await batches.activate(existing.batch_id, ctx.tenantId);
        ctx.log(`${tag} batch ${opts.ref} was DRAFT — activated now`);
      } else {
        ctx.log(`${tag} batch ${opts.ref} already ${existing.status} — skipped`);
      }
      return existing.batch_id;
    }

    const created = await batches.create(
      {
        company_id: ctx.companyId,
        lob_id: PIGGERY_LOB_ID,
        // BATCH_WISE always — this seed always supplies input_lines/opening_quantity
        // (never animal_ids), and BIO_ASSET + breed_id already registers one
        // animal_register placeholder row per head via registerPlaceholderAnimals().
        tracking_mode: 'BATCH_WISE',
        costing_method: 'BIO_ASSET',
        breed_id: opts.breedId,
        stage_id: opts.stageId,
        auto_generate_scheduler: true,
        start_date: opts.startDate,
        opening_quantity: opts.openingQuantity,
        uom: 'HEAD',
        remarks: opts.ref,
        input_lines: opts.inputLines,
      },
      ctx.tenantId,
    );
    // BatchService.create() never sets animal_tracking or farm_id — both stay
    // at their column defaults (COUNT_ONLY / NULL). AnimalService.create()
    // reads both to decide whether, and where, an individual animal may be
    // placed in this batch, so a REGISTERED batch (sows/gilts/boars created
    // one by one) needs them set explicitly. Count-only batches keep
    // animal_tracking's default and still need farm_id.
    await db
      .update(schema.batchHeader)
      .set({
        farm_id: opts.farm.farmId,
        ...(opts.animalTracking === 'REGISTERED' ? { animal_tracking: 'REGISTERED' as const } : {}),
      })
      .where(eq(schema.batchHeader.batch_id, created.batch_id));
    await batches.activate(created.batch_id, ctx.tenantId);
    ctx.log(`${tag} created + activated ${opts.animalTracking} batch ${created.batch_no} at ${opts.stageCode} (${opts.openingQuantity} head)`);
    return created.batch_id;
  };
}


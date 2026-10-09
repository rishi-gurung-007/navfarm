/**
 * Chapter `08-bio-asset-exit` — the end of a Batch Wise batch's life.
 *
 * A Batch Wise batch is bulk animals held as one headcount with a BIO_ASSET
 * cost: chapter 03 bought them in, chapter 04 grew their cost with daily feed.
 * This chapter slaughters part of each farm's herd through
 * `BatchService.disposeBioAsset` (HARVEST): the animals leave the headcount at
 * their share of the batch's carrying value, which becomes the cost of the
 * dressed pork received into the farm's store. A quarter of the herd goes, so the
 * batch stays ACTIVE and the screens show a batch part-way through its exit;
 * it closes by itself once the whole herd has been disposed.
 *
 * An Animal Wise batch has no batch-level exit — its animals leave one by one
 * through `AnimalService.dispose` — so only Batch Wise batches are touched here.
 *
 * Resume semantics: a batch that already has a disposal entry in the bio-asset
 * ledger is left alone.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=08-bio-asset-exit
 */
import { and, eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchService } from '../../../modules/production/batch/batch.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { createItemLookup } from '../batch-helpers';
import { tagOf } from '../farms';

const OUTPUT_ITEM = 'Dressed Pork Carcass (Wholesale Cut)';
/** Share of the herd slaughtered, and the carcass weight each head yields. */
const HARVEST_SHARE = 0.25;
const CARCASS_KG_PER_HEAD = 75;

export const bioAssetExitChapter: DemoChapter = {
  name: '08-bio-asset-exit',

  async run(ctx: DemoContext): Promise<void> {
    const batches = ctx.app.get(BatchService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('08-bio-asset-exit: tenantDb is not set — run through the harness.');
    const item = createItemLookup(db, ctx.companyId);
    const output = await item(OUTPUT_ITEM);
    const today = new Date().toISOString().slice(0, 10);

    const headcountBatches = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, farm_id: schema.batchHeader.farm_id })
      .from(schema.batchHeader)
      .where(and(
        sql`${schema.batchHeader.remarks} LIKE 'DEMO-%-CO-%' OR ${schema.batchHeader.remarks} LIKE 'DEMO-BATCH-CO-%'`,
        eq(schema.batchHeader.tracking_mode, 'BATCH_WISE'),
        eq(schema.batchHeader.status, 'ACTIVE'),
      ));

    for (const batch of headcountBatches) {
      const farm = ctx.demoFarms.find((f) => f.farmId === batch.farm_id);
      const tag = farm ? tagOf(farm) : `  ${batch.farm_id}:`;
      if (!farm?.storeId) {
        ctx.log(`${tag} ${batch.batch_no}: the farm has no store to receive the carcasses — skipped`);
        continue;
      }
      const [already] = await db
        .select({ entry_id: schema.bioAssetLedger.entry_id })
        .from(schema.bioAssetLedger)
        .where(and(eq(schema.bioAssetLedger.batch_id, batch.batch_id), eq(schema.bioAssetLedger.entry_type, 'TRANSFORMATION')))
        .limit(1);
      if (already) {
        ctx.log(`${tag} ${batch.batch_no}: already has a disposal — skipped`);
        continue;
      }
      const [state] = await db
        .select({ current_quantity: schema.batchBioAssetState.current_quantity })
        .from(schema.batchBioAssetState)
        .where(eq(schema.batchBioAssetState.batch_id, batch.batch_id))
        .limit(1);
      const head = Math.max(1, Math.floor(Number(state?.current_quantity ?? 0) * HARVEST_SHARE));
      if (!state || Number(state.current_quantity) < head) {
        ctx.log(`${tag} ${batch.batch_no}: not enough head left to harvest — skipped`);
        continue;
      }

      await batches.disposeBioAsset(
        batch.batch_id,
        {
          disposal_type: 'HARVEST',
          quantity: head,
          posting_date: today,
          output_item_id: output.item_id,
          output_uom: 'KG',
          output_quantity: head * CARCASS_KG_PER_HEAD,
          warehouse_id: farm.storeId,
        },
        ctx.tenantId,
        ctx.actor,
      );
      ctx.log(`${tag} ${batch.batch_no}: slaughtered ${head} head → ${head * CARCASS_KG_PER_HEAD} kg dressed pork into the farm store`);
    }
  },
};

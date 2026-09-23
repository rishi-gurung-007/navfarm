/**
 * Seeds animals only — no count-only headcount batches, no daily entries, no
 * breeding records, no approvals. Registers each farm's breeding stock (sows,
 * gilts, boars) as real animal_register rows, each properly linked: farm,
 * pen, breed, item, stage, and the one "Registered Animals" batch it belongs
 * to (BIO_ASSET costing, auto-generated scheduler) — that batch is how an
 * animal gets a stage and a scheduler in this app's data model at all, so it
 * is created too, but nothing beyond it (see docs/decisions.md, 2026-09-23:
 * "wrap the existing chapter" rather than a batch-less, untested path).
 *
 * Everything through the services (Ruling 1, same as the demo chapters this
 * reuses register-breeding-stock.ts from): goods receipt -> post -> batch ->
 * activate -> AnimalService.create() one animal at a time, never a raw
 * insert. Resume-safe — a farm's existing demo herd is adopted, not
 * duplicated (batches by DEMO remarks token, animals by ear_tag).
 *
 * Requires the masters to already be seeded (db-seed-masters-only or the
 * full db-rebuild-demo master stages) — farms, sheds, pens, breeds and the
 * livestock item catalog (db-seed-demo-item-catalog) all have to exist first.
 *
 *   pnpm nx run api:db-seed-animals                          # print the plan
 *   pnpm nx run api:db-seed-animals -- --apply
 *   pnpm nx run api:db-seed-animals -- --apply --volume=full
 *   pnpm nx run api:db-seed-animals -- --apply --farm=POR100
 */
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import { registerBreedingStock } from './demo/register-breeding-stock';
import { createItemLookup, createBatchEnsurer } from './demo/batch-helpers';
import { BatchService } from '../modules/production/batch/batch.service';
import { AnimalService } from '../modules/piggery/animal/animal.service';
import { SchedulerHeaderService } from '../modules/production/scheduler-header/scheduler-header.service';
import { GoodsReceiptService } from '../modules/inventory/goods-receipt/goods-receipt.service';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { VOLUME_PROFILES, type VolumeProfileName } from './demo/farms';

function parseArgs(argv: string[]): { apply: boolean; volume: VolumeProfileName; farm?: string } {
  let apply = false;
  let volume: VolumeProfileName = 'standard';
  let farm: string | undefined;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--volume=')) {
      const value = arg.slice('--volume='.length) as VolumeProfileName;
      if (!VOLUME_PROFILES.includes(value)) {
        throw new Error(`Unknown volume '${value}'. Use one of: ${VOLUME_PROFILES.join(', ')}.`);
      }
      volume = value;
    } else if (arg.startsWith('--farm=')) farm = arg.slice('--farm='.length);
    else throw new Error(`Unknown flag: ${arg}. Use --apply, --volume=<${VOLUME_PROFILES.join('|')}>, --farm=<code>.`);
  }
  return { apply, volume, farm };
}

async function main() {
  const { apply, volume, farm: onlyFarm } = parseArgs(process.argv.slice(2));

  const app = await bootApp();
  const log = (line: string) => console.log(line);
  try {
    const ctx = await buildDemoContext(app, log, volume);
    const farms = onlyFarm ? ctx.demoFarms.filter((f) => f.code === onlyFarm) : ctx.demoFarms;
    if (onlyFarm && farms.length === 0) {
      throw new Error(`No demo farm with code '${onlyFarm}'. Available: ${ctx.demoFarms.map((f) => f.code).join(', ')}.`);
    }

    log(`\nFarms to ${apply ? 'seed' : 'print'}: ${farms.map((f) => f.code).join(', ')}`);
    if (!apply) {
      log('\nRead-only plan — pass --apply to run.');
      return;
    }

    await inTenant(ctx, async () => {
      const batches = app.get(BatchService);
      const animals = app.get(AnimalService);
      const schedulers = app.get(SchedulerHeaderService);
      const receipts = app.get(GoodsReceiptService);
      const cls = app.get(ClsService);
      const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
      if (!db) throw new Error('db-seed-animals: tenantDb is not set — run through the harness.');

      const item = createItemLookup(db, ctx.companyId);
      const ensureBatch = createBatchEnsurer(db, batches, ctx);

      let registered = 0;
      for (const demoFarm of farms) {
        const ref = await registerBreedingStock(ctx, demoFarm, { db, animals, schedulers, receipts, item, ensureBatch });
        if (ref) registered += 1;
      }
      log(`\nDone — ${registered} of ${farms.length} farm(s) carry a registered-animals batch.`);
    });
  } finally {
    await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);

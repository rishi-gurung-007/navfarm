/**
 * Phase 3 Task 2 — the service harness and the first chapter, `identity`.
 *
 * The harness boots the real Nest application context and runs chapter work
 * inside the CLS context TenantMiddleware builds for an HTTP request
 * (`tenantDb` + `tenantId`, never `farmScope`), so every service call here
 * resolves its database exactly as it does behind the API. Chapters post
 * operational rows through the application's own services — raw inserts for
 * anything the app would post are forbidden by Ruling 1 of the phase plan.
 *
 *   pnpm nx run api:db-demo-chapters                        # print the chapter list
 *   pnpm nx run api:db-demo-chapters -- --apply             # run every chapter
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=identity
 *   pnpm nx run api:db-demo-chapters -- --apply --force-on-existing
 *   pnpm nx run api:db-demo-chapters -- --apply --volume=full
 *   pnpm nx run api:db-demo-chapters -- --apply --no-batches   # masters, stock and registered animals only
 *
 * `--volume` picks how much data each of the nine farms gets:
 *   standard (default) — Rishi's full numbers on POR100/RIC100/VIL100, lighter
 *                        on the other four sow farms, minimum on AI100/LEX100;
 *   full               — Rishi's full numbers on every sow farm;
 *   light              — the quickest pass that still exercises every write path.
 */
import { eq, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import * as masterSchema from '../core/database/master-schema';
import * as schema from '../core/database/schema';
import { bootApp, buildDemoContext, inTenant } from './demo/harness';
import { identityChapter } from './demo/chapters/identity';
import { storesAndItemsChapter } from './demo/chapters/01-stores-and-items';
import { inventoryChapter } from './demo/chapters/02-inventory';
import { batchesAndAnimalsChapter } from './demo/chapters/03-batches-and-animals';
import { dailyEntriesChapter } from './demo/chapters/04-daily-entries';
import { breedingChapter } from './demo/chapters/05-breeding';
import { approvalsChapter } from './demo/chapters/06-approvals';
import { feedPlanningChapter } from './demo/chapters/07-feed-planning';
import { bioAssetExitChapter } from './demo/chapters/08-bio-asset-exit';
import { costingScenariosChapter } from './demo/chapters/09-costing-scenarios';
import { VOLUME_PROFILES, type VolumeProfileName } from './demo/farms';
import type { DemoChapter, DemoContext } from './demo/chapter';

/** Chapters that post against batches — left out by `--no-batches`. */
const BATCH_CHAPTERS = new Set(['04-daily-entries', '05-breeding', '06-approvals', '08-bio-asset-exit']);

/** Chapters that touch no batch and are safe to run again on a tenant that already has its own batches. */
const RESUME_SAFE_CHAPTERS = new Set(['09-costing-scenarios']);

const CHAPTERS: DemoChapter[] = [identityChapter, storesAndItemsChapter, inventoryChapter, batchesAndAnimalsChapter, dailyEntriesChapter, breedingChapter, approvalsChapter, feedPlanningChapter, bioAssetExitChapter, costingScenariosChapter];

function parseArgs(argv: string[]): { apply: boolean; chapter?: string; forceOnExisting: boolean; volume: VolumeProfileName; noBatches: boolean } {
  let apply = false;
  let chapter: string | undefined;
  let forceOnExisting = false;
  let volume: VolumeProfileName = 'standard';
  let noBatches = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--no-batches') noBatches = true;
    else if (arg === '--force-on-existing') forceOnExisting = true;
    else if (arg.startsWith('--chapter=')) chapter = arg.slice('--chapter='.length);
    else if (arg.startsWith('--volume=')) {
      const value = arg.slice('--volume='.length) as VolumeProfileName;
      if (!VOLUME_PROFILES.includes(value)) {
        throw new Error(`Unknown volume '${value}'. Use one of: ${VOLUME_PROFILES.join(', ')}.`);
      }
      volume = value;
    } else throw new Error(`Unknown flag: ${arg}. Use --apply, --chapter=<name>, --force-on-existing, --no-batches, --volume=<${VOLUME_PROFILES.join('|')}>.`);
  }
  return { apply, chapter, forceOnExisting, volume, noBatches };
}

async function resolveTenantDbForGuard(app: Awaited<ReturnType<typeof bootApp>>) {
  // The refusal guard needs the tenant database before buildDemoContext has
  // run, so resolve the dev tenant here the way the middleware does.
  const masterDb = app.get<MySql2MasterDb>(MASTER_CONNECTION);
  const [tenant] = await masterDb
    .select()
    .from(masterSchema.tenantMaster)
    .where(eq(masterSchema.tenantMaster.tenant_code, DEMO_TENANT_CODE))
    .limit(1);
  if (!tenant) throw new Error(`Demo tenant '${DEMO_TENANT_CODE}' not found in nf_master — run the master stages of the rebuild first.`);
  return app.get(ConnectionManagerService).getTenantConnection(tenant);
}

const DEMO_TENANT_CODE = 'devco';

type MySql2MasterDb = MySql2Database<typeof masterSchema>;

async function main() {
  const { apply, chapter: only, forceOnExisting, volume, noBatches } = parseArgs(process.argv.slice(2));

  const app = await bootApp();
  const log = (line: string) => console.log(line);
  let ctx: DemoContext | undefined;
  try {
    const tenantDb = await resolveTenantDbForGuard(app);

    // Refuse to build demo postings on top of existing ones: a second --apply
    // onto a tenant that already holds chapters would double-post the demo.
    const [{ count }] = await tenantDb
      .select({ count: sql<number>`count(*)` })
      .from(schema.batchHeader);
    if (count > 0 && !forceOnExisting && !(only && RESUME_SAFE_CHAPTERS.has(only))) {
      throw new Error(
        `batch_header already holds ${count} row(s). Rebuilding would double-post the demo — ` +
          'run the full db-rebuild-demo chain, or pass --force-on-existing only against a scratch tenant.',
      );
    }

    ctx = await buildDemoContext(app, log, volume);
    ctx.withBatches = !noBatches;

    // Without batches there is nothing for daily entries, breeding, approvals or the bio-asset exit to act on.
    const runnable = CHAPTERS.filter((c) => (!only || c.name === only) && !(noBatches && BATCH_CHAPTERS.has(c.name)));
    if (only && runnable.length === 0) {
      throw new Error(`No chapter named '${only}'. Available: ${CHAPTERS.map((c) => c.name).join(', ')}.`);
    }
    log(`\nChapters to ${apply ? 'run' : 'print'}: ${runnable.map((c) => c.name).join(', ')}`);

    for (const chapter of runnable) {
      log(`\n=== Chapter: ${chapter.name} ===`);
      if (!apply) continue;
      await inTenant(ctx, async () => {
        await chapter.run(ctx!);
      });
    }

    if (!apply) log('\nRead-only plan — pass --apply to run.');
  } finally {
    // Drizzle's mysql2 pools never fully drain on close, so a plain await
    // hangs the script forever after the work is done. Give the shutdown a
    // bounded window — everything durable is already committed by now — and
    // let process.exit below reap whatever is left.
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

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
 *   pnpm nx run api:db-demo-chapters -- --apply --no-daily-entries   # batches and animals, but no daily entry posted: the user enters the days
 *   pnpm nx run api:db-demo-chapters -- --apply --lean         # MUL100 only: 2 Animal Wise + 2 Batch Wise batches
 *
 * `--volume` picks how much data each of the nine farms gets:
 *   standard (default) — Rishi's full numbers on POR100/RIC100/VIL100, lighter
 *                        on the other four sow farms, minimum on AI100/LEX100;
 *   full               — Rishi's full numbers on every sow farm;
 *   light              — the quickest pass that still exercises every write path;
 *   costing            — `--lean --volume=costing` (pnpm seed:costing): the lean farm layout with a 62-day history, a bigger herd, an imported
 *                        lot beside the local one, and the client's four costing profiles in place before the herd is registered;
 *   lean (`--lean`)    — the smallest set that runs the whole flow: one sow farm, two Animal Wise and two
 *                        Batch Wise batches, a handful of animals. Meant for learning how the flow fits together.
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
import { bioCostingAssignChapter, bioCostingProfilesChapter, costingPricesChapter } from './demo/chapters/13-bio-costing';
import { costingWalkthroughChapter } from './demo/chapters/14-costing-walkthrough';
import { fullFlowChapter } from './demo/chapters/15-full-flow';
import { costingTestChapter } from './demo/chapters/16-costing-test';
import { ledgerTypesChapter } from './demo/chapters/17-ledger-types';
import { batchTransfersChapter } from './demo/chapters/10-batch-transfers';
import { stockTransfersChapter } from './demo/chapters/11-stock-transfers';
import { mortalityChapter } from './demo/chapters/12-mortality';
import { VOLUME_PROFILES, type VolumeProfileName } from './demo/farms';
import type { DemoChapter, DemoContext } from './demo/chapter';

/** Chapters that post against batches — left out by `--no-batches`. */
const BATCH_CHAPTERS = new Set(['04-daily-entries', '05-breeding', '06-approvals', '08-bio-asset-exit', '10-batch-transfers', '12-mortality']);

/** Chapters that touch no batch and are safe to run again on a tenant that already has its own batches. */
const RESUME_SAFE_CHAPTERS = new Set(['09-costing-scenarios', '14-costing-walkthrough', '15-full-flow', '16-costing-test', '17-ledger-types']);

/** Chapters that run only when named with --chapter=, never as part of a rebuild or a full run. */
const ON_DEMAND_CHAPTERS = new Set(['14-costing-walkthrough', '15-full-flow', '16-costing-test', '17-ledger-types']);

const CHAPTERS: DemoChapter[] = [identityChapter, storesAndItemsChapter, costingPricesChapter, inventoryChapter, bioCostingProfilesChapter, batchesAndAnimalsChapter, dailyEntriesChapter, breedingChapter, approvalsChapter, feedPlanningChapter, bioAssetExitChapter, batchTransfersChapter, stockTransfersChapter, mortalityChapter, costingScenariosChapter, bioCostingAssignChapter, costingWalkthroughChapter, fullFlowChapter, costingTestChapter, ledgerTypesChapter];

/** `--costing-test`: no demo herd, only what the costing test needs - the identity, stores and items, the costing prices and profiles, then chapter 16. */
const COSTING_TEST_CHAPTERS = new Set(['identity', '01-stores-and-items', '01b-costing-prices', '02b-bio-costing-profiles', '16-costing-test']);

function parseArgs(argv: string[]): { apply: boolean; chapter?: string; forceOnExisting: boolean; volume: VolumeProfileName; noBatches: boolean; noDailyEntries: boolean; lean: boolean; costingTest: boolean } {
  let apply = false;
  let chapter: string | undefined;
  let forceOnExisting = false;
  let volume: VolumeProfileName = 'standard';
  let noBatches = false;
  let noDailyEntries = false;
  let lean = false;
  let costingTest = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--no-batches') noBatches = true;
    else if (arg === '--no-daily-entries') noDailyEntries = true;
    else if (arg === '--costing-test') costingTest = true;
    else if (arg === '--lean') { lean = true; volume = 'lean'; }
    else if (arg === '--force-on-existing') forceOnExisting = true;
    else if (arg.startsWith('--chapter=')) chapter = arg.slice('--chapter='.length);
    else if (arg.startsWith('--volume=')) {
      const value = arg.slice('--volume='.length) as VolumeProfileName;
      if (!VOLUME_PROFILES.includes(value)) {
        throw new Error(`Unknown volume '${value}'. Use one of: ${VOLUME_PROFILES.join(', ')}.`);
      }
      volume = value;
    } else throw new Error(`Unknown flag: ${arg}. Use --apply, --chapter=<name>, --costing-test, --force-on-existing, --no-batches, --no-daily-entries, --lean, --volume=<${VOLUME_PROFILES.join('|')}>.`);
  }
  return { apply, chapter, forceOnExisting, volume, noBatches, noDailyEntries, lean, costingTest };
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
  const { apply, chapter: only, forceOnExisting, volume, noBatches, noDailyEntries, lean, costingTest } = parseArgs(process.argv.slice(2));

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
    ctx.lean = lean;

    // Without batches there is nothing for daily entries, breeding, approvals or the bio-asset exit to act on.
    const runnable = CHAPTERS.filter((c) => (only ? c.name === only : costingTest ? COSTING_TEST_CHAPTERS.has(c.name) : !ON_DEMAND_CHAPTERS.has(c.name)) && !(noBatches && BATCH_CHAPTERS.has(c.name)) && !(noDailyEntries && c.name === '04-daily-entries'));
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

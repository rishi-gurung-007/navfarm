/**
 * Drops and rebuilds the platform + tenant schema, then seeds every master —
 * tenant, companies, users, farms/locations (sheds, pens, silos, stores),
 * breeds with their lifecycle stages, species, production stages, the item
 * catalog, number series, and the NOB/LOB + permission alignment passes —
 * with nothing operational on top: no animals, no batches, no schedulers, no
 * daily entries, no breeding records, no inventory or GL postings. Create
 * batches (and everything that follows from them) yourself through the app
 * once this finishes — that is the whole point of stopping here.
 *
 * This is rebuild-demo.ts's own RESET_STEP + MASTER_STEPS, reused as-is, one
 * step short of demo-chapters.ts (the step that posts batches/animals). It
 * exists as a separate command rather than a new flag on rebuild-demo.ts so
 * "give me a clean masters-only database" stays a one-line command of its
 * own, and never drifts from what rebuild-demo.ts itself considers a
 * "master" — add a master step there and this list picks it up for free;
 * remove one and this does too.
 *
 *   pnpm nx run api:db-seed-masters-only                       # print the plan only
 *   pnpm nx run api:db-seed-masters-only -- --apply             # drop, rebuild schema, seed masters
 *   pnpm nx run api:db-seed-masters-only -- --apply --skip-reset # reseed masters onto the existing schema, no drop
 */
import { assertSafeRebuildTarget } from './lib/rebuild-guards';
import {
  RESET_STEP,
  MASTER_STEPS,
  deriveResetTargets,
  listResetTargetDatabases,
  formatStep,
  runStep,
  type Step,
} from './rebuild-demo';

function buildPlan(opts: { skipReset: boolean }): Step[] {
  return opts.skipReset ? [...MASTER_STEPS] : [RESET_STEP, ...MASTER_STEPS];
}

function parseArgs(argv: string[]): { apply: boolean; skipReset: boolean } {
  return { apply: argv.includes('--apply'), skipReset: argv.includes('--skip-reset') };
}

async function main() {
  // Fail before opening a single connection if this is not the local NAVFarm
  // MySQL. Everything below assumes that guarantee already holds.
  assertSafeRebuildTarget(process.env, []);

  const { apply, skipReset } = parseArgs(process.argv.slice(2));
  const plan = buildPlan({ skipReset });

  // The real target list, derived the same way setup-fresh-database.ts
  // derives it — asserted on before any subprocess runs, whether or not this
  // run's plan actually includes the reset step.
  const resetTargets = deriveResetTargets(process.env);
  const candidates = await listResetTargetDatabases(resetTargets);
  assertSafeRebuildTarget(process.env, candidates);

  console.log('================================================================');
  console.log('NAVFARM MASTERS-ONLY SEED — no animals, batches, or other operational rows');
  console.log('================================================================');
  console.log(`Would drop (reset step only): ${candidates.length ? candidates.join(', ') : '(none found)'}`);
  if (skipReset) console.log('Mode: --skip-reset — existing schema and data are kept.');
  console.log('\nOrdered command list:');
  plan.forEach((step, i) => console.log(`  ${i + 1}. ${formatStep(step)}  — ${step.label}`));

  if (!apply) {
    console.log('\nRead-only; no --apply passed. Nothing was dropped, migrated or seeded.');
    return;
  }

  console.log('\n--apply passed: running each step in order, stopping at the first failure.');
  for (const step of plan) {
    runStep(step);
  }
  console.log('\n✅ Masters seeded. No animals, batches, schedulers, daily entries, breeding records,');
  console.log('   or inventory/GL postings were created — build those through the app from here.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

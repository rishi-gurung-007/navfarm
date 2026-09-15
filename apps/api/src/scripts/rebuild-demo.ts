/**
 * The one command that rebuilds the NAVFarm demo from empty: platform +
 * tenant schema, every master, then the operational chapters (Task 2) posted
 * through the app's own services. Read-only by default — it only prints the
 * databases it would drop and the ordered command list; nothing is dropped,
 * migrated or seeded until --apply is passed.
 *
 * The ordered chain mirrors seed-demo.ts's master-data path but as standalone
 * scripts run one at a time, so a bad step stops the whole rebuild instead of
 * a one-shot process quietly finishing degraded. Operational seeding
 * (seed-piggery-complete-data.ts, seed-demo-full-coverage.ts, the operational
 * parts of seed-demo-gaps.ts, probe-farm-scope-users.ts, and every repair
 * script) is deliberately excluded — Phase 3 posts operational rows through
 * demo-chapters.ts (Task 2), never by raw insert.
 *
 *   pnpm nx run api:db-rebuild-demo                             # print the plan only
 *   pnpm nx run api:db-rebuild-demo -- --apply                  # rebuild for real
 *   pnpm nx run api:db-rebuild-demo -- --apply --skip-reset     # reseed masters onto the existing schema
 *   pnpm nx run api:db-rebuild-demo -- --apply --chapters-only  # only re-post the demo chapters
 */
import { execFileSync } from 'node:child_process';
import * as mysql from 'mysql2/promise';
import { assertSafeRebuildTarget, parseRebuildArgs, NAVFARM_DATABASE } from './lib/rebuild-guards';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

interface Step {
  label: string;
  script: string;
  args: string[];
}

// setup-fresh-database.ts drops and recreates navfarm_master/tenant_system,
// then bootstraps them, but never provisions a dev tenant — that is what the
// rest of this chain does.
const RESET_STEP: Step = { label: 'Drop and rebuild schema + platform masters', script: 'setup-fresh-database.ts', args: [] };

// Master-only path, in the order db-seed-demo builds them, minus everything
// that seed-demo.ts does inline (company template adoption, documented
// reasons/optional-field fill — see task-1-report.md) and minus every
// operational stage. seed-farm-locations.ts / seed-farm-masters.ts overwrite
// the synthetic demo farm with Triple C's submitted templates and are not
// part of seed-demo.ts at all, but the client's real data is the source of
// truth for masters now, so they belong in every rebuild regardless.
// stamp-master-nob-lob.ts and align-production-permissions.ts are the two
// alignment passes seed-demo.ts runs (the first inline, as its own last
// stage) that touch masters only, never operational rows.
const MASTER_STEPS: Step[] = [
  { label: 'Dev tenant, companies, users, starter masters', script: 'seed-dev-tenant.ts', args: [] },
  { label: 'Apply pending tenant-schema migrations', script: 'migrate-all-tenants.ts', args: [] },
  { label: 'System reference masters (UOM, species, ...)', script: 'seed-system-master-data.ts', args: [] },
  { label: 'Standard activity master catalog', script: 'seed-activity-master.ts', args: [] },
  { label: "Triple C's real farms and locations", script: 'seed-farm-locations.ts', args: ['--apply'] },
  { label: "Triple C's real resource and breed masters", script: 'seed-farm-masters.ts', args: ['--apply'] },
  { label: 'Stamp NOB/LOB on every master', script: 'stamp-master-nob-lob.ts', args: ['--apply'] },
  { label: 'Align PRODUCTION role permissions', script: 'align-production-permissions.ts', args: ['--apply'] },
];

// Task 2. Does not exist yet at the time this orchestrator was written —
// referenced here so the plan is complete; --apply will fail at this step
// until it lands.
const CHAPTERS_STEP: Step = { label: 'Post demo operational chapters (Task 2)', script: 'demo-chapters.ts', args: ['--apply'] };

function buildPlan(opts: { chaptersOnly: boolean; skipReset: boolean }): Step[] {
  // --chapters-only means exactly that: skip the reset and every master step,
  // and only re-post the chapters onto whatever masters already exist.
  if (opts.chaptersOnly) return [CHAPTERS_STEP];
  const steps: Step[] = [];
  if (!opts.skipReset) steps.push(RESET_STEP);
  steps.push(...MASTER_STEPS, CHAPTERS_STEP);
  return steps;
}

async function listCandidateDatabases(): Promise<string[]> {
  const conn = await mysql.createConnection({ host, port, user, password, ssl });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    return (rows as Array<{ Database: string }>)
      .map((r) => r.Database)
      .filter((name) => NAVFARM_DATABASE.test(name));
  } finally {
    await conn.end();
  }
}

function formatStep(step: Step): string {
  return step.args.length ? `${step.script} ${step.args.join(' ')}` : step.script;
}

function runStep(step: Step) {
  console.log(`\n⏳ ${formatStep(step)} — ${step.label}`);
  execFileSync(
    'node',
    ['--env-file-if-exists=.env', '--import', 'tsx', `src/scripts/${step.script}`, ...step.args],
    { stdio: 'inherit', cwd: process.cwd() },
  );
}

async function main() {
  // Fail before opening a single connection if this is not the local NAVFarm
  // MySQL. Everything below assumes that guarantee already holds.
  assertSafeRebuildTarget(process.env, []);

  const { apply, chaptersOnly, skipReset } = parseRebuildArgs(process.argv.slice(2));
  const plan = buildPlan({ chaptersOnly, skipReset });

  // Guarded a second time with the real candidate list: confirms every
  // database setup-fresh-database.ts would touch is one this guard allows —
  // never navcrm_*, never anything outside the NAVFarm naming — before a
  // single DROP DATABASE runs, whether or not this run will actually reset.
  const candidates = await listCandidateDatabases();
  assertSafeRebuildTarget(process.env, candidates);

  console.log('================================================================');
  console.log('NAVFARM DEMO REBUILD');
  console.log('================================================================');
  console.log(`Would drop (reset step only): ${candidates.length ? candidates.join(', ') : '(none found)'}`);
  if (chaptersOnly) console.log('Mode: --chapters-only — reset and every master step are skipped.');
  else if (skipReset) console.log('Mode: --skip-reset — existing schema and data are kept.');
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
  console.log('\n✅ Demo rebuild complete.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

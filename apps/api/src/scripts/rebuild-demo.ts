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
import { assertSafeRebuildTarget, parseRebuildArgs } from './lib/rebuild-guards';

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
// that seed-demo.ts does inline and minus every operational stage.
// seed-company-master-templates.ts fills a gap seed-demo.ts does NOT have:
// seed-demo.ts's own adoptCompanyTemplates runs copyCompanyMasterTemplates
// after seedDevTenant, and seed-dev-tenant.ts raw-inserts the company without
// ever calling it, so this step must run here too — right after the tenant
// and its tenant-scope masters exist (seed-dev-tenant.ts, migrate-all-tenants.ts,
// seed-system-master-data.ts, seed-activity-master.ts all only add tenant- or
// already-company-scoped rows, never remove or add to no_series_master after
// this point) and before the farm-data loaders, which switch off the
// synthetic company-scoped rows this step creates.
// seed-farm-locations.ts / seed-farm-masters.ts overwrite the synthetic demo
// farm with Triple C's submitted templates and are not part of seed-demo.ts
// at all, but the client's real data is the source of truth for masters now,
// so they belong in every rebuild regardless. stamp-master-nob-lob.ts and
// align-production-permissions.ts are the two alignment passes seed-demo.ts
// runs (the first inline, as its own last stage) that touch masters only,
// never operational rows.
const MASTER_STEPS: Step[] = [
  { label: 'Dev tenant, companies, users, starter masters', script: 'seed-dev-tenant.ts', args: [] },
  { label: 'Apply pending tenant-schema migrations', script: 'migrate-all-tenants.ts', args: [] },
  { label: 'System reference masters (UOM, species, ...)', script: 'seed-system-master-data.ts', args: [] },
  { label: 'Standard activity master catalog', script: 'seed-activity-master.ts', args: [] },
  { label: "Adopt tenant master templates into Triple C (no_series_master etc.)", script: 'seed-company-master-templates.ts', args: ['--apply'] },
  { label: "Triple C's real farms and locations", script: 'seed-farm-locations.ts', args: ['--apply'] },
  { label: "Triple C's real resource and breed masters", script: 'seed-farm-masters.ts', args: ['--apply'] },
  { label: 'Stamp NOB/LOB on every master', script: 'stamp-master-nob-lob.ts', args: ['--apply'] },
  { label: 'Align PRODUCTION role permissions', script: 'align-production-permissions.ts', args: ['--apply'] },
];

// Task 2. Does not exist yet at the time this orchestrator was written —
// referenced here so the plan is complete; --apply will fail at this step
// until it lands.
const CHAPTERS_STEP: Step = { label: 'Post demo operational chapters (Task 2)', script: 'demo-chapters.ts', args: ['--apply'] };

export function buildPlan(opts: { chaptersOnly: boolean; skipReset: boolean }): Step[] {
  // --chapters-only means exactly that: skip the reset and every master step,
  // and only re-post the chapters onto whatever masters already exist.
  if (opts.chaptersOnly) return [CHAPTERS_STEP];
  const steps: Step[] = [];
  if (!opts.skipReset) steps.push(RESET_STEP);
  steps.push(...MASTER_STEPS, CHAPTERS_STEP);
  return steps;
}

export interface ResetTargets {
  masterDatabase: string;
  systemDatabase: string;
  tenantPrefix: string;
}

/**
 * Derives the databases setup-fresh-database.ts is actually about to drop —
 * by the same rule, from the same env vars (DATABASE_NAME, SYSTEM_TENANT_DATABASE),
 * not by re-filtering SHOW DATABASES through the guard's own naming regex.
 * Filtering by that regex first and only then asserting on what survived the
 * filter meant the assert could never see a name the regex had already
 * excluded — which is exactly the case that matters: DATABASE_NAME or
 * SYSTEM_TENANT_DATABASE pointed at a navcrm_* database by mistake. Deriving
 * the target list the same way the real drop does, and asserting on THAT
 * before any subprocess runs, closes that gap.
 *
 * setup-fresh-database.ts also supports a `piggery_*` isolated naming mode
 * (masterDatabase.startsWith('piggery_')) that assertSafeRebuildTarget's
 * naming pattern has no allowance for. Rather than silently producing an
 * empty candidate list under that mode — which is what re-filtering through
 * NAVFARM_DATABASE did before this fix — this refuses to run at all under it,
 * loudly, until it is deliberately supported.
 */
export function deriveResetTargets(env: NodeJS.ProcessEnv): ResetTargets {
  const masterDatabase = env.DATABASE_NAME || 'navfarm_master';
  const isPiggeryIsolated = masterDatabase.startsWith('piggery_');
  if (isPiggeryIsolated) {
    throw new Error(
      `Demo rebuild does not support piggery-isolated database naming (DATABASE_NAME=${masterDatabase}). ` +
      'It only targets navfarm_master/tenant_system/tenant_<name>. Refusing to run rather than silently ' +
      'missing what setup-fresh-database.ts would drop under that naming.',
    );
  }
  const tenantPrefix = 'tenant_';
  const systemDatabase = env.SYSTEM_TENANT_DATABASE || 'tenant_system';
  return { masterDatabase, systemDatabase, tenantPrefix };
}

async function listResetTargetDatabases(targets: ResetTargets): Promise<string[]> {
  const conn = await mysql.createConnection({ host, port, user, password, ssl });
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    return (rows as Array<{ Database: string }>)
      .map((r) => r.Database)
      .filter((name) => name === targets.masterDatabase || name === targets.systemDatabase || name.startsWith(targets.tenantPrefix));
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

  // The real target list, derived the same way setup-fresh-database.ts
  // derives it — not a list pre-filtered by the guard's own regex — asserted
  // on before any subprocess runs, whether or not this run's plan actually
  // includes the reset step.
  const resetTargets = deriveResetTargets(process.env);
  const candidates = await listResetTargetDatabases(resetTargets);
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

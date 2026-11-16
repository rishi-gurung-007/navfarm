/**
 * Checks all of costing in one command: the costing unit tests, then each costing scenario - rebuilt from nothing, seeded through the application's own services, and
 * read back from MySQL against its own arithmetic (every figure recomputed, never copied from a run). One report at the end; it exits 1 when anything failed.
 *
 *   pnpm check:costing                       what it would do, nothing changed
 *   pnpm check:costing -- --apply            run everything (a few minutes)
 *   pnpm check:costing -- --apply --only=costing-fv,costing-conv
 *   pnpm check:costing -- --apply --skip-tests
 *
 * EVERY SCENARIO REBUILDS THE DEMO DATABASE (nf_devco): it drops and recreates it, as `pnpm seed:*` does, and what you made by hand in it is gone. The database holds the last
 * scenario when this finishes; list the one you want to keep last in --only. To keep nf_devco, point DATABASE_HOST / DATABASE_PORT at another local MySQL.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { COSTING_SCENARIOS } from './demo/costing-scenarios';
import { failedTests, flagsOnly, isGreen, parseChecks, parseJest, report, stripAnsi, type Outcome } from './check-costing-all.lib';

const API_DIR = join(__dirname, '..', '..');
const WEB_DIR = join(API_DIR, '..', 'web');
const JEST = join(API_DIR, '..', '..', 'node_modules', '.bin', 'jest');

const args = flagsOnly(process.argv.slice(2));
const APPLY = args.includes('--apply');
const SKIP_TESTS = args.includes('--skip-tests');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').filter(Boolean);
const unknown = args.filter((a) => !['--apply', '--skip-tests'].includes(a) && !a.startsWith('--only='));
if (unknown.length) {
  console.error(`Unknown flags: ${unknown.join(', ')}. Use --apply, --only=<${COSTING_SCENARIOS.map((s) => s.key).join('|')}>, --skip-tests.`);
  process.exit(2);
}
const scenarios = only ? only.map((k) => {
  const s = COSTING_SCENARIOS.find((x) => x.key === k);
  if (!s) { console.error(`Unknown scenario '${k}'. Use: ${COSTING_SCENARIOS.map((x) => x.key).join(', ')}.`); process.exit(2); }
  return s;
}) : [...COSTING_SCENARIOS];

const TEST_STAGES = [
  { name: 'unit tests: API', cwd: API_DIR, paths: ['src/modules/finance/bio-costing', 'src/modules/piggery/animal', 'src/drizzle/tenant', 'src/scripts'], proves: 'The costing rules, services, migrations and seed wiring, with no database' },
  { name: 'unit tests: screens', cwd: WEB_DIR, paths: ['specs/bio-costing-runs-panel', 'specs/fa-conversions-panel', 'specs/finance-sections'], proves: 'The Costing Runs and FA Conversion screens, with the API mocked' },
];

const seconds = (since: number) => (Date.now() - since) / 1000;
/** The children print plain text whatever ran this: colour codes would only hide a line's start. */
const PLAIN = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };

function runTests(stage: (typeof TEST_STAGES)[number]): Outcome {
  const t0 = Date.now();
  const r = spawnSync(JEST, stage.paths, { cwd: stage.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: PLAIN });
  const out = stripAnsi(`${r.stdout}\n${r.stderr}`);
  const j = parseJest(out);
  if (!j) return { name: stage.name, proves: stage.proves, passed: 0, total: 0, failures: [], seconds: seconds(t0), error: 'jest printed no summary' };
  return { name: stage.name, proves: stage.proves, passed: j.passed, total: j.total, failures: j.failed ? failedTests(out) : [], seconds: seconds(t0), ...(j.failed && !failedTests(out).length ? { error: `${j.failed} test(s) failed` } : {}) };
}

function runScenario(s: (typeof COSTING_SCENARIOS)[number]): Outcome {
  const t0 = Date.now();
  const r = spawnSync('node', ['--env-file-if-exists=.env', '--import', 'tsx', 'src/scripts/rebuild-demo.ts', '--apply', `--preset=${s.key}`], {
    cwd: API_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 25 * 60 * 1000, env: PLAIN,
  });
  const out = stripAnsi(`${r.stdout}\n${r.stderr}`);
  const c = parseChecks(out);
  if (!c) {
    const tail = out.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
    return { name: s.key, proves: s.proves, passed: 0, total: 0, failures: [], seconds: seconds(t0), error: `the rebuild exited with code ${r.status ?? 'timeout'} and printed no result: ${tail}` };
  }
  return { name: s.key, proves: s.proves, ...c, seconds: seconds(t0), ...(r.status !== 0 && c.failures.length === 0 ? { error: `the rebuild exited with code ${r.status} after its checks` } : {}) };
}

function main() {
  const host = `${process.env.DATABASE_HOST || '127.0.0.1'}:${process.env.DATABASE_PORT || 3306}`;
  console.log(`${APPLY ? 'APPLY' : 'READ-ONLY (nothing changed)'} against MySQL ${host}`);
  console.log('Stages:');
  if (!SKIP_TESTS) for (const t of TEST_STAGES) console.log(`  - ${t.name}: ${t.proves}`);
  for (const s of scenarios) console.log(`  - ${s.key}: ${s.proves}`);
  if (!APPLY) {
    console.log('\nEach scenario REBUILDS the demo database (nf_devco): drops and recreates it, so anything made by hand in it is lost.');
    console.log('Run again with --apply. To keep nf_devco, point DATABASE_HOST / DATABASE_PORT at another local MySQL.');
    return;
  }
  const outcomes: Outcome[] = [];
  const show = (o: Outcome) => console.log(`${isGreen(o) ? '✔' : '✖'} ${o.name}  ${o.error && !o.total ? 'no result' : `${o.passed}/${o.total}`}  (${Math.round(o.seconds)}s)`);
  if (!SKIP_TESTS) for (const t of TEST_STAGES) { console.log(`▶ ${t.name}`); const o = runTests(t); show(o); outcomes.push(o); }
  for (const s of scenarios) { console.log(`▶ ${s.key}  (rebuilding the demo database)`); const o = runScenario(s); show(o); outcomes.push(o); }
  const { text, ok } = report(outcomes);
  console.log(text);
  if (scenarios.length) console.log(`\nThe demo database now holds the last scenario: ${scenarios[scenarios.length - 1].key}. Re-run its seed (pnpm seed:${scenarios[scenarios.length - 1].key}) or another to change it.`);
  process.exit(ok ? 0 : 1);
}

main();

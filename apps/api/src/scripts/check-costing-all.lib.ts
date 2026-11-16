/**
 * The pure parts of `check-costing-all.ts`: what a scenario run printed, turned into a result, and the report built from the results.
 */
export interface Outcome {
  name: string;
  /** What the stage proves, one line */
  proves: string;
  passed: number;
  total: number;
  /** FAIL lines, in full */
  failures: string[];
  seconds: number;
  /** The process itself failed (it exited non-zero, or printed no summary) */
  error?: string;
}

/** Output run through pnpm or nx can carry colour codes, which would hide a line's start from every match below. */
export const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

/** The checkers print `PASS id what [detail]` / `FAIL id ...` per check and end with "23 of 23 checks passed[; 2 FAILED]." */
export function parseChecks(raw: string): { passed: number; total: number; failures: string[] } | null {
  const output = stripAnsi(raw);
  const sums = [...output.matchAll(/(\d+) of (\d+) checks passed/g)];
  if (!sums.length) return null;
  const last = sums[sums.length - 1];
  const failures = output.split('\n').filter((l) => /^FAIL\s/.test(l)).map((l) => l.trim());
  return { passed: Number(last[1]), total: Number(last[2]), failures };
}

/** jest prints "Tests:       1 failed, 446 passed, 447 total" (the failed part only when there are failures). */
export function parseJest(raw: string): { passed: number; failed: number; total: number } | null {
  const output = stripAnsi(raw);
  const line = output.split('\n').find((l) => /^Tests:\s/.test(l));
  if (!line) return null;
  const n = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);
  return { passed: n('passed'), failed: n('failed'), total: n('total') };
}

/**
 * The tests jest reports as failed: `● Suite › test name`. A bare `● Console` is jest's heading for what a passing test wrote with console.log / console.error,
 * not a failure, and is not counted.
 */
export function failedTests(raw: string): string[] {
  return [...new Set(stripAnsi(raw).split('\n')
    .filter((l) => /^\s*●\s/.test(l) && l.includes(' › '))
    .map((l) => `FAIL  ${l.replace(/^\s*●\s*/, '').trim()}`))];
}

/** A shell pastes a trailing `# comment` as arguments; everything from a `#` on is not a flag. */
export const flagsOnly = (argv: string[]) => { const i = argv.indexOf('#'); return i < 0 ? argv : argv.slice(0, i); };

export const isGreen = (o: Outcome) => !o.error && o.total > 0 && o.passed === o.total && o.failures.length === 0;

const fmtSeconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);

export function report(outcomes: Outcome[]): { text: string; ok: boolean } {
  const lines: string[] = ['', 'COSTING - EVERYTHING, READ BACK FROM MYSQL', ''];
  const width = Math.max(...outcomes.map((o) => o.name.length), 8);
  for (const o of outcomes) {
    const status = isGreen(o) ? 'PASS' : 'FAIL';
    const count = o.error && !o.total ? 'no result' : `${o.passed}/${o.total}`;
    lines.push(`${status}  ${o.name.padEnd(width)}  ${count.padStart(9)}  ${fmtSeconds(o.seconds).padStart(6)}  ${o.proves}`);
    if (o.error) lines.push(`      ! ${o.error}`);
  }
  const failed = outcomes.filter((o) => !isGreen(o));
  const checks = outcomes.reduce((n, o) => n + o.total, 0);
  const passed = outcomes.reduce((n, o) => n + o.passed, 0);
  if (failed.length) {
    lines.push('', 'WHAT FAILED');
    for (const o of failed) for (const f of o.failures.length ? o.failures : [o.error ?? 'no checks ran']) lines.push(`  [${o.name}] ${f}`);
  }
  lines.push('', `${passed} of ${checks} checks passed across ${outcomes.length} stages${failed.length ? `; ${failed.length} stage(s) FAILED` : ''}.`);
  return { text: lines.join('\n'), ok: failed.length === 0 };
}

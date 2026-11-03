import { failedTests, flagsOnly, isGreen, parseChecks, parseJest, report, stripAnsi, type Outcome } from './check-costing-all.lib';

describe('parseChecks', () => {
  it('reads the checkers\' summary and keeps the FAIL lines whole', () => {
    const out = 'PASS  F1  fine\nFAIL  R1  every charge  [3 wrong of 12]\nPASS  R2  ok\n\n25 of 26 checks passed; 1 FAILED.\n';
    expect(parseChecks(out)).toEqual({ passed: 25, total: 26, failures: ['FAIL  R1  every charge  [3 wrong of 12]'] });
  });
  it('uses the last summary when the run printed several, and says nothing when there is none', () => {
    expect(parseChecks('2 of 2 checks passed.\nrebuild...\n21 of 21 checks passed.')).toMatchObject({ passed: 21, total: 21 });
    expect(parseChecks('the rebuild stopped here')).toBeNull();
  });
});

describe('colour codes', () => {
  it('are stripped, so a coloured run reads the same as a plain one', () => {
    const esc = String.fromCharCode(27);
    const coloured = `${esc}[32mPASS${esc}[39m  F1  fine\n${esc}[31mFAIL${esc}[39m  R1  bad\n${esc}[1mTests:${esc}[22m       1 failed, 4 passed, 5 total\n9 of 10 checks passed; 1 FAILED.`;
    expect(stripAnsi(coloured)).toContain('Tests:       1 failed');
    expect(parseJest(coloured)).toEqual({ passed: 4, failed: 1, total: 5 });
    expect(parseChecks(coloured)).toEqual({ passed: 9, total: 10, failures: ['FAIL  R1  bad'] });
  });
});

describe('parseJest', () => {
  it('reads passed, failed and total', () => {
    expect(parseJest('Test Suites: 1 failed\nTests:       1 failed, 446 passed, 447 total\n')).toEqual({ passed: 446, failed: 1, total: 447 });
    expect(parseJest('Tests:       25 passed, 25 total')).toEqual({ passed: 25, failed: 0, total: 25 });
    expect(parseJest('no summary')).toBeNull();
  });
});

describe('report', () => {
  const ok: Outcome = { name: 'costing-two', proves: 'small case', passed: 32, total: 32, failures: [], seconds: 95, };
  it('is green only when every stage passed every check', () => {
    expect(isGreen(ok)).toBe(true);
    expect(isGreen({ ...ok, passed: 31, failures: ['FAIL  R1  x'] })).toBe(false);
    expect(isGreen({ ...ok, error: 'exit 1' })).toBe(false);
    expect(isGreen({ ...ok, total: 0, passed: 0 })).toBe(false);
    const r = report([ok, { ...ok, name: 'costing-fv', passed: 23, total: 23, seconds: 130 }]);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('55 of 55 checks passed across 2 stages.');
    expect(r.text).toContain('1m35s');
  });
  it('lists what failed, and a stage that produced no result at all', () => {
    const r = report([ok, { name: 'costing-fv', proves: 'fair value', passed: 0, total: 0, failures: [], seconds: 4, error: 'the rebuild exited with code 1' }, { ...ok, name: 'costing-conv', passed: 20, total: 21, failures: ['FAIL  N2  gain'] }]);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('no result');
    expect(r.text).toContain('[costing-conv] FAIL  N2  gain');
    expect(r.text).toContain('[costing-fv] the rebuild exited with code 1');
    expect(r.text).toContain('2 stage(s) FAILED');
  });
});

describe('failedTests', () => {
  it('counts a failed test, not the "Console" heading jest prints over what a passing test logged', () => {
    const out = '  ● Console\n\n    console.error\n      Each child should have a key\n\n  ● Suite › does a thing\n\n    expect(1).toBe(2)\n  ● Suite › does a thing\n';
    expect(failedTests(out)).toEqual(['FAIL  Suite › does a thing']);
    expect(failedTests('  ● Console\n')).toEqual([]);
  });
});

describe('flagsOnly', () => {
  it('drops a pasted trailing comment, so the commented lines in a guide can be copied whole', () => {
    expect(flagsOnly(['--apply', '#', 'runs', 'everything'])).toEqual(['--apply']);
    expect(flagsOnly(['#', 'shows', 'the', 'plan'])).toEqual([]);
    expect(flagsOnly(['--apply', '--skip-tests'])).toEqual(['--apply', '--skip-tests']);
  });
});

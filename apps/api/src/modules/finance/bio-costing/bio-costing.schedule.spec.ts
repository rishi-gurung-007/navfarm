import { duePeriods, MAX_FAILURES, type RunFact } from './bio-costing.schedule';

const posted = (key: string, end: string): RunFact => ({ status: 'POSTED', period_key: key, period_end: end });
const base = { frequency: 'MONTHLY', effectiveFrom: '2026-07-10', today: '2026-10-20' };

describe('duePeriods', () => {
  it('starts at the period that holds the profile\'s effective date and lists every finished period up to today, never the current one', () => {
    const r = duePeriods({ ...base, runs: [], limit: 12 });
    expect(r.periods.map((p) => p.key)).toEqual(['2026-07', '2026-08', '2026-09']); // October ends on the 31st: not finished
    expect(r.blocked).toBeNull();
  });

  it('carries on from the period after the latest posted run, whatever order the rows come in', () => {
    const r = duePeriods({ ...base, runs: [posted('2026-08', '2026-08-31'), posted('2026-07', '2026-07-31')] });
    expect(r.periods.map((p) => p.key)).toEqual(['2026-09']);
  });

  it('has nothing due once the latest finished period is posted', () => {
    expect(duePeriods({ ...base, runs: [posted('2026-09', '2026-09-30')] })).toEqual({ periods: [], blocked: null });
  });

  it('bounds a catch-up after a long gap: three periods a pass by default', () => {
    const r = duePeriods({ frequency: 'MONTHLY', effectiveFrom: '2025-01-01', runs: [], today: '2026-10-20' });
    expect(r.periods.map((p) => p.key)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('waits behind a calculated run that nobody has posted, and says which', () => {
    const r = duePeriods({ ...base, runs: [posted('2026-07', '2026-07-31'), { status: 'CALCULATED', period_key: '2026-08', period_end: '2026-08-31', run_no: 'BCR-2026-00002' }] });
    expect(r).toEqual({ periods: [], blocked: { reason: 'WAITING_TO_POST', run_no: 'BCR-2026-00002', period_key: '2026-08' } });
  });

  it('treats a reversed run as if it had not been made, so its period is due again', () => {
    const r = duePeriods({ ...base, runs: [posted('2026-07', '2026-07-31'), { status: 'REVERSED', period_key: '2026-08', period_end: '2026-08-31' }] });
    expect(r.periods[0].key).toBe('2026-08');
  });

  it('stops retrying a period that has failed too often, and keeps the last error', () => {
    const failed = (n: number): RunFact => ({ status: 'FAILED', period_key: '2026-08', period_end: '2026-08-31', error_message: `try ${n}` });
    const runs = [posted('2026-07', '2026-07-31'), ...Array.from({ length: MAX_FAILURES }, (_, i) => failed(i + 1))];
    expect(duePeriods({ ...base, runs })).toEqual({ periods: [], blocked: { reason: 'TOO_MANY_FAILURES', period_key: '2026-08', attempts: MAX_FAILURES, error: `try ${MAX_FAILURES}` } });
    // one failure fewer, and it is tried again
    expect(duePeriods({ ...base, runs: runs.slice(0, runs.length - 1) }).periods[0].key).toBe('2026-08');
  });

  it('works for the other frequencies: weekly (ISO), quarterly and yearly', () => {
    expect(duePeriods({ frequency: 'WEEKLY', effectiveFrom: '2026-10-05', runs: [], today: '2026-10-20' }).periods.map((p) => p.key)).toEqual(['2026-W41', '2026-W42']);
    expect(duePeriods({ frequency: 'QUARTERLY', effectiveFrom: '2026-01-15', runs: [], today: '2026-10-20' }).periods.map((p) => p.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3']);
    expect(duePeriods({ frequency: 'YEARLY', effectiveFrom: '2025-06-01', runs: [], today: '2026-10-20' }).periods.map((p) => p.key)).toEqual(['2025']);
  });

  it('owes nothing for a profile that only takes effect in a period that has not finished', () => {
    expect(duePeriods({ frequency: 'MONTHLY', effectiveFrom: '2026-10-05', runs: [], today: '2026-10-20' }).periods).toEqual([]);
  });
});

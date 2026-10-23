/**
 * Which periods a costing profile owes a run for (bio-asset costing, Phase 5). Pure: the scheduler loads the rows and this decides.
 *
 * The rules, and what is ours:
 *  - A period is due once it has finished (its last day is on or before today). Only finished periods are ever run (V4).
 *  - The first period is the one that holds the profile's effective date. Charging for periods before the profile existed is a
 *    backfill decision for the client (Phase 6), not something a timer does on its own [ours].
 *  - After that, the period after the latest POSTED run. Book values carry forward, so a period is never run behind a posted later one.
 *  - A run that is CALCULATED but not posted blocks the profile: the next period's book values would be wrong without it. The
 *    profile waits, and says so, until someone posts or reverses it [ours].
 *  - A period whose runs have failed `maxFailures` times is not retried on every tick; it waits for someone to look [ours].
 *  - At most `limit` periods are returned, so catching up after a long gap is bounded.
 */
import { addDays, periodFor, type Period } from './bio-costing.engine';

export const MAX_FAILURES = 3;
export const MAX_PERIODS_PER_PASS = 3;

export interface RunFact {
  status: string; // CALCULATED, POSTED, REVERSED, FAILED
  period_key: string;
  period_end: string;
  run_no?: string | null;
  error_message?: string | null;
}

export type Blocked =
  | { reason: 'WAITING_TO_POST'; run_no: string | null; period_key: string }
  | { reason: 'TOO_MANY_FAILURES'; period_key: string; attempts: number; error: string | null };

export interface DueResult {
  /** Finished periods owed a run, oldest first. Empty when blocked or when nothing is due. */
  periods: Period[];
  blocked: Blocked | null;
}

export function duePeriods(input: {
  frequency: string;
  effectiveFrom: string;
  runs: RunFact[];
  today: string;
  limit?: number;
  maxFailures?: number;
}): DueResult {
  const limit = input.limit ?? MAX_PERIODS_PER_PASS;
  const maxFailures = input.maxFailures ?? MAX_FAILURES;

  const waiting = input.runs.find((r) => r.status === 'CALCULATED');
  if (waiting) return { periods: [], blocked: { reason: 'WAITING_TO_POST', run_no: waiting.run_no ?? null, period_key: waiting.period_key } };

  const posted = input.runs.filter((r) => r.status === 'POSTED').sort((a, b) => (a.period_end < b.period_end ? 1 : -1));
  let next = posted.length ? periodFor(input.frequency, addDays(posted[0].period_end, 1)) : periodFor(input.frequency, input.effectiveFrom);

  const periods: Period[] = [];
  while (next.end <= input.today && periods.length < limit) {
    periods.push(next);
    next = periodFor(input.frequency, addDays(next.end, 1));
  }
  if (!periods.length) return { periods: [], blocked: null };

  const failed = input.runs.filter((r) => r.status === 'FAILED' && r.period_key === periods[0].key);
  if (failed.length >= maxFailures) {
    return { periods: [], blocked: { reason: 'TOO_MANY_FAILURES', period_key: periods[0].key, attempts: failed.length, error: failed[failed.length - 1].error_message ?? null } };
  }
  return { periods, blocked: null };
}

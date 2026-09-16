/**
 * Who may record or change a day's entry, and when.
 *
 * Rules the farm asked for, kept in one place because they interact:
 *
 *  - A day that has not happened yet is never enterable, by anyone.
 *  - A worker may enter any day still owed, but may only *change* today's.
 *    Clearing a backlog is entry, not editing — fencing it would leave the
 *    worker unable to do the very thing the backlog rule demands of them.
 *  - A missed day never blocks today (decided 2026-09-14): gaps are surfaced
 *    as Missing and notified instead.
 *
 * The second rule fences the worker, not the supervisor: a role holding edit
 * on the entry resource is exactly the role whose job is fixing what the
 * worker got wrong.
 *
 * Which role that is comes from the permission table, never from a role name.
 */

export type EntryRefusal = 'FUTURE' | 'PAST_EDIT';

export type EntryVerdict =
  | { allowed: true }
  | { allowed: false; code: EntryRefusal; message: string };

export interface EntryRequest {
  /** The date being recorded, YYYY-MM-DD. */
  entryDate: string;
  /** Today in the company's own timezone, YYYY-MM-DD. */
  today: string;
  /** Whether this line already has a value on this date. */
  exists: boolean;
  /** Holder of edit on the entry resource — supervisor and above. */
  mayEditAnyDay: boolean;
}

export function entryVerdict(req: EntryRequest): EntryVerdict {
  if (req.entryDate > req.today) {
    return {
      allowed: false,
      code: 'FUTURE',
      message: `${req.entryDate} has not happened yet — a day cannot be recorded in advance.`,
    };
  }

  if (req.mayEditAnyDay) return { allowed: true };

  if (req.exists && req.entryDate !== req.today) {
    return {
      allowed: false,
      code: 'PAST_EDIT',
      message: `This entry was recorded on ${req.entryDate} and can no longer be changed here. Ask a supervisor to correct it.`,
    };
  }

  return { allowed: true };
}

/**
 * Whether a posted line can be corrected today (Phase 6, Ruling 3).
 *
 * A correction supersedes the posting and reverses what it did, so it is only
 * offered where there is a reversal to run: consumption has one
 * (reverseConsumption), and a plain descriptive reading changed nothing that
 * needs undoing. HEAD_COUNT and MORTALITY_COUNT readings move animal_register
 * and the scheduler's head count, and output, overhead, resource and transfer
 * postings have no reversal yet — those wait for Phase 13.
 */
export function isCorrectableLineType(line: { line_type: string | null; kpi_metric: string | null }): boolean {
  if (line.line_type === 'CONSUMPTION') return true;
  if (line.line_type === 'RESOURCE') return true;
  if (line.line_type !== 'DESCRIPTIVE') return false;
  return line.kpi_metric !== 'HEAD_COUNT' && line.kpi_metric !== 'MORTALITY_COUNT';
}

/**
 * Today's date in a company's timezone.
 *
 * The farm's day, not the server's. A worker in Harare entering at 01:00 is
 * still on the same calendar day the farm is; UTC would call it yesterday and
 * lock them out of their own shift.
 *
 * `timezone` is whatever company_master.default_timezone_id holds. The column
 * is named for an id but carries an IANA code in practice, so the code is tried
 * first and a numeric offset is the fallback for rows that hold neither.
 */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string | null {
  if (!timezone) return null;
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape the rest of this uses.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  } catch {
    return null;
  }
}

/** Today's date at a fixed offset from UTC, for timezones stored as minutes. */
export function todayAtOffset(offsetMinutes: number, now: Date = new Date()): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

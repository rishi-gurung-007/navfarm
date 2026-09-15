/**
 * Which scheduler lines fall due on a given date, and whether a day's entry is
 * finished.
 *
 * Kept pure and free of the database because this is the rule the whole data
 * entry screen turns on: it decides the tick beside a stage, whether today can
 * be entered at all, and how far back the backlog reaches. A rule that decides
 * that much should be testable without a tenant, a batch or a connection.
 *
 * Day numbers count from the scheduler's `effective_from`, which is day 1 — not
 * from the batch start. A scheduler belongs to one batch at one stage, so its
 * own start is what "day 3 of this stage" means.
 */

/** The subset of scheduler_line this rule reads. */
export interface DueLine {
  line_id: string;
  stage_id: string | null;
  occurrence: string | null;
  start_day: number | null;
  end_day: number | null;
  day_of_week: number | null;
  is_mandatory: boolean;
  /** scheduler_line_custom_days.day_number for this line, when occurrence is
   * CUSTOM — day 1 = the scheduler's own effective_from, same convention as
   * start_day/end_day. Absent/empty means "not resolved", not "every day". */
  custom_days?: number[] | null;
}

/**
 * A YYYY-MM-DD string as a UTC timestamp.
 *
 * Date.UTC takes a 0-based month, so the -1 is not optional: passing the month
 * as written shifts every date forward by a month. Two dates in the same month
 * shift together and the difference still looks right, which is exactly how
 * that bug survives until a range crosses a month boundary.
 */
function utcOf(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Midnight-to-midnight difference in whole days, ignoring clock time. */
function dayIndex(from: string, on: string): number {
  // +1 so the scheduler's own start date is day 1, matching how start_day reads.
  return Math.floor((utcOf(on) - utcOf(from)) / 86_400_000) + 1;
}

/** ISO weekday for a date string, 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): number {
  const js = new Date(utcOf(date)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Calendar day-of-month for a YYYY-MM-DD string. */
function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

/** Days in the given date string's month — day 0 of the next month is the last day of this one. */
function daysInMonth(date: string): number {
  const [y, m] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Whether one line falls due on `date`.
 *
 * An unrecognised occurrence is treated as DAILY rather than skipped: a line
 * nobody can see is a line nobody enters, and a spurious extra row on the form
 * is a far smaller problem than a missing feed record.
 */
export function isLineDue(line: DueLine, effectiveFrom: string, date: string): boolean {
  const day = dayIndex(effectiveFrom, date);
  if (day < 1) return false;
  const start = line.start_day ?? 1;
  if (day < start) return false;
  if (line.end_day != null && day > line.end_day) return false;

  switch ((line.occurrence || 'DAILY').toUpperCase()) {
    case 'ONCE':
      return day === start;
    case 'WEEKLY':
      // Without a stated weekday, fall back to the weekday the line started on,
      // so a weekly line still recurs rather than never coming due.
      return weekdayOf(date) === (line.day_of_week ?? weekdayOf(effectiveFrom));
    case 'MONTHLY': {
      // Same day-of-month as the scheduler's own effective_from — e.g. started
      // on the 31st, due on the 31st. A month too short for that day falls
      // back to its own last day rather than skipping the month entirely.
      const wantDay = Math.min(dayOfMonth(effectiveFrom), daysInMonth(date));
      return dayOfMonth(date) === wantDay;
    }
    case 'CUSTOM':
      // Custom days live in scheduler_line_custom_days; a line whose custom set
      // has not been resolved is not due, because guessing a schedule is worse
      // than showing none.
      return (line.custom_days ?? []).includes(day);
    default:
      return true;
  }
}

export interface StageDayStatus {
  stage_id: string | null;
  /** Every line due on this date for this stage. */
  due: number;
  /** Of those, the ones that must be answered before the day counts as done. */
  mandatory: number;
  /** Mandatory lines that have a value recorded. */
  mandatoryEntered: number;
  /** Any line with a value, mandatory or not — what the form shows as filled. */
  entered: number;
  /** The tick: every mandatory line due today has been answered. */
  complete: boolean;
}

/**
 * Per-stage status for one date.
 *
 * Complete means every *mandatory* line is answered; an optional weighing left
 * blank does not hold the day open. A stage with nothing due is complete by
 * definition — there is nothing to withhold the tick for.
 */
export function stageDayStatus(
  lines: DueLine[],
  effectiveFrom: string,
  date: string,
  enteredLineIds: Set<string>,
): StageDayStatus[] {
  const byStage = new Map<string | null, DueLine[]>();
  for (const line of lines) {
    if (!isLineDue(line, effectiveFrom, date)) continue;
    const key = line.stage_id ?? null;
    const list = byStage.get(key);
    if (list) list.push(line);
    else byStage.set(key, [line]);
  }

  return [...byStage.entries()].map(([stage_id, due]) => {
    const mandatory = due.filter((l) => l.is_mandatory);
    const mandatoryEntered = mandatory.filter((l) => enteredLineIds.has(l.line_id)).length;
    return {
      stage_id,
      due: due.length,
      mandatory: mandatory.length,
      mandatoryEntered,
      entered: due.filter((l) => enteredLineIds.has(l.line_id)).length,
      complete: mandatoryEntered === mandatory.length,
    };
  });
}

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = utcOf(to);
  for (let t = utcOf(from); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * `date` moved by `days` whole days, as YYYY-MM-DD.
 *
 * Through utcOf so the month is read 0-based — the same trap datesBetween
 * avoids, and the one a window reaching back across a month end falls into.
 */
export function addDays(date: string, days: number): string {
  return new Date(utcOf(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The days between the batch's start and `upTo` that still have an unanswered
 * mandatory line — oldest first.
 *
 * The backlog reaches all the way back to the batch start deliberately: a gap
 * left behind is a hole in the batch's cost that nothing later fills in. A day
 * on which nothing was due is not pending; it simply had no work.
 */
export function pendingDays(
  lines: DueLine[],
  effectiveFrom: string,
  batchStart: string,
  upTo: string,
  enteredByDate: Map<string, Set<string>>,
): string[] {
  return datesBetween(batchStart, upTo).filter((date) => {
    const entered = enteredByDate.get(date) ?? new Set<string>();
    const statuses = stageDayStatus(lines, effectiveFrom, date, entered);
    return statuses.some((s) => !s.complete);
  });
}

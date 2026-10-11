/**
 * Feed scheduler — pure rules (brief B). Which job is due for a farm at a
 * given local clock, and the key that makes a scheduled run happen once per
 * period.
 *
 * Times and days are configuration, never constants here (decisions 1 Oct):
 * Feed Planning Settings hold the tentative-plan run (Engine row 69), the
 * reminder (Requisition row 84) and the submission cutoff (row 85). A job
 * whose day or time is not configured is not scheduled; "Run now" still runs it.
 * Notices are in-app only: the email channel is deferred (Rishi, 11 Oct).
 */
import type { LocalClock } from '../feed-forecast/feed-forecast.engine';

export const FEED_JOBS = ['TENTATIVE_PLAN', 'REQ_REMINDER', 'REQ_CUTOFF', 'DIET_CHANGE', 'ESCALATION'] as const;
export type FeedJob = (typeof FEED_JOBS)[number];
export const isFeedJob = (value: unknown): value is FeedJob => typeof value === 'string' && (FEED_JOBS as readonly string[]).includes(value);

/** Who creates the scheduled Feed Plan version (feed_plan.created_by is not a user FK). */
export const FEED_SCHEDULER_ACTOR = 'FEED_SCHEDULER';

export interface ScheduleSettings {
  tentativePlanWeekday: number | null;
  tentativePlanTime: string | null;
  reminderWeekday: number | null;
  reminderTime: string | null;
  submissionWeekday: number | null;
  submissionTime: string | null;
}

export type JobCadence =
  | { kind: 'WEEKLY'; weekday: number; time: string }
  | { kind: 'DAILY' }
  | { kind: 'HOURLY' };

/**
 * TENTATIVE_PLAN, REQ_REMINDER and REQ_CUTOFF are weekly at their configured
 * day and time; null when either is unset. DIET_CHANGE is daily (checkpoint 30's
 * "within N days" is a whole-day window, so the first tick of the farm's day
 * is enough). ESCALATION is hourly, because Escalation After Hours (row 53)
 * is counted in hours.
 */
export function cadenceOf(job: FeedJob, s: ScheduleSettings): JobCadence | null {
  const weekly = (weekday: number | null, time: string | null): JobCadence | null =>
    weekday === null || !time ? null : { kind: 'WEEKLY', weekday, time };
  switch (job) {
    case 'TENTATIVE_PLAN': return weekly(s.tentativePlanWeekday, s.tentativePlanTime);
    case 'REQ_REMINDER': return weekly(s.reminderWeekday, s.reminderTime);
    case 'REQ_CUTOFF': return weekly(s.submissionWeekday, s.submissionTime);
    case 'DIET_CHANGE': return { kind: 'DAILY' };
    case 'ESCALATION': return { kind: 'HOURLY' };
  }
}

/**
 * The period a job is due for at this local clock, or null when it is not due.
 * A weekly job is due on its weekday from its time until the end of that local
 * day — a tick missed at 18:00 sharp still runs at 18:05, but a Friday job is
 * never run on Saturday.
 */
export function duePeriod(job: FeedJob, s: ScheduleSettings, clock: LocalClock): string | null {
  const cadence = cadenceOf(job, s);
  if (!cadence) return null;
  if (cadence.kind === 'HOURLY') return `${clock.date}T${clock.time.slice(0, 2)}`;
  if (cadence.kind === 'DAILY') return clock.date;
  return clock.weekday === cadence.weekday && clock.time >= cadence.time ? clock.date : null;
}

/** feed_schedule_log.run_key: one scheduled run per job, farm and period. */
export const runKey = (job: FeedJob, farmId: string, period: string): string => `${job}|${farmId}|${period}`;

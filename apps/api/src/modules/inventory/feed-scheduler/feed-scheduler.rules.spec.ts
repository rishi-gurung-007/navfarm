import { localClock } from '../feed-forecast/feed-forecast.engine';
import { ScheduleSettings, cadenceOf, duePeriod, isFeedJob, runKey } from './feed-scheduler.rules';

// Decisions 1 Oct (Triple C starting configuration) and Engine row 69 — configured values, passed in as settings.
const tripleC: ScheduleSettings = {
  tentativePlanWeekday: 3, tentativePlanTime: '09:00',
  reminderWeekday: 5, reminderTime: '18:00',
  submissionWeekday: 6, submissionTime: '12:00',
};
const unset: ScheduleSettings = {
  tentativePlanWeekday: null, tentativePlanTime: null, reminderWeekday: null, reminderTime: null, submissionWeekday: null, submissionTime: null,
};
// Africa/Harare is UTC+2 all year.
const harare = (iso: string) => localClock('Africa/Harare', Date.parse(iso));

describe('localClock — the company time zone', () => {
  it('reads the Harare wall clock, weekday and day, not the server or UTC one', () => {
    expect(harare('2026-09-25T16:00:00Z')).toEqual({ date: '2026-09-25', weekday: 5, time: '18:00' });
    expect(harare('2026-09-25T22:30:00Z')).toEqual({ date: '2026-09-26', weekday: 6, time: '00:30' });
  });
});

describe('duePeriod — configured days and times, in the company zone', () => {
  it('runs the tentative plan on the configured Wednesday from 09:00 local, for that day only', () => {
    expect(duePeriod('TENTATIVE_PLAN', tripleC, harare('2026-09-23T06:55:00Z'))).toBeNull(); // 08:55 Harare
    expect(duePeriod('TENTATIVE_PLAN', tripleC, harare('2026-09-23T07:00:00Z'))).toBe('2026-09-23'); // 09:00 Harare
    expect(duePeriod('TENTATIVE_PLAN', tripleC, harare('2026-09-23T21:55:00Z'))).toBe('2026-09-23'); // 23:55 Harare
    expect(duePeriod('TENTATIVE_PLAN', tripleC, harare('2026-09-24T07:00:00Z'))).toBeNull(); // Thursday
  });

  it('runs the reminder on Friday from 18:00 and the cutoff on Saturday from 12:00', () => {
    expect(duePeriod('REQ_REMINDER', tripleC, harare('2026-09-25T15:59:00Z'))).toBeNull();
    expect(duePeriod('REQ_REMINDER', tripleC, harare('2026-09-25T16:00:00Z'))).toBe('2026-09-25');
    expect(duePeriod('REQ_CUTOFF', tripleC, harare('2026-09-26T09:59:00Z'))).toBeNull();
    expect(duePeriod('REQ_CUTOFF', tripleC, harare('2026-09-26T10:00:00Z'))).toBe('2026-09-26');
  });

  it('follows a tenant that configures other days (Requisition row 85: "do not assume fixed weekday")', () => {
    const thursdayCutoff = { ...tripleC, submissionWeekday: 4, submissionTime: '15:30' };
    expect(duePeriod('REQ_CUTOFF', thursdayCutoff, harare('2026-09-24T13:30:00Z'))).toBe('2026-09-24');
    expect(duePeriod('REQ_CUTOFF', thursdayCutoff, harare('2026-09-26T10:00:00Z'))).toBeNull();
  });

  it('never schedules a weekly job whose day or time is not configured — no built-in Friday or Wednesday', () => {
    for (const job of ['TENTATIVE_PLAN', 'REQ_REMINDER', 'REQ_CUTOFF'] as const) {
      expect(cadenceOf(job, unset)).toBeNull();
      expect(duePeriod(job, unset, harare('2026-09-25T16:00:00Z'))).toBeNull();
    }
    expect(cadenceOf('REQ_REMINDER', { ...tripleC, reminderTime: null })).toBeNull();
  });

  it('runs the diet-change check once per local day and escalation once per local hour', () => {
    expect(duePeriod('DIET_CHANGE', unset, harare('2026-09-25T22:30:00Z'))).toBe('2026-09-26');
    expect(duePeriod('ESCALATION', unset, harare('2026-09-25T22:30:00Z'))).toBe('2026-09-26T00');
    expect(runKey('ESCALATION', 'farm-1', '2026-09-26T00')).toBe('ESCALATION|farm-1|2026-09-26T00');
  });
});


describe('isFeedJob', () => {
  it('accepts the five jobs and nothing else', () => {
    for (const job of ['TENTATIVE_PLAN', 'REQ_REMINDER', 'REQ_CUTOFF', 'DIET_CHANGE', 'ESCALATION']) expect(isFeedJob(job)).toBe(true);
    expect(isFeedJob('EMAIL')).toBe(false);
  });
});

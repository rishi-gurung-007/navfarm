import { assessmentIssues, conditionStatus, ConditionSetup, feedSet, nextDueDate, ScaleRow, scaleFor } from './boar-condition.rules';

/**
 * The scale is the client's SOP 21 (Boar Body Condition Scoring, issue 01, effective 01/04/26). It is test data here, not a default
 * anywhere: the application holds no scale until one is entered.
 */
const row = (score: number, name: string, feed: number | null, health = false, medication = false, over: Partial<ScaleRow> = {}): ScaleRow => ({
  breed_id: null, is_active: true, score, score_name: name, indicators: null, required_action: null, feed_kg_per_day: feed,
  health_assessment_required: health, medication_review: medication, ...over,
});
const sop: ScaleRow[] = [
  row(1, 'Very thin', 4, true, true),
  row(2, 'Below normal', 3.5, true),
  row(3, 'Normal / ideal', 3),
  row(4, 'Overfat', 2.5),
  row(5, 'Obese', 2.3),
];
const setup = (over: Partial<ConditionSetup> = {}): ConditionSetup => ({
  bcs_frequency_days: 30, bcs_grace_days: 3, bcs_reminder_days: 5, bcs_allow_feed_override: false, bcs_override_reason_required: true, ...over,
});
const assess = (over: object = {}) => assessmentIssues({ scale: sop, score: 3, setup: setup(), assessedOn: '2026-11-02', today: '2026-11-02', latestOn: null, boarEntryDate: '2025-01-06', ...over });

describe('scaleFor', () => {
  it('is the line\'s own active scale when it has one, else the company default, in score order', () => {
    const own = [row(2, 'B', 1, false, false, { breed_id: 'z' }), row(1, 'A', 2, false, false, { breed_id: 'z' })];
    expect(scaleFor([...sop, ...own], 'z').map((r) => r.score)).toEqual([1, 2]);
    expect(scaleFor([...sop, ...own], 'other').map((r) => r.score)).toEqual([1, 2, 3, 4, 5]);
    expect(scaleFor(own, 'other')).toEqual([]);
  });

  it('does not read a row that is switched off', () => {
    expect(scaleFor([row(1, 'A', 1), row(2, 'B', 1, false, false, { is_active: false })], null).map((r) => r.score)).toEqual([1]);
  });
});

describe('conditionStatus: a monthly schedule with 3 days of grace and 5 days of notice', () => {
  const at = (lastAssessedOn: string | null, today: string, s = setup()) => conditionStatus({ lastAssessedOn, setup: s, today });

  it('is never when a boar has not been assessed', () => {
    expect(at(null, '2026-11-02')).toEqual({ status: 'NEVER', due: null, daysToDue: null });
  });

  it('is fine, then due soon, then due, then overdue as the days pass', () => {
    expect(at('2026-10-01', '2026-10-10')).toEqual({ status: 'OK', due: '2026-10-31', daysToDue: 21 });
    expect(at('2026-10-01', '2026-10-26').status).toBe('DUE_SOON'); // 5 days to go
    expect(at('2026-10-01', '2026-10-25').status).toBe('OK'); // 6 days to go
    expect(at('2026-10-01', '2026-10-31').status).toBe('DUE'); // the day
    expect(at('2026-10-01', '2026-11-03').status).toBe('DUE'); // 3 days late: still within the grace
    expect(at('2026-10-01', '2026-11-04')).toEqual({ status: 'OVERDUE', due: '2026-10-31', daysToDue: -4 });
  });

  it('reads the line\'s current frequency, so a change applies to every boar', () => {
    expect(at('2026-10-01', '2026-10-20', setup({ bcs_frequency_days: 14 })).status).toBe('OVERDUE');
  });

  it('has no schedule, and so no due or overdue, when the line sets no frequency', () => {
    expect(at('2026-10-01', '2027-10-01', setup({ bcs_frequency_days: null }))).toEqual({ status: 'NOT_SCHEDULED', due: null, daysToDue: null });
    expect(conditionStatus({ lastAssessedOn: '2026-10-01', setup: null, today: '2026-11-02' }).status).toBe('NOT_SCHEDULED');
  });

  it('treats no grace and no reminder as none', () => {
    const s = setup({ bcs_grace_days: null, bcs_reminder_days: null });
    expect(at('2026-10-01', '2026-10-30', s).status).toBe('OK');
    expect(at('2026-10-01', '2026-11-01', s).status).toBe('OVERDUE');
  });
});

describe('nextDueDate', () => {
  it('is the last assessment plus the frequency, or nothing without one', () => {
    expect(nextDueDate('2026-11-02', 30)).toBe('2026-12-02');
    expect(nextDueDate('2026-11-02', null)).toBeNull();
    expect(nextDueDate('2026-11-02', 0)).toBeNull();
  });
});

describe('assessmentIssues', () => {
  it('accepts a score on the scale, dated today', () => {
    expect(assess()).toEqual([]);
  });

  it('refuses everything when there is no scale: no scale is made up', () => {
    expect(assess({ scale: [] })).toEqual(["No body condition scale is set up for this boar's line or for the company. Add one under Body Condition Scale."]);
  });

  it('refuses a score the scale does not have, naming the ones it has', () => {
    expect(assess({ score: 6 })).toEqual(["Score 6 is not on this line's scale (1, 2, 3, 4, 5)."]);
    expect(assess({ score: 0 })).toHaveLength(1);
  });

  it('refuses a future date, one before the boar entered, and one before or on his latest assessment', () => {
    expect(assess({ assessedOn: '2026-11-03' })).toContain('The assessment date cannot be in the future.');
    expect(assess({ assessedOn: '2024-12-31' })).toContain('The boar entered on 2025-01-06; he cannot be assessed before that.');
    expect(assess({ latestOn: '2026-11-02' })).toEqual(['The boar was already assessed on 2026-11-02.']);
    expect(assess({ latestOn: '2026-11-05', assessedOn: '2026-11-02', today: '2026-11-06' })).toEqual(['His latest assessment is on 2026-11-05; a new one cannot be dated before it.']);
  });

  it('refuses a feed override on a line that sets feed from the scale', () => {
    expect(assess({ feedOverride: 3.2 })).toEqual(['This line sets the feed level from the scale; it cannot be overridden.']);
  });

  it('allows an override where the line allows it, with a reason where the line asks for one', () => {
    const open = setup({ bcs_allow_feed_override: true });
    expect(assess({ setup: open, feedOverride: 3.2 })).toEqual(["Give the reason for changing the feed level from the scale's."]);
    expect(assess({ setup: open, feedOverride: 3.2, overrideReason: 'recovering from lameness' })).toEqual([]);
    expect(assess({ setup: setup({ bcs_allow_feed_override: true, bcs_override_reason_required: false }), feedOverride: 3.2 })).toEqual([]);
    expect(assess({ setup: open, feedOverride: 0, overrideReason: 'x' })).toEqual(['The feed level must be above 0 kg a day.']);
  });

  it('does not treat the scale\'s own feed level as an override', () => {
    expect(assess({ feedOverride: 3 })).toEqual([]);
  });
});

describe('feedSet', () => {
  it('is the scale\'s feed level for a score, as the SOP gives it', () => {
    expect(sop.map((r) => feedSet({ scaleFeed: r.feed_kg_per_day, previous: 3 }).feed)).toEqual([4, 3.5, 3, 2.5, 2.3]);
  });
  it('is the override when it differs from the scale\'s', () => {
    expect(feedSet({ scaleFeed: 3, override: 3.4, previous: 3 })).toEqual({ feed: 3.4, overridden: true });
    expect(feedSet({ scaleFeed: 3, override: 3, previous: 3 })).toEqual({ feed: 3, overridden: false });
  });
  it('keeps what it was when the score sets no feed level', () => {
    expect(feedSet({ scaleFeed: null, previous: 2.8 })).toEqual({ feed: 2.8, overridden: false });
    expect(feedSet({ scaleFeed: null, previous: null })).toEqual({ feed: null, overridden: false });
  });
});

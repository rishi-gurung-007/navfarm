import {
  DueLine, isLineDue, stageDayStatus, pendingDays, datesBetween, weekdayOf,
} from './day-completeness';

const line = (over: Partial<DueLine> = {}): DueLine => ({
  line_id: 'l1', stage_id: 's1', occurrence: 'DAILY',
  start_day: 1, end_day: null, day_of_week: null, is_mandatory: true, ...over,
});

// 2026-09-01 is a Tuesday (ISO weekday 2).
const FROM = '2026-09-01';

describe('isLineDue', () => {
  it('counts the scheduler\'s own start as day 1', () => {
    expect(isLineDue(line({ occurrence: 'ONCE', start_day: 1 }), FROM, '2026-09-01')).toBe(true);
    expect(isLineDue(line({ occurrence: 'ONCE', start_day: 1 }), FROM, '2026-09-02')).toBe(false);
  });

  it('is never due before the scheduler starts', () => {
    expect(isLineDue(line(), FROM, '2026-08-31')).toBe(false);
  });

  it('respects the day range', () => {
    const l = line({ start_day: 3, end_day: 5 });
    expect(isLineDue(l, FROM, '2026-09-02')).toBe(false); // day 2
    expect(isLineDue(l, FROM, '2026-09-03')).toBe(true);  // day 3
    expect(isLineDue(l, FROM, '2026-09-05')).toBe(true);  // day 5
    expect(isLineDue(l, FROM, '2026-09-06')).toBe(false); // day 6
  });

  it('a daily line with no end runs on', () => {
    expect(isLineDue(line(), FROM, '2027-03-14')).toBe(true);
  });

  it('a weekly line comes due on its stated weekday', () => {
    const thursday = line({ occurrence: 'WEEKLY', day_of_week: 4 });
    expect(isLineDue(thursday, FROM, '2026-09-03')).toBe(true);  // Thu
    expect(isLineDue(thursday, FROM, '2026-09-04')).toBe(false); // Fri
    expect(isLineDue(thursday, FROM, '2026-09-10')).toBe(true);  // Thu again
  });

  // A weekly line with no weekday would otherwise never come due at all, which
  // silently drops a scheduled activity.
  it('a weekly line with no weekday recurs on the day it started', () => {
    const l = line({ occurrence: 'WEEKLY', day_of_week: null });
    expect(weekdayOf(FROM)).toBe(2);
    expect(isLineDue(l, FROM, '2026-09-08')).toBe(true);  // next Tuesday
    expect(isLineDue(l, FROM, '2026-09-09')).toBe(false);
  });

  // An unreadable schedule must not hide a feed line: a spurious row on the
  // form is a smaller problem than a missing record.
  it('treats an unrecognised occurrence as daily', () => {
    expect(isLineDue(line({ occurrence: 'FORTNIGHTLY' }), FROM, '2026-09-04')).toBe(true);
  });

  it('leaves CUSTOM to its own day list rather than guessing', () => {
    expect(isLineDue(line({ occurrence: 'CUSTOM' }), FROM, '2026-09-04')).toBe(false);
  });
});

describe('stageDayStatus', () => {
  const lines = [
    line({ line_id: 'feed', stage_id: 'gest', is_mandatory: true }),
    line({ line_id: 'water', stage_id: 'gest', is_mandatory: true }),
    line({ line_id: 'weigh', stage_id: 'gest', is_mandatory: false }),
    line({ line_id: 'farrow-feed', stage_id: 'farrow', is_mandatory: true }),
  ];

  it('ticks a stage once every mandatory line is answered', () => {
    const s = stageDayStatus(lines, FROM, '2026-09-02', new Set(['feed', 'water']));
    const gest = s.find((x) => x.stage_id === 'gest')!;
    expect(gest).toEqual(expect.objectContaining({
      due: 3, mandatory: 2, mandatoryEntered: 2, entered: 2, complete: true,
    }));
  });

  it('an optional line left blank does not hold the day open', () => {
    const gest = stageDayStatus(lines, FROM, '2026-09-02', new Set(['feed', 'water']))
      .find((x) => x.stage_id === 'gest')!;
    expect(gest.complete).toBe(true);
    expect(gest.entered).toBeLessThan(gest.due);
  });

  it('a missing mandatory line keeps the stage pending', () => {
    const gest = stageDayStatus(lines, FROM, '2026-09-02', new Set(['feed', 'weigh']))
      .find((x) => x.stage_id === 'gest')!;
    expect(gest.complete).toBe(false);
  });

  it('reports each stage separately', () => {
    const s = stageDayStatus(lines, FROM, '2026-09-02', new Set(['feed', 'water']));
    expect(s.map((x) => [x.stage_id, x.complete]).sort())
      .toEqual([['farrow', false], ['gest', true]]);
  });

  it('leaves out a stage with nothing due that day', () => {
    const once = [line({ line_id: 'x', stage_id: 'quarantine', occurrence: 'ONCE', start_day: 1 })];
    expect(stageDayStatus(once, FROM, '2026-09-05', new Set())).toEqual([]);
  });
});

describe('pendingDays', () => {
  const lines = [line({ line_id: 'feed', stage_id: 'gest', is_mandatory: true })];

  it('reaches back to the batch start, oldest first', () => {
    const entered = new Map([['2026-09-02', new Set(['feed'])]]);
    expect(pendingDays(lines, FROM, FROM, '2026-09-04', entered))
      .toEqual(['2026-09-01', '2026-09-03', '2026-09-04']);
  });

  it('is empty when every day is answered', () => {
    const entered = new Map(
      ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => [d, new Set(['feed'])]),
    );
    expect(pendingDays(lines, FROM, FROM, '2026-09-03', entered)).toEqual([]);
  });

  // A day on which nothing was scheduled had no work; it is not a hole.
  it('does not count a day with nothing due as pending', () => {
    const once = [line({ line_id: 'x', occurrence: 'ONCE', start_day: 1 })];
    const entered = new Map([['2026-09-01', new Set(['x'])]]);
    expect(pendingDays(once, FROM, FROM, '2026-09-05', entered)).toEqual([]);
  });
});

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-09-01', '2026-09-03'))
      .toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('crosses a month boundary', () => {
    expect(datesBetween('2026-08-30', '2026-09-02'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

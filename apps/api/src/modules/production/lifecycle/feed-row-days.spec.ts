import { DAYS_PER_UNIT, FeedRow, feedRowFor, stageDayRange } from './feed-row-days';

describe('stageDayRange', () => {
  it('DAY units map 1:1 onto stage days', () => {
    expect(stageDayRange('DAY', 25, 27)).toEqual({ fromDay: 25, toDay: 27 });
  });

  it('WEEK 2-3 covers stage days 8-21 (week 1 = days 1-7)', () => {
    expect(stageDayRange('WEEK', 2, 3)).toEqual({ fromDay: 8, toDay: 21 });
  });

  it('MONTH 1-1 covers stage days 1-30 (Rishi: MONTH = 30 days, 2026-09-25)', () => {
    expect(stageDayRange('MONTH', 1, 1)).toEqual({ fromDay: 1, toDay: 30 });
  });

  it('throws naming the value for a calc_unit outside DAY/WEEK/MONTH', () => {
    expect(() => stageDayRange('QUARTER', 1, 1)).toThrow(/QUARTER/);
  });
});

describe('DAYS_PER_UNIT', () => {
  it('is DAY=1, WEEK=7, MONTH=30', () => {
    expect(DAYS_PER_UNIT).toEqual({ DAY: 1, WEEK: 7, MONTH: 30 });
  });
});

describe('feedRowFor', () => {
  const r1: FeedRow = {
    lifecycleId: 'lc-1', breedId: 'breed-1', stageId: 'stage-1', itemId: 'item-r1',
    itemName: 'Starter R1', fromDay: 1, toDay: 27, kgPerHeadPerDay: 0.5, wastagePct: 2,
  };
  const r2: FeedRow = {
    lifecycleId: 'lc-2', breedId: 'breed-1', stageId: 'stage-1', itemId: 'item-r2',
    itemName: 'Grower R2', fromDay: 28, toDay: 30, kgPerHeadPerDay: 0.9, wastagePct: 2,
  };

  it('picks R1 on day 27 (the last day R1 covers)', () => {
    expect(feedRowFor([r1, r2], 27)).toEqual({ row: r1 });
  });

  it('picks R2 on day 28 (the first day R2 covers)', () => {
    expect(feedRowFor([r1, r2], 28)).toEqual({ row: r2 });
  });

  it('returns NONE on day 32 — past every row', () => {
    expect(feedRowFor([r1, r2], 32)).toEqual({ error: 'NONE' });
  });

  it('returns OVERLAP when two rows both cover day 26', () => {
    const overlapping: FeedRow = { ...r2, lifecycleId: 'lc-3', fromDay: 20, toDay: 30 };
    expect(feedRowFor([r1, overlapping], 26)).toEqual({ error: 'OVERLAP' });
  });
});

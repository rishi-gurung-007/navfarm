import { postingDateRangeIssue } from './journal-date-range';

describe('postingDateRangeIssue', () => {
  it('accepts no range, one end, or a range (ends inclusive, so one day is fine)', () => {
    expect(postingDateRangeIssue()).toBeNull();
    expect(postingDateRangeIssue('2026-10-01')).toBeNull();
    expect(postingDateRangeIssue(undefined, '2026-10-31')).toBeNull();
    expect(postingDateRangeIssue('2026-10-01', '2026-10-31')).toBeNull();
    expect(postingDateRangeIssue('2026-10-15', '2026-10-15')).toBeNull();
  });

  it('refuses a range that runs backwards', () => {
    expect(postingDateRangeIssue('2026-11-01', '2026-10-01')).toContain('cannot be after');
  });

  it('refuses what is not a real date', () => {
    expect(postingDateRangeIssue('2026-02-30')).toContain('"from"');
    expect(postingDateRangeIssue(undefined, 'soon')).toContain('"to"');
  });
});

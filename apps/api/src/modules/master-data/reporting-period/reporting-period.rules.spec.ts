import { businessYearOf, generateBusinessYear, lastSaturdayOfMonth, periodProblems, periodsOverlap, weekdayOf } from './reporting-period.rules';

describe('Reporting Period rules (D20)', () => {
  it('finds the month-end Saturday', () => {
    expect(lastSaturdayOfMonth(2026, 9)).toBe('2026-09-26');
    expect(lastSaturdayOfMonth(2026, 6)).toBe('2026-06-27');
    expect(lastSaturdayOfMonth(2026, 10)).toBe('2026-10-31'); // the last day itself is a Saturday
    expect(lastSaturdayOfMonth(2027, 1)).toBe('2027-01-30');
    expect(weekdayOf('2026-09-26')).toBe(6);
  });

  it('names the July–June business year', () => {
    expect(businessYearOf('2026-07-25')).toBe('2026-27');
    expect(businessYearOf('2027-06-26')).toBe('2026-27');
    expect(businessYearOf('2026-06-27')).toBe('2025-26');
  });

  it('generates twelve contiguous periods, July to June, each ending on its month-end Saturday (Q9)', () => {
    const year = generateBusinessYear(2026);
    expect(year).toHaveLength(12);
    expect(year[0]).toEqual({
      period_code: '2026-07', business_year: '2026-27', start_date: '2026-06-28', end_date: '2026-07-25',
      stock_take_date: '2026-07-25', production_start_date: '2026-07-26',
    });
    // September 2026: the workbook's stock-take day (26 Sep) and production start (27 Sep); its illustrative start
    // (23 Aug) does not follow the month-end-Saturday rule for August, which gives 30 Aug.
    expect(year[2]).toEqual({
      period_code: '2026-09', business_year: '2026-27', start_date: '2026-08-30', end_date: '2026-09-26',
      stock_take_date: '2026-09-26', production_start_date: '2026-09-27',
    });
    expect(year[11]).toMatchObject({ period_code: '2027-06', end_date: '2027-06-26' });
    for (let i = 1; i < 12; i++) {
      const [y, m, d] = year[i - 1].end_date.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      expect(year[i].start_date).toBe(next);
      expect(weekdayOf(year[i].end_date)).toBe(6);
    }
  });

  it('checks a period by hand (Q10)', () => {
    const ok = { period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26' };
    expect(periodProblems(ok)).toEqual([]);
    expect(periodProblems({ ...ok, end_date: '2026-09-25' })).toContain('End Date must be a Saturday (the month-end stock-take Saturday).');
    expect(periodProblems({ ...ok, start_date: '2026-09-27' })).toContain('End Date must be on or after Start Date.');
    expect(periodProblems({ ...ok, stock_take_date: '2026-09-27' })).toContain('Stock Take Date must fall within the period.');
    expect(periodProblems({ ...ok, start_date: '2026-02-31' })).toContain('Start Date must be a calendar date (YYYY-MM-DD).');
    expect(periodProblems({ ...ok, period_code: 'sep 2026' })).toContain('Period Code may use letters, digits and hyphens only, up to 20.');
  });

  it('knows when two periods overlap', () => {
    expect(periodsOverlap({ start_date: '2026-08-30', end_date: '2026-09-26' }, { start_date: '2026-09-26', end_date: '2026-10-31' })).toBe(true);
    expect(periodsOverlap({ start_date: '2026-08-30', end_date: '2026-09-26' }, { start_date: '2026-09-27', end_date: '2026-10-31' })).toBe(false);
  });
});

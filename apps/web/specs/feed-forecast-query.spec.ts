import { businessYearStartOf, forecastQueryString } from '../src/components/console/inventory/feed-forecast-query';

const base = { farmId: 'farm-1', view: 'CUSTOM' as const, planningDate: '', from: '', to: '', periodId: '' };

describe('forecastQueryString', () => {
  it('leaves blank fields to the API, so the planning date is the farm\'s today (D16)', () => {
    expect(forecastQueryString(base)).toBe('farmId=farm-1&view=CUSTOM');
  });
  it('sends what the user picked, per view', () => {
    expect(forecastQueryString({ ...base, planningDate: '2026-09-19', from: '2026-09-20', to: '2026-09-27' }))
      .toBe('farmId=farm-1&view=CUSTOM&planningDate=2026-09-19&from=2026-09-20&to=2026-09-27');
    expect(forecastQueryString({ ...base, view: 'WEEKLY', from: '2026-09-20', to: '2026-09-27' })).toBe('farmId=farm-1&view=WEEKLY&from=2026-09-20');
    expect(forecastQueryString({ ...base, view: 'PERIOD', from: '2026-09-20', periodId: 'p9' })).toBe('farmId=farm-1&view=PERIOD&periodId=p9');
  });
});

describe('businessYearStartOf (checkpoint 40, July–June)', () => {
  it('starts the year in July', () => {
    expect(businessYearStartOf('2026-09-23')).toBe(2026);
    // Not a naive "July 1" cutoff: 2027's business year actually starts the
    // day after June 2027's own last Saturday (26 June), so 30 June 2027 is
    // already inside the 2027 business year — see the fix-7 test below.
    expect(businessYearStartOf('2027-06-25')).toBe(2026);
    expect(businessYearStartOf('2026-07-01')).toBe(2026);
  });

  // Final review fix 7: the generator's July period actually starts the day
  // after June's LAST SATURDAY (reporting-period.rules.ts lastSaturdayOfMonth),
  // not on 1 July. In 2026 that Saturday is 27 June, so 28–30 June already
  // belong to the new business year — mirrored here since web cannot import
  // api code.
  it('maps 28-30 June 2026 (after June\'s last Saturday) to the new business year', () => {
    expect(businessYearStartOf('2026-06-27')).toBe(2025); // June's last Saturday itself: still the old year
    expect(businessYearStartOf('2026-06-28')).toBe(2026); // the day after: new year already
    expect(businessYearStartOf('2026-06-29')).toBe(2026);
    expect(businessYearStartOf('2026-06-30')).toBe(2026);
  });
});

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
    expect(businessYearStartOf('2027-06-30')).toBe(2026);
    expect(businessYearStartOf('2026-07-01')).toBe(2026);
  });
});

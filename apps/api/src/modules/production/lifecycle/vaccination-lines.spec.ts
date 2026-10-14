import { wantedVaccinations } from './vaccination-lines';

const vac = (weeks: number, over: Record<string, unknown> = {}) =>
  ({ vaccine_item_id: 'v1', trigger_type: 'AGE_WEEKS', trigger_value: weeks, dose_ml: 2, route: 'IM', ...over });

describe('wantedVaccinations — AGE_WEEKS from the date of birth (Rishi, 14 Oct)', () => {
  it('puts age W weeks on date of birth + 7W days, as a stage day from the stage entry', () => {
    // born 1 Sep, entered the stage 29 Sep (age 4 weeks): age 6 weeks = 13 Oct = stage day 15
    expect(wantedVaccinations([vac(6)], '2026-09-01', '2026-09-29', 43)).toEqual([{ itemId: 'v1', day: 15, doseMl: 2, weeks: 6 }]);
  });
  it('drops a vaccination due before the stage starts or after it ends', () => {
    expect(wantedVaccinations([vac(2), vac(30)], '2026-09-01', '2026-09-29', 43)).toEqual([]);
  });
  it('keeps one due on day 1 and on the last day', () => {
    expect(wantedVaccinations([vac(4), vac(10)], '2026-09-01', '2026-09-29', 43).map((v) => v.day)).toEqual([1, 43]);
  });
  it('schedules nothing without a date of birth, and ignores other triggers', () => {
    expect(wantedVaccinations([vac(6)], null, '2026-09-29', 43)).toEqual([]);
    expect(wantedVaccinations([vac(6, { trigger_type: 'WEEKS_PREGNANT' }), vac(6, { trigger_type: 'PER_CYCLE' })], '2026-09-01', '2026-09-29', 43)).toEqual([]);
  });
  it('has no end limit for a stage without a duration, and reads a blank dose as none', () => {
    expect(wantedVaccinations([vac(52, { dose_ml: '' })], '2026-01-01', '2026-02-01', null)).toEqual([{ itemId: 'v1', day: 334, doseMl: null, weeks: 52 }]);
  });
});

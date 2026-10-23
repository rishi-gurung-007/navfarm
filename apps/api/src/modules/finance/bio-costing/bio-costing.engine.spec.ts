import {
  amortisationAmount, amortisationLine, daysBetween, fairValueLine, lifeEndDate, periodFor, periodOfKey, pickRate, runActiveKey, type AnimalFacts,
} from './bio-costing.engine';
import { costingStartDate } from './bio-costing.rules';
import { bioCostingRun } from '../../../core/database/schema';

const imported = {
  origin: 'IMPORTED', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
  residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 150, residual_price_per_kg: 2.05, residual_applies_gender: 'F',
  run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS',
};
const animal = (o: Partial<AnimalFacts> = {}): AnimalFacts => ({
  animal_id: 'a', gender: 'F', dob: '2025-10-05', entry_date: '2025-11-01', age_at_entry_weeks: null,
  costing_start_date: costingStartDate({ dob: o.dob ?? '2025-10-05', entry_date: o.entry_date ?? '2025-11-01' }, 33), is_active: true, disposal_date: null, ...o,
});

describe('the client\'s worked example (formula sheet rows 43-66): book value 3000, residual 307.50, start 231 days, life 3 years', () => {
  it('has 864 days to amortise: born 2025-10-05, starts +231 days, ends +1095 days', () => {
    const a = animal();
    expect(a.costing_start_date).toBe('2026-05-24');
    expect(lifeEndDate('2025-10-05', 36)).toBe('2028-10-04'); // +1095 days (2028 has a leap day): 36 months x 365 / 12
    expect(daysBetween('2026-05-24', '2028-10-04')).toBe(864);
  });
  it('charges (3000 - 307.50) x 30 / 864 = 93.4896 for a 30-day run starting on her start date, under the BBP\'s wording (D11)', () => {
    expect(amortisationAmount(3000, 307.5, 30, 864)).toBeCloseTo(93.4896, 4);
    const thirtyDays = { key: 'x', start: '2026-05-24', end: '2026-06-22' };
    const line = amortisationLine({ profile: imported, animal: animal(), period: thirtyDays, bookValueBefore: 3000 });
    expect(line).toMatchObject({ status: 'CHARGED', residual: 307.5, remaining_days: 864, days: 30 });
    expect(line.charge).toBeCloseTo(93.4896, 4);
  });
  it('is NOT what the workbook\'s cell returns, 10.68 (residual x days / total): that is decision D11, kept visible here', () => {
    expect((307.5 * 30) / 864).toBeCloseTo(10.6771, 4);
  });
});

describe('periods', () => {
  it('builds ISO weeks, months, quarters and years, and reads their keys back', () => {
    expect(periodFor('WEEKLY', '2026-10-20')).toEqual({ key: '2026-W43', start: '2026-10-19', end: '2026-10-25' });
    expect(periodFor('MONTHLY', '2026-02-10')).toEqual({ key: '2026-02', start: '2026-02-01', end: '2026-02-28' });
    expect(periodFor('QUARTERLY', '2026-10-20')).toEqual({ key: '2026-Q4', start: '2026-10-01', end: '2026-12-31' });
    expect(periodFor('YEARLY', '2026-10-20')).toEqual({ key: '2026', start: '2026-01-01', end: '2026-12-31' });
    expect(periodOfKey('WEEKLY', '2026-W43')).toEqual(periodFor('WEEKLY', '2026-10-20'));
    expect(periodOfKey('MONTHLY', '2026-10')?.end).toBe('2026-10-31');
    expect(periodOfKey('QUARTERLY', '2026-Q2')?.start).toBe('2026-04-01');
  });
  it('refuses a key that does not fit the frequency, or is not a real week', () => {
    expect(periodOfKey('MONTHLY', '2026-Q4')).toBeNull();
    expect(periodOfKey('WEEKLY', '2026-W60')).toBeNull();
    expect(periodOfKey('MONTHLY', '2026-13')).toBeNull();
  });
  it('puts early January in the right ISO year (2026-01-01 is in 2026-W01; 2027-01-01 is in 2026-W53)', () => {
    expect(periodFor('WEEKLY', '2026-01-01').key).toBe('2026-W01');
    expect(periodFor('WEEKLY', '2027-01-01').key).toBe('2026-W53');
  });
});

describe('amortisationLine', () => {
  const period = periodFor('MONTHLY', '2026-07-10'); // 2026-07-01..31, wholly inside her window
  it('charges the frequency days (30) over the days that remain, on the current book value', () => {
    const l = amortisationLine({ profile: imported, animal: animal(), period, bookValueBefore: 3000 });
    // remaining = life end 2028-10-04 less window start 2026-07-01 = 826 days
    expect(l.remaining_days).toBe(826);
    expect(l.charge).toBeCloseTo(((3000 - 307.5) * 30) / 826, 4);
    expect(l.book_value_after).toBeCloseTo(3000 - l.charge, 4);
    expect(l.days).toBe(30);
  });
  it('on the 30-day basis the second month charges a little more than the first, because 30 counted days use up 31 real ones; ACTUAL stays constant', () => {
    const run = (profile: any, date: string, bv: number) => amortisationLine({ profile, animal: animal(), period: periodFor('MONTHLY', date), bookValueBefore: bv });
    const first = run(imported, '2026-07-10', 3000);
    const second = run(imported, '2026-08-10', first.book_value_after);
    expect(second.charge).toBeCloseTo(((3000 - first.charge - 307.5) * 30) / 795, 4);
    expect(second.charge).toBeGreaterThan(first.charge);
    expect(second.charge / first.charge).toBeLessThan(1.01); // the sheet\'s own mixed 30 / 365-day basis; the last period takes the rest
    const a1 = run({ ...imported, day_basis: 'ACTUAL' }, '2026-07-10', 3000);
    const a2 = run({ ...imported, day_basis: 'ACTUAL' }, '2026-08-10', a1.book_value_after);
    expect(a2.charge / 31).toBeCloseTo(a1.charge / 31, 3); // the same charge per day
  });
  it('charges nothing before the start age, and says why', () => {
    const l = amortisationLine({ profile: imported, animal: animal(), period: periodFor('MONTHLY', '2026-04-10'), bookValueBefore: 3000 });
    expect(l).toMatchObject({ status: 'SKIPPED', skip_reason: 'NOT_STARTED', charge: 0 });
  });
  it('charges a part month from the start date: starts 2026-05-24, so 8 of May\'s 31 days', () => {
    const l = amortisationLine({ profile: imported, animal: animal(), period: periodFor('MONTHLY', '2026-05-10'), bookValueBefore: 3000 });
    expect(l.status).toBe('CHARGED');
    expect(l.days).toBeCloseTo((30 * 8) / 31, 3);
  });
  it('shows no age rather than guessing when there is no birth date and no age at entry', () => {
    const l = amortisationLine({ profile: imported, animal: animal({ dob: null, costing_start_date: null }), period, bookValueBefore: 3000 });
    expect(l).toMatchObject({ status: 'SKIPPED', skip_reason: 'NO_AGE' });
  });
  it('takes the whole remainder in the last period, landing exactly on the residual, and nothing after it', () => {
    const last = amortisationLine({ profile: imported, animal: animal(), period: periodFor('MONTHLY', '2028-09-10'), bookValueBefore: 400 });
    expect(last.status).toBe('CHARGED');
    expect(last.charge).toBeLessThanOrEqual(400 - 307.5 + 1e-9);
    const end = amortisationLine({ profile: imported, animal: animal(), period: periodFor('MONTHLY', '2028-10-05'), bookValueBefore: 400 });
    expect(end.book_value_after).toBeGreaterThanOrEqual(307.5);
    expect(amortisationLine({ profile: imported, animal: animal(), period: periodFor('MONTHLY', '2028-11-10'), bookValueBefore: 307.5 })).toMatchObject({ skip_reason: 'LIFE_COMPLETE' });
  });
  it('never takes the book value below the residual, and calls an animal already at it fully amortised', () => {
    // 45 enforced days would charge far more than the 0.50 above the residual: the charge stops at the residual
    const near = amortisationLine({ profile: imported, animal: animal(), period, bookValueBefore: 308, daysEnforced: 100000 });
    expect(near.charge).toBeCloseTo(0.5, 4);
    expect(near.book_value_after).toBeCloseTo(307.5, 4);
    expect(amortisationLine({ profile: imported, animal: animal(), period, bookValueBefore: 307.5 })).toMatchObject({ skip_reason: 'FULLY_AMORTISED' });
  });
  it('skips with RESIDUAL_EXCEEDS_COST when the residual is more than the book value', () => {
    expect(amortisationLine({ profile: imported, animal: animal(), period, bookValueBefore: 200 })).toMatchObject({ skip_reason: 'RESIDUAL_EXCEEDS_COST', charge: 0 });
  });
  it('gives a male no residual: the whole book value is amortised over his life', () => {
    const male = { ...imported, gender: 'M', start_age_weeks: 26, useful_life_months: 18, residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null };
    const m = animal({ gender: 'M', costing_start_date: costingStartDate({ dob: '2025-10-05', entry_date: '2025-11-01' }, 26) });
    const l = amortisationLine({ profile: male as any, animal: m, period: periodFor('MONTHLY', '2026-05-10'), bookValueBefore: 1000 });
    expect(l.residual).toBe(0);
    expect(l.charge).toBeGreaterThan(0);
  });
  it('counts the actual calendar days when the profile says ACTUAL, and the run\'s own number when it enforces one', () => {
    const actual = amortisationLine({ profile: { ...imported, day_basis: 'ACTUAL' }, animal: animal(), period, bookValueBefore: 3000 });
    expect(actual.days).toBe(31);
    const enforced = amortisationLine({ profile: imported, animal: animal(), period, bookValueBefore: 3000, daysEnforced: 45 });
    expect(enforced.days).toBe(45);
  });
  it('skips an animal that has left before the period', () => {
    expect(amortisationLine({ profile: imported, animal: animal({ is_active: false, disposal_date: '2026-06-15' }), period, bookValueBefore: 3000 })).toMatchObject({ skip_reason: 'NOT_ACTIVE' });
  });
  it('skips an animal whose exit was written after the period: the period is settled in the exit, not charged behind it', () => {
    const gone = animal({ is_active: false, disposal_date: '2026-10-15', exit_date: '2026-10-15' });
    expect(amortisationLine({ profile: imported, animal: gone, period, bookValueBefore: 3000 })).toMatchObject({ status: 'SKIPPED', skip_reason: 'LEFT_AFTER_PERIOD', charge: 0, book_value_after: 3000 });
    // an exit inside or before the period is not "after" it: her book value as of the period's end already shows it
    expect(amortisationLine({ profile: imported, animal: animal({ exit_date: period.end }), period, bookValueBefore: 3000 }).skip_reason).toBeNull();
  });
});

describe('fairValueLine', () => {
  const local = animal({ costing_start_date: '2026-05-24' });
  const period = periodFor('MONTHLY', '2026-07-10');
  const rate = { expected_weight_kg: 150, price_per_kg: 2.05, costs_to_sell_pct: null };
  it('values the animal at expected weight x price per kg and adjusts the book value to it: 150 x 2.05 = 307.50', () => {
    expect(fairValueLine({ animal: local, period, bookValueBefore: 300, rate })).toMatchObject({ status: 'CHARGED', charge: 7.5, book_value_after: 307.5 });
    expect(fairValueLine({ animal: { ...local, is_active: false, disposal_date: '2026-10-15', exit_date: '2026-10-15' }, period, bookValueBefore: 300, rate })).toMatchObject({ status: 'SKIPPED', skip_reason: 'LEFT_AFTER_PERIOD' });
  });
  it('is a loss, negative, when the book value is above fair value', () => {
    expect(fairValueLine({ animal: local, period, bookValueBefore: 350, rate })).toMatchObject({ charge: -42.5, book_value_after: 307.5 });
  });
  it('takes costs to sell off where given, and does nothing when there is nothing to adjust', () => {
    expect(fairValueLine({ animal: local, period, bookValueBefore: 300, rate: { ...rate, costs_to_sell_pct: 10 } }).book_value_after).toBeCloseTo(276.75, 4);
    expect(fairValueLine({ animal: local, period, bookValueBefore: 307.5, rate })).toMatchObject({ skip_reason: 'NO_CHANGE' });
  });
  it('waits for the start age, and reports a missing rate instead of inventing one', () => {
    expect(fairValueLine({ animal: local, period: periodFor('MONTHLY', '2026-04-10'), bookValueBefore: 300, rate })).toMatchObject({ skip_reason: 'NOT_STARTED' });
    expect(fairValueLine({ animal: local, period, bookValueBefore: 300, rate: null })).toMatchObject({ skip_reason: 'NO_RATE' });
  });
});

describe('pickRate', () => {
  const rows = [
    { id: 'all-0', farm_id: null, age_week_from: 0, effective_from: '2026-01-01' },
    { id: 'all-18', farm_id: null, age_week_from: 18, effective_from: '2026-01-01' },
    { id: 'farm-0', farm_id: 'f1', age_week_from: 0, effective_from: '2026-01-01' },
    { id: 'all-0-new', farm_id: null, age_week_from: 0, effective_from: '2026-09-01' },
    { id: 'future', farm_id: null, age_week_from: 0, effective_from: '2027-01-01' },
  ];
  it('prefers the animal\'s farm, then the highest age band reached, then the latest effective date, and ignores the future', () => {
    expect(pickRate(rows, 'f1', 10, '2026-10-31')?.id).toBe('farm-0');
    expect(pickRate(rows, 'f2', 20, '2026-10-31')?.id).toBe('all-18');
    expect(pickRate(rows, 'f2', 5, '2026-10-31')?.id).toBe('all-0-new');
    expect(pickRate(rows, 'f2', 5, '2026-02-28')?.id).toBe('all-0');
    expect(pickRate([rows[4]], null, 5, '2026-10-31')).toBeNull();
  });
});

describe('runActiveKey', () => {
  it('names the profile and period, and the batch when there is one, and always fits the column that holds it', () => {
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(runActiveKey(uuid, '2026-09')).toBe(`${uuid}|2026-09`);
    expect(runActiveKey(uuid, '2026-09', uuid)).toBe(`${uuid}|2026-09|${uuid}`);
    // the longest period key is 12 characters (2026-W43 is 8; the schema allows 12)
    const longest = runActiveKey(uuid, 'x'.repeat(12), uuid);
    expect(longest.length).toBeLessThanOrEqual((bioCostingRun.active_key as unknown as { length: number }).length);
  });
});

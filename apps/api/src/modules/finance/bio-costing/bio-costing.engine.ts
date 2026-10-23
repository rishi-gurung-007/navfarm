/**
 * The arithmetic of a bio-asset costing run (bio-asset costing, Phase 4). Pure: no database, no clock. Dates are YYYY-MM-DD strings.
 *
 * Where the client's documents decide something it is said so; where they do not it is marked [ours] and awaits the client.
 * The amortisation formula is the BBP's wording, `(carrying amount - residual) x days / total days`; the workbook's own cell, as
 * typed, evaluates to `residual x days / total days` (10.68 for its example, not 93.49) and is decision D11. It is ONE function
 * (amortisationAmount), so the client's answer changes one line.
 */
import { FREQUENCY_DAYS, residualFor, type ProfileTerms } from './bio-costing.rules';

export type Frequency = keyof typeof FREQUENCY_DAYS;
export interface Period { key: string; start: string; end: string }

// ---- dates ---------------------------------------------------------------------------------------------------------------

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
const pad = (n: number) => String(n).padStart(2, '0');
const lastOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0))); // m is 1-12

/** ISO week (Monday to Sunday) of a date: its key, and the Monday and Sunday. */
function isoWeek(date: string): Period {
  const d = utc(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(date, -dow);
  const thursday = utc(addDays(monday, 3));
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / 86_400_000 / 7) + 1;
  return { key: `${year}-W${pad(week)}`, start: monday, end: addDays(monday, 6) };
}

/** The run period that holds `date`: ISO weeks, calendar months, quarters and years [ours, D6]. */
export function periodFor(frequency: string, date: string): Period {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  switch (frequency) {
    case 'WEEKLY': return isoWeek(date);
    case 'MONTHLY': return { key: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: lastOfMonth(y, m) };
    case 'QUARTERLY': {
      const q = Math.floor((m - 1) / 3);
      return { key: `${y}-Q${q + 1}`, start: `${y}-${pad(q * 3 + 1)}-01`, end: lastOfMonth(y, q * 3 + 3) };
    }
    case 'YEARLY': return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
    default: throw new Error(`Unknown run frequency '${frequency}'.`);
  }
}

/** A period given by its key (2026-10, 2026-W42, 2026-Q4, 2026), checked against the frequency; null if it does not fit. */
export function periodOfKey(frequency: string, key: string): Period | null {
  let probe: string | null = null;
  if (frequency === 'MONTHLY' && /^\d{4}-(0[1-9]|1[0-2])$/.test(key)) probe = `${key}-01`;
  else if (frequency === 'YEARLY' && /^\d{4}$/.test(key)) probe = `${key}-01-01`;
  else if (frequency === 'QUARTERLY' && /^\d{4}-Q[1-4]$/.test(key)) probe = `${key.slice(0, 4)}-${pad((Number(key[6]) - 1) * 3 + 1)}-01`;
  else if (frequency === 'WEEKLY' && /^\d{4}-W\d{2}$/.test(key)) {
    const jan4 = `${key.slice(0, 4)}-01-04`; // week 1 holds 4 January
    probe = addDays(isoWeek(jan4).start, (Number(key.slice(6)) - 1) * 7);
  }
  if (!probe) return null;
  const p = periodFor(frequency, probe);
  return p.key === key ? p : null;
}

// ---- an animal's costing window -----------------------------------------------------------------------------------------

export interface AnimalFacts {
  animal_id: string;
  gender: string | null;
  dob: string | null;
  entry_date: string;
  age_at_entry_weeks: number | null;
  costing_start_date: string | null;
  is_active: boolean;
  disposal_date: string | null;
  /** The first day her exit (a death or write-off) was written to her ledger after the period being run, if it was. Her value was settled in it. */
  exit_date?: string | null;
}

/** Her birth date, or the one her age at entry implies. */
export function birthDate(a: Pick<AnimalFacts, 'dob' | 'entry_date' | 'age_at_entry_weeks'>): string | null {
  if (a.dob) return a.dob;
  return a.age_at_entry_weeks != null ? addDays(a.entry_date, -7 * a.age_at_entry_weeks) : null;
}

/** The last day of the useful life, exclusive. The client's sheet counts life from birth in 365-day years: 36 months = 1095 days. */
export function lifeEndDate(birth: string, usefulLifeMonths: number): string {
  return addDays(birth, Math.round((usefulLifeMonths * 365) / 12));
}

// ---- one line ---------------------------------------------------------------------------------------------------------

export type SkipReason =
  | 'NO_AGE' | 'NOT_STARTED' | 'LIFE_COMPLETE' | 'FULLY_AMORTISED' | 'RESIDUAL_EXCEEDS_COST' | 'NOT_ACTIVE' | 'LEFT_AFTER_PERIOD' | 'NO_RATE' | 'NO_CHANGE';

export interface RunLine {
  status: 'CHARGED' | 'SKIPPED';
  skip_reason: SkipReason | null;
  days: number | null;
  remaining_days: number | null;
  book_value_before: number;
  residual: number;
  /** Amortisation: the amount charged (>= 0). Fair value: the adjustment, negative for a loss. */
  charge: number;
  book_value_after: number;
  costing_start_date: string | null;
  life_end_date: string | null;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const TOL = 0.005;

const skip = (reason: SkipReason, bv: number, extra: Partial<RunLine> = {}): RunLine => ({
  status: 'SKIPPED', skip_reason: reason, days: null, remaining_days: null, book_value_before: r4(bv), residual: 0, charge: 0,
  book_value_after: r4(bv), costing_start_date: null, life_end_date: null, ...extra,
});

/**
 * D11, in one place. The BBP: "Amortizable Amount = Capitalized carrying amount minus residual value. Period amortization shall be
 * calculated using the configured frequency and eligible number of days." The base is the animal's CURRENT book value over the days
 * that remain, which equals the sheet's constant daily charge while nothing changes and absorbs a capitalised cost or a fair-value
 * change over what is left.
 */
export function amortisationAmount(bookValue: number, residual: number, days: number, remainingDays: number): number {
  if (!(remainingDays > 0)) return Math.max(0, bookValue - residual);
  return ((bookValue - residual) * days) / remainingDays;
}

export interface AmortisationInput {
  profile: ProfileTerms & { life?: never };
  animal: AnimalFacts;
  period: Period;
  bookValueBefore: number;
  daysEnforced?: number | null;
  /** The residual to use, already resolved (the animal's own, the company setting, or the profile's). Left out, the profile's. */
  residual?: number;
}

/** An amortisation line for one animal and period, with the BBP's controls (no run before the start, none past life or below residual). */
export function amortisationLine(i: AmortisationInput): RunLine {
  const { profile, animal: a, period } = i;
  const bv = i.bookValueBefore;
  if (!a.is_active && (!a.disposal_date || a.disposal_date <= period.start)) return skip('NOT_ACTIVE', bv);
  // Her exit is already on the books at the value she had when she left, which has this period's amortisation inside it (the loss is larger by that
  // much). Charging the period now would post after the exit and take her below nil, so it is settled in the exit.
  if (a.exit_date && a.exit_date > period.end) return skip('LEFT_AFTER_PERIOD', bv);
  const start = a.costing_start_date;
  const birth = birthDate(a);
  if (!start || !birth) return skip('NO_AGE', bv);
  const lifeEnd = lifeEndDate(birth, Number(profile.useful_life_months));
  const common = { costing_start_date: start, life_end_date: lifeEnd };
  if (period.end < start) return skip('NOT_STARTED', bv, common);
  if (period.start >= lifeEnd) return skip('LIFE_COMPLETE', bv, common);

  const residual = i.residual ?? residualFor(profile, a.gender);
  if (bv < residual - TOL) return skip('RESIDUAL_EXCEEDS_COST', bv, { ...common, residual });
  if (bv - residual <= TOL) return skip('FULLY_AMORTISED', bv, { ...common, residual });

  const windowStart = start > period.start ? start : period.start;
  const lastDay = addDays(lifeEnd, -1);
  const windowEnd = period.end < lastDay ? period.end : lastDay;
  const windowDays = daysBetween(windowStart, windowEnd) + 1;
  const periodDays = daysBetween(period.start, period.end) + 1;
  const remaining = daysBetween(windowStart, lifeEnd);

  // The days this run counts: the run's own number if one is enforced; else the client's frequency days (7/30/90/360) for the part
  // of the period inside her window; else the calendar days inside the window.
  const days = i.daysEnforced != null
    ? i.daysEnforced
    : profile.day_basis === 'ACTUAL' ? windowDays : (FREQUENCY_DAYS[(profile.run_frequency ?? 'MONTHLY') as Frequency] * windowDays) / periodDays;

  const reachesEnd = windowEnd === lastDay;
  const raw = reachesEnd ? bv - residual : amortisationAmount(bv, residual, days, remaining);
  const charge = r4(Math.min(Math.max(0, raw), bv - residual));
  return {
    status: 'CHARGED', skip_reason: null, days: r4(days), remaining_days: remaining, book_value_before: r4(bv), residual,
    charge, book_value_after: r4(bv - charge), ...common,
  };
}

export interface FairValueRate { expected_weight_kg: number; price_per_kg: number; costs_to_sell_pct: number | null }
export interface FairValueInput { animal: AnimalFacts; period: Period; bookValueBefore: number; rate: FairValueRate | null }

/** A fair-value line: expected weight x price per kg (less costs to sell where given), against the book value before. */
export function fairValueLine(i: FairValueInput): RunLine {
  const { animal: a, period } = i;
  const bv = i.bookValueBefore;
  if (!a.is_active && (!a.disposal_date || a.disposal_date <= period.start)) return skip('NOT_ACTIVE', bv);
  // Her exit is already on the books at the value she had when she left, which has this period's amortisation inside it (the loss is larger by that
  // much). Charging the period now would post after the exit and take her below nil, so it is settled in the exit.
  if (a.exit_date && a.exit_date > period.end) return skip('LEFT_AFTER_PERIOD', bv);
  if (!a.costing_start_date) return skip('NO_AGE', bv);
  const common = { costing_start_date: a.costing_start_date };
  if (period.end < a.costing_start_date) return skip('NOT_STARTED', bv, common);
  if (!i.rate) return skip('NO_RATE', bv, common);
  const gross = i.rate.expected_weight_kg * i.rate.price_per_kg;
  const fair = r4(gross * (1 - (i.rate.costs_to_sell_pct ?? 0) / 100));
  const adjustment = r4(fair - bv);
  if (Math.abs(adjustment) < TOL) return skip('NO_CHANGE', bv, common);
  return {
    status: 'CHARGED', skip_reason: null, days: null, remaining_days: null, book_value_before: r4(bv), residual: 0,
    charge: adjustment, book_value_after: fair, costing_start_date: a.costing_start_date, life_end_date: null,
  };
}

/** Which rate applies: the animal's farm beats "every farm", then the highest age band she has reached, then the latest effective date. */
export function pickRate<R extends { farm_id: string | null; age_week_from: number; effective_from: string }>(
  rates: R[], farmId: string | null, ageWeeks: number, periodEnd: string,
): R | null {
  const fit = rates.filter((r) => r.effective_from <= periodEnd && r.age_week_from <= ageWeeks && (r.farm_id === null || r.farm_id === farmId));
  fit.sort((x, y) => Number(y.farm_id !== null) - Number(x.farm_id !== null) || y.age_week_from - x.age_week_from || (y.effective_from > x.effective_from ? 1 : -1));
  return fit[0] ?? null;
}


/** The key that claims a period: one live run per profile and period, or per profile, period and batch when the run is made for one batch. */
export function runActiveKey(profileId: string, periodKey: string, batchId?: string | null): string {
  return batchId ? `${profileId}|${periodKey}|${batchId}` : `${profileId}|${periodKey}`;
}

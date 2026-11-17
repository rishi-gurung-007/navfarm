/**
 * The arithmetic of a weaner or grower lot's fair value (BBP-2 S.NO.6: cost to week 17, fair value from week 18, monthly, per batch). Pure: no database, no clock.
 * The calendar is the lot's item's Fair Value Rates, a central setup the user edits (farm or every farm, from which week of age, expected weight, price per kg, effective
 * date, costs to sell). Fair value of the lot = head x expected weight x price per kg, less costs to sell where given; the adjustment is that against the carrying value.
 */
import { addDays, daysBetween, pickRate, type FairValueRate, type Period } from '../../finance/bio-costing/bio-costing.engine';
import { costingStartDate } from '../../finance/bio-costing/bio-costing.rules';

export type LotSkip = 'NOT_FAIR_VALUE_ITEM' | 'NO_HEAD' | 'NOT_STARTED' | 'NO_RATE' | 'NO_CHANGE' | 'ALREADY_RUN';

export interface LotRate extends FairValueRate {
  farm_id: string | null;
  age_week_from: number;
  effective_from: string;
}

export interface LotFairValueInput {
  /** The lot's item's costing method: only FAIR_VALUE items are valued here. */
  item_method: string | null;
  /** The item's start age (the weeks, and days, of age from which fair value runs). */
  start_age_weeks: number;
  start_age_days?: number | null;
  /** The lot's birth: the date it was made (the farrowing date for a litter's lot). */
  start_date: string;
  farm_id: string | null;
  head: number;
  carrying_value: number;
  period: Period;
  rates: LotRate[];
  /** A fair value already posted to this lot inside the period. */
  already_run: boolean;
}

export interface LotFairValueLine {
  status: 'ADJUST' | 'SKIPPED';
  skip_reason: LotSkip | null;
  age_weeks: number;
  starts_on: string | null;
  carrying_value: number;
  fair_value: number | null;
  /** Fair value less the carrying value: positive is a gain. */
  adjustment: number;
  fair_value_per_head: number | null;
  rate: { expected_weight_kg: number; price_per_kg: number; costs_to_sell_pct: number | null; effective_from: string } | null;
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const TOL = 0.005;

export function lotFairValueLine(i: LotFairValueInput): LotFairValueLine {
  const ageWeeks = Math.max(0, Math.floor(daysBetween(i.start_date, i.period.end) / 7));
  const base = { age_weeks: ageWeeks, starts_on: null as string | null, carrying_value: r4(i.carrying_value), fair_value: null, adjustment: 0, fair_value_per_head: null, rate: null };
  const skip = (reason: LotSkip, extra: Partial<LotFairValueLine> = {}): LotFairValueLine => ({ ...base, status: 'SKIPPED', skip_reason: reason, ...extra });

  if (i.item_method !== 'FAIR_VALUE') return skip('NOT_FAIR_VALUE_ITEM');
  if (!(i.head > 0)) return skip('NO_HEAD');
  // The same start the animals' runs use: birth plus the item's start age. A lot is "born" on the day it was made.
  const starts = costingStartDate({ dob: i.start_date, entry_date: i.start_date }, i.start_age_weeks, i.start_age_days ?? 0);
  if (starts && i.period.end < starts) return skip('NOT_STARTED', { starts_on: starts });
  if (i.already_run) return skip('ALREADY_RUN', { starts_on: starts });
  const rate = pickRate(i.rates, i.farm_id, ageWeeks, i.period.end);
  if (!rate) return skip('NO_RATE', { starts_on: starts });
  const gross = i.head * rate.expected_weight_kg * rate.price_per_kg;
  const fair = r4(gross * (1 - (rate.costs_to_sell_pct ?? 0) / 100));
  const adjustment = r4(fair - i.carrying_value);
  const rateOut = { expected_weight_kg: Number(rate.expected_weight_kg), price_per_kg: Number(rate.price_per_kg), costs_to_sell_pct: rate.costs_to_sell_pct == null ? null : Number(rate.costs_to_sell_pct), effective_from: rate.effective_from };
  if (Math.abs(adjustment) < TOL) return skip('NO_CHANGE', { starts_on: starts, fair_value: fair, rate: rateOut, fair_value_per_head: r4(fair / i.head) });
  return { ...base, status: 'ADJUST', skip_reason: null, starts_on: starts, fair_value: fair, adjustment, fair_value_per_head: fair / i.head, rate: rateOut };
}

export { addDays };

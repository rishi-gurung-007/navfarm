/**
 * Pure arithmetic for the animal card's activity: kept apart from the queries so it can be proved on its own.
 */

import { addDays, birthDate, lifeEndDate } from '../../finance/bio-costing/bio-costing.engine';

export interface Reading {
  date: string;
  value: number;
}

export interface WeightSummary {
  current_weight_kg: number | null;
  current_weight_date: string | null;
  first_weight_kg: number | null;
  first_weight_date: string | null;
  /** Grams per day across the recorded readings; null with fewer than two readings or no days between them. */
  adg_g_per_day: number | null;
}

const DAY_MS = 86_400_000;

/** A reading a day apart can still be on the same calendar date twice; the later one in the list wins. */
export function latestPerDate(readings: Reading[]): Reading[] {
  const byDate = new Map<string, Reading>();
  for (const r of readings) byDate.set(r.date, r);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function summariseWeights(readings: Reading[]): WeightSummary {
  const series = latestPerDate(readings).filter((r) => Number.isFinite(r.value));
  if (series.length === 0) {
    return { current_weight_kg: null, current_weight_date: null, first_weight_kg: null, first_weight_date: null, adg_g_per_day: null };
  }
  const first = series[0];
  const last = series[series.length - 1];
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / DAY_MS;
  return {
    current_weight_kg: last.value,
    current_weight_date: last.date,
    first_weight_kg: first.value,
    first_weight_date: first.date,
    adg_g_per_day: series.length >= 2 && days > 0 ? Math.round(((last.value - first.value) / days) * 1000) : null,
  };
}

export interface ConsumptionRow {
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_type: string | null;
  uom: string | null;
  quantity: number;
  /** Cost is stored as a negative amount on a consumption; the card shows what it cost. */
  amount: number;
  date: string;
}

export interface ConsumptionByItem {
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_type: string | null;
  uom: string | null;
  quantity: number;
  cost: number;
  last_date: string;
}

export function groupConsumption(rows: ConsumptionRow[]): ConsumptionByItem[] {
  const groups = new Map<string, ConsumptionByItem>();
  for (const r of rows) {
    const key = `${r.item_id ?? ''}|${r.uom ?? ''}`;
    const g = groups.get(key) ?? {
      item_id: r.item_id, item_code: r.item_code, item_name: r.item_name, item_type: r.item_type,
      uom: r.uom, quantity: 0, cost: 0, last_date: r.date,
    };
    g.quantity += r.quantity;
    g.cost += Math.abs(r.amount);
    if (r.date > g.last_date) g.last_date = r.date;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost);
}

/**
 * The last day her amortisation can charge: birth + the item's useful life, the same rule the costing run applies (lifeEndDate is exclusive,
 * so the last day is the one before it). Null when the item does not amortise her, has no useful life, or she has no age to count from.
 * A run can stop earlier: at her residual, or when she leaves the herd.
 */
export function amortisationEndDate(
  a: { dob?: string | null; entry_date: string; age_at_entry_weeks?: number | null },
  item: { bio_costing_method?: string | null; bio_useful_life_months?: number | null } | null | undefined,
): string | null {
  if (!item || item.bio_costing_method !== 'AMORTIZATION' || !item.bio_useful_life_months) return null;
  const birth = birthDate({ dob: a.dob ?? null, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks ?? null });
  return birth ? addDays(lifeEndDate(birth, Number(item.bio_useful_life_months)), -1) : null;
}

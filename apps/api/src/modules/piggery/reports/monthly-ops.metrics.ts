import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';

/**
 * The arithmetic of the R12 Monthly Ops report, kept apart from the queries so it can be tested on plain
 * rows. One row is one farm, one accounting month, one breed; Rishi settled the columns on 30 Oct–1 Nov:
 *   - Total Born / Born Alive: piglets of the litters farrowed in the month.
 *   - Farrowing Rate: of the services made one gestation before the month (its dates shifted back by the breed's
 *     gestation days, 115 when the breed has none), the share that farrowed — matched through the litter's own
 *     service, so it counts the same sows and never passes 100 %.
 *   - Avg Wean Weight / Total Litter Mass: the litters weaned in the month, as R07 reads them.
 *   - Empty Days (Rishi, 2 Nov): the total of the days in the month that sows were not productive after farrowing —
 *     from a weaning, or a failed (REPEAT) service's pregnancy check, to the next service, or until she leaves.
 *   - Cull: sows culled in the month.
 *   - CDM: kg (exit weight) of pigs sold to the Colcom customer in the month.
 *   - KG Sold/Sow/Year: kg sold in the month ÷ average sows × (365 ÷ days in the month).
 *   - Standovers %: sows due to farrow in the month (to today) that have not farrowed ÷ sows due.
 *   - Mortality by Category: deaths in the month per Reason Master category, with each one's share.
 *   - Parity Distribution %: sows at each parity 0, 1 … 6+ on the month's last day ÷ all sows.
 */

export const DEFAULT_GESTATION_DAYS = 115;
export const PARITY_BANDS = ['0', '1', '2', '3', '4', '5', '6+'] as const;
export const NO_CATEGORY = 'NOT RECORDED';

export interface OpsFarrowing {
  sow_animal_id: string;
  breeding_id: string | null;
  farrowing_date: string;
  piglets_born_total: number;
  piglets_born_live: number;
  weaning_date: string | null;
  piglets_weaned: number;
  avg_weaning_weight_kg: number | null;
  foster_received?: number;
  fostered_out?: number;
}

export interface OpsService {
  breeding_id: string;
  sow_animal_id: string;
  mating_date: string;
  expected_farrowing_date: string | null;
  conception_result: string | null;
  /** The pregnancy check: for a failed (REPEAT) service, the day she is known to be empty again. */
  preg_check_date?: string | null;
}

export interface OpsSow {
  animal_id: string;
  entry_date: string | null;
  /** The day the sow left the herd (disposal or cull), null while she is still in it. */
  exit_date: string | null;
  cull_date: string | null;
}

export interface OpsSale {
  disposal_date: string;
  exit_weight_kg: number | null;
  is_colcom: boolean;
}

export interface OpsDeath {
  transaction_date: string;
  quantity: number;
  category: string | null;
}

export interface OpsMonth {
  startDate: string;
  /** The month's last day; for the current month, today — the report never counts days still to come. */
  endDate: string;
}

export interface OpsMetrics {
  /** Total sow-days in the month spent empty after farrowing (weaned or failed, not yet served again). */
  empty_days: number;
  /** The sows with at least one such day. */
  empty_sows: number;
  sows_culled: number;
  total_born: number;
  born_alive: number;
  litters_farrowed: number;
  sows_served_one_gestation_earlier: number;
  /** Of those services, the ones that farrowed. */
  services_farrowed: number;
  farrowing_rate_pct: number | null;
  avg_wean_weight_kg: number | null;
  total_litter_mass_kg: number | null;
  litters_weaned: number;
  /** Piglets weaned from the litters weaned in the month. */
  weaned_piglets: number;
  /** Those litters' starting lot: born alive, plus fostered in, less fostered out. */
  weaned_start_lot: number;
  /** Of the litters weaned, those with a weaning weight, and their head. */
  litters_weighed: number;
  weighed_head: number;
  cdm_kg: number;
  kg_sold: number;
  average_sows: number | null;
  kg_sold_per_sow_year: number | null;
  sows_due: number;
  standovers: number;
  standovers_pct: number | null;
  mortality_total: number;
  mortality_by_category: Array<{ category: string; deaths: number; share_pct: number }>;
  sows_on_last_day: number;
  parity_distribution: Array<{ parity: (typeof PARITY_BANDS)[number]; sows: number; share_pct: number }>;
}

const round = (value: number, places = 2) => Number(value.toFixed(places));
const ratio = (num: number, den: number, scale = 1) => (den > 0 ? round((num / den) * scale) : null);
const within = (date: string | null | undefined, m: OpsMonth) => !!date && date >= m.startDate && date <= m.endDate;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Days in the month the report covers: start to end, both counted. */
export function monthDays(m: OpsMonth): number {
  return daysBetween(m.startDate, m.endDate) + 1;
}

/** A sow is in the herd on `day` from her entry date until the day before she leaves. */
function inHerd(sow: OpsSow, day: string): boolean {
  return (!sow.entry_date || sow.entry_date <= day) && (!sow.exit_date || sow.exit_date > day);
}

/** Her litters farrowed on or before `day`: parity 0 is a gilt that has not farrowed yet. */
export function parityOn(sowId: string, day: string, farrowings: OpsFarrowing[]): number {
  return farrowings.filter((f) => f.sow_animal_id === sowId && f.farrowing_date <= day).length;
}

export function computeMonthlyOps(args: {
  month: OpsMonth;
  gestationDays: number;
  /** Every litter of these sows, whenever farrowed: parity and last weaning need their history. */
  farrowings: OpsFarrowing[];
  /** Every service of these sows, whenever made. */
  services: OpsService[];
  sows: OpsSow[];
  sales: OpsSale[];
  deaths: OpsDeath[];
}): OpsMetrics {
  const { month, gestationDays, farrowings, services, sows, sales, deaths } = args;

  // Born
  const farrowed = farrowings.filter((f) => within(f.farrowing_date, month));
  const total_born = farrowed.reduce((a, f) => a + f.piglets_born_total, 0);
  const born_alive = farrowed.reduce((a, f) => a + f.piglets_born_live, 0);

  // Farrowing Rate: the services one gestation earlier, and how many of those very services farrowed.
  const served = { startDate: addDays(month.startDate, -gestationDays), endDate: addDays(month.endDate, -gestationDays) };
  const cohort = services.filter((s) => within(s.mating_date, served));
  const littersOf = new Set(farrowings.map((f) => f.breeding_id).filter(Boolean));
  const cohortFarrowed = cohort.filter((s) => littersOf.has(s.breeding_id)).length;

  // Weaning (as R07): litters weaned in the month with a weight.
  const weaned = farrowings.filter((f) => within(f.weaning_date, month));
  const weighed = weaned.filter((f) => f.piglets_weaned > 0 && f.avg_weaning_weight_kg != null);
  const weanedHead = weighed.reduce((a, f) => a + f.piglets_weaned, 0);
  const litterMass = weighed.reduce((a, f) => a + f.piglets_weaned * (f.avg_weaning_weight_kg as number), 0);

  // Cull: sows culled in the month.
  const culled = sows.filter((s) => within(s.cull_date, month));

  // Empty Days: each sow is empty from a weaning, or a failed service's pregnancy check, until her next service or the
  // day she leaves; a gilt that has not farrowed is not counted. Only the days inside the month add up.
  let empty_days = 0;
  let empty_sows = 0;
  for (const s of sows) {
    const litters = farrowings.filter((f) => f.sow_animal_id === s.animal_id);
    const served = services.filter((x) => x.sow_animal_id === s.animal_id).map((x) => x.mating_date).sort();
    const starts = [
      ...litters.map((f) => f.weaning_date),
      ...services.filter((x) => x.sow_animal_id === s.animal_id && x.conception_result === 'REPEAT').map((x) => x.preg_check_date),
    ].filter((d): d is string => !!d && litters.some((f) => f.farrowing_date <= d));
    let days = 0;
    for (const start of starts) {
      const next = served.find((d) => d >= start);
      const ends = [next, s.exit_date].filter((d): d is string => !!d).sort()[0]; // first day she is no longer empty
      const from = start > month.startDate ? start : month.startDate;
      const toExcl = ends && ends <= month.endDate ? ends : addDays(month.endDate, 1);
      if (toExcl > from) days += daysBetween(from, toExcl);
    }
    if (days > 0) { empty_days += days; empty_sows += 1; }
  }

  // Sales.
  const sold = sales.filter((s) => within(s.disposal_date, month));
  const kg_sold = round(sold.reduce((a, s) => a + (s.exit_weight_kg ?? 0), 0));
  const cdm_kg = round(sold.filter((s) => s.is_colcom).reduce((a, s) => a + (s.exit_weight_kg ?? 0), 0));
  const days = monthDays(month);
  let sowDays = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(month.startDate, i);
    sowDays += sows.filter((s) => inHerd(s, day)).length;
  }
  const average_sows = days > 0 ? round(sowDays / days) : null;

  // Standovers: due in the month (to today), not written off as failed, and no litter from that service.
  const farrowedServices = new Set(farrowings.map((f) => f.breeding_id).filter(Boolean));
  const due = services.filter(
    (s) => within(s.expected_farrowing_date, month) && !['FAILED', 'REPEAT'].includes(s.conception_result ?? ''),
  );
  const standovers = due.filter((s) => !farrowedServices.has(s.breeding_id)).length;

  // Mortality by category.
  const inMonth = deaths.filter((d) => within(d.transaction_date, month));
  const mortality_total = inMonth.reduce((a, d) => a + d.quantity, 0);
  const byCategory = new Map<string, number>();
  for (const d of inMonth) {
    const key = d.category || NO_CATEGORY;
    byCategory.set(key, (byCategory.get(key) ?? 0) + d.quantity);
  }

  // Parity on the month's last day.
  const present = sows.filter((s) => inHerd(s, month.endDate));
  const bands = new Map<string, number>(PARITY_BANDS.map((b) => [b, 0]));
  for (const s of present) {
    const p = parityOn(s.animal_id, month.endDate, farrowings);
    const band = p >= 6 ? '6+' : String(p);
    bands.set(band, (bands.get(band) ?? 0) + 1);
  }

  return {
    empty_days,
    empty_sows,
    sows_culled: culled.length,
    total_born,
    born_alive,
    litters_farrowed: farrowed.length,
    sows_served_one_gestation_earlier: cohort.length,
    services_farrowed: cohortFarrowed,
    farrowing_rate_pct: ratio(cohortFarrowed, cohort.length, 100),
    avg_wean_weight_kg: ratio(litterMass, weanedHead),
    total_litter_mass_kg: weighed.length ? round(litterMass) : null,
    litters_weaned: weaned.length,
    weaned_piglets: weaned.reduce((a, f) => a + f.piglets_weaned, 0),
    weaned_start_lot: weaned.reduce((a, f) => a + f.piglets_born_live + (f.foster_received ?? 0) - (f.fostered_out ?? 0), 0),
    litters_weighed: weighed.length,
    weighed_head: weanedHead,
    cdm_kg,
    kg_sold,
    average_sows,
    kg_sold_per_sow_year: average_sows ? round((kg_sold / average_sows) * (365 / days)) : null,
    sows_due: due.length,
    standovers,
    standovers_pct: ratio(standovers, due.length, 100),
    mortality_total,
    mortality_by_category: [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, n]) => ({ category, deaths: n, share_pct: ratio(n, mortality_total, 100) ?? 0 })),
    sows_on_last_day: present.length,
    parity_distribution: PARITY_BANDS.map((parity) => ({
      parity,
      sows: bands.get(parity) ?? 0,
      share_pct: ratio(bands.get(parity) ?? 0, present.length, 100) ?? 0,
    })),
  };
}

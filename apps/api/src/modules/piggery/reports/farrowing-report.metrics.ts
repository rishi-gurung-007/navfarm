/**
 * The arithmetic of the R07 Farrowing Report, kept apart from the queries so it can be tested on plain rows.
 * Column definitions are Triple-C_reports COMMENTS.xlsx row 6, as Rishi settled them on 18 Oct:
 *   - Farrowing Rate % is the sheet's own formula: sows farrowed ÷ sows served, both within the dates.
 *   - Total Litter Mass is shown both ways ("ALL OR ONE"): the total of every weaned litter, and the average litter.
 *   - Active Week Mortality is the piglet deaths in the current week — the Monday-to-Sunday week holding Date To.
 */

export interface ServiceRow {
  batch_id: string;
  parity_number: number | null;
}

export interface FarrowingRow {
  batch_id: string;
  farrow_id: string;
  piglet_batch_id: string | null;
  piglets_born_total: number;
  piglets_born_live: number;
  piglets_stillborn: number;
  piglets_mummified: number;
  foster_received: number;
  fostered_out: number;
  weaning_date: string | null;
  piglets_weaned: number;
  avg_weaning_weight_kg: number | null;
}

export interface MortalityRow {
  piglet_batch_id: string;
  transaction_date: string;
  quantity: number;
}

export interface FarrowingMetrics {
  sows_served: number;
  sows_farrowed: number;
  farrowing_rate_pct: number | null;
  total_born_per_sow: number | null;
  born_alive_per_sow: number | null;
  born_dead: number;
  mummified: number;
  active_week_mortality: number;
  pre_wean_mortality_pct: number | null;
  avg_weaning_weight_kg: number | null;
  litter_mass_total_kg: number | null;
  litter_mass_avg_kg: number | null;
  gilts_served: number;
  second_parity_served: number;
}

const round = (value: number, places = 2) => Number(value.toFixed(places));
const ratio = (num: number, den: number, scale = 1) => (den > 0 ? round((num / den) * scale) : null);

/** Monday of the week that holds `date` (YYYY-MM-DD), as YYYY-MM-DD. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** The same calendar dates one year earlier; 29 Feb falls back to 28 Feb. */
export function minusOneYear(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const prior = new Date(Date.UTC(y - 1, m - 1, d));
  if (prior.getUTCMonth() !== m - 1) prior.setUTCDate(0);
  return prior.toISOString().slice(0, 10);
}

export function computeFarrowingMetrics(
  services: ServiceRow[],
  farrowings: FarrowingRow[],
  mortality: MortalityRow[],
  dateTo: string,
): FarrowingMetrics {
  const sum = (rows: FarrowingRow[], pick: (r: FarrowingRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const served = services.length;
  const farrowed = farrowings.length;

  // Pre-wean mortality: piglets lost from the litter's lot up to its weaning (or to date, while still nursing),
  // over the lot it started with — born live, plus fostered in, less fostered out.
  const weaningOf = new Map(farrowings.filter((f) => f.piglet_batch_id).map((f) => [f.piglet_batch_id as string, f.weaning_date]));
  const preWeanDeaths = mortality
    .filter((m) => weaningOf.has(m.piglet_batch_id))
    .filter((m) => {
      const weaned = weaningOf.get(m.piglet_batch_id);
      return !weaned || m.transaction_date <= weaned;
    })
    .reduce((acc, m) => acc + m.quantity, 0);
  const startingLot = sum(farrowings, (f) => f.piglets_born_live + f.foster_received - f.fostered_out);

  const activeFrom = weekStart(dateTo);
  const activeWeek = mortality
    .filter((m) => weaningOf.has(m.piglet_batch_id) && m.transaction_date >= activeFrom && m.transaction_date <= dateTo)
    .reduce((acc, m) => acc + m.quantity, 0);

  const weighed = farrowings.filter((f) => f.piglets_weaned > 0 && f.avg_weaning_weight_kg != null);
  const weanedHead = sum(weighed, (f) => f.piglets_weaned);
  const litterMass = sum(weighed, (f) => f.piglets_weaned * (f.avg_weaning_weight_kg as number));

  return {
    sows_served: served,
    sows_farrowed: farrowed,
    farrowing_rate_pct: ratio(farrowed, served, 100),
    total_born_per_sow: ratio(sum(farrowings, (f) => f.piglets_born_total), farrowed),
    born_alive_per_sow: ratio(sum(farrowings, (f) => f.piglets_born_live), farrowed),
    born_dead: sum(farrowings, (f) => f.piglets_stillborn),
    mummified: sum(farrowings, (f) => f.piglets_mummified),
    active_week_mortality: activeWeek,
    pre_wean_mortality_pct: ratio(preWeanDeaths, startingLot, 100),
    avg_weaning_weight_kg: ratio(litterMass, weanedHead),
    litter_mass_total_kg: weighed.length ? round(litterMass) : null,
    litter_mass_avg_kg: ratio(litterMass, weighed.length),
    // breeding_record.parity_number is the litter the service is for: a gilt's first service is litter 1.
    gilts_served: services.filter((s) => s.parity_number === 1).length,
    second_parity_served: services.filter((s) => s.parity_number === 2).length,
  };
}

/** True when a period had nothing recorded at all — the report shows "No data" rather than a row of zeros. */
export function isEmptyPeriod(m: FarrowingMetrics): boolean {
  return m.sows_served === 0 && m.sows_farrowed === 0;
}

/**
 * The KPI each target column reads from breed_lifecycle_stages.kpi_thresholds ([{ metric, lower_limit,
 * upper_limit }]). A breed with no such row shows "Not available" (Rishi, 18 Oct).
 */
export const TARGET_METRICS = {
  service_target: 'SERVICE_TARGET',
  farrowing_target: 'FARROWING_TARGET',
  farrowing_rate: 'FARROWING_RATE',
  total_born: 'TOTAL_BORN',
  born_alive: 'BORN_ALIVE',
  born_dead: 'BORN_DEAD',
  mummified: 'MUMMIFIED',
  active_week_mortality: 'ACTIVE_WEEK_MORTALITY',
  pre_wean_mortality: 'PRE_WEAN_MORTALITY',
  weaning_weight: 'WEANING_WEIGHT',
  litter_mass: 'LITTER_MASS',
} as const;

export type TargetKey = keyof typeof TARGET_METRICS;
export interface Target {
  lower: number | null;
  upper: number | null;
}
export type Targets = Record<TargetKey, Target | null>;

interface ThresholdRow {
  metric?: string;
  lower_limit?: number | string | null;
  upper_limit?: number | string | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Targets for one breed from its lifecycle rows. A farm's own row wins over the company-wide one, the way a
 * lifecycle farm override does everywhere else.
 */
export function targetsFromLifecycle(rows: Array<{ farm_id: string | null; kpi_thresholds: unknown }>, farmId: string): Targets {
  const ordered = [...rows].sort((a, b) => Number(b.farm_id === farmId) - Number(a.farm_id === farmId));
  const found = new Map<string, Target>();
  for (const row of ordered) {
    const list = typeof row.kpi_thresholds === 'string' ? safeParse(row.kpi_thresholds) : row.kpi_thresholds;
    if (!Array.isArray(list)) continue;
    for (const t of list as ThresholdRow[]) {
      if (!t?.metric || found.has(t.metric)) continue;
      const target = { lower: num(t.lower_limit), upper: num(t.upper_limit) };
      if (target.lower === null && target.upper === null) continue;
      found.set(t.metric, target);
    }
  }
  const out = {} as Targets;
  for (const [key, metric] of Object.entries(TARGET_METRICS) as Array<[TargetKey, string]>) {
    out[key] = found.get(metric) ?? null;
  }
  return out;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The target every batch in a set agrees on, for the farm total row; null when they differ or none has one. */
export function commonTargets(all: Targets[]): Targets {
  const out = {} as Targets;
  for (const key of Object.keys(TARGET_METRICS) as TargetKey[]) {
    const values = all.map((t) => t[key]);
    const first = values[0];
    out[key] =
      first && values.every((v) => v && v.lower === first.lower && v.upper === first.upper) ? first : null;
  }
  return out;
}

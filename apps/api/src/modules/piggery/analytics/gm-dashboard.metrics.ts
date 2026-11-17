import type { OpsMetrics } from '../reports/monthly-ops.metrics';
import type { Target } from '../reports/farrowing-report.metrics';
import type { KpiBands } from '../../production/lifecycle/kpi-limits';

/**
 * The arithmetic of the GM Dashboard (Rishi, 2 Nov; docs/superpowers/specs/2026-11-02-gm-dashboard-phase-1-design.md),
 * kept apart from the queries so it can be tested on plain rows.
 */

export type Status = 'GREEN' | 'AMBER' | 'RED' | null;

export interface Cell {
  value: number | null;
  target: number | null;
  status: Status;
}

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  cells: Record<string, Cell>;
}

/** The 10 % amber band a target with no tolerance gets (Rishi, 2 Nov). */
export const DEFAULT_TOLERANCE = 0.1;

const round = (value: number, places = 2) => Number(value.toFixed(places));
const ratio = (num: number, den: number, scale = 1) =>
  den > 0 ? round((num / den) * scale) : null;

/**
 * The sheet's cut-offs (Rishi, 16 Nov): the number under each colour is where that colour is reached, so a value
 * that has reached green is green, one that has reached yellow but not green is amber, anything short of yellow is
 * red. A triple that runs against the metric's direction is a data-entry slip, so it gives no verdict.
 */
export function bandStatus(
  value: number,
  bands: KpiBands,
  lowerIsBetter: boolean,
): Status | undefined {
  const { red, yellow, green } = bands;
  if (lowerIsBetter) {
    if (!(red >= yellow && yellow >= green)) return undefined;
    return value <= green ? 'GREEN' : value <= yellow ? 'AMBER' : 'RED';
  }
  if (!(red <= yellow && yellow <= green)) return undefined;
  return value >= green ? 'GREEN' : value >= yellow ? 'AMBER' : 'RED';
}

/**
 * The farm's red / yellow / green cut-offs when it has them; otherwise green at or better than the target's Average Value; amber when worse but within its tolerance band on that side
 * (or 10 % of the average when it has none); red beyond. No value or no target: no status.
 */
export function ragStatus(
  value: number | null,
  target: Target | null,
  lowerIsBetter: boolean,
): Status {
  if (value == null || !target) return null;
  if (target.bands) {
    const banded = bandStatus(value, target.bands, lowerIsBetter);
    if (banded) return banded;
  }
  const { average, lower, upper } = target;
  if (average == null) {
    if (lower == null && upper == null) return null;
    return (lower == null || value >= lower) &&
      (upper == null || value <= upper)
      ? 'GREEN'
      : 'RED';
  }
  if (lowerIsBetter ? value <= average : value >= average) return 'GREEN';
  const limit = lowerIsBetter
    ? (upper ?? average * (1 + DEFAULT_TOLERANCE))
    : (lower ?? average * (1 - DEFAULT_TOLERANCE));
  return (lowerIsBetter ? value <= limit : value >= limit) ? 'AMBER' : 'RED';
}

/** One target for a farm from several (its breeds, or its batches' breeds): their averages and limits averaged. */
export function meanTarget(
  targets: Array<Target | null | undefined>,
): Target | null {
  const present = targets.filter((t): t is Target => !!t);
  if (!present.length) return null;
  const mean = (pick: (t: Target) => number | null) => {
    const values = present.map(pick).filter((v): v is number => v != null);
    return values.length
      ? round(values.reduce((a, v) => a + v, 0) / values.length, 4)
      : null;
  };
  const banded = present.filter((t) => t.bands);
  const meanBand = (pick: (b: KpiBands) => number) =>
    round(
      banded.reduce((a, t) => a + pick(t.bands as KpiBands), 0) / banded.length,
      4,
    );
  return {
    average: mean((t) => t.average),
    lower: mean((t) => t.lower),
    upper: mean((t) => t.upper),
    ...(banded.length
      ? {
          bands: {
            red: meanBand((b) => b.red),
            yellow: meanBand((b) => b.yellow),
            green: meanBand((b) => b.green),
          },
        }
      : {}),
  };
}

export function cell(
  value: number | null,
  target: Target | null,
  lowerIsBetter: boolean,
): Cell {
  return {
    value,
    target: target?.bands?.green ?? target?.average ?? null,
    status: ragStatus(value, target, lowerIsBetter),
  };
}

/** Breeding & Farrowing figures of one farm from its sow breeds' R12 metrics over the same dates. */
export interface BreedingFigures {
  farrowing_rate_pct: number | null;
  total_born_per_litter: number | null;
  born_alive_per_litter: number | null;
  pre_wean_mortality_pct: number | null;
  weaned_per_sow: number | null;
  avg_wean_weight_kg: number | null;
  litter_mass_kg: number | null;
}

export function breedingFigures(perBreed: OpsMetrics[]): BreedingFigures {
  const sum = (pick: (m: OpsMetrics) => number) =>
    perBreed.reduce((a, m) => a + pick(m), 0);
  const litters = sum((m) => m.litters_farrowed);
  const startLot = sum((m) => m.weaned_start_lot);
  const weighedHead = sum((m) => m.weighed_head);
  const mass = sum((m) => m.total_litter_mass_kg ?? 0);
  return {
    farrowing_rate_pct: ratio(
      sum((m) => m.services_farrowed),
      sum((m) => m.sows_served_one_gestation_earlier),
      100,
    ),
    total_born_per_litter: ratio(
      sum((m) => m.total_born),
      litters,
    ),
    born_alive_per_litter: ratio(
      sum((m) => m.born_alive),
      litters,
    ),
    pre_wean_mortality_pct: ratio(
      startLot - sum((m) => m.weaned_piglets),
      startLot,
      100,
    ),
    weaned_per_sow: ratio(
      sum((m) => m.weaned_piglets),
      sum((m) => m.litters_weaned),
    ),
    avg_wean_weight_kg: ratio(mass, weighedHead),
    litter_mass_kg: ratio(
      mass,
      sum((m) => m.litters_weighed),
    ),
  };
}

/** Kg sold per sow per year over the dates the metrics cover: kg sold ÷ average sows × 365 ÷ days. */
export function kgSoldPerSowYear(
  perBreed: OpsMetrics[],
  days: number,
): number | null {
  const sows = perBreed.reduce((a, m) => a + (m.average_sows ?? 0), 0);
  const kg = perBreed.reduce((a, m) => a + m.kg_sold, 0);
  return sows > 0 && days > 0 ? round((kg / sows) * (365 / days)) : null;
}

// ── Weaner-Grower ────────────────────────────────────────────────────────────────────────────────────────────

export interface StageMove {
  from: string | null;
  to: string;
  date: string;
}

export interface StageBatch {
  batch_id: string;
  start_date: string;
  /** The day the batch closed, null while it runs. */
  end_date: string | null;
  current_stage_code: string | null;
  moves: StageMove[];
}

export interface Segment {
  start: string;
  /** The day it left the stage: the next move, or the day the batch closed; null while it is still in it. */
  exit: string | null;
}

/** The spells a batch spent in a stage, from its stage log; a batch with no log spent its whole life in its stage. */
export function stageSegments(batch: StageBatch, stage: string): Segment[] {
  const moves = [...batch.moves].sort((a, b) => a.date.localeCompare(b.date));
  const spells: Array<{ stage: string | null; start: string }> = [
    {
      stage: moves[0]?.from ?? (moves.length ? null : batch.current_stage_code),
      start: batch.start_date,
    },
    ...moves.map((m) => ({ stage: m.to, start: m.date })),
  ];
  const out: Segment[] = [];
  spells.forEach((s, i) => {
    if (s.stage !== stage) return;
    out.push({ start: s.start, exit: spells[i + 1]?.start ?? batch.end_date });
  });
  return out;
}

export interface DatedQty {
  date: string;
  quantity: number;
}

export interface HeadMoveRow {
  date: string;
  /** Heads into the batch (positive) or out of it (negative). */
  heads: number;
}

/** What one batch's spell in a stage gives the matrix. */
export interface StageExit {
  /** The day it left the stage. */
  exit_date: string;
  heads_in: number;
  heads_out: number;
  deaths: number;
  feed_kg: number;
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  target_weight: Target | null;
  target_fcr: Target | null;
  target_mortality: Target | null;
  target_gain: Target | null;
}

/**
 * One batch's spell in a stage, from its records:
 *  - heads in: opening less deaths before the start, plus moves up to and including it;
 *  - at risk: heads in plus heads moved in during the spell; deaths: those from the start to the day before exit;
 *  - heads out: at risk less deaths less heads moved out during the spell;
 *  - feed: consumption kg from the start to the day before exit;
 *  - exit weight: the last weighing from the start to the exit day; entry weight: the one passed in.
 */
export function stageExit(args: {
  segment: Segment & { exit: string };
  opening: number;
  deaths: DatedQty[];
  moves: HeadMoveRow[];
  feed: DatedQty[];
  weights: DatedQty[];
  entryWeight: number | null;
  targets: {
    weight: Target | null;
    fcr: Target | null;
    mortality: Target | null;
    gain?: Target | null;
  };
}): StageExit {
  const {
    segment,
    opening,
    deaths,
    moves,
    feed,
    weights,
    entryWeight,
    targets,
  } = args;
  const { start, exit } = segment;
  const before = (rows: DatedQty[], day: string) =>
    rows.filter((r) => r.date < day).reduce((a, r) => a + r.quantity, 0);
  const during = <T extends { date: string }>(rows: T[]) =>
    rows.filter((r) => r.date >= start && r.date < exit);
  const movedTo = moves
    .filter((m) => m.date <= start)
    .reduce((a, m) => a + m.heads, 0);
  const headsIn = Math.max(0, opening - before(deaths, start) + movedTo);
  const spellMoves = moves.filter((m) => m.date > start && m.date < exit);
  const movedIn = spellMoves
    .filter((m) => m.heads > 0)
    .reduce((a, m) => a + m.heads, 0);
  const movedOut = spellMoves
    .filter((m) => m.heads < 0)
    .reduce((a, m) => a - m.heads, 0);
  const died = during(deaths).reduce((a, d) => a + d.quantity, 0);
  const weighed = weights
    .filter((w) => w.date >= start && w.date <= exit)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    exit_date: exit,
    heads_in: headsIn + movedIn,
    heads_out: Math.max(0, headsIn + movedIn - died - movedOut),
    deaths: died,
    feed_kg: during(feed).reduce((a, f) => a + f.quantity, 0),
    entry_weight_kg: entryWeight,
    exit_weight_kg: weighed.length
      ? weighed[weighed.length - 1].quantity
      : null,
    target_weight: targets.weight,
    target_fcr: targets.fcr,
    target_mortality: targets.mortality,
    target_gain: targets.gain ?? null,
  };
}

export interface StageFigures {
  exits: number;
  exit_weight_kg: number | null;
  gain_kg: number | null;
  fce: number | null;
  mortality_pct: number | null;
}

/** A farm's figures for a stage from the spells that ended in the period. */
export function stageFigures(exits: StageExit[]): StageFigures {
  const weighed = exits.filter(
    (e) => e.exit_weight_kg != null && e.heads_out > 0,
  );
  const outHeads = weighed.reduce((a, e) => a + e.heads_out, 0);
  const both = weighed.filter((e) => e.entry_weight_kg != null);
  const bothHeads = both.reduce((a, e) => a + e.heads_out, 0);
  const gained = both.map((e) => ({
    feed: e.feed_kg,
    gain:
      e.heads_out * (e.exit_weight_kg as number) -
      e.heads_in * (e.entry_weight_kg as number),
  }));
  const liveGain = gained.reduce((a, g) => a + g.gain, 0);
  return {
    exits: exits.length,
    exit_weight_kg: ratio(
      weighed.reduce(
        (a, e) => a + e.heads_out * (e.exit_weight_kg as number),
        0,
      ),
      outHeads,
    ),
    gain_kg: ratio(
      both.reduce(
        (a, e) =>
          a +
          e.heads_out *
            ((e.exit_weight_kg as number) - (e.entry_weight_kg as number)),
        0,
      ),
      bothHeads,
    ),
    fce:
      liveGain > 0
        ? ratio(
            gained.reduce((a, g) => a + g.feed, 0),
            liveGain,
          )
        : null,
    mortality_pct: ratio(
      exits.reduce((a, e) => a + e.deaths, 0),
      exits.reduce((a, e) => a + e.heads_in, 0),
      100,
    ),
  };
}

export interface Alert {
  farm_id: string;
  farm_name: string;
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER';
}

/** Every red and amber cell, red first, then in matrix order. */
export function alertsFrom(
  rows: MetricRow[],
  farms: Array<{ farm_id: string; farm_name: string }>,
): Alert[] {
  const out: Alert[] = [];
  for (const row of rows) {
    for (const farm of farms) {
      const c = row.cells[farm.farm_id];
      if (!c || c.value == null || (c.status !== 'RED' && c.status !== 'AMBER'))
        continue;
      out.push({
        farm_id: farm.farm_id,
        farm_name: farm.farm_name,
        metric: row.label,
        unit: row.unit,
        value: c.value,
        target: c.target,
        status: c.status,
      });
    }
  }
  return out.sort(
    (a, b) => Number(b.status === 'RED') - Number(a.status === 'RED'),
  );
}

// ── One farm (Rishi, 2 Nov: the Farm view of the mockup) ────────────────────────────────────────────────────

export const WINDOW_KEYS = [
  'this_week',
  'avg_4w',
  'this_month',
  'prev_month',
  'three_month',
] as const;
export type WindowKey = (typeof WINDOW_KEYS)[number];
export const TREND_WEEKS = 6;

export interface Window {
  key: string;
  startDate: string;
  endDate: string;
}

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The farm view's columns, all ending on `to` (the period's last day, or today): This Week is its last 7 days; the
 * 4-week average its last 28; This Month the chosen Reporting Period; Prev. Month the period before it; 3 Months the
 * chosen period and the two before. Then the last six weeks, oldest last, for the trend. A ratio over a window is the
 * weekly figures averaged by their volume.
 */
export function farmWindows(
  to: string,
  period: { start_date: string },
  previous: Array<{ start_date: string; end_date: string }>,
): Window[] {
  const [prev, prev2] = previous;
  const out: Window[] = [
    { key: 'this_week', startDate: shift(to, -6), endDate: to },
    { key: 'avg_4w', startDate: shift(to, -27), endDate: to },
    { key: 'this_month', startDate: period.start_date, endDate: to },
  ];
  if (prev)
    out.push({
      key: 'prev_month',
      startDate: prev.start_date,
      endDate: prev.end_date,
    });
  out.push({
    key: 'three_month',
    startDate: (prev2 ?? prev ?? period).start_date,
    endDate: to,
  });
  for (let i = 0; i < TREND_WEEKS; i++)
    out.push({
      key: `week_${i}`,
      startDate: shift(to, -7 * i - 6),
      endDate: shift(to, -7 * i),
    });
  return out;
}

export interface FarmRow {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  target: number | null;
  /** This Week against the target. */
  status: Status;
  values: Record<WindowKey, number | null>;
  /** The last six weeks, oldest first. */
  trend: Array<number | null>;
}

export function farmRow(
  def: { key: string; label: string; unit: string; lower: boolean },
  valueOf: (windowKey: string) => number | null,
  target: Target | null,
  has: (windowKey: string) => boolean,
): FarmRow {
  const values = Object.fromEntries(
    WINDOW_KEYS.map((k) => [k, has(k) ? valueOf(k) : null]),
  ) as Record<WindowKey, number | null>;
  return {
    key: def.key,
    label: def.label,
    unit: def.unit,
    lower_is_better: def.lower,
    target: target?.bands?.green ?? target?.average ?? null,
    status: ragStatus(values.this_week, target, def.lower),
    values,
    trend: Array.from({ length: TREND_WEEKS }, (_, i) =>
      valueOf(`week_${TREND_WEEKS - 1 - i}`),
    ),
  };
}

export interface FarmAlert {
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER' | 'GREEN';
  /** Whether the miss (or the success) is the figure being above its target. */
  above: boolean;
}

/** This Week's status of every row with a value and a target: red, then amber, then those on target. */
export function farmAlerts(rows: FarmRow[]): FarmAlert[] {
  const order = { RED: 0, AMBER: 1, GREEN: 2 } as const;
  return rows
    .filter((r) => r.values.this_week != null && r.status)
    .map((r) => ({
      metric: r.label,
      unit: r.unit,
      value: r.values.this_week as number,
      target: r.target,
      status: r.status as 'RED' | 'AMBER' | 'GREEN',
      above: r.target != null && (r.values.this_week as number) > r.target,
    }))
    .sort((a, b) => order[a.status] - order[b.status]);
}

/** One sold disposal of a batch (Rishi, 16 Nov): heads and book value from the bio-asset ledger, proceeds from the sale journal. */
export interface SaleRow {
  farm_id: string;
  date: string;
  heads: number;
  cost: number;
  revenue: number;
}

export interface SalesFigures {
  heads: number;
  cost_of_sales: number;
  revenue: number;
  gross_margin: number;
  gross_margin_pct: number | null;
}

/**
 * Pigs sold, cost of sales (their book value), revenue and gross margin of the sales in a window, for one farm or all
 * (farmId null). Null when the window holds no sale at all, so a tenant that never sells shows N/A, not zeros.
 */
export function salesFigures(
  rows: SaleRow[],
  from: string,
  to: string,
  farmId: string | null,
): SalesFigures | null {
  const inWindow = rows.filter(
    (r) => r.date >= from && r.date <= to && (!farmId || r.farm_id === farmId),
  );
  if (!inWindow.length) return null;
  const sum = (pick: (r: SaleRow) => number) =>
    round(
      inWindow.reduce((a, r) => a + pick(r), 0),
      2,
    );
  const revenue = sum((r) => r.revenue);
  const cost = sum((r) => r.cost);
  const grossMargin = round(revenue - cost, 2);
  return {
    heads: sum((r) => r.heads),
    cost_of_sales: cost,
    revenue,
    gross_margin: grossMargin,
    gross_margin_pct:
      revenue > 0 ? round((grossMargin / revenue) * 100, 2) : null,
  };
}

/** The GL accounts the overhead rows read: Other Overheads is 4600 (Rishi, 17 Nov); Staff Overheads is 4610, made for it. */
export const OTHER_OVERHEAD_GL = '4600';
export const STAFF_OVERHEAD_GL = '4610';

/** One posted overhead entry: a farm's cost centre's net debit on the Other or Staff Overheads account. */
export interface OverheadRow {
  farm_id: string;
  date: string;
  kind: 'OTHER' | 'STAFF';
  amount: number;
}

export interface OverheadFigures {
  other: number;
  staff: number;
}

/** The overheads posted in a window, for one farm or all of them; null when nothing was posted. */
export function overheadFigures(
  rows: OverheadRow[],
  from: string,
  to: string,
  farmId: string | null,
): OverheadFigures | null {
  const inWindow = rows.filter(
    (r) => r.date >= from && r.date <= to && (!farmId || r.farm_id === farmId),
  );
  if (!inWindow.length) return null;
  const sum = (kind: OverheadRow['kind']) =>
    round(
      inWindow.filter((r) => r.kind === kind).reduce((a, r) => a + r.amount, 0),
      2,
    );
  return { other: sum('OTHER'), staff: sum('STAFF') };
}

/**
 * Profit before tax: gross margin less both overheads. It exists when either side has figures; a side with none counts
 * as 0 (a farm with overheads and no sale in the window shows the loss).
 */
export function pbtOf(
  sales: SalesFigures | null,
  overheads: OverheadFigures | null,
): number | null {
  if (!sales && !overheads) return null;
  return round(
    (sales?.gross_margin ?? 0) - (overheads?.other ?? 0) - (overheads?.staff ?? 0),
    2,
  );
}

/** The business year's running PBT, one point per period up to the chosen one (the PBT chart's actuals). */
export function pbtByPeriod(
  sales: SaleRow[],
  overheads: OverheadRow[],
  periods: Array<{ period_code: string; start_date: string; end_date: string }>,
  farmId: string | null,
  to: string,
): Array<{ period_code: string; pbt: number | null }> {
  let running = 0;
  return periods.map((p) => {
    if (p.start_date > to) return { period_code: p.period_code, pbt: null };
    const end = p.end_date < to ? p.end_date : to;
    running +=
      pbtOf(
        salesFigures(sales, p.start_date, end, farmId),
        overheadFigures(overheads, p.start_date, end, farmId),
      ) ?? 0;
    return { period_code: p.period_code, pbt: round(running, 2) };
  });
}

/** The business year's running total of pigs sold, one point per period up to the chosen one (the YTD chart's actuals). */
export function headsByPeriod(
  rows: SaleRow[],
  periods: Array<{ period_code: string; start_date: string; end_date: string }>,
  farmId: string | null,
  to: string,
): Array<{ period_code: string; heads: number | null }> {
  let running = 0;
  return periods.map((p) => {
    if (p.start_date > to) return { period_code: p.period_code, heads: null };
    const end = p.end_date < to ? p.end_date : to;
    running += salesFigures(rows, p.start_date, end, farmId)?.heads ?? 0;
    return { period_code: p.period_code, heads: running };
  });
}

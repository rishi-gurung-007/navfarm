import type { TranslationKeys } from '@/utils/translations';

/**
 * The R07 Farrowing Report's columns, in the order of Triple-C_reports COMMENTS.xlsx row 5. Shared by the screen
 * and the PDF so both always show the same thing. Week and Month are left out (Rishi, 18 and 20 Oct). Every group with a Prior YR also shows the
 * change against it and the YoY % change (AY5 comment: "Year on Year Change must be on every parameter"; Rishi, 20 and
 * 21 Oct). The Average Litter Mass group was taken out (Rishi, 21 Oct).
 */

/** A KPI's Average Value and the band its tolerance allows. */
export interface Target {
  average: number | null;
  lower: number | null;
  upper: number | null;
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
  sows_weaned: number;
  wean_per_sow: number | null;
  gilt_body_loss_pct: number | null;
}

export interface FarrowingReportRow {
  batch_id: string | null;
  batch_no: string;
  is_total: boolean;
  metrics: FarrowingMetrics;
  targets: Record<string, Target | null>;
  prior_year: FarrowingMetrics | null;
  prior_batch_no: string | null;
}

export interface FarrowingReport {
  farm: { farm_id: string; farm_code: string; farm_name: string };
  filters: {
    date_from: string;
    date_to: string;
    batch_no: string | null;
    parity: number | null;
    sow_code: string | null;
  };
  generated_at: string;
  rows: FarrowingReportRow[];
}

type Sub =
  'rptActual' | 'rptTarget' | 'rptPriorYear' | 'rptPriorChange' | 'rptYoyPct';
type Metric = keyof FarrowingMetrics;

export interface ReportColumn {
  group: TranslationKeys;
  sub: Sub;
  /**
   * Which way is good news: "down" for a loss or a death count (a fall is green, a rise red), "none" for a planning
   * figure that is aimed at a target, not maximised (no colour). Default "up".
   */
  better?: 'up' | 'down' | 'none';
  cell: (row: FarrowingReportRow, t: (k: TranslationKeys) => string) => string;
}

/** "N/A" where a figure is not available (Rishi, 19 Oct: never a dash). */
export const NA = 'N/A';

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined
    ? NA
    : Number.isInteger(v)
      ? String(v)
      : v.toFixed(2);

const actual = (m: Metric) => (row: FarrowingReportRow) => fmt(row.metrics[m]);

// The band the KPI's tolerance allows; one side when the tolerance is Upper or Lower; the average when it has none.
const target =
  (key: string) =>
  (row: FarrowingReportRow, t: (k: TranslationKeys) => string) => {
    const v = row.targets[key];
    if (!v) return t('rptNotAvailable');
    if (v.lower !== null && v.upper !== null)
      return v.lower === v.upper
        ? fmt(v.lower)
        : `${fmt(v.lower)}–${fmt(v.upper)}`;
    if (v.upper !== null) return `≤ ${fmt(v.upper)}`;
    if (v.lower !== null) return `≥ ${fmt(v.lower)}`;
    return fmt(v.average);
  };

// A batch row's prior year is the batch that stood where it stands a year earlier; the total's is the farm's.
const prior = (m: Metric) => (row: FarrowingReportRow) =>
  row.prior_year ? fmt(row.prior_year[m]) : NA;

// Rounded first so a tiny negative shows as 0, not "-0.00".
const signed = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${fmt(r)}` : fmt(r);
};

// Actual − Prior YR; for the % metrics this is the difference in percentage points.
const change = (m: Metric) => (row: FarrowingReportRow) => {
  const a = row.metrics[m];
  const p = row.prior_year?.[m];
  return a === null || p === null || p === undefined ? NA : signed(a - p);
};

// (Actual − Prior YR) ÷ Prior YR × 100; N/A when the prior year is missing or 0.
const yoy = (m: Metric) => (row: FarrowingReportRow) => {
  const a = row.metrics[m];
  const p = row.prior_year?.[m];
  return a === null || p === null || p === undefined || p === 0
    ? NA
    : `${signed(((a - p) / p) * 100)}%`;
};

const triple = (
  group: TranslationKeys,
  m: Metric,
  targetKey: string | null,
  better: ReportColumn['better'] = 'up',
): ReportColumn[] => [
  { group, sub: 'rptActual', cell: actual(m) },
  ...(targetKey
    ? [{ group, sub: 'rptTarget' as Sub, cell: target(targetKey) }]
    : []),
  { group, sub: 'rptPriorYear', cell: prior(m) },
  { group, sub: 'rptPriorChange', cell: change(m), better },
  { group, sub: 'rptYoyPct', cell: yoy(m), better },
];

/** The colour of a change or YoY % figure: good news green, bad news red, nothing for no change or N/A. */
export function changeTone(
  column: ReportColumn,
  text: string,
): 'good' | 'bad' | null {
  if (
    (column.sub !== 'rptPriorChange' && column.sub !== 'rptYoyPct') ||
    column.better === 'none'
  )
    return null;
  const rise = text.startsWith('+');
  if (!rise && !text.startsWith('-')) return null;
  return rise !== (column.better === 'down') ? 'good' : 'bad';
}

export const FARROWING_COLUMNS: ReportColumn[] = [
  {
    group: 'rptServiceTarget',
    sub: 'rptTarget',
    cell: target('service_target'),
  },
  { group: 'rptSowsServed', sub: 'rptActual', cell: actual('sows_served') },
  { group: 'rptSowsFarrowed', sub: 'rptActual', cell: actual('sows_farrowed') },
  {
    group: 'rptFarrowingTarget',
    sub: 'rptTarget',
    cell: target('farrowing_target'),
  },
  ...triple('rptFarrowingRate', 'farrowing_rate_pct', 'farrowing_rate'),
  ...triple('rptTotalBornPerSow', 'total_born_per_sow', 'total_born'),
  ...triple('rptBaPerSow', 'born_alive_per_sow', 'born_alive'),
  ...triple('rptBornDead', 'born_dead', 'born_dead', 'down'),
  ...triple('rptMummified', 'mummified', 'mummified', 'down'),
  ...triple(
    'rptActiveWeekMortality',
    'active_week_mortality',
    'active_week_mortality',
    'down',
  ),
  ...triple(
    'rptPreWeanMortality',
    'pre_wean_mortality_pct',
    'pre_wean_mortality',
    'down',
  ),
  ...triple('rptAvgWeaningWeight', 'avg_weaning_weight_kg', 'weaning_weight'),
  ...triple('rptLitterMassTotal', 'litter_mass_total_kg', 'total_litter_mass'),
  ...triple('rptWeanPerSow', 'wean_per_sow', 'wean_per_sow'),
  ...triple('rptGiltBodyLoss', 'gilt_body_loss_pct', 'gilt_body_loss', 'down'),
  ...triple('rptGiltsServed', 'gilts_served', 'gilt_service_target', 'none'),
  ...triple(
    'rptSecondParityServed',
    'second_parity_served',
    'second_parity_service_target',
    'none',
  ),
  {
    group: 'rptPriorYearSows',
    sub: 'rptPriorYear',
    cell: prior('sows_served'),
  },
];

/** The column indexes that open a new group — where the screen and the PDF draw the group's separating line. */
export function groupStarts(columns: ReportColumn[]): Set<number> {
  return new Set(
    columns
      .map((c, i) => (i > 0 && columns[i - 1].group !== c.group ? i : -1))
      .filter((i) => i >= 0),
  );
}

/** Consecutive columns of one group, for the two-row header. */
export function columnGroups(
  columns: ReportColumn[],
): Array<{ group: TranslationKeys; span: number }> {
  const out: Array<{ group: TranslationKeys; span: number }> = [];
  for (const c of columns) {
    const last = out[out.length - 1];
    if (last && last.group === c.group) last.span += 1;
    else out.push({ group: c.group, span: 1 });
  }
  return out;
}

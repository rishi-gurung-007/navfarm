/**
 * Feed Forecast report views (spec D16; workbook Feed Forecast Engine row 20,
 * Step 6 and row 67). A view is only a date range and a way of grouping the
 * engine's per-date rows for display: "Date grouping never changes underlying
 * daily calculation", so nothing here recomputes a balance or a demand — it
 * adds up what the engine already worked out day by day. "Current and next
 * diet remain separate lines": a group is one batch, one item and one source,
 * so a diet change is always a new line. Pure — no database, no Nest.
 */
import { addDays, dayShort, diffDays, type DailyForecastRow } from './feed-forecast.engine';

/** Workbook checkpoint 15: the forecast looks at most 45 days past `from` ("for example 45 days"). */
export const MAX_SPAN_DAYS = 45;
/** Workbook Worked Example "23 Sep to 29 Sep 2026, 7 days" and Engine §5 row 67: the default window is 7 calendar days inclusive. */
export const DEFAULT_WINDOW_DAYS = 7;
/** Last day of the default window: from + 6, since `from` itself is day one (from + 7 ordered an eighth day). */
export function defaultWindowEnd(from: string): string {
  return addDays(from, DEFAULT_WINDOW_DAYS - 1);
}

/** Open question Q12: Daily = one date, Weekly = 7 days grouped, Reporting Period = the period grouped, Custom = per date. */
export const FORECAST_VIEWS = ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];

/** A Reporting Period Master row as the forecast uses it (D20). */
export interface PeriodRange {
  periodId: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  stockTakeDate: string;
  productionStartDate: string;
}

export function resolveViewRange(args: {
  view: ForecastView;
  planningDate: string;
  from?: string;
  to?: string;
  period?: PeriodRange | null;
}): { from: string; to: string } {
  const start = args.from ?? args.planningDate;
  switch (args.view) {
    case 'DAILY':
      return { from: start, to: start };
    case 'WEEKLY':
      // Row 67: "Weekly uses selected week start date" — any weekday; which one is a scheduler setting, not ours.
      return { from: start, to: defaultWindowEnd(start) };
    case 'PERIOD':
      // Field spec: "When 'Reporting Period' is chosen, From/To are pulled from the Reporting Period Master … not typed".
      if (!args.period) throw new Error('A Reporting Period view needs a period.');
      return { from: args.period.startDate, to: args.period.endDate };
    default:
      // Default window: 7 days inclusive, to = from + 6 (Engine §5 row 67).
      return { from: start, to: args.to ?? defaultWindowEnd(start) };
  }
}

/** Why a range cannot be forecast, or null. A reporting period is named, since its dates were not typed by the user. */
export function spanProblem(from: string, to: string, period?: PeriodRange | null): string | null {
  if (to < from) return 'The end date is before the start date.';
  const span = diffDays(from, to);
  if (span <= MAX_SPAN_DAYS) return null;
  return period
    ? `Reporting period ${period.periodCode} runs ${span + 1} days (${dayShort(period.startDate)} to ${dayShort(period.endDate)}); the forecast covers at most ${MAX_SPAN_DAYS + 1}.`
    : `Choose a range of at most ${MAX_SPAN_DAYS} days.`;
}

/** One line of the report grid: a single date (Daily, Custom) or a batch + item's days in a week or period. */
export interface ReportRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  /** location_name of the silo or store (Engine §5 row 70); null for NONE or when the name is unknown. */
  sourceName: string | null;
  date: string; // first date of the line (field spec: "the period start date when grouped")
  dateTo: string; // last date of the line
  days: number;
  currentInventoryKg: number; // as of `date`
  heads: number; // as of `date`
  perDayIntakeKg: number; // as of `date`, no wastage (D17)
  intakeKg: number; // sum of per-day intake over the line — D34: the line's demand, wastage is gone
  daysOfStock: number | null; // as of `date` (D35: the row's own inventory ÷ its intake)
  sharedBatchCount: number; // the most batches sharing the container on any day of the line
  indicative: boolean; // any day of the line
  runDownDate: string | null;
}

/** The first date of the group `date` belongs to. */
export function bucketStart(view: ForecastView, from: string, date: string): string {
  if (view === 'WEEKLY') return addDays(from, 7 * Math.floor(diffDays(from, date) / 7));
  if (view === 'PERIOD') return from;
  return date;
}

export function groupRows(daily: DailyForecastRow[], view: ForecastView, from: string, sourceNames: Record<string, string> = {}): ReportRow[] {
  const byDate = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Sums in integer micrograms, like the engine, so 7 × 17.9375 kg is exactly 125.5625 kg.
  const groups = new Map<string, { row: ReportRow; intake: number }>();
  for (const d of byDate) {
    const start = bucketStart(view, from, d.date);
    // Stage is part of the line: a batch that changes stage inside a week or
    // period while keeping the same feed (WEANER → GROWER on one mash) gets a
    // new line, so a grouped row never shows a stage it has already left.
    const key = `${d.batchId}|${d.stageCode}|${d.itemId}|${d.sourceCode ?? 'NONE'}|${start}`;
    const intake = Math.round(d.perDayIntakeKg * 1e6);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        intake,
        row: {
          key, batchId: d.batchId, batchNo: d.batchNo, shedCode: d.shedCode, stageCode: d.stageCode,
          itemId: d.itemId, itemNo: d.itemNo, itemName: d.itemName, sourceType: d.sourceType, sourceCode: d.sourceCode,
          sourceName: d.sourceCode ? sourceNames[d.sourceCode] ?? null : null,
          // Ruling M4: the line's date is the GROUP'S start date (field spec: "the period start date when
          // grouped") — the earliest date this batch+item+source actually has in the bucket, not the view's
          // own `from` (a diet starting mid-week reports on its own first day, not the week's start; a
          // Reporting Period's `bucketStart` is `from` for every day, so a diet starting mid-period still gets
          // its own start here because rows are visited in date order and this is the first one seen for the key).
          date: d.date, dateTo: d.date, days: 1,
          currentInventoryKg: d.currentInventoryKg, heads: d.heads, perDayIntakeKg: d.perDayIntakeKg,
          intakeKg: d.perDayIntakeKg,
          daysOfStock: d.daysOfStock, sharedBatchCount: d.sharedBatchCount, indicative: d.indicative,
          runDownDate: d.runDownDate,
        },
      });
      continue;
    }
    group.intake += intake;
    group.row.dateTo = d.date;
    group.row.days += 1;
    group.row.intakeKg = group.intake / 1e6;
    group.row.indicative = group.row.indicative || d.indicative;
    group.row.sharedBatchCount = Math.max(group.row.sharedBatchCount, d.sharedBatchCount);
  }
  return [...groups.values()]
    .map((g) => g.row)
    .sort((a, b) => {
      if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
      if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0;
    });
}

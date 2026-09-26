/**
 * Feed Forecast report views (spec D16; workbook Feed Forecast Engine row 20,
 * Step 6 and row 67). A view is only a date range and a way of grouping the
 * engine's per-date rows for display: "Date grouping never changes underlying
 * daily calculation", so nothing here recomputes a balance or a demand — it
 * adds up what the engine already worked out day by day. "Current and next
 * diet remain separate lines": a group is one batch, one item and one source,
 * so a diet change is always a new line. Pure — no database, no Nest.
 */
import { addDays, diffDays, type DailyForecastRow } from './feed-forecast.engine';

/** Workbook checkpoint 15: the forecast looks at most 45 days past `from` ("for example 45 days"). */
export const MAX_SPAN_DAYS = 45;
export const DEFAULT_SPAN_DAYS = 7;

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
      return { from: start, to: addDays(start, 6) };
    case 'PERIOD':
      // Field spec: "When 'Reporting Period' is chosen, From/To are pulled from the Reporting Period Master … not typed".
      if (!args.period) throw new Error('A Reporting Period view needs a period.');
      return { from: args.period.startDate, to: args.period.endDate };
    default:
      // Same default as GET /feed-forecast has had since Plan A: to = from + 7.
      return { from: start, to: args.to ?? addDays(start, DEFAULT_SPAN_DAYS) };
  }
}

/** Why a range cannot be forecast, or null. A reporting period is named, since its dates were not typed by the user. */
export function spanProblem(from: string, to: string, period?: PeriodRange | null): string | null {
  if (to < from) return 'to must not be before from.';
  const span = diffDays(from, to);
  if (span <= MAX_SPAN_DAYS) return null;
  return period
    ? `Reporting period ${period.periodCode} runs ${span + 1} days (${period.startDate} to ${period.endDate}); the forecast covers at most ${MAX_SPAN_DAYS + 1}.`
    : `The forecast covers at most ${MAX_SPAN_DAYS} days after from.`;
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
  date: string; // first date of the line (field spec: "the period start date when grouped")
  dateTo: string; // last date of the line
  days: number;
  currentInventoryKg: number; // as of `date`
  heads: number; // as of `date`
  perDayIntakeKg: number; // as of `date`, no wastage (D17)
  wastagePct: number;
  intakeKg: number; // sum of per-day intake over the line
  demandKg: number; // sum of demand incl. wastage over the line
  daysOfStock: number | null; // as of `date` (D18)
  sharedBatchCount: number; // the most batches sharing the container on any day of the line
  indicative: boolean; // any day of the line
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}

/** The first date of the group `date` belongs to. */
export function bucketStart(view: ForecastView, from: string, date: string): string {
  if (view === 'WEEKLY') return addDays(from, 7 * Math.floor(diffDays(from, date) / 7));
  if (view === 'PERIOD') return from;
  return date;
}

export function groupRows(daily: DailyForecastRow[], view: ForecastView, from: string): ReportRow[] {
  const byDate = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Sums in integer micrograms, like the engine, so 7 × 17.9375 kg is exactly 125.5625 kg.
  const groups = new Map<string, { row: ReportRow; intake: number; demand: number }>();
  for (const d of byDate) {
    const start = bucketStart(view, from, d.date);
    // Stage is part of the line: a batch that changes stage inside a week or
    // period while keeping the same feed (WEANER → GROWER on one mash) gets a
    // new line, so a grouped row never shows a stage it has already left.
    const key = `${d.batchId}|${d.stageCode}|${d.itemId}|${d.sourceCode ?? 'NONE'}|${start}`;
    const intake = Math.round(d.perDayIntakeKg * 1e6);
    const demand = Math.round(d.demandKg * 1e6);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        intake,
        demand,
        row: {
          key, batchId: d.batchId, batchNo: d.batchNo, shedCode: d.shedCode, stageCode: d.stageCode,
          itemId: d.itemId, itemNo: d.itemNo, itemName: d.itemName, sourceType: d.sourceType, sourceCode: d.sourceCode,
          // Ruling M4: the line's date is the GROUP'S start date (field spec: "the period start date when
          // grouped") — the earliest date this batch+item+source actually has in the bucket, not the view's
          // own `from` (a diet starting mid-week reports on its own first day, not the week's start; a
          // Reporting Period's `bucketStart` is `from` for every day, so a diet starting mid-period still gets
          // its own start here because rows are visited in date order and this is the first one seen for the key).
          date: d.date, dateTo: d.date, days: 1,
          currentInventoryKg: d.currentInventoryKg, heads: d.heads, perDayIntakeKg: d.perDayIntakeKg, wastagePct: d.wastagePct,
          intakeKg: d.perDayIntakeKg, demandKg: d.demandKg,
          daysOfStock: d.daysOfStock, sharedBatchCount: d.sharedBatchCount, indicative: d.indicative,
          runDownDate: d.runDownDate, refillDate: d.refillDate, requiredOn: d.requiredOn, overdue: d.overdue,
        },
      });
      continue;
    }
    group.intake += intake;
    group.demand += demand;
    group.row.dateTo = d.date;
    group.row.days += 1;
    group.row.intakeKg = group.intake / 1e6;
    group.row.demandKg = group.demand / 1e6;
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

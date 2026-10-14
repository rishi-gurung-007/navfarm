/**
 * Breed Lifecycle Stage KPI evaluator (Rishi, 12 Oct).
 *
 * breed_lifecycle_stages.kpi_thresholds lists, per stage row, the KPIs a batch in that stage is held to:
 * { metric, lower_limit, upper_limit, average_value, tolerance_pct, tolerance_type, kpi_period, severity }.
 * This looks at what the farm actually entered (batch_daily_data on a scheduler_line carrying that kpi_metric)
 * and writes notification_alert_log rows of alert_type 'LIFECYCLE_KPI'. It runs ALONGSIDE the schedule-limit
 * check (scheduler_line lower/upper_alert_limit, alert_type 'KPI_DEVIATION'), which it neither replaces nor reads.
 *
 * The decision logic is pure (evaluateLifecycleKpiLine) so it is tested without a database; the class is the
 * thin loader/writer around it.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, like } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as schema from '../../../core/database/schema';
import { headsAtStartOfDate } from '../batch-heads';
import { feedRowFor, stageDayRange, type FeedRow } from './feed-row-days';

export const LIFECYCLE_KPI_ALERT_TYPE = 'LIFECYCLE_KPI';

export type KpiPeriod = 'DAILY' | 'WEEKLY';
export type KpiAggregation = 'SUM' | 'AVERAGE' | 'PCT_OF_HEADS';
export type KpiRule = 'LOWER_LIMIT' | 'UPPER_LIMIT' | 'TOLERANCE';

export interface LifecycleKpiLine {
  metric: string;
  uom?: string | null;
  /** Stored but ignored: the period is always the header's (Rishi, 12 Oct). */
  kpi_period?: string | null;
  /** Stage days (day-in-stage, 1 = stage start). Both empty = the whole stage. */
  from_day?: number | string | null;
  to_day?: number | string | null;
  lower_limit?: number | string | null;
  upper_limit?: number | string | null;
  average_value?: number | string | null;
  tolerance_pct?: number | string | null;
  tolerance_type?: string | null;
  severity?: string | null;
}

export interface KpiValue {
  date: string;
  value: number;
  /** Day-in-stage of the entry (1 = stage start). Absent = not windowed. */
  dayInStage?: number;
}

export interface KpiBreach {
  rule: KpiRule;
  period: KpiPeriod;
  periodKey: string;
  actual: number;
  /** The figure the actual was held to: the limit, or the tolerance bound derived from the average. */
  threshold: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  direction: 'below' | 'above';
  message: string;
  toleranceDesc?: string;
}

/**
 * The effective period of every line is the header's KPI period, default DAILY; a line's own stored kpi_period is
 * ignored. MONTHLY was removed (12 Oct): a stored MONTHLY is read as WEEKLY so an older record still evaluates.
 */
export function effectivePeriod(headerPeriod?: string | null): KpiPeriod {
  if (headerPeriod === 'WEEKLY' || headerPeriod === 'MONTHLY') return 'WEEKLY';
  return 'DAILY';
}

const PCT_CODES = ['%', 'PCT', 'PERCENT', 'PERCENTAGE'];
const PCT_TYPES = ['PERCENT', 'PERCENTAGE', 'PCT'];
const COUNT_CODES = ['HEAD', 'HEADS', 'NOS', 'PCS', 'EA', 'COUNT'];

/**
 * How a period's entries combine into the actual, derived from the KPI line's UOM (no master field for it):
 * a percent unit -> PCT_OF_HEADS (sum of the entries / heads at period start x 100); a count unit -> SUM;
 * anything else (KG, GRAM, RATIO...) -> AVERAGE. `uom` is the line's uom_code, `master` its uom_master row if found.
 */
export function aggregationForUom(uom?: string | null, master?: { uom_name?: string | null; uom_type?: string | null } | null): KpiAggregation {
  const code = String(uom ?? '').trim().toUpperCase();
  const name = String(master?.uom_name ?? '').trim().toUpperCase();
  const type = String(master?.uom_type ?? '').trim().toUpperCase();
  if (PCT_CODES.includes(code) || PCT_CODES.includes(name) || PCT_TYPES.includes(type)) return 'PCT_OF_HEADS';
  if (type === 'COUNT' || COUNT_CODES.includes(code) || COUNT_CODES.includes(name)) return 'SUM';
  return 'AVERAGE';
}

/** The line's stage-day window as integers; an empty end is open. Both empty = the whole stage. */
export function lineWindow(line: Pick<LifecycleKpiLine, 'from_day' | 'to_day'>): { fromDay: number | null; toDay: number | null } {
  const n = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return { fromDay: n(line.from_day), toDay: n(line.to_day) };
}

export function dayInWindow(day: number, w: { fromDay: number | null; toDay: number | null }): boolean {
  return (w.fromDay === null || day >= w.fromDay) && (w.toDay === null || day <= w.toDay);
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Monday of the ISO week containing `iso`. */
export function isoWeekStart(iso: string): string {
  const d = toUtc(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

/** ISO week-year and number, e.g. 2026-W41. */
export function isoWeekKey(iso: string): string {
  const d = toUtc(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the ISO year
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** First day of the period containing `date`, and its dedupe key. */
export function periodWindow(period: KpiPeriod, date: string): { from: string; key: string } {
  if (period === 'WEEKLY') return { from: isoWeekStart(date), key: isoWeekKey(date) };
  return { from: date, key: date };
}

export interface PeriodOptions {
  aggregation?: KpiAggregation;
  /** Only entries whose day-in-stage lies in this window count (and `date` itself must lie in it). */
  window?: { fromDay: number | null; toDay: number | null };
  /** PCT_OF_HEADS: the batch head count at the start of the period (or of the window if later). */
  headsAtStart?: number | null;
}

/**
 * The period's actual, from the entries inside the stage-day window: DAILY looks at `date` only, WEEKLY at the ISO
 * week up to and including `date`. SUM adds them, AVERAGE takes the mean, PCT_OF_HEADS is the SUM over the heads at
 * period start x 100 (never an average of daily percentages). Null when nothing counts or the percent has no heads.
 */
export function actualForPeriod(values: KpiValue[], period: KpiPeriod, date: string, opts: PeriodOptions = {}): { actual: number; key: string } | null {
  const { from, key } = periodWindow(period, date);
  const window = opts.window ?? { fromDay: null, toDay: null };
  const inWindow = values.filter((v) => v.date >= from && v.date <= date && (v.dayInStage === undefined || dayInWindow(v.dayInStage, window)));
  if (!inWindow.length) return null;
  const sum = inWindow.reduce((s, v) => s + v.value, 0);
  const aggregation = opts.aggregation ?? 'AVERAGE';
  if (aggregation === 'SUM') return { actual: sum, key };
  if (aggregation === 'PCT_OF_HEADS') {
    const heads = opts.headsAtStart;
    if (!heads || heads <= 0) return null;
    return { actual: (sum / heads) * 100, key };
  }
  return { actual: sum / inWindow.length, key };
}

const round = (n: number) => Number(n.toFixed(4));

/** Everything one KPI line says about `values` on `date`. Empty when nothing is breached or nothing was entered. */
export function evaluateLifecycleKpiLine(line: LifecycleKpiLine, headerPeriod: string | null | undefined, values: KpiValue[], date: string, opts: Pick<PeriodOptions, 'aggregation' | 'headsAtStart'> & { dayInStage?: number } = {}): KpiBreach[] {
  const period = effectivePeriod(headerPeriod);
  const window = lineWindow(line);
  // The line only applies while the entry's day-in-stage lies in its window.
  if (opts.dayInStage !== undefined && !dayInWindow(opts.dayInStage, window)) return [];
  const got = actualForPeriod(values, period, date, { aggregation: opts.aggregation, headsAtStart: opts.headsAtStart, window });
  if (!got) return [];
  const { actual, key } = got;
  const severity = line.severity === 'INFO' || line.severity === 'CRITICAL' ? line.severity : 'WARNING';
  const unit = line.uom ? ` ${line.uom}` : '';
  const out: KpiBreach[] = [];
  const avg = num(line.average_value);
  const tolPct = num(line.tolerance_pct);

  // Rishi, 12 Oct: Lower/Upper Limit removed from the KPI lines; only the tolerance against the average alerts.
  if (avg !== null && tolPct !== null && (line.tolerance_type === 'UPPER' || line.tolerance_type === 'LOWER')) {
    if (line.tolerance_type === 'UPPER') {
      const bound = avg * (1 + tolPct / 100);
      if (actual > bound) {
        out.push({ rule: 'TOLERANCE', period, periodKey: key, actual, threshold: bound, severity, direction: 'above', toleranceDesc: `UPPER ${tolPct}%`, message: `actual ${round(actual)}${unit} is above the average ${avg}${unit} by more than the ${tolPct}% UPPER tolerance (above ${round(bound)}${unit})` });
      }
    } else {
      const bound = avg * (1 - tolPct / 100);
      if (actual < bound) {
        out.push({ rule: 'TOLERANCE', period, periodKey: key, actual, threshold: bound, severity, direction: 'below', toleranceDesc: `LOWER ${tolPct}%`, message: `actual ${round(actual)}${unit} is below the average ${avg}${unit} by more than the ${tolPct}% LOWER tolerance (below ${round(bound)}${unit})` });
      }
    }
  }
  return out;
}

/** The text the dedupe looks for in message: one alert per batch + metric + rule + period key. */
export const periodMarker = (period: KpiPeriod, key: string) => `Period: ${period} ${key}.`;

const addDays = (iso: string, n: number) => fmt(new Date(toUtc(iso).getTime() + n * 86400000));
const daysBetween = (fromIso: string, toIso: string) => Math.round((toUtc(toIso).getTime() - toUtc(fromIso).getTime()) / 86400000);

@Injectable()
export class LifecycleKpiEvaluator {
  private readonly logger = new Logger(LifecycleKpiEvaluator.name);

  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * Safe entry point for the save path: never throws. Returns the alerts inserted (0 on any failure).
   * `metrics` narrows the check to the metrics just entered; omit it to check every KPI of the stage.
   */
  async evaluateSafely(batchId: string, tenantId: string, entryDate: string, metrics?: string[]): Promise<number> {
    try {
      return await this.evaluateBatch(batchId, tenantId, entryDate, metrics);
    } catch (e) {
      this.logger.error(`Lifecycle KPI evaluation failed for batch ${batchId} on ${entryDate}: ${(e as Error)?.message ?? e}`);
      return 0;
    }
  }

  /** Evaluates the batch's current lifecycle KPI lines for `date` and writes the alerts. Usable on demand. */
  async evaluateBatch(batchId: string, tenantId: string, date: string, metrics?: string[]): Promise<number> {
    const [batch] = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        company_id: schema.batchHeader.company_id,
        lob_id: schema.batchHeader.lob_id,
        farm_id: schema.batchHeader.farm_id,
        opening_quantity: schema.batchHeader.opening_quantity,
      })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (!batch) return 0;

    // The stage(s) the batch is in on this date: its scheduler header carries breed, stage and the stage start.
    const headers = await this.db
      .select({
        scheduler_id: schema.schedulerHeader.scheduler_id,
        breed_id: schema.schedulerHeader.breed_id,
        stage_id: schema.schedulerHeader.stage_id,
        effective_from: schema.schedulerHeader.effective_from,
      })
      .from(schema.schedulerHeader)
      .where(
        and(
          eq(schema.schedulerHeader.batch_id, batchId),
          lte(schema.schedulerHeader.effective_from, date),
          or(isNull(schema.schedulerHeader.effective_to), gte(schema.schedulerHeader.effective_to, date)),
          isNotNull(schema.schedulerHeader.breed_id),
        ),
      );

    let written = 0;
    for (const h of headers) {
      const rows = await this.db
        .select()
        .from(schema.breedLifecycleStages)
        .where(
          and(
            eq(schema.breedLifecycleStages.tenant_id, tenantId),
            or(isNull(schema.breedLifecycleStages.company_id), eq(schema.breedLifecycleStages.company_id, batch.company_id)),
            batch.farm_id
              ? or(isNull(schema.breedLifecycleStages.farm_id), eq(schema.breedLifecycleStages.farm_id, batch.farm_id))
              : isNull(schema.breedLifecycleStages.farm_id),
            eq(schema.breedLifecycleStages.breed_id, h.breed_id!),
            eq(schema.breedLifecycleStages.stage_id, h.stage_id),
            eq(schema.breedLifecycleStages.is_active, true),
            isNotNull(schema.breedLifecycleStages.kpi_thresholds),
          ),
        );
      const byId = new Map<string, (typeof rows)[number]>();
      const candidates: FeedRow[] = [];
      for (const r of rows) {
        let range: { fromDay: number; toDay: number };
        try {
          range = stageDayRange(r.calc_unit, r.period_from, r.period_to);
        } catch {
          continue; // corrupt row: the feed side names it loudly; here it is just skipped
        }
        byId.set(r.lifecycle_id, r);
        candidates.push({
          lifecycleId: r.lifecycle_id,
          breedId: r.breed_id,
          stageId: r.stage_id,
          itemId: r.feed_item_id ?? '',
          itemName: null,
          fromDay: range.fromDay,
          toDay: range.toDay,
          kgPerHeadPerDay: 0,
          wastagePct: 0,
          farmId: r.farm_id ?? null,
        });
      }
      // Day-in-stage counts from the stage start (day 1), the same stretch the feed rows use.
      const dayInStage = daysBetween(h.effective_from, date) + 1;
      const found = feedRowFor(candidates, dayInStage, batch.farm_id);
      if ('error' in found) {
        if (found.error === 'OVERLAP') this.logger.warn(`Batch ${batch.batch_no}: several lifecycle rows cover day ${dayInStage} of the stage; KPI check skipped.`);
        continue;
      }
      const stageRow = byId.get(found.row.lifecycleId)!;
      const lines = (Array.isArray(stageRow.kpi_thresholds) ? stageRow.kpi_thresholds : []) as LifecycleKpiLine[];
      const wanted = lines.filter((l) => l?.metric && (!metrics || metrics.includes(l.metric)));
      if (!wanted.length) continue;
      written += await this.evaluateLines(batch, tenantId, h.scheduler_id, wanted, stageRow.kpi_alert_period, date, h.effective_from, dayInStage);
    }
    return written;
  }

  private async evaluateLines(
    batch: { batch_id: string; batch_no: string; company_id: string; lob_id: string | null; opening_quantity?: string | number | null },
    tenantId: string,
    schedulerId: string,
    lines: LifecycleKpiLine[],
    headerPeriod: string | null,
    date: string,
    stageStart: string,
    dayInStage: number,
  ): Promise<number> {
    const period = effectivePeriod(headerPeriod);
    const metricCodes = [...new Set(lines.map((l) => l.metric))];
    const earliest = periodWindow(period, date).from;

    // The aggregation comes from each line's UOM (percent -> % of heads, count -> sum, otherwise average).
    const uomCodes = [...new Set(lines.map((l) => l.uom).filter((u): u is string => !!u))];
    const uomRows = uomCodes.length
      ? await this.db
          .select({ uom_code: schema.uomMaster.uom_code, uom_name: schema.uomMaster.uom_name, uom_type: schema.uomMaster.uom_type })
          .from(schema.uomMaster)
          .where(and(eq(schema.uomMaster.tenant_id, tenantId), inArray(schema.uomMaster.uom_code, uomCodes)))
      : [];
    const aggregationOf = (l: LifecycleKpiLine) => aggregationForUom(l.uom, uomRows.find((u) => u.uom_code === l.uom));
    const data = await this.db
      .select({ metric: schema.schedulerLine.kpi_metric, date: schema.batchDailyData.entry_date, value: schema.batchDailyData.entered_value })
      .from(schema.batchDailyData)
      .innerJoin(schema.schedulerLine, eq(schema.schedulerLine.line_id, schema.batchDailyData.line_id))
      .where(
        and(
          eq(schema.batchDailyData.batch_id, batch.batch_id),
          eq(schema.batchDailyData.posted, true),
          // Only this stage's own lines: a batch carries one scheduler per stage, each with its own KPI lines.
          eq(schema.schedulerLine.scheduler_id, schedulerId),
          inArray(schema.schedulerLine.kpi_metric, metricCodes),
          isNotNull(schema.batchDailyData.entered_value),
          gte(schema.batchDailyData.entry_date, earliest),
          lte(schema.batchDailyData.entry_date, date),
        ),
      );
    const valuesBy = new Map<string, KpiValue[]>();
    for (const d of data) {
      if (!d.metric || d.value === null) continue;
      const list = valuesBy.get(d.metric) ?? [];
      const entryDate = String(d.date).slice(0, 10);
      list.push({ date: entryDate, value: Number(d.value), dayInStage: daysBetween(stageStart, entryDate) + 1 });
      valuesBy.set(d.metric, list);
    }

    let written = 0;
    for (const line of lines) {
      const values = valuesBy.get(line.metric);
      if (!values?.length) continue;
      const window = lineWindow(line);
      if (!dayInWindow(dayInStage, window)) continue;
      const aggregation = aggregationOf(line);
      let headsAtStart: number | null = null;
      if (aggregation === 'PCT_OF_HEADS') {
        // Period start, or the window's first day if that is later.
        const windowStart = window.fromDay !== null ? addDays(stageStart, window.fromDay - 1) : stageStart;
        const start = [periodWindow(period, date).from, windowStart].reduce((a, b) => (a > b ? a : b));
        headsAtStart = await this.headsAtStartOf(batch, start);
        if (!headsAtStart) {
          this.logger.warn(`Batch ${batch.batch_no}, KPI ${line.metric}: head count at ${start} is unknown or zero; the % of heads check was skipped for ${periodMarker(period, periodWindow(period, date).key)}`);
          continue;
        }
      }
      for (const b of evaluateLifecycleKpiLine(line, headerPeriod, values, date, { aggregation, headsAtStart, dayInStage })) {
        if (await this.alreadyAlerted(batch.batch_id, line.metric, b)) continue;
        await this.db.insert(schema.notificationAlertLog).values({
          alert_id: randomUUID(),
          tenant_id: tenantId,
          company_id: batch.company_id,
          lob_id: batch.lob_id,
          batch_id: batch.batch_id,
          alert_type: LIFECYCLE_KPI_ALERT_TYPE,
          severity: b.severity,
          title: `${line.metric} ${b.direction === 'below' ? 'Below' : 'Above'} ${b.rule === 'TOLERANCE' ? 'Tolerance' : 'Lifecycle Limit'} — Batch ${batch.batch_no}`,
          message: `Batch ${batch.batch_no}, KPI ${line.metric}: ${b.message}${b.toleranceDesc ? ` (tolerance ${b.toleranceDesc})` : ''}. ${periodMarker(b.period, b.periodKey)}`,
          activity_name: line.metric,
          // kpi_mode is varchar(10): it carries the rule (LOWER, UPPER, TOL_UPPER, TOL_LOWER) for the dedupe.
          kpi_mode: ruleMode(b),
          expected_value: num(line.average_value) !== null ? String(num(line.average_value)) : String(b.threshold),
          actual_value: String(round(b.actual)),
          deviation_amount: String(round(b.actual - (num(line.average_value) ?? b.threshold))),
          deviation_pct: num(line.average_value) ? String(Number((((b.actual - num(line.average_value)!) / num(line.average_value)!) * 100).toFixed(2))) : null,
          kpi_min: num(line.lower_limit) !== null ? String(num(line.lower_limit)) : null,
          kpi_max: num(line.upper_limit) !== null ? String(num(line.upper_limit)) : null,
        });
        written += 1;
      }
    }
    return written;
  }

  /**
   * Heads in the batch at the start of `start`: opening quantity less the deaths before it, from the shared rule in
   * ../batch-heads (batch_transaction MORTALITY plus posted MORTALITY_COUNT entries). The feed forecast uses the same.
   */
  private async headsAtStartOf(batch: { batch_id: string; opening_quantity?: string | number | null }, start: string): Promise<number | null> {
    const opening = Number(batch.opening_quantity);
    if (!Number.isFinite(opening) || opening <= 0) return null;
    const heads = await headsAtStartOfDate(this.db, batch.batch_id, opening, start);
    return heads > 0 ? heads : null;
  }

  private async alreadyAlerted(batchId: string, metric: string, b: KpiBreach): Promise<boolean> {
    const rows = await this.db
      .select({ alert_id: schema.notificationAlertLog.alert_id })
      .from(schema.notificationAlertLog)
      .where(
        and(
          eq(schema.notificationAlertLog.batch_id, batchId),
          eq(schema.notificationAlertLog.alert_type, LIFECYCLE_KPI_ALERT_TYPE),
          eq(schema.notificationAlertLog.activity_name, metric),
          eq(schema.notificationAlertLog.kpi_mode, ruleMode(b)),
          like(schema.notificationAlertLog.message, `%${periodMarker(b.period, b.periodKey)}`),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}

/** varchar(10) rule tag stored in kpi_mode. */
function ruleMode(b: KpiBreach): string {
  if (b.rule === 'LOWER_LIMIT') return 'LOWER';
  if (b.rule === 'UPPER_LIMIT') return 'UPPER';
  return b.direction === 'above' ? 'TOL_UPPER' : 'TOL_LOWER';
}

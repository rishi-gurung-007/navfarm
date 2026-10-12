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
import { feedRowFor, stageDayRange, type FeedRow } from './feed-row-days';

export const LIFECYCLE_KPI_ALERT_TYPE = 'LIFECYCLE_KPI';

export type KpiPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type KpiRule = 'LOWER_LIMIT' | 'UPPER_LIMIT' | 'TOLERANCE';

export interface LifecycleKpiLine {
  metric: string;
  uom?: string | null;
  kpi_period?: string | null;
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

const PERIODS: KpiPeriod[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export function effectivePeriod(line: Pick<LifecycleKpiLine, 'kpi_period'>, headerPeriod?: string | null): KpiPeriod {
  const pick = [line.kpi_period, headerPeriod].find((p) => p && PERIODS.includes(p as KpiPeriod));
  return (pick as KpiPeriod) ?? 'DAILY';
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
  if (period === 'MONTHLY') return { from: `${date.slice(0, 7)}-01`, key: date.slice(0, 7) };
  return { from: date, key: date };
}

/** DAILY: the day's value; WEEKLY/MONTHLY: the average of every value entered from the period start up to and including `date`. */
export function actualForPeriod(values: KpiValue[], period: KpiPeriod, date: string): { actual: number; key: string } | null {
  const { from, key } = periodWindow(period, date);
  const inWindow = values.filter((v) => v.date >= from && v.date <= date);
  if (!inWindow.length) return null;
  // DAILY with several rows that day (animal-wise entry) reads as their mean, same as the longer periods.
  const actual = inWindow.reduce((s, v) => s + v.value, 0) / inWindow.length;
  return { actual, key };
}

const round = (n: number) => Number(n.toFixed(4));

/** Everything one KPI line says about `values` on `date`. Empty when nothing is breached or nothing was entered. */
export function evaluateLifecycleKpiLine(line: LifecycleKpiLine, headerPeriod: string | null | undefined, values: KpiValue[], date: string): KpiBreach[] {
  const period = effectivePeriod(line, headerPeriod);
  const got = actualForPeriod(values, period, date);
  if (!got) return [];
  const { actual, key } = got;
  const severity = line.severity === 'INFO' || line.severity === 'CRITICAL' ? line.severity : 'WARNING';
  const unit = line.uom ? ` ${line.uom}` : '';
  const out: KpiBreach[] = [];
  const lower = num(line.lower_limit);
  const upper = num(line.upper_limit);
  const avg = num(line.average_value);
  const tolPct = num(line.tolerance_pct);

  if (lower !== null && actual < lower) {
    out.push({ rule: 'LOWER_LIMIT', period, periodKey: key, actual, threshold: lower, severity, direction: 'below', message: `actual ${round(actual)}${unit} is below the lower limit ${lower}${unit}` });
  }
  if (upper !== null && actual > upper) {
    out.push({ rule: 'UPPER_LIMIT', period, periodKey: key, actual, threshold: upper, severity, direction: 'above', message: `actual ${round(actual)}${unit} is above the upper limit ${upper}${unit}` });
  }
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
          effectiveFrom: r.effective_from ?? null,
          effectiveTo: r.effective_to ?? null,
          farmId: r.farm_id ?? null,
        });
      }
      // Day-in-stage counts from the stage start (day 1), the same stretch the feed rows use.
      const dayInStage = daysBetween(h.effective_from, date) + 1;
      const found = feedRowFor(candidates, dayInStage, date, batch.farm_id);
      if ('error' in found) {
        if (found.error === 'OVERLAP') this.logger.warn(`Batch ${batch.batch_no}: several lifecycle rows cover day ${dayInStage} of the stage; KPI check skipped.`);
        continue;
      }
      const stageRow = byId.get(found.row.lifecycleId)!;
      const lines = (Array.isArray(stageRow.kpi_thresholds) ? stageRow.kpi_thresholds : []) as LifecycleKpiLine[];
      const wanted = lines.filter((l) => l?.metric && (!metrics || metrics.includes(l.metric)));
      if (!wanted.length) continue;
      written += await this.evaluateLines(batch, tenantId, h.scheduler_id, wanted, stageRow.kpi_alert_period, date);
    }
    return written;
  }

  private async evaluateLines(
    batch: { batch_id: string; batch_no: string; company_id: string; lob_id: string | null },
    tenantId: string,
    schedulerId: string,
    lines: LifecycleKpiLine[],
    headerPeriod: string | null,
    date: string,
  ): Promise<number> {
    const metricCodes = [...new Set(lines.map((l) => l.metric))];
    const earliest = lines.reduce((min, l) => {
      const from = periodWindow(effectivePeriod(l, headerPeriod), date).from;
      return from < min ? from : min;
    }, date);
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
      list.push({ date: String(d.date).slice(0, 10), value: Number(d.value) });
      valuesBy.set(d.metric, list);
    }

    let written = 0;
    for (const line of lines) {
      const values = valuesBy.get(line.metric);
      if (!values?.length) continue;
      for (const b of evaluateLifecycleKpiLine(line, headerPeriod, values, date)) {
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

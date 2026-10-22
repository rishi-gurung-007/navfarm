/**
 * A scheduler's activities, filled in from its breed lifecycle stage (Rishi, 14 Oct).
 *
 * Everything the stage says a batch should do becomes an activity line of the scheduler — there are no separate
 * feed or KPI lists on a scheduler any more:
 *   - Feed Consumption lines   -> daily CONSUMPTION lines over their stage days
 *   - Resource Requirements    -> RESOURCE lines over the stage
 *   - Vaccination Protocol     -> CONSUMPTION lines on the day the batch reaches the vaccination age
 *   - Medication Protocol      -> as-needed CONSUMPTION lines: not mandatory, no quantity set, entered when treating
 *   - KPIs & Alerts            -> DESCRIPTIVE (data entry) lines carrying the KPI's average and alert limits
 *   - Mortality / Output / Body weight standards, as before, unless a KPI line already covers that metric.
 *
 * The same lines are what auto-create writes and what the Create Scheduler form starts from; the user may change them
 * there, and once the scheduler exists they are fixed.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { stageDayRange } from '../lifecycle/feed-row-days';
import { wantedVaccinations } from '../lifecycle/vaccination-lines';
import { kpiLimits } from '../lifecycle/kpi-limits';

export interface StageLineDraft {
  line_type: 'CONSUMPTION' | 'OUTPUT' | 'DESCRIPTIVE' | 'RESOURCE';
  activity_name: string;
  occurrence: 'DAILY' | 'WEEKLY' | 'ONCE' | 'CUSTOM';
  start_day: number;
  end_day: number | null;
  day_of_week: number | null;
  custom_days: number[] | null;
  is_mandatory: boolean;
  item_id?: string | null;
  item_description?: string | null;
  standard_qty?: number | null;
  qty_basis?: string | null;
  allow_qty_edit?: boolean;
  lot_required?: boolean;
  creates_inventory?: boolean;
  output_lot_auto?: boolean;
  output_basis?: string | null;
  kpi_metric?: string | null;
  kpi_uom?: string | null;
  std_value?: number | null;
  lower_alert_limit?: number | null;
  upper_alert_limit?: number | null;
  alert_severity?: string | null;
  capture_per?: string | null;
  resource_id?: string | null;
  resource_name?: string | null;
  /** What a line carries that has no column: a medication's problems, symptoms, dose and repeat; a resource's notes. */
  extension_config?: Record<string, unknown> | null;
  lifecycle_ref_id: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Metrics that are counted (the day's total), not measured (the average of what was weighed or scored). */
const COUNT_METRICS = new Set(['MORTALITY_COUNT', 'HEAD_COUNT', 'PIGLETS_BORN', 'LITTER_SIZE', 'EGG_COUNT']);

export interface KpiLineInput {
  metric?: unknown;
  uom?: unknown;
  from_day?: unknown;
  to_day?: unknown;
  average_value?: unknown;
  tolerance_pct?: unknown;
  tolerance_type?: unknown;
  lower_limit?: unknown;
  upper_limit?: unknown;
  severity?: unknown;
}

/**
 * One KPIs & Alerts line as a data-entry line. Its alert limits are the average less / plus the tolerance — only the
 * upper one for an Upper tolerance, only the lower for a Lower, both when no side is given — or the limits an older
 * line stored directly. Weekly KPIs are entered once a week (Monday), daily ones every day, over the KPI's stage days.
 */
export function kpiLineDraft(
  line: KpiLineInput,
  ctx: { period: string | null | undefined; stageEndDay: number | null; metricName?: string | null; uom: string | null; lifecycleId: string | null },
): StageLineDraft | null {
  const metric = typeof line.metric === 'string' ? line.metric.trim() : '';
  if (!metric) return null;
  const { average: avg, lower, upper } = kpiLimits(line);
  const weekly = String(ctx.period ?? '').toUpperCase() === 'WEEKLY';
  const from = num(line.from_day);
  const to = num(line.to_day);
  const severity = typeof line.severity === 'string' && line.severity ? line.severity.toUpperCase() : 'WARNING';
  return {
    line_type: 'DESCRIPTIVE',
    activity_name: `KPI: ${ctx.metricName || metric.replace(/_/g, ' ')}`,
    occurrence: weekly ? 'WEEKLY' : 'DAILY',
    start_day: from && from >= 1 ? Math.floor(from) : 1,
    end_day: to && to >= 1 ? Math.floor(to) : ctx.stageEndDay,
    day_of_week: weekly ? 1 : null,
    custom_days: null,
    is_mandatory: metric === 'MORTALITY_COUNT',
    kpi_metric: metric,
    kpi_uom: ctx.uom,
    capture_per: COUNT_METRICS.has(metric) ? 'TOTAL' : 'AVERAGE',
    std_value: avg,
    lower_alert_limit: lower,
    upper_alert_limit: upper,
    alert_severity: severity,
    lifecycle_ref_id: ctx.lifecycleId,
  };
}

export interface MedicationRow {
  problem?: unknown;
  symptom?: unknown;
  medicine_item_id?: unknown;
  dose?: unknown;
  repeat?: unknown;
  withdrawal_days?: unknown;
}

/**
 * The Medication Protocol as as-needed lines: one per drug (a drug can treat several problems, and two lines of one
 * item on the same days would clash), not mandatory and with no set quantity — it is entered on the day an animal is
 * treated. The treatment card (problem, symptom, dose, repeat) rides on the line.
 */
export function medicationLineDrafts(
  rows: unknown,
  ctx: { stageEndDay: number | null; items: Map<string, { item_name: string; tracked: boolean }>; lifecycleId: string | null },
): StageLineDraft[] {
  if (!Array.isArray(rows)) return [];
  const byDrug = new Map<string, MedicationRow[]>();
  for (const r of rows as MedicationRow[]) {
    const id = typeof r?.medicine_item_id === 'string' ? r.medicine_item_id : '';
    if (!id || !ctx.items.has(id)) continue;
    byDrug.set(id, [...(byDrug.get(id) ?? []), r]);
  }
  return [...byDrug.entries()].map(([itemId, cards]) => {
    const item = ctx.items.get(itemId)!;
    const problems = [...new Set(cards.map((c) => String(c.problem ?? '').trim()).filter(Boolean))];
    return {
      line_type: 'CONSUMPTION' as const,
      activity_name: `Medication: ${item.item_name}${problems.length ? ` — ${problems.join(', ')}` : ''}`,
      occurrence: 'DAILY' as const,
      start_day: 1,
      end_day: ctx.stageEndDay,
      day_of_week: null,
      custom_days: null,
      is_mandatory: false,
      item_id: itemId,
      item_description: item.item_name,
      standard_qty: 0,
      qty_basis: 'PER_HEAD',
      allow_qty_edit: true,
      lot_required: item.tracked,
      extension_config: {
        as_needed: true,
        treatments: cards.map((c) => ({
          problem: c.problem ?? null, symptom: c.symptom ?? null, dose: c.dose ?? null,
          repeat: c.repeat ?? null, withdrawal_days: num(c.withdrawal_days),
        })),
      },
      lifecycle_ref_id: ctx.lifecycleId,
    };
  });
}

export interface ResourceRow { resource_id?: unknown; quantity?: unknown; notes?: unknown }

/** Resource Requirements as RESOURCE lines over the stage, one per resource (quantities of one resource added up). */
export function resourceLineDrafts(
  rows: unknown,
  ctx: { stageEndDay: number | null; resources: Map<string, string>; lifecycleId: string | null },
): StageLineDraft[] {
  if (!Array.isArray(rows)) return [];
  const byResource = new Map<string, { qty: number | null; notes: string[] }>();
  for (const r of rows as ResourceRow[]) {
    const id = typeof r?.resource_id === 'string' ? r.resource_id : '';
    if (!id || !ctx.resources.has(id)) continue;
    const prev = byResource.get(id) ?? { qty: null, notes: [] };
    const q = num(r.quantity);
    byResource.set(id, {
      qty: q === null ? prev.qty : (prev.qty ?? 0) + q,
      notes: r.notes ? [...prev.notes, String(r.notes)] : prev.notes,
    });
  }
  return [...byResource.entries()].map(([resourceId, r]) => ({
    line_type: 'RESOURCE' as const,
    activity_name: `Resource: ${ctx.resources.get(resourceId)}`,
    occurrence: 'DAILY' as const,
    start_day: 1,
    end_day: ctx.stageEndDay,
    day_of_week: null,
    custom_days: null,
    is_mandatory: false,
    resource_id: resourceId,
    resource_name: ctx.resources.get(resourceId) ?? null,
    standard_qty: r.qty,
    extension_config: r.notes.length ? { notes: r.notes.join('; ') } : null,
    lifecycle_ref_id: ctx.lifecycleId,
  }));
}

/** The KPI UOM a metric is recorded in, when the KPI line names none. */
export const KPI_METRIC_DEFAULT_UOM: Record<string, string> = {
  BODY_WEIGHT: 'KG', FCR: 'RATIO', ADG: 'G_DAY', BCS_SCORE: 'SCORE', MORTALITY_COUNT: 'HEAD', TEMPERATURE: 'CELSIUS',
  HEAD_COUNT: 'HEAD', LITTER_SIZE: 'HEAD', WEANING_WEIGHT: 'KG', PIGLETS_BORN: 'HEAD', SEMEN_MOTILITY: 'PCT', EGG_COUNT: 'NOS',
  MILK_LITRES: 'LITRES',
};

/** The stage's activities for a batch entering it on `effectiveFrom` (stage day 1). Empty when the breed has no row for the stage. */
export async function buildStageSchedulerLines(
  db: MySql2Database<typeof schema>,
  args: { batch: typeof schema.batchHeader.$inferSelect; stageId: string; stage: typeof schema.stageMaster.$inferSelect; effectiveFrom?: string | null },
): Promise<StageLineDraft[]> {
  const { batch, stageId, stage } = args;
  if (!batch.breed_id) return [];
  const t = schema.breedLifecycleStages;
  const rows = await db.select().from(t)
    .where(and(eq(t.breed_id, batch.breed_id), eq(t.stage_id, stageId), eq(t.is_active, true), isNull(t.retired_at)))
    .orderBy(t.period_from);
  if (!rows.length) return [];
  // The stage's own facts (KPIs, protocols, standards) are on each of its rows; the first speaks for the stage.
  const [lifecycle] = rows;
  const stageEndDay = stage.typical_duration_days ? Number(stage.typical_duration_days) : null;

  // Everything the lines name, looked up once.
  const asArray = (v: unknown) => (Array.isArray(v) ? v as Array<Record<string, unknown>> : []);
  const itemIds = new Set<string>();
  for (const r of rows) if (r.feed_item_id) itemIds.add(r.feed_item_id);
  if (lifecycle.output_item_id) itemIds.add(lifecycle.output_item_id);
  for (const v of asArray(lifecycle.vaccination_protocol)) if (typeof v.vaccine_item_id === 'string') itemIds.add(v.vaccine_item_id);
  for (const m of asArray(lifecycle.medication_protocol)) if (typeof m.medicine_item_id === 'string') itemIds.add(m.medicine_item_id);
  const items = new Map((itemIds.size ? await db
    .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, lot: schema.itemMaster.is_lot_tracked, serial: schema.itemMaster.is_serial_tracked })
    .from(schema.itemMaster)
    .where(and(inArray(schema.itemMaster.item_id, [...itemIds]), isNull(schema.itemMaster.deleted_at))) : [])
    .map((i) => [i.item_id, { item_name: i.item_name, tracked: Boolean(i.lot || i.serial) }]));
  const resourceIds = asArray(lifecycle.resource_requirements).map((r) => r.resource_id).filter((id): id is string => typeof id === 'string');
  const resources = new Map((resourceIds.length ? await db
    .select({ resource_id: schema.resourceMaster.resource_id, resource_name: schema.resourceMaster.resource_name })
    .from(schema.resourceMaster).where(inArray(schema.resourceMaster.resource_id, resourceIds)) : [])
    .map((r) => [r.resource_id, r.resource_name]));
  const kpiRows = asArray(lifecycle.kpi_thresholds);
  const metricCodes = [...new Set(kpiRows.map((k) => k.metric).filter((m): m is string => typeof m === 'string' && !!m))];
  const metrics = new Map((metricCodes.length ? await db
    .select({ code: schema.kpiMetricMaster.metric_code, name: schema.kpiMetricMaster.metric_name, uom: schema.kpiMetricMaster.default_uom })
    .from(schema.kpiMetricMaster)
    .where(and(inArray(schema.kpiMetricMaster.metric_code, metricCodes), sql`(${schema.kpiMetricMaster.company_id} IS NULL OR ${schema.kpiMetricMaster.company_id} = ${batch.company_id})`)) : [])
    .map((m) => [m.code, m]));

  const lines: StageLineDraft[] = [];

  // Feed Consumption lines: one daily line per feed line, over its stage days.
  for (const row of rows) {
    if (!row.feed_item_id || !(Number(row.feed_qty_per_head_per_day_kg) > 0)) continue;
    const { fromDay, toDay } = stageDayRange(row.calc_unit, row.period_from, row.period_to);
    const item = items.get(row.feed_item_id);
    lines.push({
      line_type: 'CONSUMPTION',
      activity_name: `${stage.stage_name} Feed — ${item?.item_name ?? 'Unknown Item'}`,
      occurrence: 'DAILY', start_day: fromDay, end_day: toDay, day_of_week: null, custom_days: null,
      is_mandatory: true, item_id: row.feed_item_id, item_description: item?.item_name ?? null,
      standard_qty: Number(row.feed_qty_per_head_per_day_kg), qty_basis: 'PER_HEAD', allow_qty_edit: true,
      lot_required: item?.tracked ?? false, lifecycle_ref_id: row.lifecycle_id,
    });
  }

  // Resource Requirements.
  lines.push(...resourceLineDrafts(lifecycle.resource_requirements, { stageEndDay, resources, lifecycleId: lifecycle.lifecycle_id }));

  // Vaccination Protocol: by age in weeks, from the batch's oldest animal's date of birth (vaccination-lines.ts).
  if (args.effectiveFrom) {
    const [{ dob }] = await db.select({ dob: sql<string | null>`MIN(${schema.animalRegister.dob})` }).from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, batch.batch_id), eq(schema.animalRegister.is_active, true)));
    const wanted = wantedVaccinations(lifecycle.vaccination_protocol, dob ? String(dob).slice(0, 10) : null, String(args.effectiveFrom).slice(0, 10), stageEndDay);
    for (const w of wanted) {
      const item = items.get(w.itemId);
      if (!item) continue;
      lines.push({
        line_type: 'CONSUMPTION',
        activity_name: `Vaccination: ${item.item_name} (age ${w.weeks} weeks)`,
        occurrence: 'CUSTOM', start_day: w.day, end_day: w.day, day_of_week: null, custom_days: [w.day],
        is_mandatory: true, item_id: w.itemId, item_description: item.item_name,
        standard_qty: w.doseMl, qty_basis: 'PER_HEAD', allow_qty_edit: true, lot_required: item.tracked,
        lifecycle_ref_id: lifecycle.lifecycle_id,
      });
    }
  }

  // Medication Protocol, as needed.
  lines.push(...medicationLineDrafts(lifecycle.medication_protocol, { stageEndDay, items, lifecycleId: lifecycle.lifecycle_id }));

  // KPIs & Alerts.
  const kpiLines = kpiRows
    .map((k) => {
      const m = typeof k.metric === 'string' ? metrics.get(k.metric) : undefined;
      const uom = (typeof k.uom === 'string' && k.uom) || m?.uom || (typeof k.metric === 'string' ? KPI_METRIC_DEFAULT_UOM[k.metric] : null) || null;
      return kpiLineDraft(k, { period: lifecycle.kpi_alert_period, stageEndDay, metricName: m?.name ?? null, uom, lifecycleId: lifecycle.lifecycle_id });
    })
    .filter((l): l is StageLineDraft => l !== null);
  lines.push(...kpiLines);
  const kpiMetrics = new Set(kpiLines.map((l) => l.kpi_metric));

  // The stage's standards, unless a KPI line already captures that metric.
  if (lifecycle.std_mortality_rate_pct && !kpiMetrics.has('MORTALITY_COUNT')) {
    lines.push({
      line_type: 'DESCRIPTIVE', activity_name: `${stage.stage_name} Mortality`,
      occurrence: 'DAILY', start_day: 1, end_day: null, day_of_week: null, custom_days: null, is_mandatory: true,
      kpi_metric: 'MORTALITY_COUNT', kpi_uom: KPI_METRIC_DEFAULT_UOM.MORTALITY_COUNT, capture_per: 'TOTAL',
      std_value: num(lifecycle.std_mortality_rate_pct), alert_severity: 'CRITICAL', lifecycle_ref_id: lifecycle.lifecycle_id,
    });
  }
  if (lifecycle.output_item_id && lifecycle.std_output_qty) {
    const item = items.get(lifecycle.output_item_id);
    lines.push({
      line_type: 'OUTPUT', activity_name: `${stage.stage_name} Output`,
      occurrence: 'ONCE', start_day: stageEndDay || 1, end_day: null, day_of_week: null, custom_days: null, is_mandatory: false,
      item_id: lifecycle.output_item_id, item_description: item?.item_name ?? null,
      standard_qty: num(lifecycle.std_output_qty), output_basis: 'PER_BATCH', creates_inventory: true, output_lot_auto: true,
      lifecycle_ref_id: lifecycle.lifecycle_id,
    });
  } else if (lifecycle.std_body_weight_kg && !kpiMetrics.has('BODY_WEIGHT')) {
    lines.push({
      line_type: 'DESCRIPTIVE', activity_name: `${stage.stage_name} Body Weight Check`,
      occurrence: 'WEEKLY', start_day: 7, end_day: null, day_of_week: 1, custom_days: null, is_mandatory: false,
      kpi_metric: 'BODY_WEIGHT', kpi_uom: KPI_METRIC_DEFAULT_UOM.BODY_WEIGHT, capture_per: 'AVERAGE',
      std_value: num(lifecycle.std_body_weight_kg), alert_severity: 'WARNING', lifecycle_ref_id: lifecycle.lifecycle_id,
    });
  }
  return lines;
}

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, inArray, count, sql, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, batchScopeConditions, batchOnFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import {
  CreateSchedulerHeaderDto, UpdateSchedulerHeaderDto,
  CreateSchedulerLineDto, UpdateSchedulerLineDto, UpdateSchedulerHeaderStatusDto, QuerySchedulerHeaderDto,
  SchedulerSource, CopySchedulerLinesDto,
} from './dto/scheduler-header.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { syncVaccinationLines } from '../lifecycle/vaccination-sync';
import { stageDayRange } from '../lifecycle/feed-row-days';
import { stagesNeedingScheduler } from './occupied-stages';
import { applySchedulerFeedLines, type WantedFeedLine } from '../lifecycle/refresh-scheduler-feed';
import { feedQtyToKg } from '../lifecycle/feed-qty-kg';
import { validateFeedLines, type FeedLine } from '../../master-data/breed/lifecycle-feed-lines';

/** "KPI UOM fetched as per KPI" — the unit a given kpi_metric is captured in isn't a free
 * choice, it's implied by the metric itself. Known metrics auto-derive kpi_uom (overriding
 * whatever a caller sends); an unrecognized/CUSTOM metric falls back to whatever was supplied. */
const KPI_METRIC_UOM: Record<string, string> = {
  BODY_WEIGHT: 'KG', ADG: 'GRAM', FCR: 'RATIO', MORTALITY_COUNT: 'HEAD', HEAD_COUNT: 'HEAD',
  BCS_SCORE: 'SCORE', TEMPERATURE: 'CELSIUS', LITTER_SIZE: 'HEAD', WEANING_WEIGHT: 'KG',
  PIGLETS_BORN: 'HEAD', SEMEN_MOTILITY: 'PCT', EGG_COUNT: 'HEAD', MILK_LITRES: 'LITRE',
};

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');
const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

/** A parsed entry from breed_lifecycle_stages.medication_protocol / vaccination_protocol —
 * `[{ day, medicine|vaccine, dose, route, withdrawal_days? }]`, confirmed against real seeded
 * data (52 rows in tenant_navfarmdev). No real resource_requirements data exists yet to confirm
 * its shape, so that one is parsed defensively with the same {day, name} convention. */
interface ProtocolEntry { day: number; name: string; }

function parseProtocolEntries(value: unknown, nameKey: string): ProtocolEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const day = Number((entry as Record<string, unknown>).day);
      const name = (entry as Record<string, unknown>)[nameKey];
      if (!Number.isFinite(day) || typeof name !== 'string' || !name.trim()) return null;
      return { day, name: name.trim() };
    })
    .filter((e): e is ProtocolEntry => e !== null);
}

/** Which scheduler_line columns a given line_type actually uses — the "LINE TYPE REFERENCE"
 * sheet in Master Templates/Schedule_master_template.xlsx, encoded as validation instead of a
 * printed matrix. */
const LINE_TYPE_FIELDS: Record<string, { required: string[]; forbidden?: string[] }> = {
  CONSUMPTION: { required: ['item_id', 'standard_qty', 'qty_basis'] },
  OUTPUT: { required: ['item_id', 'standard_qty', 'output_basis'] },
  DESCRIPTIVE: { required: ['kpi_metric', 'kpi_uom', 'capture_per'] },
  OVERHEAD: { required: ['overhead_category'] },
  RESOURCE: { required: ['resource_id'] },
  TRANSFER: { required: ['item_id', 'standard_qty'] },
};

export interface CreateForStageOptions { source?: SchedulerSource }

/** The activity columns a batch's scheduler_line and a system_scheduler_line share — what a copy carries across. */
export const SHARED_LINE_KEYS = [
  'line_type', 'activity_name', 'occurrence', 'start_day', 'end_day', 'day_of_week', 'is_mandatory',
  'item_id', 'item_description', 'standard_qty', 'qty_basis', 'allow_qty_edit', 'lot_required',
  'creates_inventory', 'output_lot_auto', 'output_basis', 'auto_triggers_stage',
  'kpi_metric', 'kpi_uom', 'std_value', 'lower_alert_limit', 'upper_alert_limit', 'alert_severity', 'capture_per',
  'overhead_category', 'gl_account', 'estimated_cost', 'resource_id',
] as const;

export function pickLineFields(line: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SHARED_LINE_KEYS.filter((k) => k in line).map((k) => [k, line[k]]));
}

@Injectable()
export class SchedulerHeaderService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeries: NumberSeriesService,
  ) {}

  /**
   * The readable number a new scheduler is shown by (SCH-000001), from the company's SCHEDULER series. A company
   * created after 12 Oct starts with no master data and so no series at all (client ruling); the series is made the
   * first time it is needed, as supplier and customer codes do, carrying on after any number the company already
   * holds — nobody has to know a SCHEDULER series exists before a stage can be scheduled.
   */
  private async nextSchedulerNo(tenantId: string, companyId: string): Promise<string> {
    await this.numberSeries.ensureCompanySeries(
      tenantId,
      companyId,
      { seriesCode: 'SCHEDULER', seriesName: 'Scheduler Number', documentType: 'SCHEDULER', prefix: 'SCH', separator: '-', seqLength: 6 },
      async () => (await this.db.select({ no: schema.schedulerHeader.scheduler_no }).from(schema.schedulerHeader)
        .where(eq(schema.schedulerHeader.company_id, companyId))).map((r) => r.no),
    );
    return this.numberSeries.generateNext('SCHEDULER', tenantId, companyId);
  }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * Best-effort match of a free-text medicine/vaccine name (from
   * breed_lifecycle_stages' protocol JSON) against the tenant's real item catalog —
   * "Ivermectin 1%" -> an item named "Ivermectin 1% Injection", matched on the first
   * significant word. Returns null (line simply isn't generated) rather than guessing
   * wrong; a farm manager can always add the line manually afterward.
   */
  private async findItemByName(tenantId: string, companyId: string, name: string) {
    const firstWord = name.split(/[\s(+]/)[0];
    if (!firstWord) return null;
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(
        eq(schema.itemMaster.tenant_id, tenantId),
        like(schema.itemMaster.item_name, `%${firstWord}%`),
        eq(schema.itemMaster.is_active, true),
      ))
      .limit(1);
    return item || null;
  }

  /**
   * Auto-generates this stage's scheduler_line rows from breed_lifecycle_stages
   * (feed -> CONSUMPTION, mortality -> DESCRIPTIVE, output/weight -> OUTPUT or
   * DESCRIPTIVE, medication/vaccination protocol entries -> CUSTOM-occurrence
   * CONSUMPTION lines). No-ops (header stays empty, for MANUAL lines) when the
   * batch has no breed or the breed has no lifecycle data for this stage —
   * true for most breeds today, per suggestParameterLines()'s own history.
   */
  private async generateLinesFromLifecycle(
    schedulerId: string,
    batch: typeof schema.batchHeader.$inferSelect,
    stageId: string,
    stage: typeof schema.stageMaster.$inferSelect,
    /** The scheduler's stage entry date (day 1), for vaccinations by age. */
    effectiveFrom?: string | null,
  ) {
    if (!batch.breed_id) return;
    // All active rows for this breed+stage, oldest period first — not just one. A stage can
    // carry several feed standards (R1 then R2, say), each active over its own period_from..
    // period_to; data entry switches diet mid-stage by having two rows instead of editing one.
    // Non-feed facts (mortality, output/weight, protocols) still come from a single row, exactly
    // as before — orderBy makes "the first row" deterministic instead of whatever MySQL happened
    // to return.
    const lifecycleRows = await this.db
      .select()
      .from(schema.breedLifecycleStages)
      .where(and(
        eq(schema.breedLifecycleStages.breed_id, batch.breed_id),
        eq(schema.breedLifecycleStages.stage_id, stageId),
        eq(schema.breedLifecycleStages.is_active, true),
      ))
      .orderBy(asc(schema.breedLifecycleStages.period_from));
    if (!lifecycleRows.length) return;
    const [lifecycle] = lifecycleRows; // first row by period_from — mortality/output/weight/protocols below are unchanged

    let seq = 1;
    const lines: (typeof schema.schedulerLine.$inferInsert)[] = [];
    const customDaysByLine: Record<string, number[]> = {};

    // One CONSUMPTION line per row that actually carries a feed standard (a row can exist for
    // its mortality/output/protocol columns alone, with no feed_item_id). Each line's day range
    // comes from stageDayRange() — the shared rule the forecast engine also imports — so this
    // scheduler and that engine always agree on which days belong to which diet.
    // The rate is a decimal column and so a string here: '0.0000' is truthy,
    // so it is compared as a number — the forecast's loader filters with
    // gt(rate, '0'), and a zero-rate line scheduled here would be a daily
    // feed entry the forecast does not know exists.
    const feedRows = lifecycleRows.filter((row) => row.feed_item_id && Number(row.feed_qty_per_head_per_day_kg) > 0);
    for (const row of feedRows) {
      let range: { fromDay: number; toDay: number };
      try {
        range = stageDayRange(row.calc_unit, row.period_from, row.period_to);
      } catch (e) {
        // Corrupt master data is the caller's to fix in Breed Master, so it is
        // answered as a 400 naming the stage and the unit — not a bare 500.
        throw new BadRequestException(
          `Stage '${stage.stage_name}' of this batch's breed has a feed row with calculation unit '${row.calc_unit}' — ${(e as Error).message}. Fix the row in Breed Master before generating the scheduler.`,
        );
      }
      const { fromDay, toDay } = range;
      const [feedItem] = await this.db.select({ item_name: schema.itemMaster.item_name, is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, row.feed_item_id as string)).limit(1);
      lines.push({
        line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'CONSUMPTION',
        activity_name: `${stage.stage_name} Feed — ${feedItem?.item_name ?? 'Unknown Item'}`, stage_id: stageId, occurrence: 'DAILY', start_day: fromDay, end_day: toDay,
        is_mandatory: true, source: 'AUTO', lifecycle_ref_id: row.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id, item_id: row.feed_item_id,
        item_description: feedItem?.item_name ?? null,
        standard_qty: row.feed_qty_per_head_per_day_kg, qty_basis: 'PER_HEAD',
        // A lot is asked for only when the item is tracked by lot or serial — the same rule the line form applies.
        allow_qty_edit: true, lot_required: Boolean(feedItem?.is_lot_tracked || feedItem?.is_serial_tracked),
      });
    }

    if (lifecycle.std_mortality_rate_pct) {
      lines.push({
        line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'DESCRIPTIVE',
        activity_name: `${stage.stage_name} Mortality`, stage_id: stageId, occurrence: 'DAILY', start_day: 1, end_day: null,
        is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id,
        kpi_metric: 'MORTALITY_COUNT', kpi_uom: KPI_METRIC_UOM.MORTALITY_COUNT, capture_per: 'TOTAL',
        std_value: lifecycle.std_mortality_rate_pct, alert_severity: 'CRITICAL',
      });
    }

    if (lifecycle.output_item_id && lifecycle.std_output_qty) {
      const [outputItem] = await this.db.select({ item_name: schema.itemMaster.item_name }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, lifecycle.output_item_id)).limit(1);
      lines.push({
        line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'OUTPUT',
        activity_name: `${stage.stage_name} Output`, stage_id: stageId, occurrence: 'ONCE', start_day: stage.typical_duration_days || 1, end_day: null,
        is_mandatory: false, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id, item_id: lifecycle.output_item_id,
        item_description: outputItem?.item_name ?? null,
        standard_qty: lifecycle.std_output_qty, output_basis: 'PER_BATCH',
        creates_inventory: true, output_lot_auto: true,
      });
    } else if (lifecycle.std_body_weight_kg) {
      lines.push({
        line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'DESCRIPTIVE',
        activity_name: `${stage.stage_name} Body Weight Check`, stage_id: stageId, occurrence: 'WEEKLY', start_day: 7, end_day: null,
        day_of_week: 1, is_mandatory: false, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id,
        kpi_metric: 'BODY_WEIGHT', kpi_uom: KPI_METRIC_UOM.BODY_WEIGHT, capture_per: 'AVERAGE',
        std_value: lifecycle.std_body_weight_kg, alert_severity: 'WARNING',
      });
    }

    const protocolEntries: Array<{ entry: ProtocolEntry; label: string }> = [
      ...parseProtocolEntries(lifecycle.medication_protocol, 'medicine').map((entry) => ({ entry, label: 'Medication' })),
      ...parseProtocolEntries(lifecycle.vaccination_protocol, 'vaccine').map((entry) => ({ entry, label: 'Vaccination' })),
    ];
    for (const { entry, label } of protocolEntries) {
      const item = await this.findItemByName(batch.tenant_id, batch.company_id, entry.name);
      if (!item) continue; // no matching item in this tenant's catalog — skip rather than guess
      const lineId = randomUUID();
      lines.push({
        line_id: lineId, scheduler_id: schedulerId, line_seq: seq++, line_type: 'CONSUMPTION',
        activity_name: `${label}: ${entry.name}`, stage_id: stageId, occurrence: 'CUSTOM', start_day: entry.day, end_day: entry.day,
        is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id, item_id: item.item_id,
        item_description: item.item_name,
        qty_basis: 'PER_HEAD', allow_qty_edit: true, lot_required: Boolean(item.is_lot_tracked || item.is_serial_tracked),
      });
      customDaysByLine[lineId] = [entry.day];
    }

    if (lines.length) await this.db.insert(schema.schedulerLine).values(lines);

    // AGE_WEEKS vaccinations as stage days, from the batch's date of birth (Rishi, 14 Oct; vaccination-sync.ts).
    if (effectiveFrom) {
      await syncVaccinationLines(this.db, {
        scheduler_id: schedulerId, batch_id: batch.batch_id, stage_id: stageId, effective_from: effectiveFrom, nob_id: batch.nob_id, lob_id: batch.lob_id,
      }, lifecycle.vaccination_protocol, lifecycle.lifecycle_id);
    }
    if (!lines.length) return;

    const customDayRows = Object.entries(customDaysByLine).flatMap(([lineId, days]) =>
      days.map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day }))
    );
    if (customDayRows.length) await this.db.insert(schema.schedulerLineCustomDays).values(customDayRows);
  }

  /**
   * The active system scheduler a batch of this breed would copy for this
   * stage: the breed's own one first, else the one for every breed. One with
   * no active lines is no match — copying it would only suppress the breed
   * lifecycle lines in favour of nothing. Matched on the stage's LOB and code,
   * since the tenant template row and the company's copy of a stage are two
   * ids for the same stage and batches point at either.
   */
  async findMatchingSystemScheduler(companyId: string, stageId: string, breedId: string | null | undefined) {
    const [stage] = await this.db
      .select({ lob_id: schema.stageMaster.lob_id, stage_code: schema.stageMaster.stage_code })
      .from(schema.stageMaster)
      .where(eq(schema.stageMaster.stage_id, stageId))
      .limit(1);
    if (!stage) return null;
    const candidates = await this.db
      .select()
      .from(schema.systemScheduler)
      .where(and(
        eq(schema.systemScheduler.company_id, companyId),
        eq(schema.systemScheduler.lob_id, stage.lob_id),
        eq(schema.systemScheduler.stage_code, stage.stage_code),
        eq(schema.systemScheduler.is_active, true),
        breedId ? inArray(schema.systemScheduler.breed_key, [breedId, '*']) : eq(schema.systemScheduler.breed_key, '*'),
      ));
    if (!candidates.length) return null;
    const lineCounts = await this.db
      .select({ system_scheduler_id: schema.systemSchedulerLine.system_scheduler_id, total: count() })
      .from(schema.systemSchedulerLine)
      .where(and(
        inArray(schema.systemSchedulerLine.system_scheduler_id, candidates.map((c) => c.system_scheduler_id)),
        eq(schema.systemSchedulerLine.is_active, true),
      ))
      .groupBy(schema.systemSchedulerLine.system_scheduler_id);
    const lineCountById = new Map(lineCounts.map((l) => [l.system_scheduler_id, Number(l.total)]));
    const usable = candidates.filter((c) => (lineCountById.get(c.system_scheduler_id) ?? 0) > 0);
    const match = usable.find((c) => breedId && c.breed_key === breedId) ?? usable.find((c) => c.breed_key === '*');
    return match ? { ...match, line_count: lineCountById.get(match.system_scheduler_id) ?? 0 } : null;
  }

  /** Copies a system scheduler's active lines (and their custom days) onto a batch's header, numbered from startSeq. Returns how many. */
  private async copyLinesFromSystemScheduler(
    schedulerId: string,
    systemSchedulerId: string,
    batch: { nob_id: string | null; lob_id: string },
    stageId: string,
    startSeq = 1,
  ): Promise<number> {
    const source = await this.db
      .select()
      .from(schema.systemSchedulerLine)
      .where(and(eq(schema.systemSchedulerLine.system_scheduler_id, systemSchedulerId), eq(schema.systemSchedulerLine.is_active, true)))
      .orderBy(asc(schema.systemSchedulerLine.line_seq));
    if (!source.length) return 0;
    const sourceDays = await this.db
      .select()
      .from(schema.systemSchedulerLineCustomDays)
      .where(inArray(schema.systemSchedulerLineCustomDays.line_id, source.map((l) => l.line_id)));

    const lines: (typeof schema.schedulerLine.$inferInsert)[] = [];
    const customDayRows: (typeof schema.schedulerLineCustomDays.$inferInsert)[] = [];
    source.forEach((line, idx) => {
      const { line_id: sourceLineId, system_scheduler_id: _origin, line_seq: _seq, ...fields } = line;
      const lineId = randomUUID();
      lines.push({
        ...fields,
        line_id: lineId,
        scheduler_id: schedulerId,
        line_seq: startSeq + idx,
        stage_id: stageId,
        source: 'SYSTEM',
        nob_id: batch.nob_id,
        lob_id: batch.lob_id,
      });
      for (const day of sourceDays.filter((d) => d.line_id === sourceLineId)) {
        customDayRows.push({ custom_day_id: randomUUID(), line_id: lineId, day_number: day.day_number });
      }
    });
    await this.db.insert(schema.schedulerLine).values(lines);
    if (customDayRows.length) await this.db.insert(schema.schedulerLineCustomDays).values(customDayRows);
    return lines.length;
  }

  /**
   * Fills an empty scheduler with another scheduler's activities — a system
   * scheduler's, or another batch's — for a header that got none (the user
   * declined the copy, or no system scheduler existed yet). Refused once the
   * header has an active line, so it never doubles a plan up. A copy from a
   * system scheduler records it as the origin, as on auto-create; a copy from
   * a batch's scheduler is the user's own choice and is marked MANUAL.
   */
  async copyLinesInto(headerId: string, dto: CopySchedulerLinesDto, tenantId: string, userPayload?: { userId?: string }) {
    let copied = 0;
    // The empty check sits inside the transaction it guards, so a line added
    // between the check and the copy cannot leave the plan doubled.
    await withTenantTransaction(this.cls, async () => {
      const header = await this.findOne(headerId);
      if (header.lines.some((l) => l.is_active)) {
        throw new ConflictException('This scheduler already has activities. Copying is offered only while it has none.');
      }
      // Removed lines keep their line_seq (it is unique per scheduler), so a copy numbers on after them.
      const startSeq = header.lines.reduce((max, l) => Math.max(max, l.line_seq), 0) + 1;

      if (dto.source_type === 'SYSTEM') {
        const [source] = await this.db.select({ system_scheduler_id: schema.systemScheduler.system_scheduler_id })
          .from(schema.systemScheduler)
          .where(and(eq(schema.systemScheduler.system_scheduler_id, dto.source_id), eq(schema.systemScheduler.company_id, header.company_id)))
          .limit(1);
        if (!source) throw new NotFoundException(`System scheduler '${dto.source_id}' not found.`);
        copied = await this.copyLinesFromSystemScheduler(headerId, source.system_scheduler_id, header, header.stage_id, startSeq);
        if (copied) {
          await this.db.update(schema.schedulerHeader)
            .set({ system_scheduler_id: source.system_scheduler_id, updated_at: toMysqlTimestamp() })
            .where(eq(schema.schedulerHeader.scheduler_id, headerId));
        }
      } else {
        if (dto.source_id === headerId) throw new BadRequestException('A scheduler cannot copy its own activities.');
        const source = await this.findOne(dto.source_id);
        if (source.company_id !== header.company_id) throw new NotFoundException(`Scheduler '${dto.source_id}' not found.`);
        const sourceLines = source.lines.filter((l) => l.is_active).sort((a, b) => a.line_seq - b.line_seq);
        const lines: (typeof schema.schedulerLine.$inferInsert)[] = [];
        const customDayRows: (typeof schema.schedulerLineCustomDays.$inferInsert)[] = [];
        sourceLines.forEach((line, idx) => {
          const lineId = randomUUID();
          lines.push({
            ...(pickLineFields(line) as Partial<typeof schema.schedulerLine.$inferInsert>),
            line_type: line.line_type,
            activity_name: line.activity_name,
            line_id: lineId,
            scheduler_id: headerId,
            line_seq: startSeq + idx,
            stage_id: header.stage_id,
            source: 'MANUAL',
            lifecycle_ref_id: null,
            nob_id: header.nob_id,
            lob_id: header.lob_id,
            is_active: true,
          });
          for (const day of line.custom_days) {
            customDayRows.push({ custom_day_id: randomUUID(), line_id: lineId, day_number: day.day_number });
          }
        });
        if (lines.length) await this.db.insert(schema.schedulerLine).values(lines);
        if (customDayRows.length) await this.db.insert(schema.schedulerLineCustomDays).values(customDayRows);
        copied = lines.length;
      }
      if (!copied) throw new BadRequestException('The chosen scheduler has no activities to copy.');

      await this.auditService.log({
        tenantId, companyId: header.company_id, userId: userPayload?.userId,
        action: 'COPY_LINES', entityName: 'scheduler_header', entityId: headerId,
        newValues: { source_type: dto.source_type, source_id: dto.source_id, lines_copied: copied },
      });
    });

    return this.findOne(headerId);
  }

  /**
   * Auto-creates (or returns the existing) scheduler_header for this batch's
   * stage — called by BatchService.transferStage() right after it resolves a
   * real stage_id. Idempotent on (batch_id, stage_id): re-entering the same
   * stage never duplicates a header. options.source carries the user's answer
   * to "copy the system scheduler?" — see SchedulerSource.
   */
  /**
   * Live animals of an animal-wise batch at one stage. A stage exists as a tenant row and a
   * company copy, and animals and schedulers point at either, so stages are matched by code.
   */
  async countLiveAnimalsAtStage(batchId: string, stageId: string): Promise<number> {
    const [stage] = await this.db.select({ stage_code: schema.stageMaster.stage_code })
      .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
    if (!stage?.stage_code) {
      const [row] = await this.db.select({ n: count() }).from(schema.animalRegister)
        .where(and(
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.current_stage_id, stageId),
          eq(schema.animalRegister.is_active, true),
        ));
      return Number(row?.n ?? 0);
    }
    const [row] = await this.db.select({ n: count() }).from(schema.animalRegister)
      .innerJoin(schema.stageMaster, eq(schema.animalRegister.current_stage_id, schema.stageMaster.stage_id))
      .where(and(
        eq(schema.animalRegister.current_batch_id, batchId),
        eq(schema.animalRegister.is_active, true),
        eq(schema.stageMaster.stage_code, stage.stage_code),
      ));
    return Number(row?.n ?? 0);
  }

  /**
   * The day the first of a stage's live animals entered it, in an animal-wise batch: per animal,
   * the latest movement INTO the stage it is at now (a later movement into some other stage is
   * not its entry here), then the earliest of those. Null when nobody is at the stage or no
   * movement records how they got there. Stages are matched by code, as countLiveAnimalsAtStage().
   */
  async stageEntryDate(batchId: string, stageId: string): Promise<string | null> {
    const [stage] = await this.db.select({ stage_code: schema.stageMaster.stage_code })
      .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
    const sameStage = stage?.stage_code
      ? (await this.db.select({ stage_id: schema.stageMaster.stage_id }).from(schema.stageMaster)
          .where(eq(schema.stageMaster.stage_code, stage.stage_code))).map((s) => s.stage_id)
      : [stageId];
    if (!sameStage.length) return null;

    const animals = await this.db.select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.current_batch_id, batchId),
        eq(schema.animalRegister.is_active, true),
        inArray(schema.animalRegister.current_stage_id, sameStage),
      ));
    if (!animals.length) return null;

    const moves = await this.db.select({
      animal_id: schema.animalMovementLog.animal_id,
      event_date: schema.animalMovementLog.event_date,
      from_stage_id: schema.animalMovementLog.from_stage_id,
    })
      .from(schema.animalMovementLog)
      .where(and(
        inArray(schema.animalMovementLog.animal_id, animals.map((a) => a.animal_id)),
        inArray(schema.animalMovementLog.to_stage_id, sameStage),
      ));
    const enteredOn = new Map<string, string>();
    for (const move of moves) {
      // A move within the stage (from it, to it) is not an entry.
      if (move.from_stage_id && sameStage.includes(move.from_stage_id)) continue;
      const day = String(move.event_date).slice(0, 10);
      const known = enteredOn.get(move.animal_id);
      if (!known || day > known) enteredOn.set(move.animal_id, day);
    }
    const days = [...enteredOn.values()].sort();
    return days[0] ?? null;
  }

  /**
   * Starts an animal-wise stage's scheduler on the day its animals entered the stage. A scheduler
   * created ahead of the move — or after it, with the form's default of the batch start — ran from
   * the batch's first day: Farrowing on BATCH-000008 ran 9–12 Sep while its sows moved in on 13
   * Sep, so data entry asked for 9 Sep, found the sows already posted there under Insemination,
   * and showed the stage completed with nothing to enter. Moved only while nothing has been
   * entered against it, so a schedule already in use keeps the days its data was entered under.
   * The length of the schedule is kept. Returns the new start, or null when nothing moved.
   */
  async alignToStageEntry(batchId: string, stageId: string): Promise<string | null> {
    const [batch] = await this.db.select({ tracking_mode: schema.batchHeader.tracking_mode })
      .from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
    if (batch?.tracking_mode !== 'ANIMAL_WISE') return null;

    const [stage] = await this.db.select({ stage_code: schema.stageMaster.stage_code })
      .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
    const sameStage = stage?.stage_code
      ? (await this.db.select({ stage_id: schema.stageMaster.stage_id }).from(schema.stageMaster)
          .where(eq(schema.stageMaster.stage_code, stage.stage_code))).map((s) => s.stage_id)
      : [stageId];
    const [header] = await this.db.select().from(schema.schedulerHeader)
      .where(and(
        eq(schema.schedulerHeader.batch_id, batchId),
        inArray(schema.schedulerHeader.stage_id, sameStage),
        inArray(schema.schedulerHeader.scheduler_status, ['DRAFT', 'ACTIVE']),
      ))
      .limit(1);
    if (!header) return null;

    const entered = await this.stageEntryDate(batchId, stageId);
    const from = String(header.effective_from).slice(0, 10);
    if (!entered || entered <= from) return null;

    const lineIds = (await this.db.select({ line_id: schema.schedulerLine.line_id })
      .from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, header.scheduler_id))).map((l) => l.line_id);
    if (lineIds.length) {
      const [used] = await this.db.select({ n: count() }).from(schema.batchDailyData)
        .where(and(eq(schema.batchDailyData.batch_id, batchId), inArray(schema.batchDailyData.line_id, lineIds)));
      if (Number(used?.n ?? 0) > 0) return null;
    }
    const [locked] = await this.db.select({ n: count() }).from(schema.batchDataEntryLock)
      .where(and(eq(schema.batchDataEntryLock.batch_id, batchId), inArray(schema.batchDataEntryLock.stage_id, sameStage)));
    if (Number(locked?.n ?? 0) > 0) return null;

    const dayMs = 86_400_000;
    const shift = Math.round((Date.parse(`${entered}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
    const to = header.effective_to ? String(header.effective_to).slice(0, 10) : null;
    const newTo = to ? new Date(Date.parse(`${to}T00:00:00Z`) + shift * dayMs).toISOString().slice(0, 10) : null;
    await this.db.update(schema.schedulerHeader)
      .set({ effective_from: entered, effective_to: newTo, updated_at: toMysqlTimestamp() })
      .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
    return entered;
  }

  /**
   * Sets every open scheduler of an animal-wise batch to the number of live animals at its stage.
   * An animal-wise batch holds several stages at once, so a header's count is its own stage's
   * animals, never the whole batch; deaths, transfers and stage moves all end here so the count
   * cannot drift from the register. A batch-wise batch has no register rows and is left alone.
   */
  async syncAnimalWiseCounts(batchId: string): Promise<void> {
    const [batch] = await this.db.select()
      .from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
    if (batch?.tracking_mode !== 'ANIMAL_WISE') return;

    // Every stage the animals now hold gets an open scheduler, or the animals there have no data entry.
    if (batch.status === 'ACTIVE') await this.openOccupiedStageSchedulers(batch);

    const headers = await this.db
      .select({ scheduler_id: schema.schedulerHeader.scheduler_id, stage_code: schema.stageMaster.stage_code })
      .from(schema.schedulerHeader)
      .innerJoin(schema.stageMaster, eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id))
      .where(and(
        eq(schema.schedulerHeader.batch_id, batchId),
        inArray(schema.schedulerHeader.scheduler_status, ['ACTIVE', 'DRAFT']),
      ));
    if (!headers.length) return;

    const perStage = await this.db
      .select({ stage_code: schema.stageMaster.stage_code, n: count() })
      .from(schema.animalRegister)
      .innerJoin(schema.stageMaster, eq(schema.animalRegister.current_stage_id, schema.stageMaster.stage_id))
      .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)))
      .groupBy(schema.stageMaster.stage_code);
    const byCode = new Map(perStage.map((r) => [r.stage_code, Number(r.n)]));

    for (const header of headers) {
      await this.db.update(schema.schedulerHeader)
        .set({ animal_count: String(byCode.get(header.stage_code) ?? 0), updated_at: toMysqlTimestamp() })
        .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
    }
  }

  /** Opens a scheduler — new, or the stage's completed one — for each stage an animal-wise batch's live animals hold. */
  private async openOccupiedStageSchedulers(batch: typeof schema.batchHeader.$inferSelect): Promise<void> {
    const occupied = await this.db
      .selectDistinct({ stage_id: schema.animalRegister.current_stage_id, stage_code: schema.stageMaster.stage_code })
      .from(schema.animalRegister)
      .innerJoin(schema.stageMaster, eq(schema.animalRegister.current_stage_id, schema.stageMaster.stage_id))
      .where(and(eq(schema.animalRegister.current_batch_id, batch.batch_id), eq(schema.animalRegister.is_active, true)));
    if (!occupied.length) return;
    const schedulers = await this.db
      .select({
        scheduler_id: schema.schedulerHeader.scheduler_id,
        stage_code: schema.stageMaster.stage_code,
        scheduler_status: schema.schedulerHeader.scheduler_status,
      })
      .from(schema.schedulerHeader)
      .innerJoin(schema.stageMaster, eq(schema.schedulerHeader.stage_id, schema.stageMaster.stage_id))
      .where(eq(schema.schedulerHeader.batch_id, batch.batch_id));

    const { create, reopen } = stagesNeedingScheduler(
      occupied.flatMap((s) => (s.stage_id ? [{ stage_id: s.stage_id, stage_code: s.stage_code }] : [])),
      schedulers,
    );
    for (const schedulerId of reopen) {
      await this.db.update(schema.schedulerHeader)
        .set({ scheduler_status: 'ACTIVE', actual_end_date: null, updated_at: toMysqlTimestamp() })
        .where(eq(schema.schedulerHeader.scheduler_id, schedulerId));
    }
    for (const stageId of create) {
      await this.createForAuthorizedBatchStage(batch, stageId, batch.tenant_id);
    }
  }

  async createForStage(batchId: string, stageId: string, tenantId: string, userPayload?: { userId?: string }, options?: CreateForStageOptions): Promise<any> {
    return this.createForStageInternal(batchId, stageId, tenantId, userPayload, undefined, options);
  }

  /**
   * Internal transfer path. The caller has already authorized the source and
   * verified this destination batch belongs to the same company/LOB. Passing
   * the row avoids re-applying the source farm to a legitimate farm transfer.
   */
  async createForAuthorizedBatchStage(
    batch: typeof schema.batchHeader.$inferSelect,
    stageId: string,
    tenantId: string,
    userPayload?: { userId?: string },
    options?: CreateForStageOptions,
  ) {
    if (batch.tenant_id !== tenantId) throw new NotFoundException(`Batch '${batch.batch_id}' not found.`);
    return this.createForStageInternal(batch.batch_id, stageId, tenantId, userPayload, batch, options);
  }

  private async createForStageInternal(
    batchId: string,
    stageId: string,
    tenantId: string,
    userPayload?: { userId?: string },
    authorizedBatch?: typeof schema.batchHeader.$inferSelect,
    options?: CreateForStageOptions,
  ) {
    let batch = authorizedBatch;
    if (!batch) {
      [batch] = await this.db.select().from(schema.batchHeader).where(and(
        eq(schema.batchHeader.batch_id, batchId),
        eq(schema.batchHeader.tenant_id, tenantId),
        ...batchScopeConditions(farmScope(this.cls)),
      )).limit(1);
    }
    if (!batch) throw new NotFoundException(`Batch '${batchId}' not found.`);

    const [existing] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.stage_id, stageId)))
      .limit(1);
    if (existing) return authorizedBatch ? existing : this.findOne(existing.scheduler_id);

    const [stage] = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
    if (!stage) throw new NotFoundException(`Stage '${stageId}' not found.`);

    // Every stage's scheduler — not just the first — starts on the batch start
    // date, so a batch created with a back-dated start date has all its stages
    // aligned to it instead of to the day each header happened to be generated.
    const [priorHeader] = await this.db.select({ scheduler_id: schema.schedulerHeader.scheduler_id, animal_count: schema.schedulerHeader.animal_count })
      .from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, batchId)).orderBy(desc(schema.schedulerHeader.created_at)).limit(1);
    const effectiveFrom = batch.start_date || toDateOnly(new Date());
    const effectiveTo = stage.typical_duration_days ? addDays(effectiveFrom, stage.typical_duration_days) : null;
    const locationId = batch.sub_location_id || batch.location_id || batch.shed_id || null;

    // "Number of animals at the starting of this scheduler" — the live headcount
    // right now, not the batch's original opening_quantity (which would ignore
    // every mortality/transfer that happened in earlier stages). Preference order:
    // (1) a live animal_register count, for LOBs that track individual animals
    //     (Animal Wise batches, whose animals come from the register; a Batch Wise
    //     batch is a bare headcount with no animal rows, so this is 0 for those);
    // (2) the prior stage's own scheduler_header.animal_count, which already
    //     carries forward whatever mortality/head-count corrections were posted
    //     against it — this is the only place a STANDARD-costed batch's running
    //     count lives, since it has no animal_register rows to re-derive from;
    // (3) batch.closing_quantity/opening_quantity, for this batch's very first
    //     scheduler (no prior header to inherit from).
    // An animal-wise batch holds several stages at once, so this stage's count is the animals
    // at this stage, even when that is none yet — inheriting the prior stage's count would
    // give it animals it does not hold.
    let animalCount: number;
    if (batch.tracking_mode === 'ANIMAL_WISE') {
      animalCount = await this.countLiveAnimalsAtStage(batchId, stageId);
    } else {
      const [{ liveCount }] = await this.db.select({ liveCount: count() }).from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
      animalCount = liveCount > 0
        ? liveCount
        : priorHeader?.animal_count != null
          ? Number(priorHeader.animal_count)
          : Number(batch.closing_quantity ?? batch.opening_quantity);
    }

    // A declined copy is an empty header for manual lines; otherwise a
    // matching system scheduler wins over the breed lifecycle.
    const declined = options?.source === 'EMPTY';
    const systemScheduler = declined ? null : await this.findMatchingSystemScheduler(batch.company_id, stageId, batch.breed_id);

    const schedulerId = randomUUID();
    await this.db.insert(schema.schedulerHeader).values({
      scheduler_id: schedulerId,
      scheduler_no: await this.nextSchedulerNo(tenantId, batch.company_id),
      tenant_id: tenantId,
      company_id: batch.company_id,
      batch_id: batchId,
      stage_id: stageId,
      breed_id: batch.breed_id,
      lob_id: batch.lob_id,
      nob_id: batch.nob_id,
      location_id: locationId,
      ...(systemScheduler ? { data_entry_level: systemScheduler.data_entry_level } : {}),
      scheduler_status: batch.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      animal_count: animalCount.toString(),
      auto_generated: true,
      system_scheduler_id: systemScheduler?.system_scheduler_id ?? null,
      created_by: userPayload?.userId || null,
    });

    if (systemScheduler) {
      await this.copyLinesFromSystemScheduler(schedulerId, systemScheduler.system_scheduler_id, batch, stageId);
    } else if (!declined) {
      await this.generateLinesFromLifecycle(schedulerId, batch, stageId, stage, effectiveFrom);
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'scheduler_header',
      entityId: schedulerId,
      newValues: {
        batch_id: batchId, stage_id: stageId, auto_generated: true,
        lines_from: systemScheduler ? 'SYSTEM_SCHEDULER' : declined ? 'NONE' : 'BREED_LIFECYCLE',
        system_scheduler_id: systemScheduler?.system_scheduler_id ?? null,
      },
    });

    return authorizedBatch ? { scheduler_id: schedulerId } : this.findOne(schedulerId);
  }

  /** Manual entry point mirroring transferStage()'s automatic call — resolves the
   * batch's current stage_id itself so callers don't need BatchService. */
  async generateForBatchCurrentStage(batchId: string, tenantId: string, userPayload?: { userId?: string }) {
    const [batch] = await this.db.select().from(schema.batchHeader).where(and(
      eq(schema.batchHeader.batch_id, batchId),
      eq(schema.batchHeader.tenant_id, tenantId),
      ...batchScopeConditions(farmScope(this.cls)),
    )).limit(1);
    if (!batch) throw new NotFoundException(`Batch '${batchId}' not found.`);
    if (!batch.stage_id) {
      throw new BadRequestException('This batch has not transferred into a Stage Master stage yet — transfer it into a stage first.');
    }
    return this.createForStage(batchId, batch.stage_id, tenantId, userPayload);
  }

  /**
   * Manual creation of a scheduler_header from the Schedulers page.
   * Enforces 1 header per batch per stage, filters stage by batch's LOB,
   * auto-flows company/LOB/NOB/breed/location, sets auto_generated = false,
   * and populates lifecycle standard lines if present.
   */
  async createManualHeader(dto: CreateSchedulerHeaderDto, tenantId: string, userPayload?: { userId?: string }) {
    // Header, lines and custom days all land in one transaction: a line that
    // fails assertLineTypeFields/assertNoConflictingLines used to throw after
    // the header row was already committed, so the retry hit the (batch_id,
    // stage_id) duplicate check below and 409'd on a header nobody could see.
    return withTenantTransaction(this.cls, async () => this.createManualHeaderInternal(dto, tenantId, userPayload));
  }

  private async createManualHeaderInternal(dto: CreateSchedulerHeaderDto, tenantId: string, userPayload?: { userId?: string }) {
    const [existing] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, dto.batch_id), eq(schema.schedulerHeader.stage_id, dto.stage_id)))
      .limit(1);
    if (existing) {
      throw new ConflictException(`A scheduler already exists for batch '${dto.batch_id}' and stage '${dto.stage_id}'.`);
    }

    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, dto.batch_id), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException(`Batch '${dto.batch_id}' not found.`);

    const [stage] = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, dto.stage_id)).limit(1);
    if (!stage) throw new NotFoundException(`Stage '${dto.stage_id}' not found.`);

    if (stage.lob_id !== batch.lob_id) {
      throw new BadRequestException(`Stage '${stage.stage_name}' does not belong to the batch's Line of Business.`);
    }

    // Same rule as createForStage(): every stage's header defaults to the batch
    // start date. An explicit dto.effective_from always overrides it.
    const effectiveFrom = dto.effective_from || batch.start_date || toDateOnly(new Date());
    const effectiveTo = dto.effective_to || (stage.typical_duration_days ? addDays(effectiveFrom, stage.typical_duration_days) : null);
    const locationId = batch.sub_location_id || batch.location_id || batch.shed_id || null;

    let animalCount = dto.animal_count;
    if (animalCount == null) {
      // Same 3-tier fallback as createForStage(): live animal_register count,
      // else the prior stage's own scheduler_header.animal_count (the only
      // place a STANDARD-costed batch's running count lives), else the batch's
      // closing/opening quantity for this batch's very first scheduler.
      if (batch.tracking_mode === 'ANIMAL_WISE') {
        animalCount = await this.countLiveAnimalsAtStage(dto.batch_id, dto.stage_id);
      } else {
        const [{ liveCount }] = await this.db.select({ liveCount: count() }).from(schema.animalRegister)
          .where(and(eq(schema.animalRegister.current_batch_id, dto.batch_id), eq(schema.animalRegister.is_active, true)));
        if (liveCount > 0) {
          animalCount = liveCount;
        } else {
          const [priorHeader] = await this.db.select({ animal_count: schema.schedulerHeader.animal_count })
            .from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, dto.batch_id)).orderBy(desc(schema.schedulerHeader.created_at)).limit(1);
          animalCount = priorHeader?.animal_count != null ? Number(priorHeader.animal_count) : Number(batch.closing_quantity ?? batch.opening_quantity ?? 0);
        }
      }
    }

    // Lines sent by the form (perhaps copied from a system scheduler, named in
    // dto.system_scheduler_id) are taken as they are; with none sent, a
    // matching system scheduler wins over the breed lifecycle, as on auto-create.
    const sentLines = !!dto.lines?.length;
    const systemScheduler = sentLines ? null : await this.findMatchingSystemScheduler(batch.company_id, dto.stage_id, batch.breed_id);
    let originSystemSchedulerId = systemScheduler?.system_scheduler_id ?? null;
    if (sentLines && dto.system_scheduler_id) {
      const [origin] = await this.db.select({ system_scheduler_id: schema.systemScheduler.system_scheduler_id })
        .from(schema.systemScheduler)
        .where(and(eq(schema.systemScheduler.system_scheduler_id, dto.system_scheduler_id), eq(schema.systemScheduler.company_id, batch.company_id)))
        .limit(1);
      originSystemSchedulerId = origin?.system_scheduler_id ?? null;
    }

    const schedulerId = randomUUID();
    const status = dto.scheduler_status || 'DRAFT';
    await this.db.insert(schema.schedulerHeader).values({
      scheduler_id: schedulerId,
      scheduler_no: await this.nextSchedulerNo(tenantId, batch.company_id),
      tenant_id: tenantId,
      company_id: batch.company_id,
      batch_id: dto.batch_id,
      stage_id: dto.stage_id,
      breed_id: batch.breed_id,
      lob_id: batch.lob_id,
      nob_id: batch.nob_id,
      location_id: locationId,
      data_entry_level: dto.data_entry_level || 'SHED',
      scheduler_status: status,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      animal_count: animalCount.toString(),
      auto_generated: false,
      system_scheduler_id: originSystemSchedulerId,
      notes: dto.notes || null,
      approved_by: status === 'ACTIVE' ? (userPayload?.userId || null) : null,
      approved_at: status === 'ACTIVE' ? toMysqlTimestamp() : null,
      created_by: userPayload?.userId || null,
    });

    if (dto.lines && dto.lines.length > 0) {
      for (let i = 0; i < dto.lines.length; i++) {
        this.assertLineTypeFields(dto.lines[i].line_type, dto.lines[i], dto.lines[i] as unknown as Record<string, unknown>);
        this.assertNoConflictingLines(dto.lines[i], dto.lines.slice(0, i));
      }
      let seq = 1;
      for (const line of dto.lines) {
        const lineId = randomUUID();
        const kpiUom = this.resolveKpiUom(line.kpi_metric, line.kpi_uom);
        await this.db.insert(schema.schedulerLine).values({
          line_id: lineId,
          scheduler_id: schedulerId,
          line_seq: seq++,
          line_type: line.line_type,
          activity_name: line.activity_name,
          stage_id: dto.stage_id,
          occurrence: line.occurrence || 'DAILY',
          start_day: line.start_day ?? 1,
          end_day: line.end_day ?? null,
          day_of_week: line.day_of_week ?? null,
          is_mandatory: line.is_mandatory ?? false,
          source: 'MANUAL',
          nob_id: batch.nob_id,
          lob_id: batch.lob_id,
          item_id: line.item_id || null,
          item_description: line.item_description || null,
          standard_qty: line.standard_qty != null ? line.standard_qty.toString() : null,
          qty_basis: line.qty_basis || null,
          allow_qty_edit: line.allow_qty_edit ?? true,
          lot_required: line.lot_required ?? false,
          creates_inventory: line.creates_inventory ?? false,
          output_lot_auto: line.output_lot_auto ?? true,
          output_basis: line.output_basis || null,
          kpi_metric: line.kpi_metric || null,
          kpi_uom: kpiUom,
          std_value: line.std_value != null ? line.std_value.toString() : null,
          lower_alert_limit: line.lower_alert_limit != null ? line.lower_alert_limit.toString() : null,
          upper_alert_limit: line.upper_alert_limit != null ? line.upper_alert_limit.toString() : null,
          alert_severity: line.alert_severity || null,
          capture_per: line.capture_per || null,
          overhead_category: line.overhead_category || null,
          gl_account: line.gl_account || null,
          estimated_cost: line.estimated_cost != null ? line.estimated_cost.toString() : null,
          resource_id: line.resource_id || null,
          auto_triggers_stage: line.auto_triggers_stage ?? false,
          is_active: true,
        });
        // Custom-occurrence day numbers live in scheduler_line_custom_days, not
        // on scheduler_line itself — same normalized child table addLine() uses.
        if (line.occurrence === 'CUSTOM' && line.custom_days?.length) {
          await this.db.insert(schema.schedulerLineCustomDays).values(
            line.custom_days.map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day }))
          );
        }
      }
    } else if (systemScheduler) {
      await this.copyLinesFromSystemScheduler(schedulerId, systemScheduler.system_scheduler_id, batch, dto.stage_id);
    } else {
      await this.generateLinesFromLifecycle(schedulerId, batch, dto.stage_id, stage, effectiveFrom);
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'scheduler_header',
      entityId: schedulerId,
      newValues: { batch_id: dto.batch_id, stage_id: dto.stage_id, auto_generated: false, status, lines_count: dto.lines?.length || 0 },
    });

    // Created for a stage its animals are already at: its days start when they entered it,
    // not on the batch start date the form offers.
    await this.alignToStageEntry(dto.batch_id, dto.stage_id);

    return this.findOne(schedulerId);
  }

  /**
   * Updates non-status fields on scheduler_header (notes, data_entry_level, dates, animal_count).
   */
  async updateHeader(id: string, dto: UpdateSchedulerHeaderDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    const updates: Record<string, unknown> = {
      updated_at: toMysqlTimestamp(),
    };
    if (dto.data_entry_level !== undefined) updates.data_entry_level = dto.data_entry_level;
    if (dto.effective_from !== undefined) updates.effective_from = dto.effective_from;
    if (dto.effective_to !== undefined) updates.effective_to = dto.effective_to;
    if (dto.animal_count !== undefined) updates.animal_count = dto.animal_count.toString();
    if (dto.notes !== undefined) updates.notes = dto.notes;

    await this.db.update(schema.schedulerHeader).set(updates).where(eq(schema.schedulerHeader.scheduler_id, id));

    await this.auditService.log({
      tenantId,
      companyId: header.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'scheduler_header',
      entityId: id,
      newValues: updates,
    });

    return this.findOne(id);
  }

  /**
   * Deletes an unused scheduler_header — header, lines and custom days
   * together. Refused once any line has a batch_daily_data row against it: a
   * recorded entry is history, not an unused draft, and deleting it would
   * strand the posting it made (inventory/GL/transfer) with no schedule line
   * behind it.
   */
  async deleteHeader(id: string, tenantId: string, userPayload?: { userId?: string }) {
    // findOne() is the existing scoped lookup — a header outside the caller's
    // farm 404s here exactly as every other by-id read on this service does.
    const header = await this.findOne(id);
    const lineIds = header.lines.map((l) => l.line_id);

    // The entry gate sits INSIDE the transaction it guards: read outside it,
    // a line could gain its first entry between the check and the delete and
    // the scheduler would vanish over a recorded day. The audit row joins the
    // same transaction so a rolled-back delete leaves no DELETE behind.
    await withTenantTransaction(this.cls, async () => {
      if (lineIds.length) {
        const [recorded] = await this.db
          .select({ entry_id: schema.batchDailyData.entry_id })
          .from(schema.batchDailyData)
          .where(inArray(schema.batchDailyData.line_id, lineIds))
          .limit(1);
        if (recorded) {
          throw new ConflictException('This scheduler has recorded entries and cannot be deleted.');
        }
        await this.db.delete(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, lineIds));
        await this.db.delete(schema.schedulerLine).where(inArray(schema.schedulerLine.line_id, lineIds));
      }
      await this.db.delete(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, id));

      await this.auditService.log({
        tenantId,
        companyId: header.company_id,
        userId: userPayload?.userId,
        action: 'DELETE',
        entityName: 'scheduler_header',
        entityId: id,
        oldValues: { batch_id: header.batch_id, stage_id: header.stage_id },
      });
    });

    return { scheduler_id: id, deleted: true };
  }

  /** "Should also tell the SILO STOCK of that location" — checks if location is a SILO
   * or finds a nearby SILO location associated with the shed/farm. */
  private async loadSiloStock(locationId: string | null) {
    if (!locationId) return null;
    const [location] = await this.db.select({
      location_id: schema.locationMaster.location_id,
      location_type: schema.locationMaster.location_type,
      parent_location_id: schema.locationMaster.parent_location_id,
    })
      .from(schema.locationMaster).where(eq(schema.locationMaster.location_id, locationId)).limit(1);
    if (!location) return null;

    let siloWarehouseId = locationId;
    if (location.location_type !== 'SILO') {
      const parentId = location.parent_location_id || locationId;
      const [nearbySilo] = await this.db
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.location_type, 'SILO'),
          eq(schema.locationMaster.is_active, true),
          or(
            eq(schema.locationMaster.parent_location_id, parentId),
            eq(schema.locationMaster.location_id, parentId),
          ),
        ))
        .limit(1);
      if (nearbySilo) {
        siloWarehouseId = nearbySilo.location_id;
      } else {
        return null;
      }
    }

    const rows = await this.db
      .select({
        item_id: schema.inventoryLedger.item_id,
        item_code: schema.inventoryLedger.item_code,
        item_description: schema.inventoryLedger.item_description,
        uom: schema.inventoryLedger.uom,
        on_hand_qty: sql<string>`COALESCE(SUM(${schema.inventoryLedger.remaining_quantity}), 0)`,
      })
      .from(schema.inventoryLedger)
      .where(and(
        eq(schema.inventoryLedger.warehouse_id, siloWarehouseId),
        eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
      ))
      .groupBy(schema.inventoryLedger.item_id, schema.inventoryLedger.item_code, schema.inventoryLedger.item_description, schema.inventoryLedger.uom);

    return rows.map((r) => ({ ...r, on_hand_qty: Number(r.on_hand_qty) })).filter((r) => r.on_hand_qty > 0.0001);
  }

  /**
   * The KPIs & Alerts lines of the batch's breed lifecycle stage, for the scheduler to show
   * read-only (Rishi, 14 Oct).
   *
   * These are not scheduler lines and deliberately do not become any: the alert source stays
   * lifecycle-kpi.evaluator, which reads breed_lifecycle_stages.kpi_thresholds itself. The
   * scheduler's own DESCRIPTIVE lines still carry the older single std_value/alert-limit model,
   * so copying these onto lines would put two alerting paths on one breach. Showing them is
   * what was missing: the stage's KPIs were invisible from the scheduler.
   *
   * A stage record is several rows when it has several feed lines, and the KPI list is copied to
   * all of them, so the first row that has one speaks for the stage.
   */
  private async loadLifecycleKpis(header: { tenant_id: string; company_id: string | null; breed_id: string | null; stage_id: string }) {
    if (!header.breed_id) return { kpis: [], feed: [] };
    const t = schema.breedLifecycleStages;
    const rows = await this.db
      .select({
        kpi_thresholds: t.kpi_thresholds, kpi_alert_period: t.kpi_alert_period,
        calc_unit: t.calc_unit, period_from: t.period_from, period_to: t.period_to,
        feed_item_id: t.feed_item_id, feed_qty_uom: t.feed_qty_uom, feed_wastage_pct: t.feed_wastage_pct,
      })
      .from(t)
      .where(and(
        eq(t.tenant_id, header.tenant_id),
        eq(t.breed_id, header.breed_id),
        eq(t.stage_id, header.stage_id),
        sql`${t.company_id} <=> ${header.company_id ?? null}`,
        eq(t.is_active, true),
      ))
      .orderBy(asc(t.period_from));

    // The stage's feed rows, for the scheduler's feed editor to show the UOM a rate was entered
    // in and the wastage, neither of which a scheduler_line has a column for. Read-only there.
    const feed = rows
      .filter((r) => r.feed_item_id)
      .map((r) => {
        const { fromDay, toDay } = stageDayRange(r.calc_unit, r.period_from, r.period_to);
        return { from_day: fromDay, to_day: toDay, feed_item_id: r.feed_item_id, feed_qty_uom: r.feed_qty_uom ?? 'KG', feed_wastage_pct: r.feed_wastage_pct ?? null };
      });

    const row = rows.find((r) => Array.isArray(r.kpi_thresholds) && r.kpi_thresholds.length);
    if (!row) return { kpis: [], feed };
    // A line's period is always the stage's KPI period (Rishi, 12 Oct) — the line only carries
    // its own when an older row set one, so the header wins and the line is the fallback.
    const kpis = (row.kpi_thresholds as Array<Record<string, unknown>>).map((line) => ({
      metric: line.metric ?? null,
      uom: line.uom ?? null,
      kpi_period: row.kpi_alert_period ?? line.kpi_period ?? null,
      from_day: line.from_day ?? null,
      to_day: line.to_day ?? null,
      average_value: line.average_value ?? null,
      tolerance_pct: line.tolerance_pct ?? null,
      tolerance_type: line.tolerance_type ?? null,
      severity: line.severity ?? null,
    }));
    return { kpis, feed };
  }

  /**
   * Replace a scheduler's Feed Consumption lines with the set the user edited (Rishi, 14 Oct).
   *
   * The same shape and the same rules as the breed lifecycle stage's feed lines: whole stage
   * days, one feed per day, no gap and no overlap (validateFeedLines), and a quantity entered
   * in a weight UOM that is stored as kilograms.
   *
   * Days already entered are not rewritten. applySchedulerFeedLines cuts a line with entries
   * back to its last entered day and starts the new feed the day after, so a posted
   * batch_daily_data row still reads the item and rate it was posted against.
   *
   * The lines it writes carry no lifecycle_ref_id — they are this scheduler's, not the stage's.
   * The stage stays the standard: changing the stage's feed later brings this scheduler back in
   * line through the same function, protecting entered days the same way.
   */
  async updateFeedLines(id: string, lines: FeedLine[], tenantId: string, userPayload?: any) {
    const sh = schema.schedulerHeader;
    const [header] = await this.db.select().from(sh).where(eq(sh.scheduler_id, id)).limit(1);
    if (!header) throw new NotFoundException(`Scheduler '${id}' not found.`);

    // Same scope gate findOne applies — a scheduler outside the caller's farms is not theirs to edit.
    const scope = farmScope(this.cls);
    const [batchInScope] = await this.db
      .select({ batch_id: schema.batchHeader.batch_id })
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, header.batch_id), ...batchScopeConditions(scope)))
      .limit(1);
    if (!batchInScope) throw new NotFoundException(`Scheduler '${id}' not found.`);
    if (header.scheduler_status === 'COMPLETED') {
      throw new BadRequestException('This scheduler is completed; its feed can no longer be changed.');
    }

    const validated = validateFeedLines(lines);
    const wanted: WantedFeedLine[] = [];
    for (const [i, line] of validated.entries()) {
      const { kg } = await feedQtyToKg(this.db, line.feed_qty_per_head_per_day_kg, line.feed_qty_uom, `Feed line ${i + 1}`);
      wanted.push({ fromDay: line.period_from, toDay: line.period_to, itemId: line.feed_item_id, qty: kg, lifecycleId: null });
    }

    const [stage] = await this.db.select({ stage_name: schema.stageMaster.stage_name })
      .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, header.stage_id)).limit(1);

    await applySchedulerFeedLines(this.db, {
      header: { scheduler_id: header.scheduler_id, effective_from: header.effective_from, nob_id: header.nob_id, lob_id: header.lob_id, stage_id: header.stage_id },
      wanted,
      stageName: stage?.stage_name ?? null,
    });

    return this.findOne(id);
  }

  async findOne(id: string) {
    const [header] = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, id)).limit(1);
    if (!header) throw new NotFoundException(`Scheduler '${id}' not found.`);

    // Not injecting BatchService (would create a circular module dependency
    // with batch <-> scheduler-header) — the scoped check is run directly
    // against batch_header instead.
    const scope = farmScope(this.cls);
    const [batchInScope] = await this.db
      .select({ batch_id: schema.batchHeader.batch_id })
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, header.batch_id), ...batchScopeConditions(scope)))
      .limit(1);
    if (!batchInScope) throw new NotFoundException(`Scheduler '${id}' not found.`);

    const lines = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, id));
    const lineIds = lines.map((l) => l.line_id);
    const customDays = lineIds.length
      ? await this.db.select().from(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, lineIds))
      : [];
    const siloStock = await this.loadSiloStock(header.location_id);
    const lifecycleStage = await this.loadLifecycleKpis(header);

    const [batch] = await this.db.select({ batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, header.batch_id)).limit(1);
    const [breed] = header.breed_id
      ? await this.db.select({ breed_name: schema.breedMaster.breed_name }).from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, header.breed_id)).limit(1)
      : [null];
    const [stage] = await this.db.select({ stage_name: schema.stageMaster.stage_name }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, header.stage_id)).limit(1);
    const [location] = header.location_id
      ? await this.db.select({ location_name: schema.locationMaster.location_name }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, header.location_id)).limit(1)
      : [null];
    const [systemScheduler] = header.system_scheduler_id
      ? await this.db.select({ scheduler_name: schema.systemScheduler.scheduler_name }).from(schema.systemScheduler).where(eq(schema.systemScheduler.system_scheduler_id, header.system_scheduler_id)).limit(1)
      : [null];

    // Item & Resource resolution: UOM, description, withdrawal_days, resource_name
    const allItemIds = [...new Set(lines.map((l) => l.item_id).filter((item_id): item_id is string => !!item_id))];
    const itemMap = new Map<string, { uom: string; item_name: string; withdrawal_days: number | null }>();
    if (allItemIds.length) {
      const items = await this.db.select({
        item_id: schema.itemMaster.item_id,
        item_name: schema.itemMaster.item_name,
        uom_primary: schema.itemMaster.uom_primary,
        withdrawal_days: schema.itemMaster.withdrawal_days,
      }).from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, allItemIds));
      for (const it of items) {
        itemMap.set(it.item_id, { uom: it.uom_primary || 'PCS', item_name: it.item_name, withdrawal_days: it.withdrawal_days });
      }
    }

    const allResourceIds = [...new Set(lines.map((l) => l.resource_id).filter((res_id): res_id is string => !!res_id))];
    const resourceMap = new Map<string, string>();
    if (allResourceIds.length) {
      const resources = await this.db.select({
        resource_id: schema.resourceMaster.resource_id,
        resource_name: schema.resourceMaster.resource_name,
      }).from(schema.resourceMaster).where(inArray(schema.resourceMaster.resource_id, allResourceIds));
      for (const res of resources) {
        resourceMap.set(res.resource_id, res.resource_name);
      }
    }

    return {
      ...header,
      batch_no: batch?.batch_no ?? null,
      breed_name: breed?.breed_name ?? null,
      stage_name: stage?.stage_name ?? null,
      location_name: location?.location_name ?? null,
      system_scheduler_name: systemScheduler?.scheduler_name ?? null,
      silo_stock: siloStock,
      lifecycle_kpis: lifecycleStage.kpis,
      lifecycle_feed: lifecycleStage.feed,
      lines: lines.map((line) => {
        const itemInfo = line.item_id ? itemMap.get(line.item_id) : null;
        return {
          ...line,
          uom: itemInfo?.uom ?? null,
          item_description: line.item_description || itemInfo?.item_name || null,
          withdrawal_days: itemInfo?.withdrawal_days ?? null,
          resource_name: line.resource_id ? (resourceMap.get(line.resource_id) ?? null) : null,
          custom_days: customDays.filter((d) => d.line_id === line.line_id),
        };
      }),
    };
  }

  async findAllForBatch(batchId: string, tenantId: string) {
    const scope = farmScope(this.cls);
    return this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(
        eq(schema.schedulerHeader.tenant_id, tenantId),
        eq(schema.schedulerHeader.batch_id, batchId),
        ...(scope.farmId ? [batchOnFarm(schema.schedulerHeader.batch_id, scope.farmId)] : []),
        // An operational admin may send no x-active-farm-id, leaving farmId
        // null — the farm condition alone would then bound nothing at all.
        ...restrictedScopeConditions(scope, { companyId: schema.schedulerHeader.company_id, lobId: schema.schedulerHeader.lob_id }),
      ))
      .orderBy(schema.schedulerHeader.effective_from);
  }

  /**
   * Company-wide Scheduler list — every scheduler_header across every batch,
   * for the dedicated Schedulers screen (as opposed to findAllForBatch, which
   * is one batch's own schedule history). Mirrors BatchService.findAll()'s
   * id-\>name Map-lookup convention rather than SQL joins, matching the rest
   * of this codebase's list endpoints.
   */
  async findAllForCompany(query: QuerySchedulerHeaderDto, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.schedulerHeader.tenant_id, tenantId)];
    if (query.companyId) conditions.push(eq(schema.schedulerHeader.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.schedulerHeader.scheduler_status, query.status));
    if (query.lobId) conditions.push(eq(schema.schedulerHeader.lob_id, query.lobId));
    conditions.push(...(scope.farmId ? [batchOnFarm(schema.schedulerHeader.batch_id, scope.farmId)] : []));
    // Same reason as findAllForBatch: farmId is null for an operational admin
    // who selected no farm, so their own LOB and company are the whole bound.
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.schedulerHeader.company_id, lobId: schema.schedulerHeader.lob_id }));

    let queryBuilder = this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(...conditions))
      .orderBy(schema.schedulerHeader.updated_at);
    if (query.limit) {
      queryBuilder = queryBuilder.limit(Number(query.limit)) as any;
    }
    if (query.offset) {
      queryBuilder = queryBuilder.offset(Number(query.offset)) as any;
    }

    const rows = await queryBuilder;
    if (!rows.length) return [];

    const batchIds = [...new Set(rows.map((r) => r.batch_id))];
    const batches = await this.db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(inArray(schema.batchHeader.batch_id, batchIds));
    const batchNoById = new Map(batches.map((b) => [b.batch_id, b.batch_no]));

    const breedIds = [...new Set(rows.map((r) => r.breed_id).filter((x): x is string => !!x))];
    const breedNameById = breedIds.length ? new Map(
      (await this.db.select({ breed_id: schema.breedMaster.breed_id, breed_name: schema.breedMaster.breed_name })
        .from(schema.breedMaster).where(inArray(schema.breedMaster.breed_id, breedIds))
      ).map((b) => [b.breed_id, b.breed_name])
    ) : new Map<string, string>();

    const stageIds = [...new Set(rows.map((r) => r.stage_id).filter((x): x is string => !!x))];
    const stageNameById = stageIds.length ? new Map(
      (await this.db.select({ stage_id: schema.stageMaster.stage_id, stage_name: schema.stageMaster.stage_name })
        .from(schema.stageMaster).where(inArray(schema.stageMaster.stage_id, stageIds))
      ).map((s) => [s.stage_id, s.stage_name])
    ) : new Map<string, string>();

    const locationIds = [...new Set(rows.map((r) => r.location_id).filter((x): x is string => !!x))];
    const locationNameById = locationIds.length ? new Map(
      (await this.db.select({ location_id: schema.locationMaster.location_id, location_name: schema.locationMaster.location_name })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds))
      ).map((l) => [l.location_id, l.location_name])
    ) : new Map<string, string>();

    const lineCounts = await this.db
      .select({ scheduler_id: schema.schedulerLine.scheduler_id, total: count() })
      .from(schema.schedulerLine)
      .where(inArray(schema.schedulerLine.scheduler_id, rows.map((r) => r.scheduler_id)))
      .groupBy(schema.schedulerLine.scheduler_id);
    const lineCountById = new Map(lineCounts.map((l) => [l.scheduler_id, Number(l.total)]));

    const systemSchedulerIds = [...new Set(rows.map((r) => r.system_scheduler_id).filter((x): x is string => !!x))];
    const systemSchedulerNameById = systemSchedulerIds.length ? new Map(
      (await this.db.select({ system_scheduler_id: schema.systemScheduler.system_scheduler_id, scheduler_name: schema.systemScheduler.scheduler_name })
        .from(schema.systemScheduler).where(inArray(schema.systemScheduler.system_scheduler_id, systemSchedulerIds))
      ).map((s) => [s.system_scheduler_id, s.scheduler_name])
    ) : new Map<string, string>();

    let result = rows.map((r) => ({
      ...r,
      system_scheduler_name: r.system_scheduler_id ? systemSchedulerNameById.get(r.system_scheduler_id) ?? null : null,
      batch_no: batchNoById.get(r.batch_id) ?? null,
      breed_name: r.breed_id ? breedNameById.get(r.breed_id) ?? null : null,
      stage_name: r.stage_id ? stageNameById.get(r.stage_id) ?? null : null,
      location_name: r.location_id ? locationNameById.get(r.location_id) ?? null : null,
      line_count: lineCountById.get(r.scheduler_id) ?? 0,
    }));

    if (query.search) {
      const needle = query.search.toLowerCase();
      result = result.filter((r) => (r.batch_no || '').toLowerCase().includes(needle) || (r.scheduler_no || '').toLowerCase().includes(needle));
    }

    return result;
  }

  async updateStatus(id: string, dto: UpdateSchedulerHeaderStatusDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    if (dto.scheduler_status === 'ACTIVE' && header.scheduler_status === 'DRAFT' && !userPayload?.userId) {
      throw new BadRequestException('Activating a scheduler requires an approving user.');
    }

    const updates: Record<string, unknown> = {
      scheduler_status: dto.scheduler_status,
      notes: dto.notes ?? header.notes,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.scheduler_status === 'ACTIVE' && header.scheduler_status === 'DRAFT') {
      updates.approved_by = userPayload?.userId || null;
      updates.approved_at = toMysqlTimestamp();
    }
    if (dto.scheduler_status === 'COMPLETED') {
      updates.actual_end_date = toDateOnly(new Date());
    }

    await this.db.update(schema.schedulerHeader).set(updates).where(eq(schema.schedulerHeader.scheduler_id, id));

    await this.auditService.log({
      tenantId,
      companyId: header.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE_STATUS',
      entityName: 'scheduler_header',
      entityId: id,
      oldValues: { scheduler_status: header.scheduler_status },
      newValues: { scheduler_status: dto.scheduler_status },
    });

    return this.findOne(id);
  }

  /** Enforces the "LINE TYPE REFERENCE" matrix: which fields a line_type requires. */
  assertLineTypeFields(line_type: string, dto: CreateSchedulerLineDto | UpdateSchedulerLineDto, effective: Record<string, unknown>) {
    const spec = LINE_TYPE_FIELDS[line_type];
    if (!spec) throw new BadRequestException(`Unknown line type '${line_type}'.`);
    const missing = spec.required.filter((key) => effective[key] === undefined || effective[key] === null || effective[key] === '');
    if (missing.length) {
      throw new ConflictException(`${line_type} lines require: ${missing.join(', ')}.`);
    }
    if (dto.occurrence === 'WEEKLY') {
      if (effective.day_of_week == null) {
        throw new ConflictException('A weekly occurrence needs a day of the week.');
      }
      const dow = Number(effective.day_of_week);
      if (!Number.isInteger(dow) || dow < 1 || dow > 7) {
        throw new ConflictException('For a weekly occurrence the day of the week must be between 1 (Monday) and 7 (Sunday).');
      }
    }
    if (dto.occurrence === 'MONTHLY') {
      if (effective.day_of_week != null) {
        const dom = Number(effective.day_of_week);
        if (!Number.isInteger(dom) || dom < 1 || dom > 28) {
          throw new ConflictException('Occurrence MONTHLY entry day of month must be an integer between 1 and 28.');
        }
      }
    }
    if (dto.occurrence === 'CUSTOM' && !(dto.custom_days && dto.custom_days.length)) {
      throw new ConflictException('Occurrence CUSTOM requires at least one custom day.');
    }
    // An empty box arrives as "" and means no end day: compared as a number it is 0,
    // and every copied scheduler was refused with "End Day () cannot be earlier than
    // Start Day (1)".
    const asDay = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));
    const startDay = asDay(effective.start_day);
    const endDay = asDay(effective.end_day);
    if (startDay != null && endDay != null && endDay < startDay) {
      throw new ConflictException(`End Day (${endDay}) cannot be earlier than Start Day (${startDay}).`);
    }
  }

  /** Enforces that two lines with the same item, resource, or metric do not overlap in their scheduled days. */
  assertNoConflictingLines(candidate: Record<string, any>, existingLines: Array<Record<string, any>>) {
    for (const existing of existingLines) {
      if (!this.doLinesTargetSameSubject(candidate, existing)) continue;
      if (!this.checkDaysOverlap(candidate, existing)) continue;

      const periodDesc = this.formatPeriod(existing);
      if (candidate.line_type === 'CONSUMPTION') {
        const name = candidate.item_description || candidate.item_id || candidate.activity_name;
        throw new ConflictException(
          `Schedule conflict: Item '${name}' is already scheduled for activity '${existing.activity_name || 'Existing'}' during an overlapping period (${periodDesc}). Overlapping schedules for the same item are not allowed.`,
        );
      }
      if (candidate.line_type === 'RESOURCE') {
        const name = candidate.resource_id || candidate.activity_name;
        throw new ConflictException(
          `Schedule conflict: Resource '${name}' is already scheduled for activity '${existing.activity_name || 'Existing'}' during an overlapping period (${periodDesc}).`,
        );
      }
      if (candidate.line_type === 'OUTPUT') {
        const name = candidate.item_description || candidate.item_id || candidate.activity_name;
        throw new ConflictException(
          `Schedule conflict: Output '${name}' is already scheduled during an overlapping period (${periodDesc}).`,
        );
      }
      if (candidate.line_type === 'DESCRIPTIVE') {
        const name = candidate.kpi_metric || candidate.activity_name;
        throw new ConflictException(
          `Schedule conflict: KPI metric '${name}' is already scheduled during an overlapping period (${periodDesc}).`,
        );
      }
      if (candidate.line_type === 'OVERHEAD') {
        const name = candidate.overhead_category || candidate.activity_name;
        throw new ConflictException(
          `Schedule conflict: Overhead category '${name}' is already scheduled during an overlapping period (${periodDesc}).`,
        );
      }
      throw new ConflictException(
        `Schedule conflict: Activity '${candidate.activity_name || candidate.line_type}' is already scheduled during an overlapping period (${periodDesc}).`,
      );
    }
  }

  private formatPeriod(line: Record<string, any>): string {
    const start = Math.max(1, Number(line.start_day) || 1);
    const end = line.end_day !== null && line.end_day !== undefined && line.end_day !== ''
      ? `Day ${line.end_day}`
      : 'Stage close';

    if (line.occurrence === 'ONCE') return `Day ${start} (Once)`;
    if (line.occurrence === 'CUSTOM') {
      const days = Array.isArray(line.custom_days)
        ? line.custom_days.map((d: any) => typeof d === 'object' && d !== null ? d.day_number : d).join(', ')
        : line.custom_days || '';
      return days ? `Days ${days} (Custom)` : `Day ${start} to ${end} (Custom)`;
    }
    if (line.occurrence === 'WEEKLY') {
      const dow = line.day_of_week ? `, Day ${line.day_of_week}` : '';
      return `Day ${start} to ${end} (Weekly${dow})`;
    }
    if (line.occurrence === 'MONTHLY') {
      const dom = line.day_of_week ? `, Day ${line.day_of_week}` : '';
      return `Day ${start} to ${end} (Monthly${dom})`;
    }
    return `Day ${start} to ${end}`;
  }

  private doLinesTargetSameSubject(a: Record<string, any>, b: Record<string, any>): boolean {
    if (a.line_type !== b.line_type) return false;
    const type = a.line_type;
    if (type === 'CONSUMPTION') {
      if (a.item_id && b.item_id) {
        if (a.item_id !== b.item_id) return false;
        if (a.activity_name && b.activity_name) {
          return a.activity_name.trim().toLowerCase() === b.activity_name.trim().toLowerCase();
        }
        return true;
      }
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'OUTPUT') {
      if (a.item_id && b.item_id) {
        if (a.item_id !== b.item_id) return false;
        if (a.activity_name && b.activity_name) {
          return a.activity_name.trim().toLowerCase() === b.activity_name.trim().toLowerCase();
        }
        return true;
      }
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'RESOURCE') {
      if (a.resource_id && b.resource_id) {
        if (a.resource_id !== b.resource_id) return false;
        if (a.activity_name && b.activity_name) {
          return a.activity_name.trim().toLowerCase() === b.activity_name.trim().toLowerCase();
        }
        return true;
      }
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'DESCRIPTIVE') {
      if (a.kpi_metric && b.kpi_metric) return a.kpi_metric.trim().toLowerCase() === b.kpi_metric.trim().toLowerCase();
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'OVERHEAD') {
      if (a.overhead_category && b.overhead_category) return a.overhead_category.trim().toLowerCase() === b.overhead_category.trim().toLowerCase();
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'TRANSFER') {
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    return false;
  }

  private parseCustomDays(raw: unknown): number[] {
    if (Array.isArray(raw)) {
      return raw.map((d) => (typeof d === 'object' && d !== null && 'day_number' in d ? Number((d as any).day_number) : Number(d))).filter((n) => !Number.isNaN(n) && n > 0);
    }
    if (typeof raw === 'string') {
      return raw.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0);
    }
    return [];
  }

  private checkDaysOverlap(a: Record<string, any>, b: Record<string, any>): boolean {
    const startA = Math.max(1, Number(a.start_day) || 1);
    const endA = a.end_day !== null && a.end_day !== undefined && a.end_day !== ''
      ? Math.max(startA, Number(a.end_day))
      : Number.POSITIVE_INFINITY;

    const startB = Math.max(1, Number(b.start_day) || 1);
    const endB = b.end_day !== null && b.end_day !== undefined && b.end_day !== ''
      ? Math.max(startB, Number(b.end_day))
      : Number.POSITIVE_INFINITY;

    const rangeOverlap = Math.max(startA, startB) <= Math.min(endA, endB);
    if (!rangeOverlap) return false;

    const occA = (a.occurrence || 'DAILY').toUpperCase();
    const occB = (b.occurrence || 'DAILY').toUpperCase();

    const customA = occA === 'CUSTOM' ? this.parseCustomDays(a.custom_days) : [];
    const customB = occB === 'CUSTOM' ? this.parseCustomDays(b.custom_days) : [];

    if (occA === 'CUSTOM' && occB === 'CUSTOM') {
      if (!customA.length || !customB.length) return rangeOverlap;
      return customA.some((day) => customB.includes(day));
    }
    if (occA === 'CUSTOM' && occB === 'ONCE') {
      return customA.length ? customA.includes(startB) : startB >= startA && startB <= endA;
    }
    if (occB === 'CUSTOM' && occA === 'ONCE') {
      return customB.length ? customB.includes(startA) : startA >= startB && startA <= endB;
    }
    if (occA === 'CUSTOM') {
      if (!customA.length) return true;
      return customA.some((day) => day >= startB && day <= endB);
    }
    if (occB === 'CUSTOM') {
      if (!customB.length) return true;
      return customB.some((day) => day >= startA && day <= endA);
    }
    if (occA === 'ONCE' && occB === 'ONCE') {
      return startA === startB;
    }
    if (occA === 'ONCE' && occB === 'DAILY') {
      return startA >= startB && startA <= endB;
    }
    if (occB === 'ONCE' && occA === 'DAILY') {
      return startB >= startA && startB <= endA;
    }
    if (occA === 'WEEKLY' && occB === 'WEEKLY') {
      const dowA = a.day_of_week ? Number(a.day_of_week) : null;
      const dowB = b.day_of_week ? Number(b.day_of_week) : null;
      if (dowA && dowB) return dowA === dowB;
      return true;
    }
    if (occA === 'MONTHLY' && occB === 'MONTHLY') {
      const domA = a.day_of_week ? Number(a.day_of_week) : null;
      const domB = b.day_of_week ? Number(b.day_of_week) : null;
      if (domA && domB) return domA === domB;
      return true;
    }
    return true;
  }

  /** "KPI UOM fetched as per KPI" — a recognized kpi_metric always wins over whatever
   * kpi_uom was supplied; only an unrecognized/CUSTOM metric keeps the caller's value. */
  resolveKpiUom(kpiMetric: string | null | undefined, suppliedUom: string | null | undefined): string | null {
    if (kpiMetric && KPI_METRIC_UOM[kpiMetric]) return KPI_METRIC_UOM[kpiMetric];
    return suppliedUom ?? null;
  }

  async addLine(headerId: string, dto: CreateSchedulerLineDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(headerId);
    this.assertLineTypeFields(dto.line_type, dto, dto as unknown as Record<string, unknown>);
    this.assertNoConflictingLines(dto, header.lines);

    // Unique per scheduler_id (uq_scheduler_line_scheduler_seq); the data-entry
    // screen groups by line_type and orders by this value within that group.
    const maxSeq = header.lines.reduce((max, l) => Math.max(max, l.line_seq), 0);
    const lineId = randomUUID();
    await this.db.insert(schema.schedulerLine).values({
      line_id: lineId,
      scheduler_id: headerId,
      line_seq: maxSeq + 1,
      line_type: dto.line_type,
      activity_name: dto.activity_name,
      // Auto-flows from the header — every line under one header shares its one stage.
      stage_id: header.stage_id,
      occurrence: dto.occurrence || 'DAILY',
      start_day: dto.start_day ?? 1,
      end_day: dto.end_day ?? null,
      day_of_week: dto.day_of_week ?? null,
      is_mandatory: dto.is_mandatory ?? false,
      source: 'MANUAL',
      nob_id: header.nob_id,
      lob_id: header.lob_id,
      item_id: dto.item_id || null,
      item_description: dto.item_description || null,
      standard_qty: dto.standard_qty?.toString() ?? null,
      qty_basis: dto.qty_basis || null,
      allow_qty_edit: dto.allow_qty_edit ?? true,
      lot_required: dto.lot_required ?? false,
      creates_inventory: dto.creates_inventory ?? false,
      output_lot_auto: dto.output_lot_auto ?? true,
      output_basis: dto.output_basis || null,
      kpi_metric: dto.kpi_metric || null,
      kpi_uom: this.resolveKpiUom(dto.kpi_metric, dto.kpi_uom),
      std_value: dto.std_value?.toString() ?? null,
      lower_alert_limit: dto.lower_alert_limit?.toString() ?? null,
      upper_alert_limit: dto.upper_alert_limit?.toString() ?? null,
      alert_severity: dto.alert_severity || 'WARNING',
      capture_per: dto.capture_per || null,
      overhead_category: dto.overhead_category || null,
      gl_account: dto.gl_account || null,
      estimated_cost: dto.estimated_cost?.toString() ?? null,
      resource_id: dto.resource_id || null,
      auto_triggers_stage: dto.auto_triggers_stage ?? false,
    });

    if (dto.occurrence === 'CUSTOM' && dto.custom_days?.length) {
      await this.db.insert(schema.schedulerLineCustomDays).values(
        dto.custom_days.map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day }))
      );
    }

    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'CREATE', entityName: 'scheduler_line', entityId: lineId, newValues: dto,
    });

    return this.findOne(headerId);
  }

  async updateLine(headerId: string, lineId: string, dto: UpdateSchedulerLineDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(headerId);
    const line = header.lines.find((l) => l.line_id === lineId);
    if (!line) throw new NotFoundException(`Line '${lineId}' not found on this scheduler.`);

    const effectiveType = dto.line_type ?? line.line_type;
    const effective = { ...line, ...dto };
    this.assertLineTypeFields(effectiveType, { ...dto, line_type: effectiveType }, effective as unknown as Record<string, unknown>);
    const otherLines = header.lines.filter((l) => l.line_id !== lineId);
    this.assertNoConflictingLines(effective, otherLines);

    const updates: Record<string, unknown> = { };
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined || key === 'custom_days') continue;
      updates[key] = typeof value === 'number' ? value.toString() : value;
    }
    if ('kpi_metric' in updates || 'kpi_uom' in updates) {
      updates.kpi_uom = this.resolveKpiUom((updates.kpi_metric as string) ?? line.kpi_metric, (updates.kpi_uom as string) ?? line.kpi_uom);
    }

    if (Object.keys(updates).length) {
      await this.db.update(schema.schedulerLine).set(updates).where(eq(schema.schedulerLine.line_id, lineId));
    }

    if (dto.custom_days) {
      await this.db.delete(schema.schedulerLineCustomDays).where(eq(schema.schedulerLineCustomDays.line_id, lineId));
      if (dto.custom_days.length) {
        await this.db.insert(schema.schedulerLineCustomDays).values(
          dto.custom_days.map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day }))
        );
      }
    }

    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'UPDATE', entityName: 'scheduler_line', entityId: lineId, oldValues: line, newValues: dto,
    });

    return this.findOne(headerId);
  }

  async removeLine(headerId: string, lineId: string, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(headerId);
    const line = header.lines.find((l) => l.line_id === lineId);
    if (!line) throw new NotFoundException(`Line '${lineId}' not found on this scheduler.`);

    await this.db.update(schema.schedulerLine).set({ is_active: false }).where(eq(schema.schedulerLine.line_id, lineId));

    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'DELETE', entityName: 'scheduler_line', entityId: lineId, oldValues: line,
    });

    return this.findOne(headerId);
  }
}

import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, inArray, count, sql, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  CreateSchedulerHeaderDto, UpdateSchedulerHeaderDto,
  CreateSchedulerLineDto, UpdateSchedulerLineDto, UpdateSchedulerHeaderStatusDto, QuerySchedulerHeaderDto,
} from './dto/scheduler-header.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

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

@Injectable()
export class SchedulerHeaderService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

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
  ) {
    if (!batch.breed_id) return;
    const [lifecycle] = await this.db
      .select()
      .from(schema.breedLifecycleStages)
      .where(and(
        eq(schema.breedLifecycleStages.breed_id, batch.breed_id),
        eq(schema.breedLifecycleStages.stage_id, stageId),
        eq(schema.breedLifecycleStages.is_active, true),
      ))
      .limit(1);
    if (!lifecycle) return;

    let seq = 1;
    const lines: (typeof schema.schedulerLine.$inferInsert)[] = [];
    const customDaysByLine: Record<string, number[]> = {};

    if (lifecycle.feed_item_id && lifecycle.feed_qty_per_head_per_day_kg) {
      const [feedItem] = await this.db.select({ item_name: schema.itemMaster.item_name }).from(schema.itemMaster).where(eq(schema.itemMaster.item_id, lifecycle.feed_item_id)).limit(1);
      lines.push({
        line_id: randomUUID(), scheduler_id: schedulerId, line_seq: seq++, line_type: 'CONSUMPTION',
        activity_name: `${stage.stage_name} Feed`, stage_id: stageId, occurrence: 'DAILY', start_day: 1, end_day: null,
        is_mandatory: true, source: 'AUTO', lifecycle_ref_id: lifecycle.lifecycle_id,
        nob_id: batch.nob_id, lob_id: batch.lob_id, item_id: lifecycle.feed_item_id,
        item_description: feedItem?.item_name ?? null,
        standard_qty: lifecycle.feed_qty_per_head_per_day_kg, qty_basis: 'PER_HEAD',
        allow_qty_edit: true, lot_required: true,
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
        qty_basis: 'PER_HEAD', allow_qty_edit: true, lot_required: true,
      });
      customDaysByLine[lineId] = [entry.day];
    }

    if (!lines.length) return;
    await this.db.insert(schema.schedulerLine).values(lines);

    const customDayRows = Object.entries(customDaysByLine).flatMap(([lineId, days]) =>
      days.map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day }))
    );
    if (customDayRows.length) await this.db.insert(schema.schedulerLineCustomDays).values(customDayRows);
  }

  /**
   * Auto-creates (or returns the existing) scheduler_header for this batch's
   * stage — called by BatchService.transferStage() right after it resolves a
   * real stage_id. Idempotent on (batch_id, stage_id): re-entering the same
   * stage never duplicates a header.
   */
  async createForStage(batchId: string, stageId: string, tenantId: string, userPayload?: { userId?: string }) {
    const [existing] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.stage_id, stageId)))
      .limit(1);
    if (existing) return this.findOne(existing.scheduler_id);

    const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
    if (!batch) throw new NotFoundException(`Batch '${batchId}' not found.`);

    const [stage] = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
    if (!stage) throw new NotFoundException(`Stage '${stageId}' not found.`);

    // "The same as the batch start date" only holds for this batch's very
    // first scheduler — every later stage transition begins on whatever day
    // it actually happens, not the batch's original day-1 date.
    const [priorHeader] = await this.db.select({ scheduler_id: schema.schedulerHeader.scheduler_id, animal_count: schema.schedulerHeader.animal_count })
      .from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, batchId)).orderBy(desc(schema.schedulerHeader.created_at)).limit(1);
    const effectiveFrom = priorHeader ? toDateOnly(new Date()) : batch.start_date;
    const effectiveTo = stage.typical_duration_days ? addDays(effectiveFrom, stage.typical_duration_days) : null;
    const locationId = batch.sub_location_id || batch.location_id || batch.shed_id || null;

    // "Number of animals at the starting of this scheduler" — the live headcount
    // right now, not the batch's original opening_quantity (which would ignore
    // every mortality/transfer that happened in earlier stages). Preference order:
    // (1) a live animal_register count, for LOBs that track individual animals
    //     (BIO_ASSET costing only — registerPlaceholderAnimals() never runs for
    //     STANDARD-costed batches, so this is legitimately 0 for those);
    // (2) the prior stage's own scheduler_header.animal_count, which already
    //     carries forward whatever mortality/head-count corrections were posted
    //     against it — this is the only place a STANDARD-costed batch's running
    //     count lives, since it has no animal_register rows to re-derive from;
    // (3) batch.closing_quantity/opening_quantity, for this batch's very first
    //     scheduler (no prior header to inherit from).
    const [{ liveCount }] = await this.db.select({ liveCount: count() }).from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
    const animalCount = liveCount > 0
      ? liveCount
      : priorHeader?.animal_count != null
        ? Number(priorHeader.animal_count)
        : Number(batch.closing_quantity ?? batch.opening_quantity);

    const schedulerId = randomUUID();
    await this.db.insert(schema.schedulerHeader).values({
      scheduler_id: schedulerId,
      tenant_id: tenantId,
      company_id: batch.company_id,
      batch_id: batchId,
      stage_id: stageId,
      breed_id: batch.breed_id,
      lob_id: batch.lob_id,
      nob_id: batch.nob_id,
      location_id: locationId,
      scheduler_status: batch.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      animal_count: animalCount.toString(),
      auto_generated: true,
      created_by: userPayload?.userId || null,
    });

    await this.generateLinesFromLifecycle(schedulerId, batch, stageId, stage);

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'scheduler_header',
      entityId: schedulerId,
      newValues: { batch_id: batchId, stage_id: stageId, auto_generated: true },
    });

    return this.findOne(schedulerId);
  }

  /** Manual entry point mirroring transferStage()'s automatic call — resolves the
   * batch's current stage_id itself so callers don't need BatchService. */
  async generateForBatchCurrentStage(batchId: string, tenantId: string, userPayload?: { userId?: string }) {
    const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
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
    const [existing] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, dto.batch_id), eq(schema.schedulerHeader.stage_id, dto.stage_id)))
      .limit(1);
    if (existing) {
      throw new ConflictException(`A scheduler already exists for batch '${dto.batch_id}' and stage '${dto.stage_id}'.`);
    }

    const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, dto.batch_id)).limit(1);
    if (!batch) throw new NotFoundException(`Batch '${dto.batch_id}' not found.`);

    const [stage] = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, dto.stage_id)).limit(1);
    if (!stage) throw new NotFoundException(`Stage '${dto.stage_id}' not found.`);

    if (stage.lob_id !== batch.lob_id) {
      throw new BadRequestException(`Stage '${stage.stage_name}' does not belong to the batch's Line of Business.`);
    }

    // Same rule as createForStage(): a batch's very first scheduler defaults to
    // its start date; a later stage's header defaults to today, since the TDD's
    // "must be the same as the batch start date" only literally holds for that
    // first one. An explicit dto.effective_from always overrides either default,
    // so the lookup only runs when it's actually needed to compute one.
    let effectiveFrom = dto.effective_from;
    if (!effectiveFrom) {
      const [priorHeader] = await this.db.select({ scheduler_id: schema.schedulerHeader.scheduler_id })
        .from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, dto.batch_id)).limit(1);
      effectiveFrom = priorHeader ? toDateOnly(new Date()) : (batch.start_date || toDateOnly(new Date()));
    }
    const effectiveTo = dto.effective_to || (stage.typical_duration_days ? addDays(effectiveFrom, stage.typical_duration_days) : null);
    const locationId = batch.sub_location_id || batch.location_id || batch.shed_id || null;

    let animalCount = dto.animal_count;
    if (animalCount == null) {
      // Same 3-tier fallback as createForStage(): live animal_register count,
      // else the prior stage's own scheduler_header.animal_count (the only
      // place a STANDARD-costed batch's running count lives), else the batch's
      // closing/opening quantity for this batch's very first scheduler.
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

    const schedulerId = randomUUID();
    const status = dto.scheduler_status || 'DRAFT';
    await this.db.insert(schema.schedulerHeader).values({
      scheduler_id: schedulerId,
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
    } else {
      await this.generateLinesFromLifecycle(schedulerId, batch, dto.stage_id, stage);
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

  async findOne(id: string) {
    const [header] = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, id)).limit(1);
    if (!header) throw new NotFoundException(`Scheduler '${id}' not found.`);

    const lines = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, id));
    const lineIds = lines.map((l) => l.line_id);
    const customDays = lineIds.length
      ? await this.db.select().from(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, lineIds))
      : [];
    const siloStock = await this.loadSiloStock(header.location_id);

    const [batch] = await this.db.select({ batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, header.batch_id)).limit(1);
    const [breed] = header.breed_id
      ? await this.db.select({ breed_name: schema.breedMaster.breed_name }).from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, header.breed_id)).limit(1)
      : [null];
    const [stage] = await this.db.select({ stage_name: schema.stageMaster.stage_name }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, header.stage_id)).limit(1);
    const [location] = header.location_id
      ? await this.db.select({ location_name: schema.locationMaster.location_name }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, header.location_id)).limit(1)
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
      silo_stock: siloStock,
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
    return this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.tenant_id, tenantId), eq(schema.schedulerHeader.batch_id, batchId)))
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
    const conditions = [eq(schema.schedulerHeader.tenant_id, tenantId)];
    if (query.companyId) conditions.push(eq(schema.schedulerHeader.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.schedulerHeader.scheduler_status, query.status));
    if (query.lobId) conditions.push(eq(schema.schedulerHeader.lob_id, query.lobId));

    const rows = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(...conditions))
      .orderBy(schema.schedulerHeader.updated_at);
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

    let result = rows.map((r) => ({
      ...r,
      batch_no: batchNoById.get(r.batch_id) ?? null,
      breed_name: r.breed_id ? breedNameById.get(r.breed_id) ?? null : null,
      stage_name: r.stage_id ? stageNameById.get(r.stage_id) ?? null : null,
      location_name: r.location_id ? locationNameById.get(r.location_id) ?? null : null,
      line_count: lineCountById.get(r.scheduler_id) ?? 0,
    }));

    if (query.search) {
      const needle = query.search.toLowerCase();
      result = result.filter((r) => (r.batch_no || '').toLowerCase().includes(needle));
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
  private assertLineTypeFields(line_type: string, dto: CreateSchedulerLineDto | UpdateSchedulerLineDto, effective: Record<string, unknown>) {
    const spec = LINE_TYPE_FIELDS[line_type];
    if (!spec) throw new BadRequestException(`Unknown line_type '${line_type}'.`);
    const missing = spec.required.filter((key) => effective[key] === undefined || effective[key] === null || effective[key] === '');
    if (missing.length) {
      throw new ConflictException(`${line_type} lines require: ${missing.join(', ')}.`);
    }
    if (dto.occurrence === 'WEEKLY' && effective.day_of_week == null) {
      throw new ConflictException('Occurrence WEEKLY requires day_of_week.');
    }
    if (dto.occurrence === 'CUSTOM' && !(dto.custom_days && dto.custom_days.length)) {
      throw new ConflictException('Occurrence CUSTOM requires at least one custom day.');
    }
    const startDay = effective.start_day as number | undefined;
    const endDay = effective.end_day as number | null | undefined;
    if (startDay != null && endDay != null && endDay < startDay) {
      throw new ConflictException(`end_day (${endDay}) cannot be earlier than start_day (${startDay}).`);
    }
  }

  /** Enforces that two lines with the same item, resource, or metric do not overlap in their scheduled days. */
  private assertNoConflictingLines(candidate: Record<string, any>, existingLines: Array<Record<string, any>>) {
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
    return `Day ${start} to ${end}`;
  }

  private doLinesTargetSameSubject(a: Record<string, any>, b: Record<string, any>): boolean {
    if (a.line_type !== b.line_type) return false;
    const type = a.line_type;
    if (type === 'CONSUMPTION') {
      if (a.item_id && b.item_id) return a.item_id === b.item_id;
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'OUTPUT') {
      if (a.item_id && b.item_id) return a.item_id === b.item_id;
      return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
    }
    if (type === 'RESOURCE') {
      if (a.resource_id && b.resource_id) return a.resource_id === b.resource_id;
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
    return true;
  }

  /** "KPI UOM fetched as per KPI" — a recognized kpi_metric always wins over whatever
   * kpi_uom was supplied; only an unrecognized/CUSTOM metric keeps the caller's value. */
  private resolveKpiUom(kpiMetric: string | null | undefined, suppliedUom: string | null | undefined): string | null {
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

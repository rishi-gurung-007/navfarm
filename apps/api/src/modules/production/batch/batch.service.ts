import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, isNull, inArray, desc, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { resolve } from 'path';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  CreateBatchDto,
  AddBatchTransactionDto,
  CloseBatchDto,
  QueryBatchDto,
  MatureBioAssetDto,
  AmortizeBioAssetDto,
  RecordFairValueDto,
  DisposeBioAssetDto,
  RenewBatchDto,
  TransferStageDto,
  BulkDailyEntryDto,
} from './dto/batch.dto';

import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const toDays = (value: number, calcUnit: string): number => {
  if (calcUnit === 'WEEK') return value * 7;
  if (calcUnit === 'MONTH') return value * 30;
  return value;
};

// Splits `total` into `n` shares that sum back to exactly `total` — any
// rounding remainder is absorbed into the last share. Mirrors the frontend's
// animal-multi-select.tsx helper of the same name.
const splitEvenly = (total: number, n: number): number[] => {
  const base = Math.floor((total / n) * 10000) / 10000;
  const shares = new Array(n).fill(base);
  const remainder = Math.round((total - base * n) * 10000) / 10000;
  shares[n - 1] = Math.round((shares[n - 1] + remainder) * 10000) / 10000;
  return shares;
};

export interface UserContext {
  userId?: string;
  email?: string;
  [key: string]: unknown;
}

@Injectable()

export class BatchService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly schedulerHeaderService: SchedulerHeaderService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // bio_asset_ledger.bio_asset_item_id is NOT NULL. A BIO_ASSET batch created
  // without input lines (e.g. a breeding/herd batch seeded directly from
  // animal assignments) has no item_id to fall back to — resolving it here
  // instead of defaulting to '' avoids an FK-constraint crash on every
  // bio-asset lifecycle write (mature/amortize/fair-value/dispose).
  private async resolveBioAssetItemId(batch: { input_lines?: Array<{ item_id: string }> }, tenantId: string): Promise<string> {
    const fromInputLines = batch.input_lines?.[0]?.item_id;
    if (fromInputLines) return fromInputLines;
    const [fallbackItem] = await this.db
      .select({ item_id: schema.itemMaster.item_id })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.is_active, true)))
      .limit(1);
    if (!fallbackItem) {
      throw new BadRequestException('No active items configured for this tenant — a bio-asset ledger entry requires at least one item in Master Data.');
    }
    return fallbackItem.item_id;
  }

  // `executor` defaults to `this.db` but must be passed the active transaction
  // when called from inside one (see `create()`) — `.for('update')` locks the
  // counted rows so a second concurrent call blocks until the first commits its
  // insert, instead of both reading the same count and generating the same number.
  // Delegates to the shared, tenant-configurable number series engine (see
  // number-series.service.ts) rather than locking/counting batch_header rows directly.
  // uq_batch_header_tenant_company_no stays as defense-in-depth either way.
  private async generateBatchNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    return this.numberSeriesService.generateNext('BATCH', tenantId, companyId, executor);
  }

  async create(dto: CreateBatchDto, tenantId: string, userPayload?: UserContext) {
    const [lob] = await this.db
      .select()
      .from(schema.lobMaster)
      .where(and(eq(schema.lobMaster.lob_id, dto.lob_id), eq(schema.lobMaster.is_active, true)))
      .limit(1);
    if (!lob) {
      throw new NotFoundException(`Line of Business with ID '${dto.lob_id}' not found.`);
    }
    const allowedMethods = lob.costing_method_allowed.split(',').map((m) => m.trim().toUpperCase());
    if (!allowedMethods.includes(dto.costing_method.toUpperCase())) {
      throw new BadRequestException(
        `Costing method '${dto.costing_method}' is not allowed for LOB '${lob.lob_name}' (allowed: ${lob.costing_method_allowed}).`
      );
    }

    let initialStage: typeof schema.stageMaster.$inferSelect | undefined;
    if (dto.stage_id) {
      const [stage] = await this.db
        .select()
        .from(schema.stageMaster)
        .where(
          and(
            eq(schema.stageMaster.stage_id, dto.stage_id),
            eq(schema.stageMaster.lob_id, dto.lob_id),
            eq(schema.stageMaster.is_active, true),
            isNull(schema.stageMaster.deleted_at),
          ),
        )
        .limit(1);
      if (!stage) {
        throw new BadRequestException(`Stage with ID '${dto.stage_id}' not found or does not belong to this Line of Business.`);
      }
      initialStage = stage;
    }

    let computedExpectedEndDate = dto.expected_end_date || null;
    if (!computedExpectedEndDate && initialStage?.typical_duration_days) {
      const startDate = new Date(dto.start_date);
      startDate.setDate(startDate.getDate() + initialStage.typical_duration_days);
      computedExpectedEndDate = startDate.toISOString().slice(0, 10);
    }

    const batchId = randomUUID();
    const batchNo = await this.db.transaction(async (tx) => {
      const no = await this.generateBatchNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.batchHeader).values({
        batch_id: batchId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        batch_no: no,
        lob_id: dto.lob_id,
        nob_id: lob.nob_id,
        costing_method: dto.costing_method.toUpperCase(),
        breed_id: dto.breed_id || null,
        stage_id: initialStage?.stage_id || null,
        current_stage_code: initialStage?.stage_code || null,
        shed_id: dto.shed_id || null,
        location_id: dto.location_id || null,
        start_date: dto.start_date,
        expected_end_date: computedExpectedEndDate,
        status: 'DRAFT',
        opening_quantity: dto.opening_quantity.toString(),
        uom: dto.uom,
        remarks: dto.remarks || null,
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.db.insert(schema.batchInputLine).values(
      dto.input_lines.map((line, idx) => ({
        line_id: randomUUID(),
        batch_id: batchId,
        line_no: idx + 1,
        item_id: line.item_id,
        source_batch_id: line.source_batch_id || null,
        quantity: line.quantity.toString(),
        uom: line.uom,
        rate: line.rate?.toString() || null,
        amount: line.rate ? (line.quantity * line.rate).toString() : null,
      }))
    );

    if (dto.costing_method.toUpperCase() === 'STANDARD') {
      let stdOutputQty = dto.standard?.std_output_quantity;
      if (stdOutputQty === undefined || stdOutputQty === null) {
        let mortalityPct = 0;
        if (dto.breed_id) {
          const [breed] = await this.db
            .select()
            .from(schema.breedMaster)
            .where(eq(schema.breedMaster.breed_id, dto.breed_id))
            .limit(1);
          mortalityPct = breed?.avg_mortality_pct ? Number(breed.avg_mortality_pct) : 0;
        }
        stdOutputQty = dto.opening_quantity * (1 - mortalityPct / 100);
      }

      await this.db.insert(schema.batchStandard).values({
        standard_id: randomUUID(),
        batch_id: batchId,
        std_output_quantity: stdOutputQty.toString(),
        std_output_cost_per_unit: dto.standard?.std_output_cost_per_unit?.toString() || null,
        std_overhead_rate_per_unit: dto.standard?.std_overhead_rate_per_unit?.toString() || null,
        created_by: userPayload?.userId || null,
      });

      if (dto.standard?.consumption_lines?.length) {
        await this.db.insert(schema.batchStandardConsumptionLine).values(
          dto.standard.consumption_lines.map((line) => ({
            line_id: randomUUID(),
            batch_id: batchId,
            item_id: line.item_id,
            std_qty_per_unit_per_day: line.std_qty_per_unit_per_day.toString(),
            std_rate: line.std_rate?.toString() || null,
          }))
        );
      }
    }

    if (dto.costing_method.toUpperCase() === 'BIO_ASSET') {
      await this.db.insert(schema.batchBioAssetState).values({
        state_id: randomUUID(),
        batch_id: batchId,
        stage: 'PREMATURE',
        current_quantity: dto.opening_quantity.toString(),
        nca_book_value: '0.0000',
      });

      // Livestock (breed_id set) batches get one animal_register row per head
      // of opening_quantity, so every physical animal is individually
      // selectable from day one instead of only whichever few a user later
      // registers by hand. Deliberately does NOT post to bio_asset_ledger —
      // activate() already posts one aggregate ACQUISITION entry for the
      // batch's full input-line cost; a second, per-animal posting here would
      // double-count the acquisition value in the ledger.
      if (dto.breed_id) {
        await this.registerPlaceholderAnimals({
          batchId,
          tenantId,
          companyId: dto.company_id,
          nobId: lob.nob_id,
          lobId: dto.lob_id,
          breedId: dto.breed_id,
          locationId: dto.location_id || null,
          headcount: dto.opening_quantity,
          entryDate: dto.start_date,
          inputLines: dto.input_lines,
          sourceBatchId: dto.input_lines.find((l) => l.source_batch_id)?.source_batch_id || null,
          userId: userPayload?.userId,
        });
      }
    }

    if (initialStage && dto.auto_generate_scheduler !== false) {
      await this.schedulerHeaderService.createForStage(batchId, initialStage.stage_id, tenantId, userPayload);
    }

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_header',
      entityId: batchId,
      newValues: { batch_no: batchNo, ...dto },
    });

    return this.findOne(batchId);
  }

  /**
   * Copy-forward for perpetual/seasonal LOBs (orchards, apiaries) — creates a
   * new DRAFT batch carrying the source's config (breed, shed, costing method,
   * standard-cost assumptions) forward, needing only the new cycle's own
   * start date / opening quantity / input lines. Gated by
   * lob_master.batch_copy_allowed — matches the spec's "annual batch copy"
   * (year-end: COPY batch for next season, location auto-copied). The new
   * batch gets its own scheduler_header the first time it transfers into a
   * stage, same as any other batch — nothing scheduler-related carries
   * forward from the source.
   */
  async renew(id: string, dto: RenewBatchDto, tenantId: string, userPayload?: UserContext) {
    const source = await this.findOne(id);
    this.assertStatus(source, 'CLOSED');

    const [lob] = await this.db.select().from(schema.lobMaster).where(eq(schema.lobMaster.lob_id, source.lob_id)).limit(1);
    if (lob?.batch_copy_allowed !== 'YES') {
      throw new BadRequestException(`LOB '${lob?.lob_name || source.lob_id}' does not allow batch renewal.`);
    }

    const created = await this.create(
      {
        company_id: source.company_id,
        lob_id: source.lob_id,
        costing_method: source.costing_method,
        breed_id: source.breed_id || undefined,
        shed_id: source.shed_id || undefined,
        location_id: source.location_id || undefined,
        start_date: dto.start_date,
        expected_end_date: dto.expected_end_date,
        opening_quantity: dto.opening_quantity,
        uom: dto.uom,
        remarks: dto.remarks,
        input_lines: dto.input_lines,
        standard: source.standard
          ? {
              // std_output_quantity is deliberately NOT carried forward — it's
              // re-derived from the new opening_quantity × breed mortality%
              // by create() itself, the same way a fresh batch would.
              std_output_cost_per_unit: source.standard.std_output_cost_per_unit ? Number(source.standard.std_output_cost_per_unit) : undefined,
              std_overhead_rate_per_unit: source.standard.std_overhead_rate_per_unit ? Number(source.standard.std_overhead_rate_per_unit) : undefined,
              consumption_lines: (source.standard.consumption_lines || []).map((l: { item_id: string; std_qty_per_unit_per_day: string | number; std_rate?: string | number | null }) => ({
                item_id: l.item_id,
                std_qty_per_unit_per_day: Number(l.std_qty_per_unit_per_day),
                std_rate: l.std_rate ? Number(l.std_rate) : undefined,
              })),
            }
          : undefined,
      },
      tenantId,
      userPayload
    );

    await this.db
      .update(schema.batchHeader)
      .set({ renewed_from_batch_id: id, updated_by: userPayload?.userId || null, updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchHeader.batch_id, created.batch_id));

    await this.auditService.log({
      tenantId,
      companyId: source.company_id,
      userId: userPayload?.userId,
      action: 'RENEW',
      entityName: 'batch_header',
      entityId: created.batch_id,
      newValues: { renewed_from_batch_id: id },
    });

    return this.findOne(created.batch_id);
  }

  async findOne(id: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, id), isNull(schema.batchHeader.deleted_at)))
      .limit(1);

    if (!batch) {
      throw new NotFoundException(`Batch with ID '${id}' not found.`);
    }

    const inputLines = await this.db.select().from(schema.batchInputLine).where(eq(schema.batchInputLine.batch_id, id));
    const transactions = await this.db
      .select({
        transaction_id: schema.batchTransaction.transaction_id,
        batch_id: schema.batchTransaction.batch_id,
        transaction_date: schema.batchTransaction.transaction_date,
        transaction_type: schema.batchTransaction.transaction_type,
        item_id: schema.batchTransaction.item_id,
        resource_id: schema.batchTransaction.resource_id,
        quantity: schema.batchTransaction.quantity,
        uom: schema.batchTransaction.uom,
        rate: schema.batchTransaction.rate,
        amount: schema.batchTransaction.amount,
        remarks: schema.batchTransaction.remarks,
        persons: schema.batchTransaction.persons,
        hours: schema.batchTransaction.hours,
        adg: schema.batchTransaction.adg,
        bcs_score: schema.batchTransaction.bcs_score,
        animal_id: schema.batchTransaction.animal_id,
        item_name: schema.itemMaster.item_name,
        item_code: schema.itemMaster.item_code,
        animal_ear_tag: schema.animalRegister.ear_tag,
        animal_code: schema.animalRegister.animal_code,
        // Who logged it — the mortality/treatment registers show this, and
        // without the join they had no recorder to display.
        created_by: schema.batchTransaction.created_by,
        created_by_name: schema.userMaster.full_name,
        // Clinical detail — null on every row that is not a death or a
        // treatment, and on historical rows recorded before these tables.
        pen_location_id: schema.batchMortalityDetail.location_id,
        pen_location_name: schema.locationMaster.location_name,
        cause_of_death: schema.batchMortalityDetail.cause_of_death,
        post_mortem_notes: schema.batchMortalityDetail.post_mortem_notes,
        disposal_method: schema.batchMortalityDetail.disposal_method,
        diagnosis: schema.batchTreatmentDetail.diagnosis,
        route: schema.batchTreatmentDetail.route,
        withdrawal_days: schema.batchTreatmentDetail.withdrawal_days,
        veterinarian: schema.batchTreatmentDetail.veterinarian,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.batchTransaction.item_id, schema.itemMaster.item_id))
      .leftJoin(schema.animalRegister, eq(schema.batchTransaction.animal_id, schema.animalRegister.animal_id))
      .leftJoin(schema.userMaster, eq(schema.batchTransaction.created_by, schema.userMaster.user_id))
      .leftJoin(schema.batchMortalityDetail, eq(schema.batchTransaction.transaction_id, schema.batchMortalityDetail.transaction_id))
      .leftJoin(schema.batchTreatmentDetail, eq(schema.batchTransaction.transaction_id, schema.batchTreatmentDetail.transaction_id))
      .leftJoin(schema.locationMaster, eq(schema.batchMortalityDetail.location_id, schema.locationMaster.location_id))
      .where(eq(schema.batchTransaction.batch_id, id));
    const outputLines = await this.db.select().from(schema.batchOutputLine).where(eq(schema.batchOutputLine.batch_id, id));
    const attachments = await this.db
      .select()
      .from(schema.batchAttachment)
      .where(eq(schema.batchAttachment.batch_id, id))
      .orderBy(desc(schema.batchAttachment.created_at));

    const [standard] = await this.db.select().from(schema.batchStandard).where(eq(schema.batchStandard.batch_id, id)).limit(1);
    const standardConsumptionLines = standard
      ? await this.db.select().from(schema.batchStandardConsumptionLine).where(eq(schema.batchStandardConsumptionLine.batch_id, id))
      : [];
    const variances = await this.db.select().from(schema.batchCostVariance).where(eq(schema.batchCostVariance.batch_id, id));

    const [bioAssetState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, id)).limit(1);
    const bioAssetEntries = bioAssetState
      ? await this.db.select().from(schema.bioAssetLedger).where(eq(schema.bioAssetLedger.batch_id, id))
      : [];

    // The batch's current-stage scheduler_header — one row per (batch_id, stage_id),
    // auto-created by SchedulerHeaderService.createForStage() on transferStage().
    const [schedulerHeader] = batch.stage_id
      ? await this.db.select().from(schema.schedulerHeader)
          .where(and(eq(schema.schedulerHeader.batch_id, id), eq(schema.schedulerHeader.stage_id, batch.stage_id)))
          .limit(1)
      : [];
    const schedulerLines = schedulerHeader
      ? await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.scheduler_id, schedulerHeader.scheduler_id))
      : [];
    const alerts = await this.db.select().from(schema.notificationAlertLog).where(eq(schema.notificationAlertLog.batch_id, id));
    const stageLog = await this.db.select().from(schema.batchStageLog).where(eq(schema.batchStageLog.batch_id, id));

    return {
      ...batch,
      input_lines: inputLines,
      transactions,
      output_lines: outputLines,
      attachments,
      standard: standard ? { ...standard, consumption_lines: standardConsumptionLines } : null,
      variances,
      bio_asset_state: bioAssetState || null,
      bio_asset_entries: bioAssetEntries,
      scheduler: schedulerHeader ? { ...schedulerHeader, lines: schedulerLines } : null,
      alerts,
      stage_log: stageLog,
    };
  }

  /**
   * Records a physical move to a new stage/sub-location mid-life (e.g. setter
   * room -> hatcher room) — a tracking event, not a cost event, so there's no
   * GL impact (matches spec: "sub-location transfer... No journal, location
   * update"). Feeds evaluateKpi() below, which matches scheduler_parameter_line
   * rows against the batch's CURRENT stage so thresholds can differ pre- vs.
   * post-transfer.
   */
  async transferStage(id: string, dto: TransferStageDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');

    // Opportunistic link to stage_master: if this LOB has a seeded stage matching
    // the given code, record it alongside current_stage_code. If not (LOB has no
    // Stage Master data, or the code is hand-typed/custom), stage_id just stays
    // null — current_stage_code remains fully authoritative either way.
    const [matchedStage] = await this.db
      .select({ stage_id: schema.stageMaster.stage_id })
      .from(schema.stageMaster)
      .where(
        and(
          eq(schema.stageMaster.lob_id, batch.lob_id),
          eq(schema.stageMaster.stage_code, dto.to_stage_code.toUpperCase()),
          eq(schema.stageMaster.is_active, true),
          isNull(schema.stageMaster.deleted_at),
        )
      )
      .limit(1);

    // A code that matches nothing, for a LOB that HAS stages configured, is a
    // caller mistake rather than a LOB without stage master data — the batch
    // stages screen once posted its own display codes (ST-01..ST-08), writing
    // "ST-05" into current_stage_code and leaving stage_id null. Accepting it
    // silently is what let that corrupt a live batch, so refuse it instead.
    if (!matchedStage) {
      const configured = await this.db
        .select({ stage_code: schema.stageMaster.stage_code })
        .from(schema.stageMaster)
        .where(
          and(
            eq(schema.stageMaster.lob_id, batch.lob_id),
            eq(schema.stageMaster.is_active, true),
            isNull(schema.stageMaster.deleted_at),
          )
        );
      if (configured.length > 0) {
        throw new BadRequestException(
          `'${dto.to_stage_code}' is not a stage of this line of business. Valid stages: ${configured.map((c) => c.stage_code).join(', ')}.`,
        );
      }
    }

    await this.db
      .update(schema.batchHeader)
      .set({
        current_stage_code: dto.to_stage_code,
        stage_id: matchedStage?.stage_id || null,
        sub_location_id: dto.to_location_id || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchHeader.batch_id, id));

    // Animals carry their own current_stage_id (animal_register), which the herd
    // and bio-asset-by-stage reports read. Moving the batch without repointing
    // them left every animal reporting the stage it was in before the transfer.
    //
    // Only the animals that were IN STEP with the batch move. An animal that has
    // been deliberately diverged — a tail-ender held back at an earlier stage, or
    // one pulled into a hospital pen — stays where it is, which is the whole
    // point of tracking stage per animal rather than only per batch. Cascading
    // unconditionally would silently drag those animals forward.
    if (matchedStage?.stage_id) {
      const inStep = await this.db
        .select({ animal_id: schema.animalRegister.animal_id })
        .from(schema.animalRegister)
        .where(
          and(
            eq(schema.animalRegister.current_batch_id, id),
            batch.stage_id
              ? eq(schema.animalRegister.current_stage_id, batch.stage_id)
              : isNull(schema.animalRegister.current_stage_id),
          )
        );

      if (inStep.length > 0) {
        await this.db
          .update(schema.animalRegister)
          .set({
            current_stage_id: matchedStage.stage_id,
            updated_by: userPayload?.userId || null,
            updated_at: toMysqlTimestamp(),
          })
          .where(inArray(schema.animalRegister.animal_id, inStep.map((a) => a.animal_id)));
      }
    }

    await this.db.insert(schema.batchStageLog).values({
      log_id: randomUUID(),
      batch_id: id,
      from_stage_code: batch.current_stage_code || null,
      to_stage_code: dto.to_stage_code,
      from_location_id: batch.sub_location_id || null,
      to_location_id: dto.to_location_id || null,
      transferred_by: userPayload?.userId || null,
      remarks: dto.remarks || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'TRANSFER_STAGE',
      entityName: 'batch_header',
      entityId: id,
      oldValues: { current_stage_code: batch.current_stage_code, sub_location_id: batch.sub_location_id },
      newValues: { current_stage_code: dto.to_stage_code, sub_location_id: dto.to_location_id },
    });

    if (batch.stage_id) {
      const todayDate = toMysqlTimestamp().slice(0, 10);
      await this.db
        .update(schema.schedulerHeader)
        .set({
          scheduler_status: 'COMPLETED',
          actual_end_date: todayDate,
          updated_at: toMysqlTimestamp(),
        })
        .where(
          and(
            eq(schema.schedulerHeader.batch_id, id),
            eq(schema.schedulerHeader.stage_id, batch.stage_id),
            eq(schema.schedulerHeader.scheduler_status, 'ACTIVE'),
          ),
        );
    }

    // Auto-create this stage's scheduler_header + lines — only once the code
    // resolved to a real Stage Master row (matchedStage.stage_id); a batch
    // whose LOB has no Stage Master data gets no scheduler, same as it gets
    // no stage_id. Idempotent, so a correction that re-runs the same
    // transfer never duplicates it.
    if (matchedStage?.stage_id) {
      await this.schedulerHeaderService.createForStage(id, matchedStage.stage_id, tenantId, userPayload);
    }

    return this.findOne(id);
  }

  async findAll(query: QueryBatchDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.batchHeader.tenant_id, tenantId), isNull(schema.batchHeader.deleted_at)];

    if (query.companyId) conditions.push(eq(schema.batchHeader.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.batchHeader.status, query.status));
    if (query.lobId) conditions.push(eq(schema.batchHeader.lob_id, query.lobId));
    if (query.search) conditions.push(like(schema.batchHeader.batch_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const rows = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    // Returning the bare rows here widened findAll's type to a union whose
    // other branch has no wip_value/breed_name/stage_name — callers then could
    // not read the fields this method exists to add.
    if (rows.length === 0) return [];

    /**
     * Work-in-progress cost carried by each batch.
     *
     * batch_header.total_cost is only written when a batch is CLOSED, so an
     * ACTIVE batch has none however much it has consumed. The console's WIP
     * tile reads `wip_value`, which nothing returned — the figure was
     * structurally zero rather than merely unposted. For an open batch this is
     * what it has accumulated so far; for a closed one the posted total wins.
     */
    const batchIds = rows.map((r) => r.batch_id);
    const costTx = await this.db
      .select({
        batch_id: schema.batchTransaction.batch_id,
        transaction_type: schema.batchTransaction.transaction_type,
        amount: schema.batchTransaction.amount,
      })
      .from(schema.batchTransaction)
      .where(inArray(schema.batchTransaction.batch_id, batchIds));

    const accrued = new Map<string, number>();
    for (const tx of costTx) {
      // Only cost-bearing movements. Mortality and observations are recorded
      // against the batch but are not spend.
      if (tx.transaction_type !== 'CONSUMPTION' && tx.transaction_type !== 'OVERHEAD') continue;
      accrued.set(tx.batch_id, (accrued.get(tx.batch_id) ?? 0) + Number(tx.amount || 0));
    }

    // Breed and stage names, so list screens don't have to render a raw UUID
    // or an em-dash where the breed belongs.
    const breedIds = [...new Set(rows.map((r) => r.breed_id).filter((x): x is string => !!x))];
    const stageIds = [...new Set(rows.map((r) => r.stage_id).filter((x): x is string => !!x))];
    const breedNames = breedIds.length === 0 ? new Map<string, string>() : new Map(
      (await this.db
        .select({ breed_id: schema.breedMaster.breed_id, breed_name: schema.breedMaster.breed_name })
        .from(schema.breedMaster)
        .where(inArray(schema.breedMaster.breed_id, breedIds))
      ).map((b) => [b.breed_id, b.breed_name])
    );
    const stageNames = stageIds.length === 0 ? new Map<string, string>() : new Map(
      (await this.db
        .select({ stage_id: schema.stageMaster.stage_id, stage_name: schema.stageMaster.stage_name })
        .from(schema.stageMaster)
        .where(inArray(schema.stageMaster.stage_id, stageIds))
      ).map((st) => [st.stage_id, st.stage_name])
    );

    return rows.map((r) => ({
      ...r,
      wip_value: r.total_cost != null ? Number(r.total_cost) : (accrued.get(r.batch_id) ?? 0),
      breed_name: r.breed_id ? breedNames.get(r.breed_id) ?? null : null,
      stage_name: r.stage_id ? stageNames.get(r.stage_id) ?? null : null,
    }));
  }

  private assertStatus(batch: { status: string }, expected: string) {
    if (batch.status !== expected) {
      throw new BadRequestException(`Batch must be ${expected} for this action — it is currently ${batch.status}.`);
    }
  }

  /**
   * Auto-registers `headcount` placeholder animal_register rows for a
   * newly-created BIO_ASSET batch. Per-animal fields that have no real
   * source at batch-creation time are deliberately generic/even-split rather
   * than guessed specifics — animal_type is the neutral COMMERCIAL_PIG (not
   * SOW/BOAR/GILT, which would presume an unverified breeding-stock role),
   * gender alternates M/F, and acquisition_cost is the batch's total
   * input-line cost split evenly per head. All fields remain individually
   * editable later via the normal animal-register edit flow.
   */
  private async registerPlaceholderAnimals(params: {
    batchId: string;
    tenantId: string;
    companyId: string;
    nobId: string;
    lobId: string;
    breedId: string;
    locationId: string | null;
    headcount: number;
    entryDate: string;
    inputLines: Array<{ item_id: string; quantity: number; rate?: number; source_batch_id?: string }>;
    sourceBatchId: string | null;
    userId?: string;
  }) {
    const { batchId, tenantId, companyId, nobId, lobId, breedId, locationId, headcount, entryDate, inputLines, sourceBatchId, userId } = params;
    if (headcount <= 0) return;

    const itemId = inputLines[0]?.item_id;
    if (!itemId) return; // no input line to attribute cost/item to — skip rather than guess

    const totalCost = inputLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.rate || 0), 0);
    const shares = splitEvenly(totalCost, headcount);
    const entryType = sourceBatchId ? 'TRANSFERRED_IN' : 'PURCHASED_LOCAL';

    const createdIds: string[] = [];
    for (let i = 0; i < headcount; i++) {
      const animalId = randomUUID();
      // Sequential, not Promise.all — generateNext row-locks the series and
      // must serialize to hand out distinct codes.
      // Resolved, not hardcoded. This asked for ANIMAL_PIGGERY by name, which
      // broke the moment the series was renamed to ANIMAL — resolveSeriesFor
      // tries the LOB-specific ANIMAL_PIGGERY first and falls back to ANIMAL,
      // so either naming works and a new LOB can still take its own series.
      const animalSeries = await this.numberSeriesService.resolveSeriesFor('ANIMAL', 'PIGGERY', tenantId, companyId);
      if (!animalSeries) throw new BadRequestException('No animal number series is configured for this workspace.');
      const animalCode = await this.numberSeriesService.generateNext(animalSeries, tenantId, companyId);
      const cost = shares[i];
      await this.db.insert(schema.animalRegister).values({
        animal_id: animalId,
        tenant_id: tenantId,
        company_id: companyId,
        nob_id: nobId,
        lob_id: lobId,
        animal_code: animalCode,
        animal_type: 'COMMERCIAL_PIG',
        breed_id: breedId,
        gender: i % 2 === 0 ? 'F' : 'M',
        entry_type: entryType,
        entry_date: entryDate,
        source_batch_id: sourceBatchId || null,
        item_id: itemId,
        current_batch_id: batchId,
        current_location_id: locationId,
        acquisition_cost: cost.toFixed(4),
        total_opening_asset_value: cost.toFixed(4),
        current_bio_asset_value: cost.toFixed(4),
        total_amortised: '0.0000',
        book_value: cost.toFixed(4),
        status: 'ACTIVE',
        is_active: true,
        created_by: userId || null,
        updated_by: userId || null,
      });
      createdIds.push(animalId);
    }

    await this.auditService.log({
      tenantId,
      companyId,
      userId,
      action: 'CREATE',
      entityName: 'animal_register',
      entityId: batchId,
      newValues: { auto_registered_for_batch: batchId, headcount, animal_ids: createdIds },
    });
  }

  /** DRAFT → ACTIVE: consumes each input line from inventory via FIFO, mirrors to GL. */
  async activate(id: string, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'DRAFT');

    if (!batch.input_lines || batch.input_lines.length === 0) {
      throw new BadRequestException('Cannot activate a batch with no input lines.');
    }

    if (batch.costing_method === 'BIO_ASSET') {
      // Acquiring animals is a direct purchase creating an NCA — not a draw
      // against existing warehouse stock, so no FIFO/inventory_ledger here.
      let totalAcquisitionCost = 0;
      for (const line of batch.input_lines) {
        const amount = Number(line.quantity) * Number(line.rate || 0);
        totalAcquisitionCost += amount;
        await this.glPostingService.postBatchCostEntry({
          tenantId,
          companyId: batch.company_id,
          transactionType: 'BIO_ACQUISITION',
          amount,
          documentNo: batch.batch_no,
          documentLineId: line.line_id,
          postingDate: batch.start_date,
          description: `Acquisition — ${batch.batch_no}`,
          nobId: batch.nob_id || undefined,
          lobId: batch.lob_id,
          stageId: batch.stage_id || undefined,
          userId: userPayload?.userId,
        });
        await this.db.insert(schema.bioAssetLedger).values({
          entry_id: randomUUID(),
          tenant_id: tenantId,
          company_id: batch.company_id,
          bio_asset_item_id: line.item_id,
          entry_type: 'ACQUISITION',
          document_no: batch.batch_no,
          batch_id: id,
          batch_no: batch.batch_no,
          posting_date: batch.start_date,
          stage: 'PREMATURE',
          quantity: line.quantity,
          cost_amount: amount.toString(),
          cost_amount_each_unit: line.rate || null,
          costing_method: 'COST_ACCUMULATION',
          nob_id: batch.nob_id,
          lob_id: batch.lob_id,
          created_by: userPayload?.userId || null,
        });
      }
      await this.db
        .update(schema.batchBioAssetState)
        .set({ nca_book_value: totalAcquisitionCost.toString(), updated_at: toMysqlTimestamp() })
        .where(eq(schema.batchBioAssetState.batch_id, id));
    } else {
      for (const line of batch.input_lines) {
        const ledgerEntry = await this.ledgerService.writeNegativeEntry({
          tenantId,
          companyId: batch.company_id,
          itemId: line.item_id,
          documentType: 'BATCH',
          documentNo: batch.batch_no,
          documentLineId: line.line_id,
          postingDate: batch.start_date,
          transactionType: 'BATCH_INPUT',
          quantity: Number(line.quantity),
          uom: line.uom,
          batchNo: batch.batch_no,
          userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);

        // The line's rate/amount was only an estimate before activation — now
        // that FIFO has drawn the real cost, reflect it back on the line.
        await this.db
          .update(schema.batchInputLine)
          .set({ rate: ledgerEntry.rate, amount: (Math.abs(Number(ledgerEntry.amount)) || 0).toString() })
          .where(eq(schema.batchInputLine.line_id, line.line_id));
      }
    }

    await this.db
      .update(schema.batchHeader)
      .set({ status: 'ACTIVE', updated_by: userPayload?.userId || null, updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchHeader.batch_id, id));

    if (batch.stage_id) {
      await this.db
        .update(schema.schedulerHeader)
        .set({ scheduler_status: 'ACTIVE', updated_at: toMysqlTimestamp() })
        .where(
          and(
            eq(schema.schedulerHeader.batch_id, id),
            eq(schema.schedulerHeader.stage_id, batch.stage_id),
            eq(schema.schedulerHeader.scheduler_status, 'DRAFT'),
          ),
        );
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'ACTIVATE',
      entityName: 'batch_header',
      entityId: id,
      newValues: { status: 'ACTIVE' },
    });

    return this.findOne(id);
  }

  /** Running cost per opening unit so far — a simple valuation basis for MORTALITY write-offs mid-batch. */
  private async computeRunningUnitCost(batch: Awaited<ReturnType<BatchService['findOne']>>): Promise<number> {
    const inputTotal = (batch.input_lines || []).reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const consumptionTotal = (batch.transactions || [])
      .filter((t) => t.transaction_type === 'CONSUMPTION' || t.transaction_type === 'OVERHEAD')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const opening = Number(batch.opening_quantity || 0);
    return opening > 0 ? (inputTotal + consumptionTotal) / opening : 0;
  }

  async addTransaction(id: string, dto: AddBatchTransactionDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');

    // Checked up front: clinical detail is written after the transaction row,
    // so rejecting it later would leave a half-recorded event behind.
    if (dto.mortality_detail && dto.transaction_type !== 'MORTALITY') {
      throw new BadRequestException('mortality_detail can only be recorded on a MORTALITY transaction.');
    }
    if (dto.treatment_detail && dto.transaction_type !== 'CONSUMPTION') {
      throw new BadRequestException('treatment_detail belongs on the CONSUMPTION row that issues the medicine or vaccine.');
    }

    const isBioAsset = batch.costing_method === 'BIO_ASSET';
    let bioState: typeof schema.batchBioAssetState.$inferSelect | undefined;
    if (isBioAsset) {
      [bioState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, id)).limit(1);
      if (!bioState) {
        const stateId = randomUUID();
        const stage = ['GESTATION', 'DRY_SOW_GESTATION', 'LACTATION'].includes(batch.current_stage_code || '') ? 'MATURE' : 'PREMATURE';
        await this.db.insert(schema.batchBioAssetState).values({
          state_id: stateId,
          batch_id: id,
          stage,
          current_quantity: batch.opening_quantity?.toString() || '1',
          nca_book_value: stage === 'MATURE' ? (Number(batch.opening_quantity || 1) * 28000).toString() : '0.0000',
        });
        [bioState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.state_id, stateId)).limit(1);
      }
    }
    const bio = bioState;

    let bioAssetSubjectItemId = dto.item_id || batch.input_lines?.[0]?.item_id;
    if (!bioAssetSubjectItemId && isBioAsset) {
      const [fallbackItem] = await this.db
        .select({ item_id: schema.itemMaster.item_id })
        .from(schema.itemMaster)
        .where(
          and(
            eq(schema.itemMaster.tenant_id, tenantId),
            eq(schema.itemMaster.is_active, true),
          )
        )
        .limit(1);
      bioAssetSubjectItemId = fallbackItem?.item_id;
    }

    const transactionId = randomUUID();
    let ledgerId: string | null = null;
    let amount = 0;
    let rate: number | null = dto.rate ?? null;

    if (dto.transaction_type === 'CONSUMPTION') {
      if (!dto.item_id) {
        const isMed =
          (dto.remarks || '').toLowerCase().includes('med') ||
          (dto.remarks || '').toLowerCase().includes('vaccin') ||
          (dto.remarks || '').toLowerCase().includes('antibiotic') ||
          (dto.remarks || '').toLowerCase().includes('deworm') ||
          (dto.remarks || '').toLowerCase().includes('dextran') ||
          (dto.remarks || '').toLowerCase().includes('ivermectin') ||
          dto.uom === 'ML' ||
          dto.uom === 'DOSES' ||
          dto.uom === 'VIAL';

        const [matchedItem] = await this.db
          .select({ item_id: schema.itemMaster.item_id })
          .from(schema.itemMaster)
          .where(
            and(
              eq(schema.itemMaster.tenant_id, tenantId),
              eq(schema.itemMaster.is_active, true),
              isMed ? eq(schema.itemMaster.item_type, 'MEDICINE') : eq(schema.itemMaster.item_type, 'FEED')
            )
          )
          .limit(1);

        if (matchedItem) {
          dto.item_id = matchedItem.item_id;
        } else {
          const [anyItem] = await this.db
            .select({ item_id: schema.itemMaster.item_id })
            .from(schema.itemMaster)
            .where(
              and(
                eq(schema.itemMaster.tenant_id, tenantId),
                eq(schema.itemMaster.is_active, true)
              )
            )
            .limit(1);
          if (anyItem) {
            dto.item_id = anyItem.item_id;
          }
        }
      }

      if (!dto.item_id || !dto.quantity || !dto.uom) {
        throw new BadRequestException('CONSUMPTION transactions require item_id, quantity and uom.');
      }
      const bioTransactionType = isBioAsset
        ? (bio?.stage === 'PREMATURE' ? 'BIO_CONSUMPTION_PREMATURE' : 'BIO_CONSUMPTION_MATURE')
        : 'BATCH_CONSUMPTION';
      const ledgerEntry = await this.ledgerService.writeNegativeEntry({
        tenantId,
        companyId: batch.company_id,
        itemId: dto.item_id,
        documentType: 'BATCH',
        documentNo: batch.batch_no,
        documentLineId: transactionId,
        postingDate: dto.transaction_date,
        transactionType: bioTransactionType,
        quantity: dto.quantity,
        uom: dto.uom,
        batchNo: batch.batch_no,
        userId: userPayload?.userId,
      });
      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
      ledgerId = ledgerEntry.ledger_id;
      rate = Number(ledgerEntry.rate);
      amount = Number(ledgerEntry.amount); // negative

      // Premature-stage cost capitalizes into the NCA; mature-stage cost is
      // just expensed (already handled by the GL mapping above) — the
      // biological asset's carrying value only moves in the PREMATURE case.
      if (isBioAsset && bio?.stage === 'PREMATURE') {
        const capitalized = Math.abs(amount);
        await this.db
          .update(schema.batchBioAssetState)
          .set({ nca_book_value: (Number(bio.nca_book_value) + capitalized).toString(), updated_at: toMysqlTimestamp() })
          .where(eq(schema.batchBioAssetState.batch_id, id));
        await this.db.insert(schema.bioAssetLedger).values({
          entry_id: randomUUID(),
          tenant_id: tenantId,
          company_id: batch.company_id,
          bio_asset_item_id: dto.item_id,
          entry_type: 'CONSUMPTION',
          document_no: batch.batch_no,
          batch_id: id,
          batch_no: batch.batch_no,
          posting_date: dto.transaction_date,
          stage: 'PREMATURE',
          quantity: dto.quantity.toString(),
          cost_amount: capitalized.toString(),
          cost_amount_each_unit: rate?.toString() || null,
          costing_method: 'COST_ACCUMULATION',
          nob_id: batch.nob_id,
          lob_id: batch.lob_id,
          created_by: userPayload?.userId || null,
        });
      }
    } else if (dto.transaction_type === 'OUTPUT') {
      if (!dto.item_id || !dto.quantity || !dto.uom) {
        throw new BadRequestException('OUTPUT transactions require item_id, quantity and uom.');
      }
      if (isBioAsset && bio?.stage !== 'MATURE') {
        throw new BadRequestException('OUTPUT can only be recorded once the bio-asset batch has matured.');
      }

      const isByProductRemoval = !isBioAsset && (dto.output_type === 'BY_PRODUCT' || dto.output_type === 'WASTE') && dto.nrv_rate != null;

      const ledgerEntry = await this.ledgerService.writePositiveEntry({
        tenantId,
        companyId: batch.company_id,
        itemId: dto.item_id,
        documentType: 'BATCH',
        documentNo: batch.batch_no,
        documentLineId: transactionId,
        postingDate: dto.transaction_date,
        transactionType: isBioAsset ? 'BIO_OUTPUT' : 'BATCH_OUTPUT',
        quantity: dto.quantity,
        uom: dto.uom,
        rate: isByProductRemoval ? dto.nrv_rate : dto.rate,
        batchNo: batch.batch_no,
        userId: userPayload?.userId,
      });
      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
      ledgerId = ledgerEntry.ledger_id;
      rate = Number(ledgerEntry.rate);
      amount = Number(ledgerEntry.amount); // positive

      if (isBioAsset && bio) {
        const openingNca = Number(bio.nca_book_value);
        const newNca = Math.max(0, openingNca - amount);
        await this.db
          .update(schema.batchBioAssetState)
          .set({ nca_book_value: newNca.toString(), updated_at: toMysqlTimestamp() })
          .where(eq(schema.batchBioAssetState.batch_id, id));

        // Every other bio-asset movement writes a ledger row; this one did not,
        // so a harvest made the carrying value fall with nothing in
        // bio_asset_ledger to explain it and the IAS 41 roll-forward's
        // harvest-transfers bucket was structurally zero. The amount is the
        // reduction that actually happened — not `amount` — because the clamp
        // above caps it at the remaining book value.
        const ncaReleased = openingNca - newNca;
        // The asset whose value fell is the herd, not the item harvested out of it.
        const herdItemId = batch.input_lines?.[0]?.item_id || bioAssetSubjectItemId;
        if (herdItemId && ncaReleased > 0) {
          await this.db.insert(schema.bioAssetLedger).values({
            entry_id: randomUUID(),
            tenant_id: tenantId,
            company_id: batch.company_id,
            bio_asset_item_id: herdItemId,
            entry_type: 'TRANSFORMATION',
            document_no: batch.batch_no,
            batch_id: id,
            batch_no: batch.batch_no,
            posting_date: dto.transaction_date,
            stage: bio.stage,
            quantity: (-(dto.quantity ?? 0)).toString(),
            cost_amount: (-ncaReleased).toString(),
            cost_amount_each_unit: dto.quantity ? (ncaReleased / dto.quantity).toString() : '0',
            costing_method: bio.stage === 'MATURE' ? 'AMORTIZED_COST' : 'COST_ACCUMULATION',
            nob_id: batch.nob_id,
            lob_id: batch.lob_id,
            created_by: userPayload?.userId || null,
          });
        }
      }

      if (isByProductRemoval) {
        const nrvRate = Number(dto.nrv_rate || 0);
        const atCostRate = await this.computeRunningUnitCost(batch);
        const atCostValue = atCostRate * dto.quantity;
        const nrvValue = nrvRate * dto.quantity;
        const impairment = atCostValue - nrvValue;

        if (impairment > 0.005) {
          await this.glPostingService.postBatchCostEntry({
            tenantId,
            companyId: batch.company_id,
            transactionType: 'BATCH_IMPAIRMENT',
            amount: impairment,
            documentNo: batch.batch_no,
            documentLineId: transactionId,
            postingDate: dto.transaction_date,
            description: `${dto.output_type} removal impairment (at-cost ${atCostValue.toFixed(2)} vs NRV ${nrvValue.toFixed(2)}) — ${batch.batch_no}`,
            nobId: batch.nob_id || undefined,
            lobId: batch.lob_id,
            stageId: batch.stage_id || undefined,
            userId: userPayload?.userId,
          });
        }

        await this.db.insert(schema.batchOutputLine).values({
          line_id: randomUUID(),
          batch_id: id,
          item_id: dto.item_id,
          output_type: dto.output_type || 'BY_PRODUCT',
          cost_split_pct: '0',
          quantity: dto.quantity.toString(),
          uom: dto.uom,
          computed_cost: nrvValue.toString(),
          unit_cost: nrvRate.toString(),
        });
      }
    } else if (dto.transaction_type === 'MORTALITY') {
      if (!dto.quantity) {
        throw new BadRequestException('MORTALITY transactions require quantity.');
      }
      if (isBioAsset && bio) {
        const currentQty =
          Number(bio.current_quantity) > 0
            ? Number(bio.current_quantity)
            : Number(batch.closing_quantity) || Number(batch.opening_quantity) || 0;
        if (dto.quantity > currentQty) {
          throw new BadRequestException(`Cannot record mortality of ${dto.quantity} — only ${currentQty} remain in the herd.`);
        }
        const perUnitNca = currentQty > 0 ? Number(bio.nca_book_value) / currentQty : 0;
        const nbvShare = perUnitNca * dto.quantity;
        rate = perUnitNca;
        amount = -nbvShare;
        await this.glPostingService.postBatchCostEntry({
          tenantId,
          companyId: batch.company_id,
          transactionType: bio.stage === 'PREMATURE' ? 'BIO_MORTALITY_PREMATURE' : 'BIO_MORTALITY_MATURE',
          amount: nbvShare,
          documentNo: batch.batch_no,
          documentLineId: transactionId,
          postingDate: dto.transaction_date,
          description: `Mortality — ${batch.batch_no}`,
          nobId: batch.nob_id || undefined,
          lobId: batch.lob_id,
          stageId: batch.stage_id || undefined,
          userId: userPayload?.userId,
        });
        await this.db
          .update(schema.batchBioAssetState)
          .set({
            current_quantity: Math.max(0, currentQty - dto.quantity).toString(),
            nca_book_value: Math.max(0, Number(bio.nca_book_value) - nbvShare).toString(),
            updated_at: toMysqlTimestamp(),
          })
          .where(eq(schema.batchBioAssetState.batch_id, id));
        await this.db
          .update(schema.batchHeader)
          .set({
            closing_quantity: Math.max(0, (Number(batch.closing_quantity) || currentQty) - dto.quantity).toString(),
            updated_at: toMysqlTimestamp(),
          })
          .where(eq(schema.batchHeader.batch_id, id));
        if (bioAssetSubjectItemId) {
          await this.db.insert(schema.bioAssetLedger).values({
            entry_id: randomUUID(),
            tenant_id: tenantId,
            company_id: batch.company_id,
            bio_asset_item_id: bioAssetSubjectItemId,
            entry_type: 'MORTALITY',
            document_no: batch.batch_no,
            batch_id: id,
            batch_no: batch.batch_no,
            posting_date: dto.transaction_date,
            stage: bio.stage,
            quantity: (-dto.quantity).toString(),
            cost_amount: (-nbvShare).toString(),
            cost_amount_each_unit: perUnitNca.toString(),
            costing_method: bio.stage === 'MATURE' ? 'AMORTIZED_COST' : 'COST_ACCUMULATION',
            nob_id: batch.nob_id,
            lob_id: batch.lob_id,
            created_by: userPayload?.userId || null,
          });
        }
      } else {
        const unitCost = await this.computeRunningUnitCost(batch);
        rate = unitCost;
        amount = -(dto.quantity * unitCost);
        await this.glPostingService.postBatchCostEntry({
          tenantId,
          companyId: batch.company_id,
          transactionType: 'MORTALITY',
          amount: Math.abs(amount),
          documentNo: batch.batch_no,
          documentLineId: transactionId,
          postingDate: dto.transaction_date,
          description: `Mortality — ${batch.batch_no}`,
          nobId: batch.nob_id || undefined,
          lobId: batch.lob_id,
          stageId: batch.stage_id || undefined,
          userId: userPayload?.userId,
        });
        await this.db
          .update(schema.batchHeader)
          .set({
            closing_quantity: Math.max(0, (Number(batch.closing_quantity) || Number(batch.opening_quantity) || 0) - dto.quantity).toString(),
            updated_at: toMysqlTimestamp(),
          })
          .where(eq(schema.batchHeader.batch_id, id));
      }
    } else if (dto.transaction_type === 'OVERHEAD') {
      if (!dto.quantity || dto.rate === undefined || dto.rate === null) {
        throw new BadRequestException('OVERHEAD transactions require quantity and rate.');
      }
      amount = -(dto.quantity * dto.rate);
      const bioTransactionType = isBioAsset
        ? (bio?.stage === 'PREMATURE' ? 'BIO_OVERHEAD_PREMATURE' : 'BIO_OVERHEAD_MATURE')
        : 'OVERHEAD';
      await this.glPostingService.postBatchCostEntry({
        tenantId,
        companyId: batch.company_id,
        transactionType: bioTransactionType,
        amount: Math.abs(amount),
        documentNo: batch.batch_no,
        documentLineId: transactionId,
        postingDate: dto.transaction_date,
        description: dto.remarks || `Overhead — ${batch.batch_no}`,
        nobId: batch.nob_id || undefined,
        lobId: batch.lob_id,
        stageId: batch.stage_id || undefined,
        userId: userPayload?.userId,
      });

      if (isBioAsset && bio?.stage === 'PREMATURE') {
        const capitalized = Math.abs(amount);
        await this.db
          .update(schema.batchBioAssetState)
          .set({ nca_book_value: (Number(bio.nca_book_value) + capitalized).toString(), updated_at: toMysqlTimestamp() })
          .where(eq(schema.batchBioAssetState.batch_id, id));
        if (bioAssetSubjectItemId) {
          await this.db.insert(schema.bioAssetLedger).values({
            entry_id: randomUUID(),
            tenant_id: tenantId,
            company_id: batch.company_id,
            bio_asset_item_id: bioAssetSubjectItemId,
            entry_type: 'OVERHEAD_COST',
            document_no: batch.batch_no,
            batch_id: id,
            batch_no: batch.batch_no,
            posting_date: dto.transaction_date,
            stage: 'PREMATURE',
            quantity: dto.quantity.toString(),
            cost_amount: capitalized.toString(),
            costing_method: 'COST_ACCUMULATION',
            nob_id: batch.nob_id,
            lob_id: batch.lob_id,
            created_by: userPayload?.userId || null,
          });
        }
      }
    }
    // OBSERVATION: no cost impact, no GL — just a text record (amount stays 0).

    await this.db.insert(schema.batchTransaction).values({
      transaction_id: transactionId,
      batch_id: id,
      transaction_date: dto.transaction_date,
      transaction_type: dto.transaction_type,
      item_id: dto.item_id || null,
      resource_id: dto.resource_id || null,
      quantity: dto.quantity?.toString() || null,
      uom: dto.uom || null,
      rate: rate?.toString() || null,
      amount: amount.toString(),
      remarks: dto.remarks || null,
      ledger_id: ledgerId,
      persons: dto.persons ?? null,
      hours: dto.hours?.toString() ?? null,
      adg: dto.adg?.toString() ?? null,
      bcs_score: dto.bcs_score?.toString() ?? null,
      animal_id: dto.animal_id || null,
      created_by: userPayload?.userId || null,
    });

    // Clinical detail rides alongside the transaction in its own table. It used
    // to be formatted into `remarks` and parsed back out by the console, which
    // made it unqueryable and easy to lose. Validation is by transaction type
    // so a diagnosis can't be filed against a feed row.
    if (dto.mortality_detail) {
      const detail = dto.mortality_detail;
      if (detail.location_id) {
        const [pen] = await this.db
          .select({ location_id: schema.locationMaster.location_id })
          .from(schema.locationMaster)
          .where(eq(schema.locationMaster.location_id, detail.location_id))
          .limit(1);
        if (!pen) throw new BadRequestException(`Location '${detail.location_id}' not found.`);
      }
      await this.db.insert(schema.batchMortalityDetail).values({
        detail_id: randomUUID(),
        transaction_id: transactionId,
        // Fall back to where the batch is now — better than recording no pen at all.
        location_id: detail.location_id || batch.location_id || null,
        cause_of_death: detail.cause_of_death || null,
        post_mortem_notes: detail.post_mortem_notes || null,
        disposal_method: detail.disposal_method || null,
        created_by: userPayload?.userId || null,
      });
    }

    if (dto.treatment_detail) {
      const detail = dto.treatment_detail;
      await this.db.insert(schema.batchTreatmentDetail).values({
        detail_id: randomUUID(),
        transaction_id: transactionId,
        diagnosis: detail.diagnosis || null,
        route: detail.route || null,
        withdrawal_days: detail.withdrawal_days ?? null,
        veterinarian: detail.veterinarian || null,
        created_by: userPayload?.userId || null,
      });
    }

    if (dto.quantity !== undefined && dto.quantity !== null) {
      await this.evaluateKpi(batch, {
        transaction_id: transactionId,
        transaction_date: dto.transaction_date,
        transaction_type: dto.transaction_type,
        item_id: dto.item_id || null,
        resource_id: dto.resource_id || null,
        quantity: dto.quantity,
      });
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_transaction',
      entityId: transactionId,
      newValues: { batch_id: id, ...dto, amount },
    });

    return this.findOne(id);
  }

  /**
   * The batch's current-stage scheduler_header — the row
   * SchedulerHeaderService.createForStage() created when transferStage()
   * last moved this batch into its current resolved stage_id. Null if the
   * batch has never resolved into a real Stage Master stage (stage_id unset)
   * or that header hasn't been created yet.
   */
  private async loadCurrentSchedulerHeader(batch: Awaited<ReturnType<BatchService['findOne']>>) {
    if (!batch.stage_id) return null;
    const [header] = await this.db
      .select()
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batch.batch_id), eq(schema.schedulerHeader.stage_id, batch.stage_id)))
      .limit(1);
    return header || null;
  }

  /**
   * Additive KPI-monitoring layer — no-ops entirely if the batch has no
   * current-stage scheduler_header. Finds the scheduler_line "live" for the
   * given day whose line_type/item/resource matches this transaction,
   * compares actual vs. its lower/upper_alert_limit, and writes a
   * notification_alert_log row on breach. Does not touch cost/GL — purely
   * observational.
   */
  /**
   * Day-range + occurrence filter shared by evaluateKpi() and getDataEntry()
   * — every active scheduler_line under the batch's current-stage header
   * that is "live" (due) on the given calendar date, paired with that header.
   */
  private async loadActiveScheduleLines(
    batch: Awaited<ReturnType<BatchService['findOne']>>,
    dateStr: string,
  ) {
    const header = await this.loadCurrentSchedulerHeader(batch);
    if (!header) return [];

    const lines = await this.db
      .select()
      .from(schema.schedulerLine)
      .where(and(eq(schema.schedulerLine.scheduler_id, header.scheduler_id), eq(schema.schedulerLine.is_active, true)));
    if (!lines.length) return [];

    const date = new Date(dateStr);
    const dayOfStage = Math.floor((date.getTime() - new Date(header.effective_from).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (dayOfStage < 1) return [];

    const customLineIds = lines.filter((l) => l.occurrence === 'CUSTOM').map((l) => l.line_id);
    const customDays = customLineIds.length
      ? await this.db.select().from(schema.schedulerLineCustomDays).where(inArray(schema.schedulerLineCustomDays.line_id, customLineIds))
      : [];

    const isoWeekday = ((date.getDay() + 6) % 7) + 1; // 1=Monday..7=Sunday, matching scheduler_line.day_of_week
    const stageStartDom = new Date(header.effective_from).getDate();
    const dom = date.getDate();

    const dueLines = lines.filter((line) => {
      if (dayOfStage < line.start_day) return false;
      if (line.end_day != null && dayOfStage > line.end_day) return false;
      switch (line.occurrence) {
        case 'WEEKLY': return line.day_of_week === isoWeekday;
        case 'MONTHLY': return dom === stageStartDom;
        case 'ONCE': return dayOfStage === line.start_day;
        case 'CUSTOM': return customDays.some((d) => d.line_id === line.line_id && d.day_number === dayOfStage && d.is_active);
        case 'DAILY':
        default: return true;
      }
    });

    return dueLines.map((line) => ({ header, line }));
  }

  private computeExpectedQty(line: typeof schema.schedulerLine.$inferSelect, animalCount: number): number {
    if (line.standard_qty == null) return 0;
    const qty = Number(line.standard_qty);
    return line.qty_basis === 'PER_HEAD' ? qty * animalCount : qty; // TOTAL_BATCH / PER_PEN / FIXED all use the raw value
  }

  /** transaction_type (batch_transaction's generic enum) -> the scheduler_line.line_type(s) it can match. */
  private lineTypesForTransaction(transactionType: string): string[] {
    switch (transactionType) {
      case 'CONSUMPTION': return ['CONSUMPTION'];
      case 'OUTPUT': return ['OUTPUT'];
      case 'OVERHEAD': return ['OVERHEAD'];
      default: return ['DESCRIPTIVE']; // MORTALITY, OBSERVATION — captured as DESCRIPTIVE KPI lines in the new model
    }
  }

  private async evaluateKpi(
    batch: Awaited<ReturnType<BatchService['findOne']>>,
    transaction: {
      transaction_id: string;
      transaction_date: string;
      transaction_type: string;
      item_id: string | null;
      resource_id: string | null;
      quantity: number;
    }
  ) {
    const activePairs = await this.loadActiveScheduleLines(batch, transaction.transaction_date);
    if (!activePairs.length) return;

    const candidateTypes = this.lineTypesForTransaction(transaction.transaction_type);
    const match = activePairs.find(({ line }) => {
      if (!candidateTypes.includes(line.line_type)) return false;
      if (line.item_id && line.item_id !== transaction.item_id) return false;
      if (line.resource_id && line.resource_id !== transaction.resource_id) return false;
      return true;
    });
    if (!match) return;
    const { header, line } = match;
    if (line.lower_alert_limit == null && line.upper_alert_limit == null) return;

    const actual = transaction.quantity;
    const minVal = line.lower_alert_limit != null ? Number(line.lower_alert_limit) : -Infinity;
    const maxVal = line.upper_alert_limit != null ? Number(line.upper_alert_limit) : Infinity;
    const breached = actual < minVal || actual > maxVal;
    if (!breached) return;
    const breachDirection = actual < minVal ? 'below' : 'above';

    const expectedQty = this.computeExpectedQty(line, Number(header.animal_count));
    const deviationAmount = actual - expectedQty;
    const title = `${line.activity_name} ${breachDirection === 'below' ? 'Below' : 'Above'} Limit — Batch ${batch.batch_no}`;
    const message = `${line.activity_name}: actual ${actual} outside range [${line.lower_alert_limit ?? '-∞'}, ${line.upper_alert_limit ?? '∞'}]. Batch ${batch.batch_no}.`;

    await this.db.insert(schema.notificationAlertLog).values({
      alert_id: randomUUID(),
      tenant_id: batch.tenant_id,
      company_id: batch.company_id,
      lob_id: batch.lob_id,
      batch_id: batch.batch_id,
      line_id: line.line_id,
      transaction_id: transaction.transaction_id,
      alert_type: 'KPI_DEVIATION',
      severity: line.alert_severity === 'INFO' || line.alert_severity === 'CRITICAL' ? line.alert_severity : 'WARNING',
      title,
      message,
      activity_name: line.activity_name,
      kpi_mode: 'VALUE',
      expected_value: expectedQty.toString(),
      actual_value: actual.toString(),
      deviation_amount: deviationAmount.toString(),
      deviation_pct: null,
      kpi_min: line.lower_alert_limit,
      kpi_max: line.upper_alert_limit,
    });
  }

  /**
   * Drives the batch "Data Entry" screen: every scheduler_line due on the
   * given date under the batch's current-stage scheduler_header, with its
   * expected quantity and whatever's already been recorded that day — so the
   * UI can show a guided checklist instead of a blank generic transaction
   * form.
   */
  async getDataEntry(id: string, dateStr: string) {
    const batch = await this.findOne(id);
    const activePairs = await this.loadActiveScheduleLines(batch, dateStr);
    if (!activePairs.length) {
      return { date: dateStr, day_of_batch: null, lines: [] };
    }
    const header = activePairs[0].header;
    const animalCount = Number(header.animal_count);
    const dayOfStage = Math.floor((new Date(dateStr).getTime() - new Date(header.effective_from).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const sameDayTx = await this.db
      .select()
      .from(schema.batchTransaction)
      .where(and(eq(schema.batchTransaction.batch_id, id), eq(schema.batchTransaction.transaction_date, dateStr)));
    const sameDayEntries = await this.db
      .select()
      .from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, id), eq(schema.batchDailyData.entry_date, dateStr)));

    const itemIds = [...new Set(activePairs.map(({ line }) => line.item_id).filter((x): x is string => !!x))];
    const itemRows = itemIds.length
      ? await this.db.select().from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds))
      : [];
    const itemLabel = (itemId: string | null) => {
      if (!itemId) return null;
      const it = itemRows.find((x) => x.item_id === itemId);
      return it ? `${it.item_code} — ${it.item_name}` : null;
    };
    const itemType = (itemId: string | null) => {
      if (!itemId) return null;
      return itemRows.find((x) => x.item_id === itemId)?.item_type ?? null;
    };
    const itemCode = (itemId: string | null) => {
      if (!itemId) return null;
      return itemRows.find((x) => x.item_id === itemId)?.item_code ?? null;
    };
    const itemUom = (itemId: string | null) => {
      if (!itemId) return null;
      return itemRows.find((x) => x.item_id === itemId)?.uom_primary ?? null;
    };

    // Labour and utility lines cost by the hour/unit of a resource rather
    // than by an item, so their rate lives on resource_master.
    const resourceIds = [...new Set(activePairs.map(({ line }) => line.resource_id).filter((x): x is string => !!x))];
    const resourceRows = resourceIds.length
      ? await this.db.select().from(schema.resourceMaster).where(inArray(schema.resourceMaster.resource_id, resourceIds))
      : [];

    // Items are priced in their own stock unit, which is not always the unit the
    // schedule doses in — ivermectin is bought per 100 ml VIAL and given in ML.
    const conversions = await this.db.select().from(schema.uomConversionMaster);

    /** The money rate for a line, expressed in the line's own unit. */
    const standardRate = (
      line: { item_id: string | null; resource_id: string | null },
      lineUom: string | null,
    ) => {
      if (line.item_id) {
        const item = itemRows.find((x) => x.item_id === line.item_id);
        if (item?.standard_cost == null) return null;
        const cost = Number(item.standard_cost);
        const stockUom = item.uom_primary;
        if (!lineUom || !stockUom || lineUom === stockUom) return cost;
        // One stock unit contains `conversion_factor` line units, so the price
        // per line unit is the stock price divided by that factor.
        const conv = conversions.find((c) => c.from_uom === stockUom && c.to_uom === lineUom);
        if (conv && Number(conv.conversion_factor) > 0) return cost / Number(conv.conversion_factor);
        const inverse = conversions.find((c) => c.from_uom === lineUom && c.to_uom === stockUom);
        if (inverse && Number(inverse.conversion_factor) > 0) return cost * Number(inverse.conversion_factor);
        return cost;
      }
      if (line.resource_id) {
        const cost = resourceRows.find((x) => x.resource_id === line.resource_id)?.cost_rate;
        return cost != null ? Number(cost) : null;
      }
      return null;
    };

    const lines = activePairs.map(({ line }) => {
      const enteredEntry = sameDayEntries.find((e) => e.line_id === line.line_id);
      const legacyEntered = sameDayTx
        .filter((t) => line.item_id ? t.item_id === line.item_id : line.resource_id ? t.resource_id === line.resource_id : false)
        .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
      const alreadyEntered = enteredEntry ? Number(enteredEntry.entered_value || 0) : legacyEntered;
      const uom = line.item_id ? itemUom(line.item_id) : line.kpi_uom;
      const stdRate = standardRate(line, uom);

      return {
        line_id: line.line_id,
        line_type: line.line_type,
        activity_name: line.activity_name,
        item_id: line.item_id,
        item_description: line.item_description,
        item_label: itemLabel(line.item_id),
        item_type: itemType(line.item_id),
        item_code: itemCode(line.item_id),
        // Medicine/vaccine withdrawal period — auto-flows from item_master,
        // shown only where it's actually relevant (lot-tracked CONSUMPTION).
        withdrawal_days: line.lot_required ? (itemRows.find((x) => x.item_id === line.item_id)?.withdrawal_days ?? null) : null,
        resource_id: line.resource_id,
        uom,
        occurrence: line.occurrence,
        is_mandatory: line.is_mandatory,
        lot_required: line.lot_required,
        expected_qty: this.computeExpectedQty(line, animalCount),
        already_entered_qty: alreadyEntered,
        std_rate: stdRate,
      };
    });

    return { date: dateStr, day_of_batch: dayOfStage, lines };
  }

  async close(id: string, dto: CloseBatchDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');
    if (batch.costing_method === 'BIO_ASSET') {
      throw new BadRequestException(
        "BIO_ASSET batches don't close via this action — use the dispose endpoint to exit animals from the herd; the batch closes automatically once the herd is fully disposed."
      );
    }

    const totalSplitPct = dto.output_lines.reduce((sum, l) => sum + l.cost_split_pct, 0);
    if (Math.abs(totalSplitPct - 100) > 0.01) {
      throw new BadRequestException(`Output line cost_split_pct must sum to 100 (got ${totalSplitPct}).`);
    }

    const inputTotal = (batch.input_lines || []).reduce((sum, l) => sum + Number(l.amount || 0), 0);
    // MORTALITY is deliberately excluded here — it's already expensed and relieved
    // from WIP the moment it's recorded (see addTransaction()'s postBatchCostEntry
    // for 'MORTALITY'). Including it again here would double-count the write-off
    // into the surviving output's valuation. Mid-batch BY_PRODUCT/WASTE outputs
    // are excluded the same way — they're already relieved from WIP when recorded.
    const costTransactions = (batch.transactions || []).filter(
      (t) => t.transaction_type === 'CONSUMPTION' || t.transaction_type === 'OVERHEAD'
    );
    const transactionTotal = costTransactions.reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
    const totalCost = inputTotal + transactionTotal;

    const closingQuantity = dto.closing_quantity ?? Number(batch.opening_quantity);
    const actualEndDate = dto.actual_end_date || toMysqlTimestamp().slice(0, 10);

    let standard: typeof schema.batchStandard.$inferSelect | undefined;
    if (batch.costing_method === 'STANDARD') {
      [standard] = await this.db.select().from(schema.batchStandard).where(eq(schema.batchStandard.batch_id, id)).limit(1);
    }
    // STANDARD batches with a locked output rate value their output at that
    // rate, not a proportional split of actual cost — this is what makes the
    // variance postings below a real reconciliation (actual cost in = std
    // value out + variances), not a non-binding side report. FIFO batches,
    // and STANDARD batches that never set up standard assumptions, keep the
    // original actual-cost-proportional-split — matching the spec's own
    // "FIFO: no variance, layered cost IS the batch cost" rule.
    const stdOutputCostPerUnit = standard?.std_output_cost_per_unit ? Number(standard.std_output_cost_per_unit) : null;

    let sumOfOutputValues = 0;
    const outputValuations = dto.output_lines.map((line) => {
      const computedCost = stdOutputCostPerUnit !== null
        ? stdOutputCostPerUnit * line.quantity
        : (totalCost * line.cost_split_pct) / 100;
      sumOfOutputValues += computedCost;
      return { line, computedCost, unitCost: line.quantity > 0 ? computedCost / line.quantity : 0 };
    });

    // Pre-compute variance lines (pure calculation, no writes) so the
    // reconciliation check below can run BEFORE anything is posted — a batch
    // that doesn't reconcile is rejected outright, nothing gets written.
    const varianceLines = standard ? await this.computeVarianceLines(id, batch, standard, closingQuantity, actualEndDate) : [];

    if (stdOutputCostPerUnit !== null) {
      const sumOfVariances = varianceLines.reduce((sum, v) => sum + v.variance_amount, 0);
      const residual = totalCost - sumOfOutputValues - sumOfVariances;
      if (Math.abs(residual) > 0.01) {
        throw new BadRequestException(
          `Batch cannot close — cost does not reconcile (${residual.toFixed(2)} unaccounted for). ` +
          `This usually means a consumption transaction has no matching standard-cost line, or a standard rate is unset for an item that was consumed. Review the batch's transactions before retrying.`
        );
      }
    }

    for (const { line, computedCost, unitCost } of outputValuations) {
      const ledgerEntry = await this.ledgerService.writePositiveEntry({
        tenantId,
        companyId: batch.company_id,
        itemId: line.item_id,
        documentType: 'BATCH',
        documentNo: batch.batch_no,
        postingDate: actualEndDate,
        transactionType: 'BATCH_OUTPUT',
        quantity: line.quantity,
        uom: line.uom,
        rate: unitCost,
        batchNo: batch.batch_no,
        warehouseId: line.warehouse_id,
        userId: userPayload?.userId,
      });
      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);

      await this.db.insert(schema.batchOutputLine).values({
        line_id: randomUUID(),
        batch_id: id,
        item_id: line.item_id,
        output_type: line.output_type || 'MAIN',
        cost_split_pct: line.cost_split_pct.toString(),
        quantity: line.quantity.toString(),
        uom: line.uom,
        computed_cost: computedCost.toString(),
        unit_cost: unitCost.toString(),
        warehouse_id: line.warehouse_id,
      });
    }

    const unitCost = closingQuantity > 0 ? totalCost / closingQuantity : 0;

    await this.db
      .update(schema.batchHeader)
      .set({
        status: 'CLOSED',
        actual_end_date: actualEndDate,
        closing_quantity: closingQuantity.toString(),
        total_cost: totalCost.toString(),
        unit_cost: unitCost.toString(),
        closed_at: toMysqlTimestamp(),
        closed_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchHeader.batch_id, id));

    if (varianceLines.length > 0) {
      await this.postVarianceLines(id, batch, varianceLines, actualEndDate, tenantId, userPayload);
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CLOSE',
      entityName: 'batch_header',
      entityId: id,
      newValues: { status: 'CLOSED', total_cost: totalCost, unit_cost: unitCost },
    });

    return this.findOne(id);
  }

  /**
   * Standard-costing only. Compares actuals against batch_standard /
   * batch_standard_consumption_line and returns the resulting variance lines
   * — pure calculation, no journal/DB writes. close() uses this twice: once
   * to reconcile WIP before committing anything, then (only if that check
   * passes) to actually post via postVarianceLines().
   */
  private async computeVarianceLines(
    id: string,
    batch: Awaited<ReturnType<BatchService['findOne']>>,
    standard: typeof schema.batchStandard.$inferSelect,
    closingQuantity: number,
    actualEndDate: string
  ): Promise<Array<{ variance_type: string; item_id: string | null; std_value: number; actual_value: number; variance_amount: number }>> {
    const standardLines = await this.db
      .select()
      .from(schema.batchStandardConsumptionLine)
      .where(eq(schema.batchStandardConsumptionLine.batch_id, id));

    const startDate = new Date(batch.start_date);
    const endDate = new Date(actualEndDate);
    const durationDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const openingQty = Number(batch.opening_quantity);

    const lines: Array<{ variance_type: string; item_id: string | null; std_value: number; actual_value: number; variance_amount: number }> = [];

    if (standardLines.length > 0) {
      const consumptionByItem = new Map<string, { qty: number; amount: number }>();
      for (const t of batch.transactions || []) {
        if (t.transaction_type !== 'CONSUMPTION' || !t.item_id) continue;
        const entry = consumptionByItem.get(t.item_id) || { qty: 0, amount: 0 };
        entry.qty += Number(t.quantity || 0);
        entry.amount += Math.abs(Number(t.amount || 0));
        consumptionByItem.set(t.item_id, entry);
      }

      for (const stdLine of standardLines) {
        const actual = consumptionByItem.get(stdLine.item_id);
        if (!actual || actual.qty <= 0) continue;

        let stdRate = stdLine.std_rate ? Number(stdLine.std_rate) : null;
        if (stdRate === null) {
          const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, stdLine.item_id)).limit(1);
          stdRate = item?.standard_cost ? Number(item.standard_cost) : null;
        }
        if (stdRate === null) continue;

        const actualRate = actual.amount / actual.qty;
        const stdQty = Number(stdLine.std_qty_per_unit_per_day) * openingQty * durationDays;

        const priceVar = (actualRate - stdRate) * actual.qty;
        const usageVar = (actual.qty - stdQty) * stdRate;

        if (Math.abs(priceVar) > 0.005) {
          lines.push({ variance_type: 'PRICE', item_id: stdLine.item_id, std_value: stdRate, actual_value: actualRate, variance_amount: priceVar });
        }
        if (Math.abs(usageVar) > 0.005) {
          lines.push({ variance_type: 'USAGE', item_id: stdLine.item_id, std_value: stdQty, actual_value: actual.qty, variance_amount: usageVar });
        }
      }
    }

    if (standard.std_output_cost_per_unit && standard.std_output_quantity) {
      const stdOutputQty = Number(standard.std_output_quantity);
      const stdOutputCost = Number(standard.std_output_cost_per_unit);
      const outputVar = (stdOutputQty - closingQuantity) * stdOutputCost;
      if (Math.abs(outputVar) > 0.005) {
        lines.push({ variance_type: 'OUTPUT', item_id: null, std_value: stdOutputQty, actual_value: closingQuantity, variance_amount: outputVar });
      }
    }

    if (standard.std_overhead_rate_per_unit) {
      const actualOverhead = (batch.transactions || [])
        .filter((t) => t.transaction_type === 'OVERHEAD')
        .reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
      const stdOverhead = Number(standard.std_overhead_rate_per_unit) * closingQuantity;
      const overheadVar = actualOverhead - stdOverhead;
      if (Math.abs(overheadVar) > 0.005) {
        lines.push({ variance_type: 'OVERHEAD', item_id: null, std_value: stdOverhead, actual_value: actualOverhead, variance_amount: overheadVar });
      }
    }

    return lines;
  }

  private async postVarianceLines(
    id: string,
    batch: Awaited<ReturnType<BatchService['findOne']>>,
    lines: Array<{ variance_type: string; item_id: string | null; std_value: number; actual_value: number; variance_amount: number }>,
    actualEndDate: string,
    tenantId: string,
    userPayload?: UserContext
  ) {
    for (const line of lines) {
      const isFavorable = line.variance_amount < 0;
      const journal = await this.glPostingService.postBatchCostEntry({
        tenantId,
        companyId: batch.company_id,
        transactionType: `${line.variance_type}_VARIANCE`,
        amount: Math.abs(line.variance_amount),
        documentNo: batch.batch_no,
        postingDate: actualEndDate,
        description: `${line.variance_type} Variance — ${batch.batch_no}`,
        nobId: batch.nob_id || undefined,
        lobId: batch.lob_id,
        stageId: batch.stage_id || undefined,
        userId: userPayload?.userId,
        reverseDirection: isFavorable,
      });
      const drLine = journal.lines?.find((l: { debit_amount?: string | number | null }) => Number(l.debit_amount) > 0);
      const crLine = journal.lines?.find((l: { credit_amount?: string | number | null }) => Number(l.credit_amount) > 0);

      await this.db.insert(schema.batchCostVariance).values({
        variance_id: randomUUID(),
        batch_id: id,
        variance_type: line.variance_type,
        item_id: line.item_id,
        std_value: line.std_value.toString(),
        actual_value: line.actual_value.toString(),
        variance_amount: line.variance_amount.toString(),
        is_favorable: isFavorable,
        dr_gl_account_id: drLine?.gl_account_id || null,
        cr_gl_account_id: crLine?.gl_account_id || null,
        journal_id: journal.journal_id,
      });
    }
  }

  private async getBioAssetState(id: string) {
    const [bioState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, id)).limit(1);
    if (!bioState) throw new NotFoundException('Bio-asset state not found for this batch.');
    return bioState;
  }

  private assertBioAsset(batch: { costing_method: string }, action: string) {
    if (batch.costing_method !== 'BIO_ASSET') {
      throw new BadRequestException(`${action} only applies to BIO_ASSET batches.`);
    }
  }

  /** PREMATURE → MATURE: reclassifies the NCA and sets up the amortization schedule. */
  async matureBioAsset(id: string, dto: MatureBioAssetDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');
    this.assertBioAsset(batch, 'Maturity transition');
    const bioState = await this.getBioAssetState(id);
    if (bioState.stage !== 'PREMATURE') {
      throw new BadRequestException(`Batch must be PREMATURE to mature — it is currently ${bioState.stage}.`);
    }

    let productiveLifeMonths = dto.productive_life_months;
    if (!productiveLifeMonths && batch.breed_id) {
      const [breed] = await this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, batch.breed_id)).limit(1);
      productiveLifeMonths = breed?.productive_life_months ?? undefined;
    }
    if (!productiveLifeMonths) {
      throw new BadRequestException("productive_life_months is required (either on the request, or via the batch's breed).");
    }

    const currentQty = Number(bioState.current_quantity);
    const ncaValue = Number(bioState.nca_book_value);
    const residualTotal = dto.residual_value_per_unit * currentQty;
    // Stored per-unit (amortizeBioAsset multiplies by the *current* headcount at
    // each run, which correctly shrinks the monthly charge as mortality reduces
    // the surviving herd — storing a herd-total here instead double-counts
    // headcount and wipes the NCA out on the very first amortization run).
    const monthlyRate = currentQty > 0 ? (ncaValue - residualTotal) / productiveLifeMonths / currentQty : 0;
    if (monthlyRate < 0) {
      throw new BadRequestException('Residual value exceeds the current NCA book value — cannot compute a positive amortization rate.');
    }

    const maturedAt = toMysqlTimestamp().slice(0, 10);
    await this.glPostingService.postBatchCostEntry({
      tenantId,
      companyId: batch.company_id,
      transactionType: 'BIO_TRANSFORMATION',
      amount: ncaValue,
      documentNo: batch.batch_no,
      postingDate: maturedAt,
      description: `Maturity transition — ${batch.batch_no}`,
      nobId: batch.nob_id || undefined,
      lobId: batch.lob_id,
      stageId: batch.stage_id || undefined,
      userId: userPayload?.userId,
    });

    await this.db
      .update(schema.batchBioAssetState)
      .set({
        stage: 'MATURE',
        matured_at: maturedAt,
        monthly_amortization_rate: monthlyRate.toString(),
        residual_value_per_unit: dto.residual_value_per_unit.toString(),
        productive_life_months: productiveLifeMonths,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchBioAssetState.batch_id, id));

    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: batch.company_id,
      bio_asset_item_id: await this.resolveBioAssetItemId(batch, tenantId),
      entry_type: 'TRANSFORMATION',
      document_no: batch.batch_no,
      batch_id: id,
      batch_no: batch.batch_no,
      posting_date: maturedAt,
      stage: 'MATURE',
      quantity: currentQty.toString(),
      cost_amount: '0.0000',
      costing_method: 'AMORTIZED_COST',
      nob_id: batch.nob_id,
      lob_id: batch.lob_id,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'MATURE',
      entityName: 'batch_bio_asset_state',
      entityId: id,
      newValues: { stage: 'MATURE', monthly_amortization_rate: monthlyRate },
    });

    return this.findOne(id);
  }

  /** Mature only. One run per calendar month — posts Dr Amort Expense / Cr Accum Amort and reduces the NCA. */
  async amortizeBioAsset(id: string, dto: AmortizeBioAssetDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');
    this.assertBioAsset(batch, 'Amortization');
    const bioState = await this.getBioAssetState(id);
    if (bioState.stage !== 'MATURE') {
      throw new BadRequestException('Batch must be MATURE before amortization can run.');
    }
    if (!bioState.monthly_amortization_rate) {
      throw new BadRequestException('No amortization rate set — mature the batch first.');
    }

    const period = dto.posting_date.slice(0, 7); // YYYY-MM
    const existingEntries = await this.db
      .select()
      .from(schema.bioAssetLedger)
      .where(and(eq(schema.bioAssetLedger.batch_id, id), eq(schema.bioAssetLedger.entry_type, 'AMORTIZATION')));
    if (existingEntries.some((e) => e.posting_date.slice(0, 7) === period)) {
      throw new BadRequestException(`Amortization has already been run for ${period}.`);
    }

    const currentQty = Number(bioState.current_quantity);
    const amount = Number(bioState.monthly_amortization_rate) * currentQty;

    await this.glPostingService.postBatchCostEntry({
      tenantId,
      companyId: batch.company_id,
      transactionType: 'BIO_AMORTIZATION',
      amount,
      documentNo: batch.batch_no,
      postingDate: dto.posting_date,
      description: `Amortization ${period} — ${batch.batch_no}`,
      nobId: batch.nob_id || undefined,
      lobId: batch.lob_id,
      stageId: batch.stage_id || undefined,
      userId: userPayload?.userId,
    });

    const newNca = Math.max(0, Number(bioState.nca_book_value) - amount);
    await this.db
      .update(schema.batchBioAssetState)
      .set({ nca_book_value: newNca.toString(), updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchBioAssetState.batch_id, id));

    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: batch.company_id,
      bio_asset_item_id: await this.resolveBioAssetItemId(batch, tenantId),
      entry_type: 'AMORTIZATION',
      document_no: batch.batch_no,
      batch_id: id,
      batch_no: batch.batch_no,
      posting_date: dto.posting_date,
      stage: 'MATURE',
      quantity: currentQty.toString(),
      cost_amount: (-amount).toString(),
      costing_method: 'AMORTIZED_COST',
      nob_id: batch.nob_id,
      lob_id: batch.lob_id,
      created_by: userPayload?.userId || null,
    });

    return this.findOne(id);
  }

  /** Revalues the herd to a new fair value per unit — gain posts normally, loss reverses (mirrors Phase 7's variance direction). */
  async recordFairValue(id: string, dto: RecordFairValueDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');
    this.assertBioAsset(batch, 'Fair value adjustment');
    const bioState = await this.getBioAssetState(id);

    const currentQty = Number(bioState.current_quantity);
    if (currentQty <= 0) {
      throw new BadRequestException('No animals remain in this herd.');
    }
    const currentPerUnit = Number(bioState.nca_book_value) / currentQty;
    const gainLoss = (dto.fair_value_per_unit - currentPerUnit) * currentQty;

    if (Math.abs(gainLoss) < 0.005) {
      return this.findOne(id);
    }

    await this.glPostingService.postBatchCostEntry({
      tenantId,
      companyId: batch.company_id,
      transactionType: 'BIO_FAIR_VALUE',
      amount: Math.abs(gainLoss),
      documentNo: batch.batch_no,
      postingDate: dto.posting_date,
      description: `Fair value adjustment — ${batch.batch_no}`,
      nobId: batch.nob_id || undefined,
      lobId: batch.lob_id,
      stageId: batch.stage_id || undefined,
      userId: userPayload?.userId,
      reverseDirection: gainLoss < 0,
    });

    const newNca = Math.max(0, Number(bioState.nca_book_value) + gainLoss);
    await this.db
      .update(schema.batchBioAssetState)
      .set({ nca_book_value: newNca.toString(), updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchBioAssetState.batch_id, id));

    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: batch.company_id,
      bio_asset_item_id: await this.resolveBioAssetItemId(batch, tenantId),
      entry_type: 'FAIR_VALUE_ADJMT',
      document_no: batch.batch_no,
      batch_id: id,
      batch_no: batch.batch_no,
      posting_date: dto.posting_date,
      stage: bioState.stage,
      quantity: currentQty.toString(),
      cost_amount: gainLoss.toString(),
      cost_amount_each_unit: dto.fair_value_per_unit.toString(),
      costing_method: 'FAIR_VALUE',
      nob_id: batch.nob_id,
      lob_id: batch.lob_id,
      created_by: userPayload?.userId || null,
    });

    return this.findOne(id);
  }

  /** Exits animals from the herd via harvest (NBV becomes the resulting inventory item's cost) or sale (proceeds vs. NBV = gain/loss). Auto-closes the batch once the herd is fully disposed. */
  async disposeBioAsset(id: string, dto: DisposeBioAssetDto, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'ACTIVE');
    this.assertBioAsset(batch, 'Disposal');
    const bioState = await this.getBioAssetState(id);

    const currentQty = Number(bioState.current_quantity);
    if (dto.quantity <= 0 || dto.quantity > currentQty) {
      throw new BadRequestException(`Invalid disposal quantity — ${currentQty} remain in the herd.`);
    }

    const ncaBefore = Number(bioState.nca_book_value);
    const nbvDisposed = currentQty > 0 ? (ncaBefore / currentQty) * dto.quantity : 0;

    if (dto.disposal_type === 'HARVEST') {
      if (!dto.output_item_id || !dto.output_uom || !dto.output_quantity || !dto.warehouse_id) {
        throw new BadRequestException('HARVEST disposal requires output_item_id, output_uom, output_quantity and warehouse_id.');
      }
      const rate = dto.output_quantity > 0 ? nbvDisposed / dto.output_quantity : 0;
      const ledgerEntry = await this.ledgerService.writePositiveEntry({
        tenantId,
        companyId: batch.company_id,
        itemId: dto.output_item_id,
        documentType: 'BATCH',
        documentNo: batch.batch_no,
        postingDate: dto.posting_date,
        transactionType: 'BIO_HARVEST',
        quantity: dto.output_quantity,
        uom: dto.output_uom,
        rate,
        batchNo: batch.batch_no,
        warehouseId: dto.warehouse_id,
        userId: userPayload?.userId,
      });
      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
    } else {
      if (dto.sale_proceeds === undefined || dto.sale_proceeds === null) {
        throw new BadRequestException('SOLD disposal requires sale_proceeds.');
      }
      const gainLoss = dto.sale_proceeds - nbvDisposed;
      if (Math.abs(gainLoss) >= 0.005) {
        // Only the bio-asset-relief + gain/loss recognition posts here — no
        // Sales/AR module exists yet to hang the cash/receivable side off of.
        await this.glPostingService.postBatchCostEntry({
          tenantId,
          companyId: batch.company_id,
          transactionType: 'BIO_DISPOSAL_SOLD',
          amount: Math.abs(gainLoss),
          documentNo: batch.batch_no,
          postingDate: dto.posting_date,
          description: `Disposal (sold) — ${batch.batch_no}`,
          nobId: batch.nob_id || undefined,
          lobId: batch.lob_id,
          stageId: batch.stage_id || undefined,
          userId: userPayload?.userId,
          reverseDirection: gainLoss < 0,
        });
      }
    }

    const newQty = currentQty - dto.quantity;
    const newNca = Math.max(0, ncaBefore - nbvDisposed);
    await this.db
      .update(schema.batchBioAssetState)
      .set({ current_quantity: newQty.toString(), nca_book_value: newNca.toString(), updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchBioAssetState.batch_id, id));

    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: batch.company_id,
      bio_asset_item_id: await this.resolveBioAssetItemId(batch, tenantId),
      entry_type: 'TRANSFORMATION',
      document_no: batch.batch_no,
      batch_id: id,
      batch_no: batch.batch_no,
      posting_date: dto.posting_date,
      stage: bioState.stage,
      quantity: (-dto.quantity).toString(),
      cost_amount: (-nbvDisposed).toString(),
      costing_method: bioState.stage === 'MATURE' ? 'AMORTIZED_COST' : 'COST_ACCUMULATION',
      nob_id: batch.nob_id,
      lob_id: batch.lob_id,
      created_by: userPayload?.userId || null,
    });

    let closedNow = false;
    if (newQty <= 0) {
      closedNow = true;
      await this.db
        .update(schema.batchHeader)
        .set({
          status: 'CLOSED',
          actual_end_date: dto.posting_date,
          closing_quantity: '0.0000',
          total_cost: newNca.toString(),
          unit_cost: '0.000000',
          closed_at: toMysqlTimestamp(),
          closed_by: userPayload?.userId || null,
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp(),
        })
        .where(eq(schema.batchHeader.batch_id, id));
    }

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'DISPOSE',
      entityName: 'batch_bio_asset_state',
      entityId: id,
      newValues: { ...dto, closedNow },
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: UserContext) {
    const batch = await this.findOne(id);
    this.assertStatus(batch, 'DRAFT');

    // Explicit, named guard — a DRAFT batch can't actually have a scheduler yet
    // (transferStage() requires ACTIVE), so this never fires today, but it's the
    // direct check the requirement names rather than relying on that invariant
    // holding forever.
    const [activeScheduler] = await this.db.select({ scheduler_id: schema.schedulerHeader.scheduler_id })
      .from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, id), eq(schema.schedulerHeader.scheduler_status, 'ACTIVE')))
      .limit(1);
    if (activeScheduler) {
      throw new BadRequestException(`Batch '${batch.batch_no}' has an ACTIVE scheduler and cannot be deleted.`);
    }

    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.batchHeader)
      .set({ status: 'CANCELLED', deleted_at: deletedTime, updated_by: userPayload?.userId || null })
      .where(eq(schema.batchHeader.batch_id, id));

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'batch_header',
      entityId: id,
      oldValues: batch,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Batch '${batch.batch_no}' has been cancelled.` };
  }

  // Resolves a daily-entry row's animal scope: null means "whole batch"
  // (unchanged historical behaviour); an array (possibly empty) means the
  // caller asked to target specific animals or all-but-some via animal_ids /
  // exclude_animal_ids.
  private async resolveScopedAnimalIds(
    batchId: string,
    animalIds: string[] | undefined,
    excludeAnimalIds: string[] | undefined
  ): Promise<string[] | null> {
    if (animalIds && animalIds.length > 0) return animalIds;
    if (excludeAnimalIds && excludeAnimalIds.length > 0) {
      const inBatch = await this.db
        .select({ animal_id: schema.animalRegister.animal_id })
        .from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
      const excludeSet = new Set(excludeAnimalIds);
      return inBatch.map((a) => a.animal_id).filter((animalId) => !excludeSet.has(animalId));
    }
    return null;
  }

  // Splits `total` into `n` shares that sum back to exactly `total` (4dp,
  // matching batch_transaction.quantity's decimal(18,4)) — any rounding
  // remainder is absorbed into the last share.
  private splitQuantityEvenly(total: number, n: number): number[] {
    const base = Math.floor((total / n) * 10000) / 10000;
    const shares = new Array(n).fill(base);
    const remainder = Math.round((total - base * n) * 10000) / 10000;
    shares[n - 1] = Math.round((shares[n - 1] + remainder) * 10000) / 10000;
    return shares;
  }

  async bulkAddDailyTransactions(dto: BulkDailyEntryDto, tenantId: string, userPayload?: UserContext) {
    let successCount = 0;
    const errors: Array<{ batch_id: string; error: string }> = [];

    // Cache active feed items for fallback resolution
    let feedItems: Array<typeof schema.itemMaster.$inferSelect> = [];
    try {
      const q = this.db?.select?.();
      if (q?.from) {
        feedItems = await q
          .from(schema.itemMaster)
          .where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.is_active, true)));
      }
    } catch {
      feedItems = [];
    }

    for (const row of dto.entries) {
      try {
        let batch: Awaited<ReturnType<BatchService['findOne']>> | { batch_id: string; opening_quantity: number; current_stage_code?: string; closing_quantity?: string | null; remarks?: string | null; breed_id?: string | null };
        try {
          batch = await this.findOne(row.batch_id);
        } catch {
          batch = { batch_id: row.batch_id, opening_quantity: 1 };
        }

        const scopedAnimalIds = await this.resolveScopedAnimalIds(row.batch_id, row.animal_ids, row.exclude_animal_ids);
        if (scopedAnimalIds && scopedAnimalIds.length === 0) {
          throw new Error('No animals resolved for the selected scope (animal_ids/exclude_animal_ids) — nothing to record.');
        }

        // 1. Feed Consumption
        if (row.feed_qty != null && Number(row.feed_qty) > 0) {
          let feedItemId = row.feed_item_id;
          if (!feedItemId) {
            if (batch.current_stage_code === 'GESTATION' || batch.current_stage_code === 'DRY_SOW_GESTATION') {
              feedItemId = feedItems.find((i) => i.item_code.includes('GEST'))?.item_id;
            } else if (batch.current_stage_code === 'LACTATION' || batch.current_stage_code === 'FARROWING') {
              feedItemId = feedItems.find((i) => i.item_code.includes('CREEP') || i.item_code.includes('LACT'))?.item_id;
            } else {
              feedItemId = feedItems.find((i) => i.item_code.includes('WEAN') || i.item_code.includes('GROW') || i.item_code.includes('FIN'))?.item_id;
            }
            if (!feedItemId) {
              feedItemId = feedItems.find((i) => i.item_type === 'FEED')?.item_id || feedItems[0]?.item_id;
            }
          }

          if (scopedAnimalIds) {
            const shares = this.splitQuantityEvenly(Number(row.feed_qty), scopedAnimalIds.length);
            for (let i = 0; i < scopedAnimalIds.length; i++) {
              await this.addTransaction(
                row.batch_id,
                {
                  transaction_date: dto.entry_date,
                  transaction_type: 'CONSUMPTION',
                  item_id: feedItemId,
                  quantity: shares[i],
                  uom: 'KG',
                  remarks: row.remarks || 'Daily feed log',
                  animal_id: scopedAnimalIds[i],
                },
                tenantId,
                userPayload
              );
              successCount++;
            }
          } else {
            await this.addTransaction(
              row.batch_id,
              {
                transaction_date: dto.entry_date,
                transaction_type: 'CONSUMPTION',
                item_id: feedItemId,
                quantity: Number(row.feed_qty),
                uom: 'KG',
                remarks: row.remarks || 'Daily feed log',
              },
              tenantId,
              userPayload
            );
            successCount++;
          }
        }

        // 2. Mortality — when animal-scoped, the number of selected animals IS
        // the mortality count (one dead animal per row), so any row.mortality_count
        // value is ignored in favour of the selection size.
        if (scopedAnimalIds) {
          for (const animalId of scopedAnimalIds) {
            await this.addTransaction(
              row.batch_id,
              {
                transaction_date: dto.entry_date,
                transaction_type: 'MORTALITY',
                quantity: 1,
                uom: 'HEAD',
                remarks: row.remarks || 'Daily mortality log',
                animal_id: animalId,
              },
              tenantId,
              userPayload
            );
            successCount++;
          }
        } else if (row.mortality_count != null && Number(row.mortality_count) > 0) {
          await this.addTransaction(
            row.batch_id,
            {
              transaction_date: dto.entry_date,
              transaction_type: 'MORTALITY',
              quantity: Number(row.mortality_count),
              uom: 'HEAD',
              remarks: row.remarks || 'Daily mortality log',
            },
            tenantId,
            userPayload
          );
          successCount++;
        }

        // 3. Water intake observation
        if (row.water_qty != null && Number(row.water_qty) > 0) {
          if (scopedAnimalIds) {
            const shares = this.splitQuantityEvenly(Number(row.water_qty), scopedAnimalIds.length);
            for (let i = 0; i < scopedAnimalIds.length; i++) {
              await this.addTransaction(
                row.batch_id,
                {
                  transaction_date: dto.entry_date,
                  transaction_type: 'OBSERVATION',
                  quantity: shares[i],
                  uom: 'L',
                  remarks: `Water Intake: ${row.water_qty} L`,
                  animal_id: scopedAnimalIds[i],
                },
                tenantId,
                userPayload
              );
              successCount++;
            }
          } else {
            await this.addTransaction(
              row.batch_id,
              {
                transaction_date: dto.entry_date,
                transaction_type: 'OBSERVATION',
                quantity: Number(row.water_qty),
                uom: 'L',
                remarks: `Water Intake: ${row.water_qty} L`,
              },
              tenantId,
              userPayload
            );
            successCount++;
          }
        }

        // 4. Shed temperature observation — an environmental reading, not a
        // divisible quantity, so when animal-scoped it's recorded once per
        // animal at the SAME value (for per-animal viewing/filtering) rather
        // than split; it carries no cost/GL impact either way.
        if (row.temperature != null && String(row.temperature).trim() !== '') {
          if (scopedAnimalIds) {
            for (const animalId of scopedAnimalIds) {
              await this.addTransaction(
                row.batch_id,
                {
                  transaction_date: dto.entry_date,
                  transaction_type: 'OBSERVATION',
                  quantity: Number(row.temperature),
                  uom: '°C',
                  remarks: `Shed Temperature: ${row.temperature}°C`,
                  animal_id: animalId,
                },
                tenantId,
                userPayload
              );
              successCount++;
            }
          } else {
            await this.addTransaction(
              row.batch_id,
              {
                transaction_date: dto.entry_date,
                transaction_type: 'OBSERVATION',
                quantity: Number(row.temperature),
                uom: '°C',
                remarks: `Shed Temperature: ${row.temperature}°C`,
              },
              tenantId,
              userPayload
            );
            successCount++;
          }
        }
      } catch (err: unknown) {
        errors.push({
          batch_id: row.batch_id,
          error: err instanceof Error ? err.message : 'Transaction recording failed',
        });
      }
    }

    if (errors.length > 0 && successCount === 0) {
      throw new BadRequestException(`Failed to record daily entries: ${errors.map((e) => e.error).join('; ')}`);
    }

    return {
      success: errors.length === 0,
      totalEntries: dto.entries.length,
      successCount,
      errorsCount: errors.length,
      errorCount: errors.length,
      errors,
    };
  }

  /**
   * Manually (re)generates the scheduler_header for this batch's CURRENT
   * stage from breed_lifecycle_stages — the same idempotent path
   * transferStage() calls automatically. Useful for a batch that reached its
   * current stage before this feature existed, or whose header needs
   * refreshing after breed lifecycle standards change.
   */
  async generateSchedulerForBatch(batchId: string, tenantId: string, userPayload?: UserContext) {
    return this.schedulerHeaderService.generateForBatchCurrentStage(batchId, tenantId, userPayload);
  }

  /**
   * Returns day-by-day standard breed performance curves vs actual recorded data for a batch.
   */
  async getBatchPerformanceCurves(batchId: string, tenantId?: string, animalId?: string) {
    const batch = await this.findOne(batchId);
    if (tenantId && batch.tenant_id && batch.tenant_id !== tenantId) {
      throw new NotFoundException(`Batch ${batchId} not found for current tenant`);
    }
    const startDate = new Date(batch.start_date);
    const today = new Date();
    const batchAgeDays = Math.max(1, Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // 1. Fetch batch transactions — optionally restricted to one animal, so
    // the curves reflect just that animal's own recorded feed/weight/mortality
    // rows instead of the whole batch.
    const transactions = await this.db
      .select({
        tx: schema.batchTransaction,
        item: schema.itemMaster,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.batchTransaction.item_id, schema.itemMaster.item_id))
      .where(
        animalId
          ? and(eq(schema.batchTransaction.batch_id, batchId), eq(schema.batchTransaction.animal_id, animalId))
          : eq(schema.batchTransaction.batch_id, batchId)
      )
      .orderBy(schema.batchTransaction.transaction_date);

    // 2. Fetch every scheduler_header this batch has accumulated (one per stage it
    // has passed through) with their lines, so a day anywhere in the batch's life
    // can be resolved to whichever stage's schedule actually covered it.
    const schedulerHeaders = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.batch_id, batchId));
    const schedulerLines = schedulerHeaders.length
      ? await this.db.select().from(schema.schedulerLine).where(inArray(schema.schedulerLine.scheduler_id, schedulerHeaders.map((h) => h.scheduler_id)))
      : [];
    const lineForDate = (date: Date, lineType: string) => {
      const header = schedulerHeaders.find((h) => {
        const from = new Date(h.effective_from);
        const to = h.effective_to ? new Date(h.effective_to) : null;
        return date >= from && (!to || date <= to);
      });
      if (!header) return null;
      const dayOfStage = Math.floor((date.getTime() - new Date(header.effective_from).getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return schedulerLines.find((l) =>
        l.scheduler_id === header.scheduler_id && l.line_type === lineType &&
        dayOfStage >= l.start_day && (l.end_day == null || dayOfStage <= l.end_day)
      ) || null;
    };

    // Also fetch breed lifecycle stages for reference
    const lifecycleStandards = batch.breed_id
      ? await this.db
          .select()
          .from(schema.breedLifecycleStages)
          .where(and(eq(schema.breedLifecycleStages.breed_id, batch.breed_id), eq(schema.breedLifecycleStages.is_active, true)))
          .orderBy(schema.breedLifecycleStages.period_from)
      : [];

    let breedName: string | null = null;
    if (batch.breed_id) {
      const [bRow] = await this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, batch.breed_id)).limit(1);
      breedName = bRow?.breed_name || null;
    }

    // Group actual transactions by day
    const dayActualFeed: Record<number, number> = {};
    const dayActualMort: Record<number, number> = {};
    const dayActualWeight: Record<number, number> = {};

    for (const { tx, item } of transactions) {
      const txDate = new Date(tx.transaction_date);
      const dayNo = Math.max(1, Math.floor((txDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const qty = Number(tx.quantity || 0);

      if (tx.transaction_type === 'CONSUMPTION' || item?.item_type === 'FEED') {
        dayActualFeed[dayNo] = (dayActualFeed[dayNo] || 0) + qty;
      } else if (tx.transaction_type === 'MORTALITY') {
        dayActualMort[dayNo] = (dayActualMort[dayNo] || 0) + qty;
      } else if (tx.transaction_type === 'OUTPUT' || tx.transaction_type === 'OBSERVATION' || tx.transaction_type === 'WEIGHT_ENTRY') {
        if (tx.uom === 'KG' && qty > 0) {
          dayActualWeight[dayNo] = qty;
        }
      }
    }

    // Build timeline curves (day 1 to min(batchAgeDays + 7, 180))
    const totalDaysToProject = Math.min(Math.max(batchAgeDays + 7, 30), 180);
    const curves: Array<Record<string, unknown>> = [];

    let cumStdFeed = 0;
    let cumActFeed = 0;
    let cumStdMort = 0;
    let cumActMort = 0;
    let lastKnownActWeight = 1.5; // default birth weight ~1.5kg

    const initialHeadcount = Number(batch.opening_quantity || 1);

    for (let day = 1; day <= totalDaysToProject; day++) {
      const curDate = new Date(startDate.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);

      // Find standard feed for this day
      let stdDailyFeedPerHead = 0;
      let stdTargetWeight = 0;
      let stdMortPct = 0;

      // Check schedule lines
      const curDateObj = new Date(startDate.getTime() + (day - 1) * 86400000);
      const activeFeedLine = lineForDate(curDateObj, 'CONSUMPTION');
      if (activeFeedLine && activeFeedLine.standard_qty) {
        stdDailyFeedPerHead = Number(activeFeedLine.standard_qty);
      } else {
        // Fallback to breed standards
        const lc = lifecycleStandards.find(l => {
          const pF = toDays(l.period_from, l.calc_unit);
          const pT = toDays(l.period_to, l.calc_unit);
          return day >= pF && day <= pT;
        });
        if (lc) {
          stdDailyFeedPerHead = Number(lc.feed_qty_per_head_per_day_kg || 0);
          stdTargetWeight = Number(lc.std_body_weight_kg || 0);
          stdMortPct = Number(lc.std_mortality_rate_pct || 0);
        }
      }

      const activeWeightLine = lineForDate(curDateObj, 'OUTPUT');
      if (activeWeightLine && activeWeightLine.standard_qty) {
        stdTargetWeight = Number(activeWeightLine.standard_qty);
      }

      const stdTotalDailyFeed = stdDailyFeedPerHead * initialHeadcount;
      const actDailyFeed = dayActualFeed[day] || 0;
      const actDailyMort = dayActualMort[day] || 0;

      cumStdFeed += stdTotalDailyFeed;
      if (day <= batchAgeDays) {
        cumActFeed += actDailyFeed;
        cumActMort += actDailyMort;
        if (dayActualWeight[day]) {
          lastKnownActWeight = dayActualWeight[day];
        }
      }
      cumStdMort += (stdMortPct / 100) * initialHeadcount;

      curves.push({
        day,
        date: curDate,
        isPastOrToday: day <= batchAgeDays,
        stdDailyFeedPerHead,
        stdTotalDailyFeed: Math.round(stdTotalDailyFeed * 100) / 100,
        actTotalDailyFeed: day <= batchAgeDays ? Math.round(actDailyFeed * 100) / 100 : null,
        cumStdFeed: Math.round(cumStdFeed * 100) / 100,
        cumActFeed: day <= batchAgeDays ? Math.round(cumActFeed * 100) / 100 : null,
        cumStdMort: Math.round(cumStdMort * 100) / 100,
        stdTargetWeight: stdTargetWeight > 0 ? stdTargetWeight : null,
        actWeight: day <= batchAgeDays && dayActualWeight[day] ? dayActualWeight[day] : null,
        actDailyMort: day <= batchAgeDays ? actDailyMort : null,
        cumActMort: day <= batchAgeDays ? cumActMort : null,
      });
    }

    const currentHeadcount = Number(batch.closing_quantity || batch.opening_quantity || initialHeadcount);
    const weightGain = Math.max(0, lastKnownActWeight - 1.5);
    const liveFcr = weightGain > 0 && cumActFeed > 0 && currentHeadcount > 0
      ? Math.round((cumActFeed / (weightGain * currentHeadcount)) * 100) / 100
      : null;

    const feedDeviationPct = cumStdFeed > 0 && cumActFeed > 0
      ? Math.round(((cumActFeed - cumStdFeed) / cumStdFeed) * 1000) / 10
      : 0;

    return {
      batch: {
        batch_id: batch.batch_id,
        batch_no: batch.batch_no,
        batch_name: batch.remarks || batch.batch_no,
        breed_id: batch.breed_id,
        breed_name: breedName,
        has_scheduler: schedulerHeaders.length > 0,
        start_date: batch.start_date,
        batch_age_days: batchAgeDays,
        initial_quantity: initialHeadcount,
        current_quantity: currentHeadcount,
        current_stage_code: batch.current_stage_code,
      },
      summary: {
        totalStdFeedKg: Math.round(cumStdFeed),
        totalActFeedKg: Math.round(cumActFeed),
        feedDeviationPct,
        totalMortality: cumActMort,
        mortalityRatePct: Math.round((cumActMort / initialHeadcount) * 1000) / 10,
        liveFcr,
        lastRecordedWeightKg: lastKnownActWeight,
      },
      curves,
    };
  }

  async addAttachment(
    batchId: string,
    file: { filename: string; originalname: string; mimetype: string },
    logDate: string,
    attachmentType: string | undefined,
    userId: string | undefined,
  ) {
    await this.findOne(batchId); // 404s if the batch doesn't exist
    const attachmentId = randomUUID();
    await this.db.insert(schema.batchAttachment).values({
      attachment_id: attachmentId,
      batch_id: batchId,
      log_date: logDate,
      file_name: file.originalname,
      file_url: `/uploads/${file.filename}`,
      mime_type: file.mimetype,
      attachment_type: attachmentType || 'IMAGE',
      uploaded_by: userId || null,
    });
    const [saved] = await this.db
      .select()
      .from(schema.batchAttachment)
      .where(eq(schema.batchAttachment.attachment_id, attachmentId))
      .limit(1);
    return saved;
  }

  async listAttachments(batchId: string, date?: string) {
    const conditions = [eq(schema.batchAttachment.batch_id, batchId)];
    if (date) conditions.push(eq(schema.batchAttachment.log_date, date));
    return this.db
      .select()
      .from(schema.batchAttachment)
      .where(and(...conditions))
      .orderBy(desc(schema.batchAttachment.created_at));
  }

  async deleteAttachment(batchId: string, attachmentId: string) {
    const [attachment] = await this.db
      .select()
      .from(schema.batchAttachment)
      .where(and(eq(schema.batchAttachment.attachment_id, attachmentId), eq(schema.batchAttachment.batch_id, batchId)))
      .limit(1);
    if (!attachment) {
      throw new NotFoundException(`Attachment '${attachmentId}' not found on this batch.`);
    }
    await this.db.delete(schema.batchAttachment).where(eq(schema.batchAttachment.attachment_id, attachmentId));
    const uploadsDir = resolve(process.env.UPLOADS_DIR || 'apps/api/uploads');
    await unlink(resolve(uploadsDir, attachment.file_url.replace(/^\/uploads\//, ''))).catch(() => {
      // File already gone / not on disk — the DB row is still the source of truth for the delete.
    });
    return { success: true };
  }
}


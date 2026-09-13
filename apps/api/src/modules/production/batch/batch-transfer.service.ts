import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, inArray, isNull, gte, lte, desc, sql, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchTransferDto, MergeBatchDto, QueryBatchTransferDto, SplitBatchDto } from './dto/batch.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';

// Local time, not UTC. MySQL's own DEFAULT (now()) on created_at is local, so
// formatting through toISOString() (as some older services here do) stamps
// posted_at hours *before* created_at on any non-UTC machine.
const toMysqlTimestamp = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/**
 * Livestock movement between batches.
 *
 * This is deliberately NOT `batch.service.ts#transferStage()`, which walks a
 * single batch through its own lifecycle (QUARANTINE -> GILT_GROWER -> ...).
 * This service moves *animals* from batch A to batch B — the movement that
 * happens when a cycle closes, or when a subset is pulled out early.
 *
 * Two invariants the rest of the app depends on:
 *  - A transferred animal stays fully operable. We repoint
 *    `animal_register.current_batch_id`, we never dispose or deactivate it, so
 *    every data-entry / health / breeding screen picks it up under the
 *    destination batch from the moment the transfer posts.
 *  - A transfer is a reclassification, not income. Value moves from the source
 *    batch's carrying amount to the destination's; the two sides net to zero,
 *    so no journal is raised (a same-account Dr/Cr would post a meaningless
 *    zero-value entry). What DOES move is the per-batch carrying value in
 *    `batch_bio_asset_state` and `batch_header.closing_quantity`, which is what
 *    the bio-asset roll-forward and WIP-by-batch reports actually read.
 */
@Injectable()
export class BatchTransferService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly schedulerHeaderService: SchedulerHeaderService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * Tenants provisioned before this feature have no BATCH_TRANSFER series, and
   * generateNext() throws on a missing one. Rather than make every existing
   * tenant fail at the first transfer, fall back to a self-derived number.
   */
  private async generateTransferNo(tenantId: string, companyId: string): Promise<string> {
    try {
      return await this.numberSeriesService.generateNext('BATCH_TRANSFER', tenantId, companyId);
    } catch {
      const [{ n }] = await this.db
        .select({ n: sql<number>`COUNT(*)` })
        .from(schema.batchTransfer)
        .where(and(eq(schema.batchTransfer.tenant_id, tenantId), eq(schema.batchTransfer.company_id, companyId)));
      return `BTR-${new Date().getFullYear()}-${String(Number(n) + 1).padStart(4, '0')}`;
    }
  }

  private async loadBatch(batchId: string, tenantId: string, label: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), isNull(schema.batchHeader.deleted_at)))
      .limit(1);
    if (!batch) throw new NotFoundException(`${label} batch not found.`);
    return batch;
  }

  /** Animals currently sitting in a batch and still alive — the transferable pool. */
  async listTransferableAnimals(batchId: string, tenantId: string) {
    return this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        ear_tag: schema.animalRegister.ear_tag,
        animal_type: schema.animalRegister.animal_type,
        gender: schema.animalRegister.gender,
        status: schema.animalRegister.status,
        current_location_id: schema.animalRegister.current_location_id,
        book_value: schema.animalRegister.book_value,
        total_opening_asset_value: schema.animalRegister.total_opening_asset_value,
        acquisition_cost: schema.animalRegister.acquisition_cost,
      })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.tenant_id, tenantId),
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        )
      )
      .orderBy(schema.animalRegister.animal_code);
  }

  async create(dto: CreateBatchTransferDto, tenantId: string, fromBatchId: string, userPayload?: { userId?: string }) {
    const source = await this.loadBatch(fromBatchId, tenantId, 'Source');
    const destination = await this.loadBatch(dto.to_batch_id, tenantId, 'Destination');

    if (source.batch_id === destination.batch_id) {
      throw new BadRequestException('Source and destination batch must be different.');
    }
    if (source.status !== 'ACTIVE') {
      throw new BadRequestException(`Only an ACTIVE batch can transfer animals out (source is ${source.status}).`);
    }
    if (!['DRAFT', 'ACTIVE'].includes(destination.status)) {
      throw new BadRequestException(`Destination batch must be DRAFT or ACTIVE (it is ${destination.status}).`);
    }
    if (source.company_id !== destination.company_id) {
      throw new BadRequestException('Cross-company transfers are not supported — both batches must belong to the same company.');
    }

    const transferType = dto.transfer_type || (dto.animal_ids?.length ? 'PARTIAL' : 'FULL_BATCH');
    const pool = await this.listTransferableAnimals(fromBatchId, tenantId);

    let selected = pool;
    if (transferType === 'PARTIAL') {
      if (!dto.animal_ids?.length) {
        throw new BadRequestException('A PARTIAL transfer needs at least one animal selected.');
      }
      const poolIds = new Set(pool.map((a) => a.animal_id));
      const invalid = dto.animal_ids.filter((id) => !poolIds.has(id));
      if (invalid.length) {
        throw new BadRequestException(
          `${invalid.length} selected animal(s) are not live members of the source batch and cannot be transferred.`
        );
      }
      const chosen = new Set(dto.animal_ids);
      selected = pool.filter((a) => chosen.has(a.animal_id));
    }

    if (!selected.length) {
      throw new BadRequestException('The source batch has no live animals to transfer.');
    }

    // Per-head carrying value: the animal's own book value when it has one,
    // otherwise the batch's carrying amount spread across its live head count.
    const [sourceState] = await this.db
      .select()
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, fromBatchId))
      .limit(1);
    const stateQty = Number(sourceState?.current_quantity) || 0;
    const perHeadFromState = sourceState && stateQty > 0 ? Number(sourceState.nca_book_value) / stateQty : 0;

    const valueOf = (a: (typeof pool)[number]) =>
      Number(a.book_value) || Number(a.total_opening_asset_value) || Number(a.acquisition_cost) || perHeadFromState || 0;

    const lines = selected.map((a, idx) => ({
      line_id: randomUUID(),
      transfer_id: '',
      line_no: idx + 1,
      animal_id: a.animal_id,
      from_location_id: a.current_location_id || source.sub_location_id || source.location_id || null,
      to_location_id: dto.to_location_id || destination.sub_location_id || destination.location_id || null,
      book_value: valueOf(a).toFixed(4),
      remarks: null as string | null,
    }));

    const transferId = randomUUID();
    lines.forEach((l) => (l.transfer_id = transferId));
    const totalValue = lines.reduce((sum, l) => sum + Number(l.book_value), 0);
    const transferNo = await this.generateTransferNo(tenantId, source.company_id);

    await this.db.insert(schema.batchTransfer).values({
      transfer_id: transferId,
      tenant_id: tenantId,
      company_id: source.company_id,
      transfer_no: transferNo,
      from_batch_id: fromBatchId,
      to_batch_id: destination.batch_id,
      transfer_date: dto.transfer_date,
      transfer_type: transferType,
      head_count: String(selected.length),
      transfer_value: totalValue.toFixed(4),
      reason: dto.reason || null,
      remarks: dto.remarks || null,
      status: 'DRAFT',
      created_by: userPayload?.userId || null,
    });
    await this.db.insert(schema.batchTransferLine).values(lines);

    await this.auditService.log({
      tenantId,
      companyId: source.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_transfer',
      entityId: transferId,
      newValues: { transfer_no: transferNo, from: source.batch_no, to: destination.batch_no, head_count: selected.length },
    });

    if (dto.post_immediately !== false) {
      return this.post(transferId, tenantId, userPayload, dto.auto_triggers_stage);
    }
    return this.findOne(transferId, tenantId);
  }

  /** Live members of a batch — the pool a split or merge can actually move. */
  private async liveAnimalIds(batchId: string): Promise<string[]> {
    const rows = await this.db
      .select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        )
      );
    return rows.map((r) => r.animal_id);
  }

  /**
   * Split part of a cohort into a child batch.
   *
   * The case this exists for: a batch is due to move on, most of it is ready and
   * some of it is not — sows that failed the day-35 scan, tail-enders short of
   * weight. Holding the whole batch back penalises the ready animals; dragging
   * the unready ones forward is simply false. So the ready animals advance with
   * the parent and the remainder become a batch of their own, holding whatever
   * stage and pen they are actually in.
   *
   * A child batch rather than a sub-group inside the parent because a batch
   * already carries everything the group needs — its own stage, scheduler,
   * location, data entry, records, costing and KPI all work against it with no
   * change. parent_batch_id is the thread back, for reporting and for merge().
   *
   * The animal movement itself is a normal PARTIAL transfer: this does not
   * repeat the repointing, value shift or ledger legs, it delegates them.
   */
  async splitBatch(
    parentBatchId: string,
    dto: SplitBatchDto,
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const parent = await this.loadBatch(parentBatchId, tenantId, 'Source');

    const animalIds = dto.animal_ids ?? [];
    if (animalIds.length === 0) {
      throw new BadRequestException('Select at least one animal to split out of the batch.');
    }
    if (parent.status !== 'ACTIVE') {
      throw new BadRequestException(`Only an ACTIVE batch can be split (this one is ${parent.status}).`);
    }

    const childBatchId = randomUUID();
    const childBatchNo = dto.child_batch_no || `${parent.batch_no}-S${String(Date.now()).slice(-4)}`;
    // The group holds where the animals actually are: by default the stage the
    // parent is leaving, or an explicit earlier stage when they have gone back
    // (a failed scan returns a sow to service, not forward to farrowing).
    const holdStageCode = dto.hold_stage_code || parent.current_stage_code;

    // post() reads the destination batch's stage_id to set each moved animal's
    // current_stage_id. Leaving it null when the group holds a different stage
    // meant the child batch claimed one stage while its animals silently kept
    // the parent's — the whole point of the split, lost.
    let holdStageId = parent.stage_id;
    if (dto.hold_stage_code && dto.hold_stage_code !== parent.current_stage_code) {
      const [matched] = await this.db
        .select({ stage_id: schema.stageMaster.stage_id })
        .from(schema.stageMaster)
        .where(
          and(
            eq(schema.stageMaster.lob_id, parent.lob_id),
            eq(schema.stageMaster.stage_code, dto.hold_stage_code.toUpperCase()),
            eq(schema.stageMaster.is_active, true),
            isNull(schema.stageMaster.deleted_at),
          )
        )
        .limit(1);
      holdStageId = matched?.stage_id ?? null;
    }

    await this.db.insert(schema.batchHeader).values({
      batch_id: childBatchId,
      tenant_id: tenantId,
      company_id: parent.company_id,
      batch_no: childBatchNo,
      nob_id: parent.nob_id,
      lob_id: parent.lob_id,
      breed_id: parent.breed_id,
      costing_method: parent.costing_method,
      operational_area_id: parent.operational_area_id,
      shed_id: parent.shed_id,
      location_id: dto.to_location_id || parent.location_id,
      sub_location_id: dto.to_location_id || parent.sub_location_id,
      current_stage_code: holdStageCode,
      stage_id: holdStageId,
      parent_batch_id: parentBatchId,
      start_date: dto.transfer_date,
      expected_end_date: parent.expected_end_date,
      opening_quantity: animalIds.length.toFixed(4),
      closing_quantity: animalIds.length.toFixed(4),
      uom: parent.uom,
      status: 'ACTIVE',
      remarks: dto.remarks || `Split from ${parent.batch_no}${dto.reason ? ` — ${dto.reason}` : ''}.`,
      created_by: userPayload?.userId || null,
    });

    await this.db.insert(schema.batchBioAssetState).values({
      state_id: randomUUID(),
      batch_id: childBatchId,
      stage: 'MATURE',
      current_quantity: animalIds.length.toFixed(4),
      nca_book_value: '0.0000',
    });

    const transfer = await this.create(
      {
        company_id: parent.company_id,
        to_batch_id: childBatchId,
        transfer_date: dto.transfer_date,
        transfer_type: 'PARTIAL',
        animal_ids: animalIds,
        reason: dto.reason,
        remarks: dto.remarks,
      } as CreateBatchTransferDto,
      tenantId,
      parentBatchId,
      userPayload,
    );

    // The child starts life already in a resolved stage (holdStageId), unlike a
    // normal batch that only gets one via transferStage() later — give it the
    // same auto-generated scheduler_header a transferStage() call would.
    if (holdStageId) {
      await this.schedulerHeaderService.createForStage(childBatchId, holdStageId, tenantId, userPayload);
    }

    return {
      child: { batch_id: childBatchId, batch_no: childBatchNo, parent_batch_id: parentBatchId, current_stage_code: holdStageCode },
      transfer,
    };
  }

  /**
   * Merge a split group back into the cohort it came from.
   *
   * Every live animal still in the child moves home and the child closes. Their
   * own stage history stays intact — the batch is the container, the animal is
   * the record of truth, so rejoining never rewrites where an animal has been.
   */
  async mergeBatch(
    childBatchId: string,
    dto: MergeBatchDto,
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const child = await this.loadBatch(childBatchId, tenantId, 'Source');

    if (!child.parent_batch_id) {
      throw new BadRequestException(`${child.batch_no} was not split out of another batch, so there is nothing to merge it into.`);
    }

    const animalIds = await this.liveAnimalIds(childBatchId);
    if (animalIds.length === 0) {
      throw new BadRequestException(`${child.batch_no} has no live animals left to merge.`);
    }

    const transfer = await this.create(
      {
        company_id: child.company_id,
        to_batch_id: child.parent_batch_id,
        transfer_date: dto.transfer_date,
        transfer_type: 'PARTIAL',
        animal_ids: animalIds,
        reason: dto.reason || 'MERGED_BACK',
        remarks: dto.remarks || `Merged back into the parent cohort from ${child.batch_no}.`,
      } as CreateBatchTransferDto,
      tenantId,
      childBatchId,
      userPayload,
    );

    await this.db
      .update(schema.batchHeader)
      .set({
        status: 'CLOSED',
        actual_end_date: dto.transfer_date,
        closed_at: toMysqlTimestamp(),
        closed_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.batchHeader.batch_id, childBatchId));

    return { merged: animalIds.length, into_batch_id: child.parent_batch_id, transfer };
  }

  /**
   * Applies the movement. Everything here is idempotent-guarded by the DRAFT
   * check, so a double-submit cannot move the same animals twice.
   */
  async post(transferId: string, tenantId: string, userPayload?: { userId?: string }, autoTriggersStage?: boolean) {
    const transfer = await this.findOne(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(`Only a DRAFT transfer can be posted (this one is ${transfer.status}).`);
    }

    const animalIds = transfer.lines.map((l) => l.animal_id);
    const headCount = animalIds.length;
    const totalValue = transfer.lines.reduce((sum, l) => sum + Number(l.book_value), 0);
    const toLocationId = transfer.lines[0]?.to_location_id || null;

    // Guard against the pool shifting between draft and post (an animal that
    // died or was sold in the meantime).
    const stillLive = await this.db
      .select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(
        and(
          inArray(schema.animalRegister.animal_id, animalIds),
          eq(schema.animalRegister.current_batch_id, transfer.from_batch_id),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        )
      );
    if (stillLive.length !== headCount) {
      throw new BadRequestException(
        `${headCount - stillLive.length} animal(s) on this transfer are no longer live members of the source batch. Re-create the transfer.`
      );
    }

    // The destination batch's stage. Animals carry their own current_stage_id
    // (read by the herd and bio-asset-by-stage reports), so moving them into a
    // batch sitting at a different stage has to move their stage with them —
    // otherwise a pig transferred into farrowing still reports as gestating.
    const [destBatch] = await this.db
      .select({ stage_id: schema.batchHeader.stage_id })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, transfer.to_batch_id))
      .limit(1);

    // 1. Repoint the animals. They stay ACTIVE and is_active — a transferred
    //    animal is still fully operable, just under a different batch.
    await this.db
      .update(schema.animalRegister)
      .set({
        current_batch_id: transfer.to_batch_id,
        ...(toLocationId ? { current_location_id: toLocationId } : {}),
        ...(destBatch?.stage_id ? { current_stage_id: destBatch.stage_id } : {}),
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(inArray(schema.animalRegister.animal_id, animalIds));

    // 1b. "Destination stage auto-triggered if auto_triggers_stage = TRUE"
    // (Schedule_master_template.xlsx) — the TRANSFER scheduler_line that
    // generated this transfer can ask for the destination batch's current
    // stage to get (or reuse) its own scheduler_header right away, rather
    // than waiting on a separate transferStage() call. createForStage() is
    // idempotent on (batch_id, stage_id), so this is safe to call even if a
    // header already exists. Runs after the repoint above so the live
    // animal_register count createForStage() reads already includes these
    // animals.
    if (autoTriggersStage && destBatch?.stage_id) {
      await this.schedulerHeaderService.createForStage(transfer.to_batch_id, destBatch.stage_id, tenantId, userPayload);
    }

    // 2. Move the carrying value and head count between the two batches' states.
    await this.shiftBioAssetState(transfer.from_batch_id, -headCount, -totalValue);
    await this.shiftBioAssetState(transfer.to_batch_id, headCount, totalValue);

    // 3. Keep batch_header.closing_quantity — the number the batch list and
    //    data-entry screens read as "live head count" — in step.
    await this.shiftClosingQuantity(transfer.from_batch_id, -headCount);
    await this.shiftClosingQuantity(transfer.to_batch_id, headCount);

    // 4. Bio-asset ledger: an out leg and an in leg, so the roll-forward report
    //    shows the movement on both batches instead of value silently appearing.
    await this.writeLedgerLegs(transfer, tenantId, userPayload?.userId);

    await this.db
      .update(schema.batchTransfer)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp(),
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchTransfer.transfer_id, transferId));

    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'batch_transfer',
      entityId: transferId,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'POSTED', head_count: headCount, transfer_value: totalValue },
    });

    return this.findOne(transferId, tenantId);
  }

  /** Adds (or subtracts) head count and carrying value on one batch's bio-asset state row. */
  private async shiftBioAssetState(batchId: string, qtyDelta: number, valueDelta: number) {
    const [state] = await this.db
      .select()
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, batchId))
      .limit(1);

    if (!state) {
      // The destination may never have had a bio-asset state row (a DRAFT batch
      // that has not been activated yet). Create it rather than dropping value.
      if (qtyDelta <= 0) return;
      await this.db.insert(schema.batchBioAssetState).values({
        state_id: randomUUID(),
        batch_id: batchId,
        stage: 'PREMATURE',
        current_quantity: qtyDelta.toFixed(4),
        nca_book_value: valueDelta.toFixed(4),
      });
      return;
    }

    await this.db
      .update(schema.batchBioAssetState)
      .set({
        current_quantity: Math.max(0, (Number(state.current_quantity) || 0) + qtyDelta).toFixed(4),
        nca_book_value: Math.max(0, (Number(state.nca_book_value) || 0) + valueDelta).toFixed(4),
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchBioAssetState.batch_id, batchId));
  }

  private async shiftClosingQuantity(batchId: string, delta: number) {
    const [batch] = await this.db
      .select({ closing_quantity: schema.batchHeader.closing_quantity, opening_quantity: schema.batchHeader.opening_quantity })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (!batch) return;
    const current = batch.closing_quantity !== null ? Number(batch.closing_quantity) : Number(batch.opening_quantity) || 0;
    await this.db
      .update(schema.batchHeader)
      .set({ closing_quantity: Math.max(0, current + delta).toFixed(4), updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchHeader.batch_id, batchId));
  }

  private async writeLedgerLegs(
    transfer: Awaited<ReturnType<BatchTransferService['findOne']>>,
    tenantId: string,
    userId?: string,
  ) {
    const [source] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, transfer.from_batch_id))
      .limit(1);
    const [destination] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, transfer.to_batch_id))
      .limit(1);

    // bio_asset_item_id is NOT NULL; fall back the same way batch.service.ts does.
    const [line] = await this.db
      .select({ item_id: schema.batchInputLine.item_id })
      .from(schema.batchInputLine)
      .where(eq(schema.batchInputLine.batch_id, transfer.from_batch_id))
      .limit(1);
    let itemId = line?.item_id;
    if (!itemId) {
      const [animal] = await this.db
        .select({ item_id: schema.animalRegister.item_id })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.animal_id, transfer.lines[0].animal_id))
        .limit(1);
      itemId = animal?.item_id;
    }
    if (!itemId) return; // Nothing sane to post against — skip rather than crash the transfer.

    const rows = transfer.lines.flatMap((l) => [
      {
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: transfer.company_id,
        bio_asset_item_id: itemId!,
        entry_type: 'TRANSFER_OUT',
        document_no: transfer.transfer_no,
        posting_date: transfer.transfer_date,
        batch_no: source?.batch_no || null,
        batch_id: transfer.from_batch_id,
        animal_id: l.animal_id,
        stage: source?.current_stage_code || null,
        quantity: '-1.0000',
        cost_amount: (-Number(l.book_value)).toFixed(4),
        cost_amount_each_unit: (-Number(l.book_value)).toFixed(4),
        nob_id: source?.nob_id || null,
        lob_id: source?.lob_id || null,
        created_by: userId || null,
      },
      {
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: transfer.company_id,
        bio_asset_item_id: itemId!,
        entry_type: 'TRANSFER_IN',
        document_no: transfer.transfer_no,
        posting_date: transfer.transfer_date,
        batch_no: destination?.batch_no || null,
        batch_id: transfer.to_batch_id,
        animal_id: l.animal_id,
        stage: destination?.current_stage_code || null,
        quantity: '1.0000',
        cost_amount: Number(l.book_value).toFixed(4),
        cost_amount_each_unit: Number(l.book_value).toFixed(4),
        nob_id: destination?.nob_id || null,
        lob_id: destination?.lob_id || null,
        created_by: userId || null,
      },
    ]);

    await this.db.insert(schema.bioAssetLedger).values(rows);
  }

  async cancel(transferId: string, tenantId: string, userPayload?: { userId?: string }) {
    const transfer = await this.findOne(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT transfer can be cancelled. A posted transfer must be reversed by a new transfer in the opposite direction.');
    }
    await this.db
      .update(schema.batchTransfer)
      .set({ status: 'CANCELLED', updated_by: userPayload?.userId || null, updated_at: toMysqlTimestamp() })
      .where(eq(schema.batchTransfer.transfer_id, transferId));
    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'CANCEL',
      entityName: 'batch_transfer',
      entityId: transferId,
    });
    return this.findOne(transferId, tenantId);
  }

  async findOne(transferId: string, tenantId: string) {
    const [transfer] = await this.db
      .select()
      .from(schema.batchTransfer)
      .where(and(eq(schema.batchTransfer.transfer_id, transferId), eq(schema.batchTransfer.tenant_id, tenantId), isNull(schema.batchTransfer.deleted_at)))
      .limit(1);
    if (!transfer) throw new NotFoundException('Transfer not found.');

    const lines = await this.db
      .select({
        line_id: schema.batchTransferLine.line_id,
        line_no: schema.batchTransferLine.line_no,
        animal_id: schema.batchTransferLine.animal_id,
        from_location_id: schema.batchTransferLine.from_location_id,
        to_location_id: schema.batchTransferLine.to_location_id,
        book_value: schema.batchTransferLine.book_value,
        remarks: schema.batchTransferLine.remarks,
        animal_code: schema.animalRegister.animal_code,
        ear_tag: schema.animalRegister.ear_tag,
        animal_type: schema.animalRegister.animal_type,
      })
      .from(schema.batchTransferLine)
      .leftJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.batchTransferLine.animal_id))
      .where(eq(schema.batchTransferLine.transfer_id, transferId))
      .orderBy(schema.batchTransferLine.line_no);

    return { ...transfer, lines };
  }

  async findAll(query: QueryBatchTransferDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.batchTransfer.tenant_id, tenantId), isNull(schema.batchTransfer.deleted_at)];
    if (query.company_id) conditions.push(eq(schema.batchTransfer.company_id, query.company_id));
    if (query.status) conditions.push(eq(schema.batchTransfer.status, query.status));
    if (query.from_date) conditions.push(gte(schema.batchTransfer.transfer_date, query.from_date));
    if (query.to_date) conditions.push(lte(schema.batchTransfer.transfer_date, query.to_date));
    if (query.batch_id) {
      conditions.push(
        or(eq(schema.batchTransfer.from_batch_id, query.batch_id), eq(schema.batchTransfer.to_batch_id, query.batch_id))!
      );
    }

    const fromBatch = schema.batchHeader;
    const rows = await this.db
      .select({
        transfer_id: schema.batchTransfer.transfer_id,
        transfer_no: schema.batchTransfer.transfer_no,
        transfer_date: schema.batchTransfer.transfer_date,
        transfer_type: schema.batchTransfer.transfer_type,
        head_count: schema.batchTransfer.head_count,
        transfer_value: schema.batchTransfer.transfer_value,
        reason: schema.batchTransfer.reason,
        remarks: schema.batchTransfer.remarks,
        status: schema.batchTransfer.status,
        posted_at: schema.batchTransfer.posted_at,
        company_id: schema.batchTransfer.company_id,
        from_batch_id: schema.batchTransfer.from_batch_id,
        to_batch_id: schema.batchTransfer.to_batch_id,
        from_batch_no: fromBatch.batch_no,
        from_operational_area_id: fromBatch.operational_area_id,
      })
      .from(schema.batchTransfer)
      .leftJoin(fromBatch, eq(fromBatch.batch_id, schema.batchTransfer.from_batch_id))
      .where(and(...conditions))
      .orderBy(desc(schema.batchTransfer.transfer_date), desc(schema.batchTransfer.created_at));

    // Destination batch numbers in one follow-up query — a second join on the
    // same table needs an alias, and this list is small enough that a lookup
    // map is clearer than aliasing.
    const toIds = [...new Set(rows.map((r) => r.to_batch_id))];
    const toBatches = toIds.length
      ? await this.db
          .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
          .from(schema.batchHeader)
          .where(inArray(schema.batchHeader.batch_id, toIds))
      : [];
    const toMap = new Map(toBatches.map((b) => [b.batch_id, b.batch_no]));

    const scoped = query.operational_area_id
      ? rows.filter((r) => r.from_operational_area_id === query.operational_area_id)
      : rows;

    return scoped.map((r) => ({ ...r, to_batch_no: toMap.get(r.to_batch_id) || null }));
  }
}

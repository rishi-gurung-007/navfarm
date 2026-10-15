import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import {
  eq,
  and,
  or,
  inArray,
  isNull,
  gte,
  lte,
  desc,
  sql,
  SQL,
} from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  CreateBatchTransferDto,
  QueryBatchTransferDto,
} from './dto/batch.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { farmScope } from '../../../common/farm-scope';
import { AnimalMovementLogService } from '../../piggery/animal-movement-log/animal-movement-log.service';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertStageFitsAnimal } from '../stage/stage-gender';

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
    private readonly movementLog: AnimalMovementLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb)
      throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * Tenants provisioned before this feature have no BATCH_TRANSFER series, and
   * generateNext() throws on a missing one. Rather than make every existing
   * tenant fail at the first transfer, fall back to a self-derived number.
   */
  private async generateTransferNo(
    tenantId: string,
    companyId: string,
  ): Promise<string> {
    try {
      return await this.numberSeriesService.generateNext(
        'BATCH_TRANSFER',
        tenantId,
        companyId,
      );
    } catch {
      const [{ n }] = await this.db
        .select({ n: sql<number>`COUNT(*)` })
        .from(schema.batchTransfer)
        .where(
          and(
            eq(schema.batchTransfer.tenant_id, tenantId),
            eq(schema.batchTransfer.company_id, companyId),
          ),
        );
      return `BTR-${new Date().getFullYear()}-${String(Number(n) + 1).padStart(4, '0')}`;
    }
  }

  private async loadBatch(batchId: string, tenantId: string, label: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(
        and(
          eq(schema.batchHeader.batch_id, batchId),
          eq(schema.batchHeader.tenant_id, tenantId),
          isNull(schema.batchHeader.deleted_at),
        ),
      )
      .limit(1);
    if (!batch) throw new NotFoundException(`${label} batch not found.`);

    const scope = farmScope(this.cls);
    if (
      (scope.companyId && batch.company_id !== scope.companyId) ||
      (scope.restricted && scope.lobId && batch.lob_id !== scope.lobId) ||
      (scope.farmId && batch.farm_id && batch.farm_id !== scope.farmId)
    ) {
      throw new ForbiddenException(`${label} batch is not authorized for you.`);
    }
    return batch;
  }

  /** Animals currently sitting in a batch and still alive — the transferable pool. */
  async listTransferableAnimals(batchId: string, tenantId: string) {
    return this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        rfid_tag: schema.animalRegister.rfid_tag,
        animal_type: schema.animalRegister.animal_type,
        gender: schema.animalRegister.gender,
        status: schema.animalRegister.status,
        current_location_id: schema.animalRegister.current_location_id,
        current_stage_id: schema.animalRegister.current_stage_id,
        book_value: schema.animalRegister.book_value,
        total_opening_asset_value:
          schema.animalRegister.total_opening_asset_value,
        acquisition_cost: schema.animalRegister.acquisition_cost,
      })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.tenant_id, tenantId),
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        ),
      )
      .orderBy(schema.animalRegister.animal_code);
  }

  async create(
    dto: CreateBatchTransferDto,
    tenantId: string,
    fromBatchId: string,
    userPayload?: { userId?: string },
    // Internal (reverse()): the stage each animal returns to. Never part of a request.
    options: { returnStages?: Record<string, string>; value?: number } = {},
  ) {
    const source = await this.loadBatch(fromBatchId, tenantId, 'Source');
    const destination = await this.loadBatch(
      dto.to_batch_id,
      tenantId,
      'Destination',
    );

    if (source.batch_id === destination.batch_id) {
      throw new BadRequestException(
        'Source and destination batch must be different.',
      );
    }
    if (source.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Only an ACTIVE batch can transfer animals out (source is ${source.status}).`,
      );
    }
    if (!['DRAFT', 'ACTIVE'].includes(destination.status)) {
      throw new BadRequestException(
        `Destination batch must be DRAFT or ACTIVE (it is ${destination.status}).`,
      );
    }
    if (source.company_id !== destination.company_id) {
      throw new BadRequestException(
        'Cross-company transfers are not supported — both batches must belong to the same company.',
      );
    }

    if (dto.quantity != null) {
      return this.createHeadcountTransfer(dto, source, destination, tenantId, userPayload, options.value);
    }

    if (dto.to_stage_id && dto.post_immediately === false) {
      throw new BadRequestException(
        'A destination stage is applied when the transfer posts, and a draft does not keep it. Post the transfer now or leave the stage out.',
      );
    }
    let namedStage: { stage_id: string; stage_name: string; applicable_gender: string | null } | undefined;
    if (dto.to_stage_id) {
      const [stage] = await this.db
        .select({
          stage_id: schema.stageMaster.stage_id,
          stage_name: schema.stageMaster.stage_name,
          applicable_gender: schema.stageMaster.applicable_gender,
        })
        .from(schema.stageMaster)
        .where(
          and(
            eq(schema.stageMaster.stage_id, dto.to_stage_id),
            eq(schema.stageMaster.lob_id, destination.lob_id),
            eq(schema.stageMaster.is_active, true),
            isNull(schema.stageMaster.deleted_at),
          ),
        )
        .limit(1);
      if (!stage) {
        throw new BadRequestException(
          'The destination stage is not a stage of the destination batch’s line of business.',
        );
      }
      namedStage = stage;
    }

    const transferType =
      dto.transfer_type || (dto.animal_ids?.length ? 'PARTIAL' : 'FULL_BATCH');
    const pool = await this.listTransferableAnimals(fromBatchId, tenantId);

    let selected = pool;
    if (transferType === 'PARTIAL') {
      if (!dto.animal_ids?.length) {
        throw new BadRequestException(
          'A PARTIAL transfer needs at least one animal selected.',
        );
      }
      const poolIds = new Set(pool.map((a) => a.animal_id));
      const invalid = dto.animal_ids.filter((id) => !poolIds.has(id));
      if (invalid.length) {
        throw new BadRequestException(
          `${invalid.length} selected animal(s) are not live members of the source batch and cannot be transferred.`,
        );
      }
      const chosen = new Set(dto.animal_ids);
      selected = pool.filter((a) => chosen.has(a.animal_id));
    }

    if (!selected.length) {
      throw new BadRequestException(
        source.tracking_mode === 'BATCH_WISE'
          ? 'This batch counts head rather than registered animals — enter how many head to move.'
          : 'The source batch has no live animals to transfer.',
      );
    }

    // Animals entering an animal-wise batch without a stage named keep the one they have, and that
    // stage must be one of the destination's line of business — otherwise a sow from another line
    // arrives carrying a stage the batch's schedulers and data entry know nothing about.
    if (destination.tracking_mode === 'ANIMAL_WISE' && !dto.to_stage_id) {
      const stageIds = [...new Set(selected.map((a) => a.current_stage_id).filter((id): id is string => !!id))];
      const stageRows = stageIds.length
        ? await this.db
            .select({ stage_id: schema.stageMaster.stage_id, lob_id: schema.stageMaster.lob_id })
            .from(schema.stageMaster)
            .where(inArray(schema.stageMaster.stage_id, stageIds))
        : [];
      const lobOfStage = new Map(stageRows.map((r) => [r.stage_id, r.lob_id]));
      const stray = selected.filter((a) => !a.current_stage_id || lobOfStage.get(a.current_stage_id) !== destination.lob_id);
      if (stray.length) {
        throw new BadRequestException(
          `${stray.map((a) => a.animal_code).join(', ')} ${stray.length === 1 ? 'has' : 'have'} no stage that belongs to ${destination.batch_no}'s line of business. Choose a destination stage.`,
        );
      }
    }

    // A stage set to one sex refuses the other, wherever the animals would land: the stage named
    // here, or the one-stage batch-wise destination's own.
    let landing = namedStage;
    if (!landing && destination.tracking_mode !== 'ANIMAL_WISE' && destination.stage_id) {
      [landing] = await this.db
        .select({
          stage_id: schema.stageMaster.stage_id,
          stage_name: schema.stageMaster.stage_name,
          applicable_gender: schema.stageMaster.applicable_gender,
        })
        .from(schema.stageMaster)
        .where(eq(schema.stageMaster.stage_id, destination.stage_id))
        .limit(1);
    }
    if (landing) {
      for (const animal of selected) assertStageFitsAnimal(landing, animal);
    }

    // Per-head carrying value: the animal's own book value when it has one,
    // otherwise the batch's carrying amount spread across its live head count.
    const [sourceState] = await this.db
      .select()
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, fromBatchId))
      .limit(1);
    const stateQty = Number(sourceState?.current_quantity) || 0;
    const perHeadFromState =
      sourceState && stateQty > 0
        ? Number(sourceState.nca_book_value) / stateQty
        : 0;

    const valueOf = (a: (typeof pool)[number]) =>
      Number(a.book_value) ||
      Number(a.total_opening_asset_value) ||
      Number(a.acquisition_cost) ||
      perHeadFromState ||
      0;

    const lines = selected.map((a, idx) => ({
      line_id: randomUUID(),
      transfer_id: '',
      line_no: idx + 1,
      animal_id: a.animal_id,
      from_location_id:
        a.current_location_id ||
        source.sub_location_id ||
        source.location_id ||
        null,
      to_location_id:
        dto.to_location_id ||
        destination.sub_location_id ||
        destination.location_id ||
        null,
      book_value: valueOf(a).toFixed(4),
      remarks: null as string | null,
    }));

    const transferId = randomUUID();
    lines.forEach((l) => (l.transfer_id = transferId));
    const totalValue = lines.reduce((sum, l) => sum + Number(l.book_value), 0);
    const transferNo = await this.generateTransferNo(
      tenantId,
      source.company_id,
    );

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
      newValues: {
        transfer_no: transferNo,
        from: source.batch_no,
        to: destination.batch_no,
        head_count: selected.length,
      },
    });

    if (dto.post_immediately !== false) {
      return this.post(
        transferId,
        tenantId,
        userPayload,
        dto.auto_triggers_stage,
        dto.skip_movement_log,
        dto.to_stage_id,
        options.returnStages,
      );
    }
    return this.findOne(transferId, tenantId);
  }

  /** Head on hand in a batch-wise batch: the bio-asset state's quantity, else the batch's own closing/opening figure. */
  private async headOnHand(batch: { batch_id: string; closing_quantity: string | null; opening_quantity: string | null }) {
    const [state] = await this.db
      .select()
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, batch.batch_id))
      .limit(1);
    const quantity = state
      ? Number(state.current_quantity) || 0
      : Number(batch.closing_quantity ?? batch.opening_quantity) || 0;
    const value = state ? Number(state.nca_book_value) || 0 : 0;
    return { quantity, value, perHead: quantity > 0 ? value / quantity : 0 };
  }

  /**
   * A head count moved between two batch-wise batches. They hold no animal rows, so there are no
   * transfer lines: the transfer itself carries the number of head and the value that goes with
   * them (the source's average carrying value per head). Bio-asset batches only — moving head
   * between cost-accumulated batches would also have to move their accumulated cost, which has not
   * been decided.
   */
  private async createHeadcountTransfer(
    dto: CreateBatchTransferDto,
    source: typeof schema.batchHeader.$inferSelect,
    destination: typeof schema.batchHeader.$inferSelect,
    tenantId: string,
    userPayload?: { userId?: string },
    // Internal (reverse()): the value the transfer it undoes moved — a reversal moves back exactly that.
    fixedValue?: number,
  ) {
    if (dto.animal_ids?.length) {
      throw new BadRequestException('Move registered animals or a head count, not both.');
    }
    const quantity = Number(dto.quantity);
    if (!(quantity > 0)) {
      throw new BadRequestException('Enter a head count greater than zero.');
    }
    if (source.tracking_mode !== 'BATCH_WISE' || destination.tracking_mode !== 'BATCH_WISE') {
      throw new BadRequestException(
        'A head count moves between batch-wise batches only. Registered animals move by animal.',
      );
    }
    if (source.costing_method !== 'BIO_ASSET' || destination.costing_method !== 'BIO_ASSET') {
      throw new BadRequestException(
        'Moving head between cost-accumulated batches also moves their accumulated cost, which has not been decided. Only bio-asset batches can transfer a head count.',
      );
    }
    if (dto.to_stage_id) {
      throw new BadRequestException('A head count joins the destination batch at its own stage.');
    }

    const onHand = await this.headOnHand(source);
    if (quantity > onHand.quantity + 1e-9) {
      throw new BadRequestException(
        `${source.batch_no} has ${onHand.quantity} head; ${quantity} cannot be moved.`,
      );
    }
    const value = fixedValue ?? Number((onHand.perHead * quantity).toFixed(4));

    const transferId = randomUUID();
    const transferNo = await this.generateTransferNo(tenantId, source.company_id);
    await this.db.insert(schema.batchTransfer).values({
      transfer_id: transferId,
      tenant_id: tenantId,
      company_id: source.company_id,
      transfer_no: transferNo,
      from_batch_id: source.batch_id,
      to_batch_id: destination.batch_id,
      transfer_date: dto.transfer_date,
      transfer_type: quantity >= onHand.quantity - 1e-9 ? 'FULL_BATCH' : 'PARTIAL',
      transfer_basis: 'HEADCOUNT',
      head_count: quantity.toFixed(4),
      transfer_value: value.toFixed(4),
      reason: dto.reason || null,
      remarks: dto.remarks || null,
      status: 'DRAFT',
      created_by: userPayload?.userId || null,
    });
    await this.auditService.log({
      tenantId,
      companyId: source.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_transfer',
      entityId: transferId,
      newValues: { transfer_no: transferNo, from: source.batch_no, to: destination.batch_no, head_count: quantity, basis: 'HEADCOUNT' },
    });

    if (dto.post_immediately !== false) {
      return this.post(transferId, tenantId, userPayload);
    }
    return this.findOne(transferId, tenantId);
  }

  private async postHeadcount(
    transfer: Awaited<ReturnType<BatchTransferService['findOne']>>,
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const quantity = Number(transfer.head_count);
    const value = Number(transfer.transfer_value);

    const [source] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, transfer.from_batch_id)).limit(1).for('update');
    const [destination] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, transfer.to_batch_id)).limit(1).for('update');
    // Re-checked under the lock: the head may have died or moved since the draft was made.
    const onHand = await this.headOnHand(source);
    if (quantity > onHand.quantity + 1e-9) {
      throw new BadRequestException(
        `${source.batch_no} now has ${onHand.quantity} head; this transfer of ${quantity} can no longer post.`,
      );
    }

    await this.shiftBioAssetState(transfer.from_batch_id, -quantity, -value);
    await this.shiftBioAssetState(transfer.to_batch_id, quantity, value);
    await this.shiftClosingQuantity(transfer.from_batch_id, -quantity);
    await this.shiftClosingQuantity(transfer.to_batch_id, quantity);

    // bio_asset_item_id is NOT NULL: the herd item is the batch's first input line.
    const lineOf = async (batchId: string) => {
      const [line] = await this.db.select({ item_id: schema.batchInputLine.item_id, lot_no: schema.batchInputLine.lot_no }).from(schema.batchInputLine).where(eq(schema.batchInputLine.batch_id, batchId)).limit(1);
      return line;
    };
    const itemOf = async (batchId: string) => (await lineOf(batchId))?.item_id;
    // The lot the head came in as (a farrowing's piglet lot) travels with them, so the ledger can still name it after
    // they are moved on.
    const sourceLine = await lineOf(transfer.from_batch_id);
    const lotNo = sourceLine?.lot_no || null;
    const sourceItem = sourceLine?.item_id;
    const destItem = (await itemOf(transfer.to_batch_id)) ?? sourceItem;
    const rows: (typeof schema.bioAssetLedger.$inferInsert)[] = [];
    if (sourceItem) {
      rows.push({
        entry_id: randomUUID(), tenant_id: tenantId, company_id: transfer.company_id, bio_asset_item_id: sourceItem,
        entry_type: 'TRANSFER_OUT', document_no: transfer.transfer_no, posting_date: transfer.transfer_date, lot_no: lotNo,
        batch_no: source.batch_no, batch_id: source.batch_id, stage: source.current_stage_code || null,
        quantity: (-quantity).toFixed(4), cost_amount: (-value).toFixed(4),
        cost_amount_each_unit: (quantity > 0 ? -value / quantity : 0).toFixed(4),
        nob_id: source.nob_id || null, lob_id: source.lob_id || null, created_by: userPayload?.userId || null,
      });
    }
    if (destItem) {
      rows.push({
        entry_id: randomUUID(), tenant_id: tenantId, company_id: transfer.company_id, bio_asset_item_id: destItem,
        entry_type: 'TRANSFER_IN', document_no: transfer.transfer_no, posting_date: transfer.transfer_date, lot_no: lotNo,
        batch_no: destination.batch_no, batch_id: destination.batch_id, stage: destination.current_stage_code || null,
        quantity: quantity.toFixed(4), cost_amount: value.toFixed(4),
        cost_amount_each_unit: (quantity > 0 ? value / quantity : 0).toFixed(4),
        nob_id: destination.nob_id || null, lob_id: destination.lob_id || null, created_by: userPayload?.userId || null,
      });
    }
    if (rows.length) await this.db.insert(schema.bioAssetLedger).values(rows);

    // A batch-wise batch's current-stage scheduler counts its head, which just changed.
    await this.syncBatchWiseCount(transfer.from_batch_id);
    await this.syncBatchWiseCount(transfer.to_batch_id);

    await this.db
      .update(schema.batchTransfer)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp(),
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchTransfer.transfer_id, transfer.transfer_id));

    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'batch_transfer',
      entityId: transfer.transfer_id,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'POSTED', head_count: quantity, transfer_value: value, basis: 'HEADCOUNT' },
    });
    return this.findOne(transfer.transfer_id, tenantId);
  }

  /** A batch-wise batch has one live stage; its scheduler's count is the batch's head on hand. */
  private async syncBatchWiseCount(batchId: string) {
    const [batch] = await this.db
      .select({
        stage_id: schema.batchHeader.stage_id,
        closing_quantity: schema.batchHeader.closing_quantity,
        opening_quantity: schema.batchHeader.opening_quantity,
      })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (!batch?.stage_id) return;
    await this.db
      .update(schema.schedulerHeader)
      .set({
        animal_count: String(Number(batch.closing_quantity ?? batch.opening_quantity) || 0),
        updated_at: toMysqlTimestamp(),
      })
      .where(
        and(
          eq(schema.schedulerHeader.batch_id, batchId),
          eq(schema.schedulerHeader.stage_id, batch.stage_id),
        ),
      );
  }

  /**
   * Applies the movement. Everything here is idempotent-guarded by the DRAFT
   * check, so a double-submit cannot move the same animals twice.
   */
  async post(
    transferId: string,
    tenantId: string,
    userPayload?: { userId?: string },
    autoTriggersStage?: boolean,
    skipMovementLog?: boolean,
    toStageId?: string,
    returnStages?: Record<string, string>,
  ) {
    // The animals' move, both batches' carrying value and head count, the ledger legs, the
    // movement log and the status all post together or not at all — they used to commit in
    // separate steps, so a failure part-way left animals moved with their value behind.
    // Joins the caller's transaction when one is open (a TRANSFER scheduler line posts from one).
    return withTenantTransaction(this.cls, () =>
      this.postInner(transferId, tenantId, userPayload, autoTriggersStage, skipMovementLog, toStageId, returnStages),
    );
  }

  private async postInner(
    transferId: string,
    tenantId: string,
    userPayload?: { userId?: string },
    autoTriggersStage?: boolean,
    skipMovementLog?: boolean,
    toStageId?: string,
    returnStages?: Record<string, string>,
  ) {
    const transfer = await this.findOne(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only a DRAFT transfer can be posted (this one is ${transfer.status}).`,
      );
    }

    if (transfer.transfer_basis === 'HEADCOUNT') {
      return this.postHeadcount(transfer, tenantId, userPayload);
    }

    const animalIds = transfer.lines.map((l) => l.animal_id);
    const headCount = animalIds.length;
    const totalValue = transfer.lines.reduce(
      (sum, l) => sum + Number(l.book_value),
      0,
    );
    const toLocationId = transfer.lines[0]?.to_location_id || null;

    // The destination batch's stage. Animals carry their own current_stage_id
    // (read by the herd and bio-asset-by-stage reports), so moving them into a
    // batch sitting at a different stage has to move their stage with them —
    // otherwise a pig transferred into farrowing still reports as gestating.
    const [destBatch] = await this.db
      .select({
        stage_id: schema.batchHeader.stage_id,
        tracking_mode: schema.batchHeader.tracking_mode,
      })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, transfer.to_batch_id))
      .limit(1);

    // An animal-wise batch has no single stage — each animal carries its own — so animals
    // entering one keep the stage they have unless the caller names one. Overwriting it with
    // the batch header's nominal stage turned a pregnant sow into a quarantine animal.
    // A batch-wise destination moves the animals to its one stage, as before.
    const targetStageId =
      toStageId ?? (destBatch?.tracking_mode === 'ANIMAL_WISE' ? null : destBatch?.stage_id ?? null);

    // Guard against the pool shifting between draft and post (an animal that
    // died, was sold, or was independently reassigned elsewhere in the
    // meantime) — also captures each animal's pre-transfer stage/location,
    // needed below to log an accurate "from" side since the repoint
    // overwrites these same columns. Locked (FOR UPDATE) and repointed inside
    // one transaction: two concurrent post()s racing over an overlapping
    // animal must not both see it as still-live and both repoint it — the
    // second one has to fail the headcount check against the first's
    // already-committed move, not silently overwrite it.
    const stillLive = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({
          animal_id: schema.animalRegister.animal_id,
          current_stage_id: schema.animalRegister.current_stage_id,
          current_location_id: schema.animalRegister.current_location_id,
        })
        .from(schema.animalRegister)
        .where(
          and(
            inArray(schema.animalRegister.animal_id, animalIds),
            eq(schema.animalRegister.current_batch_id, transfer.from_batch_id),
            eq(schema.animalRegister.is_active, true),
            sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
          ),
        )
        .for('update');
      if (locked.length !== headCount) {
        throw new BadRequestException(
          `${headCount - locked.length} animal(s) on this transfer are no longer live members of the source batch. Re-create the transfer.`,
        );
      }

      // 1. Repoint the animals. They stay ACTIVE and is_active — a transferred
      //    animal is still fully operable, just under a different batch.
      await tx
        .update(schema.animalRegister)
        .set({
          current_batch_id: transfer.to_batch_id,
          ...(toLocationId ? { current_location_id: toLocationId } : {}),
          ...(targetStageId ? { current_stage_id: targetStageId } : {}),
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp(),
        })
        .where(inArray(schema.animalRegister.animal_id, animalIds));
      // A reversal puts each animal back at the stage she left from — the transfer it undoes may have named another.
      for (const [animalId, stageId] of Object.entries(returnStages ?? {})) {
        if (!animalIds.includes(animalId)) continue;
        await tx
          .update(schema.animalRegister)
          .set({ current_stage_id: stageId })
          .where(eq(schema.animalRegister.animal_id, animalId));
      }

      return locked;
    });

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
      await this.schedulerHeaderService.createForStage(
        transfer.to_batch_id,
        destBatch.stage_id,
        tenantId,
        userPayload,
      );
    }

    // 1c. One animal_movement_log row per animal moved — this is the single
    // place a real batch-to-batch value transfer actually happens, so it's
    // also the single place that logs it, EXCEPT when the caller already
    // logged a more precise entry itself (AnimalService.transitionStage()
    // knows the exact destination stage it asked for, which can differ from
    // the destination batch's own nominal stage_id used here — logging both
    // would duplicate the same move under two different stage values).
    if (!skipMovementLog) {
      const stillLiveById = new Map(stillLive.map((a) => [a.animal_id, a]));
      for (const line of transfer.lines) {
        const pre = stillLiveById.get(line.animal_id);
        await this.movementLog.record({
          tenantId,
          companyId: transfer.company_id,
          animalId: line.animal_id,
          movementType: 'TRANSFER',
          eventDate: transfer.transfer_date,
          fromBatchId: transfer.from_batch_id,
          toBatchId: transfer.to_batch_id,
          fromStageId: pre?.current_stage_id || null,
          toStageId: returnStages?.[line.animal_id] ?? targetStageId ?? pre?.current_stage_id ?? null,
          fromLocationId: pre?.current_location_id || null,
          toLocationId: line.to_location_id || toLocationId,
          entryNo: transfer.transfer_no,
          reason: transfer.reason,
          remarks: transfer.remarks,
          userId: userPayload?.userId,
        });
      }
    }

    // 1d. Each animal-wise batch's schedulers count the live animals at their own stage; the
    // animals just moved out of one batch and into the other, so both recount.
    await this.schedulerHeaderService.syncAnimalWiseCounts(transfer.from_batch_id);
    await this.schedulerHeaderService.syncAnimalWiseCounts(transfer.to_batch_id);

    // 2. Move the carrying value and head count between the two batches' states.
    await this.shiftBioAssetState(
      transfer.from_batch_id,
      -headCount,
      -totalValue,
    );
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
      newValues: {
        status: 'POSTED',
        head_count: headCount,
        transfer_value: totalValue,
      },
    });

    return this.findOne(transferId, tenantId);
  }

  /** Adds (or subtracts) head count and carrying value on one batch's bio-asset state row. */
  private async shiftBioAssetState(
    batchId: string,
    qtyDelta: number,
    valueDelta: number,
  ) {
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
        current_quantity: Math.max(
          0,
          (Number(state.current_quantity) || 0) + qtyDelta,
        ).toFixed(4),
        nca_book_value: Math.max(
          0,
          (Number(state.nca_book_value) || 0) + valueDelta,
        ).toFixed(4),
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.batchBioAssetState.batch_id, batchId));
  }

  private async shiftClosingQuantity(batchId: string, delta: number) {
    const [batch] = await this.db
      .select({
        closing_quantity: schema.batchHeader.closing_quantity,
        opening_quantity: schema.batchHeader.opening_quantity,
      })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (!batch) return;
    const current =
      batch.closing_quantity !== null
        ? Number(batch.closing_quantity)
        : Number(batch.opening_quantity) || 0;
    await this.db
      .update(schema.batchHeader)
      .set({
        closing_quantity: Math.max(0, current + delta).toFixed(4),
        updated_at: toMysqlTimestamp(),
      })
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

    // bio_asset_item_id is NOT NULL. Each animal is posted under its own item (a batch can hold
    // sows and boars); the source batch's first input line, then any moved animal's item, are
    // the fallback for an animal whose row has none.
    const animalItems = await this.db
      .select({ animal_id: schema.animalRegister.animal_id, item_id: schema.animalRegister.item_id })
      .from(schema.animalRegister)
      .where(inArray(schema.animalRegister.animal_id, transfer.lines.map((l) => l.animal_id)));
    const itemByAnimal = new Map(animalItems.map((a) => [a.animal_id, a.item_id]));
    const [line] = await this.db
      .select({ item_id: schema.batchInputLine.item_id })
      .from(schema.batchInputLine)
      .where(eq(schema.batchInputLine.batch_id, transfer.from_batch_id))
      .limit(1);
    const fallbackItemId = line?.item_id ?? animalItems.find((a) => a.item_id)?.item_id;
    const itemFor = (animalId: string) => itemByAnimal.get(animalId) ?? fallbackItemId;
    if (!transfer.lines.some((l) => itemFor(l.animal_id))) return; // Nothing sane to post against — skip rather than crash the transfer.

    const rows = transfer.lines.filter((l) => itemFor(l.animal_id)).flatMap((l) => [
      {
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: transfer.company_id,
        bio_asset_item_id: itemFor(l.animal_id)!,
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
        bio_asset_item_id: itemFor(l.animal_id)!,
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

  /**
   * Undoes a posted transfer by moving the same animals (or the same head) straight back, as a
   * transfer of its own. Nothing posted is edited or deleted — the original stays on the record,
   * the reversal sits beside it with `REVERSAL OF <no>` as its reason, and both go through the
   * ordinary posting path, so value, counts, ledger legs and the animal's history all show the
   * move and the move back. Refused when the animals are no longer live in the batch they went to
   * (a death or a further transfer has overtaken the original), or the head is no longer there:
   * that needs its own correction, not an automatic one.
   */
  async reverse(
    transferId: string,
    dto: { transfer_date?: string; remarks?: string },
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    return withTenantTransaction(this.cls, async () => {
      const original = await this.findOne(transferId, tenantId);
      if (original.status !== 'POSTED') {
        throw new BadRequestException(
          `Only a POSTED transfer can be reversed (this one is ${original.status}). A draft is cancelled instead.`,
        );
      }
      if (original.reason?.startsWith('REVERSAL OF ')) {
        throw new BadRequestException('A reversal cannot itself be reversed. Make a new transfer instead.');
      }
      const [already] = await this.db
        .select({ transfer_no: schema.batchTransfer.transfer_no })
        .from(schema.batchTransfer)
        .where(
          and(
            eq(schema.batchTransfer.tenant_id, tenantId),
            eq(schema.batchTransfer.reason, `REVERSAL OF ${original.transfer_no}`),
            eq(schema.batchTransfer.status, 'POSTED'),
          ),
        )
        .limit(1);
      if (already) {
        throw new BadRequestException(`${original.transfer_no} was already reversed by ${already.transfer_no}.`);
      }

      const today = toMysqlTimestamp().slice(0, 10);
      const date = dto.transfer_date ?? today;
      if (date > today) throw new BadRequestException(`A reversal cannot be dated in the future (${date}).`);
      if (date < original.transfer_date) {
        throw new BadRequestException(`A reversal cannot be dated before the transfer it undoes (${original.transfer_date}).`);
      }

      // Where each animal stood before the transfer: it may have named a destination stage, and the reversal takes
      // her back to her own, not to that one.
      const returnStages: Record<string, string> = {};
      if (original.transfer_basis !== 'HEADCOUNT') {
        const left = await this.db
          .select({ animal_id: schema.animalMovementLog.animal_id, from_stage_id: schema.animalMovementLog.from_stage_id })
          .from(schema.animalMovementLog)
          .where(
            and(
              eq(schema.animalMovementLog.entry_no, original.transfer_no),
              eq(schema.animalMovementLog.movement_type, 'TRANSFER'),
              inArray(schema.animalMovementLog.animal_id, original.lines.map((l) => l.animal_id)),
            ),
          );
        for (const row of left) if (row.from_stage_id) returnStages[row.animal_id] = row.from_stage_id;
      }

      return this.create(
        {
          company_id: original.company_id,
          to_batch_id: original.from_batch_id,
          transfer_date: date,
          transfer_type: 'PARTIAL',
          ...(original.transfer_basis === 'HEADCOUNT'
            ? { quantity: Number(original.head_count) }
            : { animal_ids: original.lines.map((l) => l.animal_id) }),
          reason: `REVERSAL OF ${original.transfer_no}`,
          remarks: dto.remarks || `Reverses ${original.transfer_no}.`,
        } as CreateBatchTransferDto,
        tenantId,
        original.to_batch_id,
        userPayload,
        { returnStages, ...(original.transfer_basis === 'HEADCOUNT' ? { value: Number(original.transfer_value) } : {}) },
      );
    });
  }

  async cancel(
    transferId: string,
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    const transfer = await this.findOne(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only a DRAFT transfer can be cancelled. A posted transfer must be reversed by a new transfer in the opposite direction.',
      );
    }
    await this.db
      .update(schema.batchTransfer)
      .set({
        status: 'CANCELLED',
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
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
      .where(
        and(
          eq(schema.batchTransfer.transfer_id, transferId),
          eq(schema.batchTransfer.tenant_id, tenantId),
          isNull(schema.batchTransfer.deleted_at),
        ),
      )
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
        rfid_tag: schema.animalRegister.rfid_tag,
        animal_type: schema.animalRegister.animal_type,
      })
      .from(schema.batchTransferLine)
      .leftJoin(
        schema.animalRegister,
        eq(schema.animalRegister.animal_id, schema.batchTransferLine.animal_id),
      )
      .where(eq(schema.batchTransferLine.transfer_id, transferId))
      .orderBy(schema.batchTransferLine.line_no);

    return { ...transfer, lines };
  }

  async findAll(query: QueryBatchTransferDto, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [
      eq(schema.batchTransfer.tenant_id, tenantId),
      isNull(schema.batchTransfer.deleted_at),
    ];
    if (scope.companyId)
      conditions.push(eq(schema.batchTransfer.company_id, scope.companyId));
    if (scope.farmId) {
      conditions.push(
        or(
          sql`${schema.batchTransfer.from_batch_id} IN (SELECT batch_id FROM batch_header WHERE farm_id = ${scope.farmId})`,
          sql`${schema.batchTransfer.to_batch_id} IN (SELECT batch_id FROM batch_header WHERE farm_id = ${scope.farmId})`,
        )!,
      );
    }
    if (query.company_id)
      conditions.push(eq(schema.batchTransfer.company_id, query.company_id));
    if (query.status)
      conditions.push(eq(schema.batchTransfer.status, query.status));
    if (query.from_date)
      conditions.push(gte(schema.batchTransfer.transfer_date, query.from_date));
    if (query.to_date)
      conditions.push(lte(schema.batchTransfer.transfer_date, query.to_date));
    if (query.batch_id) {
      conditions.push(
        or(
          eq(schema.batchTransfer.from_batch_id, query.batch_id),
          eq(schema.batchTransfer.to_batch_id, query.batch_id),
        )!,
      );
    }

    const fromBatch = schema.batchHeader;
    const rows = await this.db
      .select({
        transfer_id: schema.batchTransfer.transfer_id,
        transfer_no: schema.batchTransfer.transfer_no,
        transfer_date: schema.batchTransfer.transfer_date,
        transfer_type: schema.batchTransfer.transfer_type,
        // A head count, or registered animals — the list says which ("Head count", not "Selected animals").
        transfer_basis: schema.batchTransfer.transfer_basis,
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
      .leftJoin(
        fromBatch,
        eq(fromBatch.batch_id, schema.batchTransfer.from_batch_id),
      )
      .where(and(...conditions))
      .orderBy(
        desc(schema.batchTransfer.transfer_date),
        desc(schema.batchTransfer.created_at),
      );

    // Destination batch numbers in one follow-up query — a second join on the
    // same table needs an alias, and this list is small enough that a lookup
    // map is clearer than aliasing.
    const toIds = [...new Set(rows.map((r) => r.to_batch_id))];
    const toBatches = toIds.length
      ? await this.db
          .select({
            batch_id: schema.batchHeader.batch_id,
            batch_no: schema.batchHeader.batch_no,
          })
          .from(schema.batchHeader)
          .where(inArray(schema.batchHeader.batch_id, toIds))
      : [];
    const toMap = new Map(toBatches.map((b) => [b.batch_id, b.batch_no]));

    const scoped = query.operational_area_id
      ? rows.filter(
          (r) => r.from_operational_area_id === query.operational_area_id,
        )
      : rows;

    return scoped.map((r) => ({
      ...r,
      to_batch_no: toMap.get(r.to_batch_id) || null,
    }));
  }
}

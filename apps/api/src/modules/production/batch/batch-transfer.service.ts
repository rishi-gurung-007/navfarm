import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, inArray, isNull, gte, lte, desc, sql, like, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchTransferDto, MergeBatchDto, QueryBatchTransferDto, SplitBatchDto } from './dto/batch.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import {
  assertLocationOnActiveFarm,
  batchOnFarm,
  batchReferenceScopeConditions,
  batchScopeConditions,
  farmScope,
  restrictedScopeConditions,
  type FarmScope,
} from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';

type BatchRow = typeof schema.batchHeader.$inferSelect;

/** The request user as the transfer rules read it. `userType` is unknown so any controller/service user shape fits. */
export interface TransferActor {
  userId?: string;
  userType?: unknown;
}

export const WORKER_TRANSFER_REFUSAL = 'Transfers by farm workers need approval, which is not available yet.';
export const FARM_TO_FARM_TRANSFER_REFUSAL = 'Farm-to-farm transfers are unavailable until destination Breed-profile matching is implemented.';

function transferActorType(actor: TransferActor | undefined, scope: FarmScope): string | null {
  const userType = actor?.userType;
  if (typeof userType === 'string') return userType;
  // A restricted scope with no user type is a caller that dropped req.user on
  // the way here. Treat it as the least-privileged type so the rule fails closed.
  return scope.restricted ? 'STANDARD_USER' : null;
}

/**
 * Transfer authorization, decided once and read the same way on create and
 * post. A standard user (a farm worker) never posts directly: their transfer
 * lands as a DRAFT and a PENDING approval request that a top-level user
 * decides from the Approvals screen — approval posts it. Every other role is
 * trusted and posts immediately; the UI shows them a warning to confirm, the
 * API enforces nothing extra for them.
 */
export function transferActorApprovalMode(actor: TransferActor | undefined, scope: FarmScope): 'APPROVAL' | 'DIRECT' {
  return transferActorType(actor, scope) === 'STANDARD_USER' ? 'APPROVAL' : 'DIRECT';
}

/**
 * Cross-farm movement must remap the animal to the matching Breed profile on
 * the destination farm and preserve both profile references in history. Until
 * that decided workflow exists, fail closed for every role instead of leaving
 * an animal attached to its source-farm Breed after it moves.
 */
function assertFarmToFarmAllowed(actor: TransferActor | undefined, scope: FarmScope, source: BatchRow, destination: BatchRow): void {
  // The farm-to-farm refusal stands for every role; the destination's Breed
  // profile must be remappable before any animal crosses a farm.
  if (source.farm_id !== destination.farm_id) {
    throw new ForbiddenException(FARM_TO_FARM_TRANSFER_REFUSAL);
  }
}

export const COUNT_ONLY_DESTINATION_REFUSAL = 'A Count Only batch has no individual animals.';
export const DESTINATION_BREED_REFUSAL = 'The destination batch is for a different breed.';

/**
 * Every transfer here repoints animal_register rows, and a Count Only batch
 * never holds Animal rows (animal create refuses the same placement). Checked
 * as REGISTERED rather than "not COUNT_ONLY" so an unexpected tracking value
 * fails closed.
 */
function assertDestinationTracksAnimals(destination: BatchRow): void {
  if (destination.animal_tracking !== 'REGISTERED') {
    throw new BadRequestException(COUNT_ONLY_DESTINATION_REFUSAL);
  }
}

/**
 * Moving an animal never changes its breed, so a destination batch with a
 * breed must match every animal moved into it. Same-farm only: cross-farm is
 * refused above until breed-profile remapping exists.
 */
function assertDestinationBreedMatches(destination: BatchRow, animals: Array<{ breed_id: string | null }>): void {
  if (!destination.breed_id) return;
  if (animals.some((a) => a.breed_id !== destination.breed_id)) {
    throw new BadRequestException(DESTINATION_BREED_REFUSAL);
  }
}

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

  /** Scoped, so a farm-scoped user cannot act across farms by naming another farm's batch id. */
  private async loadBatch(batchId: string, tenantId: string, label: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, batchId),
        eq(schema.batchHeader.tenant_id, tenantId),
        isNull(schema.batchHeader.deleted_at),
        ...batchScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!batch) throw new NotFoundException(`${label} batch not found.`);
    return batch;
  }

  /**
   * The destination may be on another farm of the same company, so it is not
   * farm-scoped (the farm-to-farm rule decides that). Outside the source's
   * company or LOB it answers exactly like a batch that does not exist: the
   * old "Cross-company…" 400 confirmed another company's batch id was real.
   */
  private async loadDestinationBatch(batchId: string, source: BatchRow, tenantId: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, batchId),
        eq(schema.batchHeader.tenant_id, tenantId),
        isNull(schema.batchHeader.deleted_at),
        eq(schema.batchHeader.company_id, source.company_id),
        eq(schema.batchHeader.lob_id, source.lob_id),
      ))
      .limit(1);
    if (!batch) throw new NotFoundException('Destination batch not found.');
    return batch;
  }

  /**
   * The row every mutation authorizes through, locked. findOne() shows a
   * transfer to either farm it touches, but changing it is the source farm's
   * call: reaching it through to_batch_id let a destination-farm worker post or
   * cancel the source farm's draft and debit its batch. So farm, LOB and company
   * sit on from_batch_id only.
   */
  private async loadTransferForMutation(transferId: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const [transfer] = await this.db
      .select()
      .from(schema.batchTransfer)
      .where(and(
        eq(schema.batchTransfer.transfer_id, transferId),
        eq(schema.batchTransfer.tenant_id, tenantId),
        isNull(schema.batchTransfer.deleted_at),
        ...batchReferenceScopeConditions(scope, schema.batchTransfer.from_batch_id),
        ...restrictedScopeConditions(scope, { companyId: schema.batchTransfer.company_id }),
      ))
      .for('update');
    if (!transfer) throw new NotFoundException('Transfer not found.');
    const lines = await this.loadLines(transferId);
    return { ...transfer, lines };
  }

  /**
   * Locks both batch rows — the same rows addTransaction() locks — so a
   * consumption posting at the same moment cannot lose this change to their
   * counts and carrying value. Always lowest batch_id first, so two transfers
   * crossing the same pair in opposite directions cannot deadlock.
   */
  private async lockTransferBatches(
    transfer: { from_batch_id: string; to_batch_id: string; company_id: string },
    tenantId: string,
  ): Promise<{ source: BatchRow; destination: BatchRow }> {
    const lockSource = async () => (await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, transfer.from_batch_id),
        eq(schema.batchHeader.tenant_id, tenantId),
        isNull(schema.batchHeader.deleted_at),
        ...batchScopeConditions(farmScope(this.cls)),
      ))
      .for('update'))[0];
    const lockDestination = async () => (await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, transfer.to_batch_id),
        eq(schema.batchHeader.tenant_id, tenantId),
        eq(schema.batchHeader.company_id, transfer.company_id),
        isNull(schema.batchHeader.deleted_at),
      ))
      .for('update'))[0];

    let source: BatchRow | undefined;
    let destination: BatchRow | undefined;
    if (transfer.from_batch_id < transfer.to_batch_id) {
      source = await lockSource();
      destination = await lockDestination();
    } else {
      destination = await lockDestination();
      source = await lockSource();
    }
    if (!source) throw new NotFoundException('Source batch not found.');
    if (!destination || destination.lob_id !== source.lob_id) throw new NotFoundException('Destination batch not found.');
    return { source, destination };
  }

  /** Animals currently sitting in a batch and still alive — the transferable pool. */
  async listTransferableAnimals(batchId: string, tenantId: string) {
    await this.loadBatch(batchId, tenantId, 'Source');
    return this.listTransferableAnimalsFromAuthorizedBatch(batchId, tenantId);
  }

  private async listTransferableAnimalsFromAuthorizedBatch(batchId: string, tenantId: string) {
    return this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        ear_tag: schema.animalRegister.ear_tag,
        animal_type: schema.animalRegister.animal_type,
        gender: schema.animalRegister.gender,
        breed_id: schema.animalRegister.breed_id,
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

  /**
   * A split persists its child directly, before create() can validate the
   * transfer destination. Validate the explicitly requested child location
   * here so an out-of-scope pen cannot be written into the new batch first.
   */
  private async assertSplitDestinationLocation(
    locationId: string,
    parent: BatchRow,
    tenantId: string,
  ): Promise<void> {
    if (!parent.farm_id) {
      throw new BadRequestException('Source batch has no farm, so a split destination cannot be validated.');
    }
    const [location] = await this.db
      .select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, locationId),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, parent.company_id),
        eq(schema.locationMaster.lob_id, parent.lob_id),
        eq(schema.locationMaster.is_active, true),
        eq(schema.locationMaster.location_type, 'PEN'),
        isNull(schema.locationMaster.deleted_at),
        or(
          eq(schema.locationMaster.location_id, parent.farm_id),
          eq(schema.locationMaster.farm_id, parent.farm_id),
        ),
        sql`EXISTS (
          SELECT 1 FROM location_master active_farm
          WHERE active_farm.location_id = ${parent.farm_id}
            AND active_farm.parent_location_id IS NULL
            AND active_farm.tenant_id = ${tenantId}
            AND active_farm.company_id = ${parent.company_id}
            AND active_farm.is_active = TRUE
            AND active_farm.deleted_at IS NULL
        )`,
      ))
      .limit(1);
    if (!location) {
      throw new ForbiddenException('Destination location must be an active Pen on your farm.');
    }
  }

  /** Registered animals have a physical pen placement; a farm, shed or store is not a valid destination. */
  private async assertDestinationPen(locationId: string | null, destination: BatchRow, tenantId: string): Promise<void> {
    if (!locationId || !destination.farm_id) {
      throw new BadRequestException('A destination Pen is required when moving registered animals.');
    }
    const [pen] = await this.db
      .select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, locationId),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, destination.company_id),
        eq(schema.locationMaster.lob_id, destination.lob_id),
        eq(schema.locationMaster.farm_id, destination.farm_id),
        eq(schema.locationMaster.location_type, 'PEN'),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      ))
      .limit(1);
    if (!pen) throw new BadRequestException('Animals can only be transferred to an active Pen.');
  }

  /**
   * Internal call flags. `autoTriggersStage` is set only by the TRANSFER
   * scheduler line (it generates the destination's scheduler unscoped);
   * `viaApproval` is set only by ApprovalService when a decision posts the
   * gated transfer — the one path a farm worker's transfer is allowed to
   * move animals. Neither is on the HTTP DTO.
   */
  async create(
    dto: CreateBatchTransferDto,
    tenantId: string,
    fromBatchId: string,
    userPayload?: TransferActor,
    options: { autoTriggersStage?: boolean } = {},
  ) {
    const mode = transferActorApprovalMode(userPayload, farmScope(this.cls));
    // One transaction with the post below, so a refused post leaves no DRAFT
    // header and lines behind from an autocommitted insert.
    return withTenantTransaction(this.cls, async () => {
    const source = await this.loadBatch(fromBatchId, tenantId, 'Source');
    const destination = await this.loadDestinationBatch(dto.to_batch_id, source, tenantId);

    if (source.batch_id === destination.batch_id) {
      throw new BadRequestException('Source and destination batch must be different.');
    }
    assertFarmToFarmAllowed(userPayload, farmScope(this.cls), source, destination);
    if (source.status !== 'ACTIVE') {
      throw new BadRequestException(`Only an ACTIVE batch can transfer animals out (source is ${source.status}).`);
    }
    if (!['DRAFT', 'ACTIVE'].includes(destination.status)) {
      throw new BadRequestException(`Destination batch must be DRAFT or ACTIVE (it is ${destination.status}).`);
    }
    assertDestinationTracksAnimals(destination);
    if (dto.to_location_id) {
      await assertLocationOnActiveFarm(this.db, {
        farmId: destination.farm_id,
        restricted: true,
        companyId: destination.company_id,
        lobId: destination.lob_id,
      }, dto.to_location_id, 'Destination location');
    }
    const destinationLocationId = dto.to_location_id || destination.sub_location_id || destination.location_id || null;
    await this.assertDestinationPen(destinationLocationId, destination, tenantId);

    const transferType = dto.transfer_type || (dto.animal_ids?.length ? 'PARTIAL' : 'FULL_BATCH');
    const pool = await this.listTransferableAnimalsFromAuthorizedBatch(fromBatchId, tenantId);

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
    assertDestinationBreedMatches(destination, selected);

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
      to_location_id: destinationLocationId,
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

    if (dto.post_immediately !== false && mode === 'DIRECT') {
      return this.post(transferId, tenantId, userPayload, { autoTriggersStage: options.autoTriggersStage });
    }
    // A worker's transfer stops here: DRAFT, with a PENDING approval riding on
    // it (below). The UI reads the two back together; an approver's decision
    // posts the movement through the same post() path a direct post uses.
    if (mode === 'APPROVAL') {
      await this.raiseTransferApproval(transferId, source, destination, transferNo, selected.length, userPayload, dto.reason, tenantId);
    }
    return this.findOne(transferId, tenantId);
    });
  }

  /**
   * The PENDING approval a standard user's transfer waits on. Raised inside
   * the caller's transaction so a refused transfer never leaves an approval
   * pointing at a transfer that does not exist — and a transfer never exists
   * without its approval. Written directly, not through ApprovalService: the
   * module graph runs Approval → Batch, and a back-import would be a cycle.
   * The doc-number scheme mirrors ApprovalService.generateDocNo.
   */
  private async raiseTransferApproval(
    transferId: string,
    source: BatchRow,
    destination: BatchRow,
    transferNo: string,
    headCount: number,
    userPayload?: TransferActor,
    reason?: string | null,
    tenantId?: string,
  ): Promise<void> {
    const tenant = tenantId!;
    const year = new Date().getFullYear();
    const [{ n }] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.approvalRequest)
      .where(
        and(
          eq(schema.approvalRequest.tenant_id, tenant),
          eq(schema.approvalRequest.company_id, source.company_id),
          eq(schema.approvalRequest.doc_type, 'BATCH_TRANSFER'),
          like(schema.approvalRequest.doc_no, `TRF-REQ-${year}-%`),
        )
      );
    const docNo = `TRF-REQ-${year}-${String(Number(n) + 1).padStart(4, '0')}`;

    await this.db.insert(schema.approvalRequest).values({
      tenant_id: tenant,
      company_id: source.company_id,
      doc_type: 'BATCH_TRANSFER',
      doc_no: docNo,
      title: `Transfer ${headCount} animal${headCount === 1 ? '' : 's'} to ${destination.batch_no}`,
      requested_by: userPayload?.userId || null,
      requestor_label: (userPayload as any)?.fullName || (userPayload as any)?.email || null,
      requestor_role: ((userPayload as any)?.userType || '').replace(/_/g, ' ') || null,
      location_label: `${source.batch_no} → ${destination.batch_no}`,
      batch_id: source.batch_id,
      reference_id: transferId,
      item_or_stage: transferNo,
      requested_qty: String(headCount),
      justification: reason || null,
      status: 'PENDING',
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId: tenant,
      companyId: source.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'approval_request',
      entityId: transferId,
      newValues: { doc_no: docNo, doc_type: 'BATCH_TRANSFER', transfer_no: transferNo, head_count: headCount },
    });
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
    userPayload?: TransferActor,
  ) {
    // Split/merge are composite flows: the child closes and the movement posts
    // in one breath, so a gated (approval-pending) movement would leave them
    // half-applied. Workers raise plain transfers for approval instead.
    if (transferActorApprovalMode(userPayload, farmScope(this.cls)) === 'APPROVAL') {
      throw new ForbiddenException(WORKER_TRANSFER_REFUSAL);
    }
    // Atomic: the child batch, the animal movement and the child's scheduler
    // commit together. Before, the child was autocommitted and a later refusal
    // left it behind with the animals already moved.
    return withTenantTransaction(this.cls, async () => {
    const parent = await this.loadBatch(parentBatchId, tenantId, 'Source');

    const animalIds = dto.animal_ids ?? [];
    if (animalIds.length === 0) {
      throw new BadRequestException('Select at least one animal to split out of the batch.');
    }
    if (parent.status !== 'ACTIVE') {
      throw new BadRequestException(`Only an ACTIVE batch can be split (this one is ${parent.status}).`);
    }
    if (dto.to_location_id) {
      await this.assertSplitDestinationLocation(dto.to_location_id, parent, tenantId);
      if (dto.to_location_id !== parent.location_id && dto.to_location_id !== parent.sub_location_id) {
        throw new BadRequestException('A split keeps the parent Batch location. Use the Transfer workflow to move animals to another location.');
      }
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
      // The group stays on the parent's farm. A farm-less child was invisible to
      // every farm-scoped user, including the one who split it, and unmergeable.
      farm_id: parent.farm_id,
      animal_tracking: parent.animal_tracking,
      nob_id: parent.nob_id,
      lob_id: parent.lob_id,
      breed_id: parent.breed_id,
      costing_method: parent.costing_method,
      operational_area_id: parent.operational_area_id,
      shed_id: parent.shed_id,
      location_id: parent.location_id,
      sub_location_id: parent.sub_location_id,
      current_stage_code: holdStageCode,
      stage_id: holdStageId,
      parent_batch_id: parentBatchId,
      start_date: dto.transfer_date,
      expected_end_date: parent.expected_end_date,
      // The child's starting headcount, which unit-cost and variance read. Live
      // headcount (closing and bio state below) starts at zero because the
      // transfer posted next adds the animals; seeding it at n counted them twice.
      opening_quantity: animalIds.length.toFixed(4),
      closing_quantity: '0.0000',
      uom: parent.uom,
      status: 'ACTIVE',
      remarks: dto.remarks || `Split from ${parent.batch_no}${dto.reason ? ` — ${dto.reason}` : ''}.`,
      created_by: userPayload?.userId || null,
    });

    await this.db.insert(schema.batchBioAssetState).values({
      state_id: randomUUID(),
      batch_id: childBatchId,
      stage: 'MATURE',
      current_quantity: '0.0000',
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
    // same auto-generated scheduler_header a transferStage() call would. The
    // authorized-row path: the parent was scope-checked above and the child is
    // its copy, so re-scoping it here could only fail after the animals moved.
    if (holdStageId) {
      const [child] = await this.db
        .select()
        .from(schema.batchHeader)
        .where(eq(schema.batchHeader.batch_id, childBatchId))
        .limit(1);
      await this.schedulerHeaderService.createForAuthorizedBatchStage(child, holdStageId, tenantId, userPayload);
    }

    return {
      child: { batch_id: childBatchId, batch_no: childBatchNo, parent_batch_id: parentBatchId, current_stage_code: holdStageCode },
      transfer,
    };
    });
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
    userPayload?: TransferActor,
  ) {
    // Same composite-flow refusal as split: merge closes the child the moment
    // the movement posts, so the movement cannot sit pending approval.
    if (transferActorApprovalMode(userPayload, farmScope(this.cls)) === 'APPROVAL') {
      throw new ForbiddenException(WORKER_TRANSFER_REFUSAL);
    }
    // Atomic with the movement: a closed child with its animals still in it, or
    // moved animals under a child still open, were both possible before.
    return withTenantTransaction(this.cls, async () => {
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
    });
  }

  /**
   * Applies the movement. The transfer row is locked before its DRAFT check and
   * DRAFT -> POSTED is claimed conditionally before any side effect, so a
   * double-submit waits for the first post, then is refused — it cannot move
   * the same animals, value or ledger legs twice.
   */
  async post(transferId: string, tenantId: string, userPayload?: TransferActor, flags: { autoTriggersStage?: boolean; viaApproval?: boolean } = {}) {
    // A worker's post() call is always direct — their transfers go through the
    // approval's post, which carries viaApproval. A worker who has somehow
    // obtained the transfer id still cannot move the animals themselves.
    if (!flags.viaApproval) {
      if (transferActorApprovalMode(userPayload, farmScope(this.cls)) === 'APPROVAL') {
        throw new ForbiddenException(WORKER_TRANSFER_REFUSAL);
      }
    }
    return withTenantTransaction(this.cls, async () => {
    const transfer = await this.loadTransferForMutation(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(`Only a DRAFT transfer can be posted (this one is ${transfer.status}).`);
    }
    const { source, destination: destBatch } = await this.lockTransferBatches(transfer, tenantId);
    if (!flags.viaApproval) {
      assertFarmToFarmAllowed(userPayload, farmScope(this.cls), source, destBatch);
    }
    // Re-read on the locked row: the destination's tracking or breed may have
    // been changed since the draft was created.
    assertDestinationTracksAnimals(destBatch);

    const animalIds = transfer.lines.map((l) => l.animal_id);
    const headCount = animalIds.length;
    const totalValue = transfer.lines.reduce((sum, l) => sum + Number(l.book_value), 0);
    const toLocationId = transfer.lines[0]?.to_location_id || null;
    await this.assertDestinationPen(toLocationId, destBatch, tenantId);

    // Guard against the pool shifting between draft and post (an animal that
    // died or was sold in the meantime).
    const stillLive = await this.db
      .select({ animal_id: schema.animalRegister.animal_id, breed_id: schema.animalRegister.breed_id })
      .from(schema.animalRegister)
      .where(
        and(
          inArray(schema.animalRegister.animal_id, animalIds),
          eq(schema.animalRegister.current_batch_id, transfer.from_batch_id),
          eq(schema.animalRegister.is_active, true),
          sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
        )
      )
      .for('update');
    if (stillLive.length !== headCount) {
      throw new BadRequestException(
        `${headCount - stillLive.length} animal(s) on this transfer are no longer live members of the source batch. Re-create the transfer.`
      );
    }
    assertDestinationBreedMatches(destBatch, stillLive);

    const [claim] = await this.db
      .update(schema.batchTransfer)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp(),
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(and(eq(schema.batchTransfer.transfer_id, transferId), eq(schema.batchTransfer.status, 'DRAFT')));
    if (!claim || claim.affectedRows === 0) {
      throw new ConflictException('This transfer was already posted or cancelled by another request.');
    }

    // 1. Repoint the animals. They stay ACTIVE and is_active — a transferred
    //    animal is still fully operable, just under a different batch. Their
    //    current_stage_id follows the destination batch's stage (read by the
    //    herd and bio-asset-by-stage reports), otherwise a pig transferred into
    //    farrowing still reports as gestating.
    const [animalClaim] = await this.db
      .update(schema.animalRegister)
      .set({
        current_batch_id: transfer.to_batch_id,
        ...(toLocationId ? { current_location_id: toLocationId } : {}),
        ...(destBatch?.stage_id ? { current_stage_id: destBatch.stage_id } : {}),
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(and(
        eq(schema.animalRegister.tenant_id, tenantId),
        inArray(schema.animalRegister.animal_id, animalIds),
        eq(schema.animalRegister.current_batch_id, transfer.from_batch_id),
        eq(schema.animalRegister.is_active, true),
        sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
      ));
    if (!animalClaim || animalClaim.affectedRows !== headCount) {
      throw new ConflictException(
        'One or more animals were moved or became unavailable while this transfer was posting. Re-create the transfer.',
      );
    }

    // 1b. "Destination stage auto-triggered if auto_triggers_stage = TRUE"
    // (Schedule_master_template.xlsx) — the TRANSFER scheduler_line that
    // generated this transfer can ask for the destination batch's current
    // stage to get (or reuse) its own scheduler_header right away, rather
    // than waiting on a separate transferStage() call. createForStage() is
    // idempotent on (batch_id, stage_id), so this is safe to call even if a
    // header already exists. Runs after the repoint above so the live
    // animal_register count createForStage() reads already includes these
    // animals.
    if (flags.autoTriggersStage && destBatch?.stage_id) {
      await this.schedulerHeaderService.createForAuthorizedBatchStage(destBatch, destBatch.stage_id, tenantId, userPayload);
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
    await this.writeLedgerLegs(transfer, tenantId, source, destBatch, userPayload?.userId);

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
    });
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
    source: BatchRow,
    destination: BatchRow,
    userId?: string,
  ) {
    if (!transfer.lines.length) {
      throw new BadRequestException('Transfer accounting cannot be posted without transfer lines.');
    }

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
    if (!itemId) {
      throw new BadRequestException(
        'Transfer accounting item is missing from the source batch and animal. Configure it before posting.',
      );
    }

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

    const [inserted] = await this.db.insert(schema.bioAssetLedger).values(rows);
    if (!inserted || inserted.affectedRows !== rows.length) {
      throw new ConflictException('Transfer accounting ledger legs could not all be posted. No transfer was applied.');
    }
  }

  async cancel(transferId: string, tenantId: string, userPayload?: TransferActor) {
    return withTenantTransaction(this.cls, async () => {
    // Source-side and locked, like post(): a cancel racing a post must not
    // flip a transfer the other request has just posted back to CANCELLED.
    const transfer = await this.loadTransferForMutation(transferId, tenantId);
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException('Only a DRAFT transfer can be cancelled. A posted transfer must be reversed by a new transfer in the opposite direction.');
    }
    await this.db
      .update(schema.batchTransfer)
      .set({ status: 'CANCELLED', updated_by: userPayload?.userId || null, updated_at: toMysqlTimestamp() })
      .where(and(eq(schema.batchTransfer.transfer_id, transferId), eq(schema.batchTransfer.status, 'DRAFT')));
    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'CANCEL',
      entityName: 'batch_transfer',
      entityId: transferId,
    });
    return this.findOne(transferId, tenantId);
    });
  }

  private async loadLines(transferId: string) {
    return this.db
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
  }

  /** Visibility only — a mutation authorizes through loadTransferForMutation(). */
  async findOne(transferId: string, tenantId: string) {
    // A transfer touches two batches, possibly on two different farms — it is
    // visible from either side, not only the one the caller's farm is on.
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [
      eq(schema.batchTransfer.transfer_id, transferId),
      eq(schema.batchTransfer.tenant_id, tenantId),
      isNull(schema.batchTransfer.deleted_at),
    ];
    if (scope.farmId) {
      conditions.push(or(
        batchOnFarm(schema.batchTransfer.from_batch_id, scope.farmId),
        batchOnFarm(schema.batchTransfer.to_batch_id, scope.farmId),
      )!);
    }
    // An operational admin who sent no x-active-farm-id has farmId null, so the
    // farm condition above adds nothing; the company bound still applies.
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.batchTransfer.company_id }));
    if (scope.restricted && scope.lobId) conditions.push(or(
      sql`${schema.batchTransfer.from_batch_id} IN (SELECT btl.batch_id FROM batch_header btl WHERE btl.lob_id = ${scope.lobId})`,
      sql`${schema.batchTransfer.to_batch_id} IN (SELECT btl.batch_id FROM batch_header btl WHERE btl.lob_id = ${scope.lobId})`,
    )!);

    const [transfer] = await this.db
      .select()
      .from(schema.batchTransfer)
      .where(and(...conditions))
      .limit(1);
    if (!transfer) throw new NotFoundException('Transfer not found.');

    const lines = await this.loadLines(transferId);
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
    // Same as findOne: a transfer belongs to a farm-scoped list if either side
    // of it touches that farm.
    const scope = farmScope(this.cls);
    if (scope.farmId) conditions.push(or(batchOnFarm(schema.batchTransfer.from_batch_id, scope.farmId), batchOnFarm(schema.batchTransfer.to_batch_id, scope.farmId))!);
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.batchTransfer.company_id }));
    if (scope.restricted && scope.lobId) conditions.push(or(
      sql`${schema.batchTransfer.from_batch_id} IN (SELECT btl.batch_id FROM batch_header btl WHERE btl.lob_id = ${scope.lobId})`,
      sql`${schema.batchTransfer.to_batch_id} IN (SELECT btl.batch_id FROM batch_header btl WHERE btl.lob_id = ${scope.lobId})`,
    )!);

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

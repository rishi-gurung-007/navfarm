import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, gte, lte, desc, like, sql, SQL, inArray, notInArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateApprovalRequestDto, DecideApprovalDto, QueryApprovalDto } from './dto/approval.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertCompanyInScope, batchReferenceScopeConditions, batchScopeConditions, farmScope, locationReferenceScopeConditions, restrictedScopeConditions } from '../../../common/farm-scope';
import { mayDecideAnyRequisition } from '../../procurement/requisition/requisition.rules';

/**
 * The approval_request.doc_type values a requisition writes (REQUISITION for
 * common, FEED_REQUISITION for feed — requisition.service.ts's
 * COMMON_REQUISITION_DOC_TYPE and feed-requisition.service.ts's
 * FEED_APPROVAL_DOC_TYPE respectively). Duplicated here as literals rather
 * than imported: this engine deliberately never imports the document modules
 * it serves (they import it), and importing requisition.service.ts here
 * would also be circular — it imports ApprovalService.
 */
/** The approval-engine document types that ARE requisitions (common and feed). */
export const REQUISITION_APPROVAL_DOC_TYPES = ['REQUISITION', 'FEED_REQUISITION'] as const;

const toMysqlTimestamp = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/** Document-number prefix per request kind — unknown types fall back to REQ. */
const DOC_PREFIX: Record<string, string> = {
  FEED_RATION: 'REQ-RAT',
  GRN_RECEIPT: 'GRN-APR',
  STOCK_TRANSFER: 'TRF-APR',
  STAGE_CLOSE: 'STG-CLS',
  VET_DISPOSAL: 'VET-DISP',
  UNSCHEDULED_HEALTH: 'HLT-UNS',
};

/**
 * The operational approval queue.
 *
 * This screen used to run entirely on `localStorage`: four invented requests,
 * decisions that lived in one browser, and a "requestor" that was whatever
 * string the form produced. Every one of those is now a real row — approvals
 * survive a logout, a different device, and are visible to the person who
 * actually raised them.
 */
/** An approval_request row as the document handlers receive it. */
export type ApprovalRequestRow = typeof schema.approvalRequest.$inferSelect;

/**
 * D25: what a farm-level document type (today FEED_REQUISITION) does when its
 * approval request is decided or withdrawn. The document's own module
 * registers it (FeedRequisitionService.onModuleInit), so this engine never
 * imports the documents it serves — the requisition module already imports
 * this one.
 */
export interface ApprovalDocumentHandler {
  /**
   * Inside the decision's transaction, after the request is locked and found
   * PENDING and before it is marked decided. Throwing refuses the decision
   * and nothing is written. `remarks` is the approver's remarks on approval
   * and the reason on rejection.
   */
  decide(request: ApprovalRequestRow, decision: 'APPROVED' | 'REJECTED', remarks: string | null, tenantId: string, user: any): Promise<void>;
  /** Inside the withdrawal's transaction. */
  withdraw(request: ApprovalRequestRow, tenantId: string, user: any): Promise<void>;
  /** After the decision commits (e.g. re-evaluating alerts). Must not throw. */
  afterDecide?(request: ApprovalRequestRow, tenantId: string): Promise<void>;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly batchService: BatchService,
  ) {}

  private readonly documentHandlers = new Map<string, ApprovalDocumentHandler>();

  /** D25: called once by a document module at start-up. */
  registerDocumentHandler(docType: string, handler: ApprovalDocumentHandler): void {
    this.documentHandlers.set(docType, handler);
  }

  /** A request naming a document must have a handler; deciding it without one would leave the document stranded. */
  private handlerFor(request: ApprovalRequestRow): ApprovalDocumentHandler | undefined {
    if (!request.document_id) return undefined;
    const handler = this.documentHandlers.get(request.doc_type);
    if (!handler) throw new BadRequestException(`No handler is registered for ${request.doc_type} documents.`);
    return handler;
  }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private async generateDocNo(tenantId: string, companyId: string, docType: string): Promise<string> {
    const prefix = DOC_PREFIX[docType] || 'REQ';
    const year = new Date().getFullYear();
    const [{ n }] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.approvalRequest)
      .where(
        and(
          eq(schema.approvalRequest.tenant_id, tenantId),
          eq(schema.approvalRequest.company_id, companyId),
          eq(schema.approvalRequest.doc_type, docType),
          like(schema.approvalRequest.doc_no, `${prefix}-${year}-%`),
        )
      );
    return `${prefix}-${year}-${String(Number(n) + 1).padStart(4, '0')}`;
  }

  /**
   * The body's company must be one the caller belongs to, whatever header was
   * sent — the same rule RolesGuard applies to x-active-company-id. Tenant and
   * system admins may raise for any company of their tenant; everyone else for
   * their home company or an active company assignment. A caller with no user
   * context is an internal one and is bounded by scope alone.
   */
  private async assertMayRaiseFor(companyId: string, tenantId: string, userPayload?: any): Promise<void> {
    if (!userPayload?.userType) return;
    if (['TENANT_ADMIN', 'SYSTEM_ADMIN'].includes(userPayload.userType)) {
      const [company] = await this.db
        .select({ company_id: schema.companyMaster.company_id })
        .from(schema.companyMaster)
        .where(and(eq(schema.companyMaster.company_id, companyId), eq(schema.companyMaster.tenant_id, tenantId)))
        .limit(1);
      if (!company) throw new ForbiddenException('Not authorized for this company.');
      return;
    }
    if (companyId === userPayload.companyId) return;
    const [assignment] = await this.db
      .select({ id: schema.userCompanyAssignments.assign_id })
      .from(schema.userCompanyAssignments)
      .where(and(
        eq(schema.userCompanyAssignments.user_id, userPayload.userId),
        eq(schema.userCompanyAssignments.company_id, companyId),
        eq(schema.userCompanyAssignments.is_active, true),
      ))
      .limit(1);
    if (!assignment) throw new ForbiddenException('Not authorized for this company.');
  }

  async create(dto: CreateApprovalRequestDto, tenantId: string, userPayload?: any) {
    const scope = farmScope(this.cls);
    // A selected company is a boundary for every caller, not only restricted
    // ones: a company admin's batchless request used to land in another
    // company's queue and then 404 on read-back (recovery review I5).
    assertCompanyInScope(scope, dto.company_id);
    if (scope.restricted && !dto.batch_id) {
      throw new ForbiddenException('A batch is required to establish the operational scope of this approval.');
    }
    await this.assertMayRaiseFor(dto.company_id, tenantId, userPayload);
    if (dto.batch_id) {
      const [batch] = await this.db
        .select({ batch_id: schema.batchHeader.batch_id, company_id: schema.batchHeader.company_id })
        .from(schema.batchHeader)
        .where(and(
          eq(schema.batchHeader.batch_id, dto.batch_id),
          eq(schema.batchHeader.tenant_id, tenantId),
          isNull(schema.batchHeader.deleted_at),
          ...batchScopeConditions(scope),
        ))
        .limit(1);
      if (!batch) throw new NotFoundException('Approval batch not found.');
      if (batch.company_id !== dto.company_id) {
        throw new BadRequestException('The approval batch does not belong to the request company.');
      }
    }

    const requestId = randomUUID();
    const docNo = await this.generateDocNo(tenantId, dto.company_id, dto.doc_type);

    await this.db.insert(schema.approvalRequest).values({
      request_id: requestId,
      tenant_id: tenantId,
      company_id: dto.company_id,
      operational_area_id: dto.operational_area_id || null,
      doc_type: dto.doc_type,
      doc_no: docNo,
      title: dto.title,
      requested_by: userPayload?.userId || null,
      requestor_label: userPayload?.fullName || userPayload?.email || null,
      requestor_role: (userPayload?.userType || '').replace(/_/g, ' ') || null,
      location_label: dto.location_label || null,
      batch_id: dto.batch_id || null,
      urgency: dto.urgency || 'MEDIUM',
      item_or_stage: dto.item_or_stage || null,
      requested_qty: dto.requested_qty || null,
      uom: dto.uom || null,
      cost_impact: dto.cost_impact !== undefined && dto.cost_impact !== null ? String(dto.cost_impact) : null,
      justification: dto.justification || null,
      status: 'PENDING',
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'approval_request',
      entityId: requestId,
      newValues: { doc_no: docNo, doc_type: dto.doc_type, title: dto.title },
    });

    return this.findOne(requestId, tenantId);
  }

  /**
   * Who sees a request. A batch row reaches a farm through its batch, as it
   * always has. D25: a farm-level document (no batch, farm_id set) reaches it
   * through that farm — a farm user sees their own farm's, a company admin the
   * company's, a restricted user their LOB's — which is what lets a farm's own
   * approvers decide a feed requisition here.
   *
   * D1 (Part E live verification): a common requisition (Item/FA/Service) can
   * have neither a batch nor a farm, so it fell through both branches above.
   * This third branch is for exactly that row, and it is reachable by any
   * caller who is not LOB-restricted — a company admin (companyId set) as
   * much as a tenant-wide admin (companyId null) — because approval_request
   * carries no lob_id of its own to check a restricted user's LOB against:
   * there is nothing on this row for `assertLobInScope`'s or
   * `locationReferenceScopeConditions`'s LOB conditions to compare, so a
   * restricted caller (OPERATIONAL_ADMIN, FARM_MANAGER, STANDARD_USER) is
   * kept out of this branch rather than guessed into or out of an LOB it
   * cannot state. The farm/batch branches above are untouched; the
   * `company_id = scope.companyId` condition appended below still bounds
   * every branch including this one, so a company admin never reads another
   * company's row.
   *
   * Rishi, 4 Oct (Option A): a non-restricted user who also has an active
   * farm selected (a company/tenant admin who picked a farm via
   * x-active-farm-id, not a farm-bound persona) still sees the company's
   * farm-less requests alongside that farm's own. So this branch no longer
   * gates on `scope.farmId` at all — only `scope.restricted` decides it.
   * A farm-bound user (FARM_MANAGER, STANDARD_USER) is always `restricted`
   * (RESTRICTED_USER_TYPES), so they stay excluded exactly as before; the
   * farmId check that used to also exclude a merely-farm-selecting admin is
   * gone because that exclusion was never the rule Rishi wanted.
   *
   * decisions.md 2026-10-04 (second entry): a TENANT_ADMIN or COMPANY_ADMIN
   * (mayDecideAnyRequisition) may see/decide ANY requisition in their scope
   * regardless of which farm is active — an extra OR branch bounded by
   * doc_type (REQUISITION/FEED_REQUISITION only; every other approval kind
   * keeps the ordinary active-farm narrowing). The trailing company-boundary
   * condition below still bounds this branch like every other, and
   * `userType` defaults to undefined (not exempt) so every pre-existing
   * caller that has not threaded it through is unaffected.
   */
  /**
   * Public since WP1b (decisions.md 2026-10-04, "one Requisitions page"): the
   * hub's waiting-for-approval filter and pending count reuse THIS predicate —
   * the inbox's own visibility rule plus the WP1 admin rule — so the two
   * surfaces can never disagree about what the current user may decide.
   */
  farmConditions(userType?: string): SQL[] {
    const scope = farmScope(this.cls);
    const R = schema.approvalRequest;
    const paths: SQL[] = [
      and(sql`${R.batch_id} IS NOT NULL`, ...batchReferenceScopeConditions(scope, R.batch_id))!,
      and(isNull(R.batch_id), sql`${R.farm_id} IS NOT NULL`, ...locationReferenceScopeConditions(scope, R.farm_id))!,
    ];
    if (!scope.restricted) {
      paths.push(and(isNull(R.batch_id), isNull(R.farm_id))!);
    }
    if (mayDecideAnyRequisition(userType)) {
      paths.push(inArray(R.doc_type, [...REQUISITION_APPROVAL_DOC_TYPES]));
    }
    return [or(...paths)!, ...restrictedScopeConditions(scope, { companyId: R.company_id })];
  }

  /**
   * WP1b: the visibility predicate for the requisition kinds' approval
   * requests — farmConditions (above, one copy) narrowed to those kinds. The
   * hub's waiting filter and pending count build on this; findOne and decide
   * keep plain farmConditions so deciding from the hub reaches the same
   * handlers.
   */
  requisitionRequestConditions(userType?: string): SQL[] {
    // farmConditions first, so its rendered SQL (and its parameter order) is a
    // prefix of the hub predicate's — the equivalence test asserts exactly that.
    return [...this.farmConditions(userType), inArray(schema.approvalRequest.doc_type, [...REQUISITION_APPROVAL_DOC_TYPES])];
  }

  async findAll(query: QueryApprovalDto, tenantId: string, userType?: string) {
    const conditions: SQL[] = [
      eq(schema.approvalRequest.tenant_id, tenantId),
      isNull(schema.approvalRequest.deleted_at),
      ...this.farmConditions(userType),
      // WP1b (decisions.md 2026-10-04, "one Requisitions page"): the inbox no
      // longer lists requisitions — Approvals → Requisitions is the one
      // requisition list. findOne and decide still reach them, so the hub's
      // Approve/Reject call the same endpoints.
      notInArray(schema.approvalRequest.doc_type, [...REQUISITION_APPROVAL_DOC_TYPES]),
    ];
    if (query.company_id) conditions.push(eq(schema.approvalRequest.company_id, query.company_id));
    // An area filter keeps rows of that area AND rows that carry no area yet:
    // every approval_request row written before Plan S has a NULL area, so a
    // strict equality emptied the inbox in an operational-area workspace. The
    // company and farm/batch rules above still decide who may see a row.
    if (query.operational_area_id) {
      conditions.push(or(
        eq(schema.approvalRequest.operational_area_id, query.operational_area_id),
        isNull(schema.approvalRequest.operational_area_id),
      )!);
    }
    if (query.status) conditions.push(eq(schema.approvalRequest.status, query.status));
    if (query.doc_type) conditions.push(eq(schema.approvalRequest.doc_type, query.doc_type));
    if (query.from_date) conditions.push(gte(schema.approvalRequest.submitted_at, query.from_date));
    if (query.to_date) conditions.push(lte(schema.approvalRequest.submitted_at, `${query.to_date} 23:59:59`));
    if (query.search?.trim()) {
      const q = `%${query.search.trim()}%`;
      conditions.push(
        or(
          like(schema.approvalRequest.doc_no, q),
          like(schema.approvalRequest.title, q),
          like(schema.approvalRequest.requestor_label, q),
          like(schema.approvalRequest.location_label, q),
        )!
      );
    }

    // The DTO advertises limit/offset and the pipe accepts them, so honour
    // them — and bound the default, because an unbounded list grows forever as
    // approvals accumulate. The tab badges come from counts(), not from
    // measuring this page.
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    return this.db
      .select(this.listShape())
      .from(schema.approvalRequest)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.approvalRequest.batch_id))
      .where(and(...conditions))
      .orderBy(desc(schema.approvalRequest.submitted_at))
      .limit(limit)
      .offset(offset);
  }

  /** Pending/approved/rejected counts in one query, so the tab badges don't need three round trips. */
  async counts(query: QueryApprovalDto, tenantId: string, userType?: string) {
    const conditions: SQL[] = [
      eq(schema.approvalRequest.tenant_id, tenantId),
      isNull(schema.approvalRequest.deleted_at),
      ...this.farmConditions(userType),
      // WP1b: the badges count only what the inbox shows — requisitions moved
      // to the hub, whose pending count is countsRequisitions() below.
      notInArray(schema.approvalRequest.doc_type, [...REQUISITION_APPROVAL_DOC_TYPES]),
    ];
    if (query.company_id) conditions.push(eq(schema.approvalRequest.company_id, query.company_id));
    // An area filter keeps rows of that area AND rows that carry no area yet:
    // every approval_request row written before Plan S has a NULL area, so a
    // strict equality emptied the inbox in an operational-area workspace. The
    // company and farm/batch rules above still decide who may see a row.
    if (query.operational_area_id) {
      conditions.push(or(
        eq(schema.approvalRequest.operational_area_id, query.operational_area_id),
        isNull(schema.approvalRequest.operational_area_id),
      )!);
    }

    const rows = await this.db
      .select({ status: schema.approvalRequest.status, n: sql<number>`COUNT(*)` })
      .from(schema.approvalRequest)
      .where(and(...conditions))
      .groupBy(schema.approvalRequest.status);

    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    return { PENDING: map.PENDING || 0, APPROVED: map.APPROVED || 0, REJECTED: map.REJECTED || 0 };
  }

  /**
   * WP1b (decisions.md 2026-10-04, "one Requisitions page"): the inbox's card
   * — "Requisitions waiting for approval: N → open Requisitions" — reads this
   * count: the requisition kinds the inbox no longer lists, under the same
   * waiting predicate the hub's filter uses (requisitionRequestConditions).
   */
  async countsRequisitions(query: QueryApprovalDto, tenantId: string, userType?: string) {
    const conditions: SQL[] = [
      eq(schema.approvalRequest.tenant_id, tenantId),
      isNull(schema.approvalRequest.deleted_at),
      eq(schema.approvalRequest.status, 'PENDING'),
      ...this.requisitionRequestConditions(userType),
    ];
    if (query.company_id) conditions.push(eq(schema.approvalRequest.company_id, query.company_id));
    if (query.operational_area_id) {
      conditions.push(or(
        eq(schema.approvalRequest.operational_area_id, query.operational_area_id),
        isNull(schema.approvalRequest.operational_area_id),
      )!);
    }
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(schema.approvalRequest)
      .where(and(...conditions));
    return { PENDING: Number(row?.n ?? 0) };
  }

  async findOne(requestId: string, tenantId: string, userType?: string) {
    const [row] = await this.db
      .select(this.listShape())
      .from(schema.approvalRequest)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.approvalRequest.batch_id))
      .where(and(eq(schema.approvalRequest.request_id, requestId), eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at), ...this.farmConditions(userType)))
      .limit(1);
    if (!row) throw new NotFoundException('Approval request not found.');
    return row;
  }

  async approve(requestId: string, tenantId: string, userPayload?: any, remarks?: string) {
    return this.decide(requestId, 'APPROVED', tenantId, remarks, userPayload);
  }

  async approveUnscheduledHealth(batchId: string, requestId: string, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'APPROVED', tenantId, undefined, userPayload, batchId);
  }

  async reject(requestId: string, dto: DecideApprovalDto, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'REJECTED', tenantId, dto.rejection_reason, userPayload);
  }

  private async decide(requestId: string, status: 'APPROVED' | 'REJECTED', tenantId: string, reason: string | undefined, userPayload?: any, expectedHealthBatchId?: string) {
    // Set inside the transaction, run after it commits (D25): a document's
    // follow-up work, such as re-evaluating feed alerts, must read committed rows.
    const after: { run?: () => Promise<void> } = {};
    const result = await withTenantTransaction(this.cls, async () => {
    // A locking read does not establish a repeatable-read snapshot. Every
    // decision locks the request first; health posting then locks its batch.
    const [current] = await this.db.select().from(schema.approvalRequest)
      .where(and(
        eq(schema.approvalRequest.request_id, requestId),
        eq(schema.approvalRequest.tenant_id, tenantId),
        isNull(schema.approvalRequest.deleted_at),
        ...this.farmConditions(userPayload?.userType),
      ))
      .for('update');
    if (!current) throw new NotFoundException('Approval request not found.');
    if (expectedHealthBatchId && (current.doc_type !== 'UNSCHEDULED_HEALTH' || current.batch_id !== expectedHealthBatchId)) {
      throw new BadRequestException('That request is not an unscheduled health event on this batch.');
    }
    if (current.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${current.status.toLowerCase()} and cannot be decided again.`);
    }

    // D25: a farm document's own module decides what the decision means for
    // it, and may refuse it (e.g. a feed requisition that needs remarks).
    const handler = this.handlerFor(current);
    await handler?.decide(current, status, reason?.trim() || null, tenantId, userPayload);
    if (handler?.afterDecide) after.run = () => handler.afterDecide!(current, tenantId);

    if (status === 'APPROVED' && current.doc_type === 'UNSCHEDULED_HEALTH') {
      if (!current.batch_id) throw new BadRequestException('This health request has no batch.');
      const [batch] = await this.db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, current.batch_id), eq(schema.batchHeader.tenant_id, tenantId), isNull(schema.batchHeader.deleted_at)))
        .for('update');
      if (!batch || batch.company_id !== current.company_id) throw new BadRequestException('The health request batch does not belong to its company.');
      await this.postHealthTreatment(current, tenantId, userPayload);
    }

    await this.db
      .update(schema.approvalRequest)
      .set({
        status,
        decided_at: toMysqlTimestamp(),
        decided_by: userPayload?.userId || null,
        decider_label: userPayload?.fullName || userPayload?.email || null,
        rejection_reason: status === 'REJECTED' ? reason || 'Rejected by authorizer.' : null,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.approvalRequest.request_id, requestId));

    await this.auditService.log({
      tenantId,
      companyId: current.company_id,
      userId: userPayload?.userId,
      action: status === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityName: 'approval_request',
      entityId: requestId,
      oldValues: { status: 'PENDING' },
      // F6: an approval's remarks are remarks. Filing them under
      // rejection_reason made an approved document read as a rejected one in
      // the audit ledger.
      newValues: status === 'REJECTED' ? { status, rejection_reason: reason || null } : { status, remarks: reason || null },
    });

    // Bug found live (WP1 check, 4 Oct): without userType here, the
    // just-decided row's own read-back used the farm-only visibility — the
    // very fix above that let an admin reach another farm's request would
    // then throw "Approval request not found." on its own read-back and roll
    // the whole decision back. Thread it through like every other call.
    return this.findOne(requestId, tenantId, userPayload?.userType);
    });
    await after.run?.();
    return result;
  }

  /**
   * D25: a farm-level document (today a feed requisition) submitted for
   * approval. The caller has already proved the farm is the actor's (the
   * requisition resolves its own farm for this user and runs under
   * withFarmScope), so this checks only that the farm is a FARM of that
   * company in this tenant and that the document has no request open. It
   * writes a PENDING row with farm_id and document_id, which is what makes it
   * visible in the inbox to that farm's approvers (farmConditions), and a
   * CREATE audit row carrying the document. Runs inside the caller's
   * transaction when there is one, so the document and its request commit
   * together.
   */
  async submitFarmDocument(
    doc: {
      documentType: string;
      documentId: string;
      documentNo: string;
      /** A farm-level document is scoped to this farm in the inbox; a company-level one (farmId undefined) is visible to unrestricted approvers only. */
      farmId?: string;
      companyId: string;
      title: string;
      /** Overrides the derived "CODE — Name" label (company-level documents may name their own origin). */
      location_label?: string | null;
      urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
      itemOrStage?: string | null;
      requestedQty?: string | null;
      uom?: string | null;
      justification?: string | null;
    },
    tenantId: string,
    userPayload?: any,
  ): Promise<string> {
    assertCompanyInScope(farmScope(this.cls), doc.companyId);
    return withTenantTransaction(this.cls, async () => {
      let locationLabel: string | null = null;
      if (doc.farmId) {
        const [farm] = await this.db
          .select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
          .from(schema.locationMaster)
          .where(and(
            eq(schema.locationMaster.location_id, doc.farmId),
            eq(schema.locationMaster.company_id, doc.companyId),
            eq(schema.locationMaster.tenant_id, tenantId),
            eq(schema.locationMaster.location_type, 'FARM'),
            isNull(schema.locationMaster.deleted_at),
          ))
          .limit(1);
        if (!farm) throw new NotFoundException('Farm not found.');
        locationLabel = `${farm.code} — ${farm.name ?? ''}`.trim();
      }
      const [open] = await this.db
        .select({ request_id: schema.approvalRequest.request_id })
        .from(schema.approvalRequest)
        .where(and(
          eq(schema.approvalRequest.tenant_id, tenantId),
          eq(schema.approvalRequest.doc_type, doc.documentType),
          eq(schema.approvalRequest.document_id, doc.documentId),
          eq(schema.approvalRequest.status, 'PENDING'),
          isNull(schema.approvalRequest.deleted_at),
        ))
        .limit(1);
      if (open) throw new ConflictException(`${doc.documentNo} is already waiting for approval.`);

      // The workspace the farm submitted from, so an approver working in that
      // operational area sees it. With no active area (an admin in the company
      // workspace) the company's own area is used when there is exactly one;
      // several is ambiguous, and null still lists under the rule above.
      const active = this.cls.get<{ area_id?: string } | undefined>('activeOperationalArea');
      let areaId: string | null = active?.area_id ?? null;
      if (!areaId) {
        const areas = await this.db
          .select({ area_id: schema.operationalAreaMaster.area_id })
          .from(schema.operationalAreaMaster)
          .where(and(
            eq(schema.operationalAreaMaster.tenant_id, tenantId),
            eq(schema.operationalAreaMaster.company_id, doc.companyId),
            eq(schema.operationalAreaMaster.is_active, true),
            isNull(schema.operationalAreaMaster.deleted_at),
          ))
          .limit(2);
        areaId = areas.length === 1 ? areas[0].area_id : null;
      }

      const requestId = randomUUID();
      await this.db.insert(schema.approvalRequest).values({
        request_id: requestId,
        tenant_id: tenantId,
        company_id: doc.companyId,
        doc_type: doc.documentType,
        // The document's own number: the inbox then names the requisition, not a second number for it.
        doc_no: doc.documentNo.slice(0, 50),
        title: doc.title.slice(0, 200),
        requested_by: userPayload?.userId || null,
        requestor_label: userPayload?.fullName || userPayload?.email || null,
        requestor_role: (userPayload?.userType || '').replace(/_/g, ' ') || null,
        location_label: (doc.location_label || locationLabel)?.slice(0, 200) ?? null,
        operational_area_id: areaId,
        farm_id: doc.farmId ?? null,
        document_id: doc.documentId,
        urgency: doc.urgency || 'MEDIUM',
        item_or_stage: doc.itemOrStage || null,
        requested_qty: doc.requestedQty || null,
        uom: doc.uom || null,
        justification: doc.justification || null,
        status: 'PENDING',
        created_by: userPayload?.userId || null,
      });
      await this.auditService.log({
        tenantId,
        companyId: doc.companyId,
        userId: userPayload?.userId,
        action: 'CREATE',
        entityName: 'approval_request',
        entityId: requestId,
        newValues: { doc_no: doc.documentNo, doc_type: doc.documentType, title: doc.title, document_id: doc.documentId, farm_id: doc.farmId ?? null },
      });
      return requestId;
    });
  }

  private async postHealthTreatment(request: typeof schema.approvalRequest.$inferSelect, tenantId: string, userPayload?: any) {
    // Observations have no requested medicine quantity and need no stock issue.
    if (request.requested_qty == null) return;
    const quantity = Number(request.requested_qty);
    if (!request.item_or_stage || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('A treatment requires a medicine and a positive quantity.');
    }
    const items = await this.db.select({ item_id: schema.itemMaster.item_id, uom: schema.itemMaster.uom_primary })
      .from(schema.itemMaster).where(and(
        eq(schema.itemMaster.item_name, request.item_or_stage),
        eq(schema.itemMaster.tenant_id, tenantId),
        eq(schema.itemMaster.company_id, request.company_id),
        eq(schema.itemMaster.is_active, true),
        isNull(schema.itemMaster.deleted_at),
        inArray(schema.itemMaster.item_type, ['MEDICINE', 'VACCINE']),
      )).limit(2);
    if (items.length !== 1) throw new BadRequestException('The requested medicine must resolve to exactly one active item in this company; correct the request before approving.');
    const item = items[0];
    if (!item.uom || request.uom !== item.uom) {
      throw new BadRequestException('The requested treatment unit must match the medicine stock unit; correct the request before approving.');
    }
    const eventDate = /^Date: (\d{4}-\d{2}-\d{2})$/m.exec(request.justification ?? '')?.[1];
    await this.batchService.addTransaction(request.batch_id!, {
      transaction_date: eventDate ?? String(request.submitted_at).slice(0, 10),
      transaction_type: 'CONSUMPTION', item_id: item.item_id, quantity,
      uom: item.uom, remarks: `${request.doc_no} — unscheduled health event`,
    }, tenantId, userPayload);
  }

  async remove(requestId: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const [current] = await this.db.select().from(schema.approvalRequest)
      .where(and(
        eq(schema.approvalRequest.request_id, requestId),
        eq(schema.approvalRequest.tenant_id, tenantId),
        isNull(schema.approvalRequest.deleted_at),
        ...this.farmConditions(),
      ))
      .for('update');
    if (!current) throw new NotFoundException('Approval request not found.');
    if (current.status !== 'PENDING') {
      throw new BadRequestException('Only a pending request can be withdrawn. A decided request is part of the audit trail.');
    }
    // D25: a withdrawn farm document goes back to its owner as a draft.
    await this.handlerFor(current)?.withdraw(current, tenantId, userPayload);
    await this.db
      .update(schema.approvalRequest)
      .set({ deleted_at: toMysqlTimestamp(), updated_by: userPayload?.userId || null })
      .where(eq(schema.approvalRequest.request_id, requestId));
    await this.auditService.log({
      tenantId,
      companyId: current.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'approval_request',
      entityId: requestId,
    });
    return { request_id: requestId, withdrawn: true };
    });
  }

  /** One projection shared by list and detail, so both screens agree on field names. */
  private listShape() {
    return {
      request_id: schema.approvalRequest.request_id,
      company_id: schema.approvalRequest.company_id,
      operational_area_id: schema.approvalRequest.operational_area_id,
      doc_type: schema.approvalRequest.doc_type,
      doc_no: schema.approvalRequest.doc_no,
      title: schema.approvalRequest.title,
      requested_by: schema.approvalRequest.requested_by,
      requestor_label: schema.approvalRequest.requestor_label,
      requestor_role: schema.approvalRequest.requestor_role,
      location_label: schema.approvalRequest.location_label,
      batch_id: schema.approvalRequest.batch_id,
      batch_no: schema.batchHeader.batch_no,
      farm_id: schema.approvalRequest.farm_id,
      document_id: schema.approvalRequest.document_id,
      urgency: schema.approvalRequest.urgency,
      item_or_stage: schema.approvalRequest.item_or_stage,
      requested_qty: schema.approvalRequest.requested_qty,
      uom: schema.approvalRequest.uom,
      cost_impact: schema.approvalRequest.cost_impact,
      justification: schema.approvalRequest.justification,
      status: schema.approvalRequest.status,
      submitted_at: schema.approvalRequest.submitted_at,
      decided_at: schema.approvalRequest.decided_at,
      decider_label: schema.approvalRequest.decider_label,
      rejection_reason: schema.approvalRequest.rejection_reason,
    };
  }
}

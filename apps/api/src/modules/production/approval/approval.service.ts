import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, gte, lte, desc, like, sql, SQL, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateApprovalRequestDto, DecideApprovalDto, QueryApprovalDto } from './dto/approval.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { assertCompanyInScope, batchReferenceScopeConditions, batchScopeConditions, farmScope, restrictedScopeConditions } from '../../../common/farm-scope';

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
@Injectable()
export class ApprovalService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly batchService: BatchService,
    private readonly batchTransferService: BatchTransferService,
  ) {}

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
   * An approval reaches a farm only through its batch. One with no batch has no
   * farm, so a restricted user never sees it; an admin sees it unless a farm is selected.
   * A restricted user with no farm selected (an operational admin across farms)
   * still sees only their own line of business.
   */
  private farmConditions(): SQL[] {
    const scope = farmScope(this.cls);
    return [
      ...(scope.restricted ? [sql`${schema.approvalRequest.batch_id} IS NOT NULL`] : []),
      ...batchReferenceScopeConditions(scope, schema.approvalRequest.batch_id),
      ...restrictedScopeConditions(scope, { companyId: schema.approvalRequest.company_id }),
    ];
  }

  async findAll(query: QueryApprovalDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at), ...this.farmConditions()];
    if (query.company_id) conditions.push(eq(schema.approvalRequest.company_id, query.company_id));
    if (query.operational_area_id) conditions.push(eq(schema.approvalRequest.operational_area_id, query.operational_area_id));
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
  async counts(query: QueryApprovalDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at), ...this.farmConditions()];
    if (query.company_id) conditions.push(eq(schema.approvalRequest.company_id, query.company_id));
    if (query.operational_area_id) conditions.push(eq(schema.approvalRequest.operational_area_id, query.operational_area_id));

    const rows = await this.db
      .select({ status: schema.approvalRequest.status, n: sql<number>`COUNT(*)` })
      .from(schema.approvalRequest)
      .where(and(...conditions))
      .groupBy(schema.approvalRequest.status);

    const map = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    return { PENDING: map.PENDING || 0, APPROVED: map.APPROVED || 0, REJECTED: map.REJECTED || 0 };
  }

  async findOne(requestId: string, tenantId: string) {
    const [row] = await this.db
      .select(this.listShape())
      .from(schema.approvalRequest)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.approvalRequest.batch_id))
      .where(and(eq(schema.approvalRequest.request_id, requestId), eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at), ...this.farmConditions()))
      .limit(1);
    if (!row) throw new NotFoundException('Approval request not found.');
    return row;
  }

  async approve(requestId: string, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'APPROVED', tenantId, undefined, userPayload);
  }

  async approveUnscheduledHealth(batchId: string, requestId: string, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'APPROVED', tenantId, undefined, userPayload, batchId);
  }

  async reject(requestId: string, dto: DecideApprovalDto, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'REJECTED', tenantId, dto.rejection_reason, userPayload);
  }

  private async decide(requestId: string, status: 'APPROVED' | 'REJECTED', tenantId: string, reason: string | undefined, userPayload?: any, expectedHealthBatchId?: string) {
    return withTenantTransaction(this.cls, async () => {
    // A locking read does not establish a repeatable-read snapshot. Every
    // decision locks the request first; health posting then locks its batch.
    const [current] = await this.db.select().from(schema.approvalRequest)
      .where(and(
        eq(schema.approvalRequest.request_id, requestId),
        eq(schema.approvalRequest.tenant_id, tenantId),
        isNull(schema.approvalRequest.deleted_at),
        ...this.farmConditions(),
      ))
      .for('update');
    if (!current) throw new NotFoundException('Approval request not found.');
    if (expectedHealthBatchId && (current.doc_type !== 'UNSCHEDULED_HEALTH' || current.batch_id !== expectedHealthBatchId)) {
      throw new BadRequestException('That request is not an unscheduled health event on this batch.');
    }
    if (current.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${current.status.toLowerCase()} and cannot be decided again.`);
    }

    if (status === 'APPROVED' && current.doc_type === 'UNSCHEDULED_HEALTH') {
      if (!current.batch_id) throw new BadRequestException('This health request has no batch.');
      const [batch] = await this.db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, current.batch_id), eq(schema.batchHeader.tenant_id, tenantId), isNull(schema.batchHeader.deleted_at)))
        .for('update');
      if (!batch || batch.company_id !== current.company_id) throw new BadRequestException('The health request batch does not belong to its company.');
      await this.postHealthTreatment(current, tenantId, userPayload);
    }

    // An approved transfer approval posts the movement it gates — the same
    // post() a direct post uses, flagged viaApproval so the worker gate
    // standing in front of it opens for the decision. A rejected one cancels
    // the draft so the animals cannot be moved by a stale request later. Both
    // run inside this decision's transaction: an approval whose movement
    // cannot post fails the decision, not the herd.
    if (current.doc_type === 'BATCH_TRANSFER') {
      if (!current.reference_id) throw new BadRequestException('This transfer request has no transfer document linked.');
      if (status === 'APPROVED') {
        await this.batchTransferService.post(current.reference_id, tenantId, userPayload, { viaApproval: true });
      } else {
        await this.batchTransferService.cancel(current.reference_id, tenantId, userPayload);
      }
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
      newValues: { status, rejection_reason: reason || null },
    });

    return this.findOne(requestId, tenantId);
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

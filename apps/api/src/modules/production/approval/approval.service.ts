import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, gte, lte, desc, like, sql, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateApprovalRequestDto, DecideApprovalDto, QueryApprovalDto } from './dto/approval.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

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

  async create(dto: CreateApprovalRequestDto, tenantId: string, userPayload?: any) {
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

  async findAll(query: QueryApprovalDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at)];
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
    const conditions: SQL[] = [eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at)];
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
      .where(and(eq(schema.approvalRequest.request_id, requestId), eq(schema.approvalRequest.tenant_id, tenantId), isNull(schema.approvalRequest.deleted_at)))
      .limit(1);
    if (!row) throw new NotFoundException('Approval request not found.');
    return row;
  }

  async approve(requestId: string, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'APPROVED', tenantId, undefined, userPayload);
  }

  async reject(requestId: string, dto: DecideApprovalDto, tenantId: string, userPayload?: any) {
    return this.decide(requestId, 'REJECTED', tenantId, dto.rejection_reason, userPayload);
  }

  private async decide(requestId: string, status: 'APPROVED' | 'REJECTED', tenantId: string, reason: string | undefined, userPayload?: any) {
    const current = await this.findOne(requestId, tenantId);
    if (current.status !== 'PENDING') {
      throw new BadRequestException(`This request was already ${current.status.toLowerCase()} and cannot be decided again.`);
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
  }

  async remove(requestId: string, tenantId: string, userPayload?: any) {
    const current = await this.findOne(requestId, tenantId);
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

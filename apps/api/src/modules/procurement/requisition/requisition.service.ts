/**
 * Phase 9 Requisition MVP — the requisition document on the approval engine.
 *
 * Flow per BBP1 §7.2 / §17.2: a requisition is drafted (by a user here; the
 * feed-forecast auto-draft lands with Phase 10), submitted for approval —
 * which raises a real approval_request and links it, not a free-text label —
 * and decided by an authorizer. On approve the requisition may carry the
 * D365BC PO number (`linked_po_no`, §7.2 step 7). On reject the reason is
 * mandatory (§17.1 flow step 4).
 *
 * Farm scope rides the same `farmScope(this.cls)` every other module uses: a
 * farm-pinned caller sees only their farm's requisitions, and a requisition
 * for another farm is indistinguishable from one that never existed.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmScope, assertCompanyInScope, assertLocationOnActiveFarm } from '../../../common/farm-scope';
import { userHasPermission } from '../../../common/permissions';
import { ApprovalService } from '../../production/approval/approval.service';
import * as schema from '../../../core/database/schema';
import { CreateRequisitionDto, DecideRequisitionDto, RequisitionLineInput } from './dto/requisition.dto';

const DOC_TYPES = ['ITEM', 'FA', 'SERVICE'] as const;
const REQUISITION_MODULE = { moduleCode: 'PROCUREMENT', resource: 'REQUISITION' } as const;

@Injectable()
export class RequisitionService {
  constructor(
    private readonly cls: ClsService,
    private readonly approvals: ApprovalService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private scopeConditions() {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId) conditions.push(eq(schema.requisition.farm_id, scope.farmId));
    if (scope.restricted && scope.lobId) {
      conditions.push(sql`${schema.requisition.company_id} IN (SELECT company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ${scope.lobId})`);
    }
    return conditions;
  }

  /** REQ-YYYY-NNNN per company — ours (BBP names no requisition number series). */
  private async nextReqNo(companyId: string, tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `REQ-${year}-`;
    const [last] = await this.db
      .select({ req_no: schema.requisition.req_no })
      .from(schema.requisition)
      .where(and(eq(schema.requisition.tenant_id, tenantId), eq(schema.requisition.company_id, companyId), sql`${schema.requisition.req_no} LIKE ${prefix + '%'}`))
      .orderBy(desc(schema.requisition.req_no))
      .limit(1);
    const lastSeq = last?.req_no ? Number(last.req_no.slice(prefix.length)) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
  }

  private validateLines(lines: RequisitionLineInput[]) {
    for (const line of lines) {
      if (!line.item_id && !line.resource_id && !line.description?.trim()) {
        throw new BadRequestException('Each requisition line needs an item, a resource, or a description.');
      }
    }
  }

  async create(dto: CreateRequisitionDto, tenantId: string, userPayload?: { userId?: string }) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    if (dto.farm_id) {
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.farm_id, 'Requisition farm');
    }
    const docType = dto.doc_type && (DOC_TYPES as readonly string[]).includes(dto.doc_type) ? dto.doc_type : 'ITEM';
    this.validateLines(dto.lines);

    return withTenantTransaction(this.cls, async () => {
      const reqNo = await this.nextReqNo(dto.company_id, tenantId);
      const requisitionId = randomUUID();
      await this.db.insert(schema.requisition).values({
        requisition_id: requisitionId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        farm_id: dto.farm_id ?? null,
        req_no: reqNo,
        doc_type: docType,
        status: 'DRAFT',
        required_date: dto.required_date ?? null,
        justification: dto.justification ?? null,
        created_by: userPayload?.userId ?? null,
      });
      await this.db.insert(schema.requisitionLine).values(
        dto.lines.map((line, index) => ({
          requisition_id: requisitionId,
          line_seq: index + 1,
          item_id: line.item_id ?? null,
          resource_id: line.resource_id ?? null,
          description: line.description ?? null,
          quantity: String(line.quantity),
          uom: line.uom,
          est_rate: line.est_rate !== undefined && line.est_rate !== null ? String(line.est_rate) : null,
        })),
      );
      return this.findOne(requisitionId, tenantId);
    });
  }

  async findOne(requisitionId: string, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    const lines = await this.db
      .select({
        line_id: schema.requisitionLine.line_id,
        line_seq: schema.requisitionLine.line_seq,
        item_id: schema.requisitionLine.item_id,
        resource_id: schema.requisitionLine.resource_id,
        description: schema.requisitionLine.description,
        quantity: schema.requisitionLine.quantity,
        uom: schema.requisitionLine.uom,
        est_rate: schema.requisitionLine.est_rate,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
      })
      .from(schema.requisitionLine)
      .leftJoin(schema.itemMaster, eq(schema.requisitionLine.item_id, schema.itemMaster.item_id))
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    return { ...row, lines };
  }

  async findAll(query: { company_id?: string; status?: string }, tenantId: string) {
    const conditions = [
      eq(schema.requisition.tenant_id, tenantId),
      isNull(schema.requisition.deleted_at),
      ...this.scopeConditions(),
    ];
    if (query.company_id) conditions.push(eq(schema.requisition.company_id, query.company_id));
    if (query.status) conditions.push(eq(schema.requisition.status, query.status));
    return this.db
      .select({
        requisition_id: schema.requisition.requisition_id,
        req_no: schema.requisition.req_no,
        doc_type: schema.requisition.doc_type,
        status: schema.requisition.status,
        farm_id: schema.requisition.farm_id,
        farm_code: schema.locationMaster.location_code,
        required_date: schema.requisition.required_date,
        approval_request_id: schema.requisition.approval_request_id,
        linked_po_no: schema.requisition.linked_po_no,
        created_at: schema.requisition.created_at,
        line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
      })
      .from(schema.requisition)
      .leftJoin(schema.locationMaster, eq(schema.requisition.farm_id, schema.locationMaster.location_id))
      .where(and(...conditions))
      .orderBy(desc(schema.requisition.created_at))
      .limit(200);
  }

  /** DRAFT → PENDING_APPROVAL, raising the linked approval_request (§17.2). */
  async submit(requisitionId: string, note: string | undefined, tenantId: string, userPayload?: { userId?: string; email?: string; userType?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select()
        .from(schema.requisition)
        .where(and(
          eq(schema.requisition.requisition_id, requisitionId),
          eq(schema.requisition.tenant_id, tenantId),
          isNull(schema.requisition.deleted_at),
          ...this.scopeConditions(),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
      if (row.status !== 'DRAFT') throw new BadRequestException(`Requisition ${row.req_no} is ${row.status} and cannot be submitted.`);

      const farm = row.farm_id
        ? (await this.db.select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
            .from(schema.locationMaster).where(eq(schema.locationMaster.location_id, row.farm_id)).limit(1))[0]
        : undefined;
      const created = await this.approvals.create(
        {
          company_id: row.company_id,
          doc_type: 'REQUISITION',
          title: `Requisition ${row.req_no}${note ? ` — ${note}` : ''}`,
          location_label: farm ? `${farm.code} — ${farm.name ?? ''}`.trim() : undefined,
          urgency: 'MEDIUM',
          item_or_stage: row.doc_type,
          justification: row.justification ?? undefined,
        },
        tenantId,
        userPayload,
      );
      await this.db
        .update(schema.requisition)
        .set({ status: 'PENDING_APPROVAL', approval_request_id: created.request_id, updated_by: userPayload?.userId ?? null })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  /** Approve or reject through the linked approval_request — one decision row, one status. */
  async decide(requisitionId: string, dto: DecideRequisitionDto, decision: 'APPROVED' | 'REJECTED', tenantId: string, userPayload?: { userId?: string }) {
    const mayDecide = await userHasPermission(this.db, { userId: userPayload?.userId, userType: (userPayload as unknown as { userType?: string })?.userType }, {
      moduleCode: REQUISITION_MODULE.moduleCode,
      resource: REQUISITION_MODULE.resource,
      action: 'approve',
    });
    if (!mayDecide) throw new ForbiddenException('You are not allowed to decide requisitions.');

    return withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select()
        .from(schema.requisition)
        .where(and(
          eq(schema.requisition.requisition_id, requisitionId),
          eq(schema.requisition.tenant_id, tenantId),
          isNull(schema.requisition.deleted_at),
          ...this.scopeConditions(),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
      if (row.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`Requisition ${row.req_no} is ${row.status}, not awaiting approval.`);
      }
      if (!row.approval_request_id) {
        throw new BadRequestException(`Requisition ${row.req_no} has no linked approval request.`);
      }
      if (decision === 'REJECTED' && !dto.rejection_reason?.trim()) {
        throw new BadRequestException('A rejection reason is required.');
      }

      if (decision === 'APPROVED') {
        await this.approvals.approve(row.approval_request_id, tenantId, userPayload);
      } else {
        await this.approvals.reject(row.approval_request_id, { rejection_reason: dto.rejection_reason }, tenantId, userPayload);
      }

      await this.db
        .update(schema.requisition)
        .set({
          status: decision,
          linked_po_no: decision === 'APPROVED' ? (dto.linked_po_no ?? row.linked_po_no) : row.linked_po_no,
          updated_by: userPayload?.userId ?? null,
        })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  /** §7.2 step 7: the D365BC PO number lands on the approved requisition. */
  async linkPo(requisitionId: string, linkedPoNo: string, tenantId: string, userPayload?: { userId?: string }) {
    const [row] = await this.db
      .select({ status: schema.requisition.status })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    if (row.status !== 'APPROVED') throw new BadRequestException('Only an approved requisition can receive a PO number.');
    await this.db
      .update(schema.requisition)
      .set({ linked_po_no: linkedPoNo, updated_by: userPayload?.userId ?? null })
      .where(eq(schema.requisition.requisition_id, requisitionId));
    return this.findOne(requisitionId, tenantId);
  }
}

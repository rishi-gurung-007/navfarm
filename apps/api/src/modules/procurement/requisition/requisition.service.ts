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
 *
 * Task 8 extends the document with the supplied common-requisition fields and
 * the three separate state dimensions (approval / document / fulfilment+inte-
 * gration). The legacy `status` column keeps being written on every transition
 * and keeps being returned; where the new columns are null — every row that
 * existed before this plan, and every FEED row the feed writer owns —
 * requisition.rules.ts projects the states from it on read.
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
import { CreateRequisitionDto, DecideRequisitionDto, UpdateRequisitionDto } from './dto/requisition.dto';
import { assertDepartmentIdentity } from '../../../common/department-identity';
import {
  COMMON_LIST_DOC_TYPES,
  assertDirectTransferEligible,
  assertEditable,
  assertPurpose,
  assertPurposeLocations,
  assertRequisitionLines,
  isSelfApproval,
  lineBalances,
  normalizeCommonDocType,
  projectRequisitionStates,
  releaseTransition,
  type RequisitionPurpose,
  reopenTransition,
} from './requisition.rules';

const REQUISITION_MODULE = { moduleCode: 'PROCUREMENT', resource: 'REQUISITION' } as const;

/** The approval-engine document type for a common requisition. */
export const COMMON_REQUISITION_DOC_TYPE = 'REQUISITION';

/** UTC, whole-second — the one timestamp convention approved_at/POSTED use. */
const nowTs = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');

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

  /**
   * D25: tells the approval engine what a decision on a common requisition
   * request does — the same state moves the requisition API's own endpoints
   * make, reached from the Approvals inbox. Registered at start-up so the
   * engine never imports this module (it imports the engine).
   */
  onModuleInit(): void {
    this.approvals.registerDocumentHandler(COMMON_REQUISITION_DOC_TYPE, {
      decide: (request, decision, remarks, tenantId, user) => this.decideFromApproval(request, decision, remarks, tenantId, user),
      withdraw: (request, tenantId, user) => this.withdrawFromApproval(request, tenantId, user),
    });
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

  async create(dto: CreateRequisitionDto, tenantId: string, userPayload?: { userId?: string }) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    // Rule failures come first: a refused document must not touch the database
    // at all, and every message below is a pure one from requisition.rules.ts.
    const docType = normalizeCommonDocType(dto.doc_type);
    const purpose = assertPurpose(docType, dto.purpose);
    assertRequisitionLines(docType, purpose, dto.lines);
    assertPurposeLocations(purpose, dto.from_location_id, dto.to_location_id);
    const directTransfer = Boolean(dto.direct_transfer);
    if (directTransfer) {
      assertDirectTransferEligible({ docType, purpose, fromLocationId: dto.from_location_id, toLocationId: dto.to_location_id });
    }

    // Requester snapshot: the name and department recorded on the document
    // stay as they are now while the source IDs stay for audit linkage. The
    // department falls back to the signed-in user's own identity.
    let requesterName: string | null = null;
    let requesterDepartmentId: string | null = null;
    if (userPayload?.userId) {
      const [requester] = await this.db
        .select({ full_name: schema.userMaster.full_name, department_id: schema.userMaster.department_id })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userPayload.userId))
        .limit(1);
      requesterName = requester?.full_name ?? null;
      requesterDepartmentId = dto.requester_department_id ?? requester?.department_id ?? null;
    } else {
      requesterDepartmentId = dto.requester_department_id ?? null;
    }

    // A department is a Cost Center Master row of type DEPARTMENT, never free
    // text (decisions, 1 Oct) — both identities are checked before any write.
    if (requesterDepartmentId) {
      await assertDepartmentIdentity(this.db, {
        tenantId, companyId: dto.company_id, departmentId: requesterDepartmentId, label: 'Requester department',
      });
    }
    if (dto.sender_department_id) {
      await assertDepartmentIdentity(this.db, {
        tenantId, companyId: dto.company_id, departmentId: dto.sender_department_id, label: 'Sender department',
      });
    }

    const scope = farmScope(this.cls);
    if (dto.farm_id) {
      await assertLocationOnActiveFarm(this.db, scope, dto.farm_id, 'Requisition farm');
    }
    const mainLocationId = dto.main_location_id ?? dto.farm_id ?? null;
    if (mainLocationId && mainLocationId !== dto.farm_id) {
      await assertLocationOnActiveFarm(this.db, scope, mainLocationId, 'Requisition main location');
    }
    if (dto.from_location_id) {
      await assertLocationOnActiveFarm(this.db, scope, dto.from_location_id, 'Requisition source location');
    }
    if (dto.to_location_id) {
      await assertLocationOnActiveFarm(this.db, scope, dto.to_location_id, 'Requisition destination location');
    }

    return withTenantTransaction(this.cls, async () => {
      const reqNo = await this.nextReqNo(dto.company_id, tenantId);
      const requisitionId = randomUUID();
      // Document date defaults to the creation clock (the same UTC date
      // created_at carries). A company-timezone default would need the Task 2
      // feed settings in this service; a supplied date is stored as given.
      const today = new Date().toISOString().slice(0, 10);
      await this.db.insert(schema.requisition).values({
        requisition_id: requisitionId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        farm_id: dto.farm_id ?? null,
        req_no: reqNo,
        doc_type: docType,
        status: 'DRAFT',
        // The three new dimensions start explicit on new documents; legacy
        // rows stay null and are projected on read.
        approval_status: 'OPEN',
        document_status: 'OPEN',
        fulfilment_status: 'NOT_APPLICABLE',
        integration_status: 'NOT_APPLICABLE',
        purpose,
        // decisions 1 Oct: a common draft is keyed by a person, so it is manual —
        // the self-approval rule keys on this (isSelfApproval).
        source: 'MANUAL_ENTRY',
        requisition_date: dto.requisition_date ?? today,
        main_location_id: mainLocationId,
        requester_user_id: userPayload?.userId ?? null,
        requester_name: requesterName,
        requester_department_id: requesterDepartmentId,
        sender_department_id: dto.sender_department_id ?? null,
        from_location_id: dto.from_location_id ?? null,
        to_location_id: dto.to_location_id ?? null,
        direct_transfer: directTransfer,
        remarks: dto.remarks ?? null,
        required_date: dto.required_date ?? null,
        justification: dto.justification ?? null,
        created_by: userPayload?.userId ?? null,
      });
      await this.db.insert(schema.requisitionLine).values(this.lineValues(requisitionId, purpose, dto.lines, dto));
      return this.findOne(requisitionId, tenantId);
    });
  }

  /** One insert row per supplied line — the mapping create() always used, shared with update(). */
  private lineValues(
    requisitionId: string,
    purpose: RequisitionPurpose,
    lines: CreateRequisitionDto['lines'],
    header: { from_location_id?: string | null; to_location_id?: string | null },
  ) {
    return lines.map((line, index) => {
      const balances = lineBalances(line);
      return {
        requisition_id: requisitionId,
        line_seq: index + 1,
        item_id: line.item_id ?? null,
        resource_id: line.resource_id ?? null,
        description: line.description ?? null,
        quantity: String(line.quantity),
        uom: line.uom,
        est_rate: line.est_rate !== undefined && line.est_rate !== null ? String(line.est_rate) : null,
        from_location_id: line.from_location_id ?? header.from_location_id ?? null,
        to_location_id: line.to_location_id ?? header.to_location_id ?? null,
        // A Store line records its authorized targets up front; a Purchase
        // line has no internal fulfilment, so its targets stay null.
        qty_to_ship: purpose === 'STORE' ? String(balances.qty_to_ship) : null,
        qty_to_receive: purpose === 'STORE' ? String(balances.qty_to_receive) : null,
        qty_shipped: null,
        qty_received: null,
      };
    });
  }

  /** Spec §6a: header and lines are editable while the document is Open. */
  async update(requisitionId: string, dto: UpdateRequisitionDto, tenantId: string, userPayload?: { userId?: string }) {
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
      assertEditable(row);
      if (dto.doc_type && dto.doc_type !== row.doc_type) {
        throw new BadRequestException('The document type cannot change; create a new requisition instead.');
      }
      const docType = normalizeCommonDocType(row.doc_type);
      const purpose = assertPurpose(docType, dto.purpose ?? row.purpose);
      assertRequisitionLines(docType, purpose, dto.lines);
      const fromLocationId = purpose === 'STORE' ? (dto.from_location_id ?? null) : null;
      const toLocationId = purpose === 'STORE' ? (dto.to_location_id ?? null) : null;
      assertPurposeLocations(purpose, fromLocationId, toLocationId);
      const directTransfer = Boolean(dto.direct_transfer);
      if (directTransfer) assertDirectTransferEligible({ docType, purpose, fromLocationId, toLocationId });
      for (const [id, label] of [[dto.requester_department_id, 'Requester department'], [dto.sender_department_id, 'Sender department']] as const) {
        if (id) await assertDepartmentIdentity(this.db, { tenantId, companyId: row.company_id, departmentId: id, label });
      }
      const scope = farmScope(this.cls);
      for (const [id, label] of [[dto.main_location_id, 'Requisition main location'], [fromLocationId, 'Requisition source location'], [toLocationId, 'Requisition destination location']] as const) {
        if (id) await assertLocationOnActiveFarm(this.db, scope, id, label);
      }
      await this.db
        .update(schema.requisition)
        .set({
          purpose,
          requisition_date: dto.requisition_date ?? row.requisition_date,
          main_location_id: dto.main_location_id ?? row.main_location_id,
          requester_department_id: dto.requester_department_id ?? row.requester_department_id,
          sender_department_id: dto.sender_department_id ?? null,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          direct_transfer: directTransfer,
          remarks: dto.remarks ?? null,
          required_date: dto.required_date ?? null,
          justification: dto.justification ?? null,
          updated_by: userPayload?.userId ?? null,
        })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      await this.db.delete(schema.requisitionLine).where(eq(schema.requisitionLine.requisition_id, requisitionId));
      await this.db.insert(schema.requisitionLine).values(
        this.lineValues(requisitionId, purpose, dto.lines, { from_location_id: fromLocationId, to_location_id: toLocationId }),
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
        from_location_id: schema.requisitionLine.from_location_id,
        to_location_id: schema.requisitionLine.to_location_id,
        qty_to_ship: schema.requisitionLine.qty_to_ship,
        qty_shipped: schema.requisitionLine.qty_shipped,
        qty_to_receive: schema.requisitionLine.qty_to_receive,
        qty_received: schema.requisitionLine.qty_received,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
      })
      .from(schema.requisitionLine)
      .leftJoin(schema.itemMaster, eq(schema.requisitionLine.item_id, schema.itemMaster.item_id))
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    return {
      ...row,
      // Explicit columns win; nulls (legacy and FEED rows) project from
      // `status`. The stored status itself is returned untouched.
      ...projectRequisitionStates(row),
      lines: lines.map((line) => {
        const balances = lineBalances(line);
        return {
          ...line,
          // Counted quantities come back as numbers (null means none yet);
          // the stored targets stay exactly as written, and the two derived
          // balances are computed, never persisted.
          qty_shipped: balances.qty_shipped,
          qty_received: balances.qty_received,
          balance_to_ship: balances.balance_to_ship,
          remaining_to_receive: balances.remaining_to_receive,
        };
      }),
    };
  }

  async findAll(query: { company_id?: string; status?: string; doc_type?: string }, tenantId: string) {
    if (query.doc_type && !(COMMON_LIST_DOC_TYPES as readonly string[]).includes(query.doc_type)) {
      throw new BadRequestException(`doc_type must be one of ${COMMON_LIST_DOC_TYPES.join(', ')}.`);
    }
    const conditions = [
      eq(schema.requisition.tenant_id, tenantId),
      isNull(schema.requisition.deleted_at),
      ...this.scopeConditions(),
    ];
    if (query.company_id) conditions.push(eq(schema.requisition.company_id, query.company_id));
    if (query.status) conditions.push(eq(schema.requisition.status, query.status));
    if (query.doc_type) conditions.push(eq(schema.requisition.doc_type, query.doc_type));
    const rows = await this.db
      .select({
        requisition_id: schema.requisition.requisition_id,
        req_no: schema.requisition.req_no,
        doc_type: schema.requisition.doc_type,
        purpose: schema.requisition.purpose,
        source: schema.requisition.source,
        status: schema.requisition.status,
        farm_id: schema.requisition.farm_id,
        farm_code: schema.locationMaster.location_code,
        required_date: schema.requisition.required_date,
        approval_request_id: schema.requisition.approval_request_id,
        linked_po_no: schema.requisition.linked_po_no,
        requisition_date: schema.requisition.requisition_date,
        approval_status: schema.requisition.approval_status,
        document_status: schema.requisition.document_status,
        fulfilment_status: schema.requisition.fulfilment_status,
        integration_status: schema.requisition.integration_status,
        created_at: schema.requisition.created_at,
        line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
      })
      .from(schema.requisition)
      .leftJoin(schema.locationMaster, eq(schema.requisition.farm_id, schema.locationMaster.location_id))
      .where(and(...conditions))
      .orderBy(desc(schema.requisition.created_at))
      .limit(200);
    // List responses carry the projected states beside the legacy status too.
    return rows.map((row) => ({ ...row, ...projectRequisitionStates(row) }));
  }

  /**
   * DRAFT → PENDING_APPROVAL, raising the linked approval_request (§17.2).
   * The request carries the document_id, so the inbox decides it through the
   * registered handler; a farm requisition is visible to that farm's
   * approvers, a company-level one to unrestricted approvers (D25).
   */
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
      if (row.doc_type === 'FEED') {
        throw new BadRequestException('A feed requisition is submitted from the Feed Forecast page, not here.');
      }
      if (row.status !== 'DRAFT') throw new BadRequestException(`Requisition ${row.req_no} is ${row.status} and cannot be submitted.`);

      const requestId = await this.approvals.submitFarmDocument(
        {
          documentType: COMMON_REQUISITION_DOC_TYPE,
          documentId: row.requisition_id,
          documentNo: row.req_no,
          farmId: row.farm_id ?? undefined,
          companyId: row.company_id,
          title: `Requisition ${row.req_no}${note ? ` — ${note}` : ''}`,
          urgency: 'MEDIUM',
          itemOrStage: row.doc_type,
          justification: row.justification ?? undefined,
        },
        tenantId,
        userPayload,
      );
      await this.db
        .update(schema.requisition)
        .set({ status: 'PENDING_APPROVAL', approval_status: 'PENDING_APPROVAL', document_status: 'OPEN', approval_request_id: requestId, updated_by: userPayload?.userId ?? null })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  /** Approve or reject through the linked approval_request — one decision row, one status. */
  async decide(requisitionId: string, dto: DecideRequisitionDto, decision: 'APPROVED' | 'REJECTED', tenantId: string, userPayload?: { userId?: string; email?: string; userType?: string }) {
    const mayDecide = await userHasPermission(this.db, { userId: userPayload?.userId, userType: userPayload?.userType }, {
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
      // D25 (Rishi, 1 Oct): a person may not approve a requisition they
      // created — the rule keys on how the document was raised and who raised
      // it, not on the user's type, so an admin is refused on their own manual
      // document exactly like anyone else.
      if (decision === 'APPROVED' && isSelfApproval(row, userPayload?.userId)) {
        throw new ForbiddenException('You may not approve a requisition you created. Another authorized approver must decide it.');
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
          // The three dimensions move together; `status` stays the legacy
          // projection old callers read. A rejection returns the document to
          // Open for correction while the decision history stays on the
          // approval request and in `status` (decisions.md, 1 Oct).
          approval_status: decision,
          document_status: decision === 'APPROVED' ? 'APPROVED' : 'OPEN',
          linked_po_no: decision === 'APPROVED' ? (dto.linked_po_no ?? row.linked_po_no) : row.linked_po_no,
          // §6a header view "approved by/at" (Req. rows 37–38 on the feed side).
          approved_by: decision === 'APPROVED' ? (userPayload?.userId ?? null) : null,
          approved_at: decision === 'APPROVED' ? nowTs() : null,
          updated_by: userPayload?.userId ?? null,
        })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  /**
   * Release (Task 9, decisions 1 Oct): the control that authorizes fulfilment
   * after approval — never a consequence of it. An approved Purchase records
   * BC_PENDING; an approved Store becomes TRANSFER_OPEN, the state Task 10's
   * shipments draw against.
   *
   * Who may release: Procurement for a Purchase document; the sender
   * department (the requester's own department identity, falling back to the
   * REQ/REQUISITION create grant when the document carries no department) for
   * a Store document. The document is locked FOR UPDATE inside the tenant
   * transaction, so two concurrent releases cannot both pass the state check.
   */
  async release(requisitionId: string, tenantId: string, userPayload?: { userId?: string; userType?: string }) {
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
      if (row.doc_type === 'FEED') {
        throw new BadRequestException('A feed requisition is released by the Feed Mill Manager after mill consolidation; feed stops at Approved for now.');
      }
      if (row.purpose === 'PURCHASE') {
        await this.assertReleasePurchase(userPayload);
      } else {
        await this.assertReleaseStore(row, userPayload);
      }
      const transition = releaseTransition({ ...row, purpose: row.purpose });
      await this.db
        .update(schema.requisition)
        .set({
          ...transition,
          released_by: userPayload?.userId ?? null,
          released_at: nowTs(),
          updated_by: userPayload?.userId ?? null,
        })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  private async assertReleasePurchase(userPayload?: { userId?: string; userType?: string }): Promise<void> {
    const may = await userHasPermission(this.db, userPayload, { moduleCode: 'PROCUREMENT', resource: 'REQUISITION', action: 'approve' });
    if (!may) throw new ForbiddenException('Only Procurement may release a Purchase requisition.');
  }

  private async assertReleaseStore(
    row: typeof schema.requisition.$inferSelect,
    userPayload?: { userId?: string; userType?: string },
  ): Promise<void> {
    // The sender department releases the transfer. The requester's own
    // department identity decides; without one on the document (legacy rows),
    // the create grant on REQ/REQUISITION is the fallback authority.
    if (row.sender_department_id && userPayload?.userId) {
      const [user] = await this.db
        .select({ department_id: schema.userMaster.department_id })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userPayload.userId))
        .limit(1);
      if (user?.department_id && user.department_id !== row.sender_department_id) {
        throw new ForbiddenException('Only the sender department may release a Store requisition.');
      }
      if (user?.department_id) return;
    }
    const may = await userHasPermission(this.db, userPayload, { moduleCode: 'PROCUREMENT', resource: 'REQUISITION', action: 'create' });
    if (!may) throw new ForbiddenException('Only the sender department may release a Store requisition.');
  }

  /**
   * Reopen a rejected requisition: back to an editable Open draft. The decided
   * approval request is detached — a new submit raises a new one — and the
   * decision history stays on the old request and in the audit trail.
   */
  async reopen(requisitionId: string, tenantId: string, userPayload?: { userId?: string }) {
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
      if (row.status !== 'REJECTED' && row.approval_status !== 'REJECTED') {
        throw new BadRequestException('Only a rejected requisition can be reopened.');
      }
      await this.db
        .update(schema.requisition)
        .set({ ...reopenTransition(), updated_by: userPayload?.userId ?? null })
        .where(eq(schema.requisition.requisition_id, requisitionId));
      return this.findOne(requisitionId, tenantId);
    });
  }

  // ---------------------------------------------------------------------------
  // The Approvals inbox's view of a common requisition (D25 handler). The
  // request is locked by the engine; these methods move the document inside
  // that same transaction.
  // ---------------------------------------------------------------------------

  private async lockForApproval(request: { request_id: string; document_id: string | null; company_id: string }, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, request.document_id ?? ''),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.company_id, request.company_id),
        isNull(schema.requisition.deleted_at),
      ))
      .limit(1)
      .for('update');
    if (!row || row.approval_request_id !== request.request_id) {
      throw new NotFoundException('Requisition not found.');
    }
    if (row.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Requisition ${row.req_no} is not waiting for this approval.`);
    }
    return row;
  }

  private async decideFromApproval(
    request: { request_id: string; document_id: string | null; company_id: string; requested_by: string | null },
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<void> {
    const row = await this.lockForApproval(request, tenantId);
    // D25 (Rishi, 1 Oct): a person may not approve a requisition they created.
    // The shared isSelfApproval rule applies: a manual or legacy-sourceless
    // draft is refused to its creator; only an AUTO_FORECAST draft is exempt.
    if (decision === 'APPROVED' && isSelfApproval(row, userPayload?.userId)) {
      throw new ForbiddenException('You may not approve a requisition you created. Another authorized approver must decide it.');
    }
    if (decision === 'REJECTED' && !remarks?.trim()) {
      throw new BadRequestException('A rejection reason is required.');
    }
    await this.db
      .update(schema.requisition)
      .set({
        status: decision,
        approval_status: decision,
        document_status: decision === 'APPROVED' ? 'APPROVED' : 'OPEN',
        // §6a header view "approved by/at" (Req. rows 37–38 on the feed side).
        approved_by: decision === 'APPROVED' ? (userPayload?.userId ?? null) : null,
        approved_at: decision === 'APPROVED' ? nowTs() : null,
        updated_by: userPayload?.userId ?? null,
      })
      .where(eq(schema.requisition.requisition_id, row.requisition_id));
  }

  /** A withdrawn request hands the requisition back as an Open draft. */
  private async withdrawFromApproval(
    request: { request_id: string; document_id: string | null; company_id: string },
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<void> {
    const row = await this.lockForApproval(request, tenantId);
    await this.db
      .update(schema.requisition)
      .set({
        status: 'DRAFT',
        approval_status: 'OPEN',
        document_status: 'OPEN',
        approval_request_id: null,
        updated_by: userPayload?.userId ?? null,
      })
      .where(eq(schema.requisition.requisition_id, row.requisition_id));
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

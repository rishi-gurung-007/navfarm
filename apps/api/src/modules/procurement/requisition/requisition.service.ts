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
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmScope, assertCompanyInScope, assertLocationOnActiveFarm } from '../../../common/farm-scope';
import { userHasPermission } from '../../../common/permissions';
import { ApprovalService } from '../../production/approval/approval.service';
import { StockTransferService } from '../../inventory/stock-transfer/stock-transfer.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import * as schema from '../../../core/database/schema';
import { CreateRequisitionDto, DecideRequisitionDto, RequisitionReceiptDto, RequisitionShipmentDto, UpdateRequisitionDto } from './dto/requisition.dto';
import { assertDepartmentIdentity, DEPARTMENT_COST_CENTER_TYPE } from '../../../common/department-identity';
import {
  COMMON_LIST_DOC_TYPES,
  assertDirectTransferEligible,
  assertEditable,
  assertNotFeedRequisition,
  assertPurpose,
  assertPurposeLocations,
  assertRequisitionLines,
  isSelfApproval,
  lineBalances,
  mapToTransferLines,
  normalizeCommonDocType,
  projectRequisitionStates,
  releaseTransition,
  type RequisitionPurpose,
  reopenTransition,
  transferPlanFor,
} from './requisition.rules';

const REQUISITION_MODULE = { moduleCode: 'PROCUREMENT', resource: 'REQUISITION' } as const;

/** The Number Series master key of a common requisition (series code and document type). */
export const REQUISITION_SERIES = 'REQUISITION';

/** The approval-engine document type for a common requisition. */
export const COMMON_REQUISITION_DOC_TYPE = 'REQUISITION';

/** UTC, whole-second — the one timestamp convention approved_at/POSTED use. */
const nowTs = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class RequisitionService {
  constructor(
    private readonly cls: ClsService,
    private readonly approvals: ApprovalService,
    // Part E: a Store release creates its transfer through the transfer
    // service, not a second writer. Required — not @Optional() — so a
    // mis-wired module fails loudly at boot instead of releasing Store
    // requisitions with no transfer created (ruling, 4 Oct: see Part A
    // Task 4 for the identical call on an @Optional() settings service).
    private readonly stockTransfers: StockTransferService,
    // Task 16: a common requisition's number is issued by the company's
    // REQUISITION Number Series. Required for the same reason as above.
    private readonly numberSeries: NumberSeriesService,
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
    // A selected company is a boundary for company admins as well as restricted
    // users (farm-scope.ts batchReferenceScopeConditions): every list, read and
    // change of a requisition stays inside it. Task 13 fix round 1 — mounting
    // /requisition made this reachable.
    if (scope.companyId) conditions.push(eq(schema.requisition.company_id, scope.companyId));
    if (scope.restricted && scope.lobId) {
      conditions.push(sql`${schema.requisition.company_id} IN (SELECT company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ${scope.lobId})`);
    }
    return conditions;
  }

  /**
   * The number of a new common requisition. It comes from the company's own
   * REQUISITION Number Series (decision 2026-10-01: Common Purchase and Feed
   * Requisitions use separate company-owned series), issued on the create
   * transaction so generateNext's row lock holds until the insert commits and
   * two creates never share a number.
   *
   * A company with no requisition series keeps REQ-YYYY-NNNN, as masters do
   * until a series is configured; nothing is seeded for it. Feed requisitions
   * are numbered by feed-requisition.service (REQ-<FarmCode>-YYYY-NNNNN).
   */
  private async nextReqNo(companyId: string, tenantId: string): Promise<string> {
    const series = await this.numberSeries.resolveSeriesFor(REQUISITION_SERIES, null, tenantId, companyId, this.db);
    const year = new Date().getFullYear();
    const prefix = `REQ-${year}-`;
    let fallbackSeq = 0;
    if (!series) {
      const [last] = await this.db
        .select({ req_no: schema.requisition.req_no })
        .from(schema.requisition)
        .where(and(eq(schema.requisition.tenant_id, tenantId), eq(schema.requisition.company_id, companyId), sql`${schema.requisition.req_no} LIKE ${prefix + '%'}`))
        .orderBy(desc(schema.requisition.req_no))
        .limit(1);
      const lastSeq = last?.req_no ? Number(last.req_no.slice(prefix.length)) : 0;
      fallbackSeq = Number.isFinite(lastSeq) ? lastSeq : 0;
    }
    // req_no is unique across the tenant, but neither the series service nor
    // the per-company fallback can see another company's numbers, so every
    // candidate is checked and a taken one is skipped. (A series' counter has
    // already advanced, so no number is issued twice and none is renumbered.)
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = series
        ? await this.numberSeries.generateNext(series, tenantId, companyId, this.db)
        : `${prefix}${String(++fallbackSeq).padStart(4, '0')}`;
      const [clash] = await this.db
        .select({ requisition_id: schema.requisition.requisition_id })
        .from(schema.requisition)
        .where(and(eq(schema.requisition.tenant_id, tenantId), eq(schema.requisition.req_no, candidate)))
        .limit(1);
      if (!clash) return candidate;
    }
    throw new BadRequestException('Could not find an unused requisition number. Check the requisition number series prefix and next number.');
  }

  async create(dto: CreateRequisitionDto, tenantId: string, userPayload?: { userId?: string }) {
    assertNotFeedRequisition(dto.doc_type, 'created');
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

    await this.assertLineReferences(tenantId, dto.company_id, dto.lines);

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

  /**
   * A line may name only this company's active items and resources. The ids
   * arrive from the client, so they are checked here rather than trusted - a
   * same-tenant row from another company would otherwise leak its code/name
   * through findOne.
   */
  private async assertLineReferences(
    tenantId: string,
    companyId: string,
    lines: Array<{ item_id?: string | null; resource_id?: string | null }>,
  ) {
    const itemIds = [...new Set(lines.map((l) => l.item_id).filter((v): v is string => !!v))];
    if (itemIds.length) {
      const found = new Set((await this.db
        .select({ item_id: schema.itemMaster.item_id })
        .from(schema.itemMaster)
        .where(and(
          eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.company_id, companyId),
          eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at),
          inArray(schema.itemMaster.item_id, itemIds),
        ))).map((r) => r.item_id));
      const at = lines.findIndex((l) => l.item_id && !found.has(l.item_id));
      if (at >= 0) throw new BadRequestException(`Line ${at + 1}: item is not an active item of this company.`);
    }
    const resourceIds = [...new Set(lines.map((l) => l.resource_id).filter((v): v is string => !!v))];
    if (resourceIds.length) {
      const found = new Set((await this.db
        .select({ resource_id: schema.resourceMaster.resource_id })
        .from(schema.resourceMaster)
        .where(and(
          eq(schema.resourceMaster.tenant_id, tenantId), eq(schema.resourceMaster.company_id, companyId),
          eq(schema.resourceMaster.is_active, true), isNull(schema.resourceMaster.deleted_at),
          inArray(schema.resourceMaster.resource_id, resourceIds),
        ))).map((r) => r.resource_id));
      const at = lines.findIndex((l) => l.resource_id && !found.has(l.resource_id));
      if (at >= 0) throw new BadRequestException(`Line ${at + 1}: resource is not an active resource of this company.`);
    }
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
      // assertEditable refuses FEED first, through the shared assertNotFeedRequisition.
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
      await this.assertLineReferences(tenantId, row.company_id, dto.lines);
      // Kept when omitted: purpose, requisition_date, main_location_id, requester_department_id. Cleared when omitted: sender_department_id, remarks, required_date, justification, direct_transfer.
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

  /** Location types a common requisition may move between — ours (no document lists them). */
  private static readonly REQUISITION_LOCATION_TYPES = ['FARM', 'STORE', 'SHED', 'SILO'];

  async options(query: { company_id: string; farm_id?: string }, tenantId: string) {
    assertCompanyInScope(farmScope(this.cls), query.company_id);
    const scopeFarm = farmScope(this.cls).farmId ?? query.farm_id ?? null;
    const items = await this.db
      .select({ item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, uom_primary: schema.itemMaster.uom_primary })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.company_id, query.company_id), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
      .orderBy(schema.itemMaster.item_code);
    const resources = await this.db
      .select({ resource_id: schema.resourceMaster.resource_id, resource_code: schema.resourceMaster.resource_code, resource_name: schema.resourceMaster.resource_name })
      .from(schema.resourceMaster)
      .where(and(eq(schema.resourceMaster.tenant_id, tenantId), eq(schema.resourceMaster.company_id, query.company_id), eq(schema.resourceMaster.is_active, true), isNull(schema.resourceMaster.deleted_at)))
      .orderBy(schema.resourceMaster.resource_code);
    const locationConditions: SQL[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, query.company_id),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      inArray(schema.locationMaster.location_type, RequisitionService.REQUISITION_LOCATION_TYPES),
    ];
    const lobScope = farmScope(this.cls);
    if (lobScope.restricted && lobScope.lobId) {
      locationConditions.push(or(eq(schema.locationMaster.lob_id, lobScope.lobId), isNull(schema.locationMaster.lob_id))!);
    }
    if (scopeFarm) locationConditions.push(or(eq(schema.locationMaster.farm_id, scopeFarm), eq(schema.locationMaster.location_id, scopeFarm))!);
    const locations = await this.db
      .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name, location_type: schema.locationMaster.location_type, farm_id: schema.locationMaster.farm_id })
      .from(schema.locationMaster)
      .where(and(...locationConditions))
      .orderBy(schema.locationMaster.location_code);
    const departments = await this.db
      .select({ cost_center_id: schema.costCenterMaster.cost_center_id, cost_center_code: schema.costCenterMaster.cost_center_code, cost_center_name: schema.costCenterMaster.cost_center_name })
      .from(schema.costCenterMaster)
      .where(and(eq(schema.costCenterMaster.tenant_id, tenantId), eq(schema.costCenterMaster.company_id, query.company_id), eq(schema.costCenterMaster.cost_center_type, DEPARTMENT_COST_CENTER_TYPE), eq(schema.costCenterMaster.is_active, true), isNull(schema.costCenterMaster.deleted_at)))
      .orderBy(schema.costCenterMaster.cost_center_code);
    return { items, resources, locations, departments };
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
    const ids = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))];
    const locationIds = ids([row.main_location_id, row.from_location_id, row.to_location_id, ...lines.flatMap((l) => [l.from_location_id, l.to_location_id])]);
    const locationCode = new Map((locationIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code })
        .from(schema.locationMaster).where(and(eq(schema.locationMaster.tenant_id, tenantId), eq(schema.locationMaster.company_id, row.company_id), inArray(schema.locationMaster.location_id, locationIds)))
      : []).map((l) => [l.location_id, l.location_code]));
    const departmentIds = ids([row.requester_department_id, row.sender_department_id]);
    const departmentName = new Map((departmentIds.length
      ? await this.db.select({ cost_center_id: schema.costCenterMaster.cost_center_id, cost_center_name: schema.costCenterMaster.cost_center_name })
        .from(schema.costCenterMaster).where(and(eq(schema.costCenterMaster.tenant_id, tenantId), eq(schema.costCenterMaster.company_id, row.company_id), inArray(schema.costCenterMaster.cost_center_id, departmentIds)))
      : []).map((d) => [d.cost_center_id, d.cost_center_name]));
    const userIds = ids([row.approved_by, row.released_by]);
    const userName = new Map((userIds.length
      ? await this.db.select({ user_id: schema.userMaster.user_id, full_name: schema.userMaster.full_name })
        .from(schema.userMaster).where(and(eq(schema.userMaster.tenant_id, tenantId), inArray(schema.userMaster.user_id, userIds)))
      : []).map((u) => [u.user_id, u.full_name]));
    const [transfer] = row.linked_transfer_id
      ? await this.db.select({ transfer_id: schema.stockTransfer.transfer_id, transfer_no: schema.stockTransfer.transfer_no })
        .from(schema.stockTransfer).where(eq(schema.stockTransfer.transfer_id, row.linked_transfer_id)).limit(1)
      : [];
    const resourceIds = ids(lines.map((l) => l.resource_id));
    const resource = new Map((resourceIds.length
      ? await this.db.select({ resource_id: schema.resourceMaster.resource_id, resource_code: schema.resourceMaster.resource_code, resource_name: schema.resourceMaster.resource_name })
        .from(schema.resourceMaster).where(and(eq(schema.resourceMaster.tenant_id, tenantId), eq(schema.resourceMaster.company_id, row.company_id), inArray(schema.resourceMaster.resource_id, resourceIds)))
      : []).map((r) => [r.resource_id, r]));
    // Task 7: the linked transfer's shipments, each with its lines' requisition
    // line id and shipped/received/remaining — empty for a requisition with no
    // linked transfer, or one not yet shipped against.
    let shipments: Array<{ shipment_id: string; shipment_no: string; shipment_date: string; lines: Array<{ requisition_line_id: string; shipped: number; received: number; remaining: number }> }> = [];
    if (row.linked_transfer_id) {
      const shipped = await this.db
        .select({
          shipment_id: schema.transferShipment.shipment_id, shipment_no: schema.transferShipment.shipment_no, shipment_date: schema.transferShipment.shipment_date,
          shipment_line_id: schema.transferShipmentLine.shipment_line_id, requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: schema.transferShipmentLine.quantity,
        })
        .from(schema.transferShipment)
        .innerJoin(schema.transferShipmentLine, eq(schema.transferShipmentLine.shipment_id, schema.transferShipment.shipment_id))
        .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferShipmentLine.line_id))
        .where(and(eq(schema.transferShipment.transfer_id, row.linked_transfer_id), isNull(schema.transferShipment.deleted_at)))
        .orderBy(schema.transferShipment.shipment_no);
      const receivedRows = await this.db
        .select({ shipment_line_id: schema.transferReceiptLine.shipment_line_id, qty: sql<string>`SUM(${schema.transferReceiptLine.quantity})` })
        .from(schema.transferReceiptLine)
        .innerJoin(schema.transferReceipt, eq(schema.transferReceipt.receipt_id, schema.transferReceiptLine.receipt_id))
        .where(and(eq(schema.transferReceipt.transfer_id, row.linked_transfer_id), isNull(schema.transferReceipt.deleted_at)))
        .groupBy(schema.transferReceiptLine.shipment_line_id);
      const receivedOf = new Map(receivedRows.map((r) => [r.shipment_line_id, Number(r.qty)]));
      const byShipment = new Map<string, (typeof shipments)[number]>();
      for (const s of shipped) {
        const entry = byShipment.get(s.shipment_id) ?? { shipment_id: s.shipment_id, shipment_no: s.shipment_no, shipment_date: s.shipment_date, lines: [] };
        const shippedQty = Number(s.qty);
        const receivedQty = receivedOf.get(s.shipment_line_id) ?? 0;
        entry.lines.push({ requisition_line_id: s.requisition_line_id ?? '', shipped: shippedQty, received: receivedQty, remaining: shippedQty - receivedQty });
        byShipment.set(s.shipment_id, entry);
      }
      shipments = [...byShipment.values()];
    }
    return {
      ...row,
      main_location_code: locationCode.get(row.main_location_id ?? '') ?? null,
      from_location_code: locationCode.get(row.from_location_id ?? '') ?? null,
      to_location_code: locationCode.get(row.to_location_id ?? '') ?? null,
      requester_department_name: departmentName.get(row.requester_department_id ?? '') ?? null,
      sender_department_name: departmentName.get(row.sender_department_id ?? '') ?? null,
      approved_by_name: userName.get(row.approved_by ?? '') ?? null,
      released_by_name: userName.get(row.released_by ?? '') ?? null,
      linked_transfer_no: transfer?.transfer_no ?? null,
      shipments,
      // Explicit columns win; nulls (legacy and FEED rows) project from
      // `status`. The stored status itself is returned untouched.
      ...projectRequisitionStates(row),
      lines: lines.map((line) => {
        const balances = lineBalances(line);
        return {
          ...line,
          from_location_code: locationCode.get(line.from_location_id ?? '') ?? null,
          to_location_code: locationCode.get(line.to_location_id ?? '') ?? null,
          resource_code: resource.get(line.resource_id ?? '')?.resource_code ?? null,
          resource_name: resource.get(line.resource_id ?? '')?.resource_name ?? null,
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
    if (query.company_id) assertCompanyInScope(farmScope(this.cls), query.company_id);
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
      assertNotFeedRequisition(row.doc_type, 'submitted');
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
      assertNotFeedRequisition(row.doc_type, decision === 'APPROVED' ? 'approved' : 'rejected');
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
      // Feed is released by the Feed Mill Manager after mill consolidation and
      // stops at Approved for now — never through this route.
      assertNotFeedRequisition(row.doc_type, 'released');
      if (row.purpose === 'PURCHASE') {
        await this.assertReleasePurchase(userPayload);
      } else {
        await this.assertReleaseStore(row, userPayload);
      }
      const transition = releaseTransition({ ...row, purpose: row.purpose });
      // Part E (decisions 1 Oct: "Store release starts an internal transfer"):
      // a released Store requisition has nothing to ship against unless its
      // transfer exists too, so the transfer is created here, inside this same
      // withTenantTransaction block. StockTransferService.create() wraps its
      // own work in withTenantTransaction, which (common/tenant-transaction.ts)
      // detects the already-open 'tenantPostingTransaction' CLS flag and joins
      // this transaction instead of opening a second one — so a failure in
      // either write rolls back both; there is no window where one commits
      // without the other.
      // Fix round 1 (coordinator, 4 Oct): a Purchase document never gets a
      // transfer, so this is a `const` with a ternary rather than a `let`
      // initialized to the old link and then unconditionally overwritten on
      // the only reachable Store path — there is no "preserve the existing
      // link" case to imply.
      const linkedTransferId: string | null = row.purpose === 'PURCHASE'
        ? (row.linked_transfer_id ?? null)
        : await (async () => {
          const lines = await this.db
            .select({
              line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq, item_id: schema.requisitionLine.item_id,
              quantity: schema.requisitionLine.quantity, uom: schema.requisitionLine.uom, qty_to_ship: schema.requisitionLine.qty_to_ship,
              from_location_id: schema.requisitionLine.from_location_id, to_location_id: schema.requisitionLine.to_location_id,
            })
            .from(schema.requisitionLine)
            .where(eq(schema.requisitionLine.requisition_id, requisitionId))
            .orderBy(schema.requisitionLine.line_seq);
          const plan = transferPlanFor(row, lines);
          const transfer = await this.stockTransfers.create({
            company_id: row.company_id,
            posting_date: nowTs().slice(0, 10),
            from_warehouse_id: plan.fromLocationId,
            to_warehouse_id: plan.toLocationId,
            remarks: `Requisition ${row.req_no}`,
            lines: plan.lines,
          } as any, tenantId, userPayload);
          return transfer.transfer_id;
        })();
      await this.db
        .update(schema.requisition)
        .set({
          ...transition,
          linked_transfer_id: linkedTransferId,
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

  // ---------------------------------------------------------------------------
  // Shipping and receiving from the requisition (Task 7): the requisition
  // lines follow its linked transfer's events. The endpoints reuse the
  // transfer's own permission pair (INVENTORY/STOCK_TRANSFER/edit, bound in
  // the controller) — no new permission pair, so role-permissions-coverage
  // holds. StockTransferService does the actual posting (ledger, GL, status);
  // syncRequisitionFulfilment, called from inside that same transaction, is
  // what writes qty_shipped/qty_received back here.
  // ---------------------------------------------------------------------------

  /** A released Store requisition's linked transfer and its lines, locked through the transfer service's own load. */
  private async releasedStore(requisitionId: string, tenantId: string) {
    const [row] = await this.db.select().from(schema.requisition)
      .where(and(eq(schema.requisition.requisition_id, requisitionId), eq(schema.requisition.tenant_id, tenantId), isNull(schema.requisition.deleted_at), ...this.scopeConditions()))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    assertNotFeedRequisition(row.doc_type, 'shipped or received');
    const states = projectRequisitionStates(row);
    if (row.purpose !== 'STORE' || states.document_status !== 'RELEASED' || !row.linked_transfer_id) {
      throw new BadRequestException('Only a released Store requisition ships and receives; release it first.');
    }
    const transferLines = await this.db
      .select({ line_id: schema.stockTransferLine.line_id, requisition_line_id: schema.stockTransferLine.requisition_line_id })
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, row.linked_transfer_id));
    return { row, transferId: row.linked_transfer_id, transferLines };
  }

  async ship(requisitionId: string, dto: RequisitionShipmentDto, tenantId: string, userPayload?: { userId?: string }) {
    const { transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    await this.stockTransfers.postShipment(transferId, { posting_date: dto.posting_date, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId);
  }

  async receive(requisitionId: string, dto: RequisitionReceiptDto, tenantId: string, userPayload?: { userId?: string }) {
    const { transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    await this.stockTransfers.postReceipt(transferId, { posting_date: dto.posting_date, shipment_id: dto.shipment_id, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId);
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
      assertNotFeedRequisition(row.doc_type, 'reopened');
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
    // Defence in depth: this handler is registered for REQUISITION requests
    // only (the feed's are FEED_REQUISITION), but a feed row is never moved
    // from here even if a request were mis-linked to one.
    assertNotFeedRequisition(row.doc_type, 'decided');
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
      .select({ status: schema.requisition.status, doc_type: schema.requisition.doc_type })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    assertNotFeedRequisition(row.doc_type, 'given a PO number');
    if (row.status !== 'APPROVED') throw new BadRequestException('Only an approved requisition can receive a PO number.');
    await this.db
      .update(schema.requisition)
      .set({ linked_po_no: linkedPoNo, updated_by: userPayload?.userId ?? null })
      .where(eq(schema.requisition.requisition_id, requisitionId));
    return this.findOne(requisitionId, tenantId);
  }
}

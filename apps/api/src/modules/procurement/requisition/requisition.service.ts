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
import { farmScope, assertCompanyInScope, assertLocationOnActiveFarm, farmOfLocation, requisitionFarmLobCondition } from '../../../common/farm-scope';
import { userHasPermission } from '../../../common/permissions';
import { ApprovalService } from '../../production/approval/approval.service';
import { StockTransferService } from '../../inventory/stock-transfer/stock-transfer.service';
import { assertTrackingForShipment } from '../../inventory/stock-transfer/transfer-execution.rules';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import * as schema from '../../../core/database/schema';
import { CreateRequisitionDto, DecideRequisitionDto, RequisitionReceiptDto, RequisitionShipmentDto, RequisitionTrackingDto, UpdateRequisitionDto } from './dto/requisition.dto';
import { assertDepartmentIdentity, DEPARTMENT_COST_CENTER_TYPE } from '../../../common/department-identity';
import {
  COMMON_LIST_DOC_TYPES,
  assertDirectTransfer,
  assertDirectTransferEligible,
  assertEditable,
  assertNotFeedRequisition,
  assertPostingDepartment,
  assertPurpose,
  assertPurposeLocations,
  assertReceiptByRequester,
  assertRequisitionLines,
  isRequisitionRequester,
  isSelfApproval,
  selfApprovalSql,
  lineBalances,
  mapToTransferLines,
  resolveTrackingAssignment,
  assertTrackingFieldsMatchItem,
  mayDecideAnyRequisition,
  maySelfApprove,
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
   * `FEED` predates the unified document and remains a safe persistence
   * discriminator while the feed workflow is migrated. It is not a fourth
   * user-facing requisition type: feed is Item, and `source` says how it was
   * created. `requisition_kind` lets clients select the richer feed document
   * without exposing the storage discriminator as a business type.
   */
  private publicDocument<T extends { doc_type: string }>(row: T): T & { doc_type: string; requisition_kind: 'FEED' | 'COMMON' } {
    const feed = row.doc_type === 'FEED';
    return { ...row, doc_type: feed ? 'ITEM' : row.doc_type, requisition_kind: feed ? 'FEED' : 'COMMON' };
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

  /**
   * `bypassFarm` (decisions.md 2026-10-04, second entry): a TENANT_ADMIN or
   * COMPANY_ADMIN deciding a requisition is not limited to whichever farm
   * happens to be active in their session — every other read/write of a
   * requisition (create, list, update, release, …) keeps the ordinary
   * active-farm narrowing, which is why this is an explicit opt-in at the one
   * call site (decide()) that needs it, not a change to the default. The
   * company boundary below is unconditional either way.
   */
  private scopeConditions(opts: { bypassFarm?: boolean } = {}) {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId && !opts.bypassFarm) conditions.push(eq(schema.requisition.farm_id, scope.farmId));
    // A selected company is a boundary for company admins as well as restricted
    // users (farm-scope.ts batchReferenceScopeConditions): every list, read and
    // change of a requisition stays inside it. Task 13 fix round 1 — mounting
    // /requisition made this reachable. Unaffected by bypassFarm: an admin's
    // extra reach is "any farm", never "any company".
    if (scope.companyId) conditions.push(eq(schema.requisition.company_id, scope.companyId));
    // WP1e (decisions.md 2026-10-04, last entry): the LOB boundary is the
    // requisition's farm's (location_master.lob_id), via the one shared helper
    // — the old raw-SQL filter read company_master.lob_id, a column that
    // exists in no database, which 500d every restricted user's read.
    const lob = requisitionFarmLobCondition(scope, schema.requisition.farm_id);
    if (lob) conditions.push(lob);
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
    let callerDirectTransferAllowed = false;
    if (userPayload?.userId) {
      const [requester] = await this.db
        .select({ full_name: schema.userMaster.full_name, department_id: schema.userMaster.department_id, direct_transfer_allowed: schema.userMaster.direct_transfer_allowed })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userPayload.userId))
        .limit(1);
      requesterName = requester?.full_name ?? null;
      requesterDepartmentId = dto.requester_department_id ?? requester?.department_id ?? null;
      callerDirectTransferAllowed = Boolean(requester?.direct_transfer_allowed);
    } else {
      requesterDepartmentId = dto.requester_department_id ?? null;
    }
    // WP1c: the Direct Transfer right is the caller's own User Setup flag —
    // the ONE source (eligibility was already refused above, before any
    // query; this is the right half). Never self-serviceable (UserService).
    if (directTransfer) {
      assertDirectTransfer({ docType, purpose, fromLocationId: dto.from_location_id, toLocationId: dto.to_location_id, hasPermission: callerDirectTransferAllowed });
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
    // P1 follow-up item 5: the requisition belongs to the farm of its Main /
    // Farm Location, by the one shared rule (farmOfLocation, farm-scope.ts) —
    // the same rule assertLocationOnActiveFarm just checked it against. Before, a caller not tied to a farm (area.admin's
    // RQ-00033) wrote farm_id NULL although its Main Location was GRA100, so
    // the list showed no farm and the LOB scope treated it as every LOB's.
    // P1 e2e (5 Oct): without a main location, a farm-pinned caller's
    // requisition still belongs to its farm (the dialog sends none, and a NULL
    // farm made the read-back below miss the row through scopeConditions()).
    const farmId = (mainLocationId ? await farmOfLocation(this.db, mainLocationId) : null) ?? dto.farm_id ?? scope.farmId ?? null;
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
        farm_id: farmId,
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
      return this.findOne(requisitionId, tenantId, { caller: userPayload });
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
    lines: Array<{ item_id?: string | null; lot_no?: string | null; serial_no?: string | null }>,
  ) {
    const itemIds = [...new Set(lines.map((l) => l.item_id).filter((v): v is string => !!v))];
    if (itemIds.length) {
      const rows = await this.db
        .select({
          item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code,
          is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked,
        })
        .from(schema.itemMaster)
        .where(and(
          eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.company_id, companyId),
          eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at),
          inArray(schema.itemMaster.item_id, itemIds),
        ));
      const found = new Map(rows.map((r) => [r.item_id, r]));
      const at = lines.findIndex((l) => l.item_id && !found.has(l.item_id));
      if (at >= 0) throw new BadRequestException(`Line ${at + 1}: item is not an active item of this company.`);
      // WP4a fix round 1: an item carries only the identity it tracks — the
      // same rule the released Item Tracking route applies.
      lines.forEach((l, i) => {
        const item = l.item_id ? found.get(l.item_id) : undefined;
        if (item) {
          assertTrackingFieldsMatchItem(`Line ${i + 1}`, item.item_code ?? null,
            { isLotTracked: Boolean(item.is_lot_tracked), isSerialTracked: Boolean(item.is_serial_tracked) }, l);
        }
      });
    }
    // No line names a Resource any more (Rishi, 5 Oct: Service lines are
    // Description + Qty only) — assertLineFields refuses one on every kind
    // before this runs, so there is nothing left to look up.
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
        // Nullable from 0149 — an FA/Service line carries no unit (Rishi, 5 Oct).
        uom: line.uom ?? null,
        est_rate: line.est_rate !== undefined && line.est_rate !== null ? String(line.est_rate) : null,
        // WP1c Item Tracking: the assignment written through the document's
        // Item Tracking button travels onto the common line (it will flow onto
        // the linked transfer's line at release).
        lot_no: line.lot_no ?? null,
        serial_no: line.serial_no ?? null,
        // Rishi's list (4 Oct): a line's From/To Location are "auto from
        // header". On a Store document the header wins over whatever the body
        // carries per line — the screen sends each line's old locations back,
        // and a header change used to leave them behind (P1 e2e, 5 Oct).
        from_location_id: purpose === 'STORE' ? (header.from_location_id ?? null) : (line.from_location_id ?? header.from_location_id ?? null),
        to_location_id: purpose === 'STORE' ? (header.to_location_id ?? null) : (line.to_location_id ?? header.to_location_id ?? null),
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
      if (directTransfer) {
        assertDirectTransferEligible({ docType, purpose, fromLocationId, toLocationId });
        // WP1c: the right is the caller's own User Setup flag, read here — an
        // update turning Direct Transfer on needs it exactly like a create.
        const [caller] = userPayload?.userId
          ? await this.db
            .select({ direct_transfer_allowed: schema.userMaster.direct_transfer_allowed })
            .from(schema.userMaster)
            .where(eq(schema.userMaster.user_id, userPayload.userId))
            .limit(1)
          : [];
        assertDirectTransfer({ docType, purpose, fromLocationId, toLocationId, hasPermission: Boolean(caller?.direct_transfer_allowed) });
      }
      for (const [id, label] of [[dto.requester_department_id, 'Requester department'], [dto.sender_department_id, 'Sender department']] as const) {
        if (id) await assertDepartmentIdentity(this.db, { tenantId, companyId: row.company_id, departmentId: id, label });
      }
      const scope = farmScope(this.cls);
      for (const [id, label] of [[dto.main_location_id, 'Requisition main location'], [fromLocationId, 'Requisition source location'], [toLocationId, 'Requisition destination location']] as const) {
        if (id) await assertLocationOnActiveFarm(this.db, scope, id, label);
      }
      await this.assertLineReferences(tenantId, row.company_id, dto.lines);
      // P1 follow-up item 5: the farm follows the Main / Farm Location (shared
      // farmOfLocation). A location it cannot place leaves the stored farm.
      const mainLocationId = dto.main_location_id ?? row.main_location_id;
      const farmId = (mainLocationId ? await farmOfLocation(this.db, mainLocationId) : null) ?? row.farm_id;
      // Kept when omitted: purpose, requisition_date, main_location_id, requester_department_id. Cleared when omitted: sender_department_id, remarks, required_date, justification, direct_transfer.
      await this.db
        .update(schema.requisition)
        .set({
          purpose,
          farm_id: farmId,
          requisition_date: dto.requisition_date ?? row.requisition_date,
          main_location_id: mainLocationId,
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
      return this.findOne(requisitionId, tenantId, { caller: userPayload });
    });
  }

  /** Location types a common requisition may move between — ours (no document lists them). */
  private static readonly REQUISITION_LOCATION_TYPES = ['FARM', 'STORE', 'SHED', 'SILO'];

  async options(query: { company_id: string; farm_id?: string }, tenantId: string, userPayload?: { userId?: string; userType?: string; email?: string }) {
    assertCompanyInScope(farmScope(this.cls), query.company_id);
    const scopeFarm = farmScope(this.cls).farmId ?? query.farm_id ?? null;
    const itemRows = await this.db
      .select({
        item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, uom_primary: schema.itemMaster.uom_primary,
        // WP1c Item Tracking: the line offers the Lot/Serial assignment only
        // for a tracked item, so the editor needs both Item Master flags here.
        is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked,
      })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.company_id, query.company_id), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
      .orderBy(schema.itemMaster.item_code);
    // MySQL hands these back as tinyint 1/0; the editor branches on them, so
    // they cross the wire as real booleans rather than truthy numbers.
    const items = itemRows.map((i) => ({ ...i, is_lot_tracked: Boolean(i.is_lot_tracked), is_serial_tracked: Boolean(i.is_serial_tracked) }));
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
    // WP1c: the dialog disables the Direct Transfer checkbox without the
    // caller's own User Setup right — the same flag create/update enforce.
    let mayDirectTransfer = false;
    let requester: { user_id: string; login: string | null; name: string | null; department_id: string | null; department_name: string | null } | null = null;
    if (userPayload?.userId) {
      const [caller] = await this.db
        .select({
          email: schema.userMaster.email,
          full_name: schema.userMaster.full_name,
          department_id: schema.userMaster.department_id,
          direct_transfer_allowed: schema.userMaster.direct_transfer_allowed,
        })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userPayload.userId))
        .limit(1);
      mayDirectTransfer = Boolean(caller?.direct_transfer_allowed);
      if (caller) {
        requester = {
          user_id: userPayload.userId,
          login: caller.email ?? null,
          name: caller.full_name ?? null,
          department_id: caller.department_id ?? null,
          department_name: departments.find((d) => d.cost_center_id === caller.department_id)?.cost_center_name ?? null,
        };
      }
    }
    // No resources: no line may name one (Rishi, 5 Oct — Service lines are Description + Qty only).
    return { items, locations, departments, may_direct_transfer: mayDirectTransfer, requester };
  }

  /**
   * `opts.bypassFarm` (decisions.md 2026-10-04, second entry): decide()'s own
   * post-commit read-back of the row it just decided needs the same reach as
   * the lock that found it — otherwise an admin's cross-farm decision commits
   * then rolls itself back when this read-back 404s on the farm-only view.
   * Every other caller (create, submit, update, release, the controller's
   * own GET) omits it and keeps the ordinary active-farm narrowing; this is
   * not a general widening of findOne's visibility (that is WP1b's, for the
   * hub's document dialog).
   */
  async findOne(requisitionId: string, tenantId: string, opts: { bypassFarm?: boolean; caller?: { userId?: string; userType?: string } } = {}) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(opts),
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
        // WP1c Item Tracking: the document shows what the line was assigned;
        // without these the assignment vanished from the editor on reload
        // although it was stored.
        lot_no: schema.requisitionLine.lot_no,
        serial_no: schema.requisitionLine.serial_no,
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
    // P1 follow-up (Rishi, 5 Oct): "Requester User ID shows the user's login
    // (email)". The stored requester_user_id stays the id; its login is
    // resolved here, in the same one user lookup as the approver and releaser.
    const userIds = ids([row.approved_by, row.released_by, row.requester_user_id]);
    const users = new Map((userIds.length
      ? await this.db.select({ user_id: schema.userMaster.user_id, full_name: schema.userMaster.full_name, email: schema.userMaster.email })
        .from(schema.userMaster).where(and(eq(schema.userMaster.tenant_id, tenantId), inArray(schema.userMaster.user_id, userIds)))
      : []).map((u) => [u.user_id, u]));
    const userName = new Map([...users].map(([id, u]) => [id, u.full_name]));
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
    // Review p1f, I3: the server says what release() and receive() would
    // decide about this caller, through the same helpers, so the web shows
    // Release and Transfer Receipt without re-stating either rule. The flags
    // are about who the caller is; the document's state still decides whether
    // the action applies at all.
    const caller = opts.caller;
    let mayRelease = false;
    let mayReceive = false;
    if (caller?.userId) {
      mayRelease = (await this.hasApproveGrant(caller)) && !this.isOwnRequisitionRefused(row, caller);
      if (row.purpose === 'STORE' && isRequisitionRequester(row, caller.userId)) {
        mayReceive = await this.assertPostingDepartmentFor(row, tenantId, 'TO', 'Transfer Receipt', caller)
          .then(() => true, (err) => { if (err instanceof ForbiddenException) return false; throw err; });
      }
    }
    return this.publicDocument({
      ...row,
      may_release: mayRelease,
      may_receive: mayReceive,
      main_location_code: locationCode.get(row.main_location_id ?? '') ?? null,
      from_location_code: locationCode.get(row.from_location_id ?? '') ?? null,
      to_location_code: locationCode.get(row.to_location_id ?? '') ?? null,
      requester_department_name: departmentName.get(row.requester_department_id ?? '') ?? null,
      sender_department_name: departmentName.get(row.sender_department_id ?? '') ?? null,
      approved_by_name: userName.get(row.approved_by ?? '') ?? null,
      released_by_name: userName.get(row.released_by ?? '') ?? null,
      requester_login: users.get(row.requester_user_id ?? '')?.email ?? null,
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
    });
  }

  async findAll(
    query: { company_id?: string; farm_id?: string; status?: string; doc_type?: string; waiting_for_me?: boolean; kind?: 'common' },
    tenantId: string,
    opts: { waitingForMe?: boolean; userType?: string; userId?: string } = {},
  ) {
    // Rishi, 7 Oct: this is the one Requisition list. Stored FEED rows are
    // included and projected to public type ITEM; Feed Forecast keeps a
    // contextual filtered view of the same records.
    if (query.kind !== undefined && query.kind !== 'common') {
      throw new BadRequestException('kind must be common.');
    }
    if (query.doc_type && !(COMMON_LIST_DOC_TYPES as readonly string[]).includes(query.doc_type)) {
      throw new BadRequestException(`doc_type must be one of ${COMMON_LIST_DOC_TYPES.join(', ')}.`);
    }
    if (query.company_id) assertCompanyInScope(farmScope(this.cls), query.company_id);
    // WP1b (decisions.md 2026-10-04, "one Requisitions page"): the hub is the
    // one requisition list, and an admin's list spans every farm in their
    // scope — the same reach their decide() lock has (the review's
    // carried-forward item). Other types keep the active-farm narrowing.
    const bypassFarm = mayDecideAnyRequisition(opts.userType);
    const conditions = [
      eq(schema.requisition.tenant_id, tenantId),
      isNull(schema.requisition.deleted_at),
      ...this.scopeConditions({ bypassFarm }),
    ];
    // "Waiting for my approval": the row's open approval request is one the
    // current user may decide — through an EXISTS carrying the INBOX's own
    // predicate (farmConditions + the requisition kinds, via
    // requisitionRequestConditions), never a second copy of that rule.
    if (opts.waitingForMe) {
      // P1 e2e (5 Oct): "may decide" also means what decide() checks — the
      // approve right, and (outside Tenant/Company admins) never a manual
      // requisition one raised oneself. Without these a Standard User's list
      // held its own pending requisition, which it can neither approve nor reject.
      if (!(await this.hasApproveGrant({ userId: opts.userId, userType: opts.userType }))) return [];
      if (opts.userId && !maySelfApprove(opts.userType)) {
        conditions.push(sql`NOT ${selfApprovalSql(schema.requisition, opts.userId)}`);
      }
      const A = schema.approvalRequest;
      conditions.push(sql`EXISTS (SELECT 1 FROM approval_request WHERE approval_request.request_id = ${schema.requisition.approval_request_id}
        AND approval_request.deleted_at IS NULL
        AND approval_request.status = 'PENDING'
        AND ${and(...this.approvals.requisitionRequestConditions(opts.userType))})`);
    }
    if (query.company_id) conditions.push(eq(schema.requisition.company_id, query.company_id));
    if (query.farm_id) conditions.push(eq(schema.requisition.farm_id, query.farm_id));
    if (query.status) conditions.push(eq(schema.requisition.status, query.status));
    if (query.doc_type === 'ITEM') {
      conditions.push(or(eq(schema.requisition.doc_type, 'ITEM'), eq(schema.requisition.doc_type, 'FEED'))!);
    } else if (query.doc_type) {
      conditions.push(eq(schema.requisition.doc_type, query.doc_type));
    }
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
    return rows.map((row) => this.publicDocument({ ...row, ...projectRequisitionStates(row) }));
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
      return this.findOne(requisitionId, tenantId, { caller: userPayload });
    });
  }

  /** Approve or reject through the linked approval_request — one decision row, one status. */
  /**
   * "Who may approve a requisition" — the decide endpoint's predicate, in two
   * halves because decide() asks the first before it locks the row. Release
   * asks both (Rishi, 5 Oct: "Release may be pressed by any user who may
   * approve the requisition"), so it is this one rule, never a copy of it.
   *
   * 1. The PROCUREMENT/REQUISITION approve grant (admins hold every grant).
   */
  private hasApproveGrant(userPayload: { userId?: string; userType?: string } | undefined): Promise<boolean> {
    return userHasPermission(this.db, { userId: userPayload?.userId, userType: userPayload?.userType }, {
      moduleCode: REQUISITION_MODULE.moduleCode,
      resource: REQUISITION_MODULE.resource,
      action: 'approve',
    });
  }

  private async assertApproveGrant(userPayload: { userId?: string; userType?: string } | undefined, refusal: string): Promise<void> {
    if (!(await this.hasApproveGrant(userPayload))) throw new ForbiddenException(refusal);
  }

  /**
   * 2. D25 (Rishi, 1 Oct): a person may not approve a manual requisition they
   * created (isSelfApproval); decisions.md 2026-10-07 exempts exactly
   * TENANT_ADMIN, COMPANY_ADMIN and OPERATIONAL_ADMIN (maySelfApprove) — every other type,
   * including SYSTEM_ADMIN (not yet decided), is still refused.
   */
  private isOwnRequisitionRefused(
    row: { source: string | null; created_by: string | null; requester_user_id: string | null },
    userPayload: { userId?: string; userType?: string } | undefined,
  ): boolean {
    return !maySelfApprove(userPayload?.userType) && isSelfApproval(row, userPayload?.userId);
  }

  private assertNotOwnRequisition(
    row: { source: string | null; created_by: string | null; requester_user_id: string | null },
    userPayload: { userId?: string; userType?: string } | undefined,
    refusal: string,
  ): void {
    if (this.isOwnRequisitionRefused(row, userPayload)) throw new ForbiddenException(refusal);
  }

  async decide(requisitionId: string, dto: DecideRequisitionDto, decision: 'APPROVED' | 'REJECTED', tenantId: string, userPayload?: { userId?: string; email?: string; userType?: string }) {
    await this.assertApproveGrant(userPayload, 'You are not allowed to decide requisitions.');

    return withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select()
        .from(schema.requisition)
        .where(and(
          eq(schema.requisition.requisition_id, requisitionId),
          eq(schema.requisition.tenant_id, tenantId),
          isNull(schema.requisition.deleted_at),
          // decisions.md 2026-10-04 (second entry): a Tenant/Company admin
          // decides any requisition in their company, not just the farm
          // active in their session — the company boundary inside
          // scopeConditions still applies either way.
          ...this.scopeConditions({ bypassFarm: mayDecideAnyRequisition(userPayload?.userType) }),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
      assertNotFeedRequisition(row.doc_type, decision === 'APPROVED' ? 'approved' : 'rejected');
      if (row.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`Requisition ${row.req_no} is ${row.status}, not awaiting approval.`);
      }
      if (decision === 'APPROVED') {
        this.assertNotOwnRequisition(row, userPayload, 'You may not approve a requisition you created. Another authorized approver must decide it.');
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
      // decisions.md 2026-10-04 (second entry): the read-back carries the
      // same bypassFarm as the lock above — the sibling of the bug found live
      // in approval.service.ts's decide(): without it, an admin's cross-farm
      // decision committed the update and then rolled itself back because
      // this read-back 404'd on the farm-only view.
      return this.findOne(requisitionId, tenantId, { bypassFarm: mayDecideAnyRequisition(userPayload?.userType), caller: userPayload });
    });
  }

  /**
   * Release (Task 9, decisions 1 Oct): the control that authorizes fulfilment
   * after approval — never a consequence of it. An approved Purchase records
   * BC_PENDING; an approved Store becomes TRANSFER_OPEN, the state Task 10's
   * shipments draw against.
   *
   * Who may release (Rishi, 5 Oct — decisions.md "Common requisition:
   * requester, Service lines, receipt and release", point 4): "any user who
   * may approve the requisition", Purchase and Store alike. That is decide()'s
   * own predicate (assertApproveGrant + assertNotOwnRequisition) and its farm
   * reach (mayDecideAnyRequisition). It replaced the 1 Oct sender-department
   * rule for Release only; Transfer Shipment keeps the From department check.
   * The document is locked FOR UPDATE inside the tenant transaction, so two
   * concurrent releases cannot both pass the state check.
   */
  async release(requisitionId: string, tenantId: string, userPayload?: { userId?: string; userType?: string }) {
    const bypassFarm = mayDecideAnyRequisition(userPayload?.userType);
    return withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select()
        .from(schema.requisition)
        .where(and(
          eq(schema.requisition.requisition_id, requisitionId),
          eq(schema.requisition.tenant_id, tenantId),
          isNull(schema.requisition.deleted_at),
          ...this.scopeConditions({ bypassFarm }),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
      // Feed is released by the Feed Mill Manager after mill consolidation and
      // stops at Approved for now — never through this route.
      assertNotFeedRequisition(row.doc_type, 'released');
      await this.assertApproveGrant(userPayload, 'Only a user who may approve requisitions may release one.');
      this.assertNotOwnRequisition(row, userPayload, 'You may not release a requisition you created. Another authorized approver must release it.');
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
              // WP1c Item Tracking: the line's lot/serial assignment travels onto
              // the transfer this release creates. Without these two columns the
              // plan always read undefined and every transfer line posted
              // untracked, however the requisition was assigned.
              lot_no: schema.requisitionLine.lot_no, serial_no: schema.requisitionLine.serial_no,
              // WP1c Item Tracking: the line's lot/serial assignment travels onto
              // the transfer this release creates. Without these two columns the
              // plan always read undefined and every transfer line posted
              // untracked, however the requisition was assigned.
              // WP1c Item Tracking: the line's lot/serial assignment travels onto
              // the transfer this release creates. Without these two columns the
              // plan always read undefined and every transfer line posted
              // untracked, however the requisition was assigned.
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
      // The read-back has the lock's reach (see decide()): an admin's
      // cross-farm release must not commit and then 404 on the farm-only view.
      return this.findOne(requisitionId, tenantId, { bypassFarm, caller: userPayload });
    });
  }

  // ---------------------------------------------------------------------------
  // Shipping and receiving from the requisition (Task 7): the requisition
  // lines follow its linked transfer's events. The shipment reuses the
  // transfer's own permission pair (INVENTORY/STOCK_TRANSFER/edit, bound in
  // the controller); the receipt is the requester's (Rishi, 5 Oct) and asks
  // only PROCUREMENT/REQUISITION/view — no new permission pair either way, so
  // role-permissions-coverage holds. StockTransferService does the actual posting (ledger, GL, status);
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

  /**
   * WP1c: the Transfer Shipment/Receipt buttons are department gates (Rishi's
   * 4 Oct list): the posting user's user_master.department_id must equal the
   * From (shipment) / To (receipt) sub-location's location_master.department_id
   * — a Cost Center identity, never text, and with no admin bypass (Rishi's
   * bound, decisions.md 2026-10-04). A row without that location (legacy,
   * farm-less) has nothing to check; the rule itself decides.
   */
  private async assertPostingDepartmentFor(
    row: { from_location_id: string | null; to_location_id: string | null },
    tenantId: string,
    side: 'FROM' | 'TO',
    kind: 'Transfer Shipment' | 'Transfer Receipt' | 'Item Tracking',
    userPayload?: { userId?: string; userType?: string; email?: string },
  ): Promise<void> {
    const locationId = side === 'FROM' ? row.from_location_id : row.to_location_id;
    if (!locationId) return;
    const [location] = await this.db
      .select({ department_id: schema.locationMaster.department_id })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.tenant_id, tenantId), eq(schema.locationMaster.location_id, locationId)))
      .limit(1);
    const [user] = userPayload?.userId
      ? await this.db
        .select({ department_id: schema.userMaster.department_id })
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userPayload.userId))
        .limit(1)
      : [];
    assertPostingDepartment(side, kind, { userDepartmentId: user?.department_id ?? null, locationDepartmentId: location?.department_id ?? null });
  }

  async ship(requisitionId: string, dto: RequisitionShipmentDto, tenantId: string, userPayload?: { userId?: string; userType?: string; email?: string }) {
    const { row, transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    await this.assertPostingDepartmentFor(row, tenantId, 'FROM', 'Transfer Shipment', userPayload);
    // WP1c (Rishi's 4 Oct list): "If Direct Transfer = True: Shipment +
    // Receipt posted together." The one-step post is the transfer service's
    // own postDirectTransfer — not a second writer — and it still goes through
    // the same department check above.
    if (row.direct_transfer) {
      await this.stockTransfers.postDirectTransfer(transferId, { posting_date: dto.posting_date, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
      return this.findOne(requisitionId, tenantId, { caller: userPayload });
    }
    await this.stockTransfers.postShipment(transferId, { posting_date: dto.posting_date, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId, { caller: userPayload });
  }

  /**
   * Who may post the Transfer Receipt is decided here, once (Rishi, 5 Oct):
   * the requisition's requester, whose department matches the To
   * sub-location. The route itself asks only the requisition's view grant —
   * the requester needs no separate receive permission.
   */
  async receive(requisitionId: string, dto: RequisitionReceiptDto, tenantId: string, userPayload?: { userId?: string; userType?: string; email?: string }) {
    const { row, transferId, transferLines } = await this.releasedStore(requisitionId, tenantId);
    assertReceiptByRequester(row, userPayload?.userId);
    await this.assertPostingDepartmentFor(row, tenantId, 'TO', 'Transfer Receipt', userPayload);
    await this.stockTransfers.postReceipt(transferId, { posting_date: dto.posting_date, shipment_id: dto.shipment_id, lines: mapToTransferLines(dto.lines, transferLines) }, tenantId, userPayload);
    return this.findOne(requisitionId, tenantId, { caller: userPayload });
  }

  /**
   * Item Tracking on a released Store requisition, for the balance not yet
   * shipped (WP4a; Rishi's 4 Oct list: "If Lot or Serial tracked: MANDATORY
   * before Transfer Shipment post"). Fix round 1:
   * - ONE rule: the assignment is validated with the shipment's own
   *   assertTrackingForShipment against the balance to ship, so the route
   *   never accepts what the shipment would refuse.
   * - Lock order: stock_transfer FOR UPDATE first — the lock postShipment's
   *   loadForMutation takes — then the requisition lines. A concurrent
   *   shipment either finishes first (and its events count below) or waits.
   * - "Shipped" comes from the shipment events (transfer_shipment_line), never
   *   from requisition_line.qty_shipped, which a shipment syncs only at its end.
   * - A partly shipped lot line keeps its balance assignable; earlier
   *   shipments keep the identity they recorded on their own lines.
   * The store that ships picks the lot, so the From department assigns.
   */
  async assignTracking(requisitionId: string, dto: RequisitionTrackingDto, tenantId: string, userPayload?: { userId?: string }) {
    const seen = new Set<string>();
    for (const l of dto.lines) {
      if (seen.has(l.line_id)) throw new BadRequestException(`Line ${l.line_id} is named twice; name each line once.`);
      seen.add(l.line_id);
    }
    await withTenantTransaction(this.cls, async () => {
      const { row, transferId } = await this.releasedStore(requisitionId, tenantId);
      await this.assertPostingDepartmentFor(row, tenantId, 'FROM', 'Item Tracking', userPayload);
      await this.db.select({ transfer_id: schema.stockTransfer.transfer_id })
        .from(schema.stockTransfer)
        .where(and(eq(schema.stockTransfer.transfer_id, transferId), eq(schema.stockTransfer.tenant_id, tenantId)))
        .for('update');
      const transferLines = await this.db
        .select({ line_id: schema.stockTransferLine.line_id, requisition_line_id: schema.stockTransferLine.requisition_line_id, quantity: schema.stockTransferLine.quantity })
        .from(schema.stockTransferLine)
        .where(eq(schema.stockTransferLine.transfer_id, transferId));
      const shippedRows = await this.db
        .select({ line_id: schema.transferShipmentLine.line_id, qty: schema.transferShipmentLine.quantity })
        .from(schema.transferShipmentLine)
        .innerJoin(schema.transferShipment, eq(schema.transferShipment.shipment_id, schema.transferShipmentLine.shipment_id))
        .where(and(eq(schema.transferShipment.transfer_id, transferId), isNull(schema.transferShipment.deleted_at)));
      const shippedBy = new Map<string, number>();
      for (const r of shippedRows) shippedBy.set(r.line_id, (shippedBy.get(r.line_id) ?? 0) + Number(r.qty));
      const lines = await this.db
        .select({
          line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq, item_id: schema.requisitionLine.item_id,
          item_code: schema.itemMaster.item_code,
        })
        .from(schema.requisitionLine)
        .leftJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.requisitionLine.item_id))
        .where(eq(schema.requisitionLine.requisition_id, requisitionId))
        .for('update');
      const itemIds = [...new Set(lines.map((l) => l.item_id).filter((v): v is string => Boolean(v)))];
      const flags = itemIds.length
        ? await this.db
          .select({ item_id: schema.itemMaster.item_id, is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked })
          .from(schema.itemMaster)
          .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)))
        : [];
      const writes = dto.lines.map((input) => {
        const line = lines.find((l) => l.line_id === input.line_id);
        const transferLine = transferLines.find((t) => t.requisition_line_id === input.line_id);
        if (!line || !transferLine) throw new BadRequestException(`Line '${input.line_id}' is not on ${row.req_no}.`);
        const f = flags.find((x) => x.item_id === line.item_id);
        const itemFlags = { isLotTracked: Boolean(f?.is_lot_tracked), isSerialTracked: Boolean(f?.is_serial_tracked) };
        const balance = Number(transferLine.quantity) - (shippedBy.get(transferLine.line_id) ?? 0);
        const assignment = resolveTrackingAssignment(line, balance, itemFlags, input);
        assertTrackingForShipment(itemFlags, assignment, balance, balance);
        return { line_id: line.line_id, ...assignment };
      });
      for (const w of writes) {
        await this.db.update(schema.requisitionLine)
          .set({ lot_no: w.lot_no, serial_no: w.serial_no })
          .where(eq(schema.requisitionLine.line_id, w.line_id));
        await this.db.update(schema.stockTransferLine)
          .set({ lot_no: w.lot_no, serial_no: w.serial_no })
          .where(and(eq(schema.stockTransferLine.transfer_id, transferId), eq(schema.stockTransferLine.requisition_line_id, w.line_id)));
      }
    });
    return this.findOne(requisitionId, tenantId, { caller: userPayload });
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
      return this.findOne(requisitionId, tenantId, { caller: userPayload });
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
    userPayload?: { userId?: string; userType?: string },
  ): Promise<void> {
    const row = await this.lockForApproval(request, tenantId);
    // Review p1f, M1: the same approve grant decide() and release() ask, for
    // both decisions — the inbox route's own PRODUCTION/APPROVAL grant alone
    // let a user approve here and then be refused Release.
    await this.assertApproveGrant(userPayload, 'You are not allowed to decide requisitions.');
    // D25 (Rishi, 1 Oct): a person may not approve a requisition they created.
    // The shared isSelfApproval rule applies: a manual or legacy-sourceless
    // draft is refused to its creator; only an AUTO_FORECAST draft is exempt.
    // decisions.md 2026-10-07 supersedes this for TENANT_ADMIN, COMPANY_ADMIN
    // and OPERATIONAL_ADMIN (maySelfApprove) — every other type, including
    // SYSTEM_ADMIN (not yet decided), is still refused. Same gate as the
    // direct decide() above, so the Approvals-inbox path and the direct
    // /requisition/:id/approve path agree.
    if (decision === 'APPROVED') {
      this.assertNotOwnRequisition(row, userPayload, 'You may not approve a requisition you created. Another authorized approver must decide it.');
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
    return this.findOne(requisitionId, tenantId, { caller: userPayload });
  }
}

/**
 * Common requisition document rules — pure, no database (plan Task 8).
 *
 * What follows the client record:
 * - Type is Item, Fixed Asset or Service; Store applies only to Item while
 *   Fixed Asset and Service use Purchase (decisions.md, 1 Oct 2026; spec
 *   "Requisitions").
 * - Department identity is a Cost Center Master row of type DEPARTMENT
 *   (decisions.md, 1 Oct 2026) — see common/department-identity.ts.
 * - Direct Transfer posts a selected shipment and its matching receipt only
 *   for a user with the explicit permission (decisions.md, 1 Oct 2026).
 * - Approval, document and fulfilment/integration are separate state
 *   dimensions; a rejected document returns to Open for correction while
 *   keeping its decision history (decisions.md, 1 Oct 2026; spec "Common
 *   requisition").
 *
 * What is ours (no field specification exists for these — flagged the same
 * way the Phase 9 MVP fields were): the line-level field shape per type (an
 * Item line is an Item Master row, an FA line carries its description, a
 * Service line is a Resource or a description), the quantity bounds, the
 * legacy-status projections, and the statement that Balance to Ship and
 * Remaining to Receive are computed, never stored.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FLOAT_SUM_TOLERANCE as EPS } from '../../../common/numeric-tolerance';

export const COMMON_DOC_TYPES = ['ITEM', 'FA', 'SERVICE'] as const;
export type CommonDocType = (typeof COMMON_DOC_TYPES)[number];

export const REQUISITION_PURPOSES = ['STORE', 'PURCHASE'] as const;
export type RequisitionPurpose = (typeof REQUISITION_PURPOSES)[number];

export type ApprovalStatus = 'OPEN' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type DocumentStatus = 'OPEN' | 'APPROVED' | 'RELEASED' | 'CANCELLED';
export type FulfilmentStatus =
  | 'NOT_APPLICABLE' | 'TRANSFER_OPEN' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';
export type IntegrationStatus = 'NOT_APPLICABLE' | 'BC_PENDING';

export interface RequisitionStates {
  approval_status: ApprovalStatus;
  document_status: DocumentStatus;
  fulfilment_status: FulfilmentStatus;
  integration_status: IntegrationStatus;
}

// --------------------------------------------------------------------------------
// Type and purpose
// --------------------------------------------------------------------------------

/**
 * The common service only ever drafts ITEM/FA/SERVICE. Anything else —
 * including FEED, whose rows are written by FeedRequisitionService — falls
 * back to ITEM exactly as the pre-Task 8 create contract did.
 */
export function normalizeCommonDocType(docType?: string | null): CommonDocType {
  return (COMMON_DOC_TYPES as readonly string[]).includes(docType ?? '')
    ? (docType as CommonDocType)
    : 'ITEM';
}

/** Purpose is a supplied header field: required, and STORE only on Item. */
export function assertPurpose(docType: CommonDocType, purpose?: string | null): RequisitionPurpose {
  if (!purpose || !(REQUISITION_PURPOSES as readonly string[]).includes(purpose)) {
    throw new BadRequestException('A common requisition needs a purpose: STORE or PURCHASE.');
  }
  if (purpose === 'STORE' && docType !== 'ITEM') {
    throw new BadRequestException('Store applies only to Item requisitions; Fixed Asset and Service use Purchase.');
  }
  return purpose as RequisitionPurpose;
}

/** A Store requisition is the internal transfer: it needs two real, distinct endpoints. */
export function assertPurposeLocations(
  purpose: RequisitionPurpose,
  fromLocationId?: string | null,
  toLocationId?: string | null,
): void {
  if (purpose !== 'STORE') return;
  if (!fromLocationId) throw new BadRequestException('A Store requisition needs a source location.');
  if (!toLocationId) throw new BadRequestException('A Store requisition needs a destination location.');
  if (fromLocationId === toLocationId) throw new BadRequestException('The source and destination locations must differ.');
}

// --------------------------------------------------------------------------------
// Line field rules per document type
// --------------------------------------------------------------------------------

export interface RequisitionLineRule {
  item_id?: string | null;
  resource_id?: string | null;
  description?: string | null;
  quantity?: unknown;
  uom?: unknown;
  qty_to_ship?: unknown;
  qty_to_receive?: unknown;
  /** WP1c Item Tracking (Rishi's 4 Oct list): the line's lot/serial assignment.
   *  Item Master carries is_lot_tracked / is_serial_tracked; FA and Service
   *  lines must not carry either field.
   */
  lot_no?: unknown;
  serial_no?: unknown;
}

const present = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

export function assertQtyToShip(requestedQty: number, qtyToShip: number): void {
  if (!(qtyToShip > 0)) throw new BadRequestException('to-ship quantity must be greater than zero.');
  if (qtyToShip > requestedQty) throw new BadRequestException('to-ship quantity cannot exceed the requested quantity.');
}

export function assertQtyToReceive(qtyToShip: number, qtyToReceive: number): void {
  if (!(qtyToReceive > 0)) throw new BadRequestException('to-receive quantity must be greater than zero.');
  if (qtyToReceive > qtyToShip) throw new BadRequestException('to-receive quantity cannot exceed the to-ship quantity.');
}

/** Task 10's shipment guard: never ship more than the line still owes. */
export function assertShipmentQty(remainingBalanceToShip: number, qty: number): void {
  if (!(qty > 0)) throw new BadRequestException('Shipment quantity must be greater than zero.');
  if (qty > remainingBalanceToShip) throw new BadRequestException('Shipment quantity exceeds the remaining balance to ship.');
}

/** Task 10's receipt guard: never receive more than has been shipped. */
export function assertReceiptQty(remainingToReceive: number, qty: number): void {
  if (!(qty > 0)) throw new BadRequestException('Receipt quantity must be greater than zero.');
  if (qty > remainingToReceive) throw new BadRequestException('Receipt quantity exceeds the remaining quantity to receive.');
}

export function assertLineFields(docType: CommonDocType, line: RequisitionLineRule, lineNo: number): void {
  const at = `Requisition line ${lineNo}`;
  if (!(Number(line.quantity) > 0)) {
    throw new BadRequestException(`${at} needs a quantity greater than zero.`);
  }
  // WP1c Item Tracking (Rishi's 4 Oct list): a lot or serial identifies an
  // inventory item, and FA / Service lines are Description + Qty only — so
  // carrying either field is the same error as naming an item outright.
  if (docType !== 'ITEM' && (present(line.lot_no) || present(line.serial_no))) {
    if (docType === 'FA') {
      throw new BadRequestException(`${at}: a Fixed Asset line cannot reference an inventory item.`);
    }
    throw new BadRequestException(`${at}: a Service line cannot reference an inventory item.`);
  }
  switch (docType) {
    case 'ITEM':
      if (!present(line.item_id)) throw new BadRequestException(`${at} needs an Item Master item.`);
      if (present(line.resource_id)) throw new BadRequestException(`${at}: an Item requisition line cannot reference a Resource.`);
      break;
    case 'FA':
      if (present(line.item_id)) throw new BadRequestException(`${at}: a Fixed Asset line cannot reference an inventory item.`);
      if (present(line.resource_id)) throw new BadRequestException(`${at}: a Fixed Asset line cannot reference a Resource.`);
      if (!present(line.description)) throw new BadRequestException(`${at} needs a Fixed Asset description.`);
      break;
    case 'SERVICE':
      if (present(line.item_id)) throw new BadRequestException(`${at}: a Service line cannot reference an inventory item.`);
      if (!present(line.resource_id) && !present(line.description)) {
        throw new BadRequestException(`${at} needs a Resource or a description.`);
      }
      break;
  }
}

function assertLineQuantities(purpose: RequisitionPurpose, line: RequisitionLineRule, lineNo: number): void {
  const at = `Requisition line ${lineNo}`;
  const hasToShip = present(line.qty_to_ship);
  const hasToReceive = present(line.qty_to_receive);
  if (purpose === 'PURCHASE') {
    if (hasToShip || hasToReceive) {
      throw new BadRequestException(`${at}: a Purchase line cannot carry shipment quantities.`);
    }
    return;
  }
  const requested = Number(line.quantity);
  const toShip = hasToShip ? Number(line.qty_to_ship) : requested;
  if (hasToShip) {
    try {
      assertQtyToShip(requested, toShip);
    } catch (err) {
      throw new BadRequestException(`${at}: ${(err as Error).message}`);
    }
  }
  if (hasToReceive) {
    try {
      assertQtyToReceive(toShip, Number(line.qty_to_receive));
    } catch (err) {
      throw new BadRequestException(`${at}: ${(err as Error).message}`);
    }
  }
}

/** One line's rules; `lineNo` is the 1-based position the message names. */
export function assertRequisitionLine(
  docType: CommonDocType,
  purpose: RequisitionPurpose,
  line: RequisitionLineRule,
  lineNo = 1,
): void {
  assertLineFields(docType, line, lineNo);
  assertLineQuantities(purpose, line, lineNo);
}

/** Every line of a draft, in order — the first refusal names its line. */
export function assertRequisitionLines(
  docType: CommonDocType,
  purpose: RequisitionPurpose,
  lines: RequisitionLineRule[],
): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BadRequestException('A requisition needs at least one line.');
  }
  lines.forEach((line, index) => assertRequisitionLine(docType, purpose, line, index + 1));
}

// --------------------------------------------------------------------------------
// Direct transfer
// --------------------------------------------------------------------------------

export interface DirectTransferRequest {
  docType: string;
  purpose: string | null | undefined;
  fromLocationId?: string | null;
  toLocationId?: string | null;
}

/**
 * Eligibility only — a draft may record the intent. The right half lives in
 * assertDirectTransfer, called at create/update time with the caller's own
 * User Setup flag (WP1c: user_master.direct_transfer_allowed — the ONE source
 * the rule reads; there is no separate permission key, so the checkbox, the
 * write and the posting cannot disagree).
 */
export function assertDirectTransferEligible(request: DirectTransferRequest): void {
  if (request.docType !== 'ITEM' || request.purpose !== 'STORE') {
    throw new BadRequestException('Direct Transfer applies only to Store Item requisitions.');
  }
  if (!request.fromLocationId || !request.toLocationId || request.fromLocationId === request.toLocationId) {
    throw new BadRequestException('Direct Transfer needs a source and a different destination location.');
  }
}

export function assertDirectTransfer(request: DirectTransferRequest & { hasPermission: boolean }): void {
  assertDirectTransferEligible(request);
  if (!request.hasPermission) {
    throw new ForbiddenException('Direct Transfer requires the Direct Transfer right (User Setup).');
  }
}

// --------------------------------------------------------------------------------
// Quantities and derived balances
// --------------------------------------------------------------------------------

export interface RequisitionLineBalances {
  requested_qty: number;
  qty_to_ship: number;
  qty_shipped: number;
  qty_to_receive: number;
  qty_received: number;
  balance_to_ship: number;
  remaining_to_receive: number;
}

const numOf = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The four stored quantities plus the two derived ones. Balance to Ship =
 * to-ship − shipped; Remaining to Receive = to-receive − received. An
 * untouched line ships and receives its full requested quantity. The derived
 * pair is computed on read and never persisted (plan Task 8).
 */
export function lineBalances(line: {
  quantity: unknown;
  qty_to_ship?: unknown;
  qty_shipped?: unknown;
  qty_to_receive?: unknown;
  qty_received?: unknown;
}): RequisitionLineBalances {
  const requestedQty = numOf(line.quantity, 0);
  const toShip = numOf(line.qty_to_ship, requestedQty);
  const shipped = numOf(line.qty_shipped, 0);
  const toReceive = numOf(line.qty_to_receive, toShip);
  const received = numOf(line.qty_received, 0);
  return {
    requested_qty: requestedQty,
    qty_to_ship: toShip,
    qty_shipped: shipped,
    qty_to_receive: toReceive,
    qty_received: received,
    balance_to_ship: toShip - shipped,
    remaining_to_receive: toReceive - received,
  };
}

// --------------------------------------------------------------------------------
// State dimensions and the legacy `status` projection
// --------------------------------------------------------------------------------

const LEGACY_APPROVAL: Record<string, ApprovalStatus> = {
  DRAFT: 'OPEN',
  AUTO_DRAFT: 'OPEN',
  OPEN: 'OPEN',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  // A cancelled legacy draft carries no approval decision.
  CANCELLED: 'OPEN',
};

const LEGACY_DOCUMENT: Record<string, DocumentStatus> = {
  APPROVED: 'APPROVED',
  RELEASED: 'APPROVED',
  CANCELLED: 'CANCELLED',
  // Rejected returns to Open for correction while the decision history stays
  // on the approval request and in `status` itself.
  REJECTED: 'OPEN',
};

/**
 * The read contract during this plan: explicit new columns win; a null
 * (legacy row, or FEED row the feed writer never touches) projects from the
 * single `status` column. `status` itself is returned unchanged — old callers
 * keep reading exactly the values they read before Task 8.
 */
export function projectRequisitionStates(row: {
  status?: string | null;
  approval_status?: string | null;
  document_status?: string | null;
  fulfilment_status?: string | null;
  integration_status?: string | null;
}): RequisitionStates {
  const legacy = String(row.status ?? '');
  return {
    approval_status: row.approval_status as ApprovalStatus ?? LEGACY_APPROVAL[legacy] ?? 'OPEN',
    document_status: row.document_status as DocumentStatus ?? LEGACY_DOCUMENT[legacy] ?? 'OPEN',
    fulfilment_status: (row.fulfilment_status as FulfilmentStatus) ?? 'NOT_APPLICABLE',
    integration_status: (row.integration_status as IntegrationStatus) ?? 'NOT_APPLICABLE',
  };
}

/**
 * The inverse projection for writes back to `status`, whose vocabulary is
 * DRAFT/AUTO_DRAFT/PENDING_APPROVAL/APPROVED/REJECTED/CANCELLED. Release is
 * additive authority, so a released document still reads APPROVED to an old
 * caller; AUTO_DRAFT belongs to the feed writer and is never produced here.
 */
export function legacyStatusFor(approvalStatus: ApprovalStatus, documentStatus: DocumentStatus): string {
  if (documentStatus === 'CANCELLED') return 'CANCELLED';
  if (approvalStatus === 'REJECTED') return 'REJECTED';
  if (approvalStatus === 'PENDING_APPROVAL') return 'PENDING_APPROVAL';
  if (approvalStatus === 'APPROVED') return 'APPROVED';
  return 'DRAFT';
}

// --------------------------------------------------------------------------------
// Release — approval never implies release, release never bypasses approval
// (decisions.md, 1 Oct: "Common requisition approval precedes release").
// --------------------------------------------------------------------------------

export interface ReleaseState {
  status?: string | null;
  approval_status?: string | null;
  document_status?: string | null;
  fulfilment_status?: string | null;
  integration_status?: string | null;
  released_by?: string | null;
  /** 'STORE' releases to TRANSFER_OPEN; 'PURCHASE' records BC_PENDING. Default STORE. */
  purpose?: string | null;
}

/**
 * May this document be released, and what does release write? The guard reads
 * the projected states, so a legacy row (status APPROVED only) releases
 * exactly like a new row. On success the result is the full write set:
 * `document_status RELEASED`, the legacy `status` left at APPROVED (release is
 * additive authority, so old callers still read APPROVED), and for a Store
 * document `fulfilment_status TRANSFER_OPEN` — the internal transfer Task 10
 * fulfils. A Purchase document keeps NOT_APPLICABLE fulfilment and records
 * BC_PENDING integration instead: Business Central is not connected, so the
 * release records a pending handoff and never claims a sync.
 */
export function releaseTransition(row: ReleaseState): {
  status: string;
  approval_status: ApprovalStatus;
  document_status: DocumentStatus;
  fulfilment_status: FulfilmentStatus;
  integration_status: IntegrationStatus;
} {
  const states = projectRequisitionStates(row);
  if (states.document_status === 'CANCELLED') {
    throw new BadRequestException('A cancelled requisition cannot be released.');
  }
  if (states.document_status === 'RELEASED') {
    throw new BadRequestException('Requisition already released.');
  }
  if (states.approval_status !== 'APPROVED') {
    throw new BadRequestException('A requisition must be approved before it can be released; approval never implies release.');
  }
  const isPurchase = row.purpose === 'PURCHASE';
  return {
    status: 'APPROVED',
    approval_status: 'APPROVED', // unchanged by release, written explicitly
    document_status: 'RELEASED',
    fulfilment_status: isPurchase ? 'NOT_APPLICABLE' : 'TRANSFER_OPEN',
    integration_status: isPurchase ? 'BC_PENDING' : 'NOT_APPLICABLE',
  };
}

/** REJECTED → OPEN: the document is correctable again; the decision history stays on the approval request. */
export function reopenTransition(): { status: string; approval_status: ApprovalStatus; document_status: DocumentStatus; approval_request_id: null } {
  return { status: 'DRAFT', approval_status: 'OPEN', document_status: 'OPEN', approval_request_id: null };
}

/** Every doc_type the common list may be filtered by — FEED included, it is one document (spec §6a). */
export const COMMON_LIST_DOC_TYPES = ['FEED', 'ITEM', 'FA', 'SERVICE'] as const;

/**
 * Task 13 (lifts Ruling C2): the generic /requisition routes may LIST and READ
 * a FEED requisition for the all-types hub, but never change it — a feed
 * document is created, edited, submitted, decided and fulfilled only through
 * /feed-requisition, where the feed rules live. Every generic mutation calls
 * this before it writes; the name of the action goes in the message.
 */
export function assertNotFeedRequisition(docType: string | null | undefined, action: string): void {
  if (docType === 'FEED') {
    throw new BadRequestException(`A feed requisition cannot be ${action} through /requisition; use /feed-requisition.`);
  }
}

/**
 * decisions.md 2026-10-01: "A user must not approve a manually created
 * requisition that they created. System-generated feed drafts may be reviewed
 * and approved by the Farm Manager for that farm." Only AUTO_FORECAST is
 * system-generated; anything else — MANUAL_ENTRY, and a legacy common row with
 * no source at all — is manual.
 */
export function isSelfApproval(
  row: { source: string | null; created_by: string | null; requester_user_id: string | null },
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  if (row.source === 'AUTO_FORECAST') return false;
  return row.created_by === userId || row.requester_user_id === userId;
}

/**
 * decisions.md 2026-10-04: "Tenant and Company admins may approve their own
 * requisitions" — supersedes the 2026-10-01 self-approval rule above for
 * exactly these two user types, common and feed requisitions alike. Every
 * other type, including SYSTEM_ADMIN (not named by Rishi; it follows the old
 * rule until he confirms otherwise — decisions.md, 2026-10-04), still cannot.
 *
 * Deliberately an exact two-item allow-list rather than an "is this an admin"
 * test: SYSTEM_ADMIN ranks above both named types on the user-type ladder
 * (common/user-type-hierarchy.ts) and a hierarchy-based check would silently
 * widen the exemption to it.
 *
 * Exported so the feed requisition service's own self-approval check
 * (feed-requisition.service.ts — a different row shape: it also keys on the
 * approval request's requested_by, which the common row does not carry) can
 * gate on the same two-type allow-list without sharing the row-shape-specific
 * match in isSelfApproval above.
 */
export const SELF_APPROVAL_EXEMPT_USER_TYPES = ['TENANT_ADMIN', 'COMPANY_ADMIN'] as const;

export function maySelfApprove(userType: string | null | undefined): boolean {
  return typeof userType === 'string' && (SELF_APPROVAL_EXEMPT_USER_TYPES as readonly string[]).includes(userType);
}

/**
 * decisions.md 2026-10-04 (second entry, "Tenant and Company admins approve
 * every requisition; one Requisitions page"): the same two types may decide
 * ANY requisition in their scope — not only their own — bypassing whatever
 * farm-active narrowing or step/tier the ordinary rule would apply. Same
 * allow-list as maySelfApprove (one source of truth,
 * SELF_APPROVAL_EXEMPT_USER_TYPES); exported under its own name because the
 * call sites ask different questions ("is this my own document" vs "am I
 * restricted to one farm's / one step's documents"), even though today both
 * resolve against the same two types.
 */
export function mayDecideAnyRequisition(userType: string | null | undefined): boolean {
  return maySelfApprove(userType);
}

/**
 * decisions 1 Oct: "Store release starts an internal transfer." One transfer
 * per requisition: stock_transfer has one source and one destination, so a
 * line routed elsewhere is refused rather than silently moved between the
 * header's locations (Review Focus 5). Quantity is the authorized to-ship
 * target (lineBalances), never more — over-shipment stays impossible.
 */
export interface TransferPlanLine {
  requisition_line_id: string;
  item_id: string;
  quantity: number;
  uom: string;
  /** WP1c: the item's lot/serial assignment, flowed onto the transfer line at release. */
  lot_no: string | null;
  serial_no: string | null;
}

export function transferPlanFor(
  header: { from_location_id: string | null; to_location_id: string | null },
  lines: Array<{ line_id: string; line_seq: number; item_id: string | null; quantity: unknown; uom: string; qty_to_ship?: unknown; from_location_id?: string | null; to_location_id?: string | null; lot_no?: unknown; serial_no?: unknown }>,
) {
  if (!header.from_location_id || !header.to_location_id) {
    throw new BadRequestException('A Store requisition needs a source and a destination before release.');
  }
  const fromLocationId = header.from_location_id;
  const toLocationId = header.to_location_id;
  return {
    fromLocationId,
    toLocationId,
    lines: lines.map((l) => {
      if (!l.item_id) throw new BadRequestException(`Line ${l.line_seq} has no item; a Store transfer moves Item Master items only.`);
      if ((l.from_location_id && l.from_location_id !== fromLocationId) || (l.to_location_id && l.to_location_id !== toLocationId)) {
        throw new BadRequestException(`Line ${l.line_seq} moves between other locations than the header; one transfer has one source and one destination.`);
      }
      return { requisition_line_id: l.line_id, item_id: l.item_id, quantity: lineBalances(l).qty_to_ship, uom: l.uom, lot_no: l.lot_no ?? null, serial_no: l.serial_no ?? null };
    }),
  };
}

/**
 * Spec §6a: the lines grid is "editable while the document is open". Open
 * means approval OPEN and document OPEN; a REJECTED document is corrected only
 * after Reopen (decisions 1 Oct: "Rejected documents return to Open for
 * correction"), which is an explicit action, not an edit.
 */
export function assertEditable(row: { req_no: string; doc_type: string; status?: string | null; approval_status?: string | null; document_status?: string | null }): void {
  assertNotFeedRequisition(row.doc_type, 'edited');
  const states = projectRequisitionStates(row);
  if (states.approval_status !== 'OPEN' || states.document_status !== 'OPEN') {
    throw new BadRequestException(`Requisition ${row.req_no} can no longer be edited; only an Open requisition can change.`);
  }
}

// --------------------------------------------------------------------------------
// Shipping and receiving from the requisition (plan Task 7) — the requisition
// lines follow the linked transfer's events.
// --------------------------------------------------------------------------------

/** The fulfilment dimension from the line quantities (1 Oct spec "Common requisition"). Received outranks shipped. */
export function fulfilmentStatusOf(lines: Array<{ quantity: unknown; qty_to_ship?: unknown; qty_shipped?: unknown; qty_to_receive?: unknown; qty_received?: unknown }>): FulfilmentStatus {
  const b = lines.map((l) => lineBalances(l));
  const anyReceived = b.some((l) => l.qty_received > EPS);
  const allReceived = b.every((l) => l.remaining_to_receive <= EPS);
  const anyShipped = b.some((l) => l.qty_shipped > EPS);
  const allShipped = b.every((l) => l.balance_to_ship <= EPS);
  if (anyReceived && allReceived) return 'RECEIVED';
  if (anyReceived) return 'PARTIALLY_RECEIVED';
  if (anyShipped && allShipped) return 'SHIPPED';
  if (anyShipped) return 'PARTIALLY_SHIPPED';
  return 'TRANSFER_OPEN';
}

// --------------------------------------------------------------------------------
// The department checks on the Transfer Shipment and Transfer Receipt buttons
// (WP1c — Rishi's 4 Oct list, kept verbatim in common-requisition-spec.md:
// "Validation: user dept (from User Setup) must match From Sub-Location
// dimension" / "...To Sub-Location dimension"). A department is a Cost Center
// identity, so the match is between two ids, never text. Rishi's bound
// (decisions.md 2026-10-04, last entry): admins get NO bypass — their extra
// power is approval only. A location with no department has no dimension to
// match — the same NULL-belongs-to-every-scope carve-out the LOB scope applies
// — and a user without a department cannot match a location that has one.
// --------------------------------------------------------------------------------

export type PostingSide = 'FROM' | 'TO';

export function assertPostingDepartment(
  side: PostingSide,
  kind: 'Transfer Shipment' | 'Transfer Receipt',
  check: { userDepartmentId: string | null | undefined; locationDepartmentId: string | null | undefined },
): void {
  const at = side === 'FROM' ? 'From' : 'To';
  if (!check.locationDepartmentId) return;
  if (!check.userDepartmentId) {
    throw new ForbiddenException(`Your user record has no department (User Setup); the ${at} sub-location's department is set, so you cannot post this ${kind}.`);
  }
  if (check.userDepartmentId !== check.locationDepartmentId) {
    throw new ForbiddenException(`Only the ${at} sub-location's department may post this ${kind}.`);
  }
}

/**
 * The requisition's ship()/receive() endpoints take requisition line ids;
 * StockTransferService.postShipment/postReceipt take transfer line ids. This
 * is the one translation between them, re-raising the linked transfer's own
 * refusal (a requisition line the linked transfer does not carry) rather than
 * letting the transfer service's own "not part of" message name a transfer
 * line id the caller never supplied.
 */
export function mapToTransferLines(
  inputs: Array<{ line_id: string; quantity: number }>,
  transferLines: Array<{ line_id: string; requisition_line_id: string | null }>,
): Array<{ line_id: string; quantity: number }> {
  return inputs.map((input) => {
    const target = transferLines.find((t) => t.requisition_line_id === input.line_id);
    if (!target) throw new BadRequestException(`Requisition line ${input.line_id} is not on the linked transfer.`);
    return { line_id: target.line_id, quantity: input.quantity };
  });
}

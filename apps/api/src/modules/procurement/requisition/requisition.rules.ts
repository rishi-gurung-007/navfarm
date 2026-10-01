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

function assertLineFields(docType: CommonDocType, line: RequisitionLineRule, lineNo: number): void {
  const at = `Requisition line ${lineNo}`;
  if (!(Number(line.quantity) > 0)) {
    throw new BadRequestException(`${at} needs a quantity greater than zero.`);
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
 * Eligibility only — a draft may record the intent. The permission half lives
 * in assertDirectTransfer, which Task 10 calls at posting time with the
 * caller's real grant (the concrete permission key is bound in Task 11, so
 * this task tests the rule, not a key nobody has yet).
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
    throw new ForbiddenException('Direct Transfer requires the explicit Direct Transfer permission.');
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

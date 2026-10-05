/**
 * The common requisition (Item / Fixed Asset / Service) view model and the
 * client-side rules that mirror the API's own (requisition.rules.ts and
 * requisition.service.ts, Tasks 1–3 and 7–8 of this plan).
 *
 * This is the model Task 12's full-replace PUT will serialize unmodified —
 * `toRequisitionPayload` is the only place that turns the editor's state back
 * into the API body — so it carries every header and line field
 * `UpdateRequisitionDto` accepts AND that `RequisitionService.update()`
 * actually persists from the body (requisition.service.ts:292-350): purpose,
 * requisition_date, main_location_id, requester_department_id,
 * sender_department_id, from/to_location_id, direct_transfer, required_date,
 * justification, remarks, and per line: item_id, description,
 * quantity, uom, est_rate, from/to_location_id, qty_to_ship, qty_to_receive.
 * Everything else `GET /requisition/:id` (findOne) returns is either a
 * display-only derivation (codes/names resolved from ids, the three
 * projected state dimensions, shipments) or a field the update DTO does not
 * accept at all (requester_user_id, created_by/updated_by, the FEED-only
 * columns) — none of those round-trip through the PUT, so the model carries
 * their display form only (e.g. approved_by_name, not approved_by).
 */
export type CommonDocType = "ITEM" | "FA" | "SERVICE";
export type CommonPurpose = "STORE" | "PURCHASE";

export interface CommonRequisitionLine {
  line_id?: string;
  line_seq?: number;
  item_id: string | null;
  item_code?: string | null;
  item_name?: string | null;
  resource_id: string | null;
  resource_code?: string | null;
  resource_name?: string | null;
  description: string | null;
  quantity: string;
  uom: string;
  est_rate: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  from_location_code?: string | null;
  to_location_code?: string | null;
  qty_to_ship: string | null;
  qty_shipped?: number | string | null;
  qty_to_receive: string | null;
  qty_received?: number | string | null;
  balance_to_ship?: number;
  remaining_to_receive?: number;
  /** WP1c Item Tracking (Rishi's 4 Oct list): ITEM lines only — one lot, and
   *  a comma-separated serial list, one serial per unit. */
  lot_no?: string | null;
  serial_no?: string | null;
}

export interface CommonShipment {
  shipment_id: string;
  shipment_no: string;
  shipment_date: string;
  lines: { requisition_line_id: string; shipped: number; received: number; remaining: number }[];
}

export interface CommonRequisitionView {
  requisition_id?: string;
  req_no?: string;
  company_id: string;
  farm_id?: string | null;
  doc_type: CommonDocType;
  purpose: CommonPurpose;
  status?: string;
  requisition_date: string | null;
  required_date: string | null;
  main_location_id: string | null;
  main_location_code?: string | null;
  /** WP1c (Rishi's 4 Oct list): shown on the header; never a client input. */
  requester_user_id?: string | null;
  /** Rishi, 5 Oct: the Requester User ID is shown as the login (email); the
   *  API resolves it from requester_user_id. Display only — never sent back. */
  requester_login?: string | null;
  /** Review p1f, I3: what release() and receive() would decide about the
   *  signed-in user, computed by the API with its own helpers. The web never
   *  re-states those rules; the document's state still gates the button. */
  may_release?: boolean;
  may_receive?: boolean;
  requester_name?: string | null;
  requester_department_id: string | null;
  requester_department_name?: string | null;
  sender_department_id: string | null;
  sender_department_name?: string | null;
  from_location_id: string | null;
  from_location_code?: string | null;
  to_location_id: string | null;
  to_location_code?: string | null;
  direct_transfer: boolean;
  justification: string | null;
  remarks: string | null;
  approval_status?: string | null;
  document_status?: string | null;
  fulfilment_status?: string | null;
  integration_status?: string | null;
  approval_request_id?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  released_by_name?: string | null;
  released_at?: string | null;
  linked_po_no?: string | null;
  linked_transfer_no?: string | null;
  lines: CommonRequisitionLine[];
  shipments?: CommonShipment[];
}

export interface CommonRequisitionOptions {
  items: { item_id: string; item_code: string; item_name: string; uom_primary: string | null; is_lot_tracked?: boolean; is_serial_tracked?: boolean }[];
  locations: { location_id: string; location_code: string; location_name: string; location_type: string; farm_id: string | null }[];
  departments: { cost_center_id: string; cost_center_code: string; cost_center_name: string }[];
  /** WP1c: the signed-in user's own Direct Transfer right (User Setup). */
  may_direct_transfer?: boolean;
}

export const emptyLine = (): CommonRequisitionLine => ({
  item_id: null, resource_id: null, description: null, quantity: "", uom: "", est_rate: null,
  from_location_id: null, to_location_id: null, qty_to_ship: null, qty_to_receive: null,
  lot_no: null, serial_no: null,
});

/**
 * A new, unsaved requisition. `requesterLogin` is the signed-in user's login:
 * the API records the caller as the requester on create, so the header shows
 * who that will be before the first Save (Rishi, 5 Oct).
 */
export function emptyCommonRequisition(companyId: string, docType: CommonDocType, purpose: CommonPurpose, today: string, requesterLogin: string | null = null): CommonRequisitionView {
  return {
    company_id: companyId, doc_type: docType, purpose, requisition_date: today, required_date: null, requester_login: requesterLogin,
    main_location_id: null, requester_department_id: null, sender_department_id: null,
    from_location_id: null, to_location_id: null, direct_transfer: false, justification: null, remarks: null,
    lines: [emptyLine()],
  };
}

const n = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const s = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? undefined : v);

/** The POST/PUT /requisition body — only the fields the API accepts; Purchase carries no locations or transfer targets. */
export function toRequisitionPayload(v: CommonRequisitionView): Record<string, unknown> {
  const store = v.purpose === "STORE";
  return {
    company_id: v.company_id,
    ...(s(v.farm_id ?? null) ? { farm_id: v.farm_id } : {}),
    doc_type: v.doc_type,
    purpose: v.purpose,
    requisition_date: s(v.requisition_date),
    main_location_id: s(v.main_location_id),
    requester_department_id: s(v.requester_department_id),
    sender_department_id: s(v.sender_department_id),
    from_location_id: store ? s(v.from_location_id) : undefined,
    to_location_id: store ? s(v.to_location_id) : undefined,
    direct_transfer: store && v.doc_type === "ITEM" ? v.direct_transfer : false,
    required_date: s(v.required_date),
    justification: s(v.justification),
    remarks: s(v.remarks),
    lines: v.lines.map((l) => ({
      item_id: v.doc_type === "ITEM" ? s(l.item_id) : undefined,
      // No resource_id: no line names a Resource (Rishi, 5 Oct — Service lines
      // are Description + Qty only), and the API refuses one on every kind.
      description: s(l.description),
      quantity: Number(l.quantity),
      // WP1c addendum (Rishi, 5 Oct): an FA/Service line is "Description + Qty
      // only" — no unit (nullable since 0149; the API requires one on ITEM
      // lines only) and no estimated rate, which was ours to begin with.
      uom: v.doc_type === "ITEM" ? s(l.uom) : undefined,
      est_rate: v.doc_type === "ITEM" ? n(l.est_rate) : undefined,
      from_location_id: store ? s(l.from_location_id) : undefined,
      to_location_id: store ? s(l.to_location_id) : undefined,
      qty_to_ship: store ? n(l.qty_to_ship) : undefined,
      qty_to_receive: store ? n(l.qty_to_receive) : undefined,
      // ITEM only: the API refuses a lot or serial on an FA/Service line
      // (assertLineFields), because those are Description + Qty only.
      lot_no: v.doc_type === "ITEM" ? s(l.lot_no) : undefined,
      serial_no: v.doc_type === "ITEM" ? s(l.serial_no) : undefined,
    })),
  };
}

/**
 * The PUT /requisition/:id body: the create body without company_id. The API's
 * UpdateRequisitionDto omits it (a document never changes company) and its
 * whitelist refuses it outright — before this, Save and Submit on every saved
 * draft answered 400 "property company_id should not exist" (P1 e2e, 5 Oct).
 */
export function toRequisitionUpdatePayload(v: CommonRequisitionView): Record<string, unknown> {
  const { company_id: _company, ...body } = toRequisitionPayload(v);
  return body;
}

/**
 * WP1c (Rishi's 4 Oct list): "Status: Open / Released". The document's four
 * state dimensions stay as they are underneath — approval is shown in its own
 * field, because approval precedes release and the two are not one state
 * (decisions, 1 Oct) — but the header's Status is this two-value projection.
 * A cancelled document reports Cancelled rather than claiming to be Open.
 */
export function commonStatus(v: CommonRequisitionView): "OPEN" | "RELEASED" | "CANCELLED" {
  const doc = v.document_status ?? "OPEN";
  if (doc === "RELEASED") return "RELEASED";
  if (doc === "CANCELLED") return "CANCELLED";
  return "OPEN";
}

/** Mirrors the API's assertEditable: a new document, or approval OPEN and document OPEN. */
export function isCommonEditable(v: CommonRequisitionView): boolean {
  if (!v.requisition_id) return true;
  return (v.approval_status ?? "OPEN") === "OPEN" && (v.document_status ?? "OPEN") === "OPEN";
}

export type CommonAction = "save" | "submit" | "reopen" | "release" | "linkPo" | "ship" | "receive";

export function commonActions(v: CommonRequisitionView, can: { create: boolean; approve: boolean; transfer: boolean }): CommonAction[] {
  if (!v.requisition_id) return can.create ? ["save"] : [];
  const approval = v.approval_status ?? "OPEN";
  const doc = v.document_status ?? "OPEN";
  const out: CommonAction[] = [];
  if (approval === "OPEN" && doc === "OPEN" && can.create) out.push("save", "submit");
  if (approval === "REJECTED" && can.create) out.push("reopen");
  // Rishi, 5 Oct: Release is for any user who may approve the requisition —
  // the API decides who that is and says so in may_release (review p1f, I3).
  if (approval === "APPROVED" && doc === "APPROVED" && v.may_release) out.push("release");
  if (doc === "RELEASED" && v.purpose === "PURCHASE" && can.approve) out.push("linkPo");
  if (doc === "RELEASED" && v.purpose === "STORE") {
    if (can.transfer && v.lines.some((l) => (l.balance_to_ship ?? 0) > 1e-9)) out.push("ship");
    // Rishi, 5 Oct: "The one requesting is the one who would be receiving" —
    // the API decides it (requester at the To department) in may_receive.
    if (v.may_receive && (v.shipments ?? []).some((sh) => sh.lines.some((l) => l.remaining > 1e-9))) out.push("receive");
  }
  return out;
}

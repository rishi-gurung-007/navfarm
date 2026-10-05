import { commonActions, emptyCommonRequisition, emptyLine, isCommonEditable, toRequisitionPayload, toRequisitionUpdatePayload } from "../src/components/console/requisitions/common-requisition-model";

const base = () => ({ ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "req-1", approval_status: "OPEN", document_status: "OPEN", requester_user_id: "u-req" });
const all = { create: true, approve: true, transfer: true };
/** The signed-in requester: base() is raised by u-req. */
const ME = { userId: "u-req", userType: "STANDARD_USER" };

describe("common requisition model", () => {
  it("starts a new document Open, dated today, with one empty line", () => {
    const v = emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-04");
    expect(v).toMatchObject({ company_id: "co-1", doc_type: "FA", purpose: "PURCHASE", requisition_date: "2026-10-04", direct_transfer: false });
    expect(v.lines).toHaveLength(1);
    expect(isCommonEditable(v)).toBe(true);
  });

  it("sends locations and to-ship targets only for Store, and numbers as numbers", () => {
    const v = { ...base(), from_location_id: "st", to_location_id: "sh", lines: [{ ...base().lines[0], item_id: "i1", quantity: "10", uom: "EA", qty_to_ship: "6" }] };
    expect(toRequisitionPayload(v)).toMatchObject({ company_id: "co-1", doc_type: "ITEM", purpose: "STORE", from_location_id: "st", to_location_id: "sh",
      lines: [{ item_id: "i1", quantity: 10, uom: "EA", qty_to_ship: 6 }] });
    const p = toRequisitionPayload({ ...v, purpose: "PURCHASE" }) as any;
    expect(p.from_location_id).toBeUndefined();
    expect(p.lines[0].qty_to_ship).toBeUndefined();
  });

  it.each([
    [{}, ["save", "submit"]],
    // P1 e2e (5 Oct): no "Open the approval" link — Approvals no longer lists
    // requisitions (decisions, 5 Oct), so the link landed on a page without it.
    [{ approval_status: "PENDING_APPROVAL", approval_request_id: "ar-1" }, []],
    [{ approval_status: "REJECTED", approval_request_id: "ar-1" }, ["reopen"]],
    [{ approval_status: "APPROVED", document_status: "APPROVED", approval_request_id: "ar-1" }, ["release"]],
    [{ approval_status: "APPROVED", document_status: "RELEASED", purpose: "PURCHASE", approval_request_id: "ar-1" }, ["linkPo"]],
  ])("offers the actions for %j", (over, actions) => {
    expect(commonActions({ ...base(), ...over } as any, all)).toEqual(actions);
  });

  it("offers ship while a line has balance to ship and receive while a shipment has something unreceived", () => {
    const v = { ...base(), approval_status: "APPROVED", document_status: "RELEASED", purpose: "STORE" as const,
      lines: [{ ...base().lines[0], line_id: "l1", balance_to_ship: 4 }],
      shipments: [{ shipment_id: "s1", shipment_no: "SH-2026-0001", shipment_date: "2026-10-04", lines: [{ requisition_line_id: "l1", shipped: 6, received: 2, remaining: 4 }] }] };
    expect(commonActions(v, all, ME)).toEqual(["ship", "receive"]);
    // Rishi, 5 Oct: the requester receives, with no separate receive grant;
    // shipping stays with the transfer grant (the sender department).
    expect(commonActions(v, { ...all, transfer: false }, ME)).toEqual(["receive"]);
    expect(commonActions(v, all, { userId: "someone-else" })).toEqual(["ship"]);
    expect(commonActions(v, all)).toEqual(["ship"]);
  });

  // Pins the .some() over v.lines: a lines[0]-only check would miss the
  // second line's balance and wrongly omit "ship".
  it("offers ship only when the second of two lines carries a balance to ship", () => {
    const v = { ...base(), approval_status: "APPROVED", document_status: "RELEASED", purpose: "STORE" as const,
      lines: [
        { ...base().lines[0], line_id: "l1", balance_to_ship: 0 },
        { ...base().lines[0], line_id: "l2", balance_to_ship: 4 },
      ] };
    expect(commonActions(v, all)).toEqual(["ship"]);
  });

  // Pins both levels of .some(): shipments.some(sh => sh.lines.some(...)).
  // A check of shipments[0] only, or of lines[0] within a shipment only,
  // would both miss the one unreceived line and wrongly omit "receive".
  it("offers receive only when the second line of the second shipment still has something unreceived", () => {
    const v = { ...base(), approval_status: "APPROVED", document_status: "RELEASED", purpose: "STORE" as const,
      lines: [{ ...base().lines[0], line_id: "l1", balance_to_ship: 0 }],
      shipments: [
        { shipment_id: "s1", shipment_no: "SH-2026-0001", shipment_date: "2026-10-04", lines: [
          { requisition_line_id: "l1", shipped: 4, received: 4, remaining: 0 },
          { requisition_line_id: "l1", shipped: 2, received: 2, remaining: 0 },
        ] },
        { shipment_id: "s2", shipment_no: "SH-2026-0002", shipment_date: "2026-10-05", lines: [
          { requisition_line_id: "l1", shipped: 3, received: 3, remaining: 0 },
          { requisition_line_id: "l1", shipped: 6, received: 2, remaining: 4 },
        ] },
      ] };
    expect(commonActions(v, all, ME)).toEqual(["receive"]);
  });

  it("offers nothing to a user without the grants", () => {
    expect(commonActions(base(), { create: false, approve: false, transfer: false })).toEqual([]);
  });
});

/**
 * WP1c Item Tracking (Rishi's 4 Oct list): the line's Lot/Serial assignment is
 * an ITEM-line field. FA and Service lines are Description + Qty only, and the
 * API refuses either field on them, so the payload must not send them there.
 */
describe("common requisition payload — Item Tracking assignment", () => {
  it("sends lot_no and serial_no on an ITEM line", () => {
    const v = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05");
    v.lines = [{ ...emptyLine(), item_id: "i1", quantity: "10", uom: "EA", lot_no: "L-1", serial_no: "S-1, S-2" }];
    expect(toRequisitionPayload(v).lines).toEqual([expect.objectContaining({ lot_no: "L-1", serial_no: "S-1, S-2" })]);
  });

  it("omits them on a Fixed Asset or Service line", () => {
    for (const docType of ["FA", "SERVICE"] as const) {
      const v = emptyCommonRequisition("co-1", docType, "PURCHASE", "2026-10-05");
      v.lines = [{ ...emptyLine(), description: "Tractor", quantity: "1", uom: "EA", lot_no: "L-1", serial_no: "S-1" }];
      const [line] = toRequisitionPayload(v).lines as Record<string, unknown>[];
      expect(line.lot_no).toBeUndefined();
      expect(line.serial_no).toBeUndefined();
    }
  });

  it("omits an empty assignment rather than sending blanks", () => {
    const v = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05");
    v.lines = [{ ...emptyLine(), item_id: "i1", quantity: "10", uom: "EA", lot_no: "", serial_no: null }];
    const [line] = toRequisitionPayload(v).lines as Record<string, unknown>[];
    expect(line.lot_no).toBeUndefined();
    expect(line.serial_no).toBeUndefined();
  });
});

/**
 * WP1c addendum (decisions.md 2026-10-05, Rishi: "follow the file shared").
 * An FA/Service line is "Description + Qty only": no unit, no rate. The column
 * is nullable from migration 0149 and the API requires a unit on ITEM only.
 */
describe("common requisition payload — FA/Service lines carry no unit", () => {
  it("sends the unit on an ITEM line", () => {
    const v = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05");
    v.lines = [{ ...emptyLine(), item_id: "i1", quantity: "10", uom: "KG" }];
    expect((toRequisitionPayload(v).lines as Record<string, unknown>[])[0].uom).toBe("KG");
  });

  it("omits the unit and the rate on a Fixed Asset or Service line", () => {
    for (const docType of ["FA", "SERVICE"] as const) {
      const v = emptyCommonRequisition("co-1", docType, "PURCHASE", "2026-10-05");
      v.lines = [{ ...emptyLine(), description: "Tractor", quantity: "1", uom: "EA", est_rate: "500" }];
      const [line] = toRequisitionPayload(v).lines as Record<string, unknown>[];
      expect(line.uom).toBeUndefined();
      expect(line.est_rate).toBeUndefined();
    }
  });
});

describe("common requisition payload — no line names a Resource (Rishi, 5 Oct)", () => {
  it("never sends resource_id, even from a Service line that carried one", () => {
    for (const docType of ["ITEM", "FA", "SERVICE"] as const) {
      const v = emptyCommonRequisition("co-1", docType, "PURCHASE", "2026-10-05");
      v.lines = [{ ...emptyLine(), item_id: docType === "ITEM" ? "i1" : null, description: "Electrician", quantity: "1", uom: "EA", resource_id: "r1" }];
      const [line] = toRequisitionPayload(v).lines as Record<string, unknown>[];
      expect(line).not.toHaveProperty("resource_id");
    }
  });
});

describe("common requisition payload — PUT body (P1 e2e)", () => {
  it("is the create body without company_id, which UpdateRequisitionDto refuses", () => {
    const v = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), requisition_id: "r-1", from_location_id: "st", to_location_id: "sh" };
    const { company_id: _company, ...rest } = toRequisitionPayload(v) as Record<string, unknown>;
    expect(toRequisitionUpdatePayload(v)).toEqual(rest);
    expect(toRequisitionUpdatePayload(v)).not.toHaveProperty("company_id");
  });
});

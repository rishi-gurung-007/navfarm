import { commonActions, emptyCommonRequisition, isCommonEditable, toRequisitionPayload } from "../src/components/console/requisitions/common-requisition-model";

const base = () => ({ ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "req-1", approval_status: "OPEN", document_status: "OPEN" });
const all = { create: true, approve: true, transfer: true };

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
    [{ approval_status: "PENDING_APPROVAL", approval_request_id: "ar-1" }, ["openApproval"]],
    [{ approval_status: "REJECTED", approval_request_id: "ar-1" }, ["reopen", "openApproval"]],
    [{ approval_status: "APPROVED", document_status: "APPROVED", approval_request_id: "ar-1" }, ["openApproval", "release"]],
    [{ approval_status: "APPROVED", document_status: "RELEASED", purpose: "PURCHASE", approval_request_id: "ar-1" }, ["openApproval", "linkPo"]],
  ])("offers the actions for %j", (over, actions) => {
    expect(commonActions({ ...base(), ...over } as any, all)).toEqual(actions);
  });

  it("offers ship while a line has balance to ship and receive while a shipment has something unreceived", () => {
    const v = { ...base(), approval_status: "APPROVED", document_status: "RELEASED", purpose: "STORE" as const,
      lines: [{ ...base().lines[0], line_id: "l1", balance_to_ship: 4 }],
      shipments: [{ shipment_id: "s1", shipment_no: "SH-2026-0001", shipment_date: "2026-10-04", lines: [{ requisition_line_id: "l1", shipped: 6, received: 2, remaining: 4 }] }] };
    expect(commonActions(v, all)).toEqual(["ship", "receive"]);
    expect(commonActions(v, { ...all, transfer: false })).toEqual([]);
  });

  it("offers nothing to a user without the grants", () => {
    expect(commonActions(base(), { create: false, approve: false, transfer: false })).toEqual([]);
  });
});

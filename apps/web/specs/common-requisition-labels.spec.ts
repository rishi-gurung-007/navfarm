import { translations } from "../src/utils/translations";

/**
 * P1 e2e (5 Oct): the common requisition's header, line and button labels are
 * Rishi's, word for word (docs/superpowers/plans/feed-completion/common-requisition-spec.md;
 * master plan WP1c: "in this order and with these labels"). The live pass found
 * ours instead — "Store or Purchase", "From location", "Shipped", "Ship…".
 */
const en = translations.en as Record<string, string>;

describe("common requisition labels are Rishi's (4 Oct list)", () => {
  it.each([
    ["crqReqNo", "Purchase Requisition No."],
    ["crqReqDate", "Purchase Requisition Date"],
    ["crqMainLocation", "Main / Farm Location"],
    ["crqRequesterUserId", "Requester User ID"],
    ["crqRequester", "Requester Name"],
    ["crqRequesterDept", "Requester Department"],
    ["crqSenderDept", "Sender Department"],
    ["crqType", "Requisition Type"],
    ["crqStatus", "Status"],
    ["crqPurpose", "Purpose"],
    ["crqFrom", "From Sub-Location"],
    ["crqTo", "To Sub-Location"],
    ["crqDirectTransfer", "Direct Transfer"],
    ["crqRemarks", "Remarks"],
  ])("header %s is %s", (key, label) => expect(en[key]).toBe(label));

  it.each([
    ["crqColLine", "Line No."],
    ["crqColItem", "Item No."],
    ["crqColItemDescription", "Item Description"],
    ["crqColFaServiceDescription", "Fixed Asset or Service Description"],
    ["crqColQty", "Qty"],
    ["crqColFrom", "From Location"],
    ["crqColTo", "To Location"],
    ["crqColToShip", "Qty to Ship"],
    ["crqColShipped", "Qty Shipped"],
    ["crqColToReceive", "Qty to Receive"],
    ["crqColReceived", "Qty Received"],
    ["crqColRemaining", "Remaining to Receive"],
    ["crqColBalance", "Balance to Ship"],
  ])("line column %s is %s", (key, label) => expect(en[key]).toBe(label));

  it.each([
    ["crqRelease", "Release"],
    ["crqShip", "Transfer Shipment"],
    ["crqReceive", "Transfer Receipt"],
    ["crqColTracking", "Item Tracking"],
  ])("button %s is %s", (key, label) => expect(en[key]).toBe(label));
});

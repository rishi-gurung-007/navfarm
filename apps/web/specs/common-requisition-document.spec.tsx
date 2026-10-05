import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommonRequisitionDocument } from "../src/components/console/requisitions/common-requisition-document";
import { emptyCommonRequisition, emptyLine } from "../src/components/console/requisitions/common-requisition-model";

jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));
// The real picker fetches the available lots/serials from the API; this spec
// is about whether the line offers it and where its value lands.
jest.mock("../src/components/ui/lot-serial-picker", () => ({
  LotSerialPicker: ({ ariaLabel, value, onChange, trackingType }: any) => (
    <input aria-label={ariaLabel} data-tracking={trackingType} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const options = {
  items: [{ item_id: "i1", item_code: "IT-1", item_name: "Fixture item", uom_primary: "EA" },
          { item_id: "i-lot", item_code: "IT-LOT", item_name: "Lot item", uom_primary: "EA", is_lot_tracked: true, is_serial_tracked: false },
          { item_id: "i-ser", item_code: "IT-SER", item_name: "Serial item", uom_primary: "EA", is_lot_tracked: false, is_serial_tracked: true }],
  resources: [], departments: [],
  locations: [{ location_id: "st", location_code: "F1/STORE", location_name: "Store", location_type: "STORE", farm_id: "f1" },
              { location_id: "sh", location_code: "F1/SHED-1", location_name: "Shed", location_type: "SHED", farm_id: "f1" }],
};

describe("CommonRequisitionDocument", () => {
  it("edits the header and a line while Open, filling the item's UOM", () => {
    const onChange = jest.fn();
    const view = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04");
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("crqFrom"), { target: { value: "st" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from_location_id: "st" }));
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":1}'), { target: { value: "i1" } });
    expect(onChange.mock.lastCall[0].lines[0]).toMatchObject({ item_id: "i1", uom: "EA" });
  });

  it("hides locations and transfer quantities on a Purchase document", () => {
    render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-04")} editable options={options} onChange={jest.fn()} />);
    expect(screen.queryByLabelText("crqFrom")).toBeNull();
    expect(screen.queryByText("crqColToShip")).toBeNull();
    expect(screen.getByLabelText('crqDescriptionFor:{"line":1}')).toBeTruthy();
  });

  it("is read-only after submission and shows shipped/received with derived balances", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "r", req_no: "REQ-2026-0001",
      approval_status: "APPROVED", document_status: "RELEASED", fulfilment_status: "PARTIALLY_RECEIVED", from_location_code: "F1/STORE",
      lines: [{ line_id: "l1", line_seq: 1, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
        quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 6,
        qty_to_receive: "10", qty_received: 4, balance_to_ship: 4, remaining_to_receive: 6 }] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("REQ-2026-0001")).toBeTruthy();
    // header From and the line's From cell both show the code
    expect(screen.getAllByText("F1/STORE").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("crq-balance-1").textContent).toBe("4");
    expect(screen.getByTestId("crq-remaining-1").textContent).toBe("6");
  });

  // Pins the per-row .map(): two lines must each render their own aria-labeled
  // controls, and editing the second must not touch the first. If rendering
  // ever collapsed to "always line[0]", both aria-labels would collide
  // (getByLabelText throws on a duplicate) and the edit would land on the
  // wrong line.
  it("renders two lines with distinct aria-labels and edits only the targeted line, not the first", () => {
    const onChange = jest.fn();
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), lines: [emptyLine(), emptyLine()] };
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={onChange} />);
    expect(screen.getByLabelText('crqItemFor:{"line":1}')).toBeTruthy();
    expect(screen.getByLabelText('crqItemFor:{"line":2}')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":2}'), { target: { value: "i1" } });
    const next = onChange.mock.lastCall[0];
    expect(next.lines[0]).toMatchObject({ item_id: null });
    expect(next.lines[1]).toMatchObject({ item_id: "i1", uom: "EA" });
  });

  // Pins line_seq ?? i+1 numbering across two lines, mixed: the first line
  // carries no line_seq (falls back to i+1 = 1) and the second carries an
  // explicit line_seq (9) that does not equal its index + 1 (2) — so a bug
  // that numbered by index alone, or that rendered only one row, would
  // produce the wrong test id or a missing one on either row.
  it("numbers two lines by line_seq with the i+1 fallback and keeps their balance/remaining ids and values distinct", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "r", req_no: "REQ-2026-0002",
      approval_status: "APPROVED", document_status: "RELEASED",
      lines: [
        { line_id: "l1", item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
          quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 10,
          qty_to_receive: "10", qty_received: 2, balance_to_ship: 0, remaining_to_receive: 8 },
        { line_id: "l2", line_seq: 9, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
          quantity: "5", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "5", qty_shipped: 1,
          qty_to_receive: "5", qty_received: 0, balance_to_ship: 4, remaining_to_receive: 1 },
      ] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.getByTestId("crq-balance-1").textContent).toBe("0");
    expect(screen.getByTestId("crq-remaining-1").textContent).toBe("8");
    expect(screen.getByTestId("crq-balance-9").textContent).toBe("4");
    expect(screen.getByTestId("crq-remaining-9").textContent).toBe("1");
  });
});

/**
 * WP1c Item Tracking (Rishi's 4 Oct list): "ITEM TRACKING BUTTON (on Sub-Form
 * Line): Opens Lot/Serial assignment page". It belongs to a Store Item line
 * whose item is tracked — nowhere else.
 */
describe("CommonRequisitionDocument — Item Tracking on the line", () => {
  const storeLine = (over: Record<string, unknown> = {}) => ({
    ...emptyLine(), item_id: "i-lot", quantity: "10", uom: "EA", qty_to_ship: "10", ...over,
  });

  it("offers a lot picker on a lot-tracked line and writes the choice to that line", () => {
    const onChange = jest.fn();
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), from_location_id: "st", lines: [storeLine()] };
    render(<CommonRequisitionDocument view={view as any} editable options={options} onChange={onChange} />);
    const picker = screen.getByLabelText('crqTrackingFor:{"line":1}');
    expect(picker.getAttribute("data-tracking")).toBe("LOT");
    fireEvent.change(picker, { target: { value: "L-7" } });
    expect(onChange.mock.lastCall[0].lines[0]).toMatchObject({ lot_no: "L-7" });
  });

  it("offers a serial picker on a serial-tracked line and writes serial_no", () => {
    const onChange = jest.fn();
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), from_location_id: "st", lines: [storeLine({ item_id: "i-ser" })] };
    render(<CommonRequisitionDocument view={view as any} editable options={options} onChange={onChange} />);
    const picker = screen.getByLabelText('crqTrackingFor:{"line":1}');
    expect(picker.getAttribute("data-tracking")).toBe("SERIAL");
    fireEvent.change(picker, { target: { value: "S-1, S-2" } });
    expect(onChange.mock.lastCall[0].lines[0]).toMatchObject({ serial_no: "S-1, S-2" });
  });

  it("offers nothing on an untracked item", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), from_location_id: "st", lines: [storeLine({ item_id: "i1" })] };
    render(<CommonRequisitionDocument view={view as any} editable options={options} onChange={jest.fn()} />);
    expect(screen.queryByLabelText('crqTrackingFor:{"line":1}')).toBeNull();
  });

  it("shows no tracking column at all on a Purchase document", () => {
    render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "ITEM", "PURCHASE", "2026-10-05")} editable options={options} onChange={jest.fn()} />);
    expect(screen.queryByText("crqColTracking")).toBeNull();
  });

  it("shows the assignment as read-only text once the document is no longer editable", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), requisition_id: "r",
      from_location_id: "st", lines: [storeLine({ line_id: "l1", line_seq: 1, lot_no: "L-7" })] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.queryByLabelText('crqTrackingFor:{"line":1}')).toBeNull();
    expect(screen.getByText("L-7")).toBeTruthy();
  });
});

/**
 * WP1c (Rishi's 4 Oct list, "REQUISITION HEADER"): the header carries his
 * fields, with his labels, in his order. Before this the order was the
 * editor's own and three of his fields were missing or wrong: Requester User
 * ID was absent, Requester Department was a free select although his list says
 * "auto from User Setup", and there was no single Status field — the document
 * showed four separate state badges instead.
 */
describe("CommonRequisitionDocument — Rishi's header field list", () => {
  const labelsInOrder = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".nf-text-label")).map((n) => (n.textContent ?? "").trim());

  const storeView = (over: Record<string, unknown> = {}) => ({
    ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"),
    req_no: "REQ-2026-0001", requester_user_id: "u-7", requester_name: "Ada Farm", ...over,
  });

  it("lays the header out in the order of Rishi's list", () => {
    const { container } = render(<CommonRequisitionDocument view={storeView() as any} editable options={options} onChange={jest.fn()} />);
    const labels = labelsInOrder(container);
    const expected = [
      "crqReqNo", "crqReqDate", "crqMainLocation", "crqRequesterUserId", "crqRequester",
      "crqRequesterDept", "crqSenderDept", "crqType", "crqStatus", "crqPurpose",
      "crqFrom", "crqTo", "crqDirectTransfer", "crqRemarks",
    ];
    expect(labels.filter((l) => expected.includes(l))).toEqual(expected);
  });

  it("shows the Requester User ID and keeps Requester Department read-only (auto from User Setup)", () => {
    render(<CommonRequisitionDocument view={storeView({ requester_login: "ada@triplec.local" }) as any} editable options={options} onChange={jest.fn()} />);
    // Rishi, 5 Oct: the User ID is the login (email), never the internal id.
    expect(screen.getByText("ada@triplec.local")).toBeTruthy();
    expect(screen.queryByText("u-7")).toBeNull();
    // Editable document, but this field is never a control.
    expect(screen.queryByLabelText("crqRequesterDept")).toBeNull();
  });

  it("a new, unsaved requisition shows the signed-in user's login as its Requester User ID", () => {
    const view = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05", "me@triplec.local");
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={jest.fn()} />);
    expect(screen.getByText("me@triplec.local")).toBeTruthy();
  });

  it("shows Status as Open until the document is released, then Released", () => {
    const { rerender } = render(<CommonRequisitionDocument view={storeView({ document_status: "APPROVED" }) as any} editable={false} options={options} />);
    expect(screen.getByText("crqStatusOpen")).toBeTruthy();
    rerender(<CommonRequisitionDocument view={storeView({ document_status: "RELEASED" }) as any} editable={false} options={options} />);
    expect(screen.getByText("crqStatusReleased")).toBeTruthy();
  });
});

/**
 * WP1c (Rishi's 4 Oct list, "REQUISITION SUB-FORM LINE"): his columns, in his
 * order. Two things were wrong: Balance to Ship sat before Qty to Receive
 * rather than last, and an Item line had no Item Description column at all —
 * the item code and name were crammed into one cell. Our own columns (UOM,
 * est. rate, the free description, Item Tracking) follow his, never between.
 */
describe("CommonRequisitionDocument — Rishi's line column list", () => {
  const headers = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("thead th")).map((n) => (n.textContent ?? "").trim()).filter(Boolean);

  it("orders the Store Item sub-form by Rishi's list, ours after his", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), from_location_id: "st" };
    const { container } = render(<CommonRequisitionDocument view={view as any} editable options={options} onChange={jest.fn()} />);
    expect(headers(container)).toEqual([
      "crqColLine", "crqColItem", "crqColItemDescription", "crqColQty",
      "crqColFrom", "crqColTo", "crqColToShip", "crqColShipped",
      "crqColToReceive", "crqColReceived", "crqColRemaining", "crqColBalance",
      "crqColUom", "crqColRate", "crqColDescription", "crqColTracking",
    ]);
  });

  it("shows the item's description in its own column, read-only from the Item Master", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), from_location_id: "st",
      lines: [{ ...emptyLine(), item_id: "i1", item_code: "IT-1", item_name: "Fixture item", quantity: "10", uom: "EA" }] };
    const { container } = render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    const cells = Array.from(container.querySelectorAll("tbody td")).map((n) => (n.textContent ?? "").trim());
    expect(cells[1]).toBe("IT-1");
    expect(cells[2]).toBe("Fixture item");
  });

  it("gives a Fixed Asset document only its description and quantity of Rishi's columns", () => {
    const { container } = render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-05")} editable options={options} onChange={jest.fn()} />);
    const h = headers(container);
    // Rishi's own column name for it, not the Item line's free "Description" (P1 e2e).
    expect(h.slice(0, 3)).toEqual(["crqColLine", "crqColFaServiceDescription", "crqColQty"]);
    expect(h).not.toContain("crqColDescription");
    expect(h).not.toContain("crqColItem");
    expect(h).not.toContain("crqColItemDescription");
    expect(h).not.toContain("crqColTracking");
  });
});

describe("CommonRequisitionDocument — FA/Service is Description + Qty only", () => {
  const headers = (c: HTMLElement) => Array.from(c.querySelectorAll("thead th")).map((n) => (n.textContent ?? "").trim()).filter(Boolean);

  it.each(["FA", "SERVICE"] as const)("drops the unit and rate columns on a %s document", (docType) => {
    const { container } = render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", docType, "PURCHASE", "2026-10-05")} editable options={options} onChange={jest.fn()} />);
    const h = headers(container);
    expect(h).not.toContain("crqColUom");
    expect(h).not.toContain("crqColRate");
    expect(h).toContain("crqColFaServiceDescription");
    expect(h).toContain("crqColQty");
  });

  it("keeps the unit on an Item document, where the API still requires one", () => {
    const { container } = render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05")} editable options={options} onChange={jest.fn()} />);
    expect(headers(container)).toContain("crqColUom");
  });

  // WP4a fix round 1 (Rishi's 4 Oct list: "ITEM TRACKING BUTTON (on Sub-Form
  // Line): Opens Lot/Serial assignment page … MANDATORY before Transfer
  // Shipment post"): after release the line's button opens the picker for the
  // unshipped balance and saves through the caller (POST /requisition/:id/item-tracking).
  describe("Item Tracking on a released Store requisition", () => {
    const released = (over: Record<string, unknown> = {}) => ({
      ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-05"), requisition_id: "r", req_no: "RQ-00021",
      approval_status: "APPROVED", document_status: "RELEASED",
      lines: [{ line_id: "l1", line_seq: 1, item_id: "i-lot", item_code: "IT-LOT", item_name: "Lot item", resource_id: null, description: null,
        quantity: "5", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "5", qty_shipped: 0,
        qty_to_receive: "5", qty_received: 0, balance_to_ship: 5, remaining_to_receive: 0, lot_no: null, serial_no: null, ...over }],
    });

    it("opens the picker from the line's Item Tracking button and saves the lot for that line", async () => {
      const onAssignTracking = jest.fn().mockResolvedValue(true);
      render(<CommonRequisitionDocument view={released() as any} editable={false} options={options} onAssignTracking={onAssignTracking} />);
      expect(screen.queryByLabelText('crqTrackingFor:{"line":1}')).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: 'crqItemTrackingFor:{"line":1}' }));
      fireEvent.change(screen.getByLabelText('crqTrackingFor:{"line":1}'), { target: { value: "LOT00001" } });
      fireEvent.click(screen.getByRole("button", { name: "crqTrackingSave" }));
      expect(onAssignTracking).toHaveBeenCalledWith("l1", { lot_no: "LOT00001" });
    });

    it("sends serials for a serial-tracked line", () => {
      const onAssignTracking = jest.fn().mockResolvedValue(true);
      render(<CommonRequisitionDocument view={released({ item_id: "i-ser", item_code: "IT-SER" }) as any} editable={false} options={options} onAssignTracking={onAssignTracking} />);
      fireEvent.click(screen.getByRole("button", { name: 'crqItemTrackingFor:{"line":1}' }));
      fireEvent.change(screen.getByLabelText('crqTrackingFor:{"line":1}'), { target: { value: "SN1,SN2" } });
      fireEvent.click(screen.getByRole("button", { name: "crqTrackingSave" }));
      expect(onAssignTracking).toHaveBeenCalledWith("l1", { serial_no: "SN1,SN2" });
    });

    it("offers no button once the line has nothing left to ship, nor without the caller's save", () => {
      const { unmount } = render(<CommonRequisitionDocument view={released({ balance_to_ship: 0, lot_no: "LOT00001" }) as any} editable={false} options={options} onAssignTracking={jest.fn()} />);
      expect(screen.queryByRole("button", { name: 'crqItemTrackingFor:{"line":1}' })).toBeNull();
      expect(screen.getByText("LOT00001")).toBeTruthy();
      unmount();
      render(<CommonRequisitionDocument view={released() as any} editable={false} options={options} />);
      expect(screen.queryByRole("button", { name: 'crqItemTrackingFor:{"line":1}' })).toBeNull();
    });
  });
});

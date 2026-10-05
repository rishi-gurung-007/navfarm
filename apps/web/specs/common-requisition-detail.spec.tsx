import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommonRequisitionDetail } from "../src/components/console/requisitions/common-requisition-detail";
import { emptyCommonRequisition, toRequisitionPayload, toRequisitionUpdatePayload, type CommonRequisitionView } from "../src/components/console/requisitions/common-requisition-model";
import { todayIso } from "../src/components/console/inventory/feed-format";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock("../src/hooks/useAuth", () => ({ getStoredUser: () => ({}), hasPermission: () => true }));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));
// The real picker reads the available lots/serials from the API; here only its value matters.
jest.mock("../src/components/ui/lot-serial-picker", () => ({
  LotSerialPicker: ({ ariaLabel, value, onChange }: any) => (
    <input aria-label={ariaLabel} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const options = {
  items: [{ item_id: "i1", item_code: "IT-1", item_name: "Fixture item", uom_primary: "EA" }],
  resources: [],
  departments: [{ cost_center_id: "d1", cost_center_code: "D1", cost_center_name: "Dept" }],
  locations: [
    { location_id: "st", location_code: "F1/STORE", location_name: "Store", location_type: "STORE", farm_id: "f1" },
    { location_id: "sh", location_code: "F1/SHED-1", location_name: "Shed", location_type: "SHED", farm_id: "f1" },
  ],
};

const line = (n: number, extra: Record<string, unknown> = {}) => ({
  line_id: `l${n}`, line_seq: n, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
  quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 0,
  qty_to_receive: "10", qty_received: 0, balance_to_ship: 0, remaining_to_receive: 0, ...extra,
});

const base = (over: Partial<CommonRequisitionView> = {}): CommonRequisitionView => ({
  ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"),
  requisition_id: "req-1", req_no: "REQ-2026-0001", from_location_id: "st", to_location_id: "sh",
  approval_status: "OPEN", document_status: "OPEN", ...over,
} as CommonRequisitionView);

const open = (): CommonRequisitionView => base({
  sender_department_id: "d1", required_date: "2026-10-20", justification: "Because", remarks: "Mind the gate", direct_transfer: true,
  lines: [line(1) as any, line(2, { quantity: "7", qty_to_ship: "7" }) as any],
});

const released = (over: Partial<CommonRequisitionView> = {}): CommonRequisitionView =>
  base({ approval_status: "APPROVED", document_status: "RELEASED", ...over });

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: options });
  post.mockImplementation(async () => ({ data: base() }));
  put.mockImplementation(async () => ({ data: base() }));
});

describe("CommonRequisitionDetail", () => {
  it("saves a new Item/Store draft with POST /requisition and hands the response to onView", async () => {
    const onView = jest.fn();
    const saved = base({ requisition_id: "new-1" });
    post.mockResolvedValue({ data: saved });
    const draft = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04") };
    render(<CommonRequisitionDetail initial={draft} onView={onView} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1"));
    await waitFor(() => expect(screen.getAllByRole("option", { name: "F1/STORE" }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("crqFrom"), { target: { value: "st" } });
    fireEvent.change(screen.getByLabelText("crqTo"), { target: { value: "sh" } });
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":1}'), { target: { value: "i1" } });
    fireEvent.change(screen.getByLabelText('crqQtyFor:{"line":1}'), { target: { value: "5" } });
    fireEvent.click(screen.getByText("crqSave"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/requisition", expect.objectContaining({
      doc_type: "ITEM", purpose: "STORE", from_location_id: "st", to_location_id: "sh",
      lines: [expect.objectContaining({ item_id: "i1", quantity: 5, uom: "EA" })],
    }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(saved, "crqSaved"));
  });

  it("saves an existing draft with a full-replace PUT: the whole header and every line, not a partial body", async () => {
    const draft = open();
    const onView = jest.fn();
    render(<CommonRequisitionDetail initial={draft} onView={onView} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqSave"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/requisition/req-1");
    expect(body).toEqual(toRequisitionUpdatePayload(draft));
    // P1 e2e: the API's UpdateRequisitionDto omits company_id and refuses it
    // ("property company_id should not exist"), so Save and Submit always failed.
    expect(body).not.toHaveProperty("company_id");
    expect(body).toMatchObject({
      remarks: "Mind the gate", required_date: "2026-10-20", justification: "Because", sender_department_id: "d1", direct_transfer: true,
    });
    expect(body.lines).toHaveLength(2);
    expect(body.lines[1]).toMatchObject({ quantity: 7 });
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqSaved"));
  });

  it("carries an edit made in the form into the PUT body", async () => {
    render(<CommonRequisitionDetail initial={open()} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('crqQtyFor:{"line":2}'), { target: { value: "9" } });
    fireEvent.click(screen.getByText("crqSave"));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1];
    expect(body.lines.map((l: any) => l.quantity)).toEqual([10, 9]);
  });

  it("submits by saving first (PUT) and then POST /submit, so unsaved edits are never lost", async () => {
    const onView = jest.fn();
    const submitted = base({ approval_status: "PENDING_APPROVAL" });
    post.mockResolvedValue({ data: submitted });
    render(<CommonRequisitionDetail initial={open()} onView={onView} onBack={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('crqQtyFor:{"line":2}'), { target: { value: "8" } });
    fireEvent.click(screen.getByText("crqSubmit"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/submit", {}));
    expect(put.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
    expect(put.mock.calls[0][1].lines[1].quantity).toBe(8);
    expect(put.mock.calls[0][1]).not.toHaveProperty("company_id");
    await waitFor(() => expect(onView).toHaveBeenCalledWith(submitted, "crqSubmitted"));
  });

  it("does not submit when the save fails, and shows the refusal", async () => {
    put.mockRejectedValue({ message: "Quantity must be positive." });
    render(<CommonRequisitionDetail initial={open()} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqSubmit"));
    expect(await screen.findByText("Quantity must be positive.")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("reopens a rejected requisition", async () => {
    const onView = jest.fn();
    render(<CommonRequisitionDetail initial={base({ approval_status: "REJECTED", approval_request_id: "ar-1" })} onView={onView} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqReopen"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/reopen", {}));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqReopened"));
  });

  it("links nowhere: Approvals no longer lists requisitions, the document shows the approval itself (P1 e2e)", () => {
    const { rerender } = render(<CommonRequisitionDetail initial={base({ approval_status: "PENDING_APPROVAL", approval_request_id: "ar-2" })} onView={jest.fn()} onBack={jest.fn()} />);
    expect(screen.queryByText("crqOpenApproval")).toBeNull();
    expect(document.querySelector('a[href^="/approvals/"]')).toBeNull();
    rerender(<CommonRequisitionDetail initial={base({ approval_status: "APPROVED", document_status: "APPROVED", approval_request_id: "ar-2" })} onView={jest.fn()} onBack={jest.fn()} />);
    expect(document.querySelector('a[href^="/approvals/"]')).toBeNull();
  });

  it("releases an approved Store requisition and names the transfer; Approve and Reject are not here", async () => {
    const onView = jest.fn();
    post.mockResolvedValue({ data: released({ linked_transfer_no: "TR-9" }) });
    render(<CommonRequisitionDetail initial={base({ approval_status: "APPROVED", document_status: "APPROVED" })} onView={onView} onBack={jest.fn()} />);
    expect(screen.queryByText(/approve$/i)).toBeNull();
    expect(screen.queryByText(/reject/i)).toBeNull();
    fireEvent.click(screen.getByText("crqRelease"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/release", {}));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), 'crqReleasedStore:{"no":"TR-9"}'));
  });

  it("says the purchase is pending when a Purchase requisition is released", async () => {
    const onView = jest.fn();
    post.mockResolvedValue({ data: released({ purpose: "PURCHASE" }) });
    render(<CommonRequisitionDetail initial={base({ purpose: "PURCHASE", approval_status: "APPROVED", document_status: "APPROVED" })} onView={onView} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqRelease"));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqReleasedPurchase"));
  });

  it("ships several lines at once: only lines with a balance get a field, only positive entries are sent", async () => {
    const onView = jest.fn();
    const view = released({ lines: [line(1, { balance_to_ship: 4 }) as any, line(2, { balance_to_ship: 6 }) as any, line(3, { balance_to_ship: 0 }) as any] });
    render(<CommonRequisitionDetail initial={view} onView={onView} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqShip"));
    expect(screen.queryByLabelText('crqShipQtyFor:{"line":3}')).toBeNull();
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":1}'), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":2}'), { target: { value: "6" } });
    fireEvent.click(screen.getByText("crqPostShipment"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/shipment", {
      posting_date: todayIso(), lines: [{ line_id: "l1", quantity: 3 }, { line_id: "l2", quantity: 6 }],
    }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqShipped"));
  });

  it("leaves a blank shipping line out of the body", async () => {
    const view = released({ lines: [line(1, { balance_to_ship: 4 }) as any, line(2, { balance_to_ship: 6 }) as any] });
    render(<CommonRequisitionDetail initial={view} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqShip"));
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":2}'), { target: { value: "2" } });
    fireEvent.click(screen.getByText("crqPostShipment"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/shipment", { posting_date: todayIso(), lines: [{ line_id: "l2", quantity: 2 }] }));
  });

  it("disables Post shipment when a quantity exceeds the balance or nothing is entered", () => {
    const view = released({ lines: [line(1, { balance_to_ship: 4 }) as any, line(2, { balance_to_ship: 6 }) as any] });
    render(<CommonRequisitionDetail initial={view} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqShip"));
    const post_ = screen.getByText("crqPostShipment").closest("button") as HTMLButtonElement;
    expect(post_.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":2}'), { target: { value: "5" } });
    expect(post_.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":1}'), { target: { value: "5" } });
    expect(post_.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":1}'), { target: { value: "4" } });
    expect(post_.disabled).toBe(false);
  });

  const shipments = [
    { shipment_id: "s1", shipment_no: "SH-1", shipment_date: "2026-10-05", lines: [
      { requisition_line_id: "l1", shipped: 4, received: 0, remaining: 4 }, { requisition_line_id: "l2", shipped: 2, received: 2, remaining: 0 }] },
    { shipment_id: "s2", shipment_no: "SH-2", shipment_date: "2026-10-06", lines: [
      { requisition_line_id: "l1", shipped: 1, received: 1, remaining: 0 }, { requisition_line_id: "l2", shipped: 1, received: 1, remaining: 0 }] },
    { shipment_id: "s3", shipment_no: "SH-3", shipment_date: "2026-10-07", lines: [
      { requisition_line_id: "l1", shipped: 3, received: 3, remaining: 0 }, { requisition_line_id: "l2", shipped: 5, received: 0, remaining: 5 }] },
  ];
  const withShipments = () => released({ lines: [line(1) as any, line(2) as any], shipments });

  it("receives against a chosen shipment, offering only shipments and lines that still have a remainder", async () => {
    const onView = jest.fn();
    render(<CommonRequisitionDetail initial={withShipments()} onView={onView} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqReceive"));
    const select = screen.getByLabelText("crqShipment") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("SH-1");
    expect(labels).toContain("SH-3");
    expect(labels).not.toContain("SH-2");
    fireEvent.change(select, { target: { value: "s1" } });
    expect(screen.queryByLabelText('crqReceiveQtyFor:{"line":2}')).toBeNull();
    fireEvent.change(screen.getByLabelText('crqReceiveQtyFor:{"line":1}'), { target: { value: "4" } });
    fireEvent.click(screen.getByText("crqPostReceipt"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/receipt", {
      posting_date: todayIso(), shipment_id: "s1", lines: [{ line_id: "l1", quantity: 4 }],
    }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqReceived"));
  });

  it("shows the second shipment's own line and caps the receipt at its remainder", async () => {
    render(<CommonRequisitionDetail initial={withShipments()} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqReceive"));
    fireEvent.change(screen.getByLabelText("crqShipment"), { target: { value: "s3" } });
    expect(screen.queryByLabelText('crqReceiveQtyFor:{"line":1}')).toBeNull();
    const qty = screen.getByLabelText('crqReceiveQtyFor:{"line":2}');
    const button = screen.getByText("crqPostReceipt").closest("button") as HTMLButtonElement;
    fireEvent.change(qty, { target: { value: "6" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(qty, { target: { value: "5" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/receipt", {
      posting_date: todayIso(), shipment_id: "s3", lines: [{ line_id: "l2", quantity: 5 }],
    }));
  });

  it("links a PO number on a released Purchase requisition", async () => {
    const onView = jest.fn();
    render(<CommonRequisitionDetail initial={released({ purpose: "PURCHASE" })} onView={onView} onBack={jest.fn()} />);
    const button = screen.getByText("crqLinkPo").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("crqPoNo"), { target: { value: "PO-TEST-1" } });
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/link-po", { linked_po_no: "PO-TEST-1" }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(expect.anything(), "crqPoLinked"));
  });

  it("shows the API's refusal on release as it comes", async () => {
    const message = "A requisition must be approved before it can be released; approval never implies release.";
    post.mockRejectedValue({ message });
    render(<CommonRequisitionDetail initial={base({ approval_status: "APPROVED", document_status: "APPROVED" })} onView={jest.fn()} onBack={jest.fn()} />);
    fireEvent.click(screen.getByText("crqRelease"));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  // WP4a fix round 1: a released STORE document now loads them too, for the
  // Item Tracking button (pinned by the item-tracking test below); a released
  // Purchase document still does not.
  it("loads options only while editable, or for a released Store document", async () => {
    render(<CommonRequisitionDetail initial={released({ purpose: "PURCHASE" })} onView={jest.fn()} onBack={jest.fn()} />);
    await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
  });

  it("adds the farm to the options query", async () => {
    render(<CommonRequisitionDetail initial={base({ farm_id: "f1" })} onView={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1&farm_id=f1"));
  });

  // Task 18: the dialog wrap supplies its own title and its own close control
  // (the Dialog component's); `embedded` suppresses only the internal Back +
  // title strip this detail otherwise renders, same as the feed side.
  it("suppresses its own Back + title strip when embedded, for the Task 18 dialog wrap", () => {
    render(<CommonRequisitionDetail initial={open()} onView={jest.fn()} onBack={jest.fn()} embedded />);
    expect(screen.queryByRole("button", { name: "crqBack" })).toBeNull();
    expect(screen.queryByText("REQ-2026-0001", { selector: "h2" })).toBeNull();
    expect(screen.getByText("crqSave")).toBeTruthy();
  });

  // WP4a fix round 1: a released Store requisition still takes its Item
  // Tracking for the unshipped balance, through POST /requisition/:id/item-tracking.
  it("assigns a lot on a released Store requisition through the item-tracking route", async () => {
    get.mockResolvedValue({ data: { ...options, items: [{ item_id: "i-lot", item_code: "IT-LOT", item_name: "Lot item", uom_primary: "EA", is_lot_tracked: true, is_serial_tracked: false }] } });
    const after = released({ lines: [line(1, { item_id: "i-lot", item_code: "IT-LOT", lot_no: "LOT00001", balance_to_ship: 5 }) as any] });
    post.mockImplementation(async () => ({ data: after }));
    const onView = jest.fn();
    render(<CommonRequisitionDetail initial={released({ linked_transfer_id: "tr-1", lines: [line(1, { item_id: "i-lot", item_code: "IT-LOT", balance_to_ship: 5 }) as any] })} onView={onView} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1"));
    fireEvent.click(await screen.findByRole("button", { name: 'crqItemTrackingFor:{"line":1}' }));
    fireEvent.change(screen.getByLabelText('crqTrackingFor:{"line":1}'), { target: { value: "LOT00001" } });
    fireEvent.click(screen.getByRole("button", { name: "crqTrackingSave" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/requisition/req-1/item-tracking", { lines: [{ line_id: "l1", lot_no: "LOT00001" }] }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(after, "crqTrackingSaved"));
  });
});

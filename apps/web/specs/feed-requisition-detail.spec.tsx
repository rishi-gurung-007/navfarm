import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Dialog } from "../src/components/ui/dialog";
import { FeedRequisitionDetail } from "../src/components/console/inventory/feed-requisition-detail";
import type { RequisitionView } from "../src/components/console/inventory/feed-requisition-document";
import { api } from "../src/services/api-client";
jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }, Toast: () => null }));
import { showToast } from '../src/components/ui/toast';
beforeEach(() => { for (const fn of Object.values(showToast)) (fn as jest.Mock).mockClear(); });

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const action = (enabled: boolean, reason: string | null = null) => ({ enabled, reason });
const base = (over: Partial<RequisitionView> = {}): RequisitionView => ({
  requisition_id: "req-1",
  req_no: "REQ-GRA100-2026-00007",
  requisition_type: "FEED_FORECAST",
  source: "AUTO_FORECAST",
  purpose: "INTERNAL_TRANSFER",
  supply_source: "MILL",
  status: "APPROVED",
  priority: "INFO",
  approval_request_id: "approval-1",
  submission_deadline: "2026-10-10",
  remarks: null,
  approved_at: "2026-10-08 06:04:00",
  approval_status: "APPROVED",
  document_status: "OPEN",
  fulfilment_status: "NOT_APPLICABLE",
  actions: {
    release: action(true),
    shipment: action(false, "Release the requisition before Transfer Shipment."),
    receipt: action(false, "Release the requisition before Transfer Receipt."),
  },
  transfers: [],
  header: {
    farm_code: "GRA100", farm_name: "GRASMERE FARM", requisition_date: "2026-10-04",
    is_next_diet_requisition: false, farm_total_requested_kg: 9000, truck_target_kg: 30000,
    bulk_multiple_kg: 3000, trips: 1, required_delivery_date: "2026-10-28",
    approved_by_name: "Tenant Administrator", linked_transfer_no: null, forecast_run_no: null,
  },
  lines: [],
  ...over,
});

const transfer = (over: Record<string, unknown> = {}) => ({
  transfer_id: "tr-1", transfer_no: "TR-00001", status: "DRAFT", posting_date: "2026-10-08",
  from_warehouse_id: "bin-1", to_warehouse_id: "silo-1", bin_assignment_id: "assignment-1",
  lines: [{
    transfer_line_id: "tl-1", requisition_line_id: "rl-1", item_id: "feed-1", item_code: "FEED-1",
    item_name: "Grower Feed", quantity: 1000, uom: "KG", qty_shipped: 0, qty_received: 0,
    balance_to_ship: 1000, remaining_to_receive: 0,
  }],
  open_shipments: [],
  ...over,
});

const draftView: RequisitionView = base({
  status: "AUTO_DRAFT",
  approval_request_id: null,
  farm_id: "farm-vil",
  actions: undefined,
  lines: [{
    line_id: "L1", line_seq: 10000, destination_location_id: "silo-1", destination_code: "VIL100/SILO-001",
    item_id: "r1", item_code: "FEED-R1", item_description: "Weaner Diet R1", required_item_id: "r1",
    feed_type: "BULK", is_next_diet: false, days_before_diet_change: null, lifecycle_ref_label: "WEANER days 21–24",
    system_balance_kg: "1500.0000", daily_requirement_kg: "2000.0000", days_remaining: 0,
    first_shortage_date: "2099-09-23", unrounded_need_kg: "4500.0000", recommended_qty_kg: "6000.0000",
    quantity: "6000.0000", bag_count: null, proposed_delivery_date: "2099-09-23", exceeds_silo_capacity: false,
    exception_reason: null, breakdown: [],
  }],
});

function renderDetail(view: RequisitionView, onView = jest.fn()) {
  render(
    <Dialog open onClose={jest.fn()} title={view.req_no} presentation="page">
      <FeedRequisitionDetail view={view} onView={onView} onBack={jest.fn()} embedded />
    </Dialog>,
  );
  return onView;
}

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: { destinations: [], items: [] } });
  post.mockResolvedValue({ data: base() });
  put.mockResolvedValue({ data: draftView });
});

describe("FeedRequisitionDetail draft document", () => {
  it("fetches the farm's options from view.farm_id", async () => {
    render(<FeedRequisitionDetail view={draftView} onView={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/feed-requisition/options?farmId=farm-vil"));
  });

  it("edits a line quantity and Save calls PUT and then onView with the response", async () => {
    const onView = jest.fn();
    render(<FeedRequisitionDetail view={draftView} onView={onView} onBack={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText('rqdRequestedFor:{"line":10000}'), { target: { value: "6100" } });
    fireEvent.click(screen.getByRole("button", { name: "rqSave" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/feed-requisition/req-1", {
      remarks: "", lines: [{ line_id: "L1", quantity_kg: 6100 }],
    }));
    expect(onView).toHaveBeenCalledWith(draftView);
    expect(showToast.success).toHaveBeenCalledWith("rqSaved");
  });

  it("Submit sends an escalated priority with the submit call, not as a separate PUT", async () => {
    post.mockResolvedValue({ data: draftView });
    render(<FeedRequisitionDetail view={{ ...draftView, submission_deadline: "2099-01-01", priority: "WARNING", priority_options: ["CRITICAL_FIRST_PRIORITY", "CRITICAL", "WARNING"] }} onView={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByRole("combobox", { name: "rqdPriority" }), { target: { value: "CRITICAL" } });
    fireEvent.click(screen.getByRole("button", { name: "rqSubmit" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/feed-requisition/req-1/submit", { remarks: "", lines: [], priority: "CRITICAL" }));
    expect(put).not.toHaveBeenCalled();
  });

  it("renders no Save or Submit buttons once approved", () => {
    render(<FeedRequisitionDetail view={base()} onView={jest.fn()} onBack={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "rqSave" })).toBeNull();
    expect(screen.queryByRole("button", { name: "rqSubmit" })).toBeNull();
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = jest.fn();
    render(<FeedRequisitionDetail view={draftView} onView={jest.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "rqBack" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("suppresses its own Back and title strip when embedded", () => {
    render(<FeedRequisitionDetail view={draftView} onView={jest.fn()} onBack={jest.fn()} embedded />);
    expect(screen.getByRole("button", { name: "rqSave" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "rqBack" })).toBeNull();
    expect(screen.queryByText(draftView.req_no, { selector: "h2" })).toBeNull();
  });
});

describe("FeedRequisitionDetail workflow actions", () => {
  it("always renders Release, Transfer Shipment and Transfer Receipt in the dialog header from server action state", () => {
    renderDetail(base());
    const header = screen.getByRole("dialog").querySelector("header") as HTMLElement;
    expect((within(header).getByRole("button", { name: "crqRelease" }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(header).getByRole("button", { name: "crqShip" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(header).getByRole("button", { name: "crqReceive" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(header).getByRole("button", { name: "crqShip" }).getAttribute("title"))
      .toBe("Release the requisition before Transfer Shipment.");
  });

  it("releases an approved requisition and refreshes the parent view", async () => {
    const released = base({ document_status: "RELEASED" });
    post.mockResolvedValue({ data: released });
    const onView = renderDetail(base());

    fireEvent.click(screen.getByRole("button", { name: "crqRelease" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/feed-requisition/req-1/release", {}));
    expect(onView).toHaveBeenCalledWith(released);
    expect(showToast.success).toHaveBeenCalledWith("rqReleased");
  });

  it("selects one linked transfer and posts only bounded shipment quantities", async () => {
    const second = transfer({ transfer_id: "tr-2", transfer_no: "TR-00002", lines: [{
      transfer_line_id: "tl-2", requisition_line_id: "rl-2", item_id: "feed-2", item_code: "FEED-2",
      item_name: "Finisher Feed", quantity: 600, uom: "KG", qty_shipped: 100, qty_received: 0,
      balance_to_ship: 500, remaining_to_receive: 100,
    }] });
    const view = base({
      document_status: "RELEASED",
      actions: { release: action(false), shipment: action(true), receipt: action(false) },
      transfers: [transfer(), second],
    });
    renderDetail(view);

    fireEvent.click(screen.getByRole("button", { name: "crqShip" }));
    fireEvent.change(screen.getByLabelText("rqTransfer"), { target: { value: "tr-2" } });
    const qty = screen.getByLabelText('crqShipQtyFor:{"line":1}') as HTMLInputElement;
    expect(qty.max).toBe("500");
    fireEvent.change(qty, { target: { value: "501" } });
    expect((screen.getByRole("button", { name: "crqPostShipment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(qty, { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "crqPostShipment" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/feed-requisition/req-1/shipments", {
      transfer_id: "tr-2", posting_date: expect.any(String),
      lines: [{ requisition_line_id: "rl-2", quantity: 400 }],
    }));
  });

  it("selects an open shipment and posts a bounded receipt", async () => {
    const linked = transfer({
      status: "IN_TRANSIT",
      lines: [{
        transfer_line_id: "tl-1", requisition_line_id: "rl-1", item_id: "feed-1", item_code: "FEED-1",
        item_name: "Grower Feed", quantity: 1000, uom: "KG", qty_shipped: 700, qty_received: 200,
        balance_to_ship: 300, remaining_to_receive: 500,
      }],
      open_shipments: [{
        shipment_id: "sh-1", shipment_no: "SH-00001", shipment_date: "2026-10-09",
        lines: [{ line_id: "tl-1", requisition_line_id: "rl-1", quantity: 700, qty_received: 200, remaining_to_receive: 500 }],
      }],
    });
    const view = base({
      document_status: "RELEASED",
      actions: { release: action(false), shipment: action(true), receipt: action(true) },
      transfers: [linked],
    });
    renderDetail(view);

    fireEvent.click(screen.getByRole("button", { name: "crqReceive" }));
    fireEvent.change(screen.getByLabelText("rqTransfer"), { target: { value: "tr-1" } });
    fireEvent.change(screen.getByLabelText("crqShipment"), { target: { value: "sh-1" } });
    const qty = screen.getByLabelText('crqReceiveQtyFor:{"line":1}') as HTMLInputElement;
    expect(qty.max).toBe("500");
    fireEvent.change(qty, { target: { value: "500" } });
    // Rishi, 11 Oct: the delivery note no. is optional; it is sent when given.
    expect((screen.getByRole("button", { name: "crqPostReceipt" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('w2tDeliveryNoteFor:{"line":1}'), { target: { value: "MILL-DN-0042" } });
    fireEvent.click(screen.getByRole("button", { name: "crqPostReceipt" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/feed-requisition/req-1/receipts", {
      transfer_id: "tr-1", shipment_id: "sh-1", posting_date: expect.any(String),
      lines: [{ requisition_line_id: "rl-1", quantity: 500, delivery_note_no: "MILL-DN-0042" }],
    }));
  });

  describe("W2T — the feed receipt panel per line (Requisition rows 139-150)", () => {
    const reqLine = (feedType: string) => ({
      line_id: "rl-1", line_seq: 1, destination_location_id: "silo-1", destination_code: "GRS-H3-SILO1",
      item_id: "feed-1", item_code: "FEED-R1", item_description: "Weaner Diet R1", required_item_id: "feed-1",
      feed_type: feedType, is_next_diet: false, days_before_diet_change: null, lifecycle_ref_label: null,
      system_balance_kg: null, daily_requirement_kg: null, days_remaining: null, first_shortage_date: null,
      unrounded_need_kg: null, recommended_qty_kg: null, quantity: "6050.0000", bag_count: null,
      proposed_delivery_date: null, exceeds_silo_capacity: false, exception_reason: null, breakdown: [],
      requested_qty_kg: 6050, mill_approved_qty_kg: 6000,
    });
    const receivingView = (feedType: string) => base({
      document_status: "RELEASED",
      actions: { release: action(false), shipment: action(false), receipt: action(true) },
      header: { ...base().header!, bag_size_kg: 50 },
      lines: [reqLine(feedType)] as any,
      transfers: [transfer({
        status: "IN_TRANSIT",
        lines: [{
          transfer_line_id: "tl-1", requisition_line_id: "rl-1", item_id: "feed-1", item_code: "FEED-R1",
          item_name: "Weaner Diet R1", quantity: 6000, uom: "KG", qty_shipped: 6000, qty_received: 0,
          balance_to_ship: 0, remaining_to_receive: 6000,
        }],
        open_shipments: [{
          shipment_id: "sh-1", shipment_no: "SH-00001", shipment_date: "2026-10-09",
          lines: [{ line_id: "tl-1", requisition_line_id: "rl-1", quantity: 6000, qty_received: 0, remaining_to_receive: 6000,
            loading_sheet_id: "ls-1", loading_sheet_no: "LOAD-REQ-1", compartment_no: "1 and 2" }],
        }],
      })] as any,
    });
    const open = (view: RequisitionView) => {
      renderDetail(view);
      fireEvent.click(screen.getByRole("button", { name: "crqReceive" }));
      fireEvent.change(screen.getByLabelText("rqTransfer"), { target: { value: "tr-1" } });
      fireEvent.change(screen.getByLabelText("crqShipment"), { target: { value: "sh-1" } });
    };

    it("shows item, feed type, requested, mill approved, shipped, previously received, outstanding and compartment", () => {
      open(receivingView("BULK"));
      const table = screen.getByRole("table", { name: "w2tReceiptLines" });
      for (const text of ["FEED-R1", "Weaner Diet R1", "6,050", "6,000", "1 and 2"]) expect(within(table).getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
      expect(within(table).getByText(/LOAD-REQ-1/)).toBeTruthy();
      expect(screen.queryByLabelText('w2tBagCountFor:{"line":1}')).toBeNull();
      expect(screen.getByText('w2tOpenTransfer:{"no":"TR-00001"}').getAttribute("href")).toBe("/inventory/transfers?id=tr-1");
      expect(screen.getByText('w2tOpenShipment:{"no":"SH-00001"}').getAttribute("href")).toBe("/inventory/transfers?id=tr-1");
    });

    it("W5B (Req r139, Silo r18, r20): the item and the loading sheet in the receipt table are links", () => {
      open(receivingView("BULK"));
      const table = screen.getByRole("table", { name: "w2tReceiptLines" });
      expect(within(table).getByRole("link", { name: "FEED-R1" }).getAttribute("href")).toBe("/master-data/item?recordId=feed-1");
      expect(within(table).getByRole("link", { name: "LOAD-REQ-1" }).getAttribute("href")).toBe("/inventory/feed-forecast?tab=loading-instructions&id=ls-1");
    });

    it("a part receipt with more still to come is short and needs a variance reason; a full one hides the field", () => {
      open(receivingView("BULK"));
      fireEvent.change(screen.getByLabelText('crqReceiveQtyFor:{"line":1}'), { target: { value: "4000" } });
      expect((screen.getByRole("button", { name: "crqPostReceipt" }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByLabelText('w2tVarianceReasonFor:{"line":1}')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('crqReceiveQtyFor:{"line":1}'), { target: { value: "6000" } });
      expect(screen.queryByLabelText('w2tVarianceReasonFor:{"line":1}')).toBeNull();
      expect((screen.getByRole("button", { name: "crqPostReceipt" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("checkpoint 26: a shortfall needs a variance reason before Post receipt is enabled", async () => {
      open(receivingView("BULK"));
      fireEvent.change(screen.getByLabelText('crqReceiveQtyFor:{"line":1}'), { target: { value: "5900" } });
      fireEvent.change(screen.getByLabelText('w2tDeliveryNoteFor:{"line":1}'), { target: { value: "DN-1" } });
      const postButton = screen.getByRole("button", { name: "crqPostReceipt" }) as HTMLButtonElement;
      expect(postButton.disabled).toBe(true);
      expect(screen.getByText("w2tVarianceReasonRequired")).toBeTruthy();
      fireEvent.change(screen.getByLabelText('w2tVarianceReasonFor:{"line":1}'), { target: { value: "Spillage" } });
      expect(postButton.disabled).toBe(false);
      post.mockResolvedValue({ data: { ...receivingView("BULK"), receipt: {
        receipt_id: "rc-1", receipt_no: "RC-2026-0007", transfer_id: "tr-1", shipment_id: "sh-1",
        lines: [{ line_id: "tl-1", requisition_line_id: "rl-1", qty_received: 5900, variance_qty: 100, silo_balance_after: 7400 }],
      } } });
      fireEvent.click(postButton);
      await waitFor(() => expect(post).toHaveBeenCalledWith("/feed-requisition/req-1/receipts", expect.objectContaining({
        lines: [{ requisition_line_id: "rl-1", quantity: 5900, delivery_note_no: "DN-1", variance_reason: "Spillage" }],
      })));
      const status = await screen.findByRole("status", { name: "w2tLastReceipt" });
      expect(within(status).getByText('w2tReceiptPosted:{"receipt":"RC-2026-0007"}')).toBeTruthy();
      expect(within(status).getByText(/"balance":"7,400"/)).toBeTruthy();
    });

    it("checkpoint 27: a BAGGED line needs a bag count within 1 percent of the KG received", () => {
      open(receivingView("BAGGED"));
      fireEvent.change(screen.getByLabelText('crqReceiveQtyFor:{"line":1}'), { target: { value: "6000" } });
      fireEvent.change(screen.getByLabelText('w2tDeliveryNoteFor:{"line":1}'), { target: { value: "DN-1" } });
      const postButton = screen.getByRole("button", { name: "crqPostReceipt" }) as HTMLButtonElement;
      expect(postButton.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('w2tBagCountFor:{"line":1}'), { target: { value: "100" } });
      expect(postButton.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('w2tBagCountFor:{"line":1}'), { target: { value: "120" } });
      expect(postButton.disabled).toBe(false);
    });
  });

  it("keeps entered shipment quantities after an API refusal", async () => {
    post.mockRejectedValue({ message: "Sender department does not match the mill bin." });
    const view = base({
      document_status: "RELEASED",
      actions: { release: action(false), shipment: action(true), receipt: action(false) },
      transfers: [transfer()],
    });
    renderDetail(view);
    fireEvent.click(screen.getByRole("button", { name: "crqShip" }));
    fireEvent.change(screen.getByLabelText("rqTransfer"), { target: { value: "tr-1" } });
    const qty = screen.getByLabelText('crqShipQtyFor:{"line":1}') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "crqPostShipment" }));

    await waitFor(() => expect(showToast.error).toHaveBeenCalledWith("Sender department does not match the mill bin."));
    expect(qty.value).toBe("250");
  });

  describe("stacked posting dialogs and the workflow notice (Rishi, 11 Oct)", () => {
    const releasedView = (over: Partial<RequisitionView> = {}) => base({
      document_status: "RELEASED",
      actions: { release: action(false), shipment: action(true), receipt: action(true) },
      transfers: [transfer({ open_shipments: [] })],
      ...over,
    });

    it("Transfer Shipment opens a second dialog over the requisition, which stays mounted", () => {
      renderDetail(releasedView());
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "crqShip" }));
      const dialogs = screen.getAllByRole("dialog");
      expect(dialogs).toHaveLength(2);
      expect(within(dialogs[0]).queryByRole("button", { name: "crqPostShipment" })).toBeNull();
      expect(within(dialogs[1]).getByRole("button", { name: "crqPostShipment" })).toBeTruthy();
      expect(within(dialogs[1]).getByLabelText("rqTransfer")).toBeTruthy();
      expect(within(dialogs[0]).getByRole("button", { name: "crqRelease" })).toBeTruthy();
    });

    it("Escape closes only the top dialog; the requisition remains", () => {
      renderDetail(releasedView());
      fireEvent.click(screen.getByRole("button", { name: "crqShip" }));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "crqShip" })).toBeTruthy();
    });

    it("a successful post closes the top dialog and refreshes the requisition", async () => {
      const refreshed = releasedView({ fulfilment_status: "SHIPPED" as any });
      post.mockResolvedValue({ data: refreshed });
      const onView = renderDetail(releasedView());
      fireEvent.click(screen.getByRole("button", { name: "crqShip" }));
      fireEvent.change(screen.getByLabelText("rqTransfer"), { target: { value: "tr-1" } });
      fireEvent.change(screen.getByLabelText('crqShipQtyFor:{"line":1}'), { target: { value: "250" } });
      fireEvent.click(screen.getByRole("button", { name: "crqPostShipment" }));
      await waitFor(() => expect(onView).toHaveBeenCalledWith(refreshed));
      await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    });

    it("Transfer Receipt opens its own stacked dialog too", () => {
      renderDetail(releasedView());
      fireEvent.click(screen.getByRole("button", { name: "crqReceive" }));
      const dialogs = screen.getAllByRole("dialog");
      expect(dialogs).toHaveLength(2);
      expect(within(dialogs[1]).getByRole("button", { name: "crqPostReceipt" })).toBeTruthy();
    });

    it("shows 'Release completed' as a success alert with spacing, not an error", () => {
      renderDetail(releasedView({ actions: { release: action(false, "Already released."), shipment: action(true), receipt: action(false) } }));
      const notice = screen.getByTestId("feed-workflow-notice");
      expect(notice.textContent).toContain("Release completed. Post the Transfer Shipment to continue.");
      expect(notice.className).toContain("mb-4");
      const box = notice.firstElementChild as HTMLElement;
      expect(box.getAttribute("style")).toContain("var(--success-muted)");
      expect(box.getAttribute("style")).not.toContain("var(--danger");
    });

    it("shows a blocked step as a warning, not an error", () => {
      renderDetail(base());
      const box = screen.getByTestId("feed-workflow-notice").firstElementChild as HTMLElement;
      expect(box.getAttribute("style")).toContain("var(--warning-muted)");
    });
  });
});

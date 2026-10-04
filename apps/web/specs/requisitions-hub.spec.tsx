import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RequisitionsHub } from "../src/components/console/requisitions/requisitions-hub";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
let mockCompanyId: string | null = "co-1";
jest.mock("../src/hooks/useAuth", () => ({
  getActiveCompanyId: () => mockCompanyId,
  getStoredUser: () => ({}),
  hasPermission: () => true,
}));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({
  useFeedFarm: () => ({ farmId: null, setFarmId: jest.fn(), farms: [], loaded: true, failed: false, isFixed: false, fixedFarm: null }),
}));

const get = api.get as jest.Mock;

const row = (id: string, doc_type: string, purpose: string | null, extra: Record<string, unknown> = {}) => ({
  requisition_id: id, req_no: `NO-${id}`, doc_type, purpose, status: "DRAFT", farm_id: "f1", farm_code: "VIL100",
  requisition_date: "2026-10-01", required_date: "2026-10-09", approval_status: "OPEN", document_status: "OPEN",
  fulfilment_status: "NOT_APPLICABLE", integration_status: "NOT_APPLICABLE", approval_request_id: null, line_count: 2, ...extra,
});

const ROWS = [
  row("req-feed", "FEED", "INTERNAL_TRANSFER", { status: "PENDING_APPROVAL", approval_status: "PENDING_APPROVAL" }),
  row("req-item", "ITEM", "STORE"),
  row("req-fa", "FA", "PURCHASE"),
  row("req-svc", "SERVICE", "PURCHASE", { line_count: 3 }),
];

const feedView = {
  requisition_id: "req-feed", req_no: "REQ-VIL100-2026-00002", requisition_type: "FEED_FORECAST", source: "AUTO_FORECAST",
  purpose: "INTERNAL_TRANSFER", supply_source: "MILL", status: "PENDING_APPROVAL", priority: null, approval_request_id: "ar-1",
  production_date: null, submission_deadline: null, remarks: null, truck_target_kg: 30000, approved_at: null, farm_id: "f1",
  header: {
    farm_code: "VIL100", farm_name: "Villa Franca", requisition_date: "2026-10-01", is_next_diet_requisition: false,
    farm_total_requested_kg: 6000, truck_target_kg: 30000, bulk_multiple_kg: 3000, trips: 1, required_delivery_date: "2026-10-03",
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: "FFR-f1-000001",
  },
  lines: [],
};

const itemLine = (n: number) => ({
  line_id: `l${n}`, line_seq: n, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
  quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_to_receive: "10",
});

const itemView = {
  requisition_id: "req-item", req_no: "NO-req-item", company_id: "co-1", doc_type: "ITEM", purpose: "STORE", status: "DRAFT",
  requisition_date: "2026-10-01", required_date: null, main_location_id: null, requester_department_id: null, sender_department_id: null,
  from_location_id: "st", to_location_id: "sh", direct_transfer: false, justification: null, remarks: "server remark",
  approval_status: "OPEN", document_status: "OPEN", lines: [itemLine(1), itemLine(2)],
};

const options = { items: [], resources: [], locations: [], departments: [] };

beforeEach(() => {
  jest.clearAllMocks();
  mockCompanyId = "co-1";
  window.history.replaceState({}, "", "/approvals/requisitions");
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/requisition/options")) return { data: options };
    if (url.startsWith("/feed-requisition/options")) return { data: { destinations: [], items: [] } };
    if (url === "/feed-requisition/req-feed") return { data: feedView };
    if (url === "/requisition/req-feed") return { data: { ...ROWS[0], lines: [] } };
    if (url === "/requisition/req-item") return { data: itemView };
    if (url.startsWith("/requisition")) {
      const type = new URLSearchParams(url.split("?")[1] ?? "").get("doc_type");
      return { data: type ? ROWS.filter((r) => r.doc_type === type) : ROWS };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

const listUrls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => /^\/requisition(\?|$)/.test(u));

describe("RequisitionsHub — Approvals → Requisitions lists and creates every type (spec §6a)", () => {
  it("lists rows of every type from GET /requisition", async () => {
    render(<RequisitionsHub />);
    const table = await screen.findByRole("table");
    for (const label of ["reqDocFeed", "reqDocItem", "reqDocFa", "reqDocService"]) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
    expect(within(table).getByText("NO-req-svc")).toBeTruthy();
    expect(within(table).getAllByText("VIL100")).toHaveLength(4);
    expect(listUrls()[0]).toMatch(/^\/requisition\?/);
  });

  it("choosing Type ITEM re-requests the list filtered to ITEM", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("rhType"), { target: { value: "ITEM" } });
    await waitFor(() => expect(listUrls().some((u) => u.includes("doc_type=ITEM"))).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("NO-req-fa")).toBeNull());
  });

  it("a FEED row opens the feed document from /feed-requisition, never the common detail", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-feed"));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/feed-requisition/req-feed"));
    expect(await screen.findByText("REQ-VIL100-2026-00002", { selector: "h2" })).toBeTruthy();
    expect(screen.queryByText("crqHeaderTitle")).toBeNull();
  });

  it("an ITEM row opens the common document from /requisition/:id", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-item"));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/req-item"));
    expect(await screen.findByText("crqHeaderTitle")).toBeTruthy();
    expect(get).not.toHaveBeenCalledWith("/feed-requisition/req-item");
  });

  // Task 18 (decisions 2026-10-04 "a requisition ... is created and edited
  // in a dialog"): both kinds open in one actual dialog (role="dialog"),
  // not in place of the list; closing it (the dialog's own close control)
  // returns to the list.
  it("opens a FEED row in a dialog, and closing it returns to the list (Task 18)", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-feed"));
    await screen.findByText("REQ-VIL100-2026-00002", { selector: "h2" });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("REQ-VIL100-2026-00002", { selector: "h2" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "rqBack" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("opens an ITEM row in the same dialog shell, and closing it returns to the list (Task 18)", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-item"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("crqHeaderTitle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "crqBack" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("?id= on load reads /requisition/:id for its type, then opens the feed document", async () => {
    window.history.replaceState({}, "", "/approvals/requisitions?id=req-feed");
    render(<RequisitionsHub />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/feed-requisition/req-feed"));
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls.indexOf("/requisition/req-feed")).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf("/requisition/req-feed")).toBeLessThan(urls.indexOf("/feed-requisition/req-feed"));
    expect(await screen.findByText("REQ-VIL100-2026-00002", { selector: "h2" })).toBeTruthy();
  });

  it("New → Fixed Asset opens an unsaved common document: type Fixed Asset, purpose Purchase, no POST", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    for (const kind of ["rqNewPurposeFeed", "rqNewPurposeItem", "rqNewPurposeFa", "rqNewPurposeService"]) {
      expect(screen.getByRole("button", { name: kind })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeFa" }));
    expect(await screen.findByText("crqHeaderTitle")).toBeTruthy();
    // Task 18: a brand-new, unsaved common requisition has no req_no yet; the
    // dialog falls back to a "new requisition" title rather than a blank one.
    expect(within(screen.getByRole("dialog")).getByText("crqNewTitleFa")).toBeTruthy();
    // The Type filter also offers reqDocFa as an <option>; the document's read-only field is the one that counts.
    const shown = (text: string) => screen.getAllByText(text).filter((el) => el.tagName !== "OPTION");
    expect(shown("reqDocFa")).toHaveLength(1);
    expect(shown("reqPurposePurchase")).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1"));
  });

  // Rishi 4 Oct: the common New dialog's title names the kind.
  it.each([
    ["rqNewPurposeService", "crqNewTitleService"],
    ["rqNewPurposeFa", "crqNewTitleFa"],
  ])("New → %s titles the dialog %s", async (choice, title) => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: choice }));
    expect(await within(screen.getByRole("dialog")).findByText(title)).toBeTruthy();
  });

  it.each([
    ["rqNewItemStore", "crqNewTitleItemStore"],
    ["rqNewItemPurchase", "crqNewTitleItemPurchase"],
  ])("New → Item → %s titles the dialog %s", async (choice, title) => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeItem" }));
    fireEvent.click(screen.getByRole("button", { name: choice }));
    expect(await within(screen.getByRole("dialog")).findByText(title)).toBeTruthy();
  });

  it("New → Feed shows the requisition header first, with the farm chosen there, then the lines (Task 18b)", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeFeed" }));
    const dialog = screen.getByRole("dialog");
    const header = within(dialog).getByText("rqdHeaderTitle");
    expect(header.compareDocumentPosition(within(dialog).getByLabelText("rqFarm")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByText("reqTypeManual")).toBeTruthy();
    expect(within(dialog).getByText("rqdLinesTitle")).toBeTruthy();
    expect(within(dialog).getByRole("table")).toBeTruthy();
  });

  it("without an active company, Item / Fixed Asset / Service explain the company switcher instead of opening", async () => {
    mockCompanyId = null;
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeService" }));
    expect(await screen.findByText("rhNeedsCompany")).toBeTruthy();
    expect(screen.queryByText("crqHeaderTitle")).toBeNull();
  });

  it("re-rendering the hub with the same view keeps unsaved edits in the common detail (C3)", async () => {
    const { rerender } = render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-item"));
    const remarks = (await screen.findByLabelText("crqRemarks")) as HTMLTextAreaElement;
    expect(remarks.value).toBe("server remark");
    fireEvent.change(remarks, { target: { value: "typed, not saved" } });
    rerender(<RequisitionsHub />);
    expect((screen.getByLabelText("crqRemarks") as HTMLTextAreaElement).value).toBe("typed, not saved");
  });
});

/**
 * WP1b (decisions.md 2026-10-04, "one Requisitions page"): the hub gains a
 * "Waiting for my approval" filter, and Approve / Reject on pending rows —
 * calling the EXISTING /approval/:id/approve|reject endpoints so the checks
 * (remarks, deadline, reasons) stay in one place, exactly as the inbox's do.
 */
describe("RequisitionsHub — Waiting for my approval filter and Approve/Reject (WP1b)", () => {
  const pendingRow = (id: string, doc_type: string, extra: Record<string, unknown> = {}) =>
    row(id, doc_type, doc_type === "FEED" ? "INTERNAL_TRANSFER" : "STORE", {
      status: "PENDING_APPROVAL", approval_status: "PENDING_APPROVAL", approval_request_id: `ar-${id}`, ...extra,
    });

  beforeEach(() => {
    window.history.replaceState({}, "", "/approvals/requisitions");
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/requisition/options")) return { data: options };
      if (url.startsWith("/feed-requisition/options")) return { data: { destinations: [], items: [] } };
      if (url.includes("waiting_for_me=1") && url.startsWith("/requisition?")) {
        return { data: [pendingRow("req-wait-feed", "FEED"), pendingRow("req-wait-item", "ITEM")] };
      }
      if (url.startsWith("/requisition?")) return { data: ROWS };
      if (url === "/feed-requisition/req-wait-feed") return { data: { ...feedView, requisition_id: "req-wait-feed", approval_request_id: "ar-req-wait-feed" } };
      if (url === "/requisition/req-wait-feed") return { data: { ...ROWS[0], requisition_id: "req-wait-feed", approval_request_id: "ar-req-wait-feed", lines: [] } };
      if (url === "/requisition/req-wait-item") return { data: { ...itemView, requisition_id: "req-wait-item", approval_request_id: "ar-req-wait-item" } };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it("ticking the filter requests the list with waiting_for_me=1 and shows only those rows", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("rhWaitingForMe"));
    const waiting = await screen.findByText("NO-req-wait-feed");
    expect(within(screen.getByRole("table")).getByText("NO-req-wait-item")).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("NO-req-fa")).toBeNull();
    expect(listUrls().some((u) => u.includes("waiting_for_me=1"))).toBe(true);
    expect(waiting).toBeTruthy();
  });

  it("a pending FEED row shows Approve/Reject, and Approve posts to /approval/:id/approve then reloads", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-feed"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "rhApprove" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-req-wait-feed/approve", {}));
    expect(await screen.findByRole("table")).toBeTruthy();
  });

  it("Reject asks for a reason and posts it to /approval/:id/reject", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-item"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "rhReject" }));
    fireEvent.change(await screen.findByLabelText("rhRejectionReason"), { target: { value: "Not this cycle" } });
    fireEvent.click(screen.getByRole("button", { name: "rhRejectConfirm" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-req-wait-item/reject", { rejection_reason: "Not this cycle" }));
  });

  it("the pending FEED row passes the approver remarks to the same endpoint", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-feed"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("rhApproverRemarks"), { target: { value: "Capacity confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "rhApprove" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-req-wait-feed/approve", { remarks: "Capacity confirmed" }));
  });
});

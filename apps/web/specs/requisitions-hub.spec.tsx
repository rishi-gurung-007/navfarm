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
    // The Type filter also offers reqDocFa as an <option>; the document's read-only field is the one that counts.
    const shown = (text: string) => screen.getAllByText(text).filter((el) => el.tagName !== "OPTION");
    expect(shown("reqDocFa")).toHaveLength(1);
    expect(shown("reqPurposePurchase")).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1"));
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

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RequisitionsHub } from "../src/components/console/requisitions/requisitions-hub";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
const routerReplace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: routerReplace, push: jest.fn() }) }));
let mockCompanyId: string | null = "co-1";
let mockCanApprove = true;
jest.mock("../src/hooks/useAuth", () => ({
  getActiveCompanyId: () => mockCompanyId,
  getStoredUser: () => ({}),
  hasPermission: (_u: unknown, mod: string, res: string, action: string) =>
    mod === "PRODUCTION" && res === "APPROVAL" && action === "can_approve" ? mockCanApprove : true,
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

// The API's kind=common list never returns FEED (WP1g); the one FEED fixture row is
// what GET /requisition/:id answers for a feed id someone follows a link to.
const FEED_ROW = row("req-feed", "FEED", "INTERNAL_TRANSFER", { status: "PENDING_APPROVAL", approval_status: "PENDING_APPROVAL" });
const ROWS = [
  row("req-item", "ITEM", "STORE"),
  row("req-fa", "FA", "PURCHASE"),
  row("req-svc", "SERVICE", "PURCHASE", { line_count: 3 }),
];

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
  mockCanApprove = true;
  window.history.replaceState({}, "", "/requisitions");
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/requisition/options")) return { data: options };
    if (url === "/requisition/req-feed") return { data: { ...FEED_ROW, lines: [] } };
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
  it("lists the common kinds from GET /requisition?kind=common — never asks for FEED", async () => {
    render(<RequisitionsHub />);
    const table = await screen.findByRole("table");
    for (const label of ["reqDocItem", "reqDocFa", "reqDocService"]) {
      expect(within(table).getByText(label)).toBeTruthy();
    }
    expect(within(table).queryByText("reqDocFeed")).toBeNull();
    expect(within(table).getByText("NO-req-svc")).toBeTruthy();
    expect(listUrls()[0]).toMatch(/^\/requisition\?/);
    expect(listUrls().every((u) => u.includes("kind=common"))).toBe(true);
  });

  it("the Type filter offers Item, Fixed Asset and Service only — no Feed", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    const options = within(screen.getByLabelText("rhType")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["", "ITEM", "FA", "SERVICE"]);
    fireEvent.change(screen.getByLabelText("rhType"), { target: { value: "ITEM" } });
    await waitFor(() => expect(listUrls().some((u) => u.includes("kind=common") && u.includes("doc_type=ITEM"))).toBe(true));
  });

  it("a feed id followed by link is sent to Feed Forecast -> Requisition, never opened here", async () => {
    window.history.replaceState({}, "", "/requisitions?id=req-feed");
    render(<RequisitionsHub />);
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/inventory/feed-forecast?tab=feed-requisition&id=req-feed"));
    expect(get).not.toHaveBeenCalledWith("/feed-requisition/req-feed");
    expect(screen.queryByText("crqHeaderTitle")).toBeNull();
  });

  it("choosing Type ITEM re-requests the list filtered to ITEM", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("rhType"), { target: { value: "ITEM" } });
    await waitFor(() => expect(listUrls().some((u) => u.includes("doc_type=ITEM"))).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("table")).queryByText("NO-req-fa")).toBeNull());
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

  it("New → Fixed Asset opens an unsaved common document: type Fixed Asset, purpose Purchase, no POST", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    for (const kind of ["rqNewPurposeItem", "rqNewPurposeFa", "rqNewPurposeService"]) {
      expect(screen.getByRole("button", { name: kind })).toBeTruthy();
    }
    // Feed requisitions are raised on Feed Forecast -> Requisition only (WP1g).
    expect(screen.queryByRole("button", { name: "rqNewPurposeFeed" })).toBeNull();
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
    row(id, doc_type, "STORE", {
      status: "PENDING_APPROVAL", approval_status: "PENDING_APPROVAL", approval_request_id: `ar-${id}`, ...extra,
    });

  beforeEach(() => {
    window.history.replaceState({}, "", "/requisitions");
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/requisition/options")) return { data: options };
        if (url.includes("waiting_for_me=1") && url.startsWith("/requisition?")) {
        return { data: [pendingRow("req-wait-fa", "FA"), pendingRow("req-wait-item", "ITEM")] };
      }
      if (url.startsWith("/requisition?")) return { data: ROWS };
      if (url === "/requisition/req-wait-fa") return { data: { ...itemView, requisition_id: "req-wait-fa", doc_type: "FA", approval_request_id: "ar-req-wait-fa" } };
      if (url === "/requisition/req-wait-item") return { data: { ...itemView, requisition_id: "req-wait-item", approval_request_id: "ar-req-wait-item" } };
      throw new Error(`unexpected GET ${url}`);
    });
  });

  it("ticking the filter requests the list with waiting_for_me=1 and shows only those rows", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByLabelText("rhWaitingForMe"));
    const waiting = await screen.findByText("NO-req-wait-fa");
    expect(within(screen.getByRole("table")).getByText("NO-req-wait-item")).toBeTruthy();
    expect(within(screen.getByRole("table")).queryByText("NO-req-fa")).toBeNull();
    expect(listUrls().some((u) => u.includes("waiting_for_me=1"))).toBe(true);
    expect(waiting).toBeTruthy();
  });

  it("a pending common row shows Approve/Reject, and Approve posts to /approval/:id/approve then reloads", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-fa"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "rhApprove" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-req-wait-fa/approve", {}));
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

  it("the pending row passes the approver remarks to the same endpoint", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-fa"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("rhApproverRemarks"), { target: { value: "Capacity confirmed" } });
    fireEvent.click(screen.getByRole("button", { name: "rhApprove" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-req-wait-fa/approve", { remarks: "Capacity confirmed" }));
  });

  it("a user without PRODUCTION/APPROVAL can_approve sees no Approve / Reject on a pending row", async () => {
    mockCanApprove = false;
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByLabelText("rhWaitingForMe"));
    fireEvent.click(await screen.findByText("NO-req-wait-item"));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "rhApprove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "rhReject" })).toBeNull();
  });
});

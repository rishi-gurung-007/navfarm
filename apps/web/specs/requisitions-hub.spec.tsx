import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RequisitionsHub } from "../src/components/console/requisitions/requisitions-hub";
import { api } from "../src/services/api-client";
jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }, Toast: () => null }));
import { showToast } from '../src/components/ui/toast';
beforeEach(() => { for (const fn of Object.values(showToast)) (fn as jest.Mock).mockClear(); });

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
  useFeedFarm: () => ({ farmId: null, setFarmId: jest.fn(), farms: [{ farmId: "f1", code: "VIL100", name: "Village Farm", companyId: "co-1" }], loaded: true, failed: false, isFixed: false, fixedFarm: null }),
}));

const get = api.get as jest.Mock;

const row = (id: string, doc_type: string, purpose: string | null, extra: Record<string, unknown> = {}) => ({
  requisition_id: id, req_no: `NO-${id}`, doc_type, purpose, status: "DRAFT", farm_id: "f1", farm_code: "VIL100",
  requisition_date: "2026-10-01", required_date: "2026-10-09", approval_status: "OPEN", document_status: "OPEN",
  fulfilment_status: "NOT_APPLICABLE", integration_status: "NOT_APPLICABLE", approval_request_id: null, line_count: 2, ...extra,
});

const FEED_ROW = row("req-feed", "ITEM", "INTERNAL_TRANSFER", {
  requisition_kind: "FEED", source: "AUTO_FORECAST", status: "PENDING_APPROVAL", approval_status: "PENDING_APPROVAL",
});
const FEED_VIEW = {
  ...FEED_ROW,
  req_no: "NO-req-feed",
  requisition_type: "FEED_FORECAST",
  supply_source: "MILL",
  priority: "INFO",
  submission_deadline: "2026-10-08",
  remarks: null,
  approved_at: null,
  header: {
    farm_code: "VIL100", farm_name: "Village Farm", requisition_date: "2026-10-01",
    is_next_diet_requisition: false, farm_total_requested_kg: 0, truck_target_kg: 30000,
    bulk_multiple_kg: 3000, bag_size_kg: 50, trips: 0, required_delivery_date: null,
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: null,
  },
  lines: [],
};
const ROWS = [
  FEED_ROW,
  row("req-item", "ITEM", "STORE"),
  row("req-fa", "FA", "PURCHASE"),
  row("req-svc", "SERVICE", "PURCHASE", { farm_code: null, requisition_date: null, required_date: null, line_count: 3 }),
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
    if (url === "/requisition/req-feed") return { data: FEED_ROW };
    if (url === "/feed-requisition/req-feed") return { data: FEED_VIEW };
    if (url === "/requisition/req-item") return { data: itemView };
    if (url.startsWith("/requisition")) {
      const type = new URLSearchParams(url.split("?")[1] ?? "").get("doc_type");
      return { data: type ? ROWS.filter((r) => r.doc_type === type) : ROWS };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

const listUrls = () => get.mock.calls.map((c) => String(c[0])).filter((u) => /^\/requisition(\?|$)/.test(u));

describe("RequisitionsHub — one list and creation surface for every requisition", () => {
  it("lists feed requests in the common list as Item requisitions", async () => {
    render(<RequisitionsHub />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("reqDocItem")).toHaveLength(2);
    for (const label of ["reqDocFa", "reqDocService"]) expect(within(table).getByText(label)).toBeTruthy();
    expect(within(table).getByText("NO-req-feed")).toBeTruthy();
    expect(within(table).queryByText("reqDocFeed")).toBeNull();
    expect(within(table).getByText("NO-req-svc")).toBeTruthy();
    expect(listUrls()[0]).toMatch(/^\/requisition\?/);
    expect(listUrls().every((u) => !u.includes("kind=common"))).toBe(true);
  });

  it("uses human empty-state labels for an unselected farm and missing dates", async () => {
    render(<RequisitionsHub />);
    const table = await screen.findByRole("table");
    const serviceRow = within(table).getByText("NO-req-svc").closest("tr") as HTMLElement;
    expect(within(serviceRow).getByText("rhFarmNotSelected")).toBeTruthy();
    expect(within(serviceRow).getByText("rhNoRequisitionDate")).toBeTruthy();
    expect(within(serviceRow).getByText("rhNoRequiredDate")).toBeTruthy();
    expect(serviceRow.textContent).not.toContain("—");
  });

  it("the Type filter remains Item, Fixed Asset and Service", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    const options = within(screen.getByLabelText("rhType")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["", "ITEM", "FA", "SERVICE"]);
    fireEvent.change(screen.getByLabelText("rhType"), { target: { value: "ITEM" } });
    await waitFor(() => expect(listUrls().some((u) => !u.includes("kind=common") && u.includes("doc_type=ITEM"))).toBe(true));
  });

  it("offers All Farms and filters the canonical list by the selected farm", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    const farm = screen.getByLabelText("rhFarm");
    expect(within(farm).getByRole("option", { name: "rhAllFarms" })).toBeTruthy();
    fireEvent.change(farm, { target: { value: "f1" } });
    await waitFor(() => expect(listUrls().some((url) => url.includes("farm_id=f1"))).toBe(true));
  });

  it("a feed id followed by link opens the feed document in the common Requisition dialog", async () => {
    window.history.replaceState({}, "", "/requisitions?id=req-feed");
    render(<RequisitionsHub />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/feed-requisition/req-feed"));
    expect(routerReplace).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeTruthy();
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
    expect(await screen.findByText("crqReqNo")).toBeTruthy();
    expect(screen.queryByText("crqHeaderTitle")).toBeNull();
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
    expect(within(dialog).getByText("crqReqNo")).toBeTruthy();
    expect(within(dialog).queryByText("crqHeaderTitle")).toBeNull();
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
    expect(screen.getByRole("button", { name: "rqNewPurposeFeed" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeFa" }));
    expect(await screen.findByText("crqReqNo")).toBeTruthy();
    // Task 18: a brand-new, unsaved common requisition has no req_no yet; the
    // dialog falls back to a "new requisition" title rather than a blank one.
    expect(within(screen.getByRole("dialog")).getByText("crqNewTitleFa")).toBeTruthy();
    // The Type filter also offers reqDocFa as an <option>; the document's read-only field is the one that counts.
    const shown = (text: string) => screen.getAllByText(text).filter((el) => el.tagName !== "OPTION");
    expect(shown("reqDocFa")).toHaveLength(1);
    expect(shown("reqPurposePurchase")).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/requisition/options?company_id=co-1"));
    fireEvent.click(screen.getByRole("button", { name: "crqBack" }));
    expect(screen.getByText("rqNewPurposePrompt")).toBeTruthy();
  });

  it("puts Back in the new common dialog header and Create in its footer", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeFa" }));
    const dialog = await screen.findByRole("dialog");
    const header = dialog.querySelector("header") as HTMLElement;
    const footer = dialog.querySelector("footer") as HTMLElement;
    expect(within(header).getByRole("button", { name: "crqBack" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "crqCreate" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "crqSave" })).toBeNull();
  });

  it("keeps the common Store workflow buttons visible in the header and disabled until the document reaches their state", async () => {
    render(<RequisitionsHub />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "rhNew" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewPurposeItem" }));
    fireEvent.click(screen.getByRole("button", { name: "rqNewItemStore" }));
    const dialog = await screen.findByRole("dialog");
    const header = dialog.querySelector("header") as HTMLElement;
    for (const name of ["crqRelease", "crqShip", "crqReceive"]) {
      expect((within(header).getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("puts common Save and Submit in the footer while workflow actions stay in the header", async () => {
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-item"));
    const dialog = await screen.findByRole("dialog");
    const header = dialog.querySelector("header") as HTMLElement;
    const footer = dialog.querySelector("footer") as HTMLElement;
    expect(within(footer).getByRole("button", { name: "crqSave" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "crqSubmit" })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: "crqSave" })).toBeNull();
    expect(within(header).queryByRole("button", { name: "crqSubmit" })).toBeNull();
    expect((within(header).getByRole("button", { name: "crqRelease" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(header).getByRole("button", { name: "crqShip" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(header).getByRole("button", { name: "crqReceive" }) as HTMLButtonElement).disabled).toBe(true);
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

  // P1 follow-up item 7: a success notice from an action in the dialog is
  // shown inside the dialog — before, it went to the page behind it.
  it("toasts the Save result and shows no inline notice", async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: { ...itemView, remarks: "saved" } });
    render(<RequisitionsHub />);
    fireEvent.click(await screen.findByText("NO-req-item"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("crqSave"));
    await waitFor(() => expect(showToast.success).toHaveBeenCalledWith("crqSaved"));
    expect(screen.queryByText("crqSaved")).toBeNull();
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
    const dialog = await screen.findByRole("dialog");
    const footer = dialog.querySelector("footer") as HTMLElement;
    expect(within(footer).getByRole("button", { name: "rhReject" })).toBeTruthy();
    expect(within(footer).getByRole("button", { name: "rhApprove" })).toBeTruthy();
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
    const footer = screen.getByRole("dialog").querySelector("footer") as HTMLElement;
    fireEvent.click(within(footer).getByRole("button", { name: "rhRejectConfirm" }));
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

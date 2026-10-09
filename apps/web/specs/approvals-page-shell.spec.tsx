/** Rishi, 7 Oct: common requisitions are first-class Approvals inbox rows. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApprovalsPageShell } from "../src/components/console/approvals/approvals-page-shell";

// Stable references: the shell's effect depends on `router`, so a fresh
// object per render would loop forever (Maximum update depth exceeded).
const routerPush = jest.fn();
const storedUser = { userId: "u1", name: "Admin" };
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: jest.fn() }) }));
jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }),
}));
jest.mock("../src/hooks/useAuth", () => ({
  getStoredUser: () => storedUser,
  getActiveCompanyId: () => "co-1",
  getActiveOperationalAreaId: () => null,
  NavUser: {},
}));
jest.mock("../src/hooks/useCompanyCurrency", () => ({
  useCompanyCurrency: () => ({ currency: null }),
  formatMoney: (v: unknown) => String(v ?? "—"),
}));
jest.mock("../src/components/console/approvals/feed-requisition-approval-detail", () => () => null);
jest.mock("../src/components/console/approvals/requisition-approval-detail", () => () => null);

const { api } = jest.requireMock("../src/services/api-client") as { api: { get: jest.Mock; post: jest.Mock } };

const nonRequisitionRow = (id: string, doc_type: string, status: string) => ({
  request_id: id, doc_type, doc_no: `DOC-${id}`, title: `${doc_type} title`, requestor_label: "Ada",
  requestor_role: "Farm Manager", location_label: "VIL100", batch_no: null, document_id: null,
  submitted_at: "2026-10-01 10:00:00", urgency: "MEDIUM", item_or_stage: "x", requested_qty: "1", uom: "EA",
  cost_impact: 10, justification: "j", status, decided_at: null, decider_label: null, rejection_reason: null,
});

const commonRequisitionRow = {
  ...nonRequisitionRow("ar-rq-36", "REQUISITION", "PENDING"),
  doc_no: "RQ-00036",
  title: "Service requisition RQ-00036",
  document_id: "req-36",
};

const emptyContextRow = {
  ...nonRequisitionRow("ar-empty", "GRN_RECEIPT", "PENDING"),
  requestor_label: null,
  requestor_role: null,
  location_label: null,
  item_or_stage: null,
  requested_qty: null,
  cost_impact: null,
  justification: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/approvals/pending");
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/approval/counts")) return { data: { PENDING: 3, APPROVED: 1, REJECTED: 0 } };
    if (url.startsWith("/approval?")) {
      return { data: [commonRequisitionRow, nonRequisitionRow("ar-feed-ration", "FEED_RATION", "PENDING"), nonRequisitionRow("ar-grn", "GRN_RECEIPT", "PENDING"), emptyContextRow] };
    }
    if (url.startsWith("/batch?")) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

test("the pending inbox lists common requisitions beside other sign-offs", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  const table = await screen.findByRole("table");
  await screen.findByText("RQ-00036");
  expect(table.textContent).toContain("RQ-00036");
  expect(table.textContent).toContain("DOC-ar-feed-ration");
  expect(table.textContent).toContain("DOC-ar-grn");
});

test("removes New Request and the redundant requisitions card", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  await screen.findByText("RQ-00036");
  expect(screen.queryByRole("button", { name: /apNewRequest/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /apRequisitionsCard/ })).toBeNull();
});

test("counts the visible common requisition and does not request a separate requisition count", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  await screen.findByRole("table");
  const countsUrls = api.get.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.startsWith("/approval/counts"));
  expect(countsUrls).toEqual([expect.stringMatching(/^\/approval\/counts\?/)]);
  expect(screen.getByText("3")).toBeTruthy();
});

test("approves a common requisition from the Approvals table", async () => {
  api.post.mockResolvedValue({ data: { status: "APPROVED" } });
  render(<ApprovalsPageShell activeTab="PENDING" />);
  const row = (await screen.findByText("RQ-00036")).closest("tr") as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "apApprove" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/approval/ar-rq-36/approve", {}));
});

test("uses human empty-state labels instead of raw dashes", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  const row = (await screen.findByText("DOC-ar-empty")).closest("tr") as HTMLElement;
  expect(within(row).getByText("apUnknownRequester")).toBeTruthy();
  expect(within(row).getByText("apLocationNotSpecified")).toBeTruthy();
  expect(row.textContent).not.toContain("—");
});

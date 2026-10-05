/**
 * WP1b (decisions.md 2026-10-04, "one Requisitions page"):
 *
 * 1. The Approvals inbox NO LONGER LISTS requisitions — the hub
 *    (Approvals → Requisitions) is the one requisition list. The backend
 *    excludes the kinds from GET /approval and GET /approval/counts; this
 *    spec pins the inbox UI to the OTHER sign-offs (FEED_RATION, GRN_RECEIPT,
 *    STOCK_TRANSFER, STAGE_CLOSE, VET_DISPOSAL) and their counts.
 * 2. The inbox shows the card: "Requisitions waiting for approval: N → open
 *    Requisitions" (t: apRequisitionsCard), N from GET /approval/counts-requisitions.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const { api } = jest.requireMock("../src/services/api-client") as { api: { get: jest.Mock } };

const nonRequisitionRow = (id: string, doc_type: string, status: string) => ({
  request_id: id, doc_type, doc_no: `DOC-${id}`, title: `${doc_type} title`, requestor_label: "Ada",
  requestor_role: "Farm Manager", location_label: "VIL100", batch_no: null, document_id: null,
  submitted_at: "2026-10-01 10:00:00", urgency: "MEDIUM", item_or_stage: "x", requested_qty: "1", uom: "EA",
  cost_impact: 10, justification: "j", status, decided_at: null, decider_label: null, rejection_reason: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/approvals/pending");
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith("/approval/counts-requisitions")) return { data: { PENDING: 4 } };
    if (url.startsWith("/approval/counts")) return { data: { PENDING: 2, APPROVED: 1, REJECTED: 0 } };
    if (url.startsWith("/approval?")) {
      return { data: [nonRequisitionRow("ar-feed-ration", "FEED_RATION", "PENDING"), nonRequisitionRow("ar-grn", "GRN_RECEIPT", "PENDING")] };
    }
    if (url.startsWith("/batch?")) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

test("the pending inbox lists only non-requisition sign-offs — requisitions come from the hub, not here", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  const table = await screen.findByRole("table");
  expect(table.textContent).toContain("DOC-ar-feed-ration");
  expect(table.textContent).toContain("DOC-ar-grn");
  expect(table.textContent).not.toContain("REQ-");
});

test("the requisitions card shows the hub's pending count and links to Requisitions", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  const link = await screen.findByRole("button", { name: /apRequisitionsCard/ });
  expect(link.textContent).toContain("4");
  fireEvent.click(link);
  await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/requisitions"));
});

test("the badges count only what the inbox shows — the counts endpoint excludes requisitions", async () => {
  render(<ApprovalsPageShell activeTab="PENDING" />);
  await screen.findByRole("table");
  const countsUrls = api.get.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.startsWith("/approval/counts"));
  expect(countsUrls.some((u: string) => u.startsWith("/approval/counts-requisitions"))).toBe(true);
  expect(screen.getByText("2")).toBeTruthy();
});

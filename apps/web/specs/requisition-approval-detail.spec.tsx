/**
 * Task 9 — the common requisition's Approvals-inbox detail (web).
 *
 * The shell must mount RequisitionApprovalDetail for a REQUISITION request
 * (as it already does FeedRequisitionApprovalDetail for a FEED_REQUISITION)
 * without changing the layout unrelated documents depend on.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { RequisitionApprovalDetail } from "@/components/console/approvals/requisition-approval-detail";

jest.mock("@/services/api-client", () => ({
  api: { get: jest.fn() },
}));
jest.mock("@/hooks/useLanguage", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${vars.remarks ?? ""}` : key) }),
}));
jest.mock("@/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "—" }));

const { api } = jest.requireMock("@/services/api-client") as { api: { get: jest.Mock } };

const view = {
  req_no: "REQ-2026-0001",
  doc_type: "ITEM",
  purpose: "STORE",
  status: "PENDING_APPROVAL",
  requisition_date: "2026-10-01",
  requester_name: "Ada Farm",
  remarks: "Weekly store pull",
  justification: null,
  approval_status: "PENDING_APPROVAL",
  document_status: "OPEN",
  fulfilment_status: "NOT_APPLICABLE",
  integration_status: "NOT_APPLICABLE",
  lines: [
    {
      line_id: "l1", line_seq: 1, item_code: "IT-1", item_name: "Bolts", description: null,
      quantity: "10.0000", uom: "EA", qty_to_ship: "6.0000", qty_shipped: null,
      qty_to_receive: "6.0000", qty_received: null, balance_to_ship: 6, remaining_to_receive: 6,
    },
  ],
};

test("renders the requisition's lines, purpose and state dimensions", async () => {
  api.get.mockResolvedValue({ data: view });
  render(<RequisitionApprovalDetail documentId="req-1" />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/requisition/req-1"));
  await waitFor(() => expect(screen.getByText(/ITEM · Store/)).toBeTruthy());
  expect(screen.getByText(/PENDING_APPROVAL · OPEN/)).toBeTruthy();
  expect(screen.getByText("IT-1 — Bolts")).toBeTruthy();
  // Requested 10, and both targets 6 (to-ship and to-receive).
  expect(screen.getByText("10 EA")).toBeTruthy();
  expect(screen.getAllByText("6")).toHaveLength(2);
  expect(screen.getByText(/apCreqRemarks:Weekly store pull/)).toBeTruthy();
});

test("shows the unavailable note when the requisition cannot be read", async () => {
  api.get.mockRejectedValue(new Error("offline"));
  render(<RequisitionApprovalDetail documentId="req-1" />);
  await waitFor(() => expect(screen.getByText("apCreqLinesUnavailable")).toBeTruthy());
});

test("renders nothing before the requisition arrives", async () => {
  let resolve: (v: unknown) => void = () => undefined;
  api.get.mockReturnValue(new Promise((res) => { resolve = res; }));
  const { container } = render(<RequisitionApprovalDetail documentId="req-1" />);
  expect(container.textContent).toBe("");
  resolve({ data: view });
  await waitFor(() => expect(screen.getByText("IT-1 — Bolts")).toBeTruthy());
});

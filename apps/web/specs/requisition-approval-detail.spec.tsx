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
  company_id: "co-1",
  req_no: "REQ-2026-0001",
  doc_type: "ITEM",
  purpose: "STORE",
  status: "PENDING_APPROVAL",
  requisition_date: "2026-10-01",
  required_date: null, main_location_id: null, requester_department_id: null, sender_department_id: null,
  from_location_id: null, to_location_id: null, direct_transfer: false,
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

test("renders the requisition as its read-only document", async () => {
  const second = { ...view.lines[0], line_id: "l2", line_seq: 2, item_code: "IT-2", item_name: "Nuts", quantity: "4.0000", qty_to_ship: "4.0000", qty_to_receive: "4.0000" };
  api.get.mockResolvedValue({ data: { ...view, lines: [view.lines[0], second] } });
  render(<RequisitionApprovalDetail documentId="req-1" />);
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/requisition/req-1"));
  expect(await screen.findByText("crqHeaderTitle")).toBeTruthy();
  expect(screen.getByText("REQ-2026-0001")).toBeTruthy();
  expect(screen.getByText(/IT-1/)).toBeTruthy();
  expect(screen.getByText(/IT-2/)).toBeTruthy();
  expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
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
  await waitFor(() => expect(screen.getByText(/IT-1/)).toBeTruthy());
});

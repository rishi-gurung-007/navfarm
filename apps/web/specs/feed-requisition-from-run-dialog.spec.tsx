import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedRequisitionFromRunDialog } from "../src/components/console/inventory/feed-requisition-from-run-dialog";
import { api } from "../src/services/api-client";
jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }, Toast: () => null }));
import { showToast } from '../src/components/ui/toast';
beforeEach(() => { for (const fn of Object.values(showToast)) (fn as jest.Mock).mockClear(); });

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: object) => vars ? `${key}:${JSON.stringify(vars)}` : key }) }));

const preview = {
  runId: "run-1", runCode: "FFR-GRA100-00001", farmId: "farm-1", existingRequisitionId: null,
  lines: [{
    destination_location_id: "silo-1", destination_code: "GRA100/SILO-001", destination_name: "Feed Silo 1",
    item_id: "item-1", item_code: "FEED-001", item_name: "Grower feed", recommended_qty_kg: 6000,
    quantity_kg: 6000, proposed_delivery_date: "2026-10-12",
  }],
};
const view = { requisition_id: "req-1", req_no: "REQ-GRA100-2026-00001", lines: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (api.get as jest.Mock).mockResolvedValue({ data: preview });
  (api.post as jest.Mock).mockResolvedValue({ data: view });
});

it("loads the saved run, preserves editable changes, and creates exactly from that run", async () => {
  const onView = jest.fn();
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={onView} />);
  expect(await screen.findByText("GRA100/SILO-001")).toBeTruthy();
  fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: "7200" } });
  fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: "2026-10-13" } });
  fireEvent.change(screen.getByLabelText("rqdRemarks"), { target: { value: "Mill slot confirmed" } });
  expect((screen.getByLabelText('rqNewPriorityNo:{"line":1}') as HTMLInputElement).value).toBe("1");
  fireEvent.change(screen.getByLabelText('rqNewPriorityNo:{"line":1}'), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "rqCreateFromSaved" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/feed-requisition/from-run/run-1", {
    remarks: "Mill slot confirmed",
    lines: [{ destination_location_id: "silo-1", item_id: "item-1", quantity_kg: 7200, proposed_delivery_date: "2026-10-13", priority_no: 4 }],
  }));
  expect(onView).toHaveBeenCalledWith(view);
});

it("keeps edits visible when creation fails", async () => {
  (api.post as jest.Mock).mockRejectedValueOnce(new Error("Duplicate saved calculation"));
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={jest.fn()} />);
  await screen.findByText("GRA100/SILO-001");
  const quantity = screen.getByLabelText('rqNewKg:{"line":1}') as HTMLInputElement;
  fireEvent.change(quantity, { target: { value: "7200" } });
  fireEvent.click(screen.getByRole("button", { name: "rqCreateFromSaved" }));
  await waitFor(() => expect(showToast.error).toHaveBeenCalledWith("Duplicate saved calculation"));
  expect(quantity.value).toBe("7200");
});

it("opens the already-created requisition instead of creating another", async () => {
  (api.get as jest.Mock).mockImplementation(async (url: string) => url.endsWith("/preview")
    ? { data: { ...preview, existingRequisitionId: "req-1" } }
    : { data: view });
  const onView = jest.fn();
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={onView} />);
  fireEvent.click(await screen.findByRole("button", { name: "rqViewRequisition" }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/feed-requisition/req-1"));
  expect(onView).toHaveBeenCalledWith(view);
  expect(api.post).not.toHaveBeenCalled();
});

it("fills Priority No. 1..N by delivery date, sends none for a blank one, and refuses a fraction (Rishi, 30 Oct)", async () => {
  const second = { ...preview.lines[0], destination_location_id: "silo-2", destination_code: "GRA100/SILO-002", proposed_delivery_date: "2026-10-10" };
  (api.get as jest.Mock).mockResolvedValue({ data: { ...preview, lines: [preview.lines[0], second] } });
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={jest.fn()} />);
  await screen.findByText("GRA100/SILO-002");
  const first = screen.getByLabelText('rqNewPriorityNo:{"line":1}') as HTMLInputElement;
  const other = screen.getByLabelText('rqNewPriorityNo:{"line":2}') as HTMLInputElement;
  // SILO-002 is due on the 10th, before SILO-001 on the 12th.
  expect([first.value, other.value]).toEqual(["2", "1"]);
  fireEvent.change(first, { target: { value: "1.5" } });
  expect((screen.getByRole("button", { name: "rqCreateFromSaved" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(first, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "rqCreateFromSaved" }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  const body = (api.post as jest.Mock).mock.calls[0][1];
  expect(body.lines[0]).not.toHaveProperty("priority_no");
  expect(body.lines[1].priority_no).toBe(1);
});

it("fills a quantity the silo can take, and blocks Create while a line breaks a rule (Rishi, 30 Oct)", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { ...preview, settings: { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000 }, lines: [{
    ...preview.lines[0], feed_type: "BULK", recommended_qty_kg: 9000, quantity_kg: 9000,
    silo_capacity_kg: 10000, silo_on_hand_kg: 1000, silo_stock_by_date: { "2026-10-12": 2000, "2026-10-14": 500 },
  }] } });
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={jest.fn()} />);
  await screen.findByText("GRA100/SILO-001");
  const kg = screen.getByLabelText('rqNewKg:{"line":1}') as HTMLInputElement;
  // 10,000 capacity − 2,000 projected on the 12th = 8,000 free → 6,000 in whole 3,000 compartments.
  expect(kg.value).toBe("6000");
  const create = () => screen.getByRole("button", { name: "rqCreateFromSaved" }) as HTMLButtonElement;
  expect(create().disabled).toBe(false);
  fireEvent.change(kg, { target: { value: "4500" } });
  expect(screen.getByText(/rqQtyNotBulkMultiple/)).toBeTruthy();
  expect(create().disabled).toBe(true);
  fireEvent.change(kg, { target: { value: "9000" } });
  expect(screen.getByText(/rqQtyOverCapacity/)).toBeTruthy();
  expect(create().disabled).toBe(true);
  // Moved to the 14th, when the silo is projected to hold 500 KG, 9,000 fits.
  fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: "2026-10-14" } });
  expect(screen.queryByText(/rqQtyOverCapacity/)).toBeNull();
  expect(create().disabled).toBe(false);
});

it("shows the run's own forecast figures on each line", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { ...preview, lines: [{ ...preview.lines[0], system_balance_kg: 2580, daily_requirement_kg: 231, days_remaining: 11.2, is_next_diet: true, days_before_diet_change: 12, lifecycle_ref_label: 'LW LACTATION days 1–21', silo_capacity_kg: 5800, silo_on_hand_kg: 0, silo_stock_by_date: {} }] } });
  render(<FeedRequisitionFromRunDialog open runId="run-1" onClose={jest.fn()} onView={jest.fn()} />);
  await screen.findByText("GRA100/SILO-001");
  for (const text of ["2,580.00", "231.00", "11.2", "12", "rqYes", "LW LACTATION days 1–21", "5,800.00"]) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("rqdColSiloCapacity");
});

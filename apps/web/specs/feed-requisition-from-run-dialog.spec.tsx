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
  fireEvent.click(screen.getByRole("button", { name: "rqCreateFromSaved" }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("/feed-requisition/from-run/run-1", {
    remarks: "Mill slot confirmed",
    lines: [{ destination_location_id: "silo-1", item_id: "item-1", quantity_kg: 7200, proposed_delivery_date: "2026-10-13" }],
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

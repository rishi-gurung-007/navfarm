/**
 * W5 (10 Oct): the Loading Instruction Sheet (Requisition and Loading Sheet
 * §3, rows 60–77) shows Delivery Date, Diet No., Loaded By and Loading Date
 * Time, says its status in words, links every record it names, and opens a
 * sheet named by ?id=.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FeedLoadingPanel, loadingSheetHref } from "../src/components/console/inventory/feed-loading-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.no != null ? `${key}:${vars.no}` : key) }) }));
jest.mock("../src/components/ui/toast", () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));

const sheet = {
  loading_sheet_id: "ls-1", loading_sheet_no: "LOAD-REQ-MUL100-2026-00001-10000", consolidation_id: "cons-1",
  requisition_id: "req-1", requisition_no: "REQ-MUL100-2026-00001", farm_id: "farm-1", farm_code: "MUL100", farm_name: "Mulberry",
  destination_silo_id: "silo-1", destination_silo_code: "MUL100/SILO-01", destination_silo_name: "Silo 1",
  item_id: "item-8", item_code: "ICAT-004-ITM-0008", item_name: "Weaner Grower Mash", diet_no: 8,
  mill_loading_bin_id: "bin-1", mill_loading_bin_code: "MILL-001/BIN-001", mill_loading_bin_name: "Bin 1",
  requested_qty_kg: "6050", mill_approved_qty_kg: "6000", scheduled_qty_kg: "6000", adjustment_reason: null,
  requested_delivery_date: "2026-10-12", compartment_no: "C1", kg_loaded: "6000", loaded_by_name: "Mill Loader 01",
  loaded_at: "2026-10-11 09:30:00", status: "LOADED", shipment_no: "TS-0001", transfer_id: "tr-1", transfer_no: "TO-0001",
};
const other = { ...sheet, loading_sheet_id: "ls-2", loading_sheet_no: "LOAD-REQ-GRS-2026-00001-10000", status: "DRAFT", loaded_by_name: null, loaded_at: null };

const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

describe("FeedLoadingPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=loading-instructions");
    (api.get as jest.Mock).mockResolvedValue({ data: [sheet, other] });
    (api.put as jest.Mock).mockResolvedValue({ data: sheet });
  });

  it("shows Delivery Date, Diet No., Loaded By and Loading Date Time (rows 64, 65, 72, 73)", async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(sheet.loading_sheet_no)).closest("tr")!;
    expect(screen.getByText("flsColDeliveryDate")).toBeTruthy();
    expect(screen.getByText("flsColLoadedBy")).toBeTruthy();
    expect(screen.getByText("flsColLoadedAt")).toBeTruthy();
    expect(within(row).getByText("12/10/26")).toBeTruthy();
    expect(within(row).getByText("fcdDiet:8")).toBeTruthy();
    expect((within(row).getByLabelText(`flsLoadedByFor:${sheet.loading_sheet_no}`) as HTMLInputElement).value).toBe("Mill Loader 01");
    expect(within(row).getByText(/^\d{2}\/\d{2}\/26 \d{2}:\d{2}$/)).toBeTruthy();
  });

  it("says the status in words from the shared loading map (row 77)", async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(sheet.loading_sheet_no)).closest("tr")!;
    expect(within(row).getByText("loadStatusLoaded")).toBeTruthy();
    expect(screen.queryByText("LOADED")).toBeNull();
  });

  it("links the requisition, farm, silo, item, BIN and transfer (rows 61–68)", async () => {
    render(<FeedLoadingPanel />);
    await screen.findByText(sheet.loading_sheet_no);
    const row = screen.getByText(sheet.loading_sheet_no).closest("tr")!;
    const link = (name: string) => within(row).getByRole("link", { name }).getAttribute("href");
    expect(link("REQ-MUL100-2026-00001")).toBe("/requisitions?id=req-1");
    expect(link("MUL100")).toBe("/master-data/location?recordId=farm-1");
    expect(link("MUL100/SILO-01")).toBe("/master-data/location?recordId=silo-1");
    expect(link("ICAT-004-ITM-0008")).toBe("/master-data/item?recordId=item-8");
    expect(link("MILL-001/BIN-001")).toBe("/master-data/location?recordId=bin-1");
    expect(link("TO-0001")).toBe("/inventory/transfers?id=tr-1");
    expect(hrefOf(sheet.loading_sheet_no)).toBe(loadingSheetHref("ls-1"));
  });

  it("sends the Loaded By name with Save", async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest("tr")!;
    fireEvent.change(within(row).getByLabelText(`flsLoadedByFor:${other.loading_sheet_no}`), { target: { value: "Mill Loader 02" } });
    fireEvent.click(within(row).getByRole("button", { name: "flsSave" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/feed-requisition/loading-sheets/ls-2", expect.objectContaining({ loadedBy: "Mill Loader 02" })));
  });

  it("opens the sheet named by ?id=", async () => {
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=loading-instructions&id=ls-2");
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest("tr")!;
    await waitFor(() => expect(row.getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByText(sheet.loading_sheet_no).closest("tr")!.getAttribute("aria-selected")).toBe("false");
  });

  it("ignores an ?id= meant for another tab", async () => {
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=mill-consolidation&id=ls-2");
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest("tr")!;
    expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("deep links into the Loading Instructions tab", () => {
    expect(loadingSheetHref("ls 1")).toBe("/inventory/feed-forecast?tab=loading-instructions&id=ls%201");
  });
});

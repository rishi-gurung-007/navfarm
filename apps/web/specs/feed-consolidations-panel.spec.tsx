/**
 * W4 (10 Oct): the saved Mill Consolidation Sheet (Requisition and Loading
 * Sheet §5) shows rows 118, 121, 122, 124, 125 and 130, says its status in
 * words, formats dates, links what it names, and opens by ?id=.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FeedConsolidationsPanel, consolidationHref } from "../src/components/console/inventory/feed-consolidations-panel";
import { loadingSheetHref } from "../src/components/console/inventory/feed-loading-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.no != null ? `${key}:${vars.no}` : key) }) }));
jest.mock("../src/components/ui/toast", () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));

const listRow = { consolidation_id: "cons-1", consolidation_no: "CONS-202641-001", production_week: "202641", consolidation_date: "2026-10-10", status: "DRAFT", line_count: 2, requested_qty_kg: 9000, mill_approved_qty_kg: 9000 };
const line = {
  consolidation_line_id: "cl-1", requisition_id: "req-1", requisition_no: "REQ-MUL100-2026-00001", requisition_line_id: "rl-1",
  farm_id: "farm-1", farm_code: "MUL100", farm_name: "Mulberry", destination_silo_id: "silo-1", destination_silo_code: "MUL100/SILO-01", destination_silo_name: "Silo 1",
  item_id: "item-8", item_code: "ICAT-004-ITM-0008", item_name: "Weaner Grower Mash", diet_no: 8,
  mill_loading_bin_id: "bin-1", mill_loading_bin_code: "MILL-001/BIN-001", mill_loading_bin_name: "Bin 1",
  requested_qty_kg: "6000.0000", mill_approved_qty_kg: "6000.0000", adjustment_reason: null,
  available_mill_output_kg: 150000, mill_capacity_state: "AVAILABLE", mill_capacity_status: "GREEN", total_all_farms_kg: 9000,
  transfer_id: "tr-1", transfer_no: "TO-0001", loading_sheet_id: "ls-1", loading_sheet_no: "LOAD-REQ-MUL100-2026-00001-10000",
};
const detail = { ...listRow, feed_mill_manager_name: "Feed Mill Manager One", lines: [line] };

describe("FeedConsolidationsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=mill-consolidation");
    (api.get as jest.Mock).mockImplementation(async (url: string) => ({ data: url.includes("/consolidations/cons-1") ? detail : [listRow] }));
  });

  it("lists sheets with the status in words and a short date", async () => {
    render(<FeedConsolidationsPanel />);
    const row = (await screen.findByText(listRow.consolidation_no)).closest("tr")!;
    expect(within(row).getByText("fcsStatusDraft")).toBeTruthy();
    expect(within(row).getByText("10/10/26")).toBeTruthy();
    expect(screen.queryByText("DRAFT")).toBeNull();
  });

  it("shows rows 118, 121, 122, 124, 125 and 130 on the saved sheet, linked", async () => {
    render(<FeedConsolidationsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "fcsView" }));
    const lines = await screen.findByRole("table", { name: "fcsLinesLabel" });
    expect(screen.getByText("Feed Mill Manager One")).toBeTruthy();
    const cell = within(lines);
    expect(cell.getByText("fcdDiet:8")).toBeTruthy();
    expect(cell.getByText("150,000")).toBeTruthy();
    expect(cell.getByText("9,000 KG")).toBeTruthy();
    const href = (name: string) => cell.getByRole("link", { name }).getAttribute("href");
    expect(href("REQ-MUL100-2026-00001")).toBe("/inventory/feed-forecast?tab=feed-requisition&id=req-1");
    expect(href("MUL100")).toBe("/master-data/location?recordId=farm-1");
    expect(href("MUL100/SILO-01")).toBe("/master-data/location?recordId=silo-1");
    expect(href("ICAT-004-ITM-0008")).toBe("/master-data/item?recordId=item-8");
    expect(href("MILL-001/BIN-001")).toBe("/master-data/location?recordId=bin-1");
    expect(href("TO-0001")).toBe("/inventory/transfers?id=tr-1");
    expect(href("LOAD-REQ-MUL100-2026-00001-10000")).toBe(loadingSheetHref("ls-1"));
  });

  it("opens the sheet named by ?id=", async () => {
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=mill-consolidation&id=cons-1");
    render(<FeedConsolidationsPanel />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/feed-requisition/consolidations/cons-1"));
    expect(await screen.findByRole("table", { name: "fcsLinesLabel" })).toBeTruthy();
  });

  it("ignores an ?id= meant for another tab", async () => {
    window.history.replaceState({}, "", "/inventory/feed-forecast?tab=loading-instructions&id=cons-1");
    render(<FeedConsolidationsPanel />);
    await screen.findByText(listRow.consolidation_no);
    expect(api.get).not.toHaveBeenCalledWith("/feed-requisition/consolidations/cons-1");
  });

  it("deep links into the Mill Consolidation tab", () => {
    expect(consolidationHref("cons-1")).toBe("/inventory/feed-forecast?tab=mill-consolidation&id=cons-1");
  });

  it("W5C r128: a DRAFT sheet can be marked reviewed, then finalized", async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { ...detail, status: "REVIEWED" } });
    render(<FeedConsolidationsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "fcsView" }));
    fireEvent.click(await screen.findByRole("button", { name: "fcsMarkReviewed" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/feed-requisition/consolidations/cons-1/review", {}));
    await waitFor(() => expect(screen.queryByRole("button", { name: "fcsMarkReviewed" })).toBeNull());
    expect(screen.getByRole("button", { name: "fcsFinalize" })).toBeTruthy();
  });
});

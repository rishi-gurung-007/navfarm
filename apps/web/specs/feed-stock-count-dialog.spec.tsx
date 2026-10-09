import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import FeedStockCountPanel from "../src/components/console/inventory/feed-stock-count-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({
  useLanguage: () => ({ t: mockT }),
}));
const mockT = (key: string) => key;
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({
  useFeedFarm: () => ({
    farmId: "farm-1",
    farms: [{ farmId: "farm-1", companyId: "company-1", code: "GRA100", name: "GRASMERE FARM" }],
    loaded: true,
    failed: false,
    isFixed: false,
    setFarmId: jest.fn(),
    retry: jest.fn(),
  }),
}));

const get = api.get as jest.Mock;

const row = {
  count_id: "count-1", count_no: "FSC-00001", counted_at: "2026-10-08 18:00:00",
  schedule_source: "ON_DEMAND", status: "DRAFT", approval_request_id: null, stock_adjustment_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url.startsWith("/feed-stock-count/evidence?")) return Promise.resolve({ data: {
      countedAt: "2026-10-08T18:00:00+05:30",
      pairs: [{ siloId: "silo-1", siloCode: "GRA100/SILO-001", itemId: "item-1", itemCode: "FEED-001", uom: "KG", systemQtyKg: 1000, costAvailable: true }],
    } });
    if (url === "/feed-stock-count/count-1") return Promise.resolve({ data: { ...row, lines: [] } });
    return Promise.resolve({ data: [row] });
  });
});

it("opens New count over the retained list with a fixed dialog header and footer", async () => {
  render(<FeedStockCountPanel />);
  expect(await screen.findByText("FSC-00001")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "fscNew" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog.querySelector("header") as HTMLElement).getByText("fscNew")).toBeTruthy();
  const footer = dialog.querySelector("footer") as HTMLElement;
  expect(within(footer).getByRole("button", { name: "fscSave" })).toBeTruthy();
  expect(within(footer).getByRole("button", { name: "cancel" })).toBeTruthy();
  expect(screen.getByText("FSC-00001")).toBeTruthy();
  expect(within(dialog).getByText("GRA100/SILO-001")).toBeTruthy();
});

it("opens an existing draft in the same document dialog and puts Submit in its footer", async () => {
  render(<FeedStockCountPanel />);
  fireEvent.click(await screen.findByText("FSC-00001"));

  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByText("FSC-00001")).toBeTruthy());
  const footer = dialog.querySelector("footer") as HTMLElement;
  expect(within(footer).getByRole("button", { name: "fscSubmit" })).toBeTruthy();
  expect(within(footer).getByRole("button", { name: "close" })).toBeTruthy();
});

it("shows semantic values rather than internal IDs in an existing count", async () => {
  get.mockImplementation((url: string) => {
    if (url === "/feed-stock-count/count-1") return Promise.resolve({ data: { ...row, lines: [{
      count_line_id: "line-1", silo_id: "silo-1", silo_code: "GRA100/SILO-001",
      item_id: "item-1", item_code: "FEED-001", item_name: "Grower Feed",
      system_qty_kg: "1000", counted_qty_kg: "950", variance_qty_kg: "-50", variance_pct_absolute: "5",
      reason_id: "reason-1", reason_name: "Spillage",
    }] } });
    return Promise.resolve({ data: [row] });
  });
  render(<FeedStockCountPanel />);
  fireEvent.click(await screen.findByText("FSC-00001"));

  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("GRA100/SILO-001")).toBeTruthy();
  expect(within(dialog).getByText("FEED-001")).toBeTruthy();
  expect(within(dialog).getByText("Grower Feed")).toBeTruthy();
  expect(within(dialog).getByText("Spillage")).toBeTruthy();
  expect(within(dialog).queryByText("silo-1")).toBeNull();
  expect(within(dialog).queryByText("item-1")).toBeNull();
  expect(within(dialog).queryByText("reason-1")).toBeNull();
});

it("uses human unavailable text for a missing count timestamp and invalid quantity", async () => {
  const incomplete = { ...row, counted_at: "" };
  get.mockImplementation((url: string) => {
    if (url === "/feed-stock-count/count-1") return Promise.resolve({ data: { ...incomplete, lines: [{
      count_line_id: "line-1", silo_id: "silo-1", silo_code: "GRA100/SILO-001",
      item_id: "item-1", item_code: "FEED-001", item_name: "Grower Feed",
      system_qty_kg: "not-a-number", counted_qty_kg: "950", variance_qty_kg: "-50", variance_pct_absolute: "5",
      reason_id: null, reason_name: null,
    }] } });
    return Promise.resolve({ data: [incomplete] });
  });
  render(<FeedStockCountPanel />);
  fireEvent.click(await screen.findByText("FSC-00001"));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getAllByText("fsdNotAvailable").length).toBeGreaterThan(0);
  expect(within(dialog).queryByText("—")).toBeNull();
});

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
    if (url.startsWith("/location?")) return Promise.resolve({ data: [] });
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

/** W2D W8 (Engine §1 rows 8–17; checkpoint 37). */
describe("W2D W8: count entry and lines show the silo planning facts", () => {
  const planning = {
    siloName: "Grower silo", capacityKg: 12000, houses: [{ id: "shed-3", code: "GRA100/SHED-003", name: "Third shed" }],
    itemName: "Grower Feed R1", projectedShortfallKg: 4500,
    nextDietItemId: "item-2", nextDietItemCode: "FEED-002", nextDietItemName: "Grower Feed R2", nextDietDate: "2026-10-12", nextDietInDays: 4,
  };

  it("entry rows show name, house, capacity, diet description, shortfall, next diet days (warned at 7 or less) and next item, all linked", async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith("/feed-stock-count/evidence?")) return Promise.resolve({ data: {
        countedAt: "2026-10-08T18:00:00+05:30", planningDate: "2026-10-08",
        pairs: [{ siloId: "silo-1", siloCode: "GRA100/SILO-001", itemId: "item-1", itemCode: "FEED-001", uom: "KG", systemQtyKg: 1000, costAvailable: true, ...planning }],
      } });
      return Promise.resolve({ data: [row] });
    });
    render(<FeedStockCountPanel />);
    await screen.findByText("FSC-00001");
    fireEvent.click(screen.getByRole("button", { name: "fscNew" }));
    const table = await screen.findByRole("table", { name: "fscEntryLabel" });
    const href = (name: string) => within(table).getByRole("link", { name }).getAttribute("href");
    expect(href("GRA100/SILO-001")).toBe("/master-data/location?recordId=silo-1");
    expect(href("GRA100/SHED-003")).toBe("/master-data/location?recordId=shed-3");
    expect(href("FEED-001")).toBe("/master-data/item?recordId=item-1");
    expect(href("FEED-002")).toBe("/master-data/item?recordId=item-2");
    for (const text of ["Grower silo", "Grower Feed R1", "12,000", "4,500"]) expect(within(table).getByText(text)).toBeTruthy();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["fscColSiloName", "fscColHouse", "fscColCapacity", "fscColDiet", "fscColSystemBalance", "fscColShortfall", "fscColNextDietIn", "fscColNextItem"]));
    expect(headers).not.toContain("fscColSystem");
    const warn = within(table).getByTestId("next-diet-in-silo-1");
    expect(warn.textContent).toContain("4");
    expect(warn.getAttribute("data-warning")).toBe("true");
  });

  it("never shows a silo id when the code is missing", async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith("/feed-stock-count/evidence?")) return Promise.resolve({ data: {
        countedAt: "2026-10-08T18:00:00+05:30",
        pairs: [{ siloId: "silo-1", siloCode: null, itemId: "item-1", itemCode: "FEED-001", uom: "KG", systemQtyKg: 1000, costAvailable: true }],
      } });
      return Promise.resolve({ data: [row] });
    });
    render(<FeedStockCountPanel />);
    await screen.findByText("FSC-00001");
    fireEvent.click(screen.getByRole("button", { name: "fscNew" }));
    const table = await screen.findByRole("table", { name: "fscEntryLabel" });
    expect(within(table).queryByText("silo-1")).toBeNull();
    expect(within(table).queryByText("—")).toBeNull();
  });

  it("saved lines show the same facts and link silo and items", async () => {
    get.mockImplementation((url: string) => {
      if (url === "/feed-stock-count/count-1") return Promise.resolve({ data: { ...row, lines: [{
        count_line_id: "line-1", silo_id: "silo-1", silo_code: "GRA100/SILO-001", silo_name: "Grower silo",
        item_id: "item-1", item_code: "FEED-001", item_name: "Grower Feed R1",
        system_qty_kg: "1000", counted_qty_kg: "950", variance_qty_kg: "-50", variance_pct_absolute: "5",
        reason_id: null, reason_name: null, ...planning, nextDietInDays: 12,
      }] } });
      return Promise.resolve({ data: [row] });
    });
    render(<FeedStockCountPanel />);
    fireEvent.click(await screen.findByText("FSC-00001"));
    const table = await screen.findByRole("table", { name: "fscLinesLabel" });
    expect(within(table).getByRole("link", { name: "GRA100/SILO-001" }).getAttribute("href")).toBe("/master-data/location?recordId=silo-1");
    expect(within(table).getByRole("link", { name: "FEED-001" }).getAttribute("href")).toBe("/master-data/item?recordId=item-1");
    expect(within(table).getByRole("link", { name: "GRA100/SHED-003" })).toBeTruthy();
    expect(within(table).getByText("Grower silo")).toBeTruthy();
    expect(within(table).getByTestId("next-diet-in-silo-1").getAttribute("data-warning")).toBe("false");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toContain("fscColSystemBalance");
  });
});

describe("Monthly Stock Take view", () => {
  const monthly = {
    ...row, count_id: "count-9", count_no: "ST-GRA100-2026-00001", status: "POSTED", count_type: "MONTHLY",
    stock_take_type: "FARM", period_code: "2026-09",
  };

  it("lists count type, reporting period and stock take number", async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: url.startsWith("/location?") ? [] : [monthly] }));
    render(<FeedStockCountPanel />);
    expect(await screen.findByText("ST-GRA100-2026-00001")).toBeTruthy();
    expect(screen.getByText("fscColCountType")).toBeTruthy();
    expect(screen.getByText("fscColPeriod")).toBeTruthy();
    expect(screen.getByText("2026-09")).toBeTruthy();
    expect(screen.getByText("fscCountTypeMonthly")).toBeTruthy();
  });

  it("shows GL entry, period status after reconciliation and next production start; GL is Not available when none", async () => {
    const detail = (gl: string[] | null) => (url: string) => Promise.resolve({ data: url === "/feed-stock-count/count-9"
      ? { ...monthly, lines: [], stock_take_date: "2026-09-26", period_status_after: "CLOSED", production_start_date_next: "2026-09-27", gl_entry_refs: gl }
      : url.startsWith("/location?") ? [] : [monthly] });
    get.mockImplementation(detail(["JV-0001"]));
    const first = render(<FeedStockCountPanel />);
    fireEvent.click(await screen.findByText("ST-GRA100-2026-00001"));
    const dialog = await screen.findByRole("dialog");
    const box = await within(dialog).findByTestId("stock-take-reconciliation");
    expect(within(box).getByText("JV-0001")).toBeTruthy();
    expect(within(box).getByText("CLOSED")).toBeTruthy();
    expect(within(box).getByText("fscPeriodStatusAfter")).toBeTruthy();
    expect(within(box).getByText("fscNextProductionStart")).toBeTruthy();
    first.unmount();

    get.mockImplementation(detail(null));
    render(<FeedStockCountPanel />);
    fireEvent.click(await screen.findByText("ST-GRA100-2026-00001"));
    const box2 = await screen.findByTestId("stock-take-reconciliation");
    expect(within(box2).getAllByText("fsdNotAvailable").length).toBeGreaterThan(0);
  });

  it("counts a feed mill's bins: picking a mill reads evidence and lists as FEED_MILL", async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith("/location?")) return Promise.resolve({ data: [{ location_id: "mill-1", location_code: "MILL-001", location_name: "Mill" }] });
      if (url.startsWith("/feed-stock-count/evidence?")) return Promise.resolve({ data: { countedAt: "2026-09-26T07:30:00Z", pairs: [] } });
      return Promise.resolve({ data: [] });
    });
    render(<FeedStockCountPanel />);
    const picker = await screen.findByLabelText("fscCountAt");
    fireEvent.change(picker, { target: { value: "mill-1" } });
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).startsWith("/feed-stock-count?") && String(u).includes("farmId=mill-1"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "fscNew" }));
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).startsWith("/feed-stock-count/evidence?")
      && String(u).includes("farmId=mill-1") && String(u).includes("stockTakeType=FEED_MILL"))).toBe(true));
  });
});

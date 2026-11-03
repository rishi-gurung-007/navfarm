import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MillPlanPanel from "../src/components/console/inventory/mill-plan-panel";
import { api } from "../src/services/api-client";

// Mill Planning (spec 2026-11-03): filters, then Generate; nothing loads before it.
jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getStoredUser: () => ({ userId: "u1" }) }));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (value: string) => value }));
let planningDate = "2026-11-02";
jest.mock("../src/components/console/inventory/feed-forecast-context", () => ({ useFeedForecastContext: () => ({ planningDate }) }));
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({
  loadFeedFarms: jest.fn(async () => [
    { farmId: "farm-1", code: "F1", name: "Farm One", companyId: "co-1", companyName: null },
    { farmId: "farm-2", code: "F2", name: "Farm Two", companyId: "co-1", companyName: null },
    { farmId: "farm-3", code: "F3", name: "Farm Three", companyId: "co-2", companyName: null },
  ]),
}));

const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const zeros = () => dates.map(() => 0);
const plan = {
  dates,
  mill: { millId: "mill-1", millCode: "M1", millName: "Mill One", dailyKg: 10000 },
  mills: [
    { millId: "mill-1", millCode: "M1", millName: "Mill One", companyId: "co-1" },
    { millId: "mill-2", millCode: "M2", millName: "Mill Two", companyId: "co-2" },
  ],
  capacity: dates.map((date, i) => ({ date, productionKg: i === 1 ? 12000 : 0, capacityKg: i === 2 ? null : 10000, usedPct: i === 2 ? null : 0, status: i === 1 ? "OVER" : i === 2 ? "NO_CAPACITY" : "OK" })),
  cards: { totalKg: 1000, farms: 1, sheds: 1, silos: 1, feedTypes: 1, dietChanges: 1, daysNearOrOver: 1, silosRunningOut: 1 },
  production: [],
  dietChanges: [{ farmId: "farm-1", farmName: "Farm One", shedCode: "S1", batchNo: "B-1", changeDate: dates[3], fromItemName: "Starter", toItemName: "Grower", heads: 120 }],
  farms: [{
    farmId: "farm-1", code: "F1", name: "Farm One", totals: zeros(),
    sheds: [{ key: "S1|B-1", shedCode: "S1", batchNo: "B-1", heads: 120, items: [{ itemId: "i1", itemName: "Grower" }], changeDate: dates[3], kg: [313.5, 313.5, 313.5, 313.5, 313.5, 313.5, 313.5] }],
    silos: [
      { sourceCode: "SL-1", sourceName: "Silo 1", sourceType: "SILO", itemId: "i1", itemName: "Grower", openingKg: 5000, closingKg: [null, 3000, 1000, 0, 0, 0, 0], runOutDate: dates[3] },
      { sourceCode: "SL-1", sourceName: "Silo 1", sourceType: "SILO", itemId: "i2", itemName: "Starter", openingKg: 200, closingKg: [null, 200, 200, 200, 200, 200, 200], runOutDate: null },
    ],
  }],
  failedFarms: [{ farmId: "farm-2", code: "F2", name: "Farm Two", error: "No lifecycle" }],
};

function routeGets() {
  (api.get as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith("/feed-requisition/options")) return { data: { items: [{ item_id: "i1", item_code: "GRW", item_name: "Grower" }] } };
    if (url.startsWith("/feed-forecast/mill-plan")) return { data: plan };
    throw new Error(`unexpected ${url}`);
  });
}
const millPlanCalls = () => (api.get as jest.Mock).mock.calls.map(([url]) => url as string).filter((url) => url.startsWith("/feed-forecast/mill-plan"));

async function renderPanel() {
  routeGets();
  render(<MillPlanPanel />);
  await act(async () => undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  planningDate = "2026-11-02";
});

it("starts Week of on today when the forecast has no planning date yet", async () => {
  planningDate = "";
  await renderPanel();
  expect((screen.getByLabelText("mplWeekOf") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it("does not call the API until Generate is clicked", async () => {
  await renderPanel();
  expect(millPlanCalls()).toEqual([]);
  expect(screen.getByText("mplBeforeGenerate")).toBeTruthy();
});

it("sends weekOf, farmIds, itemIds and millId on Generate", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(millPlanCalls()).toEqual(["/feed-forecast/mill-plan?weekOf=2026-11-02"]);
  // Narrow the farms to one and generate again: the ids go on the query.
  fireEvent.click(screen.getByRole("button", { name: /mplFarms/ }));
  fireEvent.click(screen.getByRole("option", { name: "F2 — Farm Two" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(millPlanCalls()[1]).toBe("/feed-forecast/mill-plan?weekOf=2026-11-02&farmIds=farm-1&millId=mill-1");
});

it("does not refetch when a filter changes after Generate", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  fireEvent.change(screen.getByLabelText("mplWeekOf"), { target: { value: "2026-11-09" } });
  await act(async () => undefined);
  expect(millPlanCalls()).toHaveLength(1);
});

it("shows a day over capacity as OVER and one without capacity as not set", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(document.querySelector(`[data-capacity-day="${dates[1]}"]`)?.getAttribute("data-status")).toBe("OVER");
  expect(document.querySelector(`[data-capacity-day="${dates[2]}"]`)?.textContent).toContain("mplCapacityNotSet");
});

it("highlights the diet-change cell and the silo run-out cell", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(document.querySelector("[data-diet-change]")?.getAttribute("data-date")).toBe(dates[3]);
  expect(document.querySelector("[data-run-out]")?.getAttribute("data-date")).toBe(dates[3]);
});

it("lists a failed farm with its error", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(screen.getByText(/No lifecycle/)).toBeTruthy();
});

it("lists only the chosen mill's company's farms once a mill is known", async () => {
  await renderPanel();
  fireEvent.click(screen.getByRole("button", { name: /mplFarms/ }));
  expect(screen.getByRole("option", { name: "F3 — Farm Three" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /mplFarms/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  fireEvent.click(screen.getByRole("button", { name: /mplFarms/ }));
  expect(screen.queryByRole("option", { name: "F3 — Farm Three" })).toBeNull();
  expect(screen.getByRole("option", { name: "F1 — Farm One" })).toBeTruthy();
});

it("shows weights in KG, so a shed eating 313.5 kg a day reads 313.5", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(screen.getAllByText("313.5").length).toBe(7);
  expect(document.querySelector(`[data-capacity-day="${dates[1]}"]`)?.textContent).toContain("12,000");
});

it("keeps the Farm / Shed and Feed columns in view when the table scrolls sideways", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const firstCells = [...document.querySelectorAll("table tr")].map((row) => row.firstElementChild as HTMLElement);
  expect(firstCells.length).toBeGreaterThan(0);
  for (const cell of firstCells) expect(cell.className).toMatch(/\bsticky\b.*\bleft-0\b|\bleft-0\b.*\bsticky\b/);
});

it("gives each feed of a shared silo its own row without duplicate keys", async () => {
  const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  expect(errors.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
  errors.mockRestore();
});

it("picks farms in the same searchable list as every other select, ticking several", async () => {
  await renderPanel();
  fireEvent.click(screen.getByRole("button", { name: /mplFarms/ }));
  expect(screen.getByRole("listbox", { name: "mplFarms" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "mplAll" }).getAttribute("aria-selected")).toBe("true");
  // The search narrows the list like the custom select does.
  fireEvent.change(screen.getByRole("combobox", { name: "mplFarms" }), { target: { value: "two" } });
  expect(screen.queryByRole("option", { name: "F1 — Farm One" })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: "F2 — Farm Two" }));
  // The list stays open for the next pick, and the trigger names the one left.
  expect(screen.getByRole("listbox", { name: "mplFarms" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "mplFarms" }), { target: { value: "" } });
  expect(screen.getByRole("option", { name: "F2 — Farm Two" }).getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("option", { name: "F1 — Farm One" }).getAttribute("aria-selected")).toBe("true");
});

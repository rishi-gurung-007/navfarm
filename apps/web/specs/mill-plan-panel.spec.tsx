import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
    noFeedRows: [{ batchNo: "B-302", stageCode: "LACTATION", fromDay: 184, fromDate: dates[0] }],
    sheds: [{ key: "S1|B-1", shedCode: "S1", batchNo: "B-1", heads: 120, items: [{ itemId: "i1", itemName: "Grower" }], changeDate: dates[3], kg: [313.5, 313.5, 313.5, 313.5, 313.5, 313.5, 313.5] }],
    silos: [
      { sourceCode: "SL-1", sourceName: "Silo 1", sourceType: "SILO", itemId: "i1", itemName: "Grower", openingKg: 5000, closingKg: [null, 3000, 1000, 0, 0, 0, 0], runOutDate: dates[3] },
      { sourceCode: "SL-1", sourceName: "Silo 1", sourceType: "SILO", itemId: "i2", itemName: "Starter", openingKg: 200, closingKg: [null, 200, 200, 200, 200, 200, 200], runOutDate: null },
    ],
  }],
  siloCards: [
    { farmId: "farm-1", farmCode: "F1", farmName: "Farm One", sourceCode: "SL-1", sourceName: "Silo 1", items: ["Grower", "Starter"], stockKg: 4000, capacityKg: 10000, fillPct: 40, runOutDate: null },
    { farmId: "farm-1", farmCode: "F1", farmName: "Farm One", sourceCode: "SL-2", sourceName: "SL-2", items: ["Grower"], stockKg: 900, capacityKg: null, fillPct: null, runOutDate: dates[1] },
  ],
  failedFarms: [{ farmId: "farm-2", code: "F2", name: "Farm Two", error: "No lifecycle" }],
};

function routeGets(override: Record<string, unknown> = {}) {
  (api.get as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith("/feed-requisition/options")) return { data: { items: [{ item_id: "i1", item_code: "GRW", item_name: "Grower" }] } };
    if (url.startsWith("/feed-forecast/mill-plan")) return { data: { ...plan, ...override } };
    throw new Error(`unexpected ${url}`);
  });
}
const millPlanCalls = () => (api.get as jest.Mock).mock.calls.map(([url]) => url as string).filter((url) => url.startsWith("/feed-forecast/mill-plan"));

async function renderPanel(override: Record<string, unknown> = {}) {
  routeGets(override);
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
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplRegenerate" })); });
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

it("shows weights in tonnes, with the exact KG on hover", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const cells = screen.getAllByText("0.31");
  expect(cells.length).toBe(7);
  // The same hover card as the consolidation sheet, not the browser's plain tooltip.
  expect(cells[0].closest("[data-hint]")?.getAttribute("data-hint")).toBe("313.5 KG");
  expect(cells[0].closest("td")?.hasAttribute("title")).toBe(false);
  expect(document.querySelector(`[data-capacity-day="${dates[1]}"]`)?.textContent).toContain("12.00");
});

it("explains each section in an info hover instead of a unit in its title", async () => {
  await renderPanel({ production: [{ itemId: "i1", itemCode: "GRW", itemName: "Grower", feedForm: "BULK", totalKg: 3000,
    days: dates.map((date, i) => ({ date, approvedKg: i === 5 ? 3000 : 0, forecastKg: 0, totalKg: i === 5 ? 3000 : 0, capacity: null })) }] });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  for (const key of ["mplCapacityInfo", "mplProductionInfo", "mplGridInfo", "mplSiloLevelsInfo"]) {
    expect(document.querySelector(`[data-hint="${key}"]`)).toBeTruthy();
  }
});

it("keeps the Farm / Shed and Feed columns in view when the table scrolls sideways", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const firstCells = [...document.querySelectorAll("[data-mill-grid] table tr")].map((row) => row.firstElementChild as HTMLElement);
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

it("ends with a card per silo: stock against capacity on a bar", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const cards = [...document.querySelectorAll("[data-silo-card]")] as HTMLElement[];
  expect(cards.map((c) => c.getAttribute("data-silo-card"))).toEqual(["farm-1|SL-1", "farm-1|SL-2"]);
  const bar = within(cards[0]).getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("40");
  expect(cards[0].textContent).toContain("4.00");
  expect(cards[0].textContent).toContain("10.00");
  expect(within(cards[1]).queryByRole("progressbar")).toBeNull();
  expect(cards[1].textContent).toContain("mplCapacityNotSet");
  // A silo named by its code is not named twice.
  expect(cards[1].textContent).not.toContain("SL-2 · SL-2");
});

it("holds each farm row under the header on the page's own scroll, with no scroll area of its own to get stuck in", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const grid = document.querySelector("[data-mill-grid]") as HTMLElement;
  expect(grid.className).not.toMatch(/overflow-(auto|scroll|y-auto|x-auto)|max-h-/);
  const farmRow = grid.querySelector("[data-farm-row]") as HTMLElement;
  for (const cell of [...farmRow.children] as HTMLElement[]) {
    expect(cell.className).toMatch(/\bsticky\b/);
    expect(cell.style.top).toBe("var(--mpl-head)");
  }
});

it("puts Collapse All and Expand All beside the grid they fold", async () => {
  await renderPanel();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "mplGenerate" })); });
  const section = screen.getByRole("region", { name: "mplGrid" });
  expect(within(section).getByRole("button", { name: "mplCollapseAll" })).toBeTruthy();
  expect(within(section).getByRole("button", { name: "mplExpandAll" })).toBeTruthy();
});

const generate = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: /mpl(Re)?[Gg]enerate/ })); }); };

it("leaves out a section with nothing in it, heading and all", async () => {
  await renderPanel({ dietChanges: [] });
  await generate();
  expect(screen.queryByRole("region", { name: "mplProduction" })).toBeNull();
  expect(screen.queryByRole("region", { name: "mplDietChanges" })).toBeNull();
  expect(screen.queryByText("mplNoProduction")).toBeNull();
});

it("offers Regenerate once a filter differs from the plan on screen", async () => {
  await renderPanel();
  await generate();
  expect(screen.getByRole("button", { name: "mplGenerate" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("mplWeekOf"), { target: { value: "2026-11-09" } });
  expect(screen.getByRole("button", { name: "mplRegenerate" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("mplWeekOf"), { target: { value: "2026-11-02" } });
  expect(screen.getByRole("button", { name: "mplGenerate" })).toBeTruthy();
});

it("puts the day under the date in the grid headers", async () => {
  await renderPanel();
  await generate();
  const head = document.querySelector("[data-mill-grid] thead [data-day-head]") as HTMLElement;
  expect([...head.children].map((c) => c.textContent)).toEqual([dates[0], "Mon"]);
});

it("shows a silo's code and name on lines of their own", async () => {
  await renderPanel();
  await generate();
  const row = document.querySelector("[data-silo-row]") as HTMLElement;
  expect(row.querySelector("[data-silo-code]")?.textContent).toBe("SL-1");
  expect(row.querySelector("[data-silo-name]")?.textContent).toBe("Silo 1");
  const card = document.querySelector("[data-silo-card]") as HTMLElement;
  expect(card.querySelector("[data-silo-code]")?.textContent).toBe("SL-1");
  expect(card.querySelector("[data-silo-name]")?.textContent).toBe("Silo 1");
});

it("says on the farm row why a batch eats nothing: no lifecycle feed row", async () => {
  await renderPanel();
  await generate();
  const farmRow = document.querySelector("[data-farm-row]") as HTMLElement;
  const note = farmRow.querySelector("[data-no-feed-rows]") as HTMLElement;
  expect(note.textContent).toContain("mplNoFeedRows");
  expect(note.closest("[data-hint]")?.getAttribute("data-hint")).toContain("B-302");
});

it("scrolls in an area that reaches the window's edge, so its scrollbar sits on the screen border", async () => {
  await renderPanel();
  const root = document.querySelector("[data-fill-body]") as HTMLElement;
  expect(root.className).toMatch(/lg:-mr-7/);
  expect(root.className).toMatch(/lg:pr-7/);
});

it("lists the batches with no feed row one per line in the hover card", async () => {
  await renderPanel();
  await generate();
  const note = document.querySelector("[data-no-feed-rows]") as HTMLElement;
  fireEvent.mouseEnter(note.closest("[data-hint]") as HTMLElement);
  const card = screen.getByRole("tooltip");
  expect(within(card).getByText("mplNoFeedRowsTitle")).toBeTruthy();
  const items = within(card).getAllByRole("listitem");
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain("B-302");
});

it("lists feed type changes in aligned columns, one row per batch", async () => {
  await renderPanel();
  await generate();
  const section = screen.getByRole("region", { name: "mplDietChanges" });
  const table = within(section).getByRole("table");
  expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["mplColDate", "mplColFarmShed", "mplColBatch", "mplColFeedChange", "mplColHead"]);
  const cells = within(table).getAllByRole("row")[1].querySelectorAll("td");
  expect([...cells].map((c) => c.textContent)).toEqual([`${dates[3]}Thu`, "Farm One / S1", "B-1", "Starter→Grower", "120"]);
});

it("shows each section's ⓘ as a heading with one bullet per point", async () => {
  await renderPanel();
  await generate();
  const icon = document.querySelector('[data-hint="mplGridInfo"]') as HTMLElement;
  fireEvent.mouseEnter(icon);
  const card = screen.getByRole("tooltip");
  expect(within(card).getByText("mplGrid")).toBeTruthy();
  expect(within(card).getAllByRole("listitem").length).toBeGreaterThan(0);
});

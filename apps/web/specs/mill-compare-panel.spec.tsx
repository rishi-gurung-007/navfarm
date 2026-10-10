import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MillComparePanel from "../src/components/console/inventory/mill-compare-panel";
import { FeedForecastProvider } from "../src/components/console/inventory/feed-forecast-context";
import { api } from "../src/services/api-client";
import { downloadCsvFile } from "../src/modules/master-data/utils/master-csv";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({ useFeedFarm: () => ({
  farmId: "farm-1", setFarmId: jest.fn(), farms: [{ farmId: "farm-1", code: "MUL100", name: "Mulberry", companyId: "co-1" }],
  loaded: true, failed: false, isFixed: false, fixedFarm: null,
}) }));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (value: string) => value }));
jest.mock("../src/modules/master-data/utils/master-csv", () => ({
  ...jest.requireActual("../src/modules/master-data/utils/master-csv"),
  downloadCsvFile: jest.fn(),
}));

const report = {
  mills: [{ millId: "mill-1", millCode: "MILL-001", millName: "Main Mill" }],
  report: {
    mill: { millId: "mill-1", millCode: "MILL-001", dailyKg: 200000, bulkKg: 150000, baggedKg: 50000 },
    from: "2026-10-05", to: "2026-10-11",
    rows: [
      { productionDate: "2026-10-11", itemId: "i8", itemCode: "ICAT-004-ITM-0008", itemName: "Weaner Grower Mash", dietNo: 8, farmCount: 1,
        requestedKg: 6050, millApprovedKg: 6000, availableKg: 150000, state: "AVAILABLE", status: "GREEN", priority: 1, binCode: "MILL-001/BIN-001", feedForm: "BULK" },
      { productionDate: "2026-10-11", itemId: "i3", itemCode: "ICAT-004-ITM-0003", itemName: "Lactation", dietNo: 3, farmCount: 1,
        requestedKg: 2000, millApprovedKg: null, availableKg: null, state: "NOT_SCHEDULED", status: null, priority: null, binCode: null, feedForm: null },
    ],
    total: { requestedKg: 8050, millApprovedKg: 6000, capacityKg: 1400000, status: "GREEN" },
  },
};

it("shows all farms' requested KG, mill-approved KG and Mill Capacity Available per diet with a total row (Feed Forecast r11)", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: report });
  render(<FeedForecastProvider><MillComparePanel /></FeedForecastProvider>);
  expect(screen.getByText("mcrPrompt")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("mcrDate"), { target: { value: "2026-10-11" } });
  fireEvent.click(screen.getByRole("button", { name: "mcrLoad" }));
  const table = await screen.findByRole("table", { name: "mcrTableLabel" });
  expect(api.get).toHaveBeenCalledWith("/feed-forecast/mill-compare?date=2026-10-11&period=WEEK");
  const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
  expect(rows).toEqual([
    ["2026-10-11", "1", "8", "ICAT-004-ITM-0008", "Weaner Grower Mash", "MILL-001/BIN-001", "1", "6,050", "6,000", "150,000", "millCapGreen"],
    ["2026-10-11", "millCapNotScheduled", "3", "ICAT-004-ITM-0003", "Lactation", "millCapNotScheduled", "1", "2,000", "mcrNotConsolidated", "millCapNotScheduled", "millCapNoStatus"],
    ["mcrTotal", "8,050", "6,000", "1,400,000", "millCapGreen"],
  ]);

  fireEvent.click(screen.getByRole("button", { name: "mcrExport" }));
  const [name, csv] = (downloadCsvFile as jest.Mock).mock.calls[0];
  expect(name).toBe("compare-report-MILL-001-2026-10-05-2026-10-11");
  expect(csv.split("\n")[1]).toBe("2026-10-11,1,8,ICAT-004-ITM-0008,Weaner Grower Mash,MILL-001/BIN-001,BULK,1,6050,6000,150000,GREEN");
  expect(csv.split("\n")[3]).toBe("mcrTotal,,,,,,,,8050,6000,1400000,GREEN");
});

it("says no MILL is set up instead of showing zero capacity", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { mills: [], report: null } });
  render(<FeedForecastProvider><MillComparePanel /></FeedForecastProvider>);
  fireEvent.change(screen.getByLabelText("mcrDate"), { target: { value: "2026-10-11" } });
  fireEvent.click(screen.getByRole("button", { name: "mcrLoad" }));
  expect(await screen.findByText("mcrNoMill")).toBeTruthy();
});

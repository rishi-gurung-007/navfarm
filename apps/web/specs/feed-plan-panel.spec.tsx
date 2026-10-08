import React from "react";
import { render, screen, within } from "@testing-library/react";
import FeedPlanPanel from "../src/components/console/inventory/feed-plan-panel";
import { FeedForecastProvider } from "../src/components/console/inventory/feed-forecast-context";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({ useFeedFarm: () => ({
  farmId: "farm-1", setFarmId: jest.fn(), farms: [{ farmId: "farm-1", code: "GRA100", name: "Grasmere", companyId: "co-1" }],
  loaded: true, failed: false, isFixed: false, fixedFarm: null,
}) }));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (value: string) => value }));

it("shows the saved plan quantities and human text for unavailable capacity", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { run: { runId: "run-1" }, rows: [{
    farm: { id: "farm-1", code: "GRA100", name: "Grasmere" }, period: "2026-10-12",
    item: { id: "item-1", code: "FD-01", name: "Grower" }, tentativeKg: 6000, approvedRequisitionKg: 7200,
    shippedKg: 4000, receivedKg: 2500, remainingKg: 4700, varianceKg: 1200, capacityKg: null,
  }] } });
  render(<FeedForecastProvider><FeedPlanPanel /></FeedForecastProvider>);
  const table = await screen.findByRole("table", { name: "feedPlanTableLabel" });
  const cells = within(table).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells).toEqual(["GRA100", "2026-10-12", "FD-01", "Grower", "6,000", "7,200", "4,000", "2,500", "4,700", "1,200", "feedPlanUnavailable"]);
  expect(cells).not.toContain("-");
  expect(cells).not.toContain("NaN");
});

it("shows the saved-calculation empty state when no plan exists", async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { run: null, rows: [] } });
  render(<FeedForecastProvider><FeedPlanPanel /></FeedForecastProvider>);
  expect(await screen.findByText("feedPlanEmpty")).toBeTruthy();
});

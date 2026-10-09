import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import FeedPlanPanel from "../src/components/console/inventory/feed-plan-panel";
import { FeedForecastProvider } from "../src/components/console/inventory/feed-forecast-context";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
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

it("distinguishes a saved calculation with no feed order from no saved calculation", async () => {
  (api.get as jest.Mock).mockResolvedValue({
    data: {
      run: { runId: "run-1", runCode: "RUN-VIL100-20261008-001", from: "2026-10-08", to: "2026-10-25" },
      rows: [],
    },
  });
  render(<FeedForecastProvider><FeedPlanPanel /></FeedForecastProvider>);
  expect(await screen.findByText("feedPlanNoOrder")).toBeTruthy();
  expect(screen.queryByText("feedPlanEmpty")).toBeNull();
});

it("generates and opens retained feed plan versions with a dialog header and footer", async () => {
  (api.get as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes("/versions/plan-1")) return { data: {
      plan_id: "plan-1", plan_code: "PLAN-GRA100-202642-R01", plan_type: "TENTATIVE", production_date: "2026-10-16",
      source_from: "2026-09-09", source_to: "2026-10-13", lines: [{
        plan_line_id: "line-1", item_code: "FD-01", item_name: "Grower", projected_target_kg: "7000",
        adjustment_factor: "1.1", tentative_qty_kg: "7700", requested_qty_kg: null,
        mill_approved_qty_kg: null, variance_qty_kg: "0", history_snapshot: [],
      }],
    } };
    if (url.includes("/versions?")) return { data: [{
      plan_id: "plan-1", plan_code: "PLAN-GRA100-202642-R01", plan_type: "TENTATIVE", production_date: "2026-10-16",
      plan_week: "202642", version: 1, source_from: "2026-09-09", source_to: "2026-10-13",
    }] };
    return { data: { run: { runId: "run-1" }, rows: [] } };
  });
  (api.post as jest.Mock).mockResolvedValue({ data: { planId: "plan-1" } });
  render(<FeedForecastProvider><FeedPlanPanel /></FeedForecastProvider>);

  const versionButton = await screen.findByRole("button", { name: /PLAN-GRA100-202642-R01/ });
  fireEvent.change(screen.getByLabelText("feedPlanProductionDate"), { target: { value: "2026-10-16" } });
  fireEvent.click(screen.getByRole("button", { name: "feedPlanGenerate" }));
  expect(api.post).toHaveBeenCalledWith("/feed-forecast/feed-plan/versions", { farmId: "farm-1", productionDate: "2026-10-16" });

  fireEvent.click(versionButton);
  const dialog = await screen.findByRole("dialog", { name: "PLAN-GRA100-202642-R01" });
  expect(within(dialog).getByRole("table", { name: "feedPlanVersionLines" })).toBeTruthy();
  expect(within(dialog.querySelector("footer") as HTMLElement).getByRole("button", { name: "close" })).toBeTruthy();
});

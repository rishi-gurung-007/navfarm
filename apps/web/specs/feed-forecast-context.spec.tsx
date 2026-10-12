import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { api } from "../src/services/api-client";
import {
  FeedForecastProvider,
  useFeedForecastContext,
} from "../src/components/console/inventory/feed-forecast-context";
import { resetFeedFarmCache } from "../src/components/console/inventory/use-feed-farm";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn() } }));
jest.mock("../src/hooks/useAuth", () => ({
  getActiveCompanyId: jest.fn(() => "company-1"),
  getActiveFarmId: jest.fn(() => null),
  getActiveWorkspaceScope: jest.fn(() => "COMPANY"),
  getStoredUser: jest.fn(() => ({ userId: "user-1", userType: "COMPANY_ADMIN" })),
}));

const get = api.get as jest.Mock;

function ContextProbe({ name }: { name: string }) {
  const context = useFeedForecastContext();
  return (
    <section aria-label={name}>
      <output data-testid={`${name}-farm`}>{context.farmId ?? ""}</output>
      <output data-testid={`${name}-view`}>{context.view}</output>
      <output data-testid={`${name}-planning`}>{context.planningDate}</output>
      <output data-testid={`${name}-from`}>{context.from}</output>
      <output data-testid={`${name}-to`}>{context.to}</output>
      <button
        type="button"
        onClick={() => context.hydrateWindow({
          planningDate: "2026-10-05",
          view: "CUSTOM",
          from: "2026-10-05",
          to: "2026-10-11",
          periodId: "",
        })}
      >
        hydrate
      </button>
      <button type="button" onClick={() => context.setView("WEEKLY")}>weekly</button>
    </section>
  );
}

function SwitchingConsumer() {
  const [dashboard, setDashboard] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setDashboard((value) => !value)}>switch</button>
      {dashboard ? <ContextProbe name="dashboard" /> : <ContextProbe name="calculation" />}
    </>
  );
}

describe("FeedForecastProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    resetFeedFarmCache();
    get.mockReset().mockResolvedValue({
      success: true,
      data: [
        { farmId: "farm-2", code: "ZZZ", name: "Later", companyId: "company-1", companyName: "Triple C" },
        { farmId: "farm-1", code: "AAA", name: "First", companyId: "company-1", companyName: "Triple C" },
      ],
    });
  });

  it("loads farms once for every Dashboard/Calculation consumer and selects the first farm by code", async () => {
    render(
      <FeedForecastProvider>
        <ContextProbe name="dashboard" />
        <ContextProbe name="calculation" />
      </FeedForecastProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-farm").textContent).toBe("farm-1"));
    expect(screen.getByTestId("calculation-farm").textContent).toBe("farm-1");
    expect(get.mock.calls.filter(([url]) => url === "/feed-forecast/farms")).toHaveLength(1);
  });

  it("defaults to Custom and hydrates the exact seven Farm-local dates returned by the API", async () => {
    render(<FeedForecastProvider><ContextProbe name="dashboard" /></FeedForecastProvider>);
    await waitFor(() => expect(screen.getByTestId("dashboard-farm").textContent).toBe("farm-1"));

    expect(screen.getByTestId("dashboard-view").textContent).toBe("CUSTOM");
    expect(screen.getByTestId("dashboard-planning").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "hydrate" }));
    expect(screen.getByTestId("dashboard-planning").textContent).toBe("2026-10-05");
    expect(screen.getByTestId("dashboard-from").textContent).toBe("2026-10-05");
    expect(screen.getByTestId("dashboard-to").textContent).toBe("2026-10-11");
  });

  it("retains the shared window when the visible consumer changes", async () => {
    render(<FeedForecastProvider><SwitchingConsumer /></FeedForecastProvider>);
    await waitFor(() => expect(screen.getByTestId("dashboard-farm").textContent).toBe("farm-1"));
    fireEvent.click(screen.getByRole("button", { name: "hydrate" }));
    fireEvent.click(screen.getByRole("button", { name: "weekly" }));
    fireEvent.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByTestId("calculation-view").textContent).toBe("WEEKLY");
    expect(screen.getByTestId("calculation-from").textContent).toBe("2026-10-05");
    expect(screen.getByTestId("calculation-to").textContent).toBe("2026-10-11");
  });
});

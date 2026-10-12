import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import type { MasterDataConfig } from "@/modules/master-data/types";
import { getConfig } from "@/modules/master-data/configs";
import { LanguageProvider } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";

jest.mock("@/services/api-client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/useAuth", () => ({
  getActiveCompanyId: () => null,
  getActiveWorkspaceScope: () => "TENANT",
  getActiveOperationalAreaId: () => null,
  getActiveOperationalArea: () => null,
  getStoredUser: () => ({ userType: "TENANT_ADMIN" }),
  hasPermission: () => true,
}));
jest.mock("@/hooks/useMediaQuery", () => ({ useIsDesktop: () => true }));

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

const real = getConfig("breed-lifecycle-stage")!;
const config: MasterDataConfig = {
  key: "test-kpi",
  label: "Test Lifecycles",
  singular: "Test Lifecycle",
  apiBase: "/test-lifecycles",
  idKey: "lifecycle_id",
  group: "Test",
  columns: [{ key: "lifecycle_code", label: "Code" }],
  fields: [
    { key: "lifecycle_code", label: "Code", type: "text" },
    real.fields.find((f) => f.key === "kpi_thresholds")!,
    real.fields.find((f) => f.key === "kpi_alert_period")!,
  ],
};

describe("Breed Lifecycle Stage KPIs & Alerts dialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation(() => Promise.resolve([]));
    (api.post as jest.Mock).mockResolvedValue({});
  });

  it("keeps KPIs & Alerts out of the form, opens it stacked from the header, and saves its values with the record", async () => {
    render(<LanguageProvider><MasterDataTable config={config} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Add Test Lifecycle" }));
    const record = await screen.findByRole("dialog", { name: "Add Test Lifecycle" });

    // Not in the form grid; only reachable from the header button.
    expect(within(record).queryByText("Alert Severity")).toBeNull();
    const open = await screen.findByRole("button", { name: "KPIs & Alerts" });
    fireEvent.click(open);
    const stacked = await screen.findByRole("dialog", { name: "KPIs & Alerts" });
    expect(screen.getByRole("dialog", { name: "Add Test Lifecycle" })).toBeTruthy();

    fireEvent.click(within(stacked).getByRole("button", { name: "Add" }));
    // Column order, left to right.
    const labels = ["KPI", "UOM", "Lower Limit", "Upper Limit", "Average Value", "Alert Severity"];
    const found = Array.from(stacked.querySelectorAll("label")).map((l) => l.textContent?.replace("*", "").trim()).filter((t) => labels.includes(t as string));
    expect(found).toEqual(labels);

    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "Lower Limit" }), { target: { value: "400" } });
    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "Upper Limit" }), { target: { value: "600" } });
    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "Average Value" }), { target: { value: "500" } });
    fireEvent.click(within(stacked).getByRole("button", { name: "KPI period" }));
    fireEvent.click(screen.getByRole("option", { name: "Weekly" }));

    fireEvent.click(within(stacked).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "KPIs & Alerts" })).toBeNull());
    expect(screen.getByRole("button", { name: "KPIs & Alerts (1)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = (api.post as jest.Mock).mock.calls[0][1];
    expect(payload.kpi_alert_period).toBe("WEEKLY");
    expect(payload.kpi_thresholds[0]).toMatchObject({ lower_limit: 400, upper_limit: 600, average_value: 500 });
  });
});

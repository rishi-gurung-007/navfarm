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
    const labels = ["KPI Item", "UOM", "KPI Period", "From (day)", "To (day)", "Average Value", "Tolerance (%)", "Tolerance Type", "Alert Severity"];
    const found = Array.from(stacked.querySelectorAll("label")).map((l) => l.textContent?.replace("*", "").trim()).filter((t) => labels.includes(t as string));
    expect(found).toEqual(labels);

    // One row container holds every cell and the Remove button; it does not wrap.
    const rowEl = stacked.querySelector("[data-testid='json-row-single']") as HTMLElement;
    expect(rowEl.className).toContain("flex-nowrap");
    expect(rowEl.className).toContain("overflow-x-auto");
    expect(rowEl.querySelectorAll("label").length).toBe(labels.length);
    expect(within(rowEl).getByRole("button", { name: "Remove" })).toBeTruthy();

    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "From (day)" }), { target: { value: "3" } });
    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "To (day)" }), { target: { value: "9" } });
    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "Average Value" }), { target: { value: "500" } });
    fireEvent.click(within(stacked).getByRole("button", { name: "KPI period" }));
    fireEvent.click(screen.getAllByRole("option", { name: "Weekly" }).find((o) => !o.closest("select"))!);

    // The line period is display only and equals the header.
    const linePeriod = stacked.querySelector("input[id$='-kpi_period']") as HTMLInputElement;
    expect(linePeriod.readOnly).toBe(true);
    expect(linePeriod.value).toBe("Weekly");
    expect(stacked.querySelector("select[id$='-kpi_period']")).toBeNull();
    fireEvent.change(within(stacked).getByRole("spinbutton", { name: "Tolerance (%)" }), { target: { value: "5" } });
    fireEvent.change(stacked.querySelector("select[id$='-tolerance_type']") as HTMLSelectElement, { target: { value: "UPPER" } });

    fireEvent.click(within(stacked).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "KPIs & Alerts" })).toBeNull());
    expect(screen.getByRole("button", { name: "KPIs & Alerts (1)" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = (api.post as jest.Mock).mock.calls[0][1];
    expect(payload.kpi_alert_period).toBe("WEEKLY");
    expect(payload.kpi_thresholds[0]).toMatchObject({ from_day: 3, to_day: 9, average_value: 500, tolerance_pct: 5, tolerance_type: "UPPER", kpi_period: "WEEKLY" });
  });

  it("offers Daily and Weekly only for the header period", async () => {
    render(<LanguageProvider><MasterDataTable config={config} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Add Test Lifecycle" }));
    fireEvent.click(await screen.findByRole("button", { name: "KPIs & Alerts" }));
    const stacked = await screen.findByRole("dialog", { name: "KPIs & Alerts" });
    fireEvent.click(within(stacked).getByRole("button", { name: "KPI period" }));
    expect(screen.getAllByRole("option", { name: "Weekly" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: "Daily" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("option", { name: "Monthly" })).toHaveLength(0);
  });

  it("every line follows the header period, including after a header change and when added later", async () => {
    render(<LanguageProvider><MasterDataTable config={config} /></LanguageProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Add Test Lifecycle" }));
    fireEvent.click(await screen.findByRole("button", { name: "KPIs & Alerts" }));
    const stacked = await screen.findByRole("dialog", { name: "KPIs & Alerts" });
    const pickHeader = (label: string) => {
      fireEvent.click(within(stacked).getByRole("button", { name: "KPI period" }));
      fireEvent.click(screen.getAllByRole("option", { name: label }).find((o) => !o.closest("select"))!);
    };
    const periods = () => Array.from(stacked.querySelectorAll("input[id$='-kpi_period']")).map((s) => (s as HTMLInputElement).value);

    pickHeader("Daily");
    fireEvent.click(within(stacked).getByRole("button", { name: "Add" }));
    fireEvent.click(within(stacked).getByRole("button", { name: "Add more" }));
    expect(periods()).toEqual(["Daily", "Daily"]);
    pickHeader("Weekly");
    expect(periods()).toEqual(["Weekly", "Weekly"]);
    fireEvent.click(within(stacked).getByRole("button", { name: "Add more" }));
    expect(periods()).toEqual(["Weekly", "Weekly", "Weekly"]);

    fireEvent.click(within(stacked).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "KPIs & Alerts" })).toBeNull());
    fireEvent.change(await screen.findByRole("textbox", { name: /Code/ }), { target: { value: "X1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const lines = (api.post as jest.Mock).mock.calls[0][1].kpi_thresholds;
    expect(lines.map((l: any) => l.kpi_period)).toEqual(["WEEKLY", "WEEKLY", "WEEKLY"]);
  });
});

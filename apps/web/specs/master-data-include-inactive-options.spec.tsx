import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import type { MasterDataConfig } from "@/modules/master-data/types";
import { LanguageProvider } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";

jest.mock("@/services/api-client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("@/hooks/useAuth", () => ({
  getActiveCompanyId: () => null,
  getActiveWorkspaceScope: () => "TENANT",
  getActiveOperationalAreaId: () => null,
  getStoredUser: () => ({ userType: "TENANT_ADMIN" }),
  hasPermission: () => true,
}));

jest.mock("@/hooks/useMediaQuery", () => ({ useIsDesktop: () => true }));

/** Two pickers on the same endpoint; only "Any Period" opts in to inactive rows. */
const config: MasterDataConfig = {
  key: "test-line",
  label: "Test Lines",
  singular: "Test Line",
  apiBase: "/test-line",
  idKey: "line_id",
  group: "Test",
  fields: [
    {
      key: "any_period_id", label: "Any Period", type: "select-entity",
      entityEndpoint: "/test-period", entityValueKey: "period_id",
      entityLabelKeys: ["period_code"], entityIncludeInactive: true,
    },
    {
      key: "open_period_id", label: "Open Period", type: "select-entity",
      entityEndpoint: "/test-period", entityValueKey: "period_id",
      entityLabelKeys: ["period_code"],
    },
  ],
};

const PERIODS = [
  { period_id: "p1", period_code: "2024-07", is_active: true },
  { period_id: "p2", period_code: "2024-08", is_active: false },
];

const calls = () => (api.get as jest.Mock).mock.calls.map(([url]) => String(url));

describe("select-entity options and entityIncludeInactive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A server that, like the reporting-period API, filters only when isActive is asked for.
    (api.get as jest.Mock).mockImplementation(async (url: string) =>
      url.startsWith("/test-period")
        ? PERIODS.filter((r) => !url.includes("isActive=true") || r.is_active)
        : [],
    );
  });

  it("an opted-in field asks without isActive and offers the inactive row; the other keeps active-only", async () => {
    render(React.createElement(LanguageProvider, null, React.createElement(MasterDataTable, { config })));
    fireEvent.click(await screen.findByRole("button", { name: /Add Test Line/i }));

    await waitFor(() => {
      const periodCalls = calls().filter((u) => u.startsWith("/test-period"));
      expect(periodCalls.some((u) => !u.includes("isActive"))).toBe(true);
      expect(periodCalls.some((u) => u.includes("isActive=true"))).toBe(true);
    });

    fireEvent.click(await screen.findByRole("button", { name: "Any Period" }));
    expect(await screen.findByRole("option", { name: "2024-08" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "2024-07" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Open Period" }));
    expect(await screen.findByRole("option", { name: "2024-07" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "2024-08" })).toBeNull();
  });
});

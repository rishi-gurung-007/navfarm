import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import { BUDGET_CONFIGS } from "@/modules/master-data/budget-configs";
import { linkColumnFilters } from "@/modules/master-data/link-filters";
import type { MasterDataConfig } from "@/modules/master-data/types";
import { LanguageProvider } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";

let mockQuery = "";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

jest.mock("@/services/api-client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("@/hooks/useAuth", () => ({
  getActiveCompanyId: () => null,
  getActiveWorkspaceScope: () => "COMPANY",
  getActiveOperationalAreaId: () => null,
  getStoredUser: () => ({ userType: "TENANT_ADMIN" }),
  hasPermission: () => true,
}));

jest.mock("@/hooks/useMediaQuery", () => ({ useIsDesktop: () => true }));

const budget = BUDGET_CONFIGS[0];

/** What gm-drill-links' budgetHref sends, plus a key the Budget list has no column for. */
const LINK = new URLSearchParams({
  "filter[period_code]": "2026-10",
  "filter[farm_name]": "Kalimati Farm & Co",
  "filter[metric_label]": "Gross Margin %",
  "filter[nope]": "x",
}).toString();

/** Another master sharing a column key with the link. */
const other: MasterDataConfig = {
  key: "test-line", label: "Test Lines", singular: "Test Line", apiBase: "/test-line",
  idKey: "line_id", group: "Test",
  columns: [{ key: "farm_name", label: "Farm" }],
  fields: [{ key: "farm_name", label: "Farm", type: "text" }],
};

const listCalls = (base: string) =>
  (api.get as jest.Mock).mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.startsWith(`${base}?`));

const filtersOf = (url: string) =>
  Object.fromEntries(
    [...new URLSearchParams(url.split("?")[1])].filter(([k]) => k.startsWith("filter[")),
  );

const EXPECTED = {
  "filter[period_code]": "2026-10",
  "filter[farm_name]": "Kalimati Farm & Co",
  "filter[metric_label]": "Gross Margin %",
};

const table = (config: MasterDataConfig) => (
  <LanguageProvider>
    <MasterDataTable config={config} />
  </LanguageProvider>
);

/** Mounting asks for the list twice: the load effect, then again after the per-master reset. */
const mounted = async (base: string) => {
  await waitFor(() => expect(listCalls(base)).toHaveLength(2));
  await settle();
  expect(listCalls(base)).toHaveLength(2);
};

/** Lets the mount effects and the requests they start finish. */
const settle = () => waitFor(() => expect(screen.queryAllByRole("status")).toHaveLength(0));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = LINK;
  (api.get as jest.Mock).mockImplementation(async () => []);
});

describe("linkColumnFilters", () => {
  it("keeps only filter[<key>] entries for the master's columns, with a value", () => {
    const params = new URLSearchParams(`${LINK}&farmId=f1&amount=5&filter[tolerance_pct]=`);
    expect(linkColumnFilters(params, budget)).toEqual({
      period_code: "2026-10",
      farm_name: "Kalimati Farm & Co",
      metric_label: "Gross Margin %",
    });
  });
});

describe("a master opened from a link with column filters", () => {
  it("sends them, decoded, on both mount requests; an unknown one is not sent", async () => {
    render(table(budget));
    await mounted("/piggery/budget");
    for (const url of listCalls("/piggery/budget")) expect(filtersOf(url)).toEqual(EXPECTED);
  });

  it("shows them in the filter drawer, and Reset removes them from the next request", async () => {
    render(table(budget));
    await settle();
    fireEvent.click(screen.getAllByRole("button", { name: /Filters/ })[0]);

    const input = (key: string) =>
      document.getElementById(`master-budget-filter-${key}`) as HTMLInputElement;
    expect(input("period_code").value).toBe("2026-10");
    expect(input("farm_name").value).toBe("Kalimati Farm & Co");
    expect(input("metric_label").value).toBe("Gross Margin %");

    const before = listCalls("/piggery/budget").length;
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(listCalls("/piggery/budget").length).toBeGreaterThan(before));
    expect(filtersOf(listCalls("/piggery/budget").at(-1) as string)).toEqual({});
    expect(input("farm_name").value).toBe("");
  });

  it("does not carry them to a master switched to in the same table", async () => {
    const view = render(table(budget));
    await settle();
    view.rerender(table(other));
    await waitFor(() => expect(listCalls("/test-line").length).toBeGreaterThan(0));
    await settle();
    expect(filtersOf(listCalls("/test-line").at(-1) as string)).toEqual({});
  });

  it("does not bring them back after switching away and back in the same table", async () => {
    const view = render(table(budget));
    await mounted("/piggery/budget");
    view.rerender(table(other));
    await waitFor(() => expect(listCalls("/test-line").length).toBeGreaterThan(0));
    await settle();
    view.rerender(table(budget));
    await waitFor(() => expect(listCalls("/piggery/budget").length).toBeGreaterThan(2));
    await settle();
    for (const url of listCalls("/piggery/budget").slice(2)) expect(filtersOf(url)).toEqual({});
  });

  it("opens unfiltered without parameters, with the same two mount requests", async () => {
    mockQuery = "";
    render(table(budget));
    await mounted("/piggery/budget");
    for (const url of listCalls("/piggery/budget")) expect(filtersOf(url)).toEqual({});
  });
});

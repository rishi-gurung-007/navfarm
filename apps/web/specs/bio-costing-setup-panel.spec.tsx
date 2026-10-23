/**
 * Finance > Bio-Asset Costing Setup: the company's residual value (set per sex and from a date, never edited) and the costing profiles.
 * The screen sends what the user typed and shows what the API answers; the rules and checks are the API's.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BioCostingSetupPanel from "../src/components/console/finance/bio-costing-setup-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.code ? `${key}:${vars.code}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1", getStoredUser: () => ({ userType: "TENANT_ADMIN" }), hasPermission: () => true }));
jest.mock("../src/components/ui/toast", () => ({ Toast: ({ message }: { message?: string }) => (message ? <div role="alert">{message}</div> : null) }));
jest.mock("../src/components/ui/dialog", () => ({
  Dialog: ({ open, children, footer, title }: { open: boolean; children: React.ReactNode; footer?: React.ReactNode; title?: string }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));

const settings = [
  { setting_id: "s1", gender: "F", residual_rule: "WEIGHT_X_PRICE", residual_weight_kg: "150.000", residual_price_per_kg: "2.050000", residual_value: 307.5, effective_from: "2026-01-01", note: "client sheet" },
  { setting_id: "s2", gender: "M", residual_rule: "NONE", residual_value: 0, effective_from: "2026-01-01", note: null },
];
const profiles = [
  { profile_id: "p1", profile_code: "IMP-F", name: "Imported female", origin: "IMPORTED", gender: "F", costing_method: "AMORTIZATION", start_age_weeks: 33, useful_life_months: 36, run_frequency: "MONTHLY", status: "ACTIVE", auto_post: false },
  { profile_id: "p2", profile_code: "DRAFT-1", name: "Draft", origin: "LOCAL", gender: "M", costing_method: "AMORTIZATION", start_age_weeks: 26, useful_life_months: 18, run_frequency: "MONTHLY", status: "DRAFT", auto_post: false },
];

describe("BioCostingSetupPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation(async (url: string) => ({ data: url.includes("residual-settings") ? settings : profiles }));
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    (api.put as jest.Mock).mockResolvedValue({ data: {} });
  });

  it("lists the company residual with what each works out to, and the profiles with their terms", async () => {
    render(<BioCostingSetupPanel />);
    expect(await screen.findByText("150 kg × 2.05")).toBeTruthy();
    expect(screen.getByText("307.50")).toBeTruthy();
    expect(screen.getByText("bcsRuleNone")).toBeTruthy();
    const profilesTable = screen.getByText("IMP-F").closest("table")!;
    expect(within(profilesTable).getByText("33")).toBeTruthy();
    expect(within(profilesTable).getByText("36")).toBeTruthy();
  });

  it("adds a residual from a date by sending the weight and the price, not an edit of an old row", async () => {
    render(<BioCostingSetupPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /bcsResidualAdd/ }));
    fireEvent.change(screen.getByLabelText("bcsWeight"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("bcsPrice"), { target: { value: "2.2" } });
    fireEvent.change(screen.getByLabelText("bcsEffectiveFrom"), { target: { value: "2026-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "bcsSave" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/residual-settings", { gender: "F", residual_rule: "WEIGHT_X_PRICE", effective_from: "2026-11-01", residual_weight_kg: 150, residual_price_per_kg: 2.2 }));
    expect(await screen.findByText("bcsResidualSaved")).toBeTruthy();
  });

  it("shows the API's refusal of a residual it cannot work out", async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error("A weight-times-price residual needs a weight and a price per kg, both above 0."));
    render(<BioCostingSetupPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /bcsResidualAdd/ }));
    fireEvent.click(screen.getByRole("button", { name: "bcsSave" }));
    expect(await screen.findByText(/needs a weight and a price/)).toBeTruthy();
  });

  it("renames a profile and sets auto-post through an edit, and makes a new version from a date", async () => {
    render(<BioCostingSetupPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "bcsEdit IMP-F" }));
    fireEvent.change(screen.getByLabelText("bcsName"), { target: { value: "Imported female (all classes)" } });
    fireEvent.click(screen.getByLabelText("bcsAutoPost"));
    fireEvent.click(screen.getByRole("button", { name: "bcsSave" }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/bio-costing/profiles/p1", { name: "Imported female (all classes)", auto_post: true }));

    fireEvent.click(await screen.findByRole("button", { name: "bcsNewVersion IMP-F" }));
    fireEvent.change(screen.getByLabelText("bcsEffectiveFrom"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("bcsLifeMonths"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "bcsSave" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/profiles/p1/new-version", { effective_from: "2027-01-01", useful_life_months: 30, start_age_weeks: 33 }));
  });

  it("activates a draft profile", async () => {
    render(<BioCostingSetupPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "bcsActivate" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/profiles/p2/activate", {}));
  });
});

/**
 * Item card > Fair value rates (TDD Item Card, Fair Value Setup). Lists the item's dated rates, adds a new dated one through the API, never edits an old one, and
 * is read-only for a user without the edit permission.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FairValueRatesDialog, { fairValueOf } from "../src/modules/master-data/FairValueRatesDialog";
import { api } from "../src/services/api-client";
import * as auth from "../src/hooks/useAuth";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.value ? `${key}:${vars.value}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getStoredUser: () => ({ userId: "u1", userType: "TENANT_ADMIN" }), hasPermission: jest.fn(() => true) }));
jest.mock("../src/components/ui/toast", () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));

const rate = { rate_id: "r1", effective_from: "2026-04-01", age_week_from: 0, expected_weight_kg: "120.000", price_per_kg: "2.050000", costs_to_sell_pct: null };
const later = { rate_id: "r2", effective_from: "2026-07-01", age_week_from: 0, expected_weight_kg: "150.000", price_per_kg: "3.600000", costs_to_sell_pct: "5.00" };

describe("FairValueRatesDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth.hasPermission as jest.Mock).mockReturnValue(true);
    (api.get as jest.Mock).mockResolvedValue({ data: [later, rate] });
    (api.post as jest.Mock).mockResolvedValue({ data: [later, rate] });
  });

  it("works a rate's fair value the way the engine does: weight x price, less costs to sell", () => {
    expect(fairValueOf(120, 2.05, null)).toBe(246);
    expect(fairValueOf(150, 3.6, 5)).toBe(513);
  });

  it("lists the item's rates with their fair value", async () => {
    render(<FairValueRatesDialog itemId="item-1" itemCode="GP-Loc-F" open onClose={() => {}} />);
    expect(await screen.findByText("2026-07-01")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/bio-costing/items/item-1/rates");
    expect(screen.getByText("246.00")).toBeTruthy();
    expect(screen.getByText("513.00")).toBeTruthy();
  });

  it("adds a dated rate through the API and shows what the API answers", async () => {
    render(<FairValueRatesDialog itemId="item-1" open onClose={() => {}} />);
    await screen.findByText("2026-07-01");
    const add = screen.getByRole("button", { name: "fvrAdd" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("fvrWeight"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("fvrPrice"), { target: { value: "3.6" } });
    fireEvent.change(screen.getByLabelText("fvrCosts"), { target: { value: "5" } });
    expect(screen.getByText("fvrPreview:513.00")).toBeTruthy();
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((api.post as jest.Mock).mock.calls[0][0]).toBe("/bio-costing/items/item-1/rates");
    expect((api.post as jest.Mock).mock.calls[0][1]).toMatchObject({ expected_weight_kg: 150, price_per_kg: 3.6, costs_to_sell_pct: 5, age_week_from: 0, cdm_based: false });
  });

  it("says a fair value run is refused when there is no rate", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    render(<FairValueRatesDialog itemId="item-1" open onClose={() => {}} />);
    expect(await screen.findByText("fvrEmpty")).toBeTruthy();
  });

  it("is read-only without the edit permission", async () => {
    (auth.hasPermission as jest.Mock).mockReturnValue(false);
    render(<FairValueRatesDialog itemId="item-1" open onClose={() => {}} />);
    await screen.findByText("2026-07-01");
    expect(screen.queryByRole("button", { name: "fvrAdd" })).toBeNull();
  });
});

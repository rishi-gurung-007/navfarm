/**
 * Bio-asset costing, Phase 6: the IAS 41 statement shows the roll-forward by costing profile, and each costing account's ledger figure
 * beside the general-ledger figure, with a difference said as one. The arithmetic is the API's.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import BioAssetRollForwardPanel from "../src/components/console/finance/bio-asset-roll-forward-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1" }));
jest.mock("../src/hooks/useCompanyCurrency", () => ({ useCompanyCurrency: () => ({ formatMoney: (n: number) => n.toFixed(2) }) }));
jest.mock("../src/components/ui/toast", () => ({ Toast: () => null }));

const report = (over: Record<string, unknown> = {}) => ({
  dateFrom: "2026-09-01", dateTo: "2026-09-30", openingCarryingValue: 700, closingCarryingValue: 650, transactionCount: 3,
  movements: { acquisitions: 0, growthCapitalization: 0, amortization: -50, fairValueAdjustments: 0, harvestTransfers: 0, disposals: 0, netMovement: -50 },
  assetTypeBreakdown: { batchCarryingValue: 0, animalCarryingValue: 650 },
  glReconciliation: { available: true, status: "AVAILABLE", glAccounts: [], totalGlBalance: 650, variance: 0, isReconciled: true },
  byProfile: [
    { key: "P:IMP-F", label: "PROFILE", profile_code: "IMP-F", opening: 400, acquisitions: 0, capitalised: 0, amortisation: -50, fairValue: 0, exits: 0, closing: 350 },
    { key: "NO_PROFILE", label: "NO_PROFILE", profile_code: null, opening: 300, acquisitions: 0, capitalised: 0, amortisation: 0, fairValue: 0, exits: 0, closing: 300 },
    { key: "BATCH_LEVEL", label: "BATCH_LEVEL", profile_code: null, opening: 0, acquisitions: 0, capitalised: 5, amortisation: 0, fairValue: 0, exits: 0, closing: 5 },
  ],
  costingTieOut: { available: true, reason: null, rows: [
    { role: "AMORTISATION_EXPENSE", account_code: "5100", account_name: "Amortization Expense", basis: "PERIOD", ledger: 50, gl: 50, difference: 0, reconciled: true },
    { role: "ACCUMULATED_AMORTISATION", account_code: "2150", account_name: "Accumulated", basis: "TO_DATE", ledger: 0, gl: 82.14, difference: 82.14, reconciled: false },
  ] },
  ...over,
});

describe("Bio-asset statement: costing sections", () => {
  it("shows one row per profile, the animals with no profile apart, and batch-level cost apart", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: report() });
    render(<BioAssetRollForwardPanel />);
    const table = (await screen.findByLabelText("barfByProfileTitle")).querySelector("table")!;
    expect(within(table).getByText("IMP-F")).toBeTruthy();
    expect(within(table).getByText("barfNoProfileRow")).toBeTruthy();
    expect(within(table).getByText("barfBatchLevelRow")).toBeTruthy();
    expect(within(table).getByText("350.00")).toBeTruthy();
  });

  it("sets each account's ledger figure beside the GL figure and says a difference is one", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: report() });
    render(<BioAssetRollForwardPanel />);
    const tie = await screen.findByLabelText("barfTieOutTitle");
    const rows = within(tie).getAllByRole("row");
    expect(within(rows[1]).getByText("barfReconciled")).toBeTruthy();                       // 5100: ledger 50, GL 50
    expect(within(rows[2]).getByText("barfTieOutVariance")).toBeTruthy();                   // 2150: ledger 0, GL 82.14
    expect(within(rows[2]).getAllByText("82.14").length).toBeGreaterThanOrEqual(2);
    expect(within(rows[2]).getByText("barfRole_ACCUMULATED_AMORTISATION")).toBeTruthy();
  });

  it("says why there is no tie-out for a farm-filtered view, and says so plainly when no run has been posted", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: report({ costingTieOut: { available: false, reason: "GL journal lines do not carry a farm dimension.", rows: [] } }) });
    const { unmount } = render(<BioAssetRollForwardPanel />);
    expect(await screen.findByText("GL journal lines do not carry a farm dimension.", { selector: "p" })).toBeTruthy();
    unmount();
    (api.get as jest.Mock).mockResolvedValue({ data: report({ costingTieOut: { available: true, reason: null, rows: [] } }) });
    render(<BioAssetRollForwardPanel />);
    expect(await screen.findByText("barfTieOutNone")).toBeTruthy();
  });

  it("shows no costing sections for an older response that has none", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: report({ byProfile: undefined, costingTieOut: undefined }) });
    render(<BioAssetRollForwardPanel />);
    await screen.findByText("barfOpeningCarryingAmount");
    expect(screen.queryByLabelText("barfByProfileTitle")).toBeNull();
    expect(screen.queryByLabelText("barfTieOutTitle")).toBeNull();
  });
});

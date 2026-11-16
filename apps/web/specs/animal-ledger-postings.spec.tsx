/**
 * The Bio-Asset Ledger Postings card on an animal: each posting names the journal entry it was posted with, and the journal number opens that
 * journal (header and lines, with each account's code and name) in a window. A posting without a journal shows a dash.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnimalLedgerPostings } from "../src/components/console/piggery/animal-ledger-postings";
import { api } from "../src/services/api-client";
import { downloadCsvFile } from "../src/modules/master-data/utils/master-csv";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn() } }));
jest.mock("../src/modules/master-data/utils/master-csv", () => ({ ...jest.requireActual("../src/modules/master-data/utils/master-csv"), downloadCsvFile: jest.fn() }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.journalNo ? `${key}:${vars.journalNo}` : key) }) }));

const format = { date: (v?: string | null) => String(v ?? ""), money: (v?: number | string | null) => `$${Number(v ?? 0).toFixed(2)}`, quantity: (v?: unknown) => String(v ?? "") };
const entries = [
  { entry_id: "e1", posting_date: "2026-01-31", transaction_type: "VARIANCE_POSITIVE", event: "AMORTIZATION", document_type: "BIO_COSTING_RUN", document_no: "BCR-1", cost_amount: "45.00", journal_id: "j1", journal_no: "JE-000001" },
  { entry_id: "x1", posting_date: "2026-02-01", transaction_type: "CONSUMPTION", expensed: true, item_name: "Boar Mash", document_type: "BATCH", document_no: "BATCH-1", cost_amount: "217.50", journal_id: "j9", journal_no: "JE-000009" },
  { entry_id: "e2", posting_date: "2026-01-30", transaction_type: "CONSUMPTION", document_type: "BREEDING_SEMEN", document_no: "LOT-1", cost_amount: "15.44", journal_id: null, journal_no: null },
];

beforeEach(() => {
  (api.get as jest.Mock).mockReset().mockImplementation(async (url: string) => {
    if (url === "/journal/j1") return { data: { journal_id: "j1", journal_no: "JE-000001", status: "POSTED", posting_date: "2026-01-31", source: "SYSTEM", source_document_no: "BCR-1", lines: [
      { line_id: "l1", gl_account_id: "g1", debit_amount: "45.00", credit_amount: "0.00", description: "Fair value gain" },
      { line_id: "l2", gl_account_id: "g2", debit_amount: "0.00", credit_amount: "45.00", description: "Fair value gain" },
    ] } };
    return { data: [{ gl_account_id: "g1", account_code: "1109", account_name: "P-Loc-F Acquisition Cost" }, { gl_account_id: "g2", account_code: "4103", account_name: "Fair Value Gain/Loss" }] };
  });
});

describe("AnimalLedgerPostings journal entries", () => {
  it("shows the journal number on a posting and a dash where there is none", () => {
    render(<AnimalLedgerPostings entries={entries} loading={false} format={format} />);
    expect(screen.getByRole("button", { name: "JE-000001" })).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("opens the journal with its lines and accounts when its number is clicked", async () => {
    render(<AnimalLedgerPostings entries={entries} loading={false} format={format} />);
    fireEvent.click(screen.getByRole("button", { name: "JE-000001" }));
    expect(await screen.findByText("jpJournalEntryTitle:JE-000001")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("P-Loc-F Acquisition Cost")).toBeTruthy());
    expect(screen.getByText("4103")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/journal/j1");
  });

  it("shows expensed feed as its own kind, outside the book value", () => {
    render(<AnimalLedgerPostings entries={entries} loading={false} format={format} />);
    expect(screen.getAllByText("Consumption (expensed)").length).toBe(2);
    expect(screen.getByText(/Book value/).textContent).toContain("$60.44");
    expect(screen.getByText(/Expensed/, { selector: "span" }).textContent).toContain("$217.50");
  });

  it("exports every posting with its journal number", () => {
    render(<AnimalLedgerPostings entries={entries} loading={false} format={format} animalCode="PF-BOAR-06" />);
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    const [name, csv] = (downloadCsvFile as jest.Mock).mock.calls[0];
    expect(name).toMatch(/^bio-asset-postings-PF-BOAR-06-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(csv).toContain("PF-BOAR-06,2026-02-01,Consumption (expensed),Expensed");
    expect(csv).toContain("JE-000001");
  });
});

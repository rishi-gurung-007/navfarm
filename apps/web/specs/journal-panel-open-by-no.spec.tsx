/**
 * Silo Balance and Stock Take row 47: a GL entry reference on the stock take
 * opens that exact journal entry — /finance/journal?no=<journal no>.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import JournalPanel from "../src/components/console/finance/journal-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.journalNo != null ? `${key}:${vars.journalNo}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1" }));

const entry = { journal_id: "j-2", journal_no: "JV-0002", status: "POSTED", posting_date: "2026-09-26", description: "Stock take", lines: [] };

describe("JournalPanel ?no=", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith("/journal/j-2")) return Promise.resolve({ data: entry });
      if (url.startsWith("/journal?")) return Promise.resolve({ data: [entry] });
      return Promise.resolve({ data: [] });
    });
  });

  it("filters by the journal number and opens that entry on load", async () => {
    window.history.replaceState({}, "", "/finance/journal?no=JV-0002");
    render(<JournalPanel />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining("search=JV-0002")));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/journal/j-2"));
    expect(await screen.findByText("jpJournalEntryTitle:JV-0002")).toBeTruthy();
  });

  it("opens nothing when no ?no= is given", async () => {
    window.history.replaceState({}, "", "/finance/journal");
    render(<JournalPanel />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/journal\?/)));
    expect(api.get).not.toHaveBeenCalledWith("/journal/j-2");
  });
});

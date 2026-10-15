import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ExpensePanel from "../src/components/console/expenses/expense-panel";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        expDocNo: "Doc No",
        expBalAccNo: "Bal Acc No",
        jpPostingDate: "Posting Date",
        expAmount: "Amount",
        jpStatus: "Status",
        expDocumentNo: "Document No",
        expBalanceAccount: "Balance Account No.",
      };
      return dict[key] || key;
    },
  }),
}));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1" }));

const mockGlAccounts = [
  { gl_account_id: "gl-1", account_code: "5100", account_name: "Feed Expense" },
  { gl_account_id: "gl-2", account_code: "1200", account_name: "Petty Cash" },
];

const mockRows = [
  {
    expense_id: "e-1",
    document_no: "EXV000002",
    posting_date: "2026-10-14",
    amount: "150.00",
    expense_gl_account_id: "gl-1",
    status: "POSTED",
  },
  {
    expense_id: "e-2",
    document_no: "EXV000001",
    posting_date: "2026-10-15",
    amount: "50.00",
    expense_gl_account_id: "gl-2",
    status: "RECORDED",
  },
];

describe("ExpensePanel sort and headers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith("/gl-account")) return Promise.resolve({ data: mockGlAccounts });
      if (url.startsWith("/expense-documents/locations")) return Promise.resolve({ data: { farms: [], sheds: [] } });
      if (url.startsWith("/expense-documents/expense")) return Promise.resolve({ data: mockRows });
      return Promise.resolve({ data: [] });
    });
  });

  it("renders Doc No and Bal Acc No headers as sort buttons", async () => {
    render(<ExpensePanel docType="EXPENSE" posts={true} mayCreate={true} />);

    expect(await screen.findByRole("button", { name: /doc no/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /bal acc no/i })).toBeTruthy();
  });

  it("displays the account code and name in the Bal Acc No cell", async () => {
    render(<ExpensePanel docType="EXPENSE" posts={true} mayCreate={true} />);

    expect(await screen.findByText("5100")).toBeTruthy();
    expect(screen.getByText("Feed Expense")).toBeTruthy();
    expect(screen.getByText("1200")).toBeTruthy();
    expect(screen.getByText("Petty Cash")).toBeTruthy();
  });

  it("sorts rows when clicking on Bal Acc No", async () => {
    render(<ExpensePanel docType="EXPENSE" posts={true} mayCreate={true} />);

    const balAccBtn = await screen.findByRole("button", { name: /bal acc no/i });

    // Initial default is document_no desc (EXV000002 first, then EXV000001)
    const initialCells = screen.getAllByRole("button", { name: /EXV00000/ });
    expect(initialCells[0].textContent).toContain("EXV000002");
    expect(initialCells[1].textContent).toContain("EXV000001");

    // Click Bal Acc No (asc sort: 1200 before 5100 -> EXV000001 first)
    fireEvent.click(balAccBtn);

    const sortedCells = screen.getAllByRole("button", { name: /EXV00000/ });
    expect(sortedCells[0].textContent).toContain("EXV000001");
    expect(sortedCells[1].textContent).toContain("EXV000002");
  });
});

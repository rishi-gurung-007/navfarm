import React from "react";
import { render, screen } from "@testing-library/react";
import { MasterDataPageShell } from "@/components/console/master-data/master-data-page-shell";
import { LanguageProvider } from "@/hooks/useLanguage";

let mockScope = "TENANT";

// Stable identities: the shell re-runs its effects when these change.
const mockRouter = { replace: jest.fn(), push: jest.fn() };
const mockUser = { userType: "TENANT_ADMIN", companyId: "company-1" };

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

jest.mock("@/hooks/useAuth", () => ({
  getStoredUser: () => mockUser,
  getActiveCompanyId: () => "company-1",
  getActiveOperationalAreaId: () => null,
  getActiveWorkspaceScope: () => mockScope,
}));

jest.mock("@/modules/master-data/MasterDataTable", () => ({
  __esModule: true,
  default: () => <div data-testid="master-data-table" />,
}));

const renderShell = (key = "item") =>
  render(
    <LanguageProvider>
      <MasterDataPageShell activeKey={key} />
    </LanguageProvider>,
  );

describe("master data page in the tenant workspace (client ruling, 12 Oct)", () => {
  it("shows the switch-workspace message instead of the tables, on a deep link too", () => {
    mockScope = "TENANT";
    renderShell("item");
    expect(screen.getByText("Master data is managed inside a company or operational area — switch workspace.")).toBeTruthy();
    expect(screen.queryByTestId("master-data-table")).toBeNull();
  });

  it("still renders the table in a company workspace", () => {
    mockScope = "COMPANY";
    renderShell("item");
    expect(screen.getByTestId("master-data-table")).toBeTruthy();
    expect(screen.queryByTestId("master-data-tenant-note")).toBeNull();
  });

  it("still renders the table in an operational workspace", () => {
    mockScope = "OPERATIONAL";
    renderShell("item");
    expect(screen.getByTestId("master-data-table")).toBeTruthy();
  });
});

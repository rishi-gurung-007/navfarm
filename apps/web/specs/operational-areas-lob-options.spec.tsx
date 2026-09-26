import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OperationalAreasPage from "@/app/(app)/operational-areas/page";
import { LanguageProvider } from "@/hooks/useLanguage";
import { api } from "@/lib/api-client";

jest.mock("@/lib/api-client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/hooks/useAuth", () => ({
  getStoredUser: () => ({ userType: "TENANT_ADMIN", companyId: "company-1" }),
  getActiveCompanyId: () => "company-1",
  setActiveCompanyId: jest.fn(),
  setActiveOperationalAreaId: jest.fn(),
  setActiveWorkspaceScope: jest.fn(),
  setActiveLob: jest.fn(),
  updateStoredUser: jest.fn(),
}));

const NOB_LIVESTOCK = "50000000-5000-5000-5000-000000000002";
const LOB_PIGGERY = "60000000-6000-6000-6000-000000000007";

/**
 * GET /setup/wizard/nobs answers with flat nob_master rows — listNobs does a
 * plain select from nob_master and never attaches a lobs array. That is the
 * real shape, mirrored here row for row, so the test fails for the same
 * reason the screen does rather than for a mock's convenience.
 */
const mockApi = () => {
  (api.get as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith("/operational-area")) return Promise.resolve([]);
    if (path === "/setup/wizard/nobs") {
      return Promise.resolve([
        { nob_id: "50000000-5000-5000-5000-000000000001", nob_code: "POULTRY", nob_name: "Poultry", is_active: true },
        { nob_id: NOB_LIVESTOCK, nob_code: "LIVESTOCK", nob_name: "Livestock", is_active: true },
      ]);
    }
    if (path === `/setup/wizard/lobs/${NOB_LIVESTOCK}`) {
      return Promise.resolve([
        { lob_id: "60000000-6000-6000-6000-000000000006", nob_id: NOB_LIVESTOCK, lob_code: "LVS_MILKING", lob_name: "Dairy" },
        { lob_id: LOB_PIGGERY, nob_id: NOB_LIVESTOCK, lob_code: "LVS_PIGGERY", lob_name: "Piggery" },
      ]);
    }
    return Promise.resolve([]);
  });
};

const openCreateModal = async () => {
  render(
    <LanguageProvider>
      <OperationalAreasPage />
    </LanguageProvider>,
  );
  const openers = await screen.findAllByText("Create Operational Area");
  fireEvent.click(openers[0].closest("button")!);
};

describe("operational areas — LOB picker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi();
  });

  it("fills the LOB dropdown from the lobs endpoint", async () => {
    await openCreateModal();

    const lobSelect = await waitFor(() => {
      const label = screen.getByText("Line of Business (LOB) *");
      const select = label.parentElement!.querySelector("select");
      if (!select) throw new Error("LOB select not rendered");
      return select as HTMLSelectElement;
    });

    await waitFor(() => {
      expect([...lobSelect.options].map((o) => o.textContent)).toContain("Piggery");
    });
    expect(lobSelect.value).toBe(LOB_PIGGERY);
  });

  it("posts the selected LOB when creating an area", async () => {
    (api.post as jest.Mock).mockResolvedValue({ area_id: "area-1", company_id: "company-1" });
    await openCreateModal();

    fireEvent.change(await screen.findByPlaceholderText("e.g. PIG-UNIT-01"), { target: { value: "pig-north" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Piggery Breeding Unit"), { target: { value: "North Piggery" } });

    await waitFor(() => {
      const label = screen.getByText("Line of Business (LOB) *");
      expect((label.parentElement!.querySelector("select") as HTMLSelectElement).value).toBe(LOB_PIGGERY);
    });

    fireEvent.click(screen.getByText(/Create & Enter Area/));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as jest.Mock).mock.calls[0][1]).toMatchObject({
      area_code: "pig-north",
      area_name: "North Piggery",
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      company_id: "company-1",
    });
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import type { MasterDataConfig } from "@/modules/master-data/types";
import { LanguageProvider } from "@/hooks/useLanguage";
import { ApiError } from "@/lib/api-client";
import { api } from "@/services/api-client";

jest.mock("@/services/api-client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/hooks/useAuth", () => ({
  getActiveCompanyId: () => null,
  getActiveWorkspaceScope: () => "TENANT",
  getActiveOperationalAreaId: () => null,
  getActiveOperationalArea: () => null,
  getStoredUser: () => ({ userType: "TENANT_ADMIN" }),
  hasPermission: () => true,
}));

jest.mock("@/hooks/useMediaQuery", () => ({ useIsDesktop: () => true }));

const renderTable = (config: MasterDataConfig) => render(
  <LanguageProvider>
    <MasterDataTable config={config} />
  </LanguageProvider>,
);

describe("master-data edit fields", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows create-only fields disabled, keeps mutable fields editable, and never exposes hideInForm fields", async () => {
    const config: MasterDataConfig = {
      key: "test-edit-fields",
      label: "Test Masters",
      singular: "Test Master",
      apiBase: "/test-masters",
      idKey: "test_id",
      group: "Test",
      columns: [{ key: "immutable_code", label: "Code" }],
      fields: [
        { key: "immutable_code", label: "Code", type: "text", createOnly: true, required: true },
        { key: "mutable_name", label: "Name", type: "text", required: true },
        {
          key: "conditional_note",
          label: "Conditional Note",
          type: "text",
          visibleWhen: { anyOf: [{ key: "mutable_name", equals: "different" }] },
        },
        {
          key: "conditional_note",
          label: "Conditional Note",
          type: "text",
          visibleWhen: { anyOf: [{ key: "mutable_name", equals: "another value" }] },
        },
        { key: "internal_value", label: "Internal Value", type: "text", hideInForm: true },
      ],
    };
    (api.get as jest.Mock).mockResolvedValue([
      {
        test_id: "test-1",
        immutable_code: "LOCKED-001",
        mutable_name: "Editable name",
        conditional_note: "Still visible on edit",
        internal_value: "never show this",
        is_active: true,
      },
    ]);

    renderTable(config);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for LOCKED-001" }));
    fireEvent.click(await screen.findByText("Edit"));

    const code = await screen.findByRole("textbox", { name: "Code" });
    expect((code as HTMLInputElement).value).toBe("LOCKED-001");
    expect((code as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: "Conditional Note" }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getAllByRole("textbox", { name: "Conditional Note" })).toHaveLength(1);
    expect(screen.queryByRole("textbox", { name: "Internal Value" })).toBeNull();
  });

  it("keeps creation open and shows a corrective dialog when a manually entered code conflicts", async () => {
    const config: MasterDataConfig = {
      key: "breed",
      label: "Test Breeds",
      singular: "Test Breed",
      apiBase: "/test-breeds",
      idKey: "breed_id",
      group: "Test",
      columns: [{ key: "breed_code", label: "Code" }],
      fields: [
        { key: "breed_code", label: "Code", type: "text", required: true, createOnly: true },
        { key: "breed_name", label: "Name", type: "text", required: true },
      ],
    };
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url.startsWith("/no-series/preview-by-master")) {
        return Promise.resolve({ data: { generated: true, allowManual: true, preview: "BREED-001" } });
      }
      return Promise.resolve([]);
    });
    (api.post as jest.Mock).mockRejectedValue(new ApiError(
      "Breed code 'BREED-EXISTING' already exists for Large White.",
      409,
      { error: { message: "Breed code 'BREED-EXISTING' already exists for Large White." } },
    ));

    renderTable(config);
    fireEvent.click(await screen.findByRole("button", { name: "Add Test Breed" }));
    const code = await screen.findByRole("textbox", { name: "Code" });
    await waitFor(() => expect((code as HTMLInputElement).value).toBe("BREED-001"));
    fireEvent.change(code, { target: { value: "BREED-EXISTING" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "New breed" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect((await screen.findByRole("dialog", { name: "Code already exists" })).textContent).toContain(
      "Breed code 'BREED-EXISTING' already exists for Large White.",
    );
    expect(screen.getByRole("dialog", { name: "Add Test Breed" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Code" }) as HTMLInputElement).value).toBe("BREED-EXISTING");
  });
});

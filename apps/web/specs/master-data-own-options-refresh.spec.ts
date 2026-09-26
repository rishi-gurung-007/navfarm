import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MasterDataTable from "@/modules/master-data/MasterDataTable";
import type { MasterDataConfig } from "@/modules/master-data/types";
import { LanguageProvider } from "@/hooks/useLanguage";
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
  getStoredUser: () => ({ userType: "TENANT_ADMIN" }),
  hasPermission: () => true,
}));

jest.mock("@/hooks/useMediaQuery", () => ({ useIsDesktop: () => true }));

/**
 * A master whose own picker lists its own rows, the way Location's Parent
 * Location lists locations. The defect: picker options were cached per
 * endpoint for the life of the page, so a record saved here was missing from
 * the next Add form's picker until the page was reloaded — on the test server
 * it looked like a new farm took "a minute" to become choosable as a parent.
 */
const selfConfig: MasterDataConfig = {
  key: "test-place",
  label: "Test Places",
  singular: "Test Place",
  apiBase: "/test-place",
  idKey: "place_id",
  group: "Test",
  fields: [
    { key: "place_kind", label: "Kind", type: "select", options: [{ value: "SHED", label: "Shed" }] },
    {
      key: "parent_id", label: "Parent", type: "select-entity",
      entityEndpoint: "/test-place?parentForKind={value}", entityValueKey: "place_id",
      entityLabelKeys: ["place_code", "place_name"], dependsOn: "place_kind",
    },
    { key: "place_name", label: "Name", type: "text" },
  ],
};

const PARENTS = "/test-place?parentForKind=SHED&isActive=true&limit=500";
const parentFetches = () => (api.get as jest.Mock).mock.calls.filter(([url]) => url === PARENTS).length;

async function openAddAndPickKind() {
  fireEvent.click(screen.getByRole("button", { name: /Add Test Place/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Kind" }));
  fireEvent.click(await screen.findByRole("option", { name: "Shed" }));
}

describe("master-data picker options after a save", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockResolvedValue([]);
    (api.post as jest.Mock).mockResolvedValue({ data: { place_id: "farm-new", place_name: "New Farm" } });
  });

  it("refetches this master's own options on the next form after a create", async () => {
    render(React.createElement(LanguageProvider, null, React.createElement(MasterDataTable, { config: selfConfig })));
    await screen.findByRole("button", { name: /Add Test Place/i });

    await openAddAndPickKind();
    await waitFor(() => expect(parentFetches()).toBe(1));

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "New Farm" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Before the fix this stayed at 1: the second form reused the list cached
    // before the new record existed.
    await openAddAndPickKind();
    await waitFor(() => expect(parentFetches()).toBe(2));
  });
});

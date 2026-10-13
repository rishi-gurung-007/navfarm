/**
 * Team Management list: the department shown is the Cost Centre NAME chosen in
 * the member dialog (department_id), falling back to the legacy free text.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { departmentLabel } from "../src/components/console/team/department-label";

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => {
  const t = (key: string) => key;
  const value = { t };
  return { useLanguage: () => value };
});
var storedUser = { userId: "u-admin", userType: "COMPANY_ADMIN", companyId: "co-1" };
jest.mock("../src/hooks/useAuth", () => ({
  getStoredUser: () => storedUser,
  getStoredToken: () => "tok",
  getStoredTenantId: () => "t-1",
  getActiveCompanyId: () => "co-1",
}));
jest.mock("../src/components/console/team/member-dialog", () => ({ MemberDialog: () => null }));

import TeamPage from "../src/app/(app)/users/page";
const { api } = jest.requireMock("../src/services/api-client") as { api: { get: jest.Mock } };

const base = { user_type: "STANDARD_USER", is_active: true, company_id: "co-1", roles: [], operational_areas: [] };

describe("departmentLabel", () => {
  it("prefers the cost-centre name, falls back to the legacy text, else empty", () => {
    expect(departmentLabel({ department_id: "cc-1", department_name: "Stores", department: "old" })).toBe("Stores");
    expect(departmentLabel({ department_id: null, department_name: null, department: "Legacy" })).toBe("Legacy");
    expect(departmentLabel({ department_id: "cc-1", department_name: null, department: "Legacy" })).toBe("Legacy");
    expect(departmentLabel({})).toBe("");
  });
});

describe("Team list department", () => {
  it("shows the department name from department_id, and the legacy text when there is no id", async () => {
    api.get.mockResolvedValue([
      { ...base, user_id: "u-1", full_name: "Ada Farm", email: "ada@x", department: null, department_id: "cc-1", department_name: "Stores" },
      { ...base, user_id: "u-2", full_name: "Bo Legacy", email: "bo@x", department: "Piggery Ops", department_id: null, department_name: null },
    ]);
    render(<TeamPage />);
    await waitFor(() => expect(screen.getAllByText("Ada Farm").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Stores/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Piggery Ops/).length).toBeGreaterThan(0);
  });
});

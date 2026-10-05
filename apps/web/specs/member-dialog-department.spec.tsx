/**
 * WP1c (Rishi's 4 Oct list): "VALIDATION: User Setup defines department —
 * enforced on both buttons" (Transfer Shipment and Transfer Receipt).
 *
 * The rule the API enforces compares `user_master.department_id` to the
 * sub-location's `department_id` by identity — a Cost Center of type
 * DEPARTMENT, never free text (decisions, 1 Oct). Team Management edited only
 * the legacy free-text `department` column, so there was no way to set the
 * value the rule actually reads: the same shape of gap Direct Transfer had
 * before 51940e15.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }),
}));

import { MemberDialog } from "../src/components/console/team/member-dialog";

const { api } = jest.requireMock("../src/services/api-client") as {
  api: { get: jest.Mock; post: jest.Mock; put: jest.Mock; delete: jest.Mock };
};

const DEPARTMENTS = [
  { cost_center_id: "cc-stores", cost_center_code: "D-STORES", cost_center_name: "Stores" },
  { cost_center_id: "cc-farmops", cost_center_code: "D-OPS", cost_center_name: "Farm Ops" },
];

const me = { user_id: "u-admin", user_type: "COMPANY_ADMIN", company_id: "co-1" } as any;

const member = {
  user_id: "u-7", full_name: "Ada Farm", email: "ada@x", user_type: "STANDARD_USER",
  company_id: "co-1", farm_id: "f1", department: null, department_id: null,
  operational_areas: [], roles: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((url: string) => {
    if (url.includes("cost-center")) return Promise.resolve(DEPARTMENTS);
    return Promise.resolve([]);
  });
  api.put.mockResolvedValue({});
});

const open = (over: Record<string, unknown> = {}) =>
  render(<MemberDialog mode="edit" member={member} me={me} tenantId="t-1" companies={[{ company_id: "co-1", company_code: "C1", company_name: "Triple C" }]}
    activeCompanyId="co-1" onClose={jest.fn()} onSaved={jest.fn()} {...over} />);

describe("Team Management — the user's department is a Cost Center, not free text", () => {
  it("asks the API only for DEPARTMENT cost centres", async () => {
    open();
    await waitFor(() => {
      const asked = api.get.mock.calls.map((c) => String(c[0]));
      expect(asked.some((u) => u.includes("cost-center") && u.includes("DEPARTMENT"))).toBe(true);
    });
  });

  it("offers the department as a picker and sends department_id on save", async () => {
    open();
    const picker = await screen.findByLabelText("tmFieldDepartment");
    fireEvent.change(picker, { target: { value: "cc-stores" } });
    fireEvent.click(screen.getByText("saveChanges"));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).toMatchObject({ department_id: "cc-stores" });
  });
});

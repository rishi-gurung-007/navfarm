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

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const renderTable = (config: MasterDataConfig) => render(
  <LanguageProvider>
    <MasterDataTable config={config} />
  </LanguageProvider>,
);

const stageConfig: MasterDataConfig = {
  key: "stage",
  label: "Stages",
  singular: "Stage",
  apiBase: "/stage",
  idKey: "stage_id",
  group: "Production",
  columns: [{ key: "stage_code", label: "Code" }],
  fields: [
    { key: "stage_code", label: "Code", type: "text", createOnly: true, required: true },
    {
      key: "transition_trigger",
      label: "Transition Trigger",
      type: "select",
      required: true,
      options: ["AUTO_BY_DAY", "MANUAL", "EVENT_BASED"].map((value) => ({ value, label: value.replaceAll("_", " ") })),
    },
    {
      key: "auto_move_on_day",
      label: "Auto-Move On Day",
      type: "number",
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
    },
    {
      key: "next_stage_id",
      label: "Next Stage",
      type: "select-entity",
      entityEndpoint: "/stage",
      entityValueKey: "stage_id",
      entityLabelKeys: ["stage_code"],
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
    },
    {
      key: "alt_next_stage_id",
      label: "Alternate Next Stage",
      type: "select-entity",
      entityEndpoint: "/stage",
      entityValueKey: "stage_id",
      entityLabelKeys: ["stage_code"],
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
    },
    {
      key: "alt_trigger_condition",
      label: "Alternate Trigger Condition",
      type: "select",
      options: [{ value: "PREGNANCY_FAILED", label: "PREGNANCY FAILED" }],
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
    },
  ],
};

function chooseStaticOption(field: string, option: string) {
  fireEvent.click(screen.getByRole("button", { name: field }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

function expectStageTransitionFields(enabled: string[]) {
  const fields = ["Auto-Move On Day", "Next Stage", "Alternate Next Stage", "Alternate Trigger Condition"];
  for (const name of fields) {
    const role = name === "Auto-Move On Day" ? "textbox" : "button";
    expect((screen.getByRole(role, { name }) as HTMLInputElement | HTMLButtonElement).disabled).toBe(enabled.includes(name) ? false : true);
  }
}

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

  it("keeps a reviewed reporting-period draft inactive when its fields are edited", async () => {
    const config: MasterDataConfig = {
      key: "reporting-period",
      label: "Reporting Periods",
      singular: "Reporting Period",
      apiBase: "/reporting-period",
      idKey: "period_id",
      group: "Settings",
      draftLifecycle: { activatePath: "activate" },
      columns: [{ key: "period_code", label: "Code" }, { key: "status", label: "Status" }],
      fields: [
        { key: "period_code", label: "Code", type: "text", createOnly: true, required: true },
        { key: "start_date", label: "Start Date", type: "date", required: true },
        { key: "end_date", label: "End Date", type: "date", required: true },
      ],
    };
    (api.get as jest.Mock).mockResolvedValue([{
      period_id: "period-1", period_code: "2026-09", start_date: "2026-08-30", end_date: "2026-09-26",
      status: "DRAFT", is_active: false,
    }]);
    (api.put as jest.Mock).mockResolvedValue({});

    renderTable(config);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for 2026-09" }));
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.change(await screen.findByLabelText("Start Date"), { target: { value: "2026-08-23" } });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      "/reporting-period/period-1",
      expect.not.objectContaining({ status: "ACTIVE", is_active: true }),
    ));
  });

  it("activates a reviewed reporting-period draft through the dedicated action", async () => {
    const config: MasterDataConfig = {
      key: "reporting-period",
      label: "Reporting Periods",
      singular: "Reporting Period",
      apiBase: "/reporting-period",
      idKey: "period_id",
      group: "Settings",
      draftLifecycle: { activatePath: "activate" },
      columns: [{ key: "period_code", label: "Code" }, { key: "status", label: "Status" }],
      fields: [{ key: "period_code", label: "Code", type: "text", createOnly: true, required: true }],
    };
    (api.get as jest.Mock).mockResolvedValue([{
      period_id: "period-1", period_code: "2026-09", status: "DRAFT", is_active: false,
    }]);
    (api.patch as jest.Mock).mockResolvedValue({});

    renderTable(config);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for 2026-09" }));
    fireEvent.click(await screen.findByText("Activate"));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/reporting-period/period-1/activate"));
  });

  it("shows every Stage transition field on create and only enables fields relevant to the selected trigger", async () => {
    (api.get as jest.Mock).mockResolvedValue([]);

    renderTable(stageConfig);
    fireEvent.click(await screen.findByRole("button", { name: "Add Stage" }));

    expectStageTransitionFields([]);

    chooseStaticOption("Transition Trigger", "AUTO BY DAY");
    expectStageTransitionFields(["Auto-Move On Day", "Next Stage"]);

    chooseStaticOption("Transition Trigger", "EVENT BASED");
    expectStageTransitionFields(["Alternate Next Stage", "Alternate Trigger Condition"]);

    chooseStaticOption("Transition Trigger", "MANUAL");
    expectStageTransitionFields([]);
  });

  it("keeps every Stage transition field and its stored value on edit while disabling irrelevant fields", async () => {
    (api.get as jest.Mock).mockResolvedValue([
      {
        stage_id: "stage-1",
        stage_code: "WEANER",
        transition_trigger: "AUTO_BY_DAY",
        auto_move_on_day: 42,
        next_stage_id: "stage-2",
        alt_next_stage_id: "stage-3",
        alt_trigger_condition: "PREGNANCY_FAILED",
        is_active: true,
      },
      { stage_id: "stage-2", stage_code: "GROWER", is_active: true },
      { stage_id: "stage-3", stage_code: "RECOVERY", is_active: true },
    ]);

    renderTable(stageConfig);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for WEANER" }));
    fireEvent.click(await screen.findByText("Edit"));

    expectStageTransitionFields(["Auto-Move On Day", "Next Stage"]);
    expect((screen.getByRole("textbox", { name: "Auto-Move On Day" }) as HTMLInputElement).value).toBe("42");

    chooseStaticOption("Transition Trigger", "EVENT BASED");
    expectStageTransitionFields(["Alternate Next Stage", "Alternate Trigger Condition"]);
    expect((screen.getByRole("textbox", { name: "Auto-Move On Day" }) as HTMLInputElement).value).toBe("42");
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
    expect(screen.queryByRole("button", { name: "Change code" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Add Test Breed" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Code" }) as HTMLInputElement).value).toBe("BREED-EXISTING");
  });
});

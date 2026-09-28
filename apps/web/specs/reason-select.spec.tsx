import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReasonSelect } from "@/components/ui/reason-select";
import AnimalStageTransitionModal from "@/components/console/piggery/animal-stage-transition-modal";
import type { ReasonRow } from "@/hooks/useReasons";

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const MOCK_REASONS: ReasonRow[] = [
  {
    reason_id: "r-1",
    reason_code: "MRT-001",
    reason_name: "Respiratory Disease",
    category: "MORTALITY",
    sub_category: "Disease",
  },
  {
    reason_id: "r-2",
    reason_code: "SCN-001",
    reason_name: "Confirmed Pregnant",
    category: "SCAN",
    sub_category: "Pregnancy",
  },
  {
    reason_id: "r-3",
    reason_code: "TRF-001",
    reason_name: "Internal Transfer - Farm to Farm",
    category: "TRANSFER",
    sub_category: "Internal",
  },
];

describe("ReasonSelect Component", () => {
  it("renders with placeholder and opens options from Reason Master", () => {
    const handleChange = jest.fn();
    render(
      <ReasonSelect
        ariaLabel="Reason Select Test"
        placeholder="Pick a reason…"
        value=""
        onChange={handleChange}
        reasons={MOCK_REASONS}
      />
    );

    const trigger = screen.getByRole("button", { name: "Reason Select Test" });
    expect(trigger.textContent).toContain("Pick a reason…");

    fireEvent.click(trigger);

    expect(screen.getByRole("listbox", { name: "Reason Select Test" })).toBeTruthy();
    expect(screen.getByText("Code")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Category")).toBeTruthy();

    const option = screen.getByRole("option", { name: "MRT-001 — Respiratory Disease" });
    fireEvent.click(option);

    expect(handleChange).toHaveBeenCalledWith("MRT-001 — Respiratory Disease", MOCK_REASONS[0]);
  });

  it("filters reasons by category when specified", () => {
    const handleChange = jest.fn();
    render(
      <ReasonSelect
        ariaLabel="Scan Reasons"
        value=""
        onChange={handleChange}
        category="SCAN"
        reasons={MOCK_REASONS}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan Reasons" }));

    expect(screen.getByRole("option", { name: "SCN-001 — Confirmed Pregnant" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "MRT-001 — Respiratory Disease" })).toBeNull();
  });

  it("supports clearing a selected value", () => {
    const handleChange = jest.fn();
    const handleClear = jest.fn();
    render(
      <ReasonSelect
        ariaLabel="Clearable Reason"
        value="SCN-001 — Confirmed Pregnant"
        onChange={handleChange}
        onClear={handleClear}
        reasons={MOCK_REASONS}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Clearable Reason" }));
    const clearBtn = screen.getByRole("button", { name: "Clear Clearable Reason" });
    fireEvent.click(clearBtn);

    expect(handleClear).toHaveBeenCalled();
  });
});

describe("AnimalStageTransitionModal Reason Integration", () => {
  it("renders ReasonSelect dropdown instead of free text input", () => {
    const stages = [
      { stage_id: "st-flush", stage_code: "FLUSH", stage_name: "Flush", stage_category: "BREEDING" },
      { stage_id: "st-insem", stage_code: "INSEMINATION", stage_name: "Insemination", stage_category: "PRODUCTIVE" },
    ];
    const animal = {
      animal_id: "an-1",
      animal_code: "PIG-0100",
      animal_type: "SOW",
      breed_name: "TN-70-Sow",
      current_stage_id: "st-flush",
      stage_code: "FLUSH",
      stage_name: "Flush",
      entry_date: "2026-08-01",
    };

    render(
      <AnimalStageTransitionModal
        open={true}
        onClose={jest.fn()}
        onSuccess={jest.fn()}
        animal={animal}
        stages={stages}
        reasons={MOCK_REASONS}
      />
    );

    // Verify Reason dropdown is present with proper aria-label
    const reasonDropdown = screen.getByRole("button", { name: /astmReasonLabel/i });
    expect(reasonDropdown).toBeTruthy();

    // Click to open Reason dropdown
    fireEvent.click(reasonDropdown);

    // Listbox should appear showing the documented reason options
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: "SCN-001 — Confirmed Pregnant" })).toBeTruthy();
  });
});

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntityLookupField } from "../src/modules/master-data/EntityLookupField";

const breeds = [
  { breed_id: "breed-1", breed_code: "BRD-001", breed_name: "Landrace" },
  { breed_id: "breed-2", breed_code: "BRD-002", breed_name: "Large White" },
];

function renderLookup(onChange = jest.fn()) {
  render(
    <EntityLookupField
      id="breed-id"
      label="Breed"
      options={breeds}
      value=""
      valueKey="breed_id"
      labelKeys={["breed_code", "breed_name"]}
      onChange={onChange}
      placeholder="Select an option"
    />,
  );
  return onChange;
}

describe("EntityLookupField", () => {
  it("opens a searchable code-and-name table", () => {
    renderLookup();

    fireEvent.click(screen.getByRole("button", { name: "Breed" }));

    expect(screen.getByRole("dialog", { name: "Select Breed" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
    expect(screen.getByText("BRD-001")).toBeTruthy();
    expect(screen.getByText("Landrace")).toBeTruthy();
  });

  it("filters by either code or name", () => {
    renderLookup();
    fireEvent.click(screen.getByRole("button", { name: "Breed" }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Breed" }), {
      target: { value: "large white" },
    });

    expect(screen.queryByText("BRD-001")).toBeNull();
    expect(screen.getByText("BRD-002")).toBeTruthy();
    expect(screen.getByText("Large White")).toBeTruthy();
  });

  it("returns the row value and closes after a single selection", () => {
    const onChange = renderLookup();
    fireEvent.click(screen.getByRole("button", { name: "Breed" }));

    fireEvent.click(screen.getByRole("button", { name: "Select BRD-002 — Large White" }));

    expect(onChange).toHaveBeenCalledWith("breed-2");
    expect(screen.queryByRole("dialog", { name: "Select Breed" })).toBeNull();
  });

  it("keeps a multiple lookup open while selections are added", () => {
    const onChange = jest.fn();
    render(
      <EntityLookupField
        id="stages"
        label="Applicable Stages"
        options={[
          { stage_code: "WEANER", stage_name: "Weaner" },
          { stage_code: "GROWER", stage_name: "Grower" },
        ]}
        value={["WEANER"]}
        valueKey="stage_code"
        labelKeys={["stage_code", "stage_name"]}
        onChange={onChange}
        multiple
        placeholder="Select an option"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Applicable Stages" }));
    fireEvent.click(screen.getByRole("button", { name: "Select GROWER — Grower" }));

    expect(onChange).toHaveBeenCalledWith(["WEANER", "GROWER"]);
    expect(screen.getByRole("dialog", { name: "Select Applicable Stages" })).toBeTruthy();
  });
});

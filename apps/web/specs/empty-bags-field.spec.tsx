import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmptyBagsField } from "../src/components/console/production/entry/empty-bags-field";

describe("EmptyBagsField (checkpoint 28)", () => {
  it("reports the typed count and shows the server's flag", () => {
    const onChange = jest.fn();
    render(<EmptyBagsField label="Empty bags" value="" onChange={onChange} note="12 bags x 50 kg = 600 kg, posted 500 kg" />);
    fireEvent.change(screen.getByLabelText("Empty bags"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith("12");
    expect(screen.getByTestId("empty-bags-note").textContent).toContain("600 kg");
  });

  it("shows no note when the server raised none", () => {
    render(<EmptyBagsField label="Empty bags" value="3" onChange={() => {}} />);
    expect(screen.queryByTestId("empty-bags-note")).toBeNull();
  });
});

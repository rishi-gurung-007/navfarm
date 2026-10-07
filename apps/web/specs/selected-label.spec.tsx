import { render, screen } from "@testing-library/react";
import { SearchableEntitySelect } from "@/modules/master-data/SearchableEntitySelect";

/**
 * The open list shows code and name side by side so a row can be found either
 * way. Once one is picked the field shows a single value — the name — not both.
 */
const rows = [
  { location_id: "l1", location_code: "SILO-001", location_name: "Silo One" },
  { location_id: "l2", location_code: "STORE-001", location_name: "" },
];

const props = {
  id: "loc",
  ariaLabel: "Location",
  onChange: () => undefined,
  options: rows,
  valueKey: "location_id",
  getLabel: (r: Record<string, any>) => [r.location_code, r.location_name].filter(Boolean).join(" — "),
  getLabelParts: (r: Record<string, any>) => [r.location_code, r.location_name],
  placeholder: "Select…",
  searchPlaceholder: "Search…",
  noMatchesLabel: "No matches",
};

describe("a picked option shows one value", () => {
  it("shows the name, not code and name", () => {
    render(<SearchableEntitySelect {...props} value="l1" />);
    const trigger = screen.getByRole("button", { name: "Location" });
    expect(trigger.textContent).toBe("Silo One");
  });

  it("falls back to the code when the row has no name", () => {
    render(<SearchableEntitySelect {...props} value="l2" />);
    expect(screen.getByRole("button", { name: "Location" }).textContent).toBe("STORE-001");
  });

  it("shows the placeholder while nothing is picked", () => {
    render(<SearchableEntitySelect {...props} value="" />);
    expect(screen.getByRole("button", { name: "Location" }).textContent).toBe("Select…");
  });
});

import { render, screen } from "@testing-library/react";
import { SearchableEntitySelect } from "@/modules/master-data/SearchableEntitySelect";
import { SearchableSelect } from "@/components/ui/searchable-select";

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

/**
 * A picker whose columns are not [code, name] — the GRN item picker lists Description then Tracking. The
 * picked field must still show the description, not whatever sits in the second column (for an untracked
 * item that is "—", so the description vanished once an item was chosen).
 */
describe("a picked option shows its name when the name is not the second column", () => {
  const items = [
    { item_id: "i1", item_code: "ICAT-004-ITM-0006", item_name: "Costing Test Feed A (FIFO, not tracked)", is_lot_tracked: false },
    { item_id: "i2", item_code: "ICAT-004-ITM-0007", item_name: "Costing Test Feed B (FIFO, lot tracked)", is_lot_tracked: true },
  ];
  const itemProps = {
    ariaLabel: "Item",
    onChange: () => undefined,
    options: items,
    valueKey: "item_id",
    columnHeaders: ["Description", "Tracking"],
    getLabelParts: (r: Record<string, any>) => [r.item_name, r.is_lot_tracked ? "LOT" : "—"],
    getLabel: (r: Record<string, any>) => r.item_name,
  };

  it("shows the description of an untracked item, not its tracking column", () => {
    render(<SearchableSelect {...itemProps} value="i1" />);
    expect(screen.getByRole("button", { name: "Item" }).textContent).toBe("Costing Test Feed A (FIFO, not tracked)");
  });

  it("shows the description of a lot-tracked item, not \"LOT\"", () => {
    render(<SearchableSelect {...itemProps} value="i2" />);
    expect(screen.getByRole("button", { name: "Item" }).textContent).toBe("Costing Test Feed B (FIFO, lot tracked)");
  });

  it("still shows the second column for the usual [code, name] pickers", () => {
    render(
      <SearchableSelect
        ariaLabel="Location"
        onChange={() => undefined}
        options={rows}
        valueKey="location_id"
        columnHeaders={["Code", "Name"]}
        getLabelParts={(r: Record<string, any>) => [r.location_code, r.location_name]}
        value="l1"
      />,
    );
    expect(screen.getByRole("button", { name: "Location" }).textContent).toBe("Silo One");
  });
});

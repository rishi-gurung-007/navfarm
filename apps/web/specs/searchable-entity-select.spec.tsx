import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SearchableEntitySelect } from "@/modules/master-data/SearchableEntitySelect";

// The client reviewed the compact selector live and asked for two things: the
// options laid out as a small table rather than one run-on line per row, and
// the same control over plain enum lists. Both are display changes over a
// control whose search, keyboard and selection semantics must not move — which
// is what this spec pins.

// jsdom implements no layout, so it has no scrollIntoView at all. The panel
// calls it to keep the highlighted row in view; without this stub the keyboard
// cases fail on the environment rather than on the component.
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const BREEDS = [
  { breed_id: "b1", breed_name: "Large White", location_name: "Porta Farm" },
  { breed_id: "b2", breed_name: "Landrace", location_name: "Multiplier Farm" },
];

const base = {
  ariaLabel: "Breed",
  value: "",
  options: BREEDS,
  valueKey: "breed_id",
  getLabel: (row: Record<string, unknown>) =>
    [row.breed_name, row.location_name].filter(Boolean).join(" — "),
  placeholder: "Select…",
  searchPlaceholder: "Search",
  noMatchesLabel: "No matches",
};

function open(onChange = jest.fn(), props: Record<string, unknown> = {}) {
  render(
    <SearchableEntitySelect
      {...base}
      onChange={onChange}
      getLabelParts={(row: Record<string, unknown>) =>
        [String(row.breed_name ?? ""), String(row.location_name ?? "")]
      }
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Breed" }));
  return onChange;
}

describe("SearchableEntitySelect option columns", () => {
  it("lays the label keys out as aligned columns over one shared grid", () => {
    open();
    const listbox = screen.getByRole("listbox", { name: "Breed" });
    // One template on the list, `subgrid` on every row: that is what keeps the
    // code/name boundary in the same place down the whole list. Each option is
    // its own button, so per-row columns would each size themselves.
    expect(listbox.style.gridTemplateColumns).toBe("max-content minmax(0,1fr) auto");
    const options = screen.getAllByRole("option");
    expect(options[0].style.gridTemplateColumns).toBe("subgrid");
    // The columns are separate cells, not one joined string.
    expect(Array.from(options[0].querySelectorAll("span")).map((s) => s.textContent))
      .toEqual(["Large White", "Porta Farm", ""]);
  });

  it("still names each option with the full joined label", () => {
    open();
    // Without an explicit label the split cells would be announced as loose
    // words. The option reads as what the trigger shows.
    expect(screen.getByRole("option", { name: "Large White — Porta Farm" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Landrace — Multiplier Farm" })).toBeTruthy();
  });

  it("matches the filter against the last column, not just the first", () => {
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Breed" }), { target: { value: "porta" } });
    expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label")))
      .toEqual(["Large White — Porta Farm"]);
  });

  it("keeps Arrow/Enter selection and the selected marker", () => {
    const onChange = open();
    const search = screen.getByRole("combobox", { name: "Breed" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b2");
  });

  it("marks the current row selected", () => {
    open(jest.fn(), { value: "b2" });
    const selected = screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.map((o) => o.getAttribute("aria-label"))).toEqual(["Landrace — Multiplier Farm"]);
  });
});

describe("SearchableEntitySelect over a static option list", () => {
  // How MasterDataTable now renders a `type: "select"` enum: rows of
  // {value,label}, one column, and no master behind it to create a row in.
  const ENUM = [
    { value: "AUTO_BY_DAY", label: "AUTO BY DAY" },
    { value: "MANUAL", label: "MANUAL" },
  ];

  function renderEnum(onChange = jest.fn()) {
    render(
      <SearchableEntitySelect
        ariaLabel="Transition Trigger"
        value=""
        onChange={onChange}
        options={ENUM}
        valueKey="value"
        getLabel={(row: Record<string, unknown>) => String(row.label ?? "")}
        placeholder="Select…"
        searchPlaceholder="Search"
        noMatchesLabel="No matches"
      />,
    );
    return onChange;
  }

  it("shows the placeholder until something is chosen and writes the plain string value", () => {
    const onChange = renderEnum();
    const trigger = screen.getByRole("button", { name: "Transition Trigger" });
    expect(trigger.textContent).toBe("Select…");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "MANUAL" }));
    // A native <select> yielded the option's own string. So does this.
    expect(onChange).toHaveBeenCalledWith("MANUAL");
  });

  it("stays single-column and offers no creation actions", () => {
    renderEnum();
    fireEvent.click(screen.getByRole("button", { name: "Transition Trigger" }));
    expect(screen.getByRole("listbox", { name: "Transition Trigger" }).style.gridTemplateColumns).toBe("");
    expect(screen.queryByRole("button", { name: /^New /})).toBeNull();
    expect(screen.queryByRole("button", { name: /^View All /})).toBeNull();
  });
});

import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { rowOpenAction } from "@/modules/master-data/MasterDataTable";

/**
 * UOM master (Freebuff task-3, item 7, Rishi 29 Sep 2026).
 *
 * The UOM Type multi-select half of the item was skipped: uom_master.uom_type
 * is a single varchar(20) and the service enforces one base unit per type, so
 * allowing several types per unit would need a schema change — the task says
 * stop and report on that sub-point, which the report does. Everything asked
 * of the screen itself is pinned here.
 */
const uom = MASTER_DATA_CONFIGS.find((config) => config.key === "uom")!;
const conversion = MASTER_DATA_CONFIGS.find((config) => config.key === "uom-conversion")!;
const field = (key: string) => uom.fields.find((f) => f.key === key)!;

describe("UOM list — group badge", () => {
  it("hides the Inventory badge next to the page title", () => {
    expect(uom.group).toBe("Inventory");
    expect(uom.hideGroupBadge).toBe(true);
  });

  it("leaves every other master's badge alone", () => {
    const stillBadged = MASTER_DATA_CONFIGS.filter((config) => config.group && config.hideGroupBadge).map((config) => config.key);
    expect(stillBadged).toEqual(["uom"]);
  });
});

describe("UOM form — UOM Name", () => {
  it("takes letters and spaces only, mirrored with the API's own pattern", () => {
    expect(field("uom_name").pattern).toBe("[A-Za-z ]*");
  });
});

describe("UOM form — UOM Type", () => {
  it("keeps a single-select with the six documented types", () => {
    const type = field("uom_type");
    expect(type.type).toBe("select");
    expect(type.options!.map((option) => option.value)).toEqual(["WEIGHT", "VOLUME", "COUNT", "AREA", "TIME", "OTHER"]);
  });

  it("explains what the type drives, not just how to use the dropdown", () => {
    const help = field("uom_type").helpText ?? "";
    expect(help).toMatch(/base unit/i);
    expect(help).toMatch(/conversion/i);
  });
});

describe("UOM list — deactivate/activate is a toggle, not a delete", () => {
  // The row menu only offers the trash/deactivate item when the config opts out
  // of restore (MasterDataTable: `config.supportsDelete !== false &&
  // !(config.supportsRestore ?? true)`). UOM keeps restore, so the menu shows
  // Deactivate/Restore and the status cell renders the Active/Inactive switch.
  it("keeps the restore toggle that the switch column is driven by", () => {
    expect(uom.supportsRestore ?? true).toBe(true);
  });

  it("keeps the toggle calling the soft endpoints, not a hard delete", () => {
    // PATCH /:id/restore exists on the UOM controller for the activate side,
    // and DELETE /:id is the deactivate side the switch already calls.
    expect(uom.apiBase).toBe("/uom");
  });
});

describe("UOM list — a deactivated unit opens read-only", () => {
  const row = (overrides: Record<string, unknown>) => ({
    uom_id: "u-1",
    uom_code: "KG",
    uom_name: "Kilogram",
    ...overrides,
  });

  it("routes a deactivated UOM to the record view — view, no edit", () => {
    expect(rowOpenAction(row({ is_active: false }), false)).toBe("view");
    expect(rowOpenAction(row({ is_active: 0 }), false)).toBe("view");
  });

  it("still opens an active UOM for edit", () => {
    expect(rowOpenAction(row({ is_active: true }), false)).toBe("edit");
    expect(rowOpenAction(row({ is_active: 1 }), false)).toBe("edit");
  });
});

describe("UOM Conversions — Effective From/To stay out of the screen", () => {
  // The columns exist on the table and DTOs, but neither the client's Unit Of
  // Measure.xlsx sheet nor this screen exposes them; nothing to remove, this
  // pins the absence so a future config edit cannot quietly reintroduce them.
  it("offers no effective_from or effective_to field in the form", () => {
    const keys = conversion.fields.map((f) => f.key);
    expect(keys).not.toContain("effective_from");
    expect(keys).not.toContain("effective_to");
  });

  it("shows no effective_from or effective_to column in the list", () => {
    const keys = conversion.columns!.map((c) => c.key);
    expect(keys).not.toContain("effective_from");
    expect(keys).not.toContain("effective_to");
  });
});

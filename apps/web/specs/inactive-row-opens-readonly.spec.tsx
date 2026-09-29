import { rowOpenAction } from "@/modules/master-data/MasterDataTable";
import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * A DEACTIVATED record opens read-only (view, no edit): opening it lands in
 * the record view, and its row actions offer no Edit item — reactivating is a
 * deliberate action through the row's own toggle. Freebuff task-3, item 4
 * (Resource) and item 7 (UOM).
 */
const resource = MASTER_DATA_CONFIGS.find((config) => config.key === "resource")!;

const row = (overrides: Record<string, unknown>) => ({
  resource_id: "r-1",
  resource_code: "RES-001",
  resource_name: "Pelletiser",
  ...overrides,
});

describe("Deactivated row opens read-only", () => {
  it("routes an active row to the edit form", () => {
    expect(rowOpenAction(row({ is_active: true }), false)).toBe("edit");
    expect(rowOpenAction(row({ is_active: 1 }), false)).toBe("edit");
  });

  it("routes a deactivated row to the record view — view, no edit", () => {
    expect(rowOpenAction(row({ is_active: false }), false)).toBe("view");
    expect(rowOpenAction(row({ is_active: 0 }), false)).toBe("view");
  });

  it("offers nothing on a read-only table", () => {
    expect(rowOpenAction(row({ is_active: true }), true)).toBe("none");
    expect(rowOpenAction(row({ is_active: false }), true)).toBe("none");
  });

  it("applies to the Resource and UOM masters alike", () => {
    for (const key of ["resource", "uom"]) {
      expect(MASTER_DATA_CONFIGS.find((config) => config.key === key)).toBeDefined();
    }
    expect(resource.apiBase).toBe("/resource");
  });
});

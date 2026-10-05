import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import type { MasterDataField, RequiredCondition } from "@/modules/master-data/types";

const location = MASTER_DATA_CONFIGS.find((config) => config.key === "location")!;
const byKey = (key: string) => location.fields.find((field) => field.key === key)!;

function matches(condition: RequiredCondition, form: Record<string, unknown>) {
  const actual = form[condition.key];
  if (condition.equals !== undefined) {
    return Array.isArray(condition.equals) ? condition.equals.includes(actual as never) : actual === condition.equals;
  }
  if (condition.notEquals !== undefined) {
    return Array.isArray(condition.notEquals) ? !condition.notEquals.includes(actual as never) : actual !== condition.notEquals;
  }
  return actual !== "" && actual !== null && actual !== undefined;
}

function visible(field: MasterDataField, form: Record<string, unknown>) {
  if (field.hideInForm) return false;
  if (!field.visibleWhen) return true;
  return (!field.visibleWhen.anyOf || field.visibleWhen.anyOf.some((condition) => matches(condition, form)))
    && (!field.visibleWhen.allOf || field.visibleWhen.allOf.every((condition) => matches(condition, form)));
}

describe("MILL and BIN Location fields", () => {
  it("shows exactly the dedicated MILL capacity/allocation fields and hides generic capacity, biosecurity and Silo fields", () => {
    const form = { location_type: "MILL", storage_type: "" };
    const dedicated = [
      "mill_daily_capacity_ton", "mill_hourly_capacity_ton",
      "mill_bulk_daily_allocation_ton", "mill_bagged_daily_allocation_ton",
    ];
    dedicated.forEach((key) => expect(visible(byKey(key), form)).toBe(true));
    expect(byKey("location_code").labelWhen?.labels.MILL).toBe("Mill Code");
    expect(byKey("location_name").labelWhen?.labels.MILL).toBe("Mill Name");
    [
      "area_size", "area_unit", "max_capacity", "capacity_uom",
      "downtime_days_required", "silo_capacity_kg", "silo_capacity_uom", "silo_reorder_days",
      "low_level_kg", "high_level_kg", "attached_sheds", "bin_capacity_ton", "bin_feed_type",
    ].forEach((key) => expect(visible(byKey(key), form)).toBe(false));
  });

  it("shows required BIN parent/capacity/feed type fields and filters parent lookup to active MILL locations", () => {
    const form = { location_type: "BIN", storage_type: "" };
    ["parent_location_id", "bin_capacity_ton", "bin_feed_type"]
      .forEach((key) => expect(visible(byKey(key), form)).toBe(true));
    expect(byKey("location_code").labelWhen?.labels.BIN).toBe("Bin Code");
    expect(byKey("location_name").labelWhen?.labels.BIN).toBe("Bin Name");
    expect(byKey("parent_location_id")).toEqual(expect.objectContaining({
      entityEndpoint: "/location?parentForType={value}&isActive=true",
      dependsOn: "location_type",
    }));
    [
      "area_size", "area_unit", "max_capacity", "capacity_uom", "downtime_days_required",
      "silo_capacity_kg", "silo_capacity_uom", "silo_reorder_days", "low_level_kg", "high_level_kg",
      "attached_sheds", "mill_daily_capacity_ton", "mill_hourly_capacity_ton",
      "mill_bulk_daily_allocation_ton", "mill_bagged_daily_allocation_ton",
    ].forEach((key) => expect(visible(byKey(key), form)).toBe(false));
    expect(byKey("bin_feed_type").options).toEqual([
      { value: "BULK", label: "Bulk" },
      { value: "BAGGED", label: "Bagged" },
    ]);
  });
});

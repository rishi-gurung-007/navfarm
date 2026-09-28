import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { entityRestrictionState } from "@/modules/master-data/MasterDataTable";

/**
 * D32 (Rishi, 28 Sep, looking at the Add Location form on the test server).
 * The six per-farm feed settings landed on the Location form only because they
 * are columns on the farm's location_master row and the generic form shows
 * every column. They describe how a farm's feed is ordered, not the farm, and
 * are edited on Settings → Inventory Setup → Feed Planning instead. "Silo /
 * Store Name" duplicated the required Name field. The columns and the API DTO
 * stay as they are — only the form loses the seven fields.
 */
const locationConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "location")!;

const MOVED_TO_FEED_PLANNING = [
  "feed_refill_buffer_days",
  "feed_lead_time_days",
  "feed_bulk_multiple_kg",
  "feed_bag_size_kg",
  "feed_truck_target_kg",
  "feed_production_weekday",
];
const REDUNDANT = ["storage_name"];

describe("D32 — the Location form no longer edits per-farm feed settings", () => {
  it.each([...MOVED_TO_FEED_PLANNING, ...REDUNDANT])("has no %s field at all", (key) => {
    expect(locationConfig.fields.find((field) => field.key === key)).toBeUndefined();
  });

  /**
   * The form's field list IS what it offers for every type — a field it does
   * not carry cannot appear for a FARM, a SILO or a STORE. Stated per type
   * because that is how the brief asks for it, and because a future edit is
   * most likely to bring one back under a visibleWhen for one of the three.
   */
  it.each(["FARM", "SILO", "STORE"])("offers none of the seven on a %s, under any visibleWhen", (locationType) => {
    const namesType = (field: { visibleWhen?: { anyOf: { key: string; equals?: unknown }[] } }) =>
      !field.visibleWhen || field.visibleWhen.anyOf.some((condition) => {
        const equals = condition.equals;
        return Array.isArray(equals) ? equals.includes(locationType) : equals === locationType;
      });
    const reachable = locationConfig.fields.filter(namesType).map((field) => field.key);
    expect(reachable.filter((key) => [...MOVED_TO_FEED_PLANNING, ...REDUNDANT].includes(key))).toEqual([]);
  });

  it("keeps the fields the form is for, including the silo levels Plan B put there", () => {
    const keys = locationConfig.fields.map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining([
      "location_code", "location_name", "location_type", "parent_location_id",
      "silo_capacity_kg", "low_level_kg", "high_level_kg", "attached_sheds", "storage_type",
    ]));
  });
});

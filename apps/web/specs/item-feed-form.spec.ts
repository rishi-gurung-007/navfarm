import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { isFieldVisible } from "@/modules/master-data/MasterDataTable";

const item = MASTER_DATA_CONFIGS.find((config) => config.key === "item")!;
const feedForm = item.fields.find((f) => f.key === "feed_form")!;

describe("Item Master — Feed Form", () => {
  it("offers Bulk and Bagged, next to Item Type", () => {
    expect(feedForm.type).toBe("select");
    expect(feedForm.options?.map((o) => o.value)).toEqual(["BULK", "BAGGED"]);
    const keys = item.fields.map((f) => f.key);
    expect(keys.indexOf("feed_form")).toBe(keys.indexOf("item_type") + 1);
    expect(item.columns.some((c) => c.key === "feed_form")).toBe(true);
  });

  it("shows only for a feed item type", () => {
    for (const type of ["FEED", "FEED-001", "FEED_BULK", "feed bag"]) expect(isFieldVisible(feedForm, { item_type: type })).toBe(true);
    for (const type of ["MEDICINE", "LIVING_ASSET", "", undefined]) expect(isFieldVisible(feedForm, { item_type: type })).toBe(false);
  });

  it("shows Diet No. only for FEED", () => {
    const dietNo = item.fields.find((f) => f.key === "diet_no")!;
    expect(isFieldVisible(dietNo, { item_type: "FEED" })).toBe(true);
    expect(isFieldVisible(dietNo, { item_type: "FEED-001" })).toBe(false);
    expect(isFieldVisible(dietNo, { item_type: "LIVING_ASSET" })).toBe(false);
    expect(isFieldVisible(dietNo, { item_type: "MEDICINE" })).toBe(false);
  });
});

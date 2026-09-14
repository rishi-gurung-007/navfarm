import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { parentFilterState } from "@/modules/master-data/MasterDataTable";

const itemConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "item")!;
const categoryField = itemConfig.fields.find((field) => field.key === "category_id")!;
const subCategoryField = itemConfig.fields.find((field) => field.key === "sub_category")!;

// Keyed exactly as resolveEndpoint() builds them, so a change to the query
// mechanism breaks this test rather than silently bypassing it.
const FEED_CATEGORIES = "/item-category?rootOnly=true&itemType=FEED";
const NO_CATEGORIES = "/item-category?rootOnly=true&itemType=FINISHED_GOODS";
const CHILDREN_OF_FEED = "/item-category?parentCategoryId=cat-feed";

const feedRoot = { category_id: "cat-feed", category_code: "FEED", category_name: "Feeds" };
const creepFeed = { category_id: "cat-creep", category_code: "CREEP_FEED", category_name: "Creep Feed" };

describe("Item classification cascade", () => {
  it("hides Category until an Item Type is chosen", () => {
    expect(parentFilterState(categoryField, {}, {})).toEqual(
      expect.objectContaining({ hidden: true, empty: false }),
    );
  });

  it("offers Category once its Item Type has categories", () => {
    expect(parentFilterState(categoryField, { item_type: "FEED" }, { [FEED_CATEGORIES]: [feedRoot] }))
      .toEqual(expect.objectContaining({ hidden: false, empty: false }));
  });

  // The defect: an Item Type with no categories used to remove the field from
  // the form altogether, so there was nothing on screen to say why Category
  // could not be set — and Sub Category then vanished too, because its own
  // parent could never be filled in.
  it("keeps Category on the form, flagged empty, when its Item Type has no categories", () => {
    expect(parentFilterState(categoryField, { item_type: "FINISHED_GOODS" }, { [NO_CATEGORIES]: [] }))
      .toEqual(expect.objectContaining({ hidden: false, empty: true }));
  });

  it("hides Sub Category until a Category is chosen", () => {
    expect(parentFilterState(subCategoryField, { item_type: "FEED" }, {}))
      .toEqual(expect.objectContaining({ hidden: true, empty: false }));
  });

  it("offers Sub Category once its parent Category has children", () => {
    expect(parentFilterState(subCategoryField, { item_type: "FEED", category_id: "cat-feed" }, { [CHILDREN_OF_FEED]: [creepFeed] }))
      .toEqual(expect.objectContaining({ hidden: false, empty: false }));
  });

  it("keeps Sub Category on the form, flagged empty, when the chosen Category has no children", () => {
    expect(parentFilterState(subCategoryField, { item_type: "FEED", category_id: "cat-feed" }, { [CHILDREN_OF_FEED]: [] }))
      .toEqual(expect.objectContaining({ hidden: false, empty: true }));
  });

  // Nothing should flicker in and out while the fetch is still in flight.
  it("keeps a dependent field visible while its options are still loading", () => {
    expect(parentFilterState(subCategoryField, { item_type: "FEED", category_id: "cat-feed" }, {}))
      .toEqual(expect.objectContaining({ hidden: false, empty: false }));
  });

  it("leaves a field with no requiresParent alone", () => {
    const uomPrimary = itemConfig.fields.find((field) => field.key === "uom_primary")!;
    expect(parentFilterState(uomPrimary, {}, {})).toEqual({ hidden: false, empty: false });
  });
});

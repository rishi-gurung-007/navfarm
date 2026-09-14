import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { entityRestrictionState } from "@/modules/master-data/MasterDataTable";

const locationConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "location")!;
const locationTypeConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "location-type")!;
const parentField = locationConfig.fields.find((field) => field.key === "parent_location_id")!;

const typeOptions = [
  { type_code: "FARM", type_name: "Farm", allowed_parent_types: [] },
  { type_code: "SHED", type_name: "Shed", allowed_parent_types: ["FARM"] },
  { type_code: "PEN", type_name: "Pen", allowed_parent_types: ["SHED"] },
];

describe("Location parent hierarchy", () => {
  it("hides Parent Location for a level 1 root type", () => {
    expect(entityRestrictionState(parentField, { location_type: "FARM" }, { "/location-type": typeOptions }))
      .toEqual(expect.objectContaining({ hidden: true, allowedCodes: [] }));
  });

  it.each([
    ["SHED", ["FARM"]],
    ["PEN", ["SHED"]],
  ])("requires %s to select only its immediately preceding type", (typeCode, allowedCodes) => {
    expect(parentField.required).toBe(true);
    expect(entityRestrictionState(parentField, { location_type: typeCode }, { "/location-type": typeOptions }))
      .toEqual(expect.objectContaining({ hidden: false, allowedCodes }));
  });

  it("uses the code/name lookup for maintaining allowed parent types", () => {
    const field = locationTypeConfig.fields.find((candidate) => candidate.key === "allowed_parent_types")!;
    expect(field).toEqual(expect.objectContaining({
      type: "select-entity",
      multiple: true,
      entityEndpoint: "/location-type",
      entityValueKey: "type_code",
      entityLabelKeys: ["type_code", "type_name"],
    }));
  });
});

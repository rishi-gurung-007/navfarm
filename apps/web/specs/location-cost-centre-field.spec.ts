import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

const location = MASTER_DATA_CONFIGS.find((config) => config.key === "location")!;

describe("Location Master Cost Centre field (11 Oct)", () => {
  const field = location.fields.find((f) => f.key === "cost_center_id")!;

  it("is an optional picker from the Cost Centre Master, active rows only", () => {
    expect(field.type).toBe("select-entity");
    expect(field.label).toBe("Cost Centre");
    expect(field.entityEndpoint).toContain("/cost-center");
    expect(field.entityEndpoint).toContain("isActive=true");
    expect(field.entityValueKey).toBe("cost_center_id");
    expect(field.required).toBeFalsy();
  });

  it("is shown for FARM and MILL only", () => {
    expect(field.visibleWhen).toEqual({ anyOf: [{ key: "location_type", equals: ["FARM", "MILL"] }] });
  });
});

import { entityDisplayText, nameOrCode } from "@/utils/code-name";

describe("code + name display (Rishi, 14 Oct)", () => {
  it("shows the name of an item, farm, stage or breed", () => {
    expect(entityDisplayText({ item_code: "ICAT-004-ITM-0008", item_name: "Weaner Grower Mash" }, ["item_code", "item_name"])).toBe("Weaner Grower Mash");
    expect(entityDisplayText({ location_code: "FARM-001", location_name: "TEST FARM 1" }, ["location_code", "location_name"])).toBe("TEST FARM 1");
  });
  it("shows the code of a UOM or a currency", () => {
    expect(entityDisplayText({ uom_code: "KG", uom_name: "Kilogram" }, ["uom_code", "uom_name"], "uom_code")).toBe("KG");
    expect(entityDisplayText({ iso_code: "USD", currency_name: "US Dollar" }, ["iso_code", "currency_name"])).toBe("USD");
  });
  it("shows a description, a lone key, or the code when there is no name", () => {
    expect(entityDisplayText({ code: "A1", description: "Dry period" }, ["code", "description"])).toBe("Dry period");
    expect(entityDisplayText({ batch_no: "BATCH-000002" }, ["batch_no"])).toBe("BATCH-000002");
    expect(entityDisplayText({ animal_code: "SOW-001", rfid_tag: "E200" }, ["animal_code", "rfid_tag"])).toBe("SOW-001");
    expect(entityDisplayText({ item_code: "X1", item_name: "" }, ["item_code", "item_name"])).toBe("X1");
  });
  it("nameOrCode falls back to the code", () => {
    expect(nameOrCode("FARM-001", "TEST FARM 1")).toBe("TEST FARM 1");
    expect(nameOrCode("FARM-001", null)).toBe("FARM-001");
  });
});

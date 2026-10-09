import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * D42 (Rishi, 29 Sep) with his addendum: the Sire picker lists males and the Dam
 * picker females, and beside each is a free-text serial number for a parent that
 * is not registered here — available for EVERY animal, whatever its entry type,
 * so neither field is gated on entry type or on the picker.
 */
const animalConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "animal")!;
const field = (key: string) => animalConfig.fields.find((f) => f.key === key);

describe("D42 — Sire and Dam: pick a registered parent, or type what the papers say", () => {
  it("asks the animal list for males on the Sire picker and females on the Dam picker", () => {
    expect(field("sire_animal_id")!.entityEndpoint).toBe("/animal?gender=M");
    expect(field("dam_animal_id")!.entityEndpoint).toBe("/animal?gender=F");
  });

  it("labels a parent by code and RFID tag, so two animals are told apart", () => {
    expect(field("sire_animal_id")!.entityLabelKeys).toEqual(["animal_code", "rfid_tag"]);
    expect(field("dam_animal_id")!.entityLabelKeys).toEqual(["animal_code", "rfid_tag"]);
  });

  it("carries a serial-number field beside each picker, in the Lineage section", () => {
    for (const key of ["sire_serial_no", "dam_serial_no"]) {
      const f = field(key)!;
      expect(f).toBeDefined();
      expect(f.type).toBe("text");
      expect(f.section).toBe("Lineage");
      expect(f.maxLength).toBe(100);
    }
  });

  it("ties neither serial field to an entry type or to the picker (the addendum)", () => {
    for (const key of ["sire_serial_no", "dam_serial_no"]) {
      const f = field(key)!;
      expect(f.visibleWhen).toBeUndefined();
      expect(f.requiredWhen).toBeUndefined();
      expect(f.required).toBeFalsy();
      expect(f.createOnly).toBeFalsy(); // editable after the fact, too
      expect(f.dependsOn).toBeUndefined();
    }
  });

  it("keeps the pickers optional, so a typed serial alone is a complete answer", () => {
    expect(field("sire_animal_id")!.required).toBeFalsy();
    expect(field("dam_animal_id")!.required).toBeFalsy();
  });

  it("puts the four fields together, picker then serial, for each parent", () => {
    const keys = animalConfig.fields.filter((f) => f.section === "Lineage").map((f) => f.key);
    expect(keys).toEqual(["sire_animal_id", "sire_serial_no", "dam_animal_id", "dam_serial_no"]);
  });
});

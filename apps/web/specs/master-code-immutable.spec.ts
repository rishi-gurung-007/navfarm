import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * A master's code is its identity: items, batches, ledger rows and journals hold
 * it, so once the record exists the form must not let anyone change it. The API
 * refuses a changed code too (common/master-code.ts); this keeps the form honest.
 *
 * The Number Series "Prefix / Pattern" and a few non-identity fields that happen
 * to end in _code (breeding farm registration, asset code, dialing code) are not
 * a record's own code and are left editable.
 */
const NOT_AN_IDENTITY = new Set(["no_series_code", "breeding_farm_code", "asset_code", "phone_code"]);

const identityCodeFields = MASTER_DATA_CONFIGS.flatMap((config) =>
  config.fields
    .filter((f) => /(_code|^code|^iso2|^iso3)$/.test(f.key) && f.type === "text" && !NOT_AN_IDENTITY.has(f.key) && !f.hideInForm && !f.filterOnly)
    .map((f) => ({ master: config.key, field: f })),
);

describe("every master's own code is fixed after create", () => {
  it("finds the code fields it is meant to police", () => {
    expect(identityCodeFields.length).toBeGreaterThan(25);
  });

  it.each(identityCodeFields.map((x) => [x.master, x.field.key, x.field] as const))("%s.%s is createOnly", (_master, _key, field) => {
    expect(field.createOnly).toBe(true);
  });
});

describe("number series lock once numbers are issued", () => {
  const series = MASTER_DATA_CONFIGS.find((c) => c.key === "number-series")!;
  it.each(["document_type", "no_series_code", "seq_length", "increment_by", "is_default", "manual_nos"])("%s locks once issued", (key) => {
    expect(series.fields.find((f) => f.key === key)!.lockWhenIssued).toBe(true);
  });
});

describe("item costing and tracking lock once inventory exists", () => {
  const item = MASTER_DATA_CONFIGS.find((c) => c.key === "item")!;
  it.each(["valuation_method", "is_tracked", "tracking_type", "tracking_series_id"])("%s locks on has_inventory", (key) => {
    expect(item.fields.find((f) => f.key === key)!.lockWhenRowFlag).toBe("has_inventory");
  });
});

describe("animal register carries RFID only", () => {
  const animal = MASTER_DATA_CONFIGS.find((c) => c.key === "animal")!;
  const keys = animal.fields.map((f) => f.key);
  it("has no tattoo, serial number, landing cost or status field", () => {
    for (const gone of ["ear_tag", "serial_number", "landing_cost", "status"]) expect(keys).not.toContain(gone);
    expect(keys).toContain("rfid_tag");
  });
  it("fills the sire and dam serial from the picked parent and then locks it", () => {
    const sire = animal.fields.find((f) => f.key === "sire_animal_id")!;
    const dam = animal.fields.find((f) => f.key === "dam_animal_id")!;
    expect(sire.fills).toEqual([{ key: "sire_serial_no", rowKeys: ["rfid_tag", "animal_code"] }]);
    expect(dam.fills).toEqual([{ key: "dam_serial_no", rowKeys: ["rfid_tag", "animal_code"] }]);
    expect(animal.fields.find((f) => f.key === "sire_serial_no")!.readOnlyWhenSet).toBe("sire_animal_id");
    expect(animal.fields.find((f) => f.key === "dam_serial_no")!.readOnlyWhenSet).toBe("dam_animal_id");
  });
  it("offers Shed or Pen and calls the placement Current Location", () => {
    const type = animal.fields.find((f) => f.key === "location_type")!;
    expect(type.options?.map((o) => o.value)).toEqual(["SHED", "PEN"]);
    const location = animal.fields.find((f) => f.key === "current_location_id")!;
    expect(location.label).toBe("Current Location");
    expect(location.dependsOn).toBe("location_type");
  });
});

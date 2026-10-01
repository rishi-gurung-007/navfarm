import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * Resource form (Freebuff task-3, item 4, Rishi 29 Sep 2026): field order is
 * Resource Code, Resource Type, Resource Sub-Type, Resource Name; EQUIPMENT
 * and UTILITY show the same fields; Next Maintenance Date and Cost Rate are
 * shown in the list but offered as no filter.
 */
const resource = MASTER_DATA_CONFIGS.find((config) => config.key === "resource")!;
const field = (key: string) => resource.fields.find((f) => f.key === key)!;

describe("Resource form — field order", () => {
  it("orders Resource Code, Resource Type, Resource Sub-Type, Resource Name", () => {
    const identification = resource.fields
      .filter((f) => f.section === "Identification" && !f.hideInForm)
      .map((f) => f.key)
      .filter((k) => ["resource_code", "resource_type", "resource_sub_type", "resource_name"].includes(k));
    expect(identification).toEqual(["resource_code", "resource_type", "resource_sub_type", "resource_name"]);
  });

  it("labels the sub-type field Resource Sub-Type", () => {
    expect(field("resource_sub_type").label).toBe("Resource Sub-Type");
  });
});

describe("Resource form — fields gated by Resource Type", () => {
  it("gates People section fields on MANPOWER and Asset/Maintenance fields on EQUIPMENT", () => {
    const manpowerFields = resource.fields.filter((f) =>
      f.visibleWhen?.anyOf.some((cond) => cond.key === "resource_type" && cond.equals === "MANPOWER")
    ).map((f) => f.key);
    expect(manpowerFields).toEqual(["employee_id", "designation", "department"]);

    const equipmentFields = resource.fields.filter((f) =>
      f.visibleWhen?.anyOf.some((cond) => cond.key === "resource_type" && cond.equals === "EQUIPMENT")
    ).map((f) => f.key);
    expect(equipmentFields).toEqual([
      "asset_code",
      "asset_make",
      "asset_model",
      "asset_serial_no",
      "purchase_date",
      "warranty_expiry_date",
      "maintenance_frequency_days",
      "maintenance_cost_per_service",
      "maintenance_vendor",
      "last_maintenance_date",
      "next_maintenance_date",
      "license_expiry",
    ]);
  });
});

describe("Resource list — filters", () => {
  it("offers no filter for Next Maintenance Date or Cost Rate, while both stay in the table", () => {
    for (const key of ["next_maintenance_date", "cost_rate"]) {
      const col = resource.columns!.find((c) => c.key === key)!;
      expect(col.noFilter).toBe(true);
    }
  });
});

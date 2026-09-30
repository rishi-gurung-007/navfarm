import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * Supplier form (Freebuff task-3, item 3, Rishi 29 Sep 2026): contact/address
 * order is Phone No., Email Address, then Address as Country, State, Postal
 * Code, City; Address Line 1 leaves the form (the column stays); Supplier
 * Name and descriptive text fields max 50; Country/State/City letters and
 * spaces only; Postal Code digits only.
 */
const supplier = MASTER_DATA_CONFIGS.find((config) => config.key === "supplier")!;
const field = (key: string) => supplier.fields.find((f) => f.key === key)!;

describe("Supplier form — field order", () => {
  it("orders Phone No., Email Address, then Country, State, Postal Code, City", () => {
    const keys = supplier.fields
      .filter((f) => f.section === "Contact" && !f.hideInForm)
      .map((f) => f.key);
    expect(keys).toEqual(["phone", "email", "country", "state", "pincode", "city"]);
  });

  it("labels the contact fields Phone No. and Email Address, and the postal field Postal Code", () => {
    expect(field("phone").label).toBe("Phone No.");
    expect(field("email").label).toBe("Email Address");
    expect(field("pincode").label).toBe("Postal Code");
  });
});

describe("Supplier form — Address Line 1 removed from the form, column kept", () => {
  it("does not render address_line1 in the create/edit form", () => {
    expect(field("address_line1").hideInForm).toBe(true);
  });

  it("still knows address_line1 so the record view can show what is stored", () => {
    expect(field("address_line1")).toBeDefined();
    expect(field("address_line1").key).toBe("address_line1");
  });
});

describe("Supplier form — text bounds", () => {
  it("caps Supplier Name and every descriptive text field at 50", () => {
    for (const key of ["supplier_name", "phone", "country", "state", "pincode", "city", "tax_number", "payment_terms", "bank_account_no", "bank_ifsc", "health_cert_url", "breeding_farm_code"]) {
      expect(field(key).maxLength).toBe(50);
    }
  });

  it("restricts Country, State and City to letters and spaces", () => {
    for (const key of ["country", "state", "city"]) {
      expect(field(key).pattern).toBe("[A-Za-z ]*");
    }
  });

  it("restricts Postal Code to digits", () => {
    expect(field("pincode").pattern).toBe("[0-9]*");
  });
});

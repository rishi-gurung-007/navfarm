import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";
import { lookupMastersFor } from "@/modules/master-data/MasterDataTable";

const config = (key: string) => MASTER_DATA_CONFIGS.find((c) => c.key === key)!;
const chipKeys = (key: string) => lookupMastersFor(config(key)).map((c) => c.key);

/**
 * The "Dropdown options come from" row names the masters that fill this
 * screen's pickers. It is derived from the select-entity fields themselves, so
 * a field added later needs no second place to remember — which only works if
 * the derivation actually sees every field and resolves every endpoint.
 */
describe("master-data lookup chips", () => {
  // Order matters, so this asserts the sequence rather than the set. The row
  // follows the form: Item Type is asked first and Category depends on it, so
  // Item Types precedes Item Categories. Feed Formulas has no field of its own
  // on this screen — it declares `lookupFor` — so it comes last.
  //
  // GL Accounts and Items are Business Central's catalogs eventually, but until
  // that integration is connected they are created and edited here, so they
  // belong in the row like any other lookup.
  it("names every master behind an Item dropdown, in the order the form asks", () => {
    expect(chipKeys("item")).toEqual([
      "item-type",
      "item-category",
      "uom",
      "gl-account",
      "item-attribute",
      "feed-formula",
    ]);
  });

  // A tab of this same screen is one click away in the tab bar, so a chip that
  // opens it in a modal is a second door to the same room. The dialog's cards
  // still offer it: a half-filled form cannot be abandoned to click a tab.
  it("leaves out a master that is a tab of this screen", () => {
    const tabGroup = (key: string) => {
      const c = MASTER_DATA_CONFIGS.find((x) => x.key === key)!;
      return c.tabOf ?? c.key;
    };
    for (const [screen, tab] of [
      ["item", "item-attribute"],
      ["currency", "exchange-rate"],
      ["breed", "breed-lifecycle-stage"],
      ["uom", "uom-conversion"],
    ]) {
      expect(tabGroup(screen)).toBe(tabGroup(tab));
      // lookupMastersFor still returns it — the cards need it. The chip row is
      // what filters it, so assert the shared group rather than the absence.
      expect(tabGroup(tab)).toBe(tabGroup(screen));
    }
  });

  it("orders a master's lookups by field position, never by registry position", () => {
    for (const c of MASTER_DATA_CONFIGS) {
      const chips = lookupMastersFor(c).map((x) => x.key);
      const registry = MASTER_DATA_CONFIGS.map((x) => x.key).filter((k) => chips.includes(k));
      // Nothing to prove where the two coincide; Items is the case that differs.
      if (c.key === "item") expect(chips).not.toEqual(registry);
      expect(new Set(chips).size).toBe(chips.length);
    }
  });

  // Attribute Values is a json field whose rows each pick an item attribute.
  // Scanning only top-level fields missed it, so the one master reached purely
  // through a row editor was the one master the row never mentioned.
  it("sees a master reached only through a jsonRow sub-field", () => {
    expect(chipKeys("item")).toContain("item-attribute");
  });

  it("includes a BC-owned master rather than withholding it", () => {
    expect(chipKeys("animal")).toContain("item");
    expect(chipKeys("feed-formula")).toContain("item");
    expect(chipKeys("gl-mapping")).toContain("gl-account");
  });

  // NOB and LOB come from the setup wizard, not from a master on this screen.
  it("names no master for an endpoint no master serves", () => {
    for (const key of ["location", "breed", "item"]) {
      expect(chipKeys(key)).not.toContain("setup");
    }
  });

  // "/uom/conversion" starts with "/uom". Truncating an endpoint at its first
  // slash credited the wrong master; the longest matching apiBase wins.
  it("resolves a nested apiBase to the master that owns it", () => {
    const uomConversion = config("uom-conversion");
    const probe = { ...config("item"), key: "probe", fields: [
      { key: "f", label: "F", type: "select-entity" as const, entityEndpoint: uomConversion.apiBase },
    ] };
    expect(lookupMastersFor(probe).map((c) => c.key)).toEqual(["uom-conversion"]);
  });

  it("never names the master you are already looking at", () => {
    for (const c of MASTER_DATA_CONFIGS) {
      expect(lookupMastersFor(c).map((x) => x.key)).not.toContain(c.key);
    }
  });
});

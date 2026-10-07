import { translations } from "@/utils/translations";

/**
 * One name per thing across the product (decided 2026-10-07):
 *   Inventory Ledger Entry (not Item Ledger Entry / Item Journal)
 *   GRN                    (not Goods Receipt / Purchase Receipt)
 *   Transfer Order         (not Stock Transfer)
 *   Location               (not Warehouse)
 * Applies to every language's strings, so a translation cannot quietly bring an old name back.
 * Address-type "Warehouse Depot" on a company profile is a kind of postal address, not stock.
 */
const BANNED: Array<[RegExp, string]> = [
  [/item ledger/i, "Inventory Ledger Entry"],
  [/goods receipt/i, "GRN"],
  [/stock transfer/i, "Transfer Order"],
  [/warehouse/i, "Location"],
];
const ALLOWED_KEYS = new Set(["ctAddrWarehouseDepot"]);

const locales = translations as unknown as Record<string, Record<string, string>>;

describe("product vocabulary is uniform", () => {
  it("covers all eight languages", () => {
    expect(Object.keys(locales).sort()).toEqual(["bn", "en", "es", "fr", "hi", "mr", "ta", "te"]);
  });

  for (const [locale, strings] of Object.entries(locales)) {
    it(`${locale}: no retired term in any string`, () => {
      const offenders: string[] = [];
      for (const [key, value] of Object.entries(strings)) {
        if (ALLOWED_KEYS.has(key) || typeof value !== "string") continue;
        for (const [pattern, use] of BANNED) if (pattern.test(value)) offenders.push(`${key}: "${value}" — use ${use}`);
      }
      expect(offenders).toEqual([]);
    });
  }
});

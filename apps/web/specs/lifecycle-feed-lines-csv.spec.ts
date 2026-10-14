/**
 * Breed Lifecycle Stage CSV (14 Oct): a stage's feed lives in its Feed Consumption lines, so the export writes one row
 * per line with the line's days and feed, which the import reads back as one stage with those lines.
 */
jest.mock("@/services/api-client", () => ({
  api: { get: jest.fn(async (url: string) => (url.startsWith("/item") ? { data: [{ item_id: "i1", item_code: "MASH" }, { item_id: "i2", item_code: "FIN" }] } : { data: [] })) },
}));

import { exportMasterRowsToCsv, mergeLifecycleFeedRows } from "@/modules/master-data/utils/master-csv";
import { getConfig } from "@/modules/master-data/configs";

describe("Breed Lifecycle Stage CSV export with Feed Consumption lines", () => {
  let written = "";
  beforeEach(() => {
    written = "";
    (global as any).Blob = class { constructor(parts: string[]) { written = parts.join(""); } };
    (global as any).URL.createObjectURL = jest.fn(() => "blob:x");
    (global as any).URL.revokeObjectURL = jest.fn();
  });

  it("writes one row per feed line, with the line's days, feed, UOM and wastage", async () => {
    const config = getConfig("breed-lifecycle-stage")!;
    await exportMasterRowsToCsv(config, [{
      lifecycle_id: "a", lifecycle_code: "Z-WEANER", period_from: 1, period_to: 43, calc_unit: "DAY",
      feed_lines: [
        { period_from: 1, period_to: 20, feed_item_id: "i1", feed_form: "BULK", feed_qty_per_head_per_day_kg: 800, feed_qty_uom: "GRAM", feed_wastage_pct: 2 },
        { period_from: 21, period_to: 43, feed_item_id: "i2", feed_form: null, feed_qty_per_head_per_day_kg: 1.2, feed_qty_uom: "KG", feed_wastage_pct: null },
      ],
    }]);
    const [header, ...rows] = written.replace(/^﻿/, "").split("\r\n");
    const cols = header.split(",");
    const at = (row: string, label: string) => row.split(",")[cols.indexOf(label)];
    expect(cols.slice(-5)).toEqual(["Feed", "Feed Form", "Daily Feed per Head", "Feed UOM", "Feed Wastage (%)"]);
    expect(rows).toHaveLength(2);
    expect([at(rows[0], "Effective From"), at(rows[0], "Effective To"), at(rows[0], "Feed"), at(rows[0], "Daily Feed per Head"), at(rows[0], "Feed UOM")]).toEqual(["1", "20", "MASH", "800", "GRAM"]);
    expect([at(rows[1], "Effective From"), at(rows[1], "Effective To"), at(rows[1], "Feed"), at(rows[1], "Feed UOM")]).toEqual(["21", "43", "FIN", "KG"]);
  });

  it("writes a stage without feed lines as one row with empty feed columns", async () => {
    await exportMasterRowsToCsv(getConfig("breed-lifecycle-stage")!, [{ lifecycle_id: "b", lifecycle_code: "Z-DRY", period_from: 1, period_to: 7, feed_lines: [] }]);
    const rows = written.replace(/^﻿/, "").split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1].split(",").slice(-5)).toEqual(["", "", "", "", ""]);
  });
});

describe("Breed Lifecycle Stage CSV import merges a stage's feed rows", () => {
  it("joins rows with one code into one stage with all their lines, in file order", () => {
    const merged = mergeLifecycleFeedRows([
      { lifecycle_code: "Z-WEANER", feed_lines: [{ period_from: 1, period_to: 20 }] },
      { lifecycle_code: "Z-DRY", feed_lines: [{ period_from: 1, period_to: 7 }] },
      { lifecycle_code: "Z-WEANER", feed_lines: [{ period_from: 21, period_to: 43 }] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].feed_lines).toEqual([{ period_from: 1, period_to: 20 }, { period_from: 21, period_to: 43 }]);
    expect(merged[1].lifecycle_code).toBe("Z-DRY");
  });
  it("leaves rows without a code or without feed apart", () => {
    const rows = [{ lifecycle_code: "", feed_lines: [{ period_from: 1, period_to: 5 }] }, { lifecycle_code: "", feed_lines: [{ period_from: 6, period_to: 9 }] }, { lifecycle_code: "A" }, { lifecycle_code: "A" }];
    expect(mergeLifecycleFeedRows(rows as any)).toHaveLength(4);
  });
});

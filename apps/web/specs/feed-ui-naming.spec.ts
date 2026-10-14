import { getConfig } from "@/modules/master-data/configs";
import { translations } from "@/utils/translations";

describe("feed forecasting terminology", () => {
  it("uses clear business names for planning and forecast dates", () => {
    expect(translations.en).toMatchObject({
      ffColBatchNo: "Batch No",
      ffColBatch: "Batch No.",
      ffColHouse: "Shed Code",
      ffColItemName: "Item Name",
      ffColItemNo: "Item No",
      ffColShedNo: "Shed No",
      ffColPlanningDate: "Planning Date",
      ffColCurrentInventoryKg: "System Balance (Kg)",
      ffColCurrentPigs: "Current No. of Pigs",
      ffColPerDayIntakeKg: "Per Day Intake (Kg)",
      ffColDaysOfStock: "Current No of Days Stock",
      ffColFirstShortage: "First Shortage Date",
    });
    for (const retired of [
      "ffColRunDown", "ffColDateToRefill", "ffColRequiredOn", "ffOverdue", "fpLeadTimeCol", "fpBulkMultipleCol", "fpBagSizeCol", "fpTruckTargetCol", "fpProductionDayCol",
      // M8 (final whole-branch review): a Task 8 queued removal that was dropped — silo_reorder_days
      // left the Silo Feed Setup screen for Location Master (Task 4 ruling), orphaning these three.
      "fpSiloReorderCol", "fpSiloReorder", "fpUnitDays",
    ]) {
      expect(translations.en).not.toHaveProperty(retired);
    }
  });

  it("uses the same silo and lifecycle feed names in master forms", () => {
    const location = getConfig("location")!;
    const lifecycle = getConfig("breed-lifecycle-stage")!;
    const label = (fields: typeof location.fields, key: string) => fields.find((field) => field.key === key)?.label;

    expect(label(location.fields, "low_level_kg")).toBe("Below Feed Level KG");
    expect(label(location.fields, "high_level_kg")).toBe("Above Threshold KG");
    expect(label(location.fields, "silo_reorder_days")).toBe("Refill Lead Time (days)");
    // The lifecycle's feed is Feed Consumption lines (13 Oct): the same names, one row per feed.
    const lines = lifecycle.fields.find((field) => field.key === "feed_lines")!;
    expect(lines.label).toBe("Feed Consumption");
    // In the form itself, just before Resource Requirements (Rishi, 13 Oct), not a header dialog.
    expect(lines.subDialog).toBeUndefined();
    const keys = lifecycle.fields.map((field) => field.key);
    expect(keys.indexOf("feed_lines")).toBe(keys.indexOf("resource_requirements") - 1);
    const rowLabel = (key: string) => lines.jsonRow!.find((c) => c.key === key)?.label;
    expect(rowLabel("feed_item_id")).toBe("Feed Item");
    expect(lines.jsonRow!.map((c) => c.key)[0]).toBe("feed_item_id"); // Feed Item first (Rishi, 13 Oct)
    expect(rowLabel("feed_qty_per_head_per_day_kg")).toBe("Daily Feed per Head");
    expect(rowLabel("feed_qty_uom")).toBe("UOM");
    expect(rowLabel("feed_form")).toBe("Feed Form");
    expect(label(lifecycle.fields, "feed_item_id")).toBeUndefined();
    expect(label(getConfig("item")!.fields, "diet_no")).toBe("Diet No.");
    expect(rowLabel("feed_wastage_pct")).toBe("Feed Wastage (%)");
    // Stage days only (Master Setup r35-r38, Rishi 13 Oct): no calendar Effective From / To on a lifecycle stage.
    expect(label(lifecycle.fields, "effective_from")).toBeUndefined();
    expect(label(lifecycle.fields, "effective_to")).toBeUndefined();
    // The stage-day range carries the name instead (Rishi, 13 Oct). The columns stay
    // period_from/period_to — only what the user reads changed, so these assert the
    // label on those keys, not the arrival of an effective_from field above.
    expect(label(lifecycle.fields, "period_from")).toBe("Effective From");
    expect(label(lifecycle.fields, "period_to")).toBe("Effective To");
    expect(rowLabel("period_from")).toBe("Effective From");
    expect(rowLabel("period_to")).toBe("Effective To");
    const column = (key: string) => lifecycle.columns.find((c) => c.key === key)?.label;
    expect(column("period_from")).toBe("Effective From");
    expect(column("period_to")).toBe("Effective To");
  });
});

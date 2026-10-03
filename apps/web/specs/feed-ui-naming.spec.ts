import { getConfig } from "@/modules/master-data/configs";
import { translations } from "@/utils/translations";

describe("feed forecasting terminology", () => {
  it("uses clear business names for planning and forecast dates", () => {
    expect(translations.en).toMatchObject({
      fpTableLabel: "Silo Feed Setup by farm and silo",
      fpSiloColCode: "Silo Code",
      fpSiloColName: "Name",
      fpSiloColSheds: "Linked Shed(s)",
      fpSiloColFeedType: "Feed Type",
      fpSiloColFeedItemCode: "Feed Item Code",
      fpSiloColFeedItemName: "Feed Item Name",
      fpSiloColCapacity: "Capacity",
      fpSiloLowCol: "Below Feed Level",
      fpSiloHighCol: "Above Threshold",
      fpSiloReorderCol: "Reorder Days",
      fpSiloColStatus: "Status",
      ffColBatchNo: "Batch No",
      ffColItemName: "Item Name",
      ffColItemNo: "Item No",
      ffColShedNo: "Shed No",
      ffColPlanningDate: "Planning Date",
      ffColCurrentInventoryKg: "Current Inventory (Kg)",
      ffColCurrentPigs: "Current No. of Pigs",
      ffColPerDayIntakeKg: "Per Day Intake (Kg)",
      ffColDaysOfStock: "Current No of Days Stock",
      ffColRunDown: "Run Down",
      ffColDateToRefill: "Date to Refill",
      ffColRequiredOn: "Required On Date",
    });
    for (const retired of ["fpLeadTimeCol", "fpBulkMultipleCol", "fpBagSizeCol", "fpTruckTargetCol", "fpProductionDayCol"]) {
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
    expect(label(lifecycle.fields, "feed_item_id")).toBe("Feed");
    expect(label(lifecycle.fields, "feed_qty_per_head_per_day_kg")).toBe("Daily Feed per Head (kg)");
    expect(label(lifecycle.fields, "feed_form")).toBe("Feed Form");
    expect(label(getConfig("item")!.fields, "diet_no")).toBe("Diet No.");
    expect(label(lifecycle.fields, "feed_wastage_pct")).toBe("Feed Wastage (%)");
  });
});

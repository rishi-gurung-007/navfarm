import { SCHEDULER_LINE_API_FIELDS, toApiLine } from "./scheduler-line-payload";

/** A prefilled KPI line as the Create Scheduler form holds it: every unset box is "". */
const kpiFormRow = {
  line_seq: 2,
  line_type: "DESCRIPTIVE",
  activity_name: "KPI: Average Daily Gain",
  occurrence: "DAILY",
  start_day: 1,
  end_day: 42,
  day_of_week: "",
  custom_days: "",
  is_mandatory: false,
  item_id: "",
  item_description: "",
  standard_qty: "",
  qty_basis: "PER_HEAD",
  allow_qty_edit: true,
  lot_required: false,
  creates_inventory: true,
  output_lot_auto: true,
  output_basis: "PER_BATCH",
  kpi_metric: "ADG",
  kpi_uom: "GRAM",
  std_value: "600",
  lower_alert_limit: "570",
  upper_alert_limit: "630",
  alert_severity: "WARNING",
  capture_per: "AVERAGE",
  overhead_category: "",
  gl_account: "",
  estimated_cost: "",
  resource_id: "",
  resource_name: "",
  extension_config: null,
};

describe("toApiLine — a form line as CreateSchedulerLineDto takes it", () => {
  it("drops the fields the DTO does not accept (the form's own seq and resource label)", () => {
    const sent = toApiLine(kpiFormRow);
    expect(sent).not.toHaveProperty("line_seq");
    expect(sent).not.toHaveProperty("resource_name");
    expect(Object.keys(sent).every((k) => SCHEDULER_LINE_API_FIELDS.includes(k as never))).toBe(true);
  });

  it("leaves out an id the user never picked rather than sending an empty string", () => {
    const sent = toApiLine(kpiFormRow);
    expect(sent).not.toHaveProperty("item_id");
    expect(sent).not.toHaveProperty("resource_id");
  });

  it("leaves out a blank optional string rather than sending it to an enum field", () => {
    const sent = toApiLine({ ...kpiFormRow, qty_basis: "", alert_severity: "", capture_per: "" });
    expect(sent).not.toHaveProperty("qty_basis");
    expect(sent).not.toHaveProperty("alert_severity");
    expect(sent).not.toHaveProperty("capture_per");
  });

  it("sends numbers as numbers and an empty End Day as null", () => {
    expect(toApiLine(kpiFormRow)).toMatchObject({
      start_day: 1, end_day: 42, std_value: 600, lower_alert_limit: 570, upper_alert_limit: 630,
      day_of_week: null, custom_days: null, standard_qty: null,
    });
    expect(toApiLine({ ...kpiFormRow, end_day: "" })).toMatchObject({ end_day: null });
  });

  it("keeps the values that are set: a feed line's item and quantity", () => {
    expect(toApiLine({
      ...kpiFormRow, line_type: "CONSUMPTION", activity_name: "Weaner Feed",
      item_id: "6f1b0c2e-0000-4000-8000-000000000001", standard_qty: "0.8", kpi_metric: "", kpi_uom: "",
      std_value: "", lower_alert_limit: "", upper_alert_limit: "",
    })).toMatchObject({
      line_type: "CONSUMPTION", activity_name: "Weaner Feed", qty_basis: "PER_HEAD",
      item_id: "6f1b0c2e-0000-4000-8000-000000000001", standard_qty: 0.8, is_mandatory: false, allow_qty_edit: true,
    });
  });

  it("carries a medication line's treatment card through, and drops a null one", () => {
    const card = { as_needed: true, treatments: [{ problem: "Mange", dose: "1 ml / 33 kg" }] };
    expect(toApiLine({ ...kpiFormRow, extension_config: card })).toMatchObject({ extension_config: card });
    expect(toApiLine(kpiFormRow)).not.toHaveProperty("extension_config");
  });

  it("sends back the breed lifecycle row a stage-filled line came from, and omits it on a hand-added line", () => {
    expect(toApiLine({ ...kpiFormRow, lifecycle_ref_id: "6f1b0c2e-0000-4000-8000-0000000000lc".replace(/lc/, "aa") }))
      .toMatchObject({ lifecycle_ref_id: "6f1b0c2e-0000-4000-8000-0000000000aa" });
    expect(toApiLine({ ...kpiFormRow, lifecycle_ref_id: null })).not.toHaveProperty("lifecycle_ref_id");
  });

  it("a WEEKLY line keeps its day of week; a CUSTOM line its day numbers", () => {
    expect(toApiLine({ ...kpiFormRow, occurrence: "WEEKLY", day_of_week: "1" })).toMatchObject({ occurrence: "WEEKLY", day_of_week: 1, custom_days: null });
    expect(toApiLine({ ...kpiFormRow, occurrence: "CUSTOM", custom_days: "3, 10" })).toMatchObject({ custom_days: [3, 10], day_of_week: null });
  });
});

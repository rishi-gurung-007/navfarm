/**
 * Task 9 — the feed requisition as a document (Requisition and Loading Sheet
 * §1 header, §2 lines), with each order line's batch/house breakdown (B1).
 * Fixture: the Worked Example — REQ-GRS-2026-00041, line 10000 R1 6,000 kg
 * to SILO-001 and line 20000 R2 9,000 kg (next diet) to SILO-002.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FeedRequisitionDocument, type FeedRequisitionDocumentView } from "../src/components/console/inventory/feed-requisition-document";
import { translations } from "../src/utils/translations";

jest.mock("../src/hooks/useLanguage", () => {
  const { translations: dict } = jest.requireActual("../src/utils/translations");
  const t = (key: string, vars?: Record<string, string | number>) =>
    String((dict.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (m: string, n: string) => (vars && n in vars ? String(vars[n]) : m));
  return { useLanguage: () => ({ t }) };
});

const en = translations.en;

const view: FeedRequisitionDocumentView = {
  requisition_id: "req-41", req_no: "REQ-GRS-2026-00041", requisition_type: "FEED_FORECAST", source: "AUTO_FORECAST",
  purpose: "INTERNAL_TRANSFER", supply_source: "MILL", status: "AUTO_DRAFT", priority: "CRITICAL", approval_request_id: null,
  submission_deadline: "2026-09-26", remarks: null, approved_at: null,
  header: {
    farm_code: "GRS", farm_name: "Green Ridge", requisition_date: "2026-09-23", is_next_diet_requisition: true,
    farm_total_requested_kg: 15000, truck_target_kg: 30000, bulk_multiple_kg: 3000, trips: 1, required_delivery_date: "2026-09-23",
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: "FFR-farm-grs-000001",
  },
  lines: [
    {
      line_id: "L1", line_seq: 10000, destination_location_id: "s1", destination_code: "GRS/SILO-001", destination_name: "Weaner silo", item_id: "r1", item_code: "R1",
      item_description: "Weaner Diet R1", required_item_id: "r1", feed_type: "BULK", is_next_diet: false, days_before_diet_change: null,
      lifecycle_ref_label: "L-LINE WEANER days 21–24", system_balance_kg: "1500.0000", daily_requirement_kg: "2000.0000",
      days_remaining: "0.8", first_shortage_date: "2026-09-23", unrounded_need_kg: "4500.0000", recommended_qty_kg: "6000.0000",
      quantity: "6000.0000", bag_count: null, proposed_delivery_date: "2026-09-23", exceeds_silo_capacity: false, exception_reason: null,
      breakdown: [],
    },
    {
      line_id: "L2", line_seq: 20000, destination_location_id: "s2", destination_code: "GRS/SILO-002", destination_name: "Grower silo", item_id: "r2", item_code: "R2",
      item_description: "Weaner Diet R2", required_item_id: "r2", feed_type: "BULK", is_next_diet: true, days_before_diet_change: 3,
      lifecycle_ref_label: "L-LINE WEANER days 25–27", system_balance_kg: "1000.0000", daily_requirement_kg: "2500.0000",
      days_remaining: null, first_shortage_date: "2026-09-26", unrounded_need_kg: "9000.0000", recommended_qty_kg: "9000.0000",
      quantity: "9000.0000", bag_count: null, proposed_delivery_date: "2026-09-26", exceeds_silo_capacity: true, exception_reason: null,
      breakdown: [
        { batch_id: "b1", batch_no: "B-001", shed_id: "h3", shed_code: "GRS/SHED-003", heads: 1000, feed_rate_kg: 0.5,
          lifecycle_ref_label: "L-LINE WEANER days 25–27", demand_kg: 995, first_demand_date: "2026-09-26" },
      ],
    },
  ],
};

const options = {
  destinations: [
    { location_id: "s1", location_code: "GRS/SILO-001", location_name: "Weaner silo", location_type: "SILO" },
    { location_id: "s2", location_code: "GRS/SILO-002", location_name: "Grower silo", location_type: "SILO" },
  ],
  items: [
    { item_id: "r1", item_code: "R1", item_name: "Weaner Diet R1" },
    { item_id: "r2", item_code: "R2", item_name: "Weaner Diet R2" },
  ],
};

/** A ReadField's value is the element right after its label. */
const valueOf = (label: string) => screen.getByText(label, { selector: "span" }).nextElementSibling?.textContent;

describe("FeedRequisitionDocument — header form (Requisition §1)", () => {
  it("shows the workbook header fields in their words", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    expect(valueOf(en.rqdReqNo)).toBe("REQ-GRS-2026-00041");
    expect(valueOf(en.rqdPurpose)).toBe("Internal Feed Transfer");
    expect(valueOf(en.rqdSupply)).toBe("Mill");
    expect(valueOf(en.rqdFarmCode)).toBe("GRS");
    expect(valueOf(en.rqdFarmName)).toBe("Green Ridge");
    expect(valueOf(en.rqdNextDiet)).toBe("Yes");
    // Req r26: the Farm Total is the bulk total alone — the truck target and
    // trip count moved to their own field (r27), not folded into this value.
    expect(valueOf(en.rqdFarmTotal)).toBe("15,000 KG");
    expect(en.rqdFarmTotal).toBe("Farm Total Requested KG");
    // Req r27: Bulk Truck Target KG, as its own field, with the trip count.
    expect(valueOf(en.rqdTruckTarget)).toBe("30,000 KG · 1 truck trip(s)");
    // No bagged line: no bagged total.
    expect(screen.queryByText(en.rqdBaggedTotal, { selector: "span" })).toBeNull();
    expect(valueOf(en.rqdBulkMultiple)).toBe("3,000 KG");
    expect(valueOf(en.rqdForecastRun)).toBe("FFR-farm-grs-000001");
    expect(screen.queryByText(/Current Silo Feed Item/i)).toBeNull();
  });

  // Req r26-r35: the header block was Status -> Priority -> Deadline ->
  // Required Date -> Supplier -> Purpose -> Farm Total -> Bulk Multiple, out
  // of the workbook's own order. Checked as relative order (not exact
  // adjacency) so an unrelated field between two of these is not a false
  // failure; every label must still be found (indexOf >= 0).
  it("shows the header fields in the workbook's own order (Req r26-r35)", () => {
    const { container } = render(<FeedRequisitionDocument view={view} editable={false} />);
    const labels = Array.from(container.querySelectorAll(".nf-text-label")).map((el) => el.textContent);
    const order = [
      en.rqdFarmTotal, en.rqdTruckTarget, en.rqdBulkMultiple, en.rqdRequiredDate,
      en.rqdSupply, en.rqdPurpose, en.rqdStatus, en.rqdPriority, en.rqdDeadline,
    ];
    const indices = order.map((label) => labels.indexOf(label));
    expect(indices.every((i) => i >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });
});

describe("FeedRequisitionDocument — silo number and name (Rishi 4 Oct)", () => {
  it("a read-only line shows the silo code and the silo name", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    expect(screen.getByText("GRS/SILO-001 — Weaner silo")).toBeTruthy();
    expect(screen.getByText("GRS/SILO-002 — Grower silo")).toBeTruthy();
  });

  it("an editable line offers each silo as code and name", () => {
    render(<FeedRequisitionDocument view={view} editable options={options} edits={{}} onLineEdit={jest.fn()} remarks="" onRemarksChange={jest.fn()} />);
    const select = screen.getByLabelText("Silo Code, line 10000") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["GRS/SILO-001 — Weaner silo", "GRS/SILO-002 — Grower silo"]);
  });
});

describe("FeedRequisitionDocument — bulk and bagged totals (Requisition rows 26-27)", () => {
  it("keeps the bulk total against the truck target and shows the bagged total separately, in KG and bags", () => {
    const bagged = { ...view.lines[0], line_id: "L3", line_seq: 30000, feed_type: "BAGGED", quantity: "6000.0000", bag_count: 120 };
    const mixed = {
      ...view,
      header: { ...view.header, bag_size_kg: 50 },
      lines: [{ ...view.lines[1] }, bagged],
    };
    render(<FeedRequisitionDocument view={mixed} editable={false} />);
    // One bulk line (9,000) — the bagged 6,000 is not folded into it, and not lost.
    expect(valueOf(en.rqdFarmTotal)).toBe("9,000 KG");
    expect(valueOf(en.rqdTruckTarget)).toBe("30,000 KG · 1 truck trip(s)");
    expect(valueOf(en.rqdBaggedTotal)).toBe("6,000 KG · 120 bags (50 KG each)");
  });

  it("a bagged-only requisition no longer reads 0 KG", () => {
    const bagged = { ...view.lines[0], feed_type: "BAGGED", quantity: "6000.0000", bag_count: 120 };
    render(<FeedRequisitionDocument view={{ ...view, header: { ...view.header, bag_size_kg: 50 }, lines: [bagged] }} editable={false} />);
    expect(valueOf(en.rqdFarmTotal)).toBe("0 KG");
    expect(valueOf(en.rqdTruckTarget)).toBe("30,000 KG · 0 truck trip(s)");
    expect(valueOf(en.rqdBaggedTotal)).toContain("6,000 KG");
  });
});

describe("FeedRequisitionDocument — lines sub-form (Requisition §2)", () => {
  it("lists lines 10000 and 20000 in order with their lifecycle row and one-decimal days remaining", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    const table = screen.getByRole("table", { name: en.rqLinesLabel });
    const lineCells = within(table).getAllByTestId("rqd-line-no").map((c) => c.textContent);
    expect(lineCells).toEqual(["10000", "20000"]);
    expect(within(table).getAllByText("L-LINE WEANER days 25–27").length).toBeGreaterThan(0);
    expect(within(table).getByText("0.8")).toBeTruthy();
    // Engine Step 8: the capacity warning is shown, never a block.
    expect(within(table).getAllByLabelText(en.rqdCapacityWarning)).toHaveLength(1);
  });

  it("review finding (Important 3): a line whose destination/item changed and whose forecast columns were blanked shows — rather than a stale (falsely absent) capacity warning", () => {
    const staleLine = {
      ...view.lines[1],
      line_id: "L3", line_seq: 30000, destination_code: "GRS/SILO-003",
      system_balance_kg: null, daily_requirement_kg: null, days_remaining: null, first_shortage_date: null,
      unrounded_need_kg: null, recommended_qty_kg: null,
      // The old silo's warning carried over as false by the writer: must not render as "no warning".
      exceeds_silo_capacity: false,
    };
    render(<FeedRequisitionDocument view={{ ...view, lines: [...view.lines, staleLine] }} editable={false} />);
    const table = screen.getByRole("table", { name: en.rqLinesLabel });
    const row = within(table).getByText("30000").closest("tr")!;
    expect(within(row).getByTestId("rqd-capacity-unknown")).toBeTruthy();
    expect(within(row).queryByLabelText(en.rqdCapacityWarning)).toBeNull();
    // Still exactly one real warning (line 20000) — the stale row never counts as either a warning or its absence.
    expect(within(table).getAllByLabelText(en.rqdCapacityWarning)).toHaveLength(1);
  });

  it("nests each line's batch/house breakdown beneath it, read-only (B1)", () => {
    render(<FeedRequisitionDocument view={view} editable />);
    const breakdown = screen.getByRole("table", { name: "Batches and houses for line 20000" });
    expect(within(breakdown).getByText("B-001")).toBeTruthy();
    expect(within(breakdown).getByText("GRS/SHED-003")).toBeTruthy();
    expect(within(breakdown).getByText("1,000")).toBeTruthy();
    expect(within(breakdown).getByText("995")).toBeTruthy();
    expect(within(breakdown).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(breakdown).queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.queryByRole("table", { name: "Batches and houses for line 10000" })).toBeNull();
  });

  it("an approved requisition has nothing editable", () => {
    const { container } = render(<FeedRequisitionDocument view={{ ...view, status: "APPROVED" }} editable={false} options={options} />);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
  });

  it("an open one edits silo, item, requested qty and delivery date, and asks for an exception reason off the lifecycle item", () => {
    const onLineEdit = jest.fn();
    const { rerender } = render(<FeedRequisitionDocument view={view} editable options={options} edits={{}} onLineEdit={onLineEdit} remarks="" onRemarksChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Requested Qty KG, line 10000"), { target: { value: "9000" } });
    expect(onLineEdit).toHaveBeenCalledWith("L1", { quantity: "9000" });
    fireEvent.change(screen.getByLabelText("Silo Code, line 10000"), { target: { value: "s2" } });
    expect(onLineEdit).toHaveBeenCalledWith("L1", { destinationId: "s2" });
    fireEvent.change(screen.getByLabelText("Feed Item No., line 10000"), { target: { value: "r2" } });
    expect(onLineEdit).toHaveBeenCalledWith("L1", { itemId: "r2" });
    expect(screen.queryByLabelText("Exception reason, line 10000")).toBeNull();
    rerender(<FeedRequisitionDocument view={view} editable options={options} edits={{ L1: { itemId: "r2" } }} onLineEdit={onLineEdit} remarks="" onRemarksChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Exception reason, line 10000"), { target: { value: "Vet instruction" } });
    expect(onLineEdit).toHaveBeenCalledWith("L1", { exceptionReason: "Vet instruction" });
    expect(screen.getByLabelText(en.rqdRemarks)).toBeTruthy();
  });
});

/**
 * 9d D2 (Part A verification pass 2): a REGISTERED batch has several stage
 * groups in one house, so the breakdown's rows were not unique on batch +
 * shed — React logged "Encountered two children with the same key" four times
 * on REQ-RIC100-2026-00002. requisition_line_batch's own unique key is
 * (line_id, batch_id, stage_id, shed_id); the row key must carry the stage too.
 */
describe("FeedRequisitionDocument — breakdown row keys (9d D2)", () => {
  const twoStageGroups = {
    ...view,
    lines: [
      view.lines[0],
      {
        ...view.lines[1],
        breakdown: [
          { batch_id: "b7", stage_id: "stage-flush", batch_no: "BATCH-000007", shed_id: "h1", shed_code: "RIC100/SHED-001",
            heads: 15, feed_rate_kg: 3.5, lifecycle_ref_label: "L-LINE FLUSH days 1–9", demand_kg: 472.5, first_demand_date: "2026-10-03" },
          { batch_id: "b7", stage_id: "stage-gestation", batch_no: "BATCH-000007", shed_id: "h1", shed_code: "RIC100/SHED-001",
            heads: 12, feed_rate_kg: 2.5, lifecycle_ref_label: "L-LINE GESTATION days 1–30", demand_kg: 900, first_demand_date: "2026-10-03" },
        ],
      },
    ],
  } as FeedRequisitionDocumentView;

  it("renders both stage groups of one batch in one house with no duplicate-key error", () => {
    const logged: string[] = [];
    const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(" "));
    });
    try {
      render(<FeedRequisitionDocument view={twoStageGroups} editable={false} />);
      const breakdown = screen.getByRole("table", { name: "Batches and houses for line 20000" });
      // Header row plus one row per stage group.
      expect(within(breakdown).getAllByRole("row")).toHaveLength(3);
      expect(within(breakdown).getByText("472.5")).toBeTruthy();
      expect(within(breakdown).getByText("900")).toBeTruthy();
      expect(logged.filter((message) => /same key/i.test(message))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

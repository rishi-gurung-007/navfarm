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
import { formatDateShort } from "../src/utils/date-short";

jest.mock("../src/hooks/useLanguage", () => {
  const { translations: dict } = jest.requireActual("../src/utils/translations");
  const t = (key: string, vars?: Record<string, string | number>) =>
    String((dict.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (m: string, n: string) => (vars && n in vars ? String(vars[n]) : m));
  return { useLanguage: () => ({ t }) };
});
jest.mock("../src/components/ui/reason-select", () => ({
  ReasonSelect: ({ ariaLabel, onChange }: any) => (
    <button type="button" aria-label={ariaLabel} onClick={() => onChange("reason-1")}>Choose reason</button>
  ),
}));

const en = translations.en;

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = jest.fn();
});

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
  it("uses three header columns on wide screens and two on medium screens", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);

    const typeField = screen.getByText(en.rqdReqType, { selector: "span" }).parentElement as HTMLElement;
    expect(typeField.className).toContain("sm:col-span-6");
    expect(typeField.className).toContain("lg:col-span-4");
  });

  it("presents header values as bordered read-only controls with human empty states", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);

    const reqNo = screen.getByRole("textbox", { name: en.rqdReqNo });
    expect(reqNo.textContent).toBe("REQ-GRS-2026-00041");
    expect(screen.getByRole("textbox", { name: en.rqdApprovedBy }).textContent).toBe(en.rqNotYetAvailable);
    expect(within(reqNo.closest("section") as HTMLElement).queryByText("—")).toBeNull();
  });

  it("shows the saved Requester Name the API returns", () => {
    render(<FeedRequisitionDocument view={{ ...view, requester_name: "Tenant Administrator" }} editable={false} />);
    expect(screen.getByRole("textbox", { name: en.crqRequester }).textContent).toBe("Tenant Administrator");
  });

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

describe("FeedRequisitionDocument — semantic code, name and reason fields", () => {
  it("a read-only Silo Code cell shows only the code", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    expect(screen.getByText("GRS/SILO-001")).toBeTruthy();
    expect(screen.getByText("GRS/SILO-002")).toBeTruthy();
    expect(screen.queryByText("GRS/SILO-001 — Weaner silo")).toBeNull();
  });

  it("an editable line offers each silo as code and name", async () => {
    render(<FeedRequisitionDocument view={view} editable options={options} edits={{}} onLineEdit={jest.fn()} remarks="" onRemarksChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Silo Code, line 10000" }).textContent).toBe("GRS/SILO-001");
    expect(screen.getByRole("button", { name: "Feed Item No., line 10000" }).textContent).toBe("R1");
    fireEvent.click(screen.getByRole("button", { name: "Silo Code, line 10000" }));
    expect(await screen.findByRole("option", { name: "GRS/SILO-001 — Weaner silo" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "GRS/SILO-002 — Grower silo" })).toBeTruthy();
  });

  it("keeps the feed description and Reason in separate columns", () => {
    const withReason = {
      ...view,
      lines: [{ ...view.lines[0], reason_label: "Diet changed by farm manager", exception_reason: "legacy combined text" }],
    };
    render(<FeedRequisitionDocument view={withReason} editable={false} />);
    const row = screen.getByText("10000").closest("tr")!;
    expect(within(row).getByText("Weaner Diet R1")).toBeTruthy();
    expect(within(row).getByText("Diet changed by farm manager")).toBeTruthy();
    expect(within(row).queryByText("legacy combined text")).toBeNull();
    expect(screen.getByText(en.rqdColReason)).toBeTruthy();
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

  it("an open one edits silo, item, requested qty and delivery date, and asks for a Reason Master choice off the lifecycle item", async () => {
    const onLineEdit = jest.fn();
    const { rerender } = render(<FeedRequisitionDocument view={view} editable options={options} edits={{}} onLineEdit={onLineEdit} remarks="" onRemarksChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Requested Qty KG, line 10000"), { target: { value: "9000" } });
    expect(onLineEdit).toHaveBeenCalledWith("L1", { quantity: "9000" });
    fireEvent.click(screen.getByRole("button", { name: "Silo Code, line 10000" }));
    fireEvent.click(await screen.findByRole("option", { name: "GRS/SILO-002 — Grower silo" }));
    expect(onLineEdit).toHaveBeenCalledWith("L1", { destinationId: "s2" });
    fireEvent.click(screen.getByRole("button", { name: "Feed Item No., line 10000" }));
    fireEvent.click(await screen.findByRole("option", { name: "R2 — Weaner Diet R2" }));
    expect(onLineEdit).toHaveBeenCalledWith("L1", { itemId: "r2" });
    expect(screen.queryByLabelText("Exception reason, line 10000")).toBeNull();
    rerender(<FeedRequisitionDocument view={view} editable options={options} edits={{ L1: { itemId: "r2" } }} onLineEdit={onLineEdit} remarks="" onRemarksChange={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Exception reason, line 10000" }));
    expect(onLineEdit).toHaveBeenCalledWith("L1", { reasonId: "reason-1" });
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

  it("shows the stage in its own column beside the batch number, never inside it (Rishi, 10 Oct)", () => {
    const named = {
      ...twoStageGroups,
      lines: [
        twoStageGroups.lines[0],
        {
          ...twoStageGroups.lines[1],
          breakdown: [
            { ...twoStageGroups.lines[1].breakdown![0], stage_code: "FLUSHING", stage_name: "Flushing" },
            { ...twoStageGroups.lines[1].breakdown![1], stage_code: "GESTATION", stage_name: null },
          ],
        },
      ],
    } as FeedRequisitionDocumentView;
    render(<FeedRequisitionDocument view={named} editable={false} />);
    const breakdown = screen.getByRole("table", { name: "Batches and houses for line 20000" });
    const headers = within(breakdown).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(0, 3)).toEqual(["Batch No.", "Stage", "House"]);
    const rows = within(breakdown).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows.map((cells) => cells.slice(0, 2))).toEqual([["BATCH-000007", "Flushing"], ["BATCH-000007", "GESTATION"]]);
  });
});

// W1 (10 Oct): workbook-100-gaps §2 W1 (a)-(d). Req r24/r53, §7 r153-155, Req r89.
describe("FeedRequisitionDocument — W1 line columns, links and consolidation labels", () => {
  const millLine = {
    ...view.lines[0],
    quantity: "6200.0000", requested_qty_kg: 6100, mill_approved_qty_kg: 5900, adjustment_reason: "Mill short of R1",
    bag_count: null, proposed_delivery_date: "2026-09-24",
  };
  const shipped: FeedRequisitionDocumentView = {
    ...view,
    lines: [millLine],
    transfers: [{
      transfer_id: "t1", transfer_no: "TO-0042", status: "SHIPPED", posting_date: "2026-09-24", from_warehouse_id: "m", to_warehouse_id: "s1", bin_assignment_id: "b",
      lines: [{ transfer_line_id: "tl1", requisition_line_id: "L1", item_id: "r1", quantity: 5900, uom: "KG", qty_shipped: 5900, qty_received: 5000, balance_to_ship: 0, remaining_to_receive: 900 }],
      open_shipments: [],
    }],
  };
  const lineTable = () => screen.getByRole("table", { name: en.rqLinesLabel });
  const headerCells = () => Array.from(lineTable().querySelector("thead > tr")!.children).map((c) => c.textContent);
  const rowCells = (lineNo: string) => Array.from(within(lineTable()).getByText(lineNo, { selector: "td" }).closest("tr")!.children) as HTMLElement[];
  const cellUnder = (header: string, lineNo = "10000") => {
    const idx = headerCells().indexOf(header);
    expect(idx).toBeGreaterThanOrEqual(0);
    return rowCells(lineNo)[idx];
  };

  it("(a) every header sits over its own value, read-only", () => {
    render(<FeedRequisitionDocument view={shipped} editable={false} />);
    expect(rowCells("10000")).toHaveLength(headerCells().length);
    expect(cellUnder(en.rqdColRecommended).textContent).toContain("6,000");
    expect(cellUnder(en.rqdColRequested).textContent).toBe("6,200");
    expect(cellUnder(en.rqdColMillRequested).textContent).toBe("6,100");
    expect(cellUnder(en.rqdColMillApproved).textContent).toBe("5,900");
    expect(cellUnder(en.rqdColAdjustment).textContent).toBe("Mill short of R1");
    expect(cellUnder(en.rqdColBags).textContent).toBe(en.rqNotApplicable);
    expect(cellUnder(en.rqdColDelivery).textContent).toBe(formatDateShort("2026-09-24"));
    // Requested directly follows Recommended (Req r24).
    expect(headerCells().indexOf(en.rqdColRequested)).toBe(headerCells().indexOf(en.rqdColRecommended) + 1);
  });

  it("(a) the editable Requested Qty input is under Requested Qty KG", () => {
    render(<FeedRequisitionDocument view={shipped} editable onLineEdit={jest.fn()} options={options} />);
    const input = screen.getByRole("spinbutton", { name: "Requested Qty KG, line 10000" });
    expect(cellUnder(en.rqdColRequested).contains(input)).toBe(true);
  });

  it("(b) Shipped / Received / Outstanding come from the linked transfer lines (§7 r154-155)", () => {
    render(<FeedRequisitionDocument view={shipped} editable={false} />);
    expect(cellUnder(en.rqdColShipped).textContent).toBe("5,900");
    expect(cellUnder(en.rqdColReceived).textContent).toBe("5,000");
    expect(cellUnder(en.rqdColOutstanding).textContent).toBe("900");
  });

  it("(b) Outstanding is the API's remaining_to_receive, not shipped minus received", () => {
    const tr = shipped.transfers![0];
    const view2: FeedRequisitionDocumentView = { ...shipped, transfers: [{ ...tr, lines: [{ ...tr.lines[0], remaining_to_receive: 700 }] }] };
    render(<FeedRequisitionDocument view={view2} editable={false} />);
    expect(cellUnder(en.rqdColOutstanding).textContent).toBe("700");
  });

  it("(b) before any transfer the shipment columns say so rather than 0", () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    expect(cellUnder(en.rqdColShipped).textContent).toBe(en.rqNotYetAvailable);
    expect(cellUnder(en.rqdColOutstanding).textContent).toBe(en.rqNotYetAvailable);
  });

  it("(c) links silo, farm, item and breakdown batch to their records", () => {
    render(<FeedRequisitionDocument view={{ ...view, farm_id: "farm-grs" }} editable={false} />);
    expect(screen.getByRole("link", { name: "GRS/SILO-001" }).getAttribute("href")).toBe("/master-data/location?recordId=s1");
    expect(screen.getByRole("link", { name: "GRS" }).getAttribute("href")).toBe("/master-data/location?recordId=farm-grs");
    expect(screen.getByRole("link", { name: "R1" }).getAttribute("href")).toBe("/master-data/item?recordId=r1");
    expect(screen.getByRole("link", { name: "B-001" }).getAttribute("href")).toBe("/batches/entry?batchId=b1");
  });

  it("(c) a code without an id stays plain text", () => {
    render(<FeedRequisitionDocument view={{ ...view, lines: [{ ...view.lines[0], destination_location_id: null }] }} editable={false} />);
    expect(screen.queryByRole("link", { name: "GRS/SILO-001" })).toBeNull();
    expect(screen.getByText("GRS/SILO-001")).toBeTruthy();
  });

  it("(d) consolidation block uses translated labels and words for status and next action", () => {
    render(<FeedRequisitionDocument view={{ ...view, header: { ...view.header, consolidation_no: "MCS-0007", consolidation_status: "CONSOLIDATED", consolidation_next_action: "TRANSFER_SHIPMENT" } }} editable={false} />);
    expect(screen.getByText(en.rqdConsolidationTitle)).toBeTruthy();
    expect(valueOf(en.rqdConsolidationSheet)).toBe("MCS-0007");
    expect(valueOf(en.rqdConsolidationStatus)).toBe(en.fcsStatusConsolidated);
    expect(valueOf(en.rqdConsolidationNextAction)).toBe(en.rqdNextActionShipment);
  });

  it("(d) a cancelled consolidation reads as a word, from the shared status map", () => {
    render(<FeedRequisitionDocument view={{ ...view, header: { ...view.header, consolidation_no: "MCS-0008", consolidation_status: "CANCELLED", consolidation_next_action: "RELEASE" } }} editable={false} />);
    expect(valueOf(en.rqdConsolidationStatus)).toBe(en.consolStatusCancelled);
    expect(valueOf(en.rqdConsolidationNextAction)).toBe(en.rqdNextActionRelease);
  });
});

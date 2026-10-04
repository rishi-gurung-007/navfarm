/**
 * Task 18b fix round 1: the §1 header's field order lives in one place
 * (feed-requisition-header.tsx). The saved document and the New dialog must
 * both show the shared fields in the same order.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { FeedRequisitionDocument, type FeedRequisitionDocumentView } from "../src/components/console/inventory/feed-requisition-document";
import { RequisitionNewDialog } from "../src/components/console/inventory/requisition-new-dialog";
import { bulkTotalAndTrips, feedTypeOfDestination } from "../src/components/console/inventory/feed-requisition-header";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));
jest.mock("../src/components/console/inventory/use-feed-farm", () => ({
  useFeedFarm: () => ({ farmId: null, setFarmId: jest.fn(), farms: [], loaded: true, failed: false, isFixed: false, fixedFarm: null }),
}));

const line = (n: number, feed_type: string, quantity: string) => ({
  line_id: `L${n}`, line_seq: n * 10000, destination_location_id: "s", destination_code: "GRS/SILO-00" + n, item_id: "r", item_code: "R1",
  item_description: "Weaner", required_item_id: "r", feed_type, is_next_diet: false, days_before_diet_change: null, lifecycle_ref_label: null,
  system_balance_kg: null, daily_requirement_kg: null, days_remaining: null, first_shortage_date: null, unrounded_need_kg: null,
  recommended_qty_kg: null, quantity, bag_count: null, proposed_delivery_date: "2026-09-23", exceeds_silo_capacity: false, exception_reason: null,
});
const view: FeedRequisitionDocumentView = {
  requisition_id: "r1", req_no: "REQ-1", requisition_type: "MANUAL", source: "MANUAL_ENTRY", purpose: "INTERNAL_TRANSFER", supply_source: "MILL",
  status: "DRAFT", priority: null, approval_request_id: null, submission_deadline: null, remarks: null, approved_at: null,
  header: { farm_code: "GRS", farm_name: "Green Ridge", requisition_date: "2026-09-23", is_next_diet_requisition: false, farm_total_requested_kg: 3000,
    truck_target_kg: 30000, bulk_multiple_kg: 3000, bag_size_kg: 50, trips: 1, required_delivery_date: "2026-09-23", approved_by_name: null, linked_transfer_no: null, forecast_run_no: null },
  lines: [line(1, "BULK", "3000"), line(2, "BAGGED", "500")],
};

const HEADER_LABELS = ["rqdReqNo", "rqdReqDate", "rqdReqType", "rqdSource", "rqdFarmCode", "rqdFarmName", "rqdNextDiet", "rqdFarmTotal", "rqdTruckTarget",
  "rqdBaggedTotal", "rqdBulkMultiple", "rqdRequiredDate", "rqdSupply", "rqdPurpose", "rqdStatus", "rqdPriority", "rqdDeadline"];
const shownHeaderLabels = () => Array.from(document.querySelectorAll("span.nf-text-label"))
  .map((e) => e.textContent ?? "").filter((x) => HEADER_LABELS.includes(x));

describe("feed requisition header order", () => {
  it("is the same in the saved document and in the New dialog", async () => {
    render(<FeedRequisitionDocument view={view} editable={false} />);
    const documentOrder = shownHeaderLabels();
    expect(documentOrder).toEqual(HEADER_LABELS);
    document.body.innerHTML = "";

    (api.get as jest.Mock).mockImplementation(async (url: string) => (String(url).startsWith("/feed-settings")
      ? { data: { truckTargetKg: 30000, bulkMultipleKg: 3000, bagSizeKg: 50 } }
      : { data: { destinations: [{ location_id: "s", location_code: "S", location_type: "STORE", feed_in_bags: null }], items: [] } }));
    const { unmount } = render(<RequisitionNewDialog open farmId="farm-x" onClose={jest.fn()} onCreated={jest.fn()} />);
    // Bagged Total appears only once a line is bagged; the dialog's order is the document's minus that optional field when absent.
    expect(shownHeaderLabels()).toEqual(HEADER_LABELS.filter((l) => l !== "rqdBaggedTotal"));
    unmount();
  });
});

describe("shared header helpers", () => {
  it("feedTypeOfDestination mirrors the server's feedTypeOf", () => {
    expect(feedTypeOfDestination({ location_type: "SILO", feed_in_bags: true })).toBe("BAGGED");
    expect(feedTypeOfDestination({ location_type: "STORE", feed_in_bags: false })).toBe("BULK");
    expect(feedTypeOfDestination({ location_type: "STORE", feed_in_bags: null })).toBe("BAGGED");
    expect(feedTypeOfDestination({ location_type: "SILO" })).toBe("BULK");
  });
  it("bulkTotalAndTrips counts bulk only for trips and totals bagged apart", () => {
    const r = bulkTotalAndTrips([{ feedType: "BULK", kg: 31000 }, { feedType: "BAGGED", kg: 120 }, { feedType: null, kg: 9 }], 30000, 50);
    expect(r).toEqual({ bulkTotal: 31000, trips: 2, baggedCount: 1, baggedKg: 120, baggedBags: 3 });
  });
});

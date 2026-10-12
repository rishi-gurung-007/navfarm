import { requisitionHref, transferSourceLinks } from "../src/components/console/inventory/transfer-source-links";

describe("W2T / W9 — a transfer links its source requisition, consolidation and loading sheet", () => {
  it("a hand-made transfer has no links", () => {
    expect(transferSourceLinks({ source_requisition_id: null })).toEqual([]);
    expect(transferSourceLinks(undefined)).toEqual([]);
  });

  it("a common requisition opens the Requisitions page", () => {
    expect(requisitionHref("COMMON", "req-9")).toBe("/requisitions?id=req-9");
    expect(transferSourceLinks({ source_requisition_id: "req-9", source_requisition_no: "REQ-9", source_requisition_kind: "COMMON" }))
      .toEqual([{ labelKey: "w2tSourceRequisition", text: "REQ-9", href: "/requisitions?id=req-9" }]);
  });

  it("a feed requisition opens the feed requisition tab, then its consolidation and each loading sheet", () => {
    expect(transferSourceLinks({
      source_requisition_id: "req-f", source_requisition_no: "FREQ-1", source_requisition_kind: "FEED",
      source_consolidation_id: "con-1", source_consolidation_no: "MCS-1",
      source_loading_sheets: [{ loading_sheet_id: "ls-1", loading_sheet_no: "LOAD-1" }, { loading_sheet_id: "ls-2", loading_sheet_no: "LOAD-2" }],
    })).toEqual([
      { labelKey: "w2tSourceRequisition", text: "FREQ-1", href: "/inventory/feed-forecast?tab=feed-requisition&id=req-f" },
      { labelKey: "w2tSourceConsolidation", text: "MCS-1", href: "/inventory/feed-forecast?tab=mill-consolidation&id=con-1" },
      { labelKey: "w2tSourceLoadingSheet", text: "LOAD-1", href: "/inventory/feed-forecast?tab=loading-instructions&id=ls-1" },
      { labelKey: "w2tSourceLoadingSheet", text: "LOAD-2", href: "/inventory/feed-forecast?tab=loading-instructions&id=ls-2" },
    ]);
  });
});

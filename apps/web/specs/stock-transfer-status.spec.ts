/**
 * Part E Task 4b, requirement 5: a staged transfer's status now follows its
 * shipment and receipt events (API: IN_TRANSIT, PARTIALLY_RECEIVED), so the
 * transfer list and detail must label those states, and the draft-only
 * actions (the one-step Post) must not be offered once stock has moved.
 */
import { translations } from "../src/utils/translations";
import { statusVariant } from "../src/components/ui/status-badge";
import {
  TRANSFER_STATUS_OPTIONS,
  isDraftTransfer,
  transferStatusText,
  transferStatusLabelKey,
} from "../src/components/console/inventory/stock-transfer-status";

const en = translations.en as Record<string, string>;

describe("stock transfer statuses", () => {
  it("every status the API writes has an English label", () => {
    const labels = Object.fromEntries(
      ["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "POSTED", "CANCELLED"].map((s) => [s, en[transferStatusLabelKey(s) ?? ""]]),
    );
    expect(labels).toEqual({
      DRAFT: "Draft",
      IN_TRANSIT: "In Transit",
      PARTIALLY_RECEIVED: "Partially Received",
      POSTED: "Posted",
      CANCELLED: "Cancelled",
    });
  });

  it("an unknown status has no label key, so the raw value shows rather than a missing key", () => {
    expect(transferStatusLabelKey("SOMETHING_NEW")).toBeUndefined();
  });

  it("the status filter offers the lifecycle in order, including the two event states", () => {
    expect(TRANSFER_STATUS_OPTIONS).toEqual(["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "POSTED", "CANCELLED"]);
  });

  it("only a DRAFT transfer offers the draft-only actions", () => {
    expect(isDraftTransfer({ status: "DRAFT" })).toBe(true);
    for (const status of ["IN_TRANSIT", "PARTIALLY_RECEIVED", "POSTED", "CANCELLED"]) {
      expect(isDraftTransfer({ status })).toBe(false);
    }
    expect(isDraftTransfer(null)).toBe(false);
  });

  it("the event states read as in-progress, not as a neutral draft or a completed post", () => {
    expect(statusVariant("IN_TRANSIT")).toBe("accent");
    expect(statusVariant("PARTIALLY_RECEIVED")).toBe("warning");
  });
});

describe("W9 transfer status text and unavailable label", () => {
  const t = (k: string) => en[k] ?? "";
  it("labels PARTIALLY_RECEIVED instead of showing the raw code", () => {
    expect(transferStatusText("PARTIALLY_RECEIVED", t as never)).toBe("Partially Received");
    expect(transferStatusText("IN_TRANSIT", t as never)).toBe("In Transit");
  });
  it("falls back to the raw code only for an unknown status", () => {
    expect(transferStatusText("WEIRD", t as never)).toBe("WEIRD");
    expect(transferStatusText(null, t as never)).toBe("");
  });
  it("has the Not available label", () => {
    expect(en.stpNotAvailable).toBe("Not available");
  });
});

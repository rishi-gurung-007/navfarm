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
import { itemCodeOf, userDisplayNameOf, warehouseCodeOf } from "../src/components/console/inventory/stock-transfer-display";

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
  it("labels RECEIVED through the shared status text (ledger rows carry it)", () => {
    expect(transferStatusText("RECEIVED", t as never)).toBe("Received");
    expect(transferStatusLabelKey("RECEIVED")).toBe("stpStatusReceived");
  });
  it("has the Not available label", () => {
    expect(en.stpNotAvailable).toBe("Not available");
  });
});

describe("W9 display fallbacks: a code on the row before Not available, never an id", () => {
  const NA = "Not available";
  const items = [{ item_id: "i1", item_code: "FEED-1" }];
  it("item code: client list, then the row's item_code, then Not available", () => {
    expect(itemCodeOf(items, "i1", "ROW-CODE", NA)).toBe("FEED-1");
    expect(itemCodeOf(items, "uuid-missing", "LEDGER-CODE", NA)).toBe("LEDGER-CODE");
    expect(itemCodeOf(items, "uuid-missing", undefined, NA)).toBe(NA);
    expect(itemCodeOf(items, "uuid-missing", "", NA)).not.toBe("uuid-missing");
  });
  it("warehouse code: client list, then the row's code or name, then Not available", () => {
    const whs = [{ warehouse_id: "w1", warehouse_code: "VIL100/STORE" }];
    expect(warehouseCodeOf(whs, "w1", "ROW", NA)).toBe("VIL100/STORE");
    expect(warehouseCodeOf(whs, "w-missing", "GRS/SILO", NA)).toBe("GRS/SILO");
    expect(warehouseCodeOf(whs, "w-missing", null, NA)).toBe(NA);
  });
  it("user: client list, then the row's name, then Not available; no actor is System", () => {
    const users = [{ user_id: "u1", full_name: "Rishi" }];
    expect(userDisplayNameOf(users, "u1", "Row Name", NA)).toBe("Rishi");
    expect(userDisplayNameOf(users, "u-missing", "Row Name", NA)).toBe("Row Name");
    expect(userDisplayNameOf(users, "u-missing", undefined, NA)).toBe(NA);
    expect(userDisplayNameOf(users, null, undefined, NA)).toBe("System");
  });
});

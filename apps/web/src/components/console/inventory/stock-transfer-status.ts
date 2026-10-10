import type { TranslationKeys } from "@/utils/translations";

/**
 * Stock transfer statuses as the API writes them (Part E Task 4b): a staged
 * transfer's status follows its events — DRAFT until the first shipment,
 * IN_TRANSIT while shipped stock is unreceived, PARTIALLY_RECEIVED once
 * something has arrived but not everything ordered, POSTED when every line is
 * fully shipped and received. CANCELLED only ever applies to a transfer with
 * no shipment.
 */
export const TRANSFER_STATUS_OPTIONS = ["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "POSTED", "CANCELLED"] as const;

const LABEL_KEY: Record<string, TranslationKeys> = {
  DRAFT: "stpStatusDraft",
  IN_TRANSIT: "stpStatusInTransit",
  PARTIALLY_RECEIVED: "stpStatusPartiallyReceived",
  POSTED: "stpStatusPosted",
  CANCELLED: "stpStatusCancelled",
};

/** The translation key for a status, or undefined so the caller shows the raw value. */
export function transferStatusLabelKey(status: string | null | undefined): TranslationKeys | undefined {
  return status ? LABEL_KEY[status] : undefined;
}

/**
 * Draft-only actions (the one-step Post; edit and cancel when offered) apply
 * to a DRAFT alone. The API refuses them once any shipment exists.
 */
export function isDraftTransfer(transfer: { status?: string | null } | null | undefined): boolean {
  return transfer?.status === "DRAFT";
}

/** The localized status label for every status the API writes; an unknown code shows as-is. */
export function transferStatusText(status: string | null | undefined, t: (key: TranslationKeys) => string): string {
  const key = transferStatusLabelKey(status);
  return (key && t(key)) || status || "";
}

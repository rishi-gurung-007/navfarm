/**
 * Words for the codes the requisition and alert APIs send (review A8: the
 * screens showed FEED_FORECAST, AUTO_DRAFT, CRITICAL_FIRST_PRIORITY). A code
 * with no entry is humanized rather than shown raw, so a new status the API
 * starts sending reads "On Hold" until it gets its own label.
 */
import type { TranslationKeys } from "@/utils/translations";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
type Entry = TranslationKeys | { key: TranslationKeys; variant: BadgeVariant };
type LabelMap = Record<string, Entry>;
type Translate = (key: any, vars?: any) => string;

export const REQ_STATUS_LABEL: LabelMap = {
  AUTO_DRAFT: { key: "reqStatusAutoDraft", variant: "neutral" },
  DRAFT: { key: "reqStatusDraft", variant: "neutral" },
  PENDING_APPROVAL: { key: "reqStatusPending", variant: "warning" },
  APPROVED: { key: "reqStatusApproved", variant: "success" },
  REJECTED: { key: "reqStatusRejected", variant: "danger" },
  CANCELLED: { key: "reqStatusCancelled", variant: "neutral" },
  POSTED: { key: "reqStatusPosted", variant: "success" },
  RELEASED: { key: "reqDocumentReleased", variant: "info" },
  TRANSFER_OPEN: { key: "reqFulfilmentOpen", variant: "info" },
  PARTIALLY_SHIPPED: { key: "reqFulfilmentPartShipped", variant: "warning" },
  SHIPPED: { key: "reqFulfilmentShipped", variant: "success" },
  PARTIALLY_RECEIVED: { key: "reqFulfilmentPartReceived", variant: "warning" },
  RECEIVED: { key: "reqFulfilmentReceived", variant: "success" },
};

export const PRIORITY_LABEL: LabelMap = {
  CRITICAL_FIRST_PRIORITY: { key: "prioUrgent", variant: "danger" },
  CRITICAL: { key: "prioCritical", variant: "danger" },
  WARNING: { key: "prioWarning", variant: "warning" },
  INFO: { key: "prioInfo", variant: "info" },
};

export const REQ_TYPE_LABEL: LabelMap = { FEED_FORECAST: "reqTypeForecast", MANUAL: "reqTypeManual" };
export const FEED_TYPE_LABEL: LabelMap = { BULK: "reqFeedBulk", BAGGED: "reqFeedBagged" };
export const SOURCE_LABEL: LabelMap = {
  AUTO_FORECAST: "reqSourceForecast", MANUAL_ENTRY: "reqSourceManual", STOCK_TAKE_TRIGGERED: "reqSourceStockTake", DIET_CHANGE_UPCOMING: "reqSourceDietChange",
};
export const PURPOSE_LABEL: LabelMap = { INTERNAL_TRANSFER: "reqPurposeTransfer" };
export const SUPPLY_LABEL: LabelMap = { MILL: "reqSupplyMill" };

// Common requisition (Item / Fixed Asset / Service) — Task 9.
export const DOC_TYPE_LABEL: LabelMap = { FEED: "reqDocFeed", ITEM: "reqDocItem", FA: "reqDocFa", SERVICE: "reqDocService" };
export const COMMON_PURPOSE_LABEL: LabelMap = { STORE: "reqPurposeStore", PURCHASE: "reqPurposePurchase", INTERNAL_TRANSFER: "reqPurposeTransfer" };
export const APPROVAL_STATE_LABEL: LabelMap = {
  OPEN: { key: "reqApprovalOpen", variant: "neutral" }, PENDING_APPROVAL: { key: "reqStatusPending", variant: "warning" },
  APPROVED: { key: "reqStatusApproved", variant: "success" }, REJECTED: { key: "reqStatusRejected", variant: "danger" },
};
export const DOCUMENT_STATE_LABEL: LabelMap = {
  OPEN: { key: "reqDocumentOpen", variant: "neutral" }, APPROVED: { key: "reqStatusApproved", variant: "success" },
  RELEASED: { key: "reqDocumentReleased", variant: "info" }, CANCELLED: { key: "reqStatusCancelled", variant: "neutral" },
};
export const FULFILMENT_STATE_LABEL: LabelMap = {
  NOT_APPLICABLE: "reqFulfilmentNone", TRANSFER_OPEN: "reqFulfilmentOpen", PARTIALLY_SHIPPED: "reqFulfilmentPartShipped",
  SHIPPED: "reqFulfilmentShipped", PARTIALLY_RECEIVED: "reqFulfilmentPartReceived", RECEIVED: "reqFulfilmentReceived",
};
export const INTEGRATION_STATE_LABEL: LabelMap = { NOT_APPLICABLE: "reqIntegrationNone", BC_PENDING: "reqIntegrationBcPending" };

/**
 * Where a requisition came from, said once (F5). The type and the source say
 * the same thing for the two ordinary pairs — the header read "From forecast
 * · Forecast · Internal transfer from Mill" — while STOCK_TAKE_TRIGGERED and
 * DIET_CHANGE_UPCOMING do add something, so those are kept beside the type.
 */
const SOURCE_REPEATS_TYPE: Record<string, string> = { FEED_FORECAST: 'AUTO_FORECAST', MANUAL: 'MANUAL_ENTRY' };

export function requisitionOrigin(type: string | null | undefined, source: string | null | undefined, t: Translate): string {
  const typeLabel = labelOf(REQ_TYPE_LABEL, type, t);
  if (!type || !source || SOURCE_REPEATS_TYPE[type] === source) return typeLabel;
  return `${typeLabel} · ${labelOf(SOURCE_LABEL, source, t)}`;
}

export function humanizeCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function labelOf(map: LabelMap, code: string | null | undefined, t: Translate): string {
  if (!code) return "—";
  const entry = map[code];
  if (!entry) return humanizeCode(code);
  return t(typeof entry === "string" ? entry : entry.key);
}

export function variantOf(map: LabelMap, code: string | null | undefined): BadgeVariant {
  const entry = code ? map[code] : undefined;
  return entry && typeof entry !== "string" ? entry.variant : "neutral";
}

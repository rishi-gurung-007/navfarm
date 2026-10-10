"use client";

/**
 * A feed requisition as a document (Task 9, Rishi 3 Oct): the Requisition and
 * Loading Sheet's §1 header as a form, in workbook order, and its §2 lines as a
 * sub-form below — each order line (one destination silo and item, Engine Step
 * 8) with its batch/house breakdown nested beneath it (B1: "Per Batch, Per
 * House, and Per Silo", MOM Feed and Logistic 21 Aug 2026).
 *
 * Presentational: the caller owns the edits and the save/submit actions, so the
 * same document serves Inventory → Requisitions and, later, the Approvals
 * inbox. `editable` is the caller's decision (isEditableFeedRequisition); when
 * false nothing here is an input. "Current Silo Feed Item No." is not shown —
 * the workbook removed it (rows 12, 44).
 */
import { FeedRequisitionHeaderFields, bulkTotalAndTrips } from "./feed-requisition-header";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ReasonSelect } from "@/components/ui/reason-select";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import {
  DOC_TYPE_LABEL, FEED_TYPE_LABEL, PRIORITY_LABEL, PURPOSE_LABEL, REQ_STATUS_LABEL, SOURCE_LABEL, SUPPLY_LABEL, labelOf, variantOf,
} from "./requisition-labels";

export interface FeedRequisitionBreakdownRow {
  batch_id: string;
  batch_no: string | null;
  /**
   * 9d D2: the stage group this row is for. requisition_line_batch's unique key
   * is (line_id, batch_id, stage_id, shed_id) — a REGISTERED batch has several
   * stage groups in one house, so batch + shed does not identify a row. NULL
   * only on rows written before migration 0145.
   */
  stage_id?: string | null;
  shed_id: string | null;
  shed_code: string | null;
  heads: number | null;
  feed_rate_kg: number | null;
  lifecycle_ref_label: string | null;
  demand_kg: number;
  first_demand_date: string | null;
}

export interface FeedRequisitionLine {
  line_id: string;
  line_seq: number;
  destination_location_id: string | null;
  destination_code: string | null;
  destination_name?: string | null;
  item_id: string | null;
  item_code: string | null;
  item_description: string | null;
  required_item_id: string | null;
  feed_type: string | null;
  is_next_diet: boolean;
  days_before_diet_change: number | null;
  lifecycle_ref_label: string | null;
  system_balance_kg: string | null;
  daily_requirement_kg: string | null;
  days_remaining: string | number | null;
  first_shortage_date: string | null;
  unrounded_need_kg: string | null;
  recommended_qty_kg: string | null;
  recommended_delivery_date?: string | null;
  quantity: string;
  bag_count: number | null;
  proposed_delivery_date: string | null;
  exceeds_silo_capacity: boolean;
  needs_silo_changeover?: boolean;
  reason_id?: string | null;
  reason_code?: string | null;
  reason_name?: string | null;
  reason_label?: string | null;
  exception_reason: string | null;
  requested_qty_kg?: number | null;
  mill_approved_qty_kg?: number | null;
  adjustment_reason?: string | null;
  breakdown?: FeedRequisitionBreakdownRow[];
}

export interface FeedRequisitionHeader {
  farm_code: string | null;
  farm_name: string | null;
  requisition_date: string | null;
  is_next_diet_requisition: boolean;
  farm_total_requested_kg: number;
  truck_target_kg: number;
  bulk_multiple_kg: number;
  /** Bag size from the feed planning settings; absent on a header written before 9c. */
  bag_size_kg?: number;
  trips: number;
  required_delivery_date: string | null;
  approved_by_name: string | null;
  linked_transfer_no: string | null;
  forecast_run_no: string | null;
  consolidation_no?: string | null;
  consolidation_status?: string | null;
  consolidation_next_action?: string | null;
}

export interface FeedRequisitionDocumentView {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  source: string | null;
  purpose: string | null;
  supply_source: string | null;
  status: string;
  priority: string | null;
  approval_request_id: string | null;
  submission_deadline: string | null;
  remarks: string | null;
  approved_at: string | null;
  /** Saved on the requisition row by the API (GET returns it at the top level). */
  requester_name?: string | null;
  header: FeedRequisitionHeader;
  lines: FeedRequisitionLine[];
  approval_status?: string;
  document_status?: string;
  fulfilment_status?: string;
  actions?: FeedRequisitionWorkflowActions;
  transfers?: FeedRequisitionTransfer[];
}

export const requisitionWorkflowStatus = (view: Pick<FeedRequisitionDocumentView, "status" | "document_status" | "fulfilment_status">) =>
  view.fulfilment_status && view.fulfilment_status !== "NOT_APPLICABLE"
    ? view.fulfilment_status
    : view.document_status === "RELEASED"
      ? "RELEASED"
      : view.status;

export interface FeedWorkflowAction {
  enabled: boolean;
  reason: string | null;
}

export interface FeedRequisitionWorkflowActions {
  release: FeedWorkflowAction;
  shipment: FeedWorkflowAction;
  receipt: FeedWorkflowAction;
}

export interface FeedRequisitionTransferLine {
  transfer_line_id: string;
  requisition_line_id: string | null;
  item_id: string | null;
  item_code?: string | null;
  item_name?: string | null;
  quantity: number;
  uom: string;
  qty_shipped: number;
  qty_received: number;
  balance_to_ship: number;
  remaining_to_receive: number;
}

export interface FeedRequisitionOpenShipmentLine {
  line_id: string;
  requisition_line_id: string | null;
  quantity: number;
  qty_received: number;
  remaining_to_receive: number;
}

export interface FeedRequisitionOpenShipment {
  shipment_id: string;
  shipment_no: string;
  shipment_date: string;
  lines: FeedRequisitionOpenShipmentLine[];
}

export interface FeedRequisitionTransfer {
  transfer_id: string;
  transfer_no: string;
  status: string;
  posting_date: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  bin_assignment_id: string;
  lines: FeedRequisitionTransferLine[];
  open_shipments: FeedRequisitionOpenShipment[];
}

/** What the farm changed on one line, before Save or Submit. */
export interface FeedLineEdit {
  quantity?: string;
  date?: string;
  itemId?: string;
  destinationId?: string;
  reasonId?: string;
}

/** GET /feed-requisition/options: the farm's silos and stores, and its company's feed items. */
export interface FeedRequisitionOptions {
  destinations: { location_id: string; location_code: string; location_name?: string | null; location_type: string }[];
  items: { item_id: string; item_code: string; item_name: string }[];
}

/**
 * GET /feed-requisition/:id — the document view (Task 9). `farm_id` (Task
 * 11): the API's readView already spreads `...row.req`, which carries it;
 * FeedRequisitionDetail uses it to fetch /feed-requisition/options without
 * depending on the caller's own farm-selector state — the Approvals entry
 * point (Task 13) has none.
 *
 * Lives here, not in requisitions-panel.tsx (Task 11 review): both
 * requisitions-panel.tsx and feed-requisition-detail.tsx need it, and putting
 * it in the panel made feed-requisition-detail.tsx import back from the
 * panel — a cycle that would have pulled the panel's list/filter UI into any
 * future standalone consumer (Approvals → Requisitions, Task 13).
 */
export type RequisitionView = FeedRequisitionDocumentView & { production_date?: string | null; farm_id?: string | null };

/** Checkpoint 18, as the API applies it (feed-requisition.rules.ts deviationNeedsRemarks). */
export function needsRemarks(recommended: number | null, requested: number): boolean {
  if (recommended === null) return false;
  if (recommended <= 0) return requested > 0;
  return Math.abs(requested - recommended) / recommended > 0.2 + 1e-9;
}

/**
 * The error shown above Submit (9d F2). It used to be one fixed sentence
 * naming the 20 % deviation and the deadline, so a farm whose only trigger was
 * a moved delivery date (Req. row 29) or an item exception (row 13) was told
 * the wrong reason — Part A verification pass 2. Every cause actually present
 * is named, with the lines it is on, in the order rqdRemarksHint lists them.
 * The API refuses the submit with its own per-line message (approvalProblems);
 * this says so before the click.
 */
export interface RemarksCauses {
  /** line_seq of each line whose quantity is more than 20 % off the recommendation. */
  deviating: number[];
  /** line_seq of each line whose delivery date was moved off the forecast's. */
  moved: number[];
  /** line_seq of each line carrying an item exception. */
  exceptioned: number[];
  /** The submission deadline has passed. */
  late: boolean;
}

export function remarksRequiredMessage(
  t: (key: TranslationKeys, vars?: Record<string, string | number>) => string,
  causes: RemarksCauses,
): string | null {
  const lines = (seqs: number[]) => t(seqs.length > 1 ? "rqRemarksLines" : "rqRemarksLine", { lines: seqs.join(", ") });
  const reasons: string[] = [];
  if (causes.deviating.length) reasons.push(t("rqRemarksWhyQuantity", { lines: lines(causes.deviating) }));
  if (causes.moved.length) reasons.push(t("rqRemarksWhyDate", { lines: lines(causes.moved) }));
  if (causes.exceptioned.length) reasons.push(t("rqRemarksWhyException", { lines: lines(causes.exceptioned) }));
  if (causes.late) reasons.push(t("rqRemarksWhyLate"));
  if (!reasons.length) return null;
  return t("rqRemarksRequired", { reasons: reasons.join("; ") });
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined, empty = "Not yet available") => {
  const n = num(v);
  return n === null ? empty : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
/** Silo Balance row 9: "Displayed to 1 decimal". */
const oneDecimal = (v: string | number | null | undefined, empty = "Not yet available") => {
  const n = num(v);
  return n === null ? empty : n.toFixed(1);
};
/** approved_at is stored UTC (utcTimestamp): the date as everywhere else, then the time, labelled. */
const dateTime = (v: string | null) => (v ? `${formatDateShort(v.slice(0, 10))} ${v.slice(11, 16)} UTC` : null);

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-middle text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[10px] text-[var(--text-muted)]";

const LINE_COLUMNS = [
  "rqdColLineNo", "rqdColSilo", "rqdColItemNo", "rqdColItemDesc", "rqdColReason", "rqdColFeedType", "rqdColNextDiet", "rqdColDaysBefore", "rqdColLifecycle",
  "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining", "rqdColRecommended", "rqdColRequested", "rqdColMillRequested", "rqdColMillApproved", "rqdColAdjustment", "rqdColBags", "rqdColDelivery",
] as const;
const RIGHT = new Set<string>([
  "rqdColLineNo", "rqdColDaysBefore", "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining", "rqdColRecommended", "rqdColRequested", "rqdColMillRequested", "rqdColMillApproved", "rqdColBags",
]);
const BREAKDOWN_COLUMNS = [
  "rqdBreakdownBatch", "rqdBreakdownHouse", "rqdBreakdownHeads", "rqdBreakdownRate", "rqdBreakdownLifecycle", "rqdBreakdownDemand",
] as const;
const BREAKDOWN_RIGHT = new Set<string>(["rqdBreakdownHeads", "rqdBreakdownRate", "rqdBreakdownDemand"]);

/** Requested Qty as the farm currently has it — its edit if any, else the stored quantity. */
export function requestedKgOf(line: FeedRequisitionLine, edit: FeedLineEdit | undefined): number {
  return edit?.quantity !== undefined ? Number(edit.quantity) : Number(line.quantity);
}

/**
 * M2 (final whole-branch review): Requisition row 13 — an item the lifecycle row
 * does not require is an exception and needs a reason. The item as the farm
 * currently has it — its edit if any, else the stored item — because the API
 * decides this AFTER applying edits (feed-requisition.service.ts ~1105-1119,
 * same requiredItemId/itemId comparison). The persisted `line.exception_reason`
 * reflects only the last SAVE, not an edit still open in the browser, so
 * callers that need to know whether submitting NOW will require remarks must
 * use this — not `!!line.exception_reason` — or a farm that changes an item,
 * types a reason and submits without header remarks gets a 400 the pre-click
 * warning never mentioned.
 */
export function isLineExceptioned(line: FeedRequisitionLine, edit: FeedLineEdit | undefined): boolean {
  const itemId = edit?.itemId ?? line.item_id ?? "";
  return !!line.required_item_id && !!itemId && itemId !== line.required_item_id;
}

export function FeedRequisitionDocument({
  view,
  editable,
  edits = {},
  onLineEdit,
  remarks,
  onRemarksChange,
  remarksMissing = false,
  remarksError = null,
  options,
}: {
  view: FeedRequisitionDocumentView;
  editable: boolean;
  edits?: Record<string, FeedLineEdit>;
  onLineEdit?: (lineId: string, patch: FeedLineEdit) => void;
  remarks?: string;
  onRemarksChange?: (value: string) => void;
  remarksMissing?: boolean;
  /**
   * 9d F2: the caller's own sentence naming the causes present and their lines
   * (requisitions-panel remarksRequiredMessage). Without one the generic
   * wording stands, so a caller that only knows "remarks are missing" still
   * shows an error.
   */
  remarksError?: string | null;
  options?: FeedRequisitionOptions | null;
}) {
  const { t } = useLanguage();
  const lines = Array.isArray(view.lines) ? view.lines : [];
  const header = view.header;
  const destinations = options && Array.isArray(options.destinations) ? options.destinations : [];
  const items = options && Array.isArray(options.items) ? options.items : [];
  const canEdit = editable && !!onLineEdit;
  const notAvailable = t("rqNotYetAvailable");

  // Requisition §1 rows 26–27, bagged beside them: the shared helper (feed-requisition-header.tsx).
  const target = header?.truck_target_kg ?? 0;
  const bagSize = header?.bag_size_kg ?? 0;
  const { bulkTotal, trips, baggedCount, baggedKg, baggedBags } = bulkTotalAndTrips(
    lines.map((l) => ({
      feedType: l.feed_type,
      kg: requestedKgOf(l, edits[l.line_id]),
      fallbackBags: edits[l.line_id]?.quantity === undefined ? (l.bag_count ?? 0) : 0,
    })),
    target,
    bagSize,
  );

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        <FeedRequisitionHeaderFields values={{
          reqNo: view.req_no,
          reqDate: header?.requisition_date ? formatDateShort(header.requisition_date) : null,
          reqType: labelOf(DOC_TYPE_LABEL, "ITEM", t),
          source: labelOf(SOURCE_LABEL, view.source, t),
          requesterName: view.requester_name ?? null,
          farmCode: header?.farm_code,
          farmName: header?.farm_name,
          nextDiet: header?.is_next_diet_requisition ? t("rqYes") : t("rqNo"),
          farmTotal: t("rqdFarmTotalValue", { total: bulkTotal.toLocaleString("en-US") }),
          truckTarget: t("rqdTruckTargetValue", { target: target.toLocaleString("en-US"), trips }),
          baggedTotal: baggedCount === 0 ? null
            : bagSize > 0
              ? t("rqdBaggedTotalValue", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US"), size: bagSize.toLocaleString("en-US") })
              : t("rqdBaggedTotalNoSize", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US") }),
          bulkMultiple: header ? t("rqdKgValue", { kg: header.bulk_multiple_kg.toLocaleString("en-US") }) : null,
          requiredDate: header?.required_delivery_date ? formatDateShort(header.required_delivery_date) : null,
          supply: labelOf(SUPPLY_LABEL, view.supply_source, t),
          purpose: labelOf(PURPOSE_LABEL, view.purpose, t),
          status: <Badge variant={variantOf(REQ_STATUS_LABEL, requisitionWorkflowStatus(view))}>{labelOf(REQ_STATUS_LABEL, requisitionWorkflowStatus(view), t)}</Badge>,
          priority: view.priority ? <Badge variant={variantOf(PRIORITY_LABEL, view.priority)}>{labelOf(PRIORITY_LABEL, view.priority, t)}</Badge> : null,
          deadline: view.submission_deadline ? formatDateShort(view.submission_deadline) : null,
          saved: { approvedBy: header?.approved_by_name, approvedAt: dateTime(view.approved_at), linkedTransfer: header?.linked_transfer_no, forecastRun: header?.forecast_run_no },
        }} />
        {(header?.consolidation_no || header?.consolidation_status) && (
          <FieldGroup title="Mill consolidation" className="sm:col-span-12">
            <ReadField className="sm:col-span-6 lg:col-span-4" label="Consolidation sheet" value={header.consolidation_no} mono appearance="control" emptyText={notAvailable} />
            <ReadField className="sm:col-span-6 lg:col-span-4" label="Consolidation status" value={header.consolidation_status} appearance="control" emptyText={notAvailable} />
            <ReadField className="sm:col-span-6 lg:col-span-4" label="Next action" value={header.consolidation_next_action?.replaceAll("_", " ")} appearance="control" emptyText={notAvailable} />
          </FieldGroup>
        )}
        {editable && onRemarksChange ? (
          <Field className="sm:col-span-12" label={t("rqdRemarks")} htmlFor="rqd-remarks" hint={t("rqdRemarksHint")}
            error={remarksMissing ? (remarksError ?? t("rqRemarksRequiredGeneric")) : undefined}>
            <textarea id="rqd-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2}
              value={remarks ?? ""} onChange={(e) => onRemarksChange(e.target.value)} />
          </Field>
        ) : (
          <ReadField className="sm:col-span-12" label={t("rqdRemarks")} value={view.remarks}
            appearance="control" emptyText={t("rqNoRemarks")} />
        )}
      </FieldGroup>

      <FieldGroup title={t("rqdLinesTitle")}>
        <div className="sm:col-span-12">
          <ScrollTable label={t("rqLinesLabel")}>
            <thead>
              <tr>{LINE_COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, RIGHT.has(c) && "text-right")}>{t(c)}</th>)}</tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const edit = edits[line.line_id];
                const itemId = edit?.itemId ?? line.item_id ?? "";
                const destinationId = edit?.destinationId ?? line.destination_location_id ?? "";
                const chosenItem = items.find((i) => i.item_id === itemId);
                const itemCode = chosenItem?.item_code ?? line.item_code;
                const itemDescription = chosenItem?.item_name ?? line.item_description;
                // Requisition row 13: an item the lifecycle row does not require is an exception and needs a reason.
                const isException = isLineExceptioned(line, edit);
                // Review finding (Important 3, Task 9): a silo/item change blanks the forecast-derived
                // columns rather than carrying the old silo's figures (system_balance_kg is the tell).
                // exceeds_silo_capacity can't itself be null (NOT NULL), so without this check a stale
                // row's false would render as a confident "no warning" — indistinguishable from a
                // freshly drafted line that really has none.
                const siloDataStale = line.system_balance_kg === null;
                const breakdown = Array.isArray(line.breakdown) ? line.breakdown : [];
                const seq = line.line_seq;
                return [
                  <tr key={line.line_id}>
                    <td className={cn(TD, NUM)} data-testid="rqd-line-no">{seq}</td>
                    <td className={TD}>
                      {canEdit && destinations.length ? (
                        <SearchableSelect ariaLabel={t("rqdSiloFor", { line: seq })} value={destinationId}
                          placeholder={t("rqNewChoose")} searchPlaceholder={t("crqSearch")} noMatchesLabel={t("crqNoMatches")}
                          triggerClassName="w-72" triggerStyle={inputStyle}
                          options={destinations.map((d) => ({ value: d.location_id, code: d.location_code, name: d.location_name ?? "" }))}
                          getLabel={(option) => `${String(option.code)} — ${String(option.name)}`}
                          getSelectedLabel={(option) => String(option.code)}
                          columns={[{ key: "code", label: t("paramColCode") }, { key: "name", label: t("paramColName") }]}
                          onChange={(value) => onLineEdit?.(line.line_id, { destinationId: value })} />
                      ) : (
                        line.destination_code ?? t("rqNotYetAvailable")
                      )}
                      {line.needs_silo_changeover && <div className={MUTED}>{t("rqChangeover")}</div>}
                    </td>
                    <td className={TD}>
                      {canEdit && items.length ? (
                        <SearchableSelect ariaLabel={t("rqdItemFor", { line: seq })} value={itemId}
                          placeholder={t("rqNewChoose")} searchPlaceholder={t("crqSearch")} noMatchesLabel={t("crqNoMatches")}
                          triggerClassName="w-44" triggerStyle={inputStyle}
                          options={items.map((i) => ({ value: i.item_id, code: i.item_code, description: i.item_name }))}
                          getLabel={(option) => `${String(option.code)} — ${String(option.description)}`}
                          getSelectedLabel={(option) => String(option.code)}
                          columns={[{ key: "code", label: t("paramColCode") }, { key: "description", label: t("crqColDescription") }]}
                          onChange={(value) => onLineEdit?.(line.line_id, { itemId: value })} />
                      ) : (itemCode ?? t("rqNotYetAvailable"))}
                    </td>
                    <td className={TD}>{itemDescription ?? t("rqNotYetAvailable")}</td>
                    <td className={TD}>
                      {canEdit && isException ? (
                        <ReasonSelect ariaLabel={t("rqdExceptionFor", { line: seq })}
                          value={edit?.reasonId ?? line.reason_id ?? line.exception_reason ?? ""} valueFormat="id"
                          category="REQUISITION" placeholder={t("rqNewChooseReason")} searchPlaceholder={t("rqNewSearchReason")}
                          triggerClassName="mt-1 w-56" triggerStyle={inputStyle}
                          onChange={(reasonId) => onLineEdit?.(line.line_id, { reasonId })} />
                      ) : (line.reason_name ?? line.reason_label ?? line.exception_reason) ? (
                        <span>{line.reason_name ?? line.reason_label ?? line.exception_reason}</span>
                      ) : t("rqNotApplicable")}
                    </td>
                    <td className={TD}>{labelOf(FEED_TYPE_LABEL, line.feed_type, t)}</td>
                    <td className={TD}>{line.is_next_diet ? t("rqYes") : t("rqNo")}</td>
                    <td className={cn(TD, NUM)}>{line.days_before_diet_change ?? t("rqNotApplicable")}</td>
                    <td className={TD}>{line.lifecycle_ref_label ?? notAvailable}</td>
                    <td className={cn(TD, NUM)}>{kg(line.system_balance_kg, notAvailable)}</td>
                    <td className={cn(TD, NUM)}>{kg(line.daily_requirement_kg, notAvailable)}</td>
                    <td className={cn(TD, NUM)}>
                      <div>{oneDecimal(line.days_remaining, notAvailable)}</div>
                      {line.first_shortage_date && <div className={MUTED}>{formatDateShort(line.first_shortage_date)}</div>}
                    </td>
                    <td className={cn(TD, NUM)}>
                      <div>{kg(line.recommended_qty_kg, notAvailable)}</div>
                      {line.unrounded_need_kg !== null && <div className={MUTED}>{t("rqdUnrounded", { kg: kg(line.unrounded_need_kg, notAvailable) })}</div>}
                    </td>
                    <td className={cn(TD, NUM)}>{kg(line.requested_qty_kg, notAvailable)}</td>
                    <td className={cn(TD, NUM)}>{kg(line.mill_approved_qty_kg, notAvailable)}</td>
                    <td className={TD}>{line.adjustment_reason ?? t("rqNotApplicable")}</td>
                    <td className={cn(TD, NUM)}>
                      <div className="inline-flex items-center gap-1.5">
                        {siloDataStale ? (
                          <span className={MUTED} data-testid="rqd-capacity-unknown" title={t("rqdCapacityUnknown")}>{notAvailable}</span>
                        ) : line.exceeds_silo_capacity && (
                          // Engine Step 8: a warning, never a cap.
                          <span role="img" aria-label={t("rqdCapacityWarning")} title={t("rqdCapacityWarning")} style={{ color: "var(--warning)" }}>
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {canEdit ? (
                          <input type="number" min={0} step="any" className="nf-input-sm w-28 px-2 text-right" style={inputStyle}
                            aria-label={t("rqdRequestedFor", { line: seq })}
                            value={edit?.quantity ?? String(Number(line.quantity))}
                            onChange={(e) => onLineEdit?.(line.line_id, { quantity: e.target.value })} />
                        ) : kg(line.quantity, notAvailable)}
                      </div>
                    </td>
                    <td className={cn(TD, NUM)}>{line.feed_type === "BAGGED" ? (line.bag_count ?? notAvailable) : t("rqNotApplicable")}</td>
                    <td className={TD}>
                      {canEdit ? (
                        <input type="date" className="nf-input-sm w-36 px-2" style={inputStyle}
                          aria-label={t("rqdDeliveryFor", { line: seq })}
                          value={edit?.date ?? line.proposed_delivery_date ?? ""}
                          onChange={(e) => onLineEdit?.(line.line_id, { date: e.target.value })} />
                      ) : formatDateShort(line.proposed_delivery_date)}
                    </td>
                  </tr>,
                  breakdown.length > 0 && (
                    <tr key={`${line.line_id}-breakdown`}>
                      <td />
                      <td colSpan={LINE_COLUMNS.length - 1} className="px-3 pb-2">
                        <table aria-label={t("rqdBreakdownLabel", { line: seq })} className="w-max border-separate border-spacing-0 text-left text-[11px]">
                          <thead>
                            <tr>
                              {BREAKDOWN_COLUMNS.map((c) => (
                                <th key={c} scope="col" className={cn("whitespace-nowrap px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]", BREAKDOWN_RIGHT.has(c) && "text-right")}>
                                  {t(c)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {breakdown.map((b) => (
                              <tr key={`${b.batch_id}|${b.stage_id ?? ""}|${b.shed_id ?? ""}`}>
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.batch_no ?? notAvailable}</td>
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.shed_code ?? notAvailable}</td>
                                <td className={cn("whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]", NUM)}>{kg(b.heads)}</td>
                                <td className={cn("whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]", NUM)}>
                                  {b.feed_rate_kg === null ? notAvailable : b.feed_rate_kg.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                                </td>
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.lifecycle_ref_label ?? notAvailable}</td>
                                <td className={cn("whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]", NUM)}>{kg(b.demand_kg)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </ScrollTable>
        </div>
      </FieldGroup>
    </div>
  );
}

export default FeedRequisitionDocument;

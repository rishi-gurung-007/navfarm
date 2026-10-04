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
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import {
  FEED_TYPE_LABEL, PRIORITY_LABEL, PURPOSE_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, SOURCE_LABEL, SUPPLY_LABEL, labelOf, variantOf,
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
  exception_reason: string | null;
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
  header: FeedRequisitionHeader;
  lines: FeedRequisitionLine[];
}

/** What the farm changed on one line, before Save or Submit. */
export interface FeedLineEdit {
  quantity?: string;
  date?: string;
  itemId?: string;
  destinationId?: string;
  exceptionReason?: string;
}

/** GET /feed-requisition/options: the farm's silos and stores, and its company's feed items. */
export interface FeedRequisitionOptions {
  destinations: { location_id: string; location_code: string; location_type: string }[];
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
const kg = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
/** Silo Balance row 9: "Displayed to 1 decimal". */
const oneDecimal = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toFixed(1);
};
/** approved_at is stored UTC (utcTimestamp): the date as everywhere else, then the time, labelled. */
const dateTime = (v: string | null) => (v ? `${formatDateShort(v.slice(0, 10))} ${v.slice(11, 16)} UTC` : null);

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-top text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[10px] text-[var(--text-muted)]";
const HALF = "sm:col-span-6";

const LINE_COLUMNS = [
  "rqdColLineNo", "rqdColSilo", "rqdColItemNo", "rqdColItemDesc", "rqdColFeedType", "rqdColNextDiet", "rqdColDaysBefore", "rqdColLifecycle",
  "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining", "rqdColRecommended", "rqdColRequested", "rqdColBags", "rqdColDelivery",
] as const;
const RIGHT = new Set<string>([
  "rqdColLineNo", "rqdColDaysBefore", "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining", "rqdColRecommended", "rqdColRequested", "rqdColBags",
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

  // Requisition §1 rows 26–27: the requested bulk total against the truck target — trips, a target never a block (cp. 17).
  const bulkTotal = lines.filter((l) => l.feed_type === "BULK").reduce((sum, l) => sum + requestedKgOf(l, edits[l.line_id]), 0);
  const target = header?.truck_target_kg ?? 0;
  const trips = target > 0 && bulkTotal > 0 ? Math.ceil(bulkTotal / target) : 0;
  // Requisition row 26 counts bulk only; a bagged line is shown on its own so it is neither folded into the truck target nor invisible.
  const baggedLines = lines.filter((l) => l.feed_type === "BAGGED");
  const baggedKg = baggedLines.reduce((sum, l) => sum + requestedKgOf(l, edits[l.line_id]), 0);
  const bagSize = header?.bag_size_kg ?? 0;
  const baggedBags = baggedLines.reduce((sum, l) => {
    const kgOf = requestedKgOf(l, edits[l.line_id]);
    if (bagSize > 0) return sum + Math.ceil(kgOf / bagSize);
    return sum + (edits[l.line_id]?.quantity === undefined ? (l.bag_count ?? 0) : 0);
  }, 0);

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup title={t("rqdHeaderTitle")}>
        <ReadField className={HALF} label={t("rqdReqNo")} value={view.req_no} mono />
        <ReadField className={HALF} label={t("rqdReqDate")} value={header?.requisition_date ? formatDateShort(header.requisition_date) : null} />
        <ReadField className={HALF} label={t("rqdReqType")} value={labelOf(REQ_TYPE_LABEL, view.requisition_type, t)} />
        <ReadField className={HALF} label={t("rqdSource")} value={labelOf(SOURCE_LABEL, view.source, t)} />
        <ReadField className={HALF} label={t("rqdFarmCode")} value={header?.farm_code} mono />
        <ReadField className={HALF} label={t("rqdFarmName")} value={header?.farm_name} />
        <ReadField className={HALF} label={t("rqdNextDiet")} value={header?.is_next_diet_requisition ? t("rqYes") : t("rqNo")} />
        {/*
         * Req r26-r35, in the workbook's own order (audit gap #13): Farm
         * Total -> Bulk Truck Target -> (Bagged Total, extra, kept beside
         * its bulk counterpart) -> Bulk Order Multiple -> Required Delivery
         * Date -> Supplier -> Purpose -> Status -> Priority -> Deadline.
         * r26 used to fold the truck target and trip count into its own
         * value string, mislabelled "Bulk total requested (vs truck
         * target)"; r27 did not exist as its own field. r32 (Mill Loading
         * Bin No.) stays out of scope (Part B). r34 Priority stays
         * read-only here: the workbook wants the Farm Manager able to
         * escalate it, but UpdateFeedRequisitionDto (feed-requisition.dto.ts)
         * has no priority field and the API only ever sets it by
         * recomputing requisitionPriority() on an auto-draft rerun
         * (feed-requisition.service.ts ~596) — making this editable without
         * a server-side change would silently discard the farm's escalation
         * on the next rerun, so it is left read-only and flagged rather than
         * half-built. r29 (header-level editable Required Delivery Date with
         * a reason) is explicitly out of scope — Rishi has not yet said what
         * a header override should mean when lines carry their own dates.
         */}
        <ReadField className={HALF} label={t("rqdFarmTotal")} value={t("rqdFarmTotalValue", { total: bulkTotal.toLocaleString("en-US") })} />
        <ReadField className={HALF} label={t("rqdTruckTarget")} value={t("rqdTruckTargetValue", { target: target.toLocaleString("en-US"), trips })} />
        {baggedLines.length > 0 && (
          <ReadField className={HALF} label={t("rqdBaggedTotal")}
            value={bagSize > 0
              ? t("rqdBaggedTotalValue", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US"), size: bagSize.toLocaleString("en-US") })
              : t("rqdBaggedTotalNoSize", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US") })} />
        )}
        <ReadField className={HALF} label={t("rqdBulkMultiple")}
          value={header ? t("rqdKgValue", { kg: header.bulk_multiple_kg.toLocaleString("en-US") }) : null} />
        <ReadField className={HALF} label={t("rqdRequiredDate")} value={header?.required_delivery_date ? formatDateShort(header.required_delivery_date) : null} />
        <ReadField className={HALF} label={t("rqdSupply")} value={labelOf(SUPPLY_LABEL, view.supply_source, t)} />
        <ReadField className={HALF} label={t("rqdPurpose")} value={labelOf(PURPOSE_LABEL, view.purpose, t)} />
        <ReadField className={HALF} label={t("rqdStatus")}
          value={<Badge variant={variantOf(REQ_STATUS_LABEL, view.status)}>{labelOf(REQ_STATUS_LABEL, view.status, t)}</Badge>} />
        <ReadField className={HALF} label={t("rqdPriority")}
          value={view.priority ? <Badge variant={variantOf(PRIORITY_LABEL, view.priority)}>{labelOf(PRIORITY_LABEL, view.priority, t)}</Badge> : null} />
        <ReadField className={HALF} label={t("rqdDeadline")} value={view.submission_deadline ? formatDateShort(view.submission_deadline) : null} />
        <ReadField className={HALF} label={t("rqdApprovedBy")} value={header?.approved_by_name} />
        <ReadField className={HALF} label={t("rqdApprovedAt")} value={dateTime(view.approved_at)} />
        <ReadField className={HALF} label={t("rqdLinkedTransfer")} value={header?.linked_transfer_no} mono />
        <ReadField className={HALF} label={t("rqdForecastRun")} value={header?.forecast_run_no} mono />
        {editable && onRemarksChange ? (
          <Field className="sm:col-span-12" label={t("rqdRemarks")} htmlFor="rqd-remarks" hint={t("rqdRemarksHint")}
            error={remarksMissing ? (remarksError ?? t("rqRemarksRequiredGeneric")) : undefined}>
            <textarea id="rqd-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2}
              value={remarks ?? ""} onChange={(e) => onRemarksChange(e.target.value)} />
          </Field>
        ) : (
          <ReadField className="sm:col-span-12" label={t("rqdRemarks")} value={view.remarks} />
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
                        <select className="nf-input-sm nf-select w-36" style={inputStyle} aria-label={t("rqdSiloFor", { line: seq })}
                          value={destinationId} onChange={(e) => onLineEdit?.(line.line_id, { destinationId: e.target.value })}>
                          {destinations.map((d) => <option key={d.location_id} value={d.location_id}>{d.location_code}</option>)}
                        </select>
                      ) : (line.destination_code ?? "—")}
                      {line.needs_silo_changeover && <div className={MUTED}>{t("rqChangeover")}</div>}
                    </td>
                    <td className={TD}>
                      {canEdit && items.length ? (
                        <select className="nf-input-sm nf-select w-28" style={inputStyle} aria-label={t("rqdItemFor", { line: seq })}
                          value={itemId} onChange={(e) => onLineEdit?.(line.line_id, { itemId: e.target.value })}>
                          {items.map((i) => <option key={i.item_id} value={i.item_id}>{i.item_code}</option>)}
                        </select>
                      ) : (itemCode ?? "—")}
                    </td>
                    <td className={TD}>
                      {itemDescription ?? "—"}
                      {canEdit && isException ? (
                        <input type="text" maxLength={180} className="nf-input-sm mt-1 block w-48 px-2" style={inputStyle}
                          aria-label={t("rqdExceptionFor", { line: seq })} placeholder={t("rqdExceptionPlaceholder")}
                          value={edit?.exceptionReason ?? line.exception_reason ?? ""}
                          onChange={(e) => onLineEdit?.(line.line_id, { exceptionReason: e.target.value })} />
                      ) : line.exception_reason ? (
                        <div className={MUTED}>{line.exception_reason}</div>
                      ) : null}
                    </td>
                    <td className={TD}>{labelOf(FEED_TYPE_LABEL, line.feed_type, t)}</td>
                    <td className={TD}>{line.is_next_diet ? t("rqYes") : t("rqNo")}</td>
                    <td className={cn(TD, NUM)}>{line.days_before_diet_change ?? "—"}</td>
                    <td className={TD}>{line.lifecycle_ref_label ?? "—"}</td>
                    <td className={cn(TD, NUM)}>{kg(line.system_balance_kg)}</td>
                    <td className={cn(TD, NUM)}>{kg(line.daily_requirement_kg)}</td>
                    <td className={cn(TD, NUM)}>
                      <div>{oneDecimal(line.days_remaining)}</div>
                      {line.first_shortage_date && <div className={MUTED}>{formatDateShort(line.first_shortage_date)}</div>}
                    </td>
                    <td className={cn(TD, NUM)}>
                      <div>{kg(line.recommended_qty_kg)}</div>
                      {line.unrounded_need_kg !== null && <div className={MUTED}>{t("rqdUnrounded", { kg: kg(line.unrounded_need_kg) })}</div>}
                    </td>
                    <td className={cn(TD, NUM)}>
                      <div className="inline-flex items-center gap-1.5">
                        {siloDataStale ? (
                          <span className={MUTED} data-testid="rqd-capacity-unknown" title={t("rqdCapacityUnknown")}>—</span>
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
                        ) : kg(line.quantity)}
                      </div>
                    </td>
                    <td className={cn(TD, NUM)}>{line.feed_type === "BAGGED" ? (line.bag_count ?? "—") : "—"}</td>
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
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.batch_no ?? "—"}</td>
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.shed_code ?? "—"}</td>
                                <td className={cn("whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]", NUM)}>{kg(b.heads)}</td>
                                <td className={cn("whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]", NUM)}>
                                  {b.feed_rate_kg === null ? "—" : b.feed_rate_kg.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                                </td>
                                <td className="whitespace-nowrap px-2 py-0.5 text-[var(--text-secondary)]">{b.lifecycle_ref_label ?? "—"}</td>
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

"use client";

/**
 * A feed requisition drafted from one saved calculation. Rishi, 30 Oct: laid
 * out like the New feed requisition form (requisition-new-dialog.tsx) — the
 * Requisition §1 header, the remarks, then the §2 lines — filled from the run.
 * The lines are the run's own (the API refuses any other silo or feed), so
 * only Requested Qty, Proposed Delivery Date and Priority No. are editable.
 * The forecast figures, the Breed Lifecycle Row included, come from the run
 * itself (runLineEvidence in the API), with each silo's capacity beside it.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { NA } from "@/utils/na";
import { HoverHint } from "@/components/ui/hover-hint";
import { formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedRequisitionHeaderFields, bulkTotalAndTrips, locationHref, itemHref, RecordLink } from "./feed-requisition-header";
import {
  DOC_TYPE_LABEL,
  FEED_TYPE_LABEL,
  PURPOSE_LABEL,
  REQ_STATUS_LABEL,
  SOURCE_LABEL,
  SUPPLY_LABEL,
  labelOf,
  variantOf,
} from "./requisition-labels";
import type { RequisitionView } from "./feed-requisition-document";
import { fitInSteps, orderStepKg, quantityProblems, type QuantityProblem } from "./requisition-quantity-rules";
import { RequisitionDocumentShell } from "../requisitions/requisition-document-shell";

/** Cell styles of the New feed requisition form. */
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-middle text-xs text-[var(--text-primary)]";
/** Requisition §2 line numbers step by 10000; the number shown is a preview, the API assigns the real one. */
const LINE_STEP = 10000;
const COLUMNS = [
  "rqdColLineNo",
  "rqdColSilo",
  "rqdColSiloCapacity",
  "rqdColItemNo",
  "rqdColItemDesc",
  "rqdColFeedType",
  "rqdColNextDiet",
  "rqdColDaysBefore",
  "rqdColLifecycle",
  "rqdColSystemBalance",
  "rqdColDaily",
  "rqdColDaysRemaining",
  "rqdColRecommended",
  "rqdColRequested",
  "rqdColBags",
  "rqdColDelivery",
  "rqdColPriorityNo",
] as const;
const RIGHT = new Set<string>([
  "rqdColLineNo", "rqdColSiloCapacity", "rqdColDaysBefore", "rqdColSystemBalance", "rqdColDaily", "rqdColDaysRemaining",
  "rqdColRecommended", "rqdColRequested", "rqdColBags", "rqdColPriorityNo",
]);

interface PreviewLine {
  destination_location_id: string;
  destination_code: string;
  destination_name: string;
  item_id: string;
  item_code: string;
  item_name: string;
  recommended_qty_kg: number;
  quantity_kg: number;
  proposed_delivery_date: string;
  feed_type?: "BULK" | "BAGGED";
  /** The forecast figures the saved run held for this silo and item. */
  system_balance_kg?: number | null;
  daily_requirement_kg?: number | null;
  days_remaining?: number | null;
  first_shortage_date?: string | null;
  is_next_diet?: boolean;
  days_before_diet_change?: number | null;
  lifecycle_ref_label?: string | null;
  /** A silo's capacity and projected stock each morning, for the quantity rules; absent for a store. */
  silo_capacity_kg?: number | null;
  silo_on_hand_kg?: number;
  silo_stock_by_date?: Record<string, number>;
  /** Rishi, 30 Oct: the farm's order for this line, 1 first; blank when none is typed. */
  priority_no?: number | "";
}

interface Preview {
  runId: string;
  runCode: string;
  farmId: string;
  existingRequisitionId: string | null;
  settings?: { truckTargetKg?: number; bulkMultipleKg?: number; bagSizeKg?: number };
  lines: PreviewLine[];
}

const kgOrNa = (value: number | null | undefined) =>
  value == null ? NA : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function FeedRequisitionFromRunDialog({ open, runId, farm, onClose, onView }: {
  open: boolean;
  runId: string | null;
  /** The run's farm, for the header's Farm Code and Name. */
  farm?: { code?: string | null; name?: string | null } | null;
  onClose: () => void;
  onView: (view: RequisitionView) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const requester = getStoredUser();

  useEffect(() => {
    if (!open || !runId) return;
    let alive = true;
    setLoading(true);
    setPreview(null);
    setLines([]);
    setRemarks("");
    api.get(`/feed-requisition/from-run/${runId}/preview`)
      .then((response) => {
        if (!alive) return;
        const next = unwrap<Preview>(response);
        setPreview(next);
        // Filled 1..N by delivery date, soonest first; the farm may retype any of them.
        const byDelivery = Array.isArray(next.lines)
          ? [...next.lines].sort((a, b) => a.proposed_delivery_date.localeCompare(b.proposed_delivery_date))
          : [];
        // Rishi, 30 Oct: the quantity filled in is one the silo can take on that date, in whole
        // compartments or bags — the recommendation, cut to what fits when it would overfill the silo.
        const fitted = (line: PreviewLine) => {
          if (line.silo_capacity_kg == null) return line.quantity_kg;
          const stock = line.silo_stock_by_date?.[line.proposed_delivery_date] ?? line.silo_on_hand_kg ?? 0;
          const free = fitInSteps(line.silo_capacity_kg - stock, orderStepKg(line.feed_type, next.settings ?? {}));
          return Math.min(line.quantity_kg, free);
        };
        setLines(Array.isArray(next.lines)
          ? next.lines.map((line) => ({ ...line, quantity_kg: fitted(line), priority_no: byDelivery.indexOf(line) + 1 }))
          : []);
      })
      .catch((err: any) => {
        if (alive) showToast.error(err?.message || tRef.current("rqFromRunLoadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [open, runId]);

  const updateLine = (index: number, patch: Partial<PreviewLine>) => {
    setLines((current) => current.map((line, at) => at === index ? { ...line, ...patch } : line));
  };

  const viewExisting = async () => {
    if (!preview?.existingRequisitionId) return;
    setBusy(true);
    try {
      onView(unwrap<RequisitionView>(await api.get(`/feed-requisition/${preview.existingRequisitionId}`)));
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      const view = unwrap<RequisitionView>(await api.post(`/feed-requisition/from-run/${runId}`, {
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        lines: lines.map((line) => ({
          destination_location_id: line.destination_location_id,
          item_id: line.item_id,
          quantity_kg: Number(line.quantity_kg),
          proposed_delivery_date: line.proposed_delivery_date,
          ...(line.priority_no === "" || line.priority_no == null ? {} : { priority_no: Number(line.priority_no) }),
        })),
      }));
      showToast.success(tRef.current("rqCreated"));
      onView(view);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const validPriorityNo = (value: PreviewLine["priority_no"]) =>
    value === "" || value == null || (Number.isInteger(Number(value)) && Number(value) >= 1);
  const problems: QuantityProblem[] = quantityProblems(
    lines.map((line) => ({
      quantityKg: Number(line.quantity_kg),
      feedType: line.feed_type,
      destinationId: line.destination_location_id,
      deliveryDate: line.proposed_delivery_date,
      capacityKg: line.silo_capacity_kg ?? null,
      stockOn: (date) => line.silo_stock_by_date?.[date] ?? line.silo_on_hand_kg ?? null,
    })),
    preview?.settings ?? {},
  );
  const problemLines = new Set(problems.map((p) => p.line));
  const kgText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const problemText = (p: QuantityProblem) => {
    const line = lines[p.line];
    const at = { line: (p.line + 1) * LINE_STEP, item: line?.item_name ?? "" };
    return p.kind === "MULTIPLE"
      ? t(p.bagged ? "rqQtyNotWholeBags" : "rqQtyNotBulkMultiple", { ...at, kg: kgText(Number(line?.quantity_kg ?? 0)), multiple: kgText(p.multipleKg) })
      : t("rqQtyOverCapacity", { ...at, silo: line?.destination_code ?? "", stock: kgText(p.stockKg), date: formatDateShort(line?.proposed_delivery_date ?? ""), total: kgText(p.totalKg), capacity: kgText(p.capacityKg), fits: kgText(p.fitsKg) });
  };
  const complete = lines.length > 0 && problems.length === 0 && lines.every((line) =>
    Number(line.quantity_kg) > 0 && !!line.proposed_delivery_date && validPriorityNo(line.priority_no));

  // The header is the New form's, worked out from the run's lines and the settings it was saved with.
  const settings = preview?.settings ?? {};
  const bagSizeKg = settings.bagSizeKg ?? 0;
  const { bulkTotal, trips, baggedCount, baggedKg, baggedBags } = bulkTotalAndTrips(
    lines.map((line) => ({ feedType: line.feed_type ?? null, kg: Number(line.quantity_kg) > 0 ? Number(line.quantity_kg) : 0 })),
    settings.truckTargetKg ?? 0,
    bagSizeKg,
  );
  const earliest = lines.map((line) => line.proposed_delivery_date).filter(Boolean).sort()[0] ?? null;
  const today = todayIso();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("rqFromRunTitle")}
      description={preview ? t("rqFromRunDescription", { code: preview.runCode }) : undefined}
      maxWidth="lg"
      footer={preview?.existingRequisitionId ? (
        <Button size="sm" onClick={viewExisting} disabled={busy}>{t("rqViewRequisition")}</Button>
      ) : (
        <>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>{t("rqNewCancel")}</Button>
          <Button size="sm" onClick={create} disabled={busy || loading || !complete}>{t("rqCreateFromSaved")}</Button>
        </>
      )}
    >
      {loading ? <p className="text-sm text-[var(--text-secondary)]">{t("rqFromRunLoading")}</p> : null}
      {!loading && preview && lines.length === 0 ? <InlineAlert variant="info">{t("rqFromRunNoShortage")}</InlineAlert> : null}
      {!loading && preview && lines.length > 0 ? (
        <RequisitionDocumentShell className="text-xs">
          <FieldGroup>
            <FeedRequisitionHeaderFields
              values={{
                reqNo: t("rqnAssignedOnSave"),
                reqDate: formatDateShort(today),
                reqType: labelOf(DOC_TYPE_LABEL, "ITEM", t),
                source: labelOf(SOURCE_LABEL, "AUTO_FORECAST", t),
                requesterLogin: requester?.email,
                requesterName: requester?.fullName,
                requesterDepartment: null,
                farmCode: farm?.code ?? null,
                farmName: farm?.name ?? null,
                nextDiet: t("rqNo"),
                farmTotal: t("rqdFarmTotalValue", { total: bulkTotal.toLocaleString("en-US") }),
                truckTarget: settings.truckTargetKg != null
                  ? t("rqdTruckTargetValue", { target: settings.truckTargetKg.toLocaleString("en-US"), trips })
                  : null,
                baggedTotal: baggedCount === 0
                  ? null
                  : bagSizeKg > 0
                    ? t("rqdBaggedTotalValue", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US"), size: bagSizeKg.toLocaleString("en-US") })
                    : t("rqdBaggedTotalNoSize", { kg: baggedKg.toLocaleString("en-US"), bags: baggedBags.toLocaleString("en-US") }),
                bulkMultiple: settings.bulkMultipleKg != null
                  ? t("rqdKgValue", { kg: settings.bulkMultipleKg.toLocaleString("en-US") })
                  : null,
                requiredDate: earliest ? formatDateShort(earliest) : t("rqnFromLines"),
                supply: labelOf(SUPPLY_LABEL, "MILL", t),
                purpose: labelOf(PURPOSE_LABEL, "INTERNAL_TRANSFER", t),
                status: <Badge variant={variantOf(REQ_STATUS_LABEL, "DRAFT")}>{labelOf(REQ_STATUS_LABEL, "DRAFT", t)}</Badge>,
                deadline: t("rqnSetOnSave"),
              }}
            />
            <Field className="sm:col-span-12" label={t("rqdRemarks")} htmlFor="rq-from-run-remarks">
              <textarea id="rq-from-run-remarks" className="nf-input w-full px-2 py-1" style={inputStyle} rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </Field>
          </FieldGroup>

          <FieldGroup title={t("rqdLinesTitle")}>
            <div className="flex flex-col gap-2 sm:col-span-12">
              {problems.length > 0 && (
                <InlineAlert variant="danger">
                  <ul className="list-disc space-y-1 pl-4">{problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
                </InlineAlert>
              )}
              <ScrollTable label={t("rqFromRunLines")}>
                <thead><tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className={cn(TH, RIGHT.has(column) && "text-right")} title={column === "rqdColPriorityNo" ? t("rqPriorityNoHint") : undefined}>{t(column)}</th>
                  ))}
                </tr></thead>
                <tbody>{lines.map((line, index) => {
                  const bagged = line.feed_type === "BAGGED";
                  return (
                    <tr key={`${line.destination_location_id}:${line.item_id}`}>
                      <td className={cn(TD, "text-right tabular-nums")}>{(index + 1) * LINE_STEP}</td>
                      <td className={TD}><RecordLink code={line.destination_code} href={locationHref(line.destination_location_id)} />{line.destination_name ? <span className="ml-1 text-[var(--text-secondary)]">— {line.destination_name}</span> : null}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{line.silo_capacity_kg != null
                        ? kgOrNa(line.silo_capacity_kg)
                        : <HoverHint hint={t(line.feed_type === "BAGGED" ? "rqNaStoreNoCapacity" : "rqNaNoSiloCapacity")}>{NA}</HoverHint>}</td>
                      <td className={TD}><RecordLink code={line.item_code} href={itemHref(line.item_id)} /></td>
                      <td className={TD}>{line.item_name}</td>
                      <td className={TD}>{line.feed_type ? labelOf(FEED_TYPE_LABEL, line.feed_type, t) : NA}</td>
                      <td className={TD}>{line.is_next_diet ? t("rqYes") : t("rqNo")}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{line.days_before_diet_change ?? (line.is_next_diet ? NA : <HoverHint hint={t("rqNaNotNextDiet")}>{NA}</HoverHint>)}</td>
                      <td className={TD}>{line.lifecycle_ref_label ?? <HoverHint hint={t("rqNaLifecycleNotInRun")}>{NA}</HoverHint>}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{kgOrNa(line.system_balance_kg)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{kgOrNa(line.daily_requirement_kg)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{line.days_remaining == null ? <HoverHint hint={t("rqNaNoDailyUse")}>{NA}</HoverHint> : Number(line.days_remaining).toFixed(1)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{Number(line.recommended_qty_kg).toLocaleString("en-US")}</td>
                      <td className={cn(TD, "text-right")}><input aria-label={t("rqNewKg", { line: index + 1 })} aria-invalid={problemLines.has(index) || undefined} type="number" min="0" step={orderStepKg(line.feed_type, settings) || "any"} className={cn("nf-input-sm w-28 text-right", problemLines.has(index) && "border-[var(--danger)]")} style={problemLines.has(index) ? { ...inputStyle, borderColor: "var(--danger)" } : inputStyle} value={line.quantity_kg} onChange={(event) => updateLine(index, { quantity_kg: Number(event.target.value) })} /></td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bagged && bagSizeKg > 0 ? Math.ceil(Number(line.quantity_kg || 0) / bagSizeKg).toLocaleString("en-US") : t("rqNotApplicable")}</td>
                      <td className={TD}><input aria-label={t("rqNewDate", { line: index + 1 })} type="date" className="nf-input-sm" style={inputStyle} value={line.proposed_delivery_date} onChange={(event) => updateLine(index, { proposed_delivery_date: event.target.value })} /></td>
                      <td className={cn(TD, "text-right")}><input aria-label={t("rqNewPriorityNo", { line: index + 1 })} title={t("rqPriorityNoHint")} type="number" min="1" step="1" inputMode="numeric" className="nf-input-sm w-20 text-right" style={inputStyle} aria-invalid={!validPriorityNo(line.priority_no) || undefined} value={line.priority_no ?? ""} onChange={(event) => updateLine(index, { priority_no: event.target.value === "" ? "" : Number(event.target.value) })} /></td>
                    </tr>
                  );
                })}</tbody>
              </ScrollTable>
            </div>
          </FieldGroup>
        </RequisitionDocumentShell>
      ) : null}
    </Dialog>
  );
}

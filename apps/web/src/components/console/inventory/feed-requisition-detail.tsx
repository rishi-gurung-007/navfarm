"use client";

/**
 * A feed requisition opened for edit and submit (Task 11, moved out of
 * FeedRequisitionPanel without behaviour change). Owns the edits, remarks and
 * silo/item options (GET /feed-requisition/options?farmId=<view.farm_id>),
 * Save (PUT /feed-requisition/:id), Submit (POST /feed-requisition/:id/submit)
 * and the submitted-state message — everything the workbook document
 * (FeedRequisitionDocument) needs around it.
 *
 * Presentational the same way FeedRequisitionDocument is, one level up: the
 * caller owns `view` and is told about a new one (`onView`) so it can update
 * its own list/notice state. That is what lets one component serve both
 * entry points — Inventory → Requisitions (D26) today and, later, Approvals →
 * Requisitions (Task 13) — rendering the identical document from the
 * identical API (Rishi 4 Oct; spec §6a).
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { DialogFooterActions, DialogHeaderActions } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { todayIso, unwrap } from "./feed-format";
import {
  FeedRequisitionDocument, isLineExceptioned, needsRemarks, remarksRequiredMessage, requestedKgOf,
  type FeedLineEdit, type FeedPostedReceipt, type FeedRequisitionLine, type FeedRequisitionOptions, type RequisitionView,
} from "./feed-requisition-document";
import { FEED_TYPE_LABEL, labelOf } from "./requisition-labels";

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
export const isEditable = (v: { status: string; approval_request_id: string | null }) =>
  v.status === "AUTO_DRAFT" || v.status === "DRAFT" || (v.status === "PENDING_APPROVAL" && !v.approval_request_id);

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kgText = (v: string | number | null | undefined, empty: string) => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? empty : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
/** Silo TO Receipt row 24 / checkpoint 27: bag count x bag size within 1 percent of the KG received (the API decides). */
const BAG_TOLERANCE = 0.01;
const transferHref = (transferId: string) => `/inventory/transfers?id=${encodeURIComponent(transferId)}`;

export function FeedRequisitionDetail({
  view,
  onView,
  onBack,
  embedded = false,
}: {
  view: RequisitionView;
  onView: (next: RequisitionView) => void;
  onBack: () => void;
  /**
   * Task 18: true when a `<Dialog>` wraps this detail — the dialog already
   * shows the req_no as its own title and offers its own close control, so
   * the Back button + h2 strip this component otherwise renders on top
   * would be a second one. `onBack` still drives the dialog's close (the
   * caller wires it to the same handler as `onClose`); only the strip itself
   * is suppressed.
   */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [edits, setEdits] = useState<Record<string, FeedLineEdit>>({});
  const [options, setOptions] = useState<FeedRequisitionOptions | null>(null);
  const [remarks, setRemarks] = useState(view.remarks ?? "");
  // Req r34: only an escalation is ever sent.
  const [priority, setPriority] = useState(view.priority ?? "");
  const priorityPatch = () => (priority && priority !== view.priority ? { priority } : {});
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"ship" | "receive" | null>(null);
  const [postingDate, setPostingDate] = useState(todayIso());
  const [transferId, setTransferId] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  // W2T: per requisition line — variance reason, bag count, delivery note no.
  const [receiveReason, setReceiveReason] = useState<Record<string, string>>({});
  const [receiveFinal, setReceiveFinal] = useState<Record<string, boolean>>({});
  const [receiveBags, setReceiveBags] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState<Record<string, string>>({});
  const [lastReceipt, setLastReceipt] = useState<FeedPostedReceipt | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const editLine = (lineId: string, patch: FeedLineEdit) => setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], ...patch } }));
  const lineEdits = () =>
    Object.entries(edits).map(([line_id, edit]) => ({
      line_id,
      ...(edit.quantity !== undefined ? { quantity_kg: Number(edit.quantity) } : {}),
      ...(edit.date !== undefined ? { proposed_delivery_date: edit.date } : {}),
      ...(edit.destinationId !== undefined ? { destination_location_id: edit.destinationId } : {}),
      ...(edit.itemId !== undefined ? { item_id: edit.itemId } : {}),
      ...(edit.reasonId !== undefined ? { reason_id: edit.reasonId } : {}),
    }));

  const editable = isEditable(view);
  const lines: FeedRequisitionLine[] = Array.isArray(view.lines) ? view.lines : [];
  const deviating = lines.filter((l) => needsRemarks(num(l.recommended_qty_kg), requestedKgOf(l, edits[l.line_id])));
  // Req. row 29: a delivery date moved off the forecast's needs remarks too (the API checks it at submit).
  const dateOf = (l: FeedRequisitionLine) => edits[l.line_id]?.date ?? l.proposed_delivery_date ?? "";
  const moved = lines.filter((l) => !!l.recommended_delivery_date && dateOf(l) !== l.recommended_delivery_date);
  // Requisition row 36: Remarks are also required on an item exception (the API checks it at submit, approvalProblems).
  // M2: derived the way the document does (edited item vs required_item_id), not from the
  // PERSISTED exception_reason — the API decides this AFTER applying edits, so a farm that
  // changes an item and submits in the same action must see the warning before it submits.
  const exceptioned = lines.filter((l) => isLineExceptioned(l, edits[l.line_id]));
  const late = !!view.submission_deadline && todayIso() > view.submission_deadline;
  // 9d F2: which causes, on which lines — so the error can say so rather than naming a fixed two.
  const remarksError = editable && !remarks.trim()
    ? remarksRequiredMessage(t, {
      deviating: deviating.map((l) => l.line_seq), moved: moved.map((l) => l.line_seq),
      exceptioned: exceptioned.map((l) => l.line_seq), late,
    })
    : null;
  const remarksMissing = remarksError !== null;
  // The silos and feed items a line may be moved to — only needed while the document is editable.
  useEffect(() => {
    setOptions(null);
    if (!view.requisition_id || !editable || !view.farm_id) return;
    let live = true;
    api
      .get(`/feed-requisition/options?farmId=${encodeURIComponent(view.farm_id)}`)
      .then((res) => {
        const opts = unwrap<FeedRequisitionOptions>(res);
        if (live && opts && Array.isArray(opts.destinations) && Array.isArray(opts.items)) setOptions(opts);
      })
      .catch(() => undefined); // without options the silo and item stay read-only; quantity and date still edit
    return () => {
      live = false;
    };
  }, [view.requisition_id, editable, view.farm_id]);

  const save = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(await api.put(`/feed-requisition/${view.requisition_id}`, { remarks, lines: lineEdits(), ...priorityPatch() }));
      setEdits({});
      setRemarks(result.remarks ?? "");
      showToast.success(tRef.current("rqSaved"));
      onView(result);
    });

  const submit = () =>
    run(async () => {
      if (priorityPatch().priority) await api.put(`/feed-requisition/${view.requisition_id}`, priorityPatch());
      const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/submit`, { remarks, lines: lineEdits() }));
      setEdits({});
      setRemarks(result.remarks ?? "");
      showToast.success(tRef.current("rqSubmitted"));
      onView(result);
    });

  const actions = view.actions ?? {
    release: { enabled: false, reason: t("rqActionUnavailable") },
    shipment: { enabled: false, reason: t("rqActionUnavailable") },
    receipt: { enabled: false, reason: t("rqActionUnavailable") },
  };
  const releaseComplete = view.document_status === "RELEASED" || actions.release.reason?.toLowerCase().includes("already released");
  const workflowBlocker = releaseComplete
    ? (!actions.shipment.enabled && actions.shipment.reason
      ? `Release completed. Transfer Shipment is unavailable: ${actions.shipment.reason}`
      : "Release completed. Post the Transfer Shipment to continue.")
    : !actions.release.enabled && actions.release.reason
      ? `Release is unavailable: ${actions.release.reason}`
    : !actions.shipment.enabled && actions.shipment.reason
      ? `Transfer Shipment is unavailable: ${actions.shipment.reason}`
      : !actions.receipt.enabled && actions.receipt.reason
        ? `Transfer Receipt is unavailable: ${actions.receipt.reason}`
        : null;
  const needsBinDietAssignment = !actions.release.enabled && Boolean(actions.release.reason?.includes("mill BIN assignment"));
  const transfers = view.transfers ?? [];
  const chosenTransfer = transfers.find((transfer) => transfer.transfer_id === transferId) ?? null;
  const chosenShipment = chosenTransfer?.open_shipments.find((shipment) => shipment.shipment_id === shipmentId) ?? null;
  const entered = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const quantity = Number(value);
    return Number.isFinite(quantity) ? quantity : null;
  };
  const withinCap = (value: string | undefined, cap: number) => {
    const quantity = entered(value);
    return quantity === null || (quantity > 0 && quantity <= cap);
  };
  const shipLines = (chosenTransfer?.lines ?? []).filter((line) => !!line.requisition_line_id && line.balance_to_ship > 1e-9);
  const shipBody = shipLines.flatMap((line) => {
    const quantity = entered(shipQty[line.requisition_line_id!]);
    return quantity !== null && quantity > 0 ? [{ requisition_line_id: line.requisition_line_id!, quantity }] : [];
  });
  const shipValid = !!chosenTransfer
    && shipLines.every((line) => withinCap(shipQty[line.requisition_line_id!], line.balance_to_ship))
    && shipBody.length > 0;
  const receiveLines = (chosenShipment?.lines ?? []).filter((line) => !!line.requisition_line_id && line.remaining_to_receive > 1e-9);
  const bagSizeKg = Number(view.header?.bag_size_kg ?? 50) || 50;
  // W2T: what each receipt line shows and checks (Requisition rows 139-148).
  const receiptRows = receiveLines.map((line, index) => {
    const key = line.requisition_line_id!;
    const reqLine = lines.find((l) => l.line_id === key) ?? null;
    const transferLine = chosenTransfer?.lines.find((tl) => tl.transfer_line_id === line.line_id) ?? null;
    const shipped = Number(transferLine?.qty_shipped ?? line.quantity);
    const previouslyReceived = Number(transferLine?.qty_received ?? line.qty_received);
    const outstanding = Number(transferLine?.remaining_to_receive ?? line.remaining_to_receive);
    const quantity = entered(receiveQty[key]);
    const bagged = reqLine?.feed_type === "BAGGED";
    // Requisition row 145: shipped minus everything received once this posting lands.
    const variance = quantity === null ? null : Math.round((shipped - previouslyReceived - quantity) * 10000) / 10000;
    const short = variance !== null && variance > 1e-9;
    const bags = entered(receiveBags[key]);
    const bagsOk = !bagged || quantity === null || (bags !== null && Number.isInteger(bags) && bags > 0
      && Math.abs(bags * bagSizeKg - quantity) <= quantity * BAG_TOLERANCE + 1e-9);
    // Controller reading of Rishi's 10 Oct ruling: only the final receipt can be short; an interim partial needs no reason.
    const final = !!receiveFinal[key];
    const reasonNeeded = final && short;
    const reasonOk = !reasonNeeded || !!receiveReason[key]?.trim();
    const noteOk = quantity === null || !!receiveNote[key]?.trim();
    return { line, key, index, reqLine, transferLine, shipped, previouslyReceived, outstanding, quantity, bagged, variance, short, final, reasonNeeded, bags, bagsOk, reasonOk, noteOk };
  });
  const receiveBody = receiptRows.flatMap((row) => row.quantity !== null && row.quantity > 0 ? [{
    requisition_line_id: row.key,
    quantity: row.quantity,
    delivery_note_no: receiveNote[row.key]?.trim() ?? "",
    ...(row.final ? { final_receipt: true } : {}),
    ...(row.reasonNeeded ? { variance_reason: receiveReason[row.key]?.trim() ?? "" } : {}),
    ...(row.bagged && row.bags !== null ? { bag_count: row.bags } : {}),
  }] : []);
  const receiveValid = !!chosenTransfer && !!chosenShipment
    && receiveLines.every((line) => withinCap(receiveQty[line.requisition_line_id!], line.remaining_to_receive))
    && receiptRows.every((row) => row.quantity === null || (row.bagsOk && row.reasonOk && row.noteOk))
    && receiveBody.length > 0;
  const resetReceiptInputs = () => { setReceiveQty({}); setReceiveReason({}); setReceiveFinal({}); setReceiveBags({}); setReceiveNote({}); };
  const lineNumber = (requisitionLineId: string, fallback: number) =>
    lines.find((line) => line.line_id === requisitionLineId)?.line_seq ?? fallback;

  const release = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/release`, {}));
    showToast.success(tRef.current("rqReleased"));
    onView(result);
  });
  const postShipment = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/shipments`, {
      transfer_id: transferId, posting_date: postingDate, lines: shipBody,
    }));
    setShipQty({});
    showToast.success(tRef.current("crqShipped"));
    onView(result);
  });
  const postReceipt = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/receipts`, {
      transfer_id: transferId, shipment_id: shipmentId, posting_date: postingDate, lines: receiveBody,
    }));
    resetReceiptInputs();
    setLastReceipt(result?.receipt ?? null);
    showToast.success(result?.receipt?.receipt_no
      ? tRef.current("w2tReceiptPosted", { receipt: result.receipt.receipt_no })
      : tRef.current("crqReceived"));
    onView(result);
  });

  const chooseTransfer = (value: string) => {
    setTransferId(value);
    setShipmentId("");
    setShipQty({});
    resetReceiptInputs();
  };

  const actionBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={release} disabled={busy || !actions.release.enabled} title={actions.release.reason ?? undefined}>
        {t("crqRelease")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setPanel(panel === "ship" ? null : "ship")}
        disabled={busy || !actions.shipment.enabled} title={actions.shipment.reason ?? undefined}>
        {t("crqShip")}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setPanel(panel === "receive" ? null : "receive")}
        disabled={busy || !actions.receipt.enabled} title={actions.receipt.reason ?? undefined}>
        {t("crqReceive")}
      </Button>
    </div>
  );

  const transferField = (
    <Field className="w-48" label={t("rqTransfer")} htmlFor={`feed-${panel}-transfer`}>
      <select id={`feed-${panel}-transfer`} className="nf-input-sm nf-select" value={transferId} onChange={(event) => chooseTransfer(event.target.value)}>
        <option value="">{t("crqChoose")}</option>
        {transfers.map((transfer) => <option key={transfer.transfer_id} value={transfer.transfer_id}>{transfer.transfer_no}</option>)}
      </select>
    </Field>
  );

  const dateField = (
    <Field className="w-40" label={t("crqPostingDate")} htmlFor={`feed-${panel}-posting-date`}>
      <input id={`feed-${panel}-posting-date`} type="date" className="nf-input-sm" value={postingDate}
        onChange={(event) => setPostingDate(event.target.value)} />
    </Field>
  );

  return (
    <>
      {!embedded && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> {t("rqBack")}</Button>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{view.req_no}</h2>
        </div>
      )}
      <DialogHeaderActions>{actionBar}</DialogHeaderActions>
      {workflowBlocker && <InlineAlert>{workflowBlocker}{needsBinDietAssignment && <> <a className="font-medium underline" href="/master-data/bin-diet-assignment">Open BIN Diet Assignments</a></>}</InlineAlert>}
      <div className="min-h-0 flex-1 overflow-auto">
        <FeedRequisitionDocument
          view={view}
          editable={editable}
          edits={edits}
          onLineEdit={editLine}
          remarks={remarks}
          onRemarksChange={setRemarks}
          remarksMissing={remarksMissing}
          remarksError={remarksError}
          options={options}
          priority={priority}
          onPriorityChange={setPriority}
        />
      </div>
      {panel === "ship" && actions.shipment.enabled && (
        <div className="flex shrink-0 flex-wrap items-end gap-3 pt-3">
          {dateField}
          {transferField}
          {shipLines.map((line, index) => {
            const key = line.requisition_line_id!;
            return (
              <Field key={key} className="w-40" label={t("crqShipQtyFor", { line: lineNumber(key, index + 1) })} htmlFor={`feed-ship-${key}`}>
                <input id={`feed-ship-${key}`} type="number" min={0} max={line.balance_to_ship} className="nf-input-sm text-right"
                  value={shipQty[key] ?? ""} onChange={(event) => setShipQty((current) => ({ ...current, [key]: event.target.value }))} />
              </Field>
            );
          })}
          <Button size="sm" onClick={postShipment} disabled={busy || !shipValid}>{t("crqPostShipment")}</Button>
        </div>
      )}
      {panel === "receive" && actions.receipt.enabled && (
        <div className="flex shrink-0 flex-wrap items-end gap-3 pt-3">
          {dateField}
          {transferField}
          <Field className="w-48" label={t("crqShipment")} htmlFor="feed-shipment">
            <select id="feed-shipment" className="nf-input-sm nf-select" value={shipmentId}
              onChange={(event) => { setShipmentId(event.target.value); resetReceiptInputs(); }} disabled={!chosenTransfer}>
              <option value="">{t("crqChoose")}</option>
              {(chosenTransfer?.open_shipments ?? []).map((shipment) => (
                <option key={shipment.shipment_id} value={shipment.shipment_id}>{shipment.shipment_no}</option>
              ))}
            </select>
          </Field>
          {chosenTransfer && (
            <a className="pb-1.5 text-xs font-medium underline" style={{ color: "var(--accent)" }} href={transferHref(chosenTransfer.transfer_id)}>
              {t("w2tOpenTransfer", { no: chosenTransfer.transfer_no })}
            </a>
          )}
          {chosenTransfer && chosenShipment && (
            <a className="pb-1.5 text-xs font-medium underline" style={{ color: "var(--accent)" }} href={transferHref(chosenTransfer.transfer_id)}>
              {t("w2tOpenShipment", { no: chosenShipment.shipment_no })}
            </a>
          )}
          <Button size="sm" onClick={postReceipt} disabled={busy || !receiveValid}>{t("crqPostReceipt")}</Button>
          {receiptRows.length > 0 && (
            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs" aria-label={t("w2tReceiptLines")}>
                <thead>
                  <tr style={{ color: "var(--text-secondary)" }}>
                    <th className="px-2 py-1">{t("w2tColLine")}</th>
                    <th className="px-2 py-1">{t("w2tColItem")}</th>
                    <th className="px-2 py-1">{t("w2tColFeedType")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColRequested")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColMillApproved")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColShipped")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColPrevReceived")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColOutstanding")}</th>
                    <th className="px-2 py-1">{t("w2tColCompartment")}</th>
                    <th className="px-2 py-1 text-right">{t("w2tColVariance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptRows.map((row) => {
                    const n = lineNumber(row.key, row.index + 1);
                    const na = t("rqNotApplicable");
                    return (
                      <tr key={row.key} className="align-top border-t" style={{ borderColor: "var(--row-border)" }}>
                        <td className="px-2 py-1">{n}</td>
                        <td className="px-2 py-1">
                          <div className="font-mono">{row.reqLine?.item_code ?? row.transferLine?.item_code ?? na}</div>
                          <div style={{ color: "var(--text-secondary)" }}>{row.reqLine?.item_description ?? row.transferLine?.item_name ?? na}</div>
                        </td>
                        <td className="px-2 py-1">{labelOf(FEED_TYPE_LABEL, row.reqLine?.feed_type ?? null, t)}</td>
                        <td className="px-2 py-1 text-right">{kgText(row.reqLine?.requested_qty_kg ?? row.reqLine?.quantity, na)}</td>
                        <td className="px-2 py-1 text-right">{kgText(row.reqLine?.mill_approved_qty_kg, na)}</td>
                        <td className="px-2 py-1 text-right">{kgText(row.shipped, na)}</td>
                        <td className="px-2 py-1 text-right">{kgText(row.previouslyReceived, na)}</td>
                        <td className="px-2 py-1 text-right">{kgText(row.outstanding, na)}</td>
                        <td className="px-2 py-1">
                          {row.line.compartment_no ?? na}
                          {row.line.loading_sheet_no && <div style={{ color: "var(--text-secondary)" }}>{t("w2tLoadingSheet")}: {row.line.loading_sheet_no}</div>}
                        </td>
                        <td className="px-2 py-1 text-right">{row.variance === null ? na : kgText(row.variance, na)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex flex-col gap-2 pt-2">
                {receiptRows.map((row) => {
                  const n = lineNumber(row.key, row.index + 1);
                  return (
                    <div key={row.key} className="flex flex-wrap items-end gap-3">
                      <Field className="w-40" label={t("crqReceiveQtyFor", { line: n })} htmlFor={`feed-receive-${row.key}`}>
                        <input id={`feed-receive-${row.key}`} type="number" min={0} max={row.line.remaining_to_receive} className="nf-input-sm text-right"
                          value={receiveQty[row.key] ?? ""} onChange={(event) => setReceiveQty((current) => ({ ...current, [row.key]: event.target.value }))} />
                      </Field>
                      <Field className="w-44" label={t("w2tDeliveryNoteFor", { line: n })} htmlFor={`feed-receive-note-${row.key}`}
                        error={row.noteOk ? undefined : t("w2tDeliveryNoteRequired")}>
                        <input id={`feed-receive-note-${row.key}`} type="text" maxLength={80} className="nf-input-sm"
                          value={receiveNote[row.key] ?? ""} onChange={(event) => setReceiveNote((current) => ({ ...current, [row.key]: event.target.value }))} />
                      </Field>
                      {row.bagged && (
                        <Field className="w-36" label={t("w2tBagCountFor", { line: n })} htmlFor={`feed-receive-bags-${row.key}`}
                          error={row.bagsOk ? undefined : t("w2tBagCountHint", { size: bagSizeKg })}>
                          <input id={`feed-receive-bags-${row.key}`} type="number" min={1} step={1} className="nf-input-sm text-right"
                            value={receiveBags[row.key] ?? ""} onChange={(event) => setReceiveBags((current) => ({ ...current, [row.key]: event.target.value }))} />
                        </Field>
                      )}
                      <label className="flex items-center gap-1 pb-1 text-xs" htmlFor={`feed-receive-final-${row.key}`}>
                        <input id={`feed-receive-final-${row.key}`} type="checkbox" checked={!!receiveFinal[row.key]}
                          onChange={(event) => setReceiveFinal((current) => ({ ...current, [row.key]: event.target.checked }))} />
                        {t("w2tFinalReceiptFor", { line: n })}
                      </label>
                      {row.reasonNeeded && (
                        <Field className="min-w-56 flex-1" label={t("w2tVarianceReasonFor", { line: n })} htmlFor={`feed-receive-reason-${row.key}`}
                          error={row.reasonOk ? undefined : t("w2tVarianceReasonRequired")}>
                          <input id={`feed-receive-reason-${row.key}`} type="text" maxLength={500} className="nf-input-sm"
                            value={receiveReason[row.key] ?? ""} onChange={(event) => setReceiveReason((current) => ({ ...current, [row.key]: event.target.value }))} />
                        </Field>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {lastReceipt && (
        <div className="shrink-0 pt-3 text-xs" role="status" aria-label={t("w2tLastReceipt")} style={{ color: "var(--text-primary)" }}>
          <span className="font-semibold">{t("w2tReceiptPosted", { receipt: lastReceipt.receipt_no })}</span>{" "}
          <a className="font-medium underline" style={{ color: "var(--accent)" }} href={transferHref(lastReceipt.transfer_id)}>{t("w2tOpenTransferPlain")}</a>
          {lastReceipt.lines.map((line) => (
            <div key={line.line_id}>
              {t("w2tReceiptLineResult", {
                line: line.requisition_line_id ? lineNumber(line.requisition_line_id, 0) : "",
                kg: kgText(line.qty_received, "0"),
                variance: kgText(line.variance_qty ?? 0, "0"),
                balance: kgText(line.silo_balance_after, t("rqNotApplicable")),
              })}
            </div>
          ))}
        </div>
      )}
      {editable ? (
        <DialogFooterActions>
          <Button size="sm" variant="outline" onClick={save} disabled={busy}>{t("rqSave")}</Button>
          <Button size="sm" onClick={submit} disabled={busy || remarksMissing}>{t("rqSubmit")}</Button>
        </DialogFooterActions>
      ) : view.status === "PENDING_APPROVAL" ? (
        <p className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("rqWaiting")}
        </p>
      ) : null}
    </>
  );
}

export default FeedRequisitionDetail;

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
import { Button } from "@/components/ui/button";
import { DialogFooterActions, DialogHeaderActions } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { todayIso, unwrap } from "./feed-format";
import {
  FeedRequisitionDocument, isLineExceptioned, needsRemarks, remarksRequiredMessage, requestedKgOf,
  type FeedLineEdit, type FeedRequisitionLine, type FeedRequisitionOptions, type RequisitionView,
} from "./feed-requisition-document";

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
export const isEditable = (v: { status: string; approval_request_id: string | null }) =>
  v.status === "AUTO_DRAFT" || v.status === "DRAFT" || (v.status === "PENDING_APPROVAL" && !v.approval_request_id);

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export function FeedRequisitionDetail({
  view,
  onView,
  onBack,
  embedded = false,
}: {
  view: RequisitionView;
  onView: (next: RequisitionView, notice?: string) => void;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"ship" | "receive" | null>(null);
  const [postingDate, setPostingDate] = useState(todayIso());
  const [transferId, setTransferId] = useState("");
  const [shipmentId, setShipmentId] = useState("");
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
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
      const result = unwrap<RequisitionView>(await api.put(`/feed-requisition/${view.requisition_id}`, { remarks, lines: lineEdits() }));
      setEdits({});
      setRemarks(result.remarks ?? "");
      onView(result, tRef.current("rqSaved"));
    });

  const submit = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/submit`, { remarks, lines: lineEdits() }));
      setEdits({});
      setRemarks(result.remarks ?? "");
      onView(result, tRef.current("rqSubmitted"));
    });

  const actions = view.actions ?? {
    release: { enabled: false, reason: t("rqActionUnavailable") },
    shipment: { enabled: false, reason: t("rqActionUnavailable") },
    receipt: { enabled: false, reason: t("rqActionUnavailable") },
  };
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
  const receiveBody = receiveLines.flatMap((line) => {
    const quantity = entered(receiveQty[line.requisition_line_id!]);
    return quantity !== null && quantity > 0 ? [{ requisition_line_id: line.requisition_line_id!, quantity }] : [];
  });
  const receiveValid = !!chosenTransfer && !!chosenShipment
    && receiveLines.every((line) => withinCap(receiveQty[line.requisition_line_id!], line.remaining_to_receive))
    && receiveBody.length > 0;
  const lineNumber = (requisitionLineId: string, fallback: number) =>
    lines.find((line) => line.line_id === requisitionLineId)?.line_seq ?? fallback;

  const release = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/release`, {}));
    onView(result, tRef.current("rqReleased"));
  });
  const postShipment = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/shipments`, {
      transfer_id: transferId, posting_date: postingDate, lines: shipBody,
    }));
    setShipQty({});
    onView(result, tRef.current("crqShipped"));
  });
  const postReceipt = () => run(async () => {
    const result = unwrap<RequisitionView>(await api.post(`/feed-requisition/${view.requisition_id}/receipts`, {
      transfer_id: transferId, shipment_id: shipmentId, posting_date: postingDate, lines: receiveBody,
    }));
    setReceiveQty({});
    onView(result, tRef.current("crqReceived"));
  });

  const chooseTransfer = (value: string) => {
    setTransferId(value);
    setShipmentId("");
    setShipQty({});
    setReceiveQty({});
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
      {error && <InlineAlert>{error}</InlineAlert>}
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
              onChange={(event) => { setShipmentId(event.target.value); setReceiveQty({}); }} disabled={!chosenTransfer}>
              <option value="">{t("crqChoose")}</option>
              {(chosenTransfer?.open_shipments ?? []).map((shipment) => (
                <option key={shipment.shipment_id} value={shipment.shipment_id}>{shipment.shipment_no}</option>
              ))}
            </select>
          </Field>
          {receiveLines.map((line, index) => {
            const key = line.requisition_line_id!;
            return (
              <Field key={key} className="w-40" label={t("crqReceiveQtyFor", { line: lineNumber(key, index + 1) })} htmlFor={`feed-receive-${key}`}>
                <input id={`feed-receive-${key}`} type="number" min={0} max={line.remaining_to_receive} className="nf-input-sm text-right"
                  value={receiveQty[key] ?? ""} onChange={(event) => setReceiveQty((current) => ({ ...current, [key]: event.target.value }))} />
              </Field>
            );
          })}
          <Button size="sm" onClick={postReceipt} disabled={busy || !receiveValid}>{t("crqPostReceipt")}</Button>
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

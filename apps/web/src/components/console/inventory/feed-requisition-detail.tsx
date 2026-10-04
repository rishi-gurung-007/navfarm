"use client";

/**
 * A feed requisition opened for edit and submit (Task 11, moved out of
 * FeedRequisitionPanel without behaviour change). Owns the edits, remarks and
 * silo/item options (GET /feed-requisition/options?farmId=<view.farm_id>),
 * Save (PUT /feed-requisition/:id), Submit (POST /feed-requisition/:id/submit)
 * and the approval link — everything the workbook document
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
import { useLanguage } from "@/hooks/useLanguage";
import { todayIso, unwrap } from "./feed-format";
import {
  FeedRequisitionDocument, isLineExceptioned, needsRemarks, remarksRequiredMessage, requestedKgOf,
  type FeedLineEdit, type FeedRequisitionLine, type FeedRequisitionOptions, type RequisitionView,
} from "./feed-requisition-document";

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
export const isEditable = (v: { status: string; approval_request_id: string | null }) =>
  v.status === "AUTO_DRAFT" || v.status === "DRAFT" || (v.status === "PENDING_APPROVAL" && !v.approval_request_id);

/** The inbox tab a submitted requisition's approval sits in. */
export function approvalHref(v: { status: string; approval_request_id: string | null }): string | null {
  if (!v.approval_request_id) return null;
  const tab = v.status === "APPROVED" ? "approved" : v.status === "REJECTED" ? "rejected" : "pending";
  return `/approvals/${tab}?request=${v.approval_request_id}`;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export function FeedRequisitionDetail({
  view,
  onView,
  onBack,
}: {
  view: RequisitionView;
  onView: (next: RequisitionView, notice?: string) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [edits, setEdits] = useState<Record<string, FeedLineEdit>>({});
  const [options, setOptions] = useState<FeedRequisitionOptions | null>(null);
  const [remarks, setRemarks] = useState(view.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      ...(edit.exceptionReason !== undefined ? { exception_reason: edit.exceptionReason } : {}),
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
  const href = approvalHref(view);

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

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> {t("rqBack")}</Button>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{view.req_no}</h2>
      </div>
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
      <div className="flex shrink-0 flex-col gap-2">
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={save} disabled={busy}>{t("rqSave")}</Button>
            <Button size="sm" onClick={submit} disabled={busy || remarksMissing}>{t("rqSubmit")}</Button>
          </div>
        ) : href ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {view.status === "PENDING_APPROVAL" && <span className="mr-2">{t("rqWaiting")}</span>}
            <a href={href} className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rqOpenApproval")}</a>
          </p>
        ) : null}
      </div>
    </>
  );
}

export default FeedRequisitionDetail;

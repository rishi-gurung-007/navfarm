"use client";

/**
 * The common requisition (Item / Fixed Asset / Service) document and its
 * actions: Save, Submit, Reopen, Release, Link PO, Ship and Receive (Part E,
 * Task 12). Approve and Reject are not here: the Requisition page puts them
 * under the document (RequisitionDecision). There is no link to the Approvals
 * inbox — it no longer lists requisitions (decisions, 5 Oct); the document's
 * own Approval / Approved by / Approved at fields show the decision.
 *
 * The API's PUT /requisition/:id is a FULL REPLACE (omitted remarks,
 * required_date, justification, sender_department_id and direct_transfer
 * become null/false), so Save and Submit always send the whole draft — the
 * header and every line — never a partial body: `toRequisitionPayload` on
 * create, `toRequisitionUpdatePayload` (no company_id) on update.
 *
 * The draft is local state; the caller owns the last server view and is told
 * about each new one (`onView`), which also resets the draft to it.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { todayIso, unwrap } from "../inventory/feed-format";
import { CommonRequisitionDocument, type TrackingAssignment } from "./common-requisition-document";
import {
  commonActions, isCommonEditable, toRequisitionPayload, toRequisitionUpdatePayload, type CommonRequisitionOptions, type CommonRequisitionView,
} from "./common-requisition-model";

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/** A quantity box's text as a number; blank is "nothing entered". */
const entered = (raw: string | undefined) => (raw === undefined || raw.trim() === "" ? null : Number(raw));
/** Valid when blank, or a positive number no larger than the cap. */
const withinCap = (raw: string | undefined, cap: number) => {
  const v = entered(raw);
  return v === null || (Number.isFinite(v) && v > 0 && v <= cap + 1e-9);
};

export function CommonRequisitionDetail({ initial, onView, onBack, embedded = false }: {
  initial: CommonRequisitionView;
  onView: (next: CommonRequisitionView, notice?: string) => void;
  onBack: () => void;
  /**
   * Task 18: true when a `<Dialog>` wraps this detail — see the identical
   * prop on FeedRequisitionDetail for why. `onBack` is unchanged; only the
   * internal Back + title strip is suppressed.
   */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [draft, setDraft] = useState<CommonRequisitionView>(initial);
  const [options, setOptions] = useState<CommonRequisitionOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [poNo, setPoNo] = useState("");
  const [panel, setPanel] = useState<"ship" | "receive" | null>(null);
  const [postingDate, setPostingDate] = useState(todayIso());
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [shipmentId, setShipmentId] = useState("");
  const [recvQty, setRecvQty] = useState<Record<string, string>>({});

  // A new server view replaces the draft and closes whatever was half-entered against the old one.
  useEffect(() => {
    setDraft(initial);
    setPanel(null);
    setShipQty({});
    setRecvQty({});
    setShipmentId("");
    setPoNo("");
  }, [initial]);

  const u = getStoredUser();
  const can = {
    create: hasPermission(u, "PROCUREMENT", "REQUISITION", "can_create"),
    approve: hasPermission(u, "PROCUREMENT", "REQUISITION", "can_approve"),
    transfer: hasPermission(u, "INVENTORY", "STOCK_TRANSFER", "can_edit"),
  };
  const actions = commonActions(draft, can, { userId: u?.userId ?? null, userType: u?.userType ?? null });
  const editable = isCommonEditable(draft);
  const id = draft.requisition_id;

  // WP4a: a released Store document still needs the items' tracking flags,
  // for the Item Tracking button on lines with a balance to ship.
  const releasedStore = draft.purpose === "STORE" && (draft.document_status ?? "OPEN") === "RELEASED";
  const needsOptions = editable || releasedStore;

  useEffect(() => {
    setOptions(null);
    if (!needsOptions) return;
    let live = true;
    api
      .get(`/requisition/options?company_id=${draft.company_id}${draft.farm_id ? `&farm_id=${draft.farm_id}` : ""}`)
      .then((res) => { if (live) setOptions(unwrap<CommonRequisitionOptions>(res)); })
      .catch(() => undefined); // without options the pickers stay empty; the rest of the document still edits
    return () => { live = false; };
  }, [needsOptions, draft.company_id, draft.farm_id]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || tRef.current("crqActionFailed"));
    } finally {
      setBusy(false);
    }
  };
  const emit = (res: unknown, notice: string) => onView(unwrap<CommonRequisitionView>(res), notice);

  const save = () => run(async () => {
    emit(id ? await api.put(`/requisition/${id}`, toRequisitionUpdatePayload(draft)) : await api.post("/requisition", toRequisitionPayload(draft)), tRef.current("crqSaved"));
  });
  const submit = () => run(async () => {
    await api.put(`/requisition/${id}`, toRequisitionUpdatePayload(draft));
    emit(await api.post(`/requisition/${id}/submit`, {}), tRef.current("crqSubmitted"));
  });
  const reopen = () => run(async () => emit(await api.post(`/requisition/${id}/reopen`, {}), tRef.current("crqReopened")));
  const release = () => run(async () => {
    const res = unwrap<CommonRequisitionView>(await api.post(`/requisition/${id}/release`, {}));
    onView(res, res.purpose === "STORE"
      ? tRef.current("crqReleasedStore", { no: res.linked_transfer_no ?? "" })
      : tRef.current("crqReleasedPurchase"));
  });
  // WP4a: Item Tracking after release, for the unshipped balance. Refusals
  // (department, coverage, nothing left to ship) come back as the action error.
  const assignTracking = async (lineId: string, value: TrackingAssignment): Promise<boolean> => {
    let ok = false;
    await run(async () => {
      emit(await api.post(`/requisition/${id}/item-tracking`, { lines: [{ line_id: lineId, ...value }] }), tRef.current("crqTrackingSaved"));
      ok = true;
    });
    return ok;
  };
  const linkPo = () => run(async () => emit(await api.post(`/requisition/${id}/link-po`, { linked_po_no: poNo.trim() }), tRef.current("crqPoLinked")));

  const lineNo = (lineId: string) => {
    const i = draft.lines.findIndex((l) => l.line_id === lineId);
    return i < 0 ? 0 : draft.lines[i].line_seq ?? i + 1;
  };

  // Ship: every line with a balance, capped at that balance.
  const shipLines = draft.lines.filter((l) => !!l.line_id && (l.balance_to_ship ?? 0) > 1e-9);
  const shipBody = shipLines
    .map((l) => ({ line_id: l.line_id as string, quantity: entered(shipQty[l.line_id as string]) }))
    .filter((l) => l.quantity !== null && l.quantity > 0) as { line_id: string; quantity: number }[];
  const shipValid = shipLines.every((l) => withinCap(shipQty[l.line_id as string], l.balance_to_ship ?? 0)) && shipBody.length > 0;
  const ship = () => run(async () =>
    emit(await api.post(`/requisition/${id}/shipment`, { posting_date: postingDate, lines: shipBody }), tRef.current("crqShipped")));

  // Receive: shipments with something left, then that shipment's lines with something left.
  const openShipments = (draft.shipments ?? []).filter((s) => s.lines.some((l) => l.remaining > 1e-9));
  const chosen = openShipments.find((s) => s.shipment_id === shipmentId) ?? null;
  const recvLines = (chosen?.lines ?? []).filter((l) => l.remaining > 1e-9);
  const recvBody = recvLines
    .map((l) => ({ line_id: l.requisition_line_id, quantity: entered(recvQty[l.requisition_line_id]) }))
    .filter((l) => l.quantity !== null && l.quantity > 0) as { line_id: string; quantity: number }[];
  const recvValid = !!chosen && recvLines.every((l) => withinCap(recvQty[l.requisition_line_id], l.remaining)) && recvBody.length > 0;
  const receive = () => run(async () =>
    emit(await api.post(`/requisition/${id}/receipt`, { posting_date: postingDate, shipment_id: shipmentId, lines: recvBody }), tRef.current("crqReceived")));

  const dateField = (
    <Field className="w-40" label={t("crqPostingDate")} htmlFor="crq-posting-date">
      <input id="crq-posting-date" type="date" className="nf-input-sm" style={inputStyle} value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
    </Field>
  );

  return (
    <>
      {!embedded && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> {t("crqBack")}</Button>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{draft.req_no}</h2>
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="min-h-0 flex-1 overflow-auto">
        <CommonRequisitionDocument view={draft} editable={editable} options={options} onChange={setDraft}
          onAssignTracking={releasedStore && can.transfer ? assignTracking : undefined} />
      </div>
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          {actions.includes("save") && <Button size="sm" variant="outline" onClick={save} disabled={busy}>{t("crqSave")}</Button>}
          {actions.includes("submit") && <Button size="sm" onClick={submit} disabled={busy}>{t("crqSubmit")}</Button>}
          {actions.includes("reopen") && <Button size="sm" variant="outline" onClick={reopen} disabled={busy}>{t("crqReopen")}</Button>}
          {actions.includes("release") && <Button size="sm" onClick={release} disabled={busy}>{t("crqRelease")}</Button>}
          {actions.includes("linkPo") && (
            <>
              <Field className="w-56" label={t("crqPoNo")} htmlFor="crq-po-no">
                <input id="crq-po-no" className="nf-input-sm" style={inputStyle} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
              </Field>
              <Button size="sm" onClick={linkPo} disabled={busy || !poNo.trim()}>{t("crqLinkPo")}</Button>
            </>
          )}
          {actions.includes("ship") && <Button size="sm" variant="outline" onClick={() => setPanel(panel === "ship" ? null : "ship")} disabled={busy}>{t("crqShip")}</Button>}
          {actions.includes("receive") && <Button size="sm" variant="outline" onClick={() => setPanel(panel === "receive" ? null : "receive")} disabled={busy}>{t("crqReceive")}</Button>}
        </div>

        {panel === "ship" && actions.includes("ship") && (
          <div className="flex flex-wrap items-end gap-3">
            {dateField}
            {shipLines.map((l) => {
              const no = lineNo(l.line_id as string);
              const key = l.line_id as string;
              return (
                <Field key={key} className="w-40" label={t("crqShipQtyFor", { line: no })} htmlFor={`crq-ship-${key}`}>
                  <input id={`crq-ship-${key}`} type="number" min={0} max={l.balance_to_ship} className="nf-input-sm text-right" style={inputStyle}
                    value={shipQty[key] ?? ""} onChange={(e) => setShipQty((cur) => ({ ...cur, [key]: e.target.value }))} />
                </Field>
              );
            })}
            <Button size="sm" onClick={ship} disabled={busy || !shipValid}>{t("crqPostShipment")}</Button>
          </div>
        )}

        {panel === "receive" && actions.includes("receive") && (
          <div className="flex flex-wrap items-end gap-3">
            {dateField}
            <Field className="w-48" label={t("crqShipment")} htmlFor="crq-shipment">
              <select id="crq-shipment" className="nf-input-sm nf-select" style={inputStyle} value={shipmentId}
                onChange={(e) => { setShipmentId(e.target.value); setRecvQty({}); }}>
                <option value="">{t("crqChoose")}</option>
                {openShipments.map((s) => <option key={s.shipment_id} value={s.shipment_id}>{s.shipment_no}</option>)}
              </select>
            </Field>
            {recvLines.map((l) => {
              const key = l.requisition_line_id;
              return (
                <Field key={key} className="w-40" label={t("crqReceiveQtyFor", { line: lineNo(key) })} htmlFor={`crq-recv-${key}`}>
                  <input id={`crq-recv-${key}`} type="number" min={0} max={l.remaining} className="nf-input-sm text-right" style={inputStyle}
                    value={recvQty[key] ?? ""} onChange={(e) => setRecvQty((cur) => ({ ...cur, [key]: e.target.value }))} />
                </Field>
              );
            })}
            <Button size="sm" onClick={receive} disabled={busy || !recvValid}>{t("crqPostReceipt")}</Button>
          </div>
        )}
      </div>
    </>
  );
}

export default CommonRequisitionDetail;

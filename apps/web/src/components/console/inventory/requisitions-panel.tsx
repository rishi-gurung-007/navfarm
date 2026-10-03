"use client";

/**
 * Inventory → Requisitions (D26; was Feed Requisitions, Plan B Task 10). Type
 * Feed for now. The farm drafts a feed requisition from the forecast (Engine
 * Step 9, POST /feed-requisition/auto-draft) or by hand (Task 14), edits
 * Requested Qty and the delivery date, writes remarks, and submits it for
 * approval (D25): the decision is taken in the Approvals inbox, so this
 * screen has no approve or reject — a submitted requisition links to its
 * approval instead. The 20 % rule and the deadline rule are mirrored here only
 * to say so before the click; the API enforces both (checkpoints 18, 22) and
 * its message is shown as it comes. Fixed-height page: the list, or the open
 * requisition's lines, is the one scrolling table (review C).
 *
 * Task 9: an open requisition is shown as a document — the workbook's header
 * form and its lines sub-form, with each line's batch/house breakdown
 * (FeedRequisitionDocument). The farm may also change a line's silo and feed
 * item; the API checks them (Req. row 13, checkpoint 4).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { todayIso, unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { PRIORITY_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, labelOf, variantOf } from "./requisition-labels";
import {
  FeedRequisitionDocument, requestedKgOf,
  type FeedLineEdit, type FeedRequisitionDocumentView, type FeedRequisitionLine, type FeedRequisitionOptions,
} from "./feed-requisition-document";
import { RequisitionNewDialog } from "./requisition-new-dialog";
import { useFeedFarm } from "./use-feed-farm";

interface ListRow {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  status: string;
  priority: string | null;
  required_date: string | null;
  submission_deadline: string | null;
  line_count: number;
  requested_kg: string | number;
  approval_request_id: string | null;
}

/** GET /feed-requisition/:id — the document view (Task 9). */
export type RequisitionView = FeedRequisitionDocumentView & { production_date?: string | null };

/** Checkpoint 18, as the API applies it (feed-requisition.rules.ts deviationNeedsRemarks). */
export function needsRemarks(recommended: number | null, requested: number): boolean {
  if (recommended === null) return false;
  if (recommended <= 0) return requested > 0;
  return Math.abs(requested - recommended) / recommended > 0.2 + 1e-9;
}

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
const isEditable = (v: { status: string; approval_request_id: string | null }) =>
  v.status === "AUTO_DRAFT" || v.status === "DRAFT" || (v.status === "PENDING_APPROVAL" && !v.approval_request_id);

/** The inbox tab a submitted requisition's approval sits in. */
function approvalHref(v: { status: string; approval_request_id: string | null }): string | null {
  if (!v.approval_request_id) return null;
  const tab = v.status === "APPROVED" ? "approved" : v.status === "REJECTED" ? "rejected" : "pending";
  return `/approvals/${tab}?request=${v.approval_request_id}`;
}

const STATUS_FILTER = ["AUTO_DRAFT", "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"];
const LIST_COLUMNS = ["rqColReqNo", "rqColType", "rqColStatus", "rqColPriority", "rqColRequiredBy", "rqColDeadline", "rqColLines", "rqColKg"] as const;
const RIGHT = new Set<string>(["rqColLines", "rqColKg"]);

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";

export function FeedRequisitionPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const farm = useFeedFarm();
  const farmId = farm.farmId;
  const [type, setType] = useState("FEED");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<RequisitionView | null>(null);
  const [edits, setEdits] = useState<Record<string, FeedLineEdit>>({});
  const [options, setOptions] = useState<FeedRequisitionOptions | null>(null);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);

  const show = (view: RequisitionView | null) => {
    setSelected(view);
    setEdits({});
    setRemarks(view?.remarks ?? "");
  };

  const loadList = useCallback(async () => {
    if (!farmId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ farmId });
      if (status) params.set("status", status);
      const list = unwrap<ListRow[]>(await api.get(`/feed-requisition?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId, status]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Opened from the Approvals inbox (Task 16): /inventory/requisitions?id=<requisition>.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("id");
    } catch {
      id = null;
    }
    if (!id) return;
    api
      .get(`/feed-requisition/${id}`)
      .then((res) => {
        const view = unwrap<RequisitionView>(res);
        setSelected(view);
        setEdits({});
        setRemarks(view?.remarks ?? "");
      })
      .catch((err: any) => setError(err?.message || tRef.current("rqLoadFailed")));
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openRequisition = (id: string) => run(async () => show(unwrap<RequisitionView>(await api.get(`/feed-requisition/${id}`))));

  const draftFromForecast = () =>
    run(async () => {
      const result = unwrap<{ requisition: RequisitionView | null }>(await api.post("/feed-requisition/auto-draft", { farmId }));
      if (result.requisition) show(result.requisition);
      else setNotice(tRef.current("rqNothingToOrder"));
      await loadList();
    });

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

  const editable = !!selected && isEditable(selected);
  const lines: FeedRequisitionLine[] = Array.isArray(selected?.lines) ? selected!.lines : [];
  const deviating = lines.filter((l) => needsRemarks(num(l.recommended_qty_kg), requestedKgOf(l, edits[l.line_id])));
  // Req. row 29: a delivery date moved off the forecast's needs remarks too (the API checks it at submit).
  const dateOf = (l: FeedRequisitionLine) => edits[l.line_id]?.date ?? l.proposed_delivery_date ?? "";
  const moved = lines.filter((l) => !!l.recommended_delivery_date && dateOf(l) !== l.recommended_delivery_date);
  // Requisition row 36: Remarks are also required on an item exception (the API checks it at submit, approvalProblems).
  const exceptioned = lines.filter((l) => !!l.exception_reason);
  const late = !!selected?.submission_deadline && todayIso() > selected.submission_deadline;
  const remarksMissing = editable && (deviating.length > 0 || moved.length > 0 || exceptioned.length > 0 || late) && !remarks.trim();
  const href = selected ? approvalHref(selected) : null;

  // The silos and feed items a line may be moved to — only needed while the document is editable.
  const selectedId = selected?.requisition_id ?? null;
  useEffect(() => {
    setOptions(null);
    if (!selectedId || !editable || !farmId) return;
    let live = true;
    api
      .get(`/feed-requisition/options?farmId=${encodeURIComponent(farmId)}`)
      .then((res) => {
        const opts = unwrap<FeedRequisitionOptions>(res);
        if (live && opts && Array.isArray(opts.destinations) && Array.isArray(opts.items)) setOptions(opts);
      })
      .catch(() => undefined); // without options the silo and item stay read-only; quantity and date still edit
    return () => {
      live = false;
    };
  }, [selectedId, editable, farmId]);

  const save = () =>
    run(async () => {
      show(unwrap<RequisitionView>(await api.put(`/feed-requisition/${selected!.requisition_id}`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("rqSaved"));
    });

  const submit = () =>
    run(async () => {
      show(unwrap<RequisitionView>(await api.post(`/feed-requisition/${selected!.requisition_id}/submit`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("rqSubmitted"));
      await loadList();
    });

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : null
    : undefined;

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <FeedFarmSelect id="rq-farm" label={t("rqFarm")} farms={farm.farms} farmId={farmId} fixedLabel={fixedLabel}
            onChange={(id) => { farm.setFarmId(id); show(null); }} />
          <Field label={t("rqType")} htmlFor="rq-type">
            <select id="rq-type" className="nf-input-sm nf-select" style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="FEED">{t("rqTypeFeed")}</option>
            </select>
          </Field>
          <Field label={t("rqShow")} htmlFor="rq-status">
            <select id="rq-status" className="nf-input-sm nf-select" style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value); show(null); }}>
              <option value="">{t("rqShowAll")}</option>
              {STATUS_FILTER.map((s) => <option key={s} value={s}>{labelOf(REQ_STATUS_LABEL, s, t)}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={!farmId || busy}>{t("rqNew")}</Button>
          <Button size="sm" onClick={draftFromForecast} disabled={!farmId || busy}>{t("rqDraftFromForecast")}</Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      {farm.failed ? (
        // The farm list itself failed to load; "No requisitions for this farm."
        // would blame the data for a request that never arrived.
        <InlineAlert>
          <span className="mr-3">{t("rqFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>{t("rqRetry")}</Button>
        </InlineAlert>
      ) : selected ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => show(null)}><ArrowLeft className="h-3.5 w-3.5" /> {t("rqBack")}</Button>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{selected.req_no}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <FeedRequisitionDocument
              view={selected}
              editable={editable}
              edits={edits}
              onLineEdit={editLine}
              remarks={remarks}
              onRemarksChange={setRemarks}
              remarksMissing={remarksMissing}
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
                {selected.status === "PENDING_APPROVAL" && <span className="mr-2">{t("rqWaiting")}</span>}
                <a href={href} className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rqOpenApproval")}</a>
              </p>
            ) : null}
          </div>
        </>
      ) : loading ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("rqLoading")}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("rqNone")}</div>
      ) : (
        <ScrollTable label={t("rqListLabel")}>
          <thead>
            <tr>{LIST_COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, RIGHT.has(c) && "text-right")}>{t(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requisition_id} className="cursor-pointer" onClick={() => openRequisition(r.requisition_id)}>
                <td className={cn(TD, "font-medium")}>{r.req_no}</td>
                <td className={TD}>{labelOf(REQ_TYPE_LABEL, r.requisition_type, t)}</td>
                <td className={TD}><Badge variant={variantOf(REQ_STATUS_LABEL, r.status)} className={SMALL_BADGE}>{labelOf(REQ_STATUS_LABEL, r.status, t)}</Badge></td>
                <td className={TD}>{r.priority ? <Badge variant={variantOf(PRIORITY_LABEL, r.priority)} className={SMALL_BADGE}>{labelOf(PRIORITY_LABEL, r.priority, t)}</Badge> : "—"}</td>
                <td className={TD}>{formatDateShort(r.required_date)}</td>
                <td className={TD}>{formatDateShort(r.submission_deadline)}</td>
                <td className={cn(TD, NUM)}>{r.line_count}</td>
                <td className={cn(TD, NUM)}>{kg(r.requested_kg)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}

      {farmId && (
        <RequisitionNewDialog
          open={creating}
          farmId={farmId}
          onClose={() => setCreating(false)}
          onCreated={(view) => {
            setCreating(false);
            show(view);
            setNotice(tRef.current("rqCreated"));
            loadList();
          }}
        />
      )}
    </div>
  );
}

/** The Feed Forecast page renders this as one of its three tabs (Task 7). */
export default FeedRequisitionPanel;

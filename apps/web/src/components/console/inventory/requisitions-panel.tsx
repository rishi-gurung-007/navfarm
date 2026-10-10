"use client";

/**
 * Inventory → Requisitions (D26; was Feed Requisitions, Plan B Task 10). Type
 * Feed for now. The farm drafts a feed requisition from the forecast (Engine
 * Step 9, POST /feed-requisition/auto-draft) or by hand (Task 14), edits
 * Requested Qty and the delivery date, writes remarks, and submits it for
 * approval (D25). WP1g (decisions.md 2026-10-05): a feed requisition is decided
 * HERE — an open one shows Approve / Reject (RequisitionDecision, the same
 * component the Requisition page uses, same /approval endpoints). The 20 % rule and the deadline rule are mirrored here only
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
import { Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { RequisitionDecision, decisionTargetOf } from "../requisitions/requisition-decision";
import { DOC_TYPE_LABEL, PRIORITY_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, labelOf, variantOf } from "./requisition-labels";
import { FeedRequisitionDetail } from "./feed-requisition-detail";
import { FeedRequisitionFromRunDialog } from "./feed-requisition-from-run-dialog";
import { FeedConsolidationDialog } from "./feed-consolidation-dialog";
import { RequisitionNewDialog } from "./requisition-new-dialog";
import { useFeedFarm } from "./use-feed-farm";
import type { RequisitionView } from "./feed-requisition-document";

/**
 * `RequisitionView`, `needsRemarks` and `remarksRequiredMessage` live in
 * feed-requisition-document.tsx (Task 11 review): this panel and
 * feed-requisition-detail.tsx both need them, and defining them here made
 * feed-requisition-detail.tsx import back from this file — a cycle that
 * would have pulled the panel's list/filter UI into any future standalone
 * consumer of the detail component (Approvals → Requisitions, Task 13).
 * Re-exported so requisitions-panel.spec.tsx and requisition-new-dialog.tsx
 * keep importing from here unchanged.
 */
export { needsRemarks, remarksRequiredMessage, type RemarksCauses, type RequisitionView } from "./feed-requisition-document";

interface ListRow {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  status: string;
  document_status?: string | null;
  fulfilment_status?: string | null;
  priority: string | null;
  required_date: string | null;
  submission_deadline: string | null;
  line_count: number;
  requested_kg: string | number;
  approval_request_id: string | null;
  farm_code?: string | null;
  farm_name?: string | null;
}

// The API filters the requisition.status column, so only IN_CONSOLIDATION joins the list: RELEASED / SHIPPED / RECEIVED live in document_status / fulfilment_status.
const STATUS_FILTER = ["AUTO_DRAFT", "DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "IN_CONSOLIDATION"];
const LIST_COLUMNS = ["rqColReqNo", "rhColFarm", "rqColType", "rqColSource", "rqColStatus", "rqColPriority", "rqColRequiredBy", "rqColDeadline", "rqColLines", "rqColKg"] as const;
const RIGHT = new Set<string>(["rqColLines", "rqColKg"]);

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined, unavailable: string) => {
  const n = num(v);
  return n === null || !Number.isFinite(n) ? unavailable : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "whitespace-nowrap border-b border-(--border) px-3 py-2 align-top text-sm text-(--text-primary)";
const NUM = "text-right tabular-nums";

const DOT: Record<string, string> = { success: "bg-(--success)", warning: "bg-(--warning)", danger: "bg-(--danger)", info: "bg-(--accent)", accent: "bg-(--accent)", neutral: "bg-(--text-muted)" };
/** A small colour dot plus plain text instead of a badge. */
function StatusDot({ variant, children }: { variant?: string | null; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[variant ?? "neutral"] ?? DOT.neutral}`} />
      {children}
    </span>
  );
}

const workflowStatus = (row: Pick<ListRow, "status" | "document_status" | "fulfilment_status">) =>
  row.fulfilment_status && row.fulfilment_status !== "NOT_APPLICABLE"
    ? row.fulfilment_status
    : row.document_status === "RELEASED"
      ? "RELEASED"
      : row.status;

export function FeedRequisitionPanel() {
  const { t } = useLanguage();
  const unavailable = t("rqNotYetAvailable");
  const tRef = useRef(t);
  tRef.current = t;

  const farm = useFeedFarm();
  const farmId = farm.farmId;
  // Listing defaults to all authorized farms; the selected farm from the
  // shared hook remains the creation/document context for farm-bound actions.
  const [listFarmId, setListFarmId] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<RequisitionView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fromRunOpen, setFromRunOpen] = useState(false);
  const [savedRun, setSavedRun] = useState<{ id: string; existingRequisitionId: string | null } | null>(null);
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const [eligibleCount, setEligibleCount] = useState(0);

  // The API's response always carries farm_id (readView spreads ...row.req); the
  // farm selector's current farm is only a fallback for a response that somehow
  // doesn't, so FeedRequisitionDetail's options fetch (keyed on view.farm_id) is
  // never left without one while this panel has a farm selected.
  const show = (view: RequisitionView | null) => setSelected(view ? { ...view, farm_id: view.farm_id ?? farmId } : null);

  const loadList = useCallback(async () => {
    if (!farm.loaded || (farm.isFixed && !farmId)) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (listFarmId) params.set("farmId", listFarmId);
      if (status) params.set("status", status);
      const list = unwrap<ListRow[]>(await api.get(`/feed-requisition?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farm.loaded, farm.isFixed, farmId, listFarmId, status]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    const params = listFarmId ? `?farmId=${encodeURIComponent(listFarmId)}` : "";
    api.get(`/feed-requisition/consolidations/eligible${params}`).then((response) => setEligibleCount(unwrap<ListRow[]>(response).length)).catch(() => setEligibleCount(0));
  }, [listFarmId, rows]);

  useEffect(() => {
    if (farm.isFixed && farmId) setListFarmId(farmId);
  }, [farm.isFixed, farmId]);

  useEffect(() => {
    if (!farmId) {
      setSavedRun(null);
      return;
    }
    let alive = true;
    api.get(`/feed-forecast/runs/current?${new URLSearchParams({ farmId }).toString()}`)
      .then(async (response) => {
        const run = unwrap<{ run_id?: string; runId?: string } | null>(response);
        const id = run?.run_id ?? run?.runId;
        if (!id) {
          if (alive) setSavedRun(null);
          return;
        }
        const preview = unwrap<{ existingRequisitionId: string | null }>(await api.get(`/feed-requisition/from-run/${id}/preview`));
        if (alive) setSavedRun({ id, existingRequisitionId: preview.existingRequisitionId ?? null });
      })
      .catch(() => { if (alive) setSavedRun(null); });
    return () => { alive = false; };
  }, [farmId, rows]);

  // Opened by link: /inventory/feed-forecast?tab=feed-requisition&id=<requisition> (the Requisition page and the inbox send feed ids here).
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
      .then((res) => show(unwrap<RequisitionView>(res)))
      .catch((err: any) => showToast.error(err?.message || tRef.current("rqLoadFailed")));
  }, []);

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

  const openRequisition = (id: string) => run(async () => show(unwrap<RequisitionView>(await api.get(`/feed-requisition/${id}`))));

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : null
    : undefined;

  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="mb-3 shrink-0">
        <h2 className="text-base font-semibold text-(--text-primary)">{t("rqTitle")}</h2>
        <p className="mt-0.5 text-sm text-(--text-secondary)">{t("rqIntro")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 [&_.nf-input-sm]:h-9 [&>div>button]:h-9">
        <div className="flex flex-wrap items-end gap-3">
          <FeedFarmSelect id="rq-farm" label={t("rqFarm")} farms={farm.farms} farmId={listFarmId} fixedLabel={fixedLabel} allLabel={t("rhAllFarms")}
            onChange={(id) => { setListFarmId(id); if (id) farm.setFarmId(id); show(null); }} />
          <Field label={t("rqShow")} htmlFor="rq-status">
            <select id="rq-status" className="nf-input-sm nf-select" style={inputStyle} value={status} onChange={(e) => { setStatus(e.target.value); show(null); }}>
              <option value="">{t("rqShowAll")}</option>
              {STATUS_FILTER.map((s) => <option key={s} value={s}>{labelOf(REQ_STATUS_LABEL, s, t)}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={!farmId || busy}>{t("rqNew")}</Button>
          {eligibleCount > 0 && <Button size="sm" onClick={() => setConsolidateOpen(true)} disabled={busy}>{t("rqConsolidate", { count: eligibleCount })}</Button>}
          {savedRun && (
            <Button size="sm" onClick={() => setFromRunOpen(true)} disabled={!farmId || busy}>
              {t(savedRun.existingRequisitionId ? "rqViewRequisition" : "rqCreateFromSaved")}
            </Button>
          )}
        </div>
      </div>

      {farm.failed ? (
        // The farm list itself failed to load; "No requisitions for this farm."
        // would blame the data for a request that never arrived.
        <InlineAlert>
          <span className="mr-3">{t("rqFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>{t("rqRetry")}</Button>
        </InlineAlert>
      ) : selected ? (
        // Task 18 (decisions 2026-10-04): created and edited in a dialog, not
        // in place of the list. The dialog supplies the title and close
        // control that FeedRequisitionDetail's own strip would otherwise
        // duplicate — `embedded` suppresses that strip (piece 1).
        <Dialog open onClose={() => setSelected(null)} title={selected.req_no}>
          <FeedRequisitionDetail
            embedded
            view={selected}
            onView={(v) => { setSelected(v); loadList(); }}
            onBack={() => setSelected(null)}
          />
          {/* WP1g: feed requisitions are decided here, through the same
              component and /approval endpoints the Requisition page uses. */}
          {decisionTargetOf(selected) && (
            <RequisitionDecision
              target={decisionTargetOf(selected)!}
              onDecided={async (message) => {
                setSelected(null);
                await loadList();
                showToast.success(message);
              }}
            />
          )}
        </Dialog>
      ) : loading ? (
        <LoadingState label={t("rqLoading")} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title={t("rqNone")} />
      ) : (
        <div className="mt-4 max-h-[65vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
        <table aria-label={t("rqListLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr>{LIST_COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, RIGHT.has(c) && "text-right")}>{t(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requisition_id} className="cursor-pointer hover:bg-(--surface-raised)" onClick={() => openRequisition(r.requisition_id)}>
                <td className={cn(TD, "font-medium")}>{r.req_no}</td>
                <td className={TD}>{r.farm_code ?? unavailable}</td>
                <td className={TD}>{labelOf(DOC_TYPE_LABEL, "ITEM", t)}</td>
                <td className={TD}>{labelOf(REQ_TYPE_LABEL, r.requisition_type, t)}</td>
                <td className={TD}><StatusDot variant={variantOf(REQ_STATUS_LABEL, workflowStatus(r))}>{labelOf(REQ_STATUS_LABEL, workflowStatus(r), t)}</StatusDot></td>
                <td className={TD}>{r.priority ? <StatusDot variant={variantOf(PRIORITY_LABEL, r.priority)}>{labelOf(PRIORITY_LABEL, r.priority, t)}</StatusDot> : unavailable}</td>
                <td className={TD}>{formatDateShort(r.required_date)}</td>
                <td className={TD}>{formatDateShort(r.submission_deadline)}</td>
                <td className={cn(TD, NUM)}>{r.line_count}</td>
                <td className={cn(TD, NUM)}>{kg(r.requested_kg, unavailable)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {farmId && (
        <RequisitionNewDialog
          open={creating}
          farmId={farmId}
          onClose={() => setCreating(false)}
          onCreated={(view) => {
            setCreating(false);
            show(view);
            loadList();
          }}
        />
      )}
      <FeedRequisitionFromRunDialog
        open={fromRunOpen}
        runId={savedRun?.id ?? null}
        onClose={() => setFromRunOpen(false)}
        onView={(view) => {
          setFromRunOpen(false);
          show(view);
          loadList();
        }}
      />
      <FeedConsolidationDialog open={consolidateOpen} onClose={() => setConsolidateOpen(false)} onCreated={(message) => { setConsolidateOpen(false); showToast.success(message); loadList(); }} />
    </div>
  );
}

/** The Feed Forecast page renders this as one of its three tabs (Task 7). */
export default FeedRequisitionPanel;

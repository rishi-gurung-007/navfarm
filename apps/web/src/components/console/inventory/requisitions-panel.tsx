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
import { Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { addDaysIso, defaultWindowEnd, todayIso, unwrap } from "./feed-format";
import { getForecastWindow } from "./feed-forecast-window";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { RequisitionDecision, decisionTargetOf } from "../requisitions/requisition-decision";
import { PRIORITY_LABEL, REQ_STATUS_LABEL, REQ_TYPE_LABEL, labelOf, variantOf } from "./requisition-labels";
import { FeedRequisitionDetail } from "./feed-requisition-detail";
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
  priority: string | null;
  required_date: string | null;
  submission_deadline: string | null;
  line_count: number;
  requested_kg: string | number;
  approval_request_id: string | null;
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);

  // The API's response always carries farm_id (readView spreads ...row.req); the
  // farm selector's current farm is only a fallback for a response that somehow
  // doesn't, so FeedRequisitionDetail's options fetch (keyed on view.farm_id) is
  // never left without one while this panel has a farm selected.
  const show = (view: RequisitionView | null) => setSelected(view ? { ...view, farm_id: view.farm_id ?? farmId } : null);

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
      .then((res) => show(unwrap<RequisitionView>(res)))
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

  // Feed Forecast row 8 / Step 9: draft for the window the Forecast tab is showing, else the 7-day default.
  const draftFromForecast = () =>
    run(async () => {
      // The draft always starts at the farm's today, and the API refuses a `to` before it — or more than 45
      // days after it (autoDraft's own MAX_SPAN_DAYS bound): a window that has already ended on the Forecast
      // tab falls back to the default, and one forward-dated past the bound clamps to it (M3), rather than
      // posting a date that 400s either way.
      const today = todayIso();
      const shared = getForecastWindow(farmId)?.to;
      const maxTo = addDaysIso(today, 45);
      const to = shared && shared >= today ? (shared > maxTo ? maxTo : shared) : defaultWindowEnd(today);
      const result = unwrap<{ requisition: RequisitionView | null }>(await api.post("/feed-requisition/auto-draft", { farmId, to }));
      const through = formatDateShort(to);
      if (result.requisition) {
        show(result.requisition);
        setNotice(tRef.current("rqDraftedThrough", { to: through }));
      } else setNotice(tRef.current("rqNothingToOrder", { to: through }));
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
        // Task 18 (decisions 2026-10-04): created and edited in a dialog, not
        // in place of the list. The dialog supplies the title and close
        // control that FeedRequisitionDetail's own strip would otherwise
        // duplicate — `embedded` suppresses that strip (piece 1).
        <Dialog open onClose={() => setSelected(null)} title={selected.req_no}>
          <FeedRequisitionDetail
            embedded
            view={selected}
            onView={(v, n) => { setSelected(v); if (n) setNotice(n); loadList(); }}
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
                setNotice(message);
              }}
            />
          )}
        </Dialog>
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

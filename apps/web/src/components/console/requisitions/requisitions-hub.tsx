"use client";

/**
 * Requisition — its own top-level menu item (/requisitions; Rishi 5 Oct,
 * docs/decisions.md "Requisition is its own menu item"). It lists and creates
 * Item, Fixed Asset and Service. Feed requisitions are Item requests with a
 * feed source/context: they are listed, opened and created here as well as in
 * the Feed Forecast contextual view.
 *
 * `?id=` (the inbox's link, and the old /inventory/requisitions?id= redirect)
 * is read once: GET /requisition/:id says the kind. A stored FEED id opens the
 * richer feed document in this dialog; anything else opens the common document
 * (CommonRequisitionDetail) from /requisition/:id.
 *
 * Approve / Reject (RequisitionDecision, shared with the Feed Forecast tab)
 * call the existing /approval/:id endpoints, so the checks stay in one place.
 *
 * The common detail resets its draft whenever `initial` changes identity, so
 * it is always given the last server view held in state — never an inline
 * spread, which would wipe unsaved edits on every re-render of this hub.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { getActiveCompanyId, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { todayIso, unwrap } from "../inventory/feed-format";
import { RequisitionNewDialog } from "../inventory/requisition-new-dialog";
import { FeedRequisitionDetail } from "../inventory/feed-requisition-detail";
import { FeedRequisitionFromRunDialog } from "../inventory/feed-requisition-from-run-dialog";
import { FeedFarmSelect } from "../inventory/feed-farm-select";
import { useFeedFarm } from "../inventory/use-feed-farm";
import type { RequisitionView as FeedRequisitionView } from "../inventory/feed-requisition-document";
import {
  APPROVAL_STATE_LABEL, COMMON_PURPOSE_LABEL, DOC_TYPE_LABEL, DOCUMENT_STATE_LABEL, FULFILMENT_STATE_LABEL, REQ_STATUS_LABEL, SOURCE_LABEL,
  labelOf, variantOf,
} from "../inventory/requisition-labels";
import { CommonRequisitionDetail } from "./common-requisition-detail";
import { RequisitionDecision, decisionTargetOf, type RequisitionDecisionTarget } from "./requisition-decision";
import { emptyCommonRequisition, type CommonRequisitionView } from "./common-requisition-model";

interface HubRow {
  requisition_id: string;
  req_no: string;
  doc_type: string;
  purpose: string | null;
  status: string;
  farm_code: string | null;
  requisition_date: string | null;
  required_date: string | null;
  approval_status: string | null;
  document_status: string | null;
  fulfilment_status: string | null;
  approval_request_id: string | null;
  line_count: number;
  requisition_kind?: "FEED" | "COMMON";
  source?: string | null;
}

/** Rishi 4 Oct: a brand-new common requisition's dialog title names its kind (and, for Item, Store or Purchase). */
function newCommonTitleKey(view: { doc_type: string; purpose?: string | null }) {
  if (view.doc_type === "FA") return "crqNewTitleFa" as const;
  if (view.doc_type === "SERVICE") return "crqNewTitleService" as const;
  if (view.doc_type === "ITEM") return view.purpose === "STORE" ? ("crqNewTitleItemStore" as const) : ("crqNewTitleItemPurchase" as const);
  return "crqNewTitle" as const;
}

type Open = CommonRequisitionView | null;
/** The open row's decision surface, carried from the list row (WP1b). */
type Decision = RequisitionDecisionTarget | null;

/** Public business types; the Feed creation route is offered separately as an Item request. */
const TYPES = ["ITEM", "FA", "SERVICE"] as const;
const STATUSES = ["DRAFT", "AUTO_DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"];
const COLUMNS = [
  "rhColReqNo", "rhColType", "rqdSource", "rhColPurpose", "rhColFarm", "rhColDate", "rhColRequired",
  "rhColApproval", "rhColDocument", "rhColFulfilment", "rhColLines",
] as const;

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";

export function RequisitionsHub() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const companyId = getActiveCompanyId();
  const farms = useFeedFarm();
  const [farmId, setFarmId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsCompany, setNeedsCompany] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [openFeed, setOpenFeed] = useState<FeedRequisitionView | null>(null);
  // WP1b: deciding happens in the dialog, through the SAME /approval endpoints
  // the inbox uses — one decide path, one set of checks.
  const [decision, setDecision] = useState<Decision>(null);
  const [savedRun, setSavedRun] = useState<{ id: string; existingRequisitionId: string | null } | null>(null);
  const [fromRunOpen, setFromRunOpen] = useState(false);

  useEffect(() => {
    if (farms.isFixed && farms.farmId) setFarmId(farms.farmId);
  }, [farms.isFixed, farms.farmId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (type) params.set("doc_type", type);
      if (status) params.set("status", status);
      if (waiting) params.set("waiting_for_me", "1");
      if (companyId) params.set("company_id", companyId);
      if (farmId) params.set("farm_id", farmId);
      const list = unwrap<HubRow[]>(await api.get(`/requisition?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [type, status, waiting, companyId, farmId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

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
        if (!id) return alive && setSavedRun(null);
        const preview = unwrap<{ existingRequisitionId?: string | null }>(await api.get(`/feed-requisition/from-run/${id}/preview`));
        if (alive) setSavedRun({ id, existingRequisitionId: preview.existingRequisitionId ?? null });
      })
      .catch(() => { if (alive) setSavedRun(null); });
    return () => { alive = false; };
  }, [farmId, rows]);

  const openRow = async (id: string) => {
    setError("");
    setNotice("");
    setNeedsCompany(false);
    try {
      // The common read identifies the richer feed document without exposing
      // stored FEED as a fourth user-facing requisition type.
      const view = unwrap<CommonRequisitionView & { requisition_kind?: "FEED" | "COMMON" }>(await api.get(`/requisition/${id}`));
      const source = rows.find((r) => r.requisition_id === id);
      setDecision(decisionTargetOf(source));
      if (view?.requisition_kind === "FEED") {
        setOpenFeed(unwrap<FeedRequisitionView>(await api.get(`/feed-requisition/${id}`)));
        setOpen(null);
        return;
      }
      setOpenFeed(null);
      setOpen(view as CommonRequisitionView);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    }
  };

  const openRowRef = useRef(openRow);
  openRowRef.current = openRow;

  // Opened by link: /requisitions?id=<requisition>.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("id");
    } catch {
      id = null;
    }
    if (id) openRowRef.current(id);
  }, []);

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("rhType")} htmlFor="rh-type">
            <select id="rh-type" className="nf-input-sm nf-select" style={inputStyle} value={type}
              onChange={(e) => { setType(e.target.value); setOpen(null); }}>
              <option value="">{t("rhAll")}</option>
              {TYPES.map((k) => <option key={k} value={k}>{labelOf(DOC_TYPE_LABEL, k, t)}</option>)}
            </select>
          </Field>
          <Field label={t("rhStatus")} htmlFor="rh-status">
            <select id="rh-status" className="nf-input-sm nf-select" style={inputStyle} value={status}
              onChange={(e) => { setStatus(e.target.value); setOpen(null); }}>
              <option value="">{t("rhAll")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{labelOf(REQ_STATUS_LABEL, s, t)}</option>)}
            </select>
          </Field>
          <FeedFarmSelect
            id="rh-farm"
            label={t("rhFarm")}
            farms={farms.farms}
            farmId={farmId}
            onChange={(id) => { setFarmId(id); setOpen(null); }}
            allLabel={t("rhAllFarms")}
          />
          {/* WP1b (decisions.md "one Requisitions page"): rows whose open
              approval request the current user may decide — the same predicate
              the Approvals inbox applies, via the API's waiting_for_me filter. */}
          <label htmlFor="rh-waiting" className="flex cursor-pointer items-center gap-2 pb-1 text-xs font-medium text-[var(--text-primary)]">
            <input id="rh-waiting" type="checkbox" className="nf-checkbox" checked={waiting}
              onChange={(e) => { setWaiting(e.target.checked); setOpen(null); }} />
            {t("rhWaitingForMe")}
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {savedRun && (
            <Button size="sm" variant="outline" onClick={() => setFromRunOpen(true)}>
              {t(savedRun.existingRequisitionId ? "rqViewRequisition" : "rqCreateFromSaved")}
            </Button>
          )}
          <Button size="sm" onClick={() => { setNeedsCompany(false); setCreating(true); }}>{t("rhNew")}</Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}
      {needsCompany && <InlineAlert variant="warning">{t("rhNeedsCompany")}</InlineAlert>}

      {openFeed ? (
        <Dialog open onClose={() => { setOpenFeed(null); setDecision(null); }} title={openFeed.req_no}>
          <FeedRequisitionDetail
            embedded
            view={openFeed}
            onView={(next) => { setOpenFeed(next); loadList(); }}
            onBack={() => setOpenFeed(null)}
          />
          {decision && (
            <RequisitionDecision
              target={decision}
              onDecided={async (message) => {
                setOpenFeed(null);
                setDecision(null);
                await loadList();
                setNotice(message);
              }}
            />
          )}
        </Dialog>
      ) : open ? (
        // Task 18 (decisions 2026-10-04): both kinds open in one dialog
        // shell — the dialog supplies the title and close control that each
        // detail's own strip would otherwise duplicate (`embedded`, piece 1).
        // A brand-new common requisition (New -> Item/FA/Service) has no
        // req_no yet, so the title falls back rather than rendering blank.
        <Dialog
          open
          onClose={() => setOpen(null)}
          title={open.req_no || t(newCommonTitleKey(open))}
          headerLeading={!open.requisition_id ? (
            <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setCreating(true); }}>
              <ArrowLeft className="h-3.5 w-3.5" /> {t("crqBack")}
            </Button>
          ) : undefined}
        >
          <CommonRequisitionDetail
            embedded
            initial={open}
            // P1 follow-up item 7: the detail shows its own success notice
            // inside this dialog; the page behind it gets none.
            onView={(v) => { setOpen(v); loadList(); }}
            onBack={() => setOpen(null)}
          />
          {decision && (
            <RequisitionDecision
              target={decision}
              onDecided={async (message) => {
                setOpen(null);
                setDecision(null);
                await loadList();
                setNotice(message);
              }}
            />
          )}
        </Dialog>
      ) : loading ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("rhLoading")}</div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("rhNone")}</div>
      ) : (
        <ScrollTable label={t("rhListLabel")}>
          <thead>
            <tr>{COLUMNS.map((c) => <th key={c} scope="col" className={cn(TH, c === "rhColLines" && "text-right")}>{t(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.requisition_id} className="cursor-pointer" onClick={() => openRow(r.requisition_id)}>
                <td className={cn(TD, "font-medium")}>{r.req_no}</td>
                <td className={TD}>{labelOf(DOC_TYPE_LABEL, r.doc_type, t)}</td>
                <td className={TD}>{labelOf(SOURCE_LABEL, r.source ?? "MANUAL_ENTRY", t)}</td>
                <td className={TD}>{labelOf(COMMON_PURPOSE_LABEL, r.purpose, t)}</td>
                <td className={TD}>{r.farm_code ?? t("rhFarmNotSelected")}</td>
                <td className={TD}>{r.requisition_date ? formatDateShort(r.requisition_date) : t("rhNoRequisitionDate")}</td>
                <td className={TD}>{r.required_date ? formatDateShort(r.required_date) : t("rhNoRequiredDate")}</td>
                <td className={TD}><Badge variant={variantOf(APPROVAL_STATE_LABEL, r.approval_status)} className={SMALL_BADGE}>{labelOf(APPROVAL_STATE_LABEL, r.approval_status, t)}</Badge></td>
                <td className={TD}><Badge variant={variantOf(DOCUMENT_STATE_LABEL, r.document_status)} className={SMALL_BADGE}>{labelOf(DOCUMENT_STATE_LABEL, r.document_status, t)}</Badge></td>
                <td className={TD}><Badge variant={variantOf(FULFILMENT_STATE_LABEL, r.fulfilment_status)} className={SMALL_BADGE}>{labelOf(FULFILMENT_STATE_LABEL, r.fulfilment_status, t)}</Badge></td>
                <td className={cn(TD, "text-right tabular-nums")}>{r.line_count}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}

      <RequisitionNewDialog
        open={creating}
        farmId={farmId || undefined}
        types={["FEED", ...TYPES]}
        onClose={() => setCreating(false)}
        onCreated={(view) => {
          setCreating(false);
          setDecision(null);
          setOpenFeed(view);
          loadList();
        }}
        onCommon={({ docType, purpose }) => {
          setCreating(false);
          // A common requisition belongs to one company; the tenant-wide workspace has none to give it.
          if (!companyId) {
            setNeedsCompany(true);
            return;
          }
          setNotice("");
          setDecision(null);
          const user = getStoredUser();
          const draft = emptyCommonRequisition(companyId, docType, purpose, todayIso(), user?.email ?? null);
          draft.requester_user_id = user?.userId ?? null;
          draft.requester_name = user?.fullName ?? null;
          setOpen(draft);
        }}
      />
      <FeedRequisitionFromRunDialog
        open={fromRunOpen}
        runId={savedRun?.id ?? null}
        onClose={() => setFromRunOpen(false)}
        onView={(view) => {
          setFromRunOpen(false);
          setOpen(null);
          setOpenFeed(view);
          setSavedRun((run) => run ? { ...run, existingRequisitionId: view.requisition_id } : run);
          loadList();
        }}
      />
    </div>
  );
}

export default RequisitionsHub;

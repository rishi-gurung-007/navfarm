"use client";

/**
 * Approvals → Requisitions: the hub for every requisition kind (spec §6a:
 * "Approvals → Requisitions lists all types with a type filter. New offers
 * Feed, Item, Fixed Asset and Service"; Rishi 4 Oct, docs/decisions.md — the
 * Feed Forecast tab creates Feed only, this screen creates and lists all).
 *
 * The list is GET /requisition (FEED rows included, read-only there). Opening
 * a row routes by kind: a FEED row is read from /feed-requisition and shown as
 * the feed document (FeedRequisitionDetail), because every change to a feed
 * requisition goes through the feed module's own rules — the generic routes
 * refuse FEED (API Task 13). Item / Fixed Asset / Service open the common
 * document (CommonRequisitionDetail) from /requisition/:id.
 *
 * `?id=` (the inbox's link, and the old /inventory/requisitions?id= redirect)
 * is read once: GET /requisition/:id says the kind, then as above.
 *
 * The common detail resets its draft whenever `initial` changes identity, so
 * it is always given the last server view held in state — never an inline
 * spread, which would wipe unsaved edits on every re-render of this hub.
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
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import { todayIso, unwrap } from "../inventory/feed-format";
import { FeedRequisitionDetail } from "../inventory/feed-requisition-detail";
import type { RequisitionView as FeedRequisitionView } from "../inventory/feed-requisition-document";
import { RequisitionNewDialog } from "../inventory/requisition-new-dialog";
import {
  APPROVAL_STATE_LABEL, COMMON_PURPOSE_LABEL, DOC_TYPE_LABEL, DOCUMENT_STATE_LABEL, FULFILMENT_STATE_LABEL, REQ_STATUS_LABEL,
  labelOf, variantOf,
} from "../inventory/requisition-labels";
import { CommonRequisitionDetail } from "./common-requisition-detail";
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
  line_count: number;
}

type Open = { kind: "feed"; view: FeedRequisitionView } | { kind: "common"; view: CommonRequisitionView } | null;

const TYPES = ["FEED", "ITEM", "FA", "SERVICE"] as const;
const STATUSES = ["DRAFT", "AUTO_DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"];
const COLUMNS = [
  "rhColReqNo", "rhColType", "rhColPurpose", "rhColFarm", "rhColDate", "rhColRequired",
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
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsCompany, setNeedsCompany] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (type) params.set("doc_type", type);
      if (status) params.set("status", status);
      if (companyId) params.set("company_id", companyId);
      const list = unwrap<HubRow[]>(await api.get(`/requisition?${params.toString()}`));
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [type, status, companyId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openFeed = async (id: string) =>
    setOpen({ kind: "feed", view: unwrap<FeedRequisitionView>(await api.get(`/feed-requisition/${id}`)) });

  /** Route by kind: FEED to the feed document, everything else to the common one. */
  const openRow = async (id: string, docType?: string) => {
    setError("");
    setNotice("");
    setNeedsCompany(false);
    try {
      if (docType === "FEED") return await openFeed(id);
      // GET /requisition/:id answers for every kind, FEED included (read-only).
      const view = unwrap<CommonRequisitionView | { doc_type: "FEED" }>(await api.get(`/requisition/${id}`));
      if (view?.doc_type === "FEED") return await openFeed(id);
      setOpen({ kind: "common", view: view as CommonRequisitionView });
    } catch (err: any) {
      setError(err?.message || tRef.current("rqLoadFailed"));
    }
  };

  const openRowRef = useRef(openRow);
  openRowRef.current = openRow;

  // Opened by link: /approvals/requisitions?id=<requisition>.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = new URLSearchParams(window.location.search).get("id");
    } catch {
      id = null;
    }
    if (id) openRowRef.current(id);
  }, []);

  const afterView = (notice?: string) => {
    if (notice) setNotice(notice);
    loadList();
  };

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
        </div>
        <Button size="sm" onClick={() => { setNeedsCompany(false); setCreating(true); }}>{t("rhNew")}</Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}
      {needsCompany && <InlineAlert variant="warning">{t("rhNeedsCompany")}</InlineAlert>}

      {open ? (
        // Task 18 (decisions 2026-10-04): both kinds open in one dialog
        // shell — the dialog supplies the title and close control that each
        // detail's own strip would otherwise duplicate (`embedded`, piece 1).
        // A brand-new common requisition (New -> Item/FA/Service) has no
        // req_no yet, so the title falls back rather than rendering blank.
        <Dialog
          open
          onClose={() => setOpen(null)}
          title={open.kind === "feed" ? open.view.req_no : (open.view.req_no || t("crqNewTitle"))}
        >
          {open.kind === "feed" ? (
            <FeedRequisitionDetail
              embedded
              view={open.view}
              onView={(v, n) => { setOpen({ kind: "feed", view: v }); afterView(n); }}
              onBack={() => setOpen(null)}
            />
          ) : (
            <CommonRequisitionDetail
              embedded
              initial={open.view}
              onView={(v, n) => { setOpen({ kind: "common", view: v }); afterView(n); }}
              onBack={() => setOpen(null)}
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
              <tr key={r.requisition_id} className="cursor-pointer" onClick={() => openRow(r.requisition_id, r.doc_type)}>
                <td className={cn(TD, "font-medium")}>{r.req_no}</td>
                <td className={TD}>{labelOf(DOC_TYPE_LABEL, r.doc_type, t)}</td>
                <td className={TD}>{labelOf(COMMON_PURPOSE_LABEL, r.purpose, t)}</td>
                <td className={TD}>{r.farm_code ?? "—"}</td>
                <td className={TD}>{formatDateShort(r.requisition_date)}</td>
                <td className={TD}>{formatDateShort(r.required_date)}</td>
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
        types={[...TYPES]}
        onClose={() => setCreating(false)}
        onCreated={(view) => {
          setCreating(false);
          setOpen({ kind: "feed", view });
          afterView(tRef.current("rqCreated"));
        }}
        onCommon={({ docType, purpose }) => {
          setCreating(false);
          // A common requisition belongs to one company; the tenant-wide workspace has none to give it.
          if (!companyId) {
            setNeedsCompany(true);
            return;
          }
          setNotice("");
          setOpen({ kind: "common", view: emptyCommonRequisition(companyId, docType, purpose, todayIso()) });
        }}
      />
    </div>
  );
}

export default RequisitionsHub;

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  Eye,
  Check,
  X,
  Wheat,
  Boxes,
  Layers,
  Stethoscope,
  Building2,
  Plus,
} from "lucide-react";
import { getStoredUser, NavUser, getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { api } from "@/services/api-client";
import { useLanguage } from "@/hooks/useLanguage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useCompanyCurrency, formatMoney, type CompanyCurrency } from "@/hooks/useCompanyCurrency";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * The view shape. `fromApi` maps an `approval_request` row onto it, so the
 * rendering below stays one flat model even though the API returns a wider
 * row (FKs, tenant/company ids, audit columns).
 *
 * This screen used to run on four hardcoded requests kept in `localStorage`:
 * a decision made here was invisible to the person who raised the request and
 * vanished on a different device. Everything now round-trips through
 * /approval.
 */
export type ApprovalItem = {
  id: string;
  doc_type: string;
  doc_no: string;
  title: string;
  requestor: string;
  requestor_role: string;
  location: string;
  batch_no?: string;
  date_submitted: string;
  urgency: "HIGH" | "MEDIUM" | "LOW";
  details: {
    item_or_stage: string;
    requested_qty: string;
    uom: string;
    cost_impact: string;
    justification: string;
  };
  status: ApprovalStatus;
  approval_date?: string;
  approver?: string;
  rejection_reason?: string;
};

type ApiRow = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const fmtMoney = (v: unknown, currency?: CompanyCurrency | null) =>
  v === null || v === undefined || v === ""
    ? "—"
    : formatMoney(v as number, currency);

// The API returns MySQL timestamps ("2026-08-24 22:26:27"); Safari rejects
// that format in `new Date()`, so normalise before formatting.
const formatStamp = (v?: string | null) => {
  if (!v) return "—";
  const parsed = new Date(v.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? v : parsed.toLocaleString();
};

function fromApi(r: ApiRow, currency?: CompanyCurrency | null): ApprovalItem {
  return {
    id: r.request_id,
    doc_type: r.doc_type,
    doc_no: r.doc_no,
    title: r.title,
    requestor: r.requestor_label || "—",
    requestor_role: r.requestor_role || "—",
    location: r.location_label || "—",
    batch_no: r.batch_no || undefined,
    date_submitted: formatStamp(r.submitted_at),
    urgency: (r.urgency || "MEDIUM") as ApprovalItem["urgency"],
    details: {
      item_or_stage: r.item_or_stage || "—",
      requested_qty: r.requested_qty || "—",
      uom: r.uom || "",
      cost_impact: fmtMoney(r.cost_impact, currency),
      justification: r.justification || "—",
    },
    status: r.status as ApprovalStatus,
    approval_date: r.decided_at ? formatStamp(r.decided_at) : undefined,
    approver: r.decider_label || undefined,
    rejection_reason: r.rejection_reason || undefined,
  };
}

const TAB_ROUTES: Record<ApprovalStatus, string> = {
  PENDING: "/approvals/pending",
  APPROVED: "/approvals/approved",
  REJECTED: "/approvals/rejected",
};

export function ApprovalsPageShell({ activeTab }: { activeTab: ApprovalStatus }) {
  const { currency } = useCompanyCurrency();
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [batches, setBatches] = useState<ApiRow[]>([]);
  const [busy, setBusy] = useState(false);

  // Detail Modal
  const [viewingItem, setViewingItem] = useState<ApprovalItem | null>(null);

  // Reject Modal
  const [rejectItem, setRejectItem] = useState<ApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newType, setNewType] = useState<ApprovalItem["doc_type"]>("FEED_RATION");
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newBatchId, setNewBatchId] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newJustification, setNewJustification] = useState("");

  // Action feedback
  const [actionMsg, setActionMsg] = useState("");

  const companyId = getActiveCompanyId();
  const areaId = getActiveOperationalAreaId();

  // Badges come from /approval/counts, not from measuring the loaded page —
  // the list is paginated, so counting what happens to be on screen would
  // under-report the moment there is more than one page of approvals.
  const [counts, setCounts] = useState<Record<ApprovalStatus, number>>({
    PENDING: 0, APPROVED: 0, REJECTED: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("company_id", companyId);
      if (areaId) params.set("operational_area_id", areaId);
      const [res, countRes] = await Promise.all([
        api.get(`/approval?${params.toString()}`),
        api.get(`/approval/counts?${params.toString()}`).catch(() => null),
      ]);
      setApprovals((unwrap<ApiRow[]>(res) || []).map((r) => fromApi(r, currency)));
      const fetched = countRes ? unwrap<Partial<Record<ApprovalStatus, number>>>(countRes) : null;
      if (fetched) {
        setCounts({
          PENDING: Number(fetched.PENDING ?? 0),
          APPROVED: Number(fetched.APPROVED ?? 0),
          REJECTED: Number(fetched.REJECTED ?? 0),
        });
      }
    } catch (err: any) {
      setLoadError(err?.message || t("apFailedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [companyId, areaId, t]);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  // Real batches for the request form — this dropdown used to offer three
  // hardcoded batch numbers that existed in no tenant.
  useEffect(() => {
    if (!ready || !companyId) return;
    api
      .get(`/batch?companyId=${companyId}&limit=200`)
      .then((r) => {
        const rows = unwrap<ApiRow[]>(r) || [];
        setBatches(areaId ? rows.filter((b) => b.operational_area_id === areaId) : rows);
      })
      .catch(() => setBatches([]));
  }, [ready, companyId, areaId]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(""), 3500);
  };

  const handleApprove = async (item: ApprovalItem) => {
    setBusy(true);
    try {
      await api.post(`/approval/${item.id}/approve`);
      if (viewingItem?.id === item.id) setViewingItem(null);
      await load();
      flash(t("apApprovedMsg", { docNo: item.doc_no }));
    } catch (err: any) {
      flash(err?.message || t("apActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectItem) return;
    setBusy(true);
    try {
      await api.post(`/approval/${rejectItem.id}/reject`, { rejection_reason: rejectReason || undefined });
      if (viewingItem?.id === rejectItem.id) setViewingItem(null);
      const docNo = rejectItem.doc_no;
      setRejectItem(null);
      setRejectReason("");
      await load();
      flash(t("apRejectedMsg", { docNo }));
    } catch (err: any) {
      flash(err?.message || t("apActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateApproval = async () => {
    if (!newTitle || !newItemName || !companyId) return;
    setBusy(true);
    try {
      // The cost field is free text on the form ("₹ 12,000"); strip anything
      // that isn't part of a number before sending it to a decimal column.
      const costNumber = Number(newCost.replace(/[^0-9.-]/g, ""));
      const res = await api.post(`/approval`, {
        company_id: companyId,
        ...(areaId ? { operational_area_id: areaId } : {}),
        doc_type: newType,
        title: newTitle,
        ...(newLocation.trim() ? { location_label: newLocation.trim() } : {}),
        ...(newBatchId ? { batch_id: newBatchId } : {}),
        item_or_stage: newItemName,
        ...(newQty.trim() ? { requested_qty: newQty.trim() } : {}),
        ...(Number.isFinite(costNumber) && newCost.trim() ? { cost_impact: costNumber } : {}),
        ...(newJustification.trim() ? { justification: newJustification.trim() } : {}),
      });
      const created = unwrap<ApiRow>(res);
      setCreateModalOpen(false);
      setNewTitle("");
      setNewItemName("");
      setNewQty("");
      setNewCost("");
      setNewJustification("");
      await load();
      flash(t("apCreatedMsg", { docNo: created?.doc_no || "" }));
    } catch (err: any) {
      flash(err?.message || t("apActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !user) return null;

  const pendingCount = counts.PENDING;
  const approvedCount = counts.APPROVED;
  const rejectedCount = counts.REJECTED;

  const filteredList = approvals
    .filter((a) => a.status === activeTab)
    .filter((a) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        a.doc_no.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.requestor.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        (a.batch_no && a.batch_no.toLowerCase().includes(q))
      );
    });

  const getDocTypeBadge = (type: ApprovalItem["doc_type"]) => {
    switch (type) {
      case "FEED_RATION":
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"><Wheat className="h-3 w-3" /> {t("apDocType_FEED_RATION")}</span>;
      case "GRN_RECEIPT":
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"><Boxes className="h-3 w-3" /> {t("apDocType_GRN_RECEIPT")}</span>;
      case "STOCK_TRANSFER":
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/20"><Building2 className="h-3 w-3" /> {t("apDocType_STOCK_TRANSFER")}</span>;
      case "STAGE_CLOSE":
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"><Layers className="h-3 w-3" /> {t("apDocType_STAGE_CLOSE")}</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-[var(--radius-xs)] bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"><Stethoscope className="h-3 w-3" /> {t("apDocType_VET_DISPOSAL")}</span>;
    }
  };

  return (
    <ConsolePage>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <PageHeader
          title={t("apTitle")}
          description={t("apDesc")}
          sticky={false}
        />

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("apSearchPlaceholder")}
              className="nf-input pl-8 w-full text-xs"
            />
          </div>

          <Button
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            className="nf-btn-primary text-xs h-8 gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" /> {t("apNewRequest")}
          </Button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-md)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {/* ── Filter Tabs ── */}
      <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => router.push(TAB_ROUTES.PENDING)}
          className={`nf-press px-4 py-2 rounded-[var(--radius-sm)] text-xs font-semibold flex items-center gap-2 transition-colors ${
            activeTab === "PENDING"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>{t("apTabPending")}</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${activeTab === "PENDING" ? "bg-white/20 text-white" : "bg-amber-500/20 text-amber-700 dark:text-amber-400"}`}>
            {pendingCount}
          </span>
        </button>

        <button
          onClick={() => router.push(TAB_ROUTES.APPROVED)}
          className={`nf-press px-4 py-2 rounded-[var(--radius-sm)] text-xs font-semibold flex items-center gap-2 transition-colors ${
            activeTab === "APPROVED"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>{t("apTabApproved")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--surface)] text-[var(--text-secondary)]">
            {approvedCount}
          </span>
        </button>

        <button
          onClick={() => router.push(TAB_ROUTES.REJECTED)}
          className={`nf-press px-4 py-2 rounded-[var(--radius-sm)] text-xs font-semibold flex items-center gap-2 transition-colors ${
            activeTab === "REJECTED"
              ? "bg-[var(--accent)] text-white shadow-xs"
              : "bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <XCircle className="h-3.5 w-3.5 text-rose-500" />
          <span>{t("apTabRejected")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[var(--surface)] text-[var(--text-secondary)]">
            {rejectedCount}
          </span>
        </button>
      </div>

      {/* ── Table View ── */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-left text-xs border-collapse">
          <TableHeader>
            <TableRow className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColDocNo")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColType")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColTitle")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColRequestor")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColCostQty")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold">{t("apColDateSubmitted")}</TableHead>
              <TableHead className="py-2.5 px-3 font-semibold text-right">{t("actionsColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[var(--text-muted)]">
                  {t("apLoading")}
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[var(--danger)]">
                  {loadError}
                </TableCell>
              </TableRow>
            ) : filteredList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[var(--text-muted)]">
                  {t("apNoRecords")}
                </TableCell>
              </TableRow>
            ) : (
              filteredList.map((item) => (
                <TableRow key={item.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)] transition-colors">
                  <TableCell className="py-3 px-3 font-mono font-bold text-[var(--text-primary)]">
                    {item.doc_no}
                  </TableCell>
                  <TableCell className="py-3 px-3">
                    {getDocTypeBadge(item.doc_type)}
                  </TableCell>
                  <TableCell className="py-3 px-3">
                    <p className="font-semibold text-[var(--text-primary)]">{item.title}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">{item.location} {item.batch_no ? `• ${t("apBatchLabel")}: ${item.batch_no}` : ""}</p>
                  </TableCell>
                  <TableCell className="py-3 px-3">
                    <span className="font-medium text-[var(--text-primary)]">{item.requestor}</span>
                    <span className="block text-[10px] text-[var(--text-secondary)]">{item.requestor_role}</span>
                  </TableCell>
                  <TableCell className="py-3 px-3">
                    <span className="font-bold text-[var(--text-primary)]">{item.details.cost_impact}</span>
                    <span className="block text-[10px] text-[var(--text-secondary)]">{item.details.requested_qty}</span>
                  </TableCell>
                  <TableCell className="py-3 px-3 text-[var(--text-secondary)] font-mono text-[11px]">
                    {item.date_submitted}
                  </TableCell>
                  <TableCell className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setViewingItem(item)}
                        className="h-7 text-xs px-2 gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" /> {t("apDetails")}
                      </Button>

                      {item.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleApprove(item)}
                            disabled={busy}
                            className="h-7 text-xs px-2.5 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                          >
                            <Check className="h-3.5 w-3.5" /> {t("apApprove")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setRejectItem(item)}
                            className="h-7 text-xs px-2.5 gap-1"
                          >
                            <X className="h-3.5 w-3.5" /> {t("apReject")}
                          </Button>
                        </>
                      )}

                      {item.status === "APPROVED" && (
                        <span className="text-[11px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t("apApproved")}
                        </span>
                      )}

                      {item.status === "REJECTED" && (
                        <span className="text-[11px] text-rose-600 font-semibold inline-flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> {t("apRejected")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>

      {/* ── MODAL: DOCUMENT DETAILS ── */}
      {viewingItem && (
        <Dialog
          open={Boolean(viewingItem)}
          onClose={() => setViewingItem(null)}
          title={t("apModalDetailsTitle", { docNo: viewingItem.doc_no })}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs pt-2">
            <div className="flex items-center justify-between p-3 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] border border-[var(--border)]">
              <div>
                <p className="text-xs text-[var(--text-secondary)]">{t("apDocumentType")}</p>
                <div className="mt-1">{getDocTypeBadge(viewingItem.doc_type)}</div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--text-secondary)]">{t("apCurrentStatus")}</p>
                <p className="font-bold text-sm mt-0.5 text-[var(--text-primary)]">{viewingItem.status}</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-sm text-[var(--text-primary)]">{viewingItem.title}</p>
              <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                <div><span className="font-medium">{t("apRequestorLabel")}</span> {viewingItem.requestor} ({viewingItem.requestor_role})</div>
                <div><span className="font-medium">{t("apLocationLabel")}</span> {viewingItem.location}</div>
                {viewingItem.batch_no && <div><span className="font-medium">{t("apBatchNoLabel")}</span> {viewingItem.batch_no}</div>}
                <div><span className="font-medium">{t("apSubmittedLabel")}</span> {viewingItem.date_submitted}</div>
              </div>
            </div>

            <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
              <p className="font-semibold text-[var(--text-primary)]">{t("apJustificationHeader")}</p>
              <div className="p-3 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] space-y-1.5">
                <p><span className="font-medium text-[var(--text-secondary)]">{t("apItemAction")}</span> <span className="font-semibold text-[var(--text-primary)]">{viewingItem.details.item_or_stage}</span></p>
                <p><span className="font-medium text-[var(--text-secondary)]">{t("apRequestedQty")}</span> <span className="font-mono">{viewingItem.details.requested_qty}</span></p>
                <p><span className="font-medium text-[var(--text-secondary)]">{t("apCostImpact")}</span> <span className="font-bold text-[var(--accent)]">{viewingItem.details.cost_impact}</span></p>
                <p className="pt-1 text-[var(--text-secondary)]"><span className="font-medium text-[var(--text-primary)]">{t("apReasonLabel")}</span> {viewingItem.details.justification}</p>
              </div>
            </div>

            {viewingItem.status === "APPROVED" && viewingItem.approver && (
              <div className="p-2.5 rounded-[var(--radius-xs)] bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                <p className="font-semibold">✓ {t("apAuthorizedBy", { approver: viewingItem.approver })}</p>
                <p className="text-[11px]">{t("apApprovedOn", { date: viewingItem.approval_date || "" })}</p>
              </div>
            )}

            {viewingItem.status === "REJECTED" && viewingItem.rejection_reason && (
              <div className="p-2.5 rounded-[var(--radius-xs)] bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400">
                <p className="font-semibold">✕ {t("apRejectedBy", { approver: viewingItem.approver || "" })}</p>
                <p className="text-[11px]">{t("apReasonPrefix", { reason: viewingItem.rejection_reason })}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <Button variant="outline" onClick={() => setViewingItem(null)}>
                {t("close")}
              </Button>
              {viewingItem.status === "PENDING" && (
                <>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setRejectItem(viewingItem);
                    }}
                  >
                    {t("apRejectRequest")}
                  </Button>
                  <Button
                    onClick={() => handleApprove(viewingItem)}
                    disabled={busy}
                    className="nf-btn-primary"
                  >
                    {t("apApproveDocument")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: REJECT REASON ── */}
      {rejectItem && (
        <Dialog
          open={Boolean(rejectItem)}
          onClose={() => setRejectItem(null)}
          title={t("apModalRejectTitle", { docNo: rejectItem.doc_no })}
          maxWidth="sm"
        >
          <div className="space-y-3 text-xs pt-2">
            <p className="text-[var(--text-secondary)]">
              {t("apRejectPrompt", { docNo: rejectItem.doc_no })}
            </p>
            <div>
              <label className="font-semibold block mb-1">{t("apRejectionRemarks")}</label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("apRejectPlaceholder")}
                className="nf-input w-full"
              />
            </div>
            <div className="flex justify-end pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <Button variant="destructive" onClick={handleRejectConfirm} disabled={busy}>
                {t("apConfirmRejection")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: CREATE APPROVAL REQUEST ── */}
      {createModalOpen && (
        <Dialog
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title={t("apModalCreateTitle")}
          maxWidth="md"
        >
          <div className="space-y-3.5 text-xs pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-semibold block mb-1">{t("apDocCategory")}</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as any)}
                  className="nf-input w-full"
                >
                  <option value="FEED_RATION">{t("apDocFeedRation")}</option>
                  <option value="GRN_RECEIPT">{t("apDocGrnReceipt")}</option>
                  <option value="STOCK_TRANSFER">{t("apDocStockTransfer")}</option>
                  <option value="STAGE_CLOSE">{t("apDocStageClose")}</option>
                  <option value="VET_DISPOSAL">{t("apDocVetDisposal")}</option>
                </select>
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("apTargetBatch")}</label>
                <select
                  value={newBatchId}
                  onChange={(e) => setNewBatchId(e.target.value)}
                  className="nf-input w-full font-mono"
                >
                  <option value="">{t("apNoBatch")}</option>
                  {batches.map((b) => (
                    <option key={b.batch_id} value={b.batch_id}>
                      {b.batch_no}
                      {b.current_stage_code ? ` (${b.current_stage_code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("apRequestTitle")}</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t("apRequestTitlePlaceholder")}
                className="nf-input w-full font-medium"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-semibold block mb-1">{t("apItemStageInvolved")}</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={t("apItemPlaceholder")}
                  className="nf-input w-full"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("apQuantityVolume")}</label>
                <input
                  type="text"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder={t("apQtyPlaceholder")}
                  className="nf-input w-full font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("apEstCost")}</label>
                <input
                  type="text"
                  value={newCost}
                  onChange={(e) => setNewCost(e.target.value)}
                  placeholder={t("apCostPlaceholder")}
                  className="nf-input w-full font-mono"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("apFarmLocation")}</label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder={t("apLocationPlaceholder")}
                className="nf-input w-full"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("apOperationalJustification")}</label>
              <textarea
                rows={3}
                value={newJustification}
                onChange={(e) => setNewJustification(e.target.value)}
                placeholder={t("apJustificationPlaceholder")}
                className="nf-input w-full"
              />
            </div>

            <div className="flex justify-end pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <Button onClick={handleCreateApproval} disabled={busy} className="nf-btn-primary">
                {t("apSubmitForAuth")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </ConsolePage>
  );
}

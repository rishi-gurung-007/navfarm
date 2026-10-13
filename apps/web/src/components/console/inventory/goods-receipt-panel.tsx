"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, CheckCircle2, Pencil, Sparkles, ListChecks, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Toast, showToast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLanguage } from "@/hooks/useLanguage";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { formatQuantity } from "@/lib/utils";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyLine = () => ({
  item_id: "",
  quantity: "",
  uom: "",
  rate: "",
  lot_no: "",
  serial_no: "",
  expiry_date: "",
});

/**
 * Item Tracking Lines for one receipt line — the GRN's counterpart of the Transfer Order's dialog. A receipt
 * brings new stock in, so its lots and serials are new ones: typed from the supplier's papers, or generated
 * from the item's tracking series. (Choosing stock that is already there is a Transfer Order's job.)
 */
function TrackingLinesDialog({
  open,
  lineIdx,
  line,
  item,
  onClose,
  onApply,
  onGenerate,
}: {
  open: boolean;
  lineIdx: number | null;
  line: Row | null;
  item: Row | undefined;
  onClose: () => void;
  onApply: (patch: { lot_no?: string; serial_no?: string; expiry_date?: string }) => void;
  onGenerate: (type: "LOT" | "SERIAL", count: number) => Promise<string[]>;
}) {
  const { t } = useLanguage();
  const isLot = Boolean(item?.is_lot_tracked);
  const hasSeries = Boolean(item?.tracking_series_id);
  const targetQty = Math.max(0, Math.round(Number(line?.quantity || 0)));
  const [lotNo, setLotNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // A fresh draft each time the dialog opens on a line; edits stay here until Apply.
  useEffect(() => {
    if (!open || !line) return;
    setLotNo(line.lot_no || "");
    setExpiry(line.expiry_date || "");
    setSerials(String(line.serial_no || "").split(/[\n,]+/).map((s) => s.trim()).filter(Boolean));
    setError("");
  }, [open, lineIdx]);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const numbers = await onGenerate(isLot ? "LOT" : "SERIAL", isLot ? 1 : Math.max(1, targetQty));
      if (isLot) setLotNo(numbers[0] || "");
      else setSerials(numbers);
    } catch (err: any) {
      setError(err?.message || t("grpTrkGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const filledSerials = serials.map((s) => s.trim()).filter(Boolean);
  const apply = () => {
    onApply(isLot
      ? { lot_no: lotNo.trim(), expiry_date: expiry }
      : { serial_no: filledSerials.join(", "), expiry_date: expiry });
  };

  return (
    <Dialog
      open={open && !!line}
      onClose={onClose}
      title={t("grpTrkTitle", { code: item?.item_code || "" })}
      description={t("grpTrkDescription")}
      maxWidth="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={onClose} className="text-xs">{t("cancel")}</Button>
          <Button size="sm" onClick={apply} className="nf-btn-primary flex items-center gap-1.5 text-xs font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("grpTrkApply")}
          </Button>
        </div>
      }
    >
      <Toast variant="danger" message={error} onClose={() => setError("")} />
      {line && (
        <div className="flex flex-col gap-4 text-xs">
          <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] border p-3 sm:grid-cols-3" style={S.raised}>
            <div>
              <span className="block text-[10px] font-semibold uppercase" style={S.muted}>{t("grpTrkItem")}</span>
              <span className="font-mono font-semibold" style={S.primary}>{item?.item_code || "—"}</span>
              <p className="truncate text-[11px]" style={S.sub}>{item?.item_name || ""}</p>
            </div>
            <div>
              <span className="block text-[10px] font-semibold uppercase" style={S.muted}>{t("grpColQty")}</span>
              <span className="font-mono font-semibold" style={S.primary}>{formatQuantity(line.quantity || 0, line.uom)} {line.uom}</span>
            </div>
            <div>
              <span className="block text-[10px] font-semibold uppercase" style={S.muted}>{t("grpTrkMode")}</span>
              <span className="font-semibold" style={S.accent}>{isLot ? t("grpTrkLotTracked") : t("grpTrkSerialTracked")}</span>
            </div>
          </div>

          {isLot ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub} htmlFor="grn-trk-lot">{t("grpTrkLotNo")}</label>
                <input id="grn-trk-lot" value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder={t("grpTrkLotPlaceholder")} className={`${inputCls} font-mono`} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub} htmlFor="grn-trk-expiry">{t("grpColExpiry")}</label>
                <input id="grn-trk-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} style={S.input} />
              </div>
              <div className="sm:col-span-2">
                <Button size="sm" variant="outline" onClick={generate} disabled={!hasSeries || generating} className="flex items-center gap-1.5 text-xs" title={hasSeries ? undefined : t("grpTrkNoSeries")}>
                  <Sparkles className="h-3.5 w-3.5" /> {generating ? t("grpTrkGenerating") : t("grpTrkGenerateLot")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold" style={S.primary}>
                  {t("grpTrkSerialCount", { n: filledSerials.length, total: targetQty })}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSerials((list) => [...list, ""])} className="flex items-center gap-1 text-xs">
                    <Plus className="h-3.5 w-3.5" /> {t("grpTrkAddSerial")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={generate} disabled={!hasSeries || generating || targetQty < 1} className="flex items-center gap-1.5 text-xs" title={hasSeries ? undefined : t("grpTrkNoSeries")}>
                    <Sparkles className="h-3.5 w-3.5" /> {generating ? t("grpTrkGenerating") : t("grpTrkGenerateSerials", { n: Math.max(1, targetQty) })}
                  </Button>
                </div>
              </div>
              {targetQty > 0 && filledSerials.length !== targetQty && (
                <p className="text-[11px]" style={{ color: "var(--warning)" }}>{t("grpTrkSerialMismatch", { n: filledSerials.length, total: targetQty })}</p>
              )}
              <div className="max-h-64 overflow-y-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                {serials.length === 0 ? (
                  <p className="p-3 text-center text-[11px]" style={S.muted}>{t("grpTrkNoSerials")}</p>
                ) : (
                  serials.map((serial, i) => (
                    <div key={i} className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0" style={{ borderColor: "var(--row-border)" }}>
                      <span className="w-6 text-right font-mono text-[10px]" style={S.muted}>{i + 1}</span>
                      <input
                        value={serial}
                        onChange={(e) => setSerials((list) => list.map((s, j) => (j === i ? e.target.value : s)))}
                        aria-label={t("grpTrkSerialNo", { n: i + 1 })}
                        className={`${inputCls} h-8 flex-1 font-mono text-xs`}
                        style={S.input}
                      />
                      <button type="button" onClick={() => setSerials((list) => list.filter((_, j) => j !== i))} className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)]" style={{ color: "var(--danger)" }} aria-label={t("grpTrkRemoveSerial")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex flex-col gap-1.5 sm:w-1/2">
                <label className="nf-text-label" style={S.sub} htmlFor="grn-trk-expiry-s">{t("grpColExpiry")}</label>
                <input id="grn-trk-expiry-s" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} style={S.input} />
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

type GrnSortKey = "receipt_no" | "posting_date" | "warehouse" | "external_reference_no" | "status";

/** A column header that sorts the list, showing which way it is sorted. */
function SortButton({ label, active, dir, onClick, alignEnd = false }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; alignEnd?: boolean }) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 uppercase ${alignEnd ? "ml-auto" : ""}`} style={active ? { color: "var(--text-primary)" } : undefined}>
      {label}
      <Icon className="h-3 w-3" style={{ opacity: active ? 1 : 0.45 }} />
    </button>
  );
}

export default function GoodsReceiptPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [header, setHeader] = useState<Row>({ warehouse_id: "", posting_date: "", supplier_id: "", external_reference_no: "", remarks: "" });
  const [lines, setLines] = useState<Row[]>([emptyLine()]);
  // Set only when the form was opened from Edit on a DRAFT row — drives
  // handleSave toward PUT /goods-receipt/:id instead of POST, and the modal's
  // title/button copy. A POSTED receipt never sets this: its row offers View
  // only, and the Edit action itself never appears for it (see the table).
  const [editingId, setEditingId] = useState<string | null>(null);
  // The line the Item Tracking Lines dialog is open on, and the line last worked on (the header button's target).
  const [trackingIdx, setTrackingIdx] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const { formatMoney } = useCompanyCurrency();

  const [viewing, setViewing] = useState<Row | null>(null);
  const [posting, setPosting] = useState(false);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "200");
      const res = await api.get(`/goods-receipt?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("grpFailedToLoadReceipts"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  // Newest receipt first unless a column header says otherwise; a second click on the same header reverses it.
  const [sort, setSort] = useState<{ key: GrnSortKey; dir: "asc" | "desc" }>({ key: "receipt_no", dir: "desc" });
  const toggleSort = (key: GrnSortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "receipt_no" || key === "posting_date" ? "desc" : "asc" }));
  const sortedRows = useMemo(() => {
    const value = (r: Row) =>
      sort.key === "warehouse"
        ? warehouses.find((w) => w.warehouse_id === r.warehouse_id)?.warehouse_name || ""
        : String(r[sort.key] ?? "");
    const ordered = [...rows].sort((a, b) => value(a).localeCompare(value(b), undefined, { numeric: true }) || String(a.receipt_no).localeCompare(String(b.receipt_no)));
    return sort.dir === "desc" ? ordered.reverse() : ordered;
  }, [rows, sort, warehouses]);
  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize, sort]);
  const pagedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/warehouse?${qs}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/supplier?${qs}`).then((r) => setSuppliers(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setHeader({ warehouse_id: "", posting_date: new Date().toISOString().slice(0, 10), supplier_id: "", external_reference_no: "", remarks: "" });
    setLines([emptyLine()]);
    setFormError("");
    setModalOpen(true);
  };

  // DRAFT-only: fetches the full receipt (list rows carry no lines) and
  // reopens the same create form prefilled, saving through PUT on submit.
  const openEdit = async (row: Row) => {
    setFormError("");
    try {
      const res = await api.get(`/goods-receipt/${row.receipt_id}`);
      const full = unwrap<Row>(res);
      setEditingId(full.receipt_id);
      setHeader({
        warehouse_id: full.warehouse_id || "",
        posting_date: full.posting_date || "",
        supplier_id: full.supplier_id || "",
        external_reference_no: full.external_reference_no || "",
        remarks: full.remarks || "",
      });
      const fullLines = (full.lines || []).map((l: Row) => ({
        item_id: l.item_id || "",
        // MySQL returns DECIMAL columns as text at full scale ("12.5000", "78.000000"); the boxes show the number.
        quantity: l.quantity != null ? String(Number(l.quantity)) : "",
        uom: l.uom || "",
        rate: l.rate != null ? String(Number(l.rate)) : "",
        lot_no: l.lot_no || "",
        serial_no: l.serial_no || "",
        expiry_date: l.expiry_date || "",
      }));
      setLines(fullLines.length ? fullLines : [emptyLine()]);
      setModalOpen(true);
    } catch (err: any) {
      setError(err?.message || t("grpFailedToLoadReceiptDetails"));
    }
  };

  const setLineField = (idx: number, key: string, value: any) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (key === "item_id") {
          const selectedItem = items.find((it) => it.item_id === value);
          return {
            ...l,
            item_id: value,
            lot_no: "",
            serial_no: "",
            uom: selectedItem?.uom_primary || "",
          };
        }
        return { ...l, [key]: value };
      }),
    );
  };

  // The next numbers from the item's tracking series, for the Item Tracking Lines dialog to place. A preview:
  // the series moves on when the receipt is posted.
  const previewTracking = async (idx: number, count: number): Promise<string[]> => {
    const it = items.find((i) => i.item_id === lines[idx]?.item_id);
    if (!it?.tracking_series_id) return [];
    const data = unwrap<any>(await api.get(`/no-series/${it.tracking_series_id}/preview-numbers?count=${Math.max(1, count)}`));
    return data?.numbers?.length ? data.numbers : data?.next_number ? [data.next_number] : [];
  };

  // The money a line is worth: quantity at its unit cost.
  const lineTotal = (line: Row) => {
    const qty = Number(line.quantity);
    const cost = Number(line.rate);
    return Number.isFinite(qty) && Number.isFinite(cost) && line.rate !== "" ? qty * cost : null;
  };
  const receiptTotal = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0);
  const activeItem = items.find((i) => i.item_id === lines[activeIdx]?.item_id);
  const activeLineTracked = Boolean(activeItem?.is_lot_tracked || activeItem?.is_serial_tracked);

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // `postNow` saves the form and posts it in one go. It asks first — posting
  // writes ledger and GL entries and cannot be edited afterwards.
  const handleSave = async (postNow = false) => {
    if (postNow && !(await confirmAction({ title: t("grpPostConfirmTitle"), message: t("grpPostConfirmMessage") }))) return;
    setSaving(true);
    setFormError("");
    try {
      if (!header.warehouse_id) throw new Error(t("grpWarehouseRequired"));
      if (!header.posting_date) throw new Error(t("grpPostingDateRequired"));
      const cleanLines = lines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => ({
          item_id: l.item_id,
          quantity: Number(l.quantity),
          uom: l.uom,
          rate: l.rate ? Number(l.rate) : undefined,
          lot_no: l.lot_no ? String(l.lot_no).trim() || undefined : undefined,
          serial_no: l.serial_no ? String(l.serial_no).trim() || undefined : undefined,
          expiry_date: l.expiry_date || undefined,
        }));
      if (cleanLines.length === 0) throw new Error(t("grpAddAtLeastOneLine"));

      // UpdateGoodsReceiptDto does not declare company_id (it is create-only —
      // an existing receipt's company cannot change) and the global pipe
      // rejects any undeclared property, so the PUT payload must omit it.
      let receiptId = editingId;
      let receiptNo: string = rows.find((r) => r.receipt_id === editingId)?.receipt_no || "";
      if (editingId) {
        await api.put(`/goods-receipt/${editingId}`, {
          warehouse_id: header.warehouse_id,
          posting_date: header.posting_date,
          supplier_id: header.supplier_id || undefined,
          external_reference_no: header.external_reference_no || undefined,
          remarks: header.remarks || undefined,
          lines: cleanLines,
        });
      } else {
        const created = unwrap<Row>(
          await api.post("/goods-receipt", {
            company_id: companyId,
            warehouse_id: header.warehouse_id,
            posting_date: header.posting_date,
            supplier_id: header.supplier_id || undefined,
            external_reference_no: header.external_reference_no || undefined,
            remarks: header.remarks || undefined,
            lines: cleanLines,
          }),
        );
        receiptId = created?.receipt_id ?? null;
        receiptNo = created?.receipt_no || "";
      }
      if (postNow) {
        if (!receiptId) throw new Error(t("grpFailedToPostReceipt"));
        try {
          await api.post(`/goods-receipt/${receiptId}/post`, {});
        } catch (postErr: any) {
          // The draft is saved; only the posting failed. Close the form so a
          // retry does not create a duplicate, and say where the receipt is.
          setModalOpen(false);
          setEditingId(null);
          load();
          setError(`${receiptNo ? `${receiptNo}: ` : ""}${t("grpSavedAsDraftPostFailed")} ${postErr?.message || ""}`.trim());
          return;
        }
      }
      // Say which receipt it was, and show it: the list goes back to page one, newest first.
      showToast.success(t(postNow ? "grpToastPosted" : editingId ? "grpToastDraftUpdated" : "grpToastDraftSaved", { no: receiptNo }));
      setSort({ key: "receipt_no", dir: "desc" });
      setPage(1);
      setModalOpen(false);
      setEditingId(null);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("grpFailedToSaveReceipt"));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/goods-receipt/${row.receipt_id}`);
      setViewing(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("grpFailedToLoadReceiptDetails"));
    }
  };

  const handlePost = async () => {
    if (!viewing) return;
    setPosting(true);
    try {
      const res = await api.post(`/goods-receipt/${viewing.receipt_id}/post`, {});
      const posted = unwrap<Row>(res);
      setViewing(posted);
      showToast.success(t("grpToastPosted", { no: posted?.receipt_no || viewing.receipt_no || "" }));
      load();
    } catch (err: any) {
      setError(err?.message || t("grpFailedToPostReceipt"));
    } finally {
      setPosting(false);
    }
  };

  const warehouseLabel = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.warehouse_name || "—";
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? `${it.item_code} — ${it.item_name}` : "—";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("grpTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("grpSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-[9rem]">
            <SearchableSelect
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              options={[
                { value: "", label: t("grpAllStatuses") },
                { value: "DRAFT", label: t("grpStatusDraft") },
                { value: "POSTED", label: t("grpStatusPosted") },
                { value: "CANCELLED", label: t("grpStatusCancelled") },
              ]}
              columnHeaders={false}
              triggerClassName="nf-input-sm min-w-[9rem] h-9"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
              tabIndex={-1}
            >
              <option value="">{t("grpAllStatuses")}</option>
              <option value="DRAFT">{t("grpStatusDraft")}</option>
              <option value="POSTED">{t("grpStatusPosted")}</option>
              <option value="CANCELLED">{t("grpStatusCancelled")}</option>
            </select>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("grpSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("grpNewReceipt")}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                {([
                  ["receipt_no", t("grpColReceiptNo")],
                  ["posting_date", t("grpColPostingDate")],
                  ["warehouse", t("grpColWarehouse")],
                  ["external_reference_no", t("grpColReference")],
                ] as Array<[GrnSortKey, string]>).map(([key, label]) => (
                  <TableHead key={key} className="whitespace-nowrap" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortButton label={label} active={sort.key === key} dir={sort.dir} onClick={() => toggleSort(key)} />
                  </TableHead>
                ))}
                <TableHead className="text-right" aria-sort={sort.key === "status" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <SortButton label={t("grpColStatus")} active={sort.key === "status"} dir={sort.dir} onClick={() => toggleSort("status")} alignEnd />
                </TableHead>
                <TableHead className="text-right">{t("grpColActions")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("grpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("grpNoReceiptsYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.receipt_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.receipt_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.posting_date}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{warehouseLabel(row.warehouse_id)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.external_reference_no || "—"}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <button onClick={() => openView(row)} title={t("grpView")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      {/* Only a DRAFT is editable — a POSTED receipt has already
                          moved stock and written its ledger and GL legs. */}
                      {row.status === "DRAFT" && (
                        <button onClick={() => openEdit(row)} title={t("grpEdit")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>

      {/* Create modal */}
      <Dialog
        open={modalOpen}
        onClose={() => { if (!saving) { setModalOpen(false); setEditingId(null); } }}
        title={editingId ? t("grpEditGoodsReceiptTitle") : t("grpNewGoodsReceiptTitle")}
        maxWidth="xl"
        className="max-w-5xl lg:max-w-6xl"
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? t("grpSaving") : editingId ? t("grpSaveChanges") : t("grpSaveDraft")}
            </Button>
            <Button size="sm" onClick={() => handleSave(true)} disabled={saving} className="flex items-center gap-1.5 nf-btn-primary">
              <CheckCircle2 className="h-4 w-4" /> {t("grpPost")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Toast variant="danger" message={formError} onClose={() => setFormError("")} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpWarehouse")} <span className="text-(--danger)">*</span></label>
              <SearchableSelect
                options={warehouses}
                value={header.warehouse_id}
                valueKey="warehouse_id"
                onChange={(val) => setHeader((h) => ({ ...h, warehouse_id: val }))}
                placeholder={t("grpSelectEllipsis")}
                searchPlaceholder="Search location…"
                columnHeaders={["Code", "Location Name"]}
                getLabelParts={(w: any) => [w.warehouse_code || "", w.warehouse_name || ""]}
                getLabel={(w: any) => (w ? `${w.warehouse_code} — ${w.warehouse_name}` : "")}
                triggerClassName="w-full text-xs h-9"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpPostingDate")} <span className="text-(--danger)">*</span></label>
              <input type="date" value={header.posting_date} onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))} className={`${inputCls} nf-input-sm text-xs h-9 min-h-[36px] max-h-[36px] box-border`} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpSupplier")}</label>
              <SearchableSelect
                options={suppliers}
                value={header.supplier_id}
                valueKey="supplier_id"
                onChange={(val) => setHeader((h) => ({ ...h, supplier_id: val }))}
                placeholder={t("grpSelectEllipsis")}
                searchPlaceholder="Search supplier…"
                columnHeaders={["Code", "Supplier Name"]}
                getLabelParts={(s: any) => [s.supplier_code || "", s.supplier_name || ""]}
                getLabel={(s: any) => (s ? `${s.supplier_code} — ${s.supplier_name}` : "")}
                triggerClassName="w-full text-xs h-9 min-h-[36px] max-h-[36px] box-border"
                onClear={() => setHeader((h) => ({ ...h, supplier_id: "" }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpExternalReference")}</label>
              <input value={header.external_reference_no} onChange={(e) => setHeader((h) => ({ ...h, external_reference_no: e.target.value }))} placeholder={t("grpSupplierDcInvoiceNo")} className={`${inputCls} nf-input-sm text-xs h-9 min-h-[36px] max-h-[36px] box-border`} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="nf-text-label" style={S.sub}>{t("grpRemarks")}</label>
              <textarea value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} rows={2} className={`${inputCls} text-xs`} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("grpLines")}</p>
            <div className="flex items-center gap-2">
              {/* Opens on the line last worked on, as the Transfer Order's button does. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTrackingIdx(activeIdx)}
                disabled={!activeLineTracked}
                title={t("grpTrkButtonHint")}
                className="flex items-center gap-1.5 text-[11px] font-semibold"
              >
                <ListChecks className="h-3.5 w-3.5" /> {t("grpItemTrackingLines")}
              </Button>
              <button onClick={addLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
                <Plus className="h-3 w-3" /> {t("grpAddLine")}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs min-w-[960px]">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="h-auto px-3 py-2 w-32 min-w-[120px]">Item Code</TableHead>
                  <TableHead className="h-auto px-3 py-2 min-w-[220px]">Item Description</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-28 min-w-[105px]">{t("grpColQty")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-24 min-w-[85px]">{t("grpColUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-28 min-w-[100px]">{t("grpColRate")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-32 min-w-[110px] text-right">{t("grpColTotalCost")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 min-w-[220px]">{t("grpColTracking")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-36 min-w-[140px]">{t("grpColExpiry")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-10 min-w-[40px] text-center"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => {
                  const it = items.find((i) => i.item_id === line.item_id);
                  const isLot = Boolean(it?.is_lot_tracked);
                  const isSerial = Boolean(it?.is_serial_tracked);
                  const lineInputCls = "w-full h-9 min-h-[36px] max-h-[36px] px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border outline-none transition-colors box-border";

                  return (
                    <TableRow key={idx} onFocusCapture={() => setActiveIdx(idx)} onClick={() => setActiveIdx(idx)}>
                      {/* Item Code (Disabled, Auto-filled from selected Item Description) */}
                      <TableCell className="px-2 py-1.5 w-32 min-w-[120px]">
                        <input
                          type="text"
                          readOnly
                          disabled
                          placeholder="—"
                          value={it?.item_code || ""}
                          aria-label={`Item Code ${idx + 1}`}
                          className={`${lineInputCls} font-mono opacity-75 cursor-not-allowed`}
                          style={S.surface}
                        />
                      </TableCell>

                      {/* Item Description: SearchableSelect */}
                      <TableCell className="px-2 py-1.5 min-w-[220px]">
                        <SearchableSelect
                          options={items}
                          value={line.item_id}
                          valueKey="item_id"
                          onChange={(val) => setLineField(idx, "item_id", val)}
                          placeholder={t("grpSelectItemOptions", { count: items.length })}
                          searchPlaceholder="Search item description…"
                          columnHeaders={["Description", "Tracking"]}
                          getLabelParts={(itemRow: any) => [
                            itemRow.item_name || itemRow.item_code || "",
                            itemRow.is_lot_tracked ? "LOT" : itemRow.is_serial_tracked ? "SERIAL NS" : "—",
                          ]}
                          getLabel={(itemRow: any) =>
                            itemRow
                              ? `${itemRow.item_name || itemRow.item_code}${itemRow.is_lot_tracked ? " [LOT]" : itemRow.is_serial_tracked ? " [SERIAL NS]" : ""}`
                              : ""
                          }
                          triggerClassName="w-full text-xs h-9 min-h-[36px] max-h-[36px] box-border"
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-28 min-w-[105px]">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0"
                          value={line.quantity}
                          onChange={(e) => setLineField(idx, "quantity", e.target.value)}
                          className={`${lineInputCls} text-left font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-24 min-w-[85px]">
                        <select
                          value={line.uom}
                          onChange={(e) => setLineField(idx, "uom", e.target.value)}
                          disabled={!line.item_id || !!items.find((it) => it.item_id === line.item_id)?.uom_primary}
                          className={`${lineInputCls} nf-select appearance-none pr-7 disabled:cursor-not-allowed disabled:opacity-70`}
                          style={S.input}
                        >
                          <option value="">{t("grpSelectEllipsis")}</option>
                          {line.uom && !uoms.some((u) => u.uom_code === line.uom) && (
                            <option value={line.uom}>{line.uom}</option>
                          )}
                          {uoms.map((u) => (
                            <option key={u.uom_code} value={u.uom_code}>
                              {u.uom_code}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-24 min-w-[85px]">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          value={line.rate}
                          onChange={(e) => setLineField(idx, "rate", e.target.value)}
                          className={`${lineInputCls} text-left font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-32 text-right font-mono" style={S.primary}>
                        {lineTotal(line) === null ? <span style={S.muted}>—</span> : formatMoney(lineTotal(line))}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 min-w-[220px]">
                        {isLot || isSerial ? (() => {
                          const serialCount = String(line.serial_no || "").split(/[\n,]+/).map((x: string) => x.trim()).filter(Boolean).length;
                          const assigned = isLot ? (line.lot_no || "") : serialCount > 0 ? t("grpTrkSerialSummary", { n: serialCount, total: Math.round(Number(line.quantity || 0)) }) : "";
                          return (
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: "var(--success)", borderColor: "var(--success)" }}>
                                {isLot ? t("grpTrkYesLot") : t("grpTrkYesSerial")}
                              </span>
                              {/* What Item Tracking Lines assigned, once it has; the button above the lines opens it. */}
                              {assigned && <span className="min-w-0 flex-1 truncate font-mono text-[11px]" style={S.primary}>{assigned}</span>}
                            </div>
                          );
                        })() : (
                          <span className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                            {t("grpTrkNo")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-36">
                        <input
                          type="date"
                          value={line.expiry_date}
                          onChange={(e) => setLineField(idx, "expiry_date", e.target.value)}
                          className={lineInputCls}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-12 text-center">
                        <button
                          onClick={() => removeLine(idx)}
                          type="button"
                          className="h-9 w-9 flex items-center justify-center rounded-[var(--radius-sm)] transition hover:bg-(--danger-muted) mx-auto"
                          style={{ color: "var(--danger)" }}
                          title="Remove line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 px-1 text-xs">
            <span style={S.sub}>{t("grpReceiptTotal")}</span>
            <span className="font-mono text-sm font-semibold" style={S.primary}>{formatMoney(receiptTotal)}</span>
          </div>
        </div>
      </Dialog>

      <TrackingLinesDialog
        open={trackingIdx !== null}
        lineIdx={trackingIdx}
        line={trackingIdx !== null ? lines[trackingIdx] ?? null : null}
        item={trackingIdx !== null ? items.find((i) => i.item_id === lines[trackingIdx]?.item_id) : undefined}
        onClose={() => setTrackingIdx(null)}
        onGenerate={(_type, count) => previewTracking(trackingIdx ?? 0, count)}
        onApply={(patch) => {
          const idx = trackingIdx;
          if (idx !== null) setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
          setTrackingIdx(null);
        }}
      />

      {/* View / Post modal */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t("grpGoodsReceiptTitle", { receiptNo: viewing.receipt_no }) : ""}
        maxWidth="xl"
        footer={
          viewing?.status === "DRAFT" ? (
            <Button size="sm" onClick={handlePost} disabled={posting} className="flex items-center gap-1.5 nf-btn-primary">
              <CheckCircle2 className="h-4 w-4" /> {posting ? t("grpPosting") : t("grpPost")}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("grpColStatus")}</p><StatusBadge status={viewing.status} className="mt-1" /></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("grpPostingDate")}</p><p style={S.primary}>{viewing.posting_date}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("grpWarehouse")}</p><p style={S.primary}>{warehouseLabel(viewing.warehouse_id)}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("grpColReference")}</p><p style={S.primary}>{viewing.external_reference_no || "—"}</p></div>
              {viewing.posted_at && <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("grpPostedAt")}</p><p style={S.primary}>{viewing.posted_at}</p></div>}
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              <table className="w-full border-collapse text-left text-xs min-w-[720px]">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2 min-w-[240px]">{t("grpColItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2 w-28 min-w-[90px]">{t("grpColQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2 w-24 min-w-[80px]">{t("grpColUom")}</TableHead>
                    <TableHead className="h-auto px-3 py-2 w-28 min-w-[90px] text-right">{t("grpColRate")}</TableHead>
                    <TableHead className="h-auto px-3 py-2 w-32 min-w-[100px] text-right">{t("grpColTotalCost")}</TableHead>
                    <TableHead className="h-auto px-3 py-2 min-w-[220px]">{t("grpColTracking")}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {(viewing.lines || []).map((l: Row) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>{formatQuantity(l.quantity, l.uom)}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.uom}</TableCell>
                      <TableCell className="px-3 py-2 text-right font-mono" style={S.primary}>{l.rate != null ? formatMoney(l.rate) : "—"}</TableCell>
                      <TableCell className="px-3 py-2 text-right font-mono" style={S.primary}>
                        {l.amount != null ? formatMoney(l.amount) : l.rate != null ? formatMoney(Number(l.rate) * Number(l.quantity || 0)) : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono text-xs" style={S.primary}>
                        {l.lot_no ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-500/20 border border-emerald-500/30">LOT</span>
                            {l.lot_no}
                          </span>
                        ) : l.serial_no ? (
                          <span className="inline-flex items-center gap-1 text-blue-400">
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-500/20 border border-blue-500/30">SERIAL NS</span>
                            {l.serial_no}
                          </span>
                        ) : (
                          <span style={S.muted}>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

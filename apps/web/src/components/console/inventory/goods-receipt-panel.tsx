"use client";

import { useEffect, useState, useMemo } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, CheckCircle2, Pencil, ChevronDown, Sparkles } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLanguage } from "@/hooks/useLanguage";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Popover, usePopoverSurface } from "@/components/ui/popover";

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

function LotDropdownPanel({
  itemId,
  warehouseId,
  hasSeries,
  currentLot,
  onSelectLot,
  onGenerate,
  isGenerating,
}: {
  itemId: string;
  warehouseId?: string;
  hasSeries: boolean;
  currentLot: string;
  onSelectLot: (lotNo: string, expiryDate?: string) => void;
  onGenerate: () => void;
  isGenerating?: boolean;
}) {
  const { close } = usePopoverSurface();
  const [existingLots, setExistingLots] = useState<
    Array<{
      lot_no: string;
      remaining_quantity: number;
      expiry_date: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!itemId) return;
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("item_id", itemId);
    if (warehouseId) params.set("warehouse_id", warehouseId);

    api
      .get(`/inventory-ledger/available-lots?${params.toString()}`)
      .then((res) => {
        if (!active) return;
        const list = unwrap<any[]>(res) || [];
        setExistingLots(list);
      })
      .catch(() => {
        if (active) setExistingLots([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [itemId, warehouseId]);

  const filteredLots = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return existingLots;
    return existingLots.filter(
      (l) =>
        (l.lot_no || "").toLowerCase().includes(q) ||
        (l.expiry_date || "").includes(q)
    );
  }, [existingLots, query]);

  return (
    <div
      className="w-80 rounded-lg border shadow-2xl p-3"
      style={{
        backgroundColor: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <div
        className="flex items-center justify-between pb-2 mb-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300">
            LOT
          </span>
          <span className="text-xs font-semibold" style={S.primary}>
            Select or Assign Lot
          </span>
        </div>
        <button
          type="button"
          onClick={() => close()}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-white/10"
          style={S.sub}
        >
          ✕
        </button>
      </div>

      {hasSeries && (
        <button
          type="button"
          disabled={isGenerating}
          onClick={onGenerate}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded border text-xs font-medium transition-all mb-2.5 hover:bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          style={{ backgroundColor: "rgba(16, 185, 129, 0.05)" }}
        >
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            Generate Next Lot No.
          </span>
          <span className="text-[10px] font-mono opacity-80">
            {isGenerating ? "…" : "Preview (Series)"}
          </span>
        </button>
      )}

      <div>
        <div className="flex items-center justify-between text-[11px] font-medium mb-1" style={S.sub}>
          <span>Existing Lots in Stock ({existingLots.length})</span>
          {existingLots.length > 2 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lots…"
              className="text-[10px] px-1.5 py-0.5 rounded border w-24 font-mono"
              style={S.input}
            />
          )}
        </div>

        <div className="max-h-36 overflow-y-auto border rounded text-xs" style={{ borderColor: "var(--border-subtle)" }}>
          {loading ? (
            <div className="p-3 text-center text-xs" style={S.muted}>
              Loading lots…
            </div>
          ) : filteredLots.length === 0 ? (
            <div className="p-3 text-center text-[11px]" style={S.muted}>
              {existingLots.length === 0
                ? "No existing lots found. Enter or generate a new lot."
                : "No matching lots found."}
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b text-[10px] uppercase font-semibold" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                  <th className="px-2 py-1">Lot No.</th>
                  <th className="px-2 py-1 text-right">In Stock</th>
                  <th className="px-2 py-1 text-right">Expiry</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((lot) => {
                  const isSelected = lot.lot_no === currentLot;
                  return (
                    <tr
                      key={lot.lot_no}
                      onClick={() => {
                        onSelectLot(lot.lot_no, lot.expiry_date || undefined);
                        close();
                      }}
                      className={`cursor-pointer transition-colors border-b ${
                        isSelected ? "bg-emerald-500/20 text-emerald-300" : "hover:bg-white/5"
                      }`}
                      style={{ borderColor: "var(--border-subtle)" }}
                    >
                      <td className="px-2 py-1.5 font-mono text-xs font-medium">
                        {lot.lot_no}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[11px]">
                        {lot.remaining_quantity}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[11px]" style={S.muted}>
                        {lot.expiry_date ? String(lot.expiry_date).slice(0, 10) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        {currentLot ? (
          <button
            type="button"
            onClick={() => {
              onSelectLot("");
              close();
            }}
            className="text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Clear Lot
          </button>
        ) : <div />}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => close()}
          className="h-6 text-[11px] px-2.5"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function SerialDropdownPanel({
  targetQty,
  serialValue,
  hasSeries,
  isGenerating,
  onGenerate,
  onChange,
}: {
  targetQty: number;
  serialValue: string;
  hasSeries: boolean;
  isGenerating?: boolean;
  onGenerate?: () => void;
  onChange: (serials: string) => void;
}) {
  const { close } = usePopoverSurface();
  const serials = useMemo(() => {
    return serialValue
      ? serialValue.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
  }, [serialValue]);

  const [items, setItems] = useState<string[]>(() => {
    const arr = [...serials];
    while (arr.length < targetQty) arr.push("");
    return arr;
  });

  useEffect(() => {
    const parsed = serialValue
      ? serialValue.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];
    const arr = [...parsed];
    while (arr.length < targetQty) arr.push("");
    setItems(arr);
  }, [serialValue, targetQty]);

  const updateItem = (index: number, val: string) => {
    const next = [...items];
    next[index] = val;
    setItems(next);
    onChange(next.map((s) => s.trim()).filter(Boolean).join(", "));
  };

  return (
    <div
      className="w-80 rounded-lg border shadow-2xl p-3"
      style={{
        backgroundColor: "var(--surface-raised)",
        borderColor: "var(--border)",
      }}
    >
      <div
        className="flex items-center justify-between pb-2 mb-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-500/20 text-blue-300">
            SERIAL NS
          </span>
          <span className="text-xs font-semibold" style={S.primary}>
            Serials ({serials.length}/{targetQty})
          </span>
        </div>
        <button
          type="button"
          onClick={() => close()}
          className="text-xs px-1.5 py-0.5 rounded hover:bg-white/10"
          style={S.sub}
        >
          ✕
        </button>
      </div>

      {hasSeries && (
        <button
          type="button"
          disabled={isGenerating}
          onClick={onGenerate}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded border text-xs font-medium transition-all mb-2.5 hover:bg-blue-500/10 border-blue-500/30 text-blue-400"
          style={{ backgroundColor: "rgba(59, 130, 246, 0.05)" }}
        >
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            {serials.length >= targetQty ? "Regenerate All Serials" : `Generate All ${targetQty} Serials`}
          </span>
          <span className="text-[10px] font-mono opacity-80">
            {isGenerating ? "…" : "Preview (Series)"}
          </span>
        </button>
      )}

      <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
        {items.map((s, sIdx) => (
          <div key={sIdx} className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-black/30 text-zinc-400 w-7 text-center shrink-0 border border-white/5">
              #{sIdx + 1}
            </span>
            <input
              type="text"
              value={s}
              placeholder={`Serial #${sIdx + 1}`}
              onChange={(e) => updateItem(sIdx, e.target.value)}
              className="w-full text-xs h-7 px-2 font-mono rounded border"
              style={S.input}
            />
          </div>
        ))}
      </div>

      <div className="mt-2.5 pt-2 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        {serials.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setItems(Array.from({ length: targetQty }, () => ""));
              onChange("");
            }}
            className="text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Clear Serials
          </button>
        ) : <div />}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => close()}
          className="h-6 text-[11px] px-2.5"
        >
          Done
        </Button>
      </div>
    </div>
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
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [openSerialIdx, setOpenSerialIdx] = useState<number | null>(null);
  const [openLotIdx, setOpenLotIdx] = useState<number | null>(null);

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

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

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
        quantity: l.quantity ?? "",
        uom: l.uom || "",
        rate: l.rate ?? "",
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
            uom: selectedItem?.base_uom || l.uom || "",
          };
        }
        return { ...l, [key]: value };
      }),
    );
  };

  const handleGenerateTracking = async (idx: number, type: 'LOT' | 'SERIAL') => {
    const line = lines[idx];
    const it = items.find((i) => i.item_id === line.item_id);
    if (!it?.tracking_series_id) return;
    setGeneratingIdx(idx);
    setFormError("");
    try {
      const count = type === 'SERIAL' ? Math.max(1, parseInt(line.quantity || '1', 10) || 1) : 1;
      const res = await api.get(`/no-series/${it.tracking_series_id}/preview-numbers?count=${count}`);
      const data = unwrap<any>(res);
      if (type === 'LOT') {
        const nextNum = data.next_number || (data.numbers && data.numbers[0]);
        if (nextNum) setLineField(idx, 'lot_no', nextNum);
      } else {
        const nums = data.numbers || [data.next_number];
        if (nums && nums.length > 0) {
          setLineField(idx, 'serial_no', nums.join(', '));
          if (nums.length > 1) {
            setOpenSerialIdx(idx);
          }
        }
      }
    } catch (err: any) {
      setFormError(err?.message || 'Failed to preview number series');
    } finally {
      setGeneratingIdx(null);
    }
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async () => {
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
        await api.post("/goods-receipt", {
          company_id: companyId,
          warehouse_id: header.warehouse_id,
          posting_date: header.posting_date,
          supplier_id: header.supplier_id || undefined,
          external_reference_no: header.external_reference_no || undefined,
          remarks: header.remarks || undefined,
          lines: cleanLines,
        });
      }
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
      setViewing(unwrap<Row>(res));
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
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="nf-input-sm px-2" style={S.input}>
            <option value="">{t("grpAllStatuses")}</option>
            <option value="DRAFT">{t("grpStatusDraft")}</option>
            <option value="POSTED">{t("grpStatusPosted")}</option>
            <option value="CANCELLED">{t("grpStatusCancelled")}</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("grpSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("grpNewReceipt")}
          </Button>
        </div>
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">{t("grpColReceiptNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("grpColPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("grpColWarehouse")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("grpColReference")}</TableHead>
                <TableHead className="text-right">{t("grpColStatus")}</TableHead>
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
        footer={
          <Button size="sm" onClick={handleSave} disabled={saving} className="nf-btn-primary">
            {saving ? t("grpSaving") : editingId ? t("grpSaveChanges") : t("grpSaveDraft")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpWarehouse")} <span className="text-(--danger)">*</span></label>
              <SearchableSelect
                options={warehouses}
                value={header.warehouse_id}
                valueKey="warehouse_id"
                onChange={(val) => setHeader((h) => ({ ...h, warehouse_id: val }))}
                placeholder={t("grpSelectEllipsis")}
                searchPlaceholder="Search warehouse…"
                columnHeaders={["Code", "Warehouse Name"]}
                getLabelParts={(w: any) => [w.warehouse_code || "", w.warehouse_name || ""]}
                getLabel={(w: any) => (w ? `${w.warehouse_code} — ${w.warehouse_name}` : "")}
                triggerClassName="w-full text-xs h-9"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpPostingDate")} <span className="text-(--danger)">*</span></label>
              <input type="date" value={header.posting_date} onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))} className={inputCls} style={S.input} />
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
                triggerClassName="w-full text-xs h-9"
                onClear={() => setHeader((h) => ({ ...h, supplier_id: "" }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("grpExternalReference")}</label>
              <input value={header.external_reference_no} onChange={(e) => setHeader((h) => ({ ...h, external_reference_no: e.target.value }))} placeholder={t("grpSupplierDcInvoiceNo")} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="nf-text-label" style={S.sub}>{t("grpRemarks")}</label>
              <textarea value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} rows={2} className={inputCls} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("grpLines")}</p>
            <button onClick={addLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("grpAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="h-auto px-3 py-2 min-w-[280px]">{t("grpColItem")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-20">{t("grpColQty")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-24">{t("grpColUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-20">{t("grpColRate")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 min-w-[240px]">Tracking (Lot / Serial)</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-32">{t("grpColExpiry")}</TableHead>
                  <TableHead className="h-auto px-3 py-2 w-10"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => {
                  const it = items.find((i) => i.item_id === line.item_id);
                  const isLot = Boolean(it?.is_lot_tracked);
                  const isSerial = Boolean(it?.is_serial_tracked);
                  const hasSeries = Boolean(it?.tracking_series_id);
                  const isGenerating = generatingIdx === idx;

                  return (
                    <TableRow key={idx}>
                      <TableCell className="px-2 py-1.5 min-w-[280px]">
                        <SearchableSelect
                          options={items}
                          value={line.item_id}
                          valueKey="item_id"
                          onChange={(val) => setLineField(idx, "item_id", val)}
                          placeholder={t("grpSelectItemOptions", { count: items.length })}
                          searchPlaceholder="Search item code or name…"
                          columnHeaders={["Item Code", "Item Name", "Tracking"]}
                          getLabelParts={(itemRow: any) => [
                            itemRow.item_code || "",
                            itemRow.item_name || "",
                            itemRow.is_lot_tracked ? "LOT" : itemRow.is_serial_tracked ? "SERIAL NS" : "—",
                          ]}
                          getLabel={(itemRow: any) =>
                            itemRow
                              ? `${itemRow.item_code} — ${itemRow.item_name}${itemRow.is_lot_tracked ? " [LOT]" : itemRow.is_serial_tracked ? " [SERIAL NS]" : ""}`
                              : ""
                          }
                          triggerClassName="w-full text-xs h-8"
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-20">
                        <input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => setLineField(idx, "quantity", e.target.value)}
                          className={inputCls}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-24">
                        <select
                          value={line.uom}
                          onChange={(e) => setLineField(idx, "uom", e.target.value)}
                          className={`${inputCls} nf-select`}
                          style={S.input}
                        >
                          <option value="">{t("grpSelectEllipsis")}</option>
                          {uoms.map((u) => (
                            <option key={u.uom_code} value={u.uom_code}>
                              {u.uom_code}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-20">
                        <input
                          type="number"
                          value={line.rate}
                          onChange={(e) => setLineField(idx, "rate", e.target.value)}
                          className={inputCls}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 min-w-[240px]">
                        {isLot ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                              LOT
                            </span>
                            <div className="relative flex-1 flex items-center min-w-0">
                              <input
                                value={line.lot_no}
                                onChange={(e) => setLineField(idx, "lot_no", e.target.value)}
                                placeholder={hasSeries ? "Auto / Enter or pick Lot…" : "Enter or pick Lot…"}
                                className={`${inputCls} font-mono text-xs pr-7`}
                                style={S.input}
                              />
                              <Popover
                                open={openLotIdx === idx}
                                onOpenChange={(open) => setOpenLotIdx(open ? idx : null)}
                                floating
                                align="end"
                                side="bottom"
                                haspopup="dialog"
                                className="absolute right-1 top-1/2 -translate-y-1/2"
                                panelClassName="nf-tracking-popover-panel"
                                trigger={(triggerProps) => (
                                  <button
                                    {...triggerProps}
                                    className="text-zinc-400 hover:text-zinc-200 p-1 rounded flex items-center justify-center"
                                    title="Pick from existing lots or manage lot"
                                  >
                                    <ChevronDown
                                      className={`h-3.5 w-3.5 transition-transform ${openLotIdx === idx ? "rotate-180" : ""}`}
                                    />
                                  </button>
                                )}
                              >
                                <LotDropdownPanel
                                  itemId={line.item_id}
                                  warehouseId={header.warehouse_id}
                                  hasSeries={Boolean(hasSeries)}
                                  currentLot={line.lot_no}
                                  onSelectLot={(lotNo, expiryDate) => {
                                    setLineField(idx, "lot_no", lotNo);
                                    if (expiryDate) {
                                      setLineField(idx, "expiry_date", expiryDate.slice(0, 10));
                                    }
                                  }}
                                  onGenerate={() => handleGenerateTracking(idx, 'LOT')}
                                  isGenerating={isGenerating}
                                />
                              </Popover>
                            </div>
                            {hasSeries && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isGenerating}
                                onClick={() => handleGenerateTracking(idx, 'LOT')}
                                className="px-2 py-0.5 text-[11px] h-7 font-mono shrink-0 nf-btn-secondary"
                                title="Preview next Lot No. from series"
                              >
                                {isGenerating ? "…" : "Gen"}
                              </Button>
                            )}
                          </div>
                        ) : isSerial ? (
                          <div className="flex items-center gap-1.5 w-full">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                              SERIAL NS
                            </span>
                            {Math.round(Number(line.quantity || 1)) > 1 ? (
                              <div className="flex-1 min-w-0">
                                <Popover
                                  open={openSerialIdx === idx}
                                  onOpenChange={(open) => setOpenSerialIdx(open ? idx : null)}
                                  floating
                                  align="start"
                                  side="bottom"
                                  haspopup="dialog"
                                  className="w-full !block"
                                  panelClassName="nf-tracking-popover-panel"
                                  trigger={(triggerProps) => {
                                    const serials = line.serial_no
                                      ? line.serial_no.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean)
                                      : [];
                                    const targetQty = Math.round(Number(line.quantity || 1));
                                    return (
                                      <button
                                        {...triggerProps}
                                        className="flex items-center justify-between w-full h-8 px-2.5 py-1 text-xs rounded border text-left transition-all"
                                        style={{
                                          backgroundColor: "var(--input-bg)",
                                          borderColor: openSerialIdx === idx ? "var(--accent)" : "var(--input-border)",
                                          color: line.serial_no ? "var(--text-primary)" : "var(--text-muted)",
                                        }}
                                      >
                                        <span className="truncate font-mono text-xs">
                                          {serials.length === 0
                                            ? "Click Gen / Serials…"
                                            : `${serials.length} Serials: ${serials[0]}${serials.length > 1 ? ", …" : ""}`}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0 ml-1.5">
                                          {serials.length > 0 && (
                                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300">
                                              {serials.length}/{targetQty}
                                            </span>
                                          )}
                                          <ChevronDown
                                            className={`h-3.5 w-3.5 transition-transform ${openSerialIdx === idx ? "rotate-180" : ""}`}
                                          />
                                        </div>
                                      </button>
                                    );
                                  }}
                                >
                                  <SerialDropdownPanel
                                    targetQty={Math.max(1, Math.round(Number(line.quantity || 1)))}
                                    serialValue={line.serial_no}
                                    hasSeries={Boolean(hasSeries)}
                                    isGenerating={isGenerating}
                                    onGenerate={() => handleGenerateTracking(idx, 'SERIAL')}
                                    onChange={(val) => setLineField(idx, "serial_no", val)}
                                  />
                                </Popover>
                              </div>
                            ) : (
                              <div className="flex-1 min-w-0">
                                <input
                                  value={line.serial_no}
                                  onChange={(e) => setLineField(idx, "serial_no", e.target.value)}
                                  placeholder={hasSeries ? "Auto / Enter Serial No." : "Serial No."}
                                  className={`${inputCls} font-mono text-xs`}
                                  style={S.input}
                                />
                              </div>
                            )}
                            {hasSeries && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isGenerating}
                                onClick={() => handleGenerateTracking(idx, 'SERIAL')}
                                className="px-2 py-0.5 text-[11px] h-7 font-mono shrink-0 nf-btn-secondary"
                                title="Preview / Generate Serial No.(s) for quantity"
                              >
                                {isGenerating ? "…" : "Gen"}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs italic pl-2" style={S.muted}>
                            — Not Tracked —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-32">
                        <input
                          type="date"
                          value={line.expiry_date}
                          onChange={(e) => setLineField(idx, "expiry_date", e.target.value)}
                          className={inputCls}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <button
                          onClick={() => removeLine(idx)}
                          type="button"
                          className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)"
                          style={{ color: "var(--danger)" }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </div>
      </Dialog>

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
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">{t("grpColItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("grpColQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("grpColUom")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("grpColRate")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">Tracking (Lot / Serial)</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {(viewing.lines || []).map((l: Row) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.quantity}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.uom}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.rate ?? "—"}</TableCell>
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

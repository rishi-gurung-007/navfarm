"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  Search,
  Loader2,
  Inbox,
  Eye,
  CheckCircle2,
  Barcode,
  Calendar,
  Sparkles,
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useLanguage } from "@/hooks/useLanguage";
import { ReasonSelect } from "@/components/ui/reason-select";
import { LotSerialPicker } from "@/components/ui/lot-serial-picker";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { showToast } from "@/components/ui/toast";

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

export interface JournalLine {
  item_id: string;
  type: "POSITIVE" | "NEGATIVE";
  quantity: string | number;
  uom: string;
  rate: string | number;
  lot_no?: string;
  serial_no?: string;
  lot_mode?: "pick" | "new";
  maxQty?: number;
  remarks?: string;
}

const emptyDraftLine = (defaultType: "POSITIVE" | "NEGATIVE" = "POSITIVE"): JournalLine => ({
  item_id: "",
  type: defaultType,
  quantity: "",
  uom: "",
  rate: "",
  lot_no: "",
  serial_no: "",
  lot_mode: "pick",
  maxQty: undefined,
  remarks: "",
});

export default function StockAdjustmentPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);

  // Modal create state
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Header state
  const [header, setHeader] = useState<{
    warehouse_id: string;
    posting_date: string;
    transaction_type: "POSITIVE" | "NEGATIVE";
    reason: string;
    remarks: string;
  }>({
    warehouse_id: "",
    posting_date: new Date().toISOString().slice(0, 10),
    transaction_type: "POSITIVE",
    reason: "",
    remarks: "",
  });

  // Active Draft Line currently being entered in the "Line" input fields
  const [draftLine, setDraftLine] = useState<JournalLine>(emptyDraftLine("POSITIVE"));

  // Committed journal lines added to the table
  const [lines, setLines] = useState<JournalLine[]>([]);

  // Warehouse balances map: item_id -> { on_hand_qty, on_hand_value, avg_cost, uom }
  const [balances, setBalances] = useState<
    Record<string, { on_hand_qty: number; on_hand_value: number; avg_cost: number; uom: string }>
  >({});
  const [loadingBalances, setLoadingBalances] = useState(false);

  // Tracking modal dialog state
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingTarget, setTrackingTarget] = useState<
    | { mode: "draft" }
    | { mode: "line"; index: number }
    | null
  >(null);

  // View modal state
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
      const res = await api.get(`/stock-adjustment?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("sapFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/warehouse?${qs}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch balances for selected warehouse
  const loadWarehouseBalances = useCallback(
    async (warehouseId: string) => {
      if (!companyId || !warehouseId) {
        setBalances({});
        return;
      }
      setLoadingBalances(true);
      try {
        const res = await api.get(
          `/inventory-ledger/balance?companyId=${companyId}&warehouseId=${warehouseId}`
        );
        const arr = unwrap<any[]>(res) || [];
        const map: Record<string, { on_hand_qty: number; on_hand_value: number; avg_cost: number; uom: string }> = {};
        for (const b of arr) {
          if (b.item_id) {
            map[b.item_id] = {
              on_hand_qty: Number(b.on_hand_qty || 0),
              on_hand_value: Number(b.on_hand_value || 0),
              avg_cost: Number(b.avg_cost || 0),
              uom: b.uom || "",
            };
          }
        }
        setBalances(map);
      } catch (err) {
        console.error("Failed to fetch location stock balances:", err);
        setBalances({});
      } finally {
        setLoadingBalances(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    if (modalOpen && header.warehouse_id) {
      loadWarehouseBalances(header.warehouse_id);
    } else {
      setBalances({});
    }
  }, [modalOpen, header.warehouse_id, loadWarehouseBalances]);

  const openCreate = () => {
    setHeader({
      warehouse_id: "",
      posting_date: new Date().toISOString().slice(0, 10),
      transaction_type: "POSITIVE",
      reason: "",
      remarks: "",
    });
    setDraftLine(emptyDraftLine("POSITIVE"));
    setLines([]);
    setFormError("");
    setModalOpen(true);
  };

  // Change Item in draft line
  const handleDraftItemChange = (itemId: string) => {
    if (!itemId) {
      setDraftLine((prev) => ({
        ...prev,
        item_id: "",
        quantity: "",
        rate: "",
        uom: "",
        lot_no: "",
        serial_no: "",
        maxQty: undefined,
      }));
      return;
    }
    const it = items.find((i) => i.item_id === itemId);
    const bal = balances[itemId];
    const unitRate = bal?.avg_cost || (it?.standard_cost ? Number(it.standard_cost) : 0);
    const initialQty = it?.is_serial_tracked ? "1" : draftLine.quantity;

    setDraftLine((prev) => ({
      ...prev,
      item_id: itemId,
      uom: bal?.uom || it?.uom_primary || it?.uom || prev.uom,
      rate: unitRate > 0 ? String(unitRate) : prev.rate,
      lot_no: "",
      serial_no: "",
      maxQty: bal ? bal.on_hand_qty : undefined,
      quantity: initialQty,
    }));
  };

  // Add line to table
  const handleAddLine = () => {
    setFormError("");
    if (!draftLine.item_id) {
      setFormError("Please select an item before adding to journal lines.");
      return;
    }
    const qty = Number(draftLine.quantity);
    if (!qty || isNaN(qty) || qty <= 0) {
      setFormError("Quantity must be a positive number greater than 0.");
      return;
    }
    if (!draftLine.uom) {
      setFormError("UOM is required for this line item.");
      return;
    }
    const it = items.find((i) => i.item_id === draftLine.item_id);
    const isNegative = draftLine.type === "NEGATIVE";

    // Validate rate if positive
    if (!isNegative && (!draftLine.rate || Number(draftLine.rate) < 0)) {
      setFormError("Unit cost is required when performing a positive adjustment.");
      return;
    }

    // Validate lot tracking
    if (it?.is_lot_tracked) {
      if (isNegative && !draftLine.lot_no) {
        setFormError(`Lot number is required for negative adjustment of "${it.item_code} — ${it.item_name}". Click Item Tracking to assign lot.`);
        return;
      }
      if (isNegative && draftLine.maxQty !== undefined && qty > draftLine.maxQty) {
        setFormError(`Quantity (${qty}) exceeds available lot stock (${draftLine.maxQty}) for "${it.item_code}".`);
        return;
      }
      if (!isNegative && !draftLine.lot_no && !it.tracking_series_id) {
        setFormError(`Lot number is required for positive adjustment of "${it.item_code}". Click Item Tracking to assign lot.`);
        return;
      }
    }

    // Validate serial tracking
    if (it?.is_serial_tracked) {
      if (isNegative && !draftLine.serial_no) {
        setFormError(`Serial number is required for negative adjustment of "${it.item_code}". Click Item Tracking to assign serial.`);
        return;
      }
      if (!isNegative && !draftLine.serial_no && !it.tracking_series_id) {
        setFormError(`Serial number is required for positive adjustment of "${it.item_code}". Click Item Tracking to assign serial.`);
        return;
      }
    }

    // Commit line
    setLines((prev) => [...prev, { ...draftLine, quantity: qty, rate: Number(draftLine.rate || 0) }]);

    // Reset draft line (retain selected transaction type from header)
    setDraftLine(emptyDraftLine(header.transaction_type));
    showToast.success(`Added ${it?.item_code || "item"} to journal lines.`);
  };

  const handleRemoveLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  // Open Item Tracking dialog with validation toast
  const handleOpenTracking = (target: { mode: "draft" } | { mode: "line"; index: number }) => {
    const line = target.mode === "draft" ? draftLine : lines[target.index];
    if (!line || !line.item_id) {
      showToast.warn("Please select an item before opening Item Tracking.");
      return;
    }
    const it = items.find((i) => i.item_id === line.item_id);
    const isTracked = Boolean(it?.is_lot_tracked || it?.is_serial_tracked || line.lot_no || line.serial_no);

    if (!isTracked) {
      showToast.info(
        `Item Tracking is not active for item "${it?.item_code || line.item_id} — ${it?.item_name || ""}". This item is not configured for lot or serial tracking.`
      );
      return;
    }

    setTrackingTarget(target);
    setTrackingModalOpen(true);
  };

  // Active target for tracking modal
  const activeTrackingLine = useMemo(() => {
    if (!trackingTarget) return null;
    if (trackingTarget.mode === "draft") return draftLine;
    return lines[trackingTarget.index] || null;
  }, [trackingTarget, draftLine, lines]);

  const activeTrackingItem = useMemo(() => {
    if (!activeTrackingLine) return null;
    return items.find((i) => i.item_id === activeTrackingLine.item_id) || null;
  }, [activeTrackingLine, items]);

  const updateActiveTracking = (patch: Partial<JournalLine>) => {
    if (!trackingTarget) return;
    if (trackingTarget.mode === "draft") {
      setDraftLine((prev) => ({ ...prev, ...patch }));
    } else {
      setLines((prev) =>
        prev.map((l, i) => (i === trackingTarget.index ? { ...l, ...patch } : l))
      );
    }
  };

  const generateNumber = async (seriesId: string, field: "lot_no" | "serial_no") => {
    try {
      const res: any = await api.get(`/no-series/${seriesId}/next-number`);
      const val = res?.nextNumber || res?.data?.nextNumber || res;
      if (typeof val === "string") {
        updateActiveTracking({ [field]: val });
        showToast.success(`Generated ${field === "lot_no" ? "Lot" : "Serial"} #${val}`);
      }
    } catch (err: any) {
      console.error("Failed to generate tracking number:", err);
      showToast.warn("Could not auto-generate tracking number from number series.");
    }
  };

  // Save full journal
  const handleSave = async (autoPost = false) => {
    setSaving(true);
    setFormError("");
    try {
      if (!header.warehouse_id) throw new Error(t("sapWarehouseRequired") || "Warehouse/Location is required.");
      if (!header.posting_date) throw new Error(t("sapPostingDateRequired") || "Posting date is required.");

      // If user hasn't added draft line yet but filled it in, offer to add it or require at least 1 line
      let allLines = [...lines];
      if (allLines.length === 0 && draftLine.item_id && Number(draftLine.quantity) > 0) {
        allLines.push({
          ...draftLine,
          quantity: Number(draftLine.quantity),
          rate: Number(draftLine.rate || 0),
        });
      }

      if (allLines.length === 0) {
        throw new Error(t("sapAddAtLeastOneLine") || "Please add at least one line to the inventory journal.");
      }

      const cleanLines = allLines.map((l) => {
        const rawQty = Math.abs(Number(l.quantity));
        const signedQty = l.type === "NEGATIVE" ? -rawQty : rawQty;
        return {
          item_id: l.item_id,
          quantity: signedQty,
          uom: l.uom,
          rate: signedQty > 0 ? Number(l.rate || 0) : undefined,
          lot_no: l.lot_no || undefined,
          serial_no: l.serial_no || undefined,
          remarks: l.remarks || undefined,
        };
      });

      const res: any = await api.post("/stock-adjustment", {
        company_id: companyId,
        warehouse_id: header.warehouse_id,
        posting_date: header.posting_date,
        reason: header.reason || undefined,
        remarks: header.remarks ? `Type: ${header.transaction_type} | ${header.remarks}` : `Type: ${header.transaction_type}`,
        lines: cleanLines,
      });

      const created = unwrap<Row>(res);
      showToast.success(`Stock Adjustment ${created?.adjustment_no || ""} created successfully.`);

      if (autoPost && created?.adjustment_id) {
        await api.post(`/stock-adjustment/${created.adjustment_id}/post`, {});
        showToast.success(`Stock Adjustment ${created?.adjustment_no} posted to General Ledger & Inventory.`);
      }

      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("sapFailedToSave") || "Failed to save stock adjustment.");
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/stock-adjustment/${row.adjustment_id}`);
      setViewing(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("sapFailedToLoadDetails"));
    }
  };

  const handlePost = async () => {
    if (!viewing) return;
    setPosting(true);
    try {
      const res = await api.post(`/stock-adjustment/${viewing.adjustment_id}/post`, {});
      setViewing(unwrap<Row>(res));
      showToast.success(`Stock Adjustment ${viewing.adjustment_no} posted successfully.`);
      load();
    } catch (err: any) {
      setError(err?.message || t("sapFailedToPost"));
    } finally {
      setPosting(false);
    }
  };

  const warehouseLabel = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.warehouse_name || "—";
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? `${it.item_code} — ${it.item_name}` : "—";
  };

  // Searchable select options for items
  const itemOptions = useMemo(() => {
    return items.map((it) => {
      const bal = balances[it.item_id];
      const stockQty = bal ? bal.on_hand_qty : 0;
      return {
        value: it.item_id,
        item_id: it.item_id,
        item_code: it.item_code,
        item_name: it.item_name,
        stock_display: `${stockQty.toLocaleString()} ${bal?.uom || it.uom_primary || ""}`,
        label: `${it.item_code} — ${it.item_name}`, shortLabel: (it.item_name) ?? "",
      };
    });
  }, [items, balances]);

  // Current live balance for the item in draft line
  const draftLiveBalance = useMemo(() => {
    if (!draftLine.item_id) return null;
    return balances[draftLine.item_id] || null;
  }, [draftLine.item_id, balances]);

  // Total summary of lines
  const totalQtyPositive = lines
    .filter((l) => l.type === "POSITIVE")
    .reduce((sum, l) => sum + Number(l.quantity || 0), 0);

  const totalQtyNegative = lines
    .filter((l) => l.type === "NEGATIVE")
    .reduce((sum, l) => sum + Number(l.quantity || 0), 0);

  const totalEstimatedValue = lines.reduce((sum, l) => {
    const qty = Number(l.quantity || 0);
    const rate = Number(l.rate || 0);
    const val = qty * rate;
    return l.type === "POSITIVE" ? sum + val : sum - val;
  }, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Header & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("sapTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("sapDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="nf-input-sm px-2"
            style={S.input}
          >
            <option value="">{t("sapAllStatuses")}</option>
            <option value="DRAFT">{t("sapStatusDraft")}</option>
            <option value="POSTED">{t("sapStatusPosted")}</option>
            <option value="CANCELLED">{t("sapStatusCancelled")}</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sapSearchPlaceholder")}
              className="nf-input-sm pl-8 pr-3"
              style={S.input}
            />
          </div>
          <Button size="sm" onClick={openCreate} className="nf-btn-primary flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> {t("sapNewAdjustment") || "Create Inventory Journal"}
          </Button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {/* Adjustment Voucher Grid */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">{t("sapAdjustmentNo") || "Voucher #"}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapPostingDate") || "Date"}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapWarehouse") || "Location"}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapReason") || "Reason"}</TableHead>
                <TableHead className="text-right">{t("sapStatus") || "Status"}</TableHead>
                <TableHead className="text-right">{t("sapActions") || "Actions"}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell colSpan={6} className="py-10 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("sapLoading")}
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell colSpan={6} className="py-10 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("sapNoAdjustmentsYet")}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.adjustment_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>
                      {row.adjustment_no}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      {row.posting_date}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      {warehouseLabel(row.warehouse_id)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>
                      {row.reason || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => openView(row)}
                        title={t("sapView")}
                        className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)"
                        style={S.sub}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
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

      {/* CREATE INVENTORY JOURNAL MODAL (Styled after the uploaded screenshot) */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title="Create Inventory Journal"
        maxWidth="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs" style={S.muted}>
              {lines.length > 0 ? (
                <span>
                  <strong>{lines.length}</strong> line(s) added | Est. Net Impact:{" "}
                  <strong className={totalEstimatedValue >= 0 ? "text-emerald-500" : "text-rose-500"}>
                    ${totalEstimatedValue.toFixed(2)}
                  </strong>
                </span>
              ) : (
                <span>Add lines to complete the inventory journal.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="nf-btn-secondary"
              >
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => handleSave(false)}
                disabled={saving || (lines.length === 0 && !draftLine.item_id)}
                className="nf-btn-primary"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {formError && <InlineAlert>{formError}</InlineAlert>}

          {/* SECTION 1: HEADER (Gray bar title matching screenshot) */}
          <div className="rounded-[var(--radius-md)] border overflow-hidden" style={S.surface}>
            <div className="bg-(--surface-raised) px-4 py-2 border-b font-medium text-xs tracking-wide uppercase" style={S.sub}>
              Header
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Date * */}
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label flex items-center gap-1" style={S.sub}>
                  <Calendar className="h-3 w-3 text-(--accent)" />
                  Date <span className="text-(--danger)">*</span>
                </label>
                <input
                  type="date"
                  value={header.posting_date}
                  onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))}
                  className={inputCls}
                  style={S.input}
                />
              </div>

              {/* Transaction Ref * (Positive vs Negative) */}
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  Transaction Ref. <span className="text-(--danger)">*</span>
                </label>
                <select
                  value={header.transaction_type}
                  onChange={(e) => {
                    const val = e.target.value as "POSITIVE" | "NEGATIVE";
                    setHeader((h) => ({ ...h, transaction_type: val }));
                    setDraftLine((prev) => ({ ...prev, type: val }));
                  }}
                  className={`${inputCls} nf-select font-medium ${
                    header.transaction_type === "POSITIVE"
                      ? "text-emerald-500 font-semibold"
                      : "text-amber-500 font-semibold"
                  }`}
                  style={S.input}
                >
                  <option value="POSITIVE">Positive Adjustment (+)</option>
                  <option value="NEGATIVE">Negative Adjustment (-)</option>
                </select>
              </div>

              {/* Location * */}
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  Location <span className="text-(--danger)">*</span>
                </label>
                <SearchableSelect
                  options={warehouses}
                  value={header.warehouse_id}
                  valueKey="warehouse_id"
                  onChange={(wid) => {
                    setHeader((h) => ({ ...h, warehouse_id: wid }));
                    setDraftLine(emptyDraftLine(header.transaction_type));
                    setLines([]);
                  }}
                  placeholder="Select Location…"
                  searchPlaceholder="Search location…"
                  columnHeaders={["Code", "Location Name"]}
                  getLabelParts={(w: any) => [w.warehouse_code || "", w.warehouse_name || ""]}
                  getLabel={(w: any) => (w ? `${w.warehouse_code} — ${w.warehouse_name}` : "")}
                  triggerClassName="w-full"
                />
              </div>

              {/* Reason (Audit compliance) */}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="nf-text-label" style={S.sub}>
                  Reason
                </label>
                <ReasonSelect
                  ariaLabel="Adjustment Reason"
                  value={header.reason}
                  onChange={(val) => setHeader((h) => ({ ...h, reason: val }))}
                  onClear={() => setHeader((h) => ({ ...h, reason: "" }))}
                  placeholder="Select reason code (e.g. Physical Count Variance, Damage, Spoilage)…"
                  category="ADJUSTMENT"
                />
              </div>

              {/* Remarks */}
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>
                  Remarks / Notes
                </label>
                <input
                  type="text"
                  placeholder="Audit reference, count sheet #…"
                  value={header.remarks}
                  onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
                  className={inputCls}
                  style={S.input}
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: LINE ENTRY (Horizontal row layout matching screenshot) */}
          <div className="rounded-[var(--radius-md)] border overflow-hidden" style={S.surface}>
            <div className="bg-(--surface-raised) px-4 py-2 border-b flex items-center justify-between">
              <span className="font-medium text-xs tracking-wide uppercase" style={S.sub}>
                Line
              </span>
              {loadingBalances && (
                <span className="text-[11px] text-amber-500 flex items-center gap-1 font-mono">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading stock balances…
                </span>
              )}
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                {/* Item (Cols 4) */}
                <div className="sm:col-span-4 flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    Item
                  </label>
                  <SearchableSelect
                    ariaLabel="Select Item"
                    value={draftLine.item_id}
                    onChange={handleDraftItemChange}
                    options={itemOptions}
                    columns={[
                      { key: "item_code", label: "Item Code" },
                      { key: "item_name", label: "Description" },
                      { key: "stock_display", label: "Available Stock" },
                    ]}
                    columnHeaders={["Item Code", "Description", "Available Stock"]}
                    getLabel={(row: any) => (row.item_name ? `${row.item_name}` : "")}
                    placeholder={
                      !header.warehouse_id
                        ? "Select location first…"
                        : loadingBalances
                        ? "Loading balances…"
                        : "Select item…"
                    }
                    disabled={!header.warehouse_id || loadingBalances}
                  />
                </div>

                {/* UOM (Cols 2) */}
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    UOM
                  </label>
                  <select
                    value={draftLine.uom}
                    onChange={(e) => setDraftLine((l) => ({ ...l, uom: e.target.value }))}
                    className={`${inputCls} nf-select text-xs`}
                    style={S.input}
                    disabled={!draftLine.item_id}
                  >
                    <option value="">Select</option>
                    {uoms.map((u) => (
                      <option key={u.uom_code} value={u.uom_code}>
                        {u.uom_code}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Unit Cost (Cols 2) */}
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    Unit Cost
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={draftLine.rate}
                    onChange={(e) => setDraftLine((l) => ({ ...l, rate: e.target.value }))}
                    className={`${inputCls} font-mono text-xs`}
                    style={S.input}
                    disabled={!draftLine.item_id}
                  />
                </div>

                {/* Quantity (Cols 2) */}
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="nf-text-label flex items-center justify-between" style={S.sub}>
                    <span>Quantity</span>
                    <span className="text-[10px] font-semibold text-(--accent)">
                      {draftLine.type === "POSITIVE" ? "(+ In)" : "(- Out)"}
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    placeholder="0"
                    value={draftLine.quantity}
                    onChange={(e) => setDraftLine((l) => ({ ...l, quantity: e.target.value }))}
                    className={`${inputCls} font-mono text-xs`}
                    style={S.input}
                    disabled={!draftLine.item_id}
                  />
                </div>

                {/* Remaining Qty. (Cols 2) */}
                <div className="sm:col-span-2 flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>
                    Remaining Qty.
                  </label>
                  <div
                    className="flex h-9 items-center justify-between rounded-md border px-3 font-mono text-xs bg-(--surface-raised)"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className={draftLiveBalance && draftLiveBalance.on_hand_qty > 0 ? "text-emerald-500 font-bold" : "opacity-60"}>
                      {draftLiveBalance ? draftLiveBalance.on_hand_qty.toLocaleString() : "0"}
                    </span>
                    <span className="text-[10px]" style={S.muted}>
                      {draftLiveBalance?.uom || draftLine.uom || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tracking button & Add Line row */}
              <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <div>
                  {draftLine.item_id ? (
                    <button
                      type="button"
                      onClick={() => handleOpenTracking({ mode: "draft" })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-(--surface-raised) transition-colors"
                      style={S.surface}
                    >
                      <Barcode className="h-3.5 w-3.5 text-(--accent)" />
                      <span>Item Tracking Lines</span>
                      {draftLine.lot_no ? (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500 font-mono font-bold">
                          Lot: {draftLine.lot_no}
                        </span>
                      ) : draftLine.serial_no ? (
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-400 font-mono font-bold">
                          Serial: {draftLine.serial_no}
                        </span>
                      ) : (
                        <span className="text-[10px]" style={S.muted}>
                          (None assigned)
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="text-[11px]" style={S.muted}>
                      Select item to assign lot or serial tracking if active.
                    </span>
                  )}
                </div>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddLine}
                  disabled={!draftLine.item_id || !draftLine.quantity}
                  className="bg-(--primary) text-(--primary-foreground) hover:bg-(--primary)/90 font-semibold px-4 flex items-center gap-1.5 shadow-2xs"
                >
                  <Plus className="h-4 w-4" /> Add Line
                </Button>
              </div>
            </div>
          </div>

          {/* SECTION 3: ADDED JOURNAL LINES TABLE */}
          {lines.length > 0 && (
            <div className="rounded-[var(--radius-md)] border overflow-hidden" style={S.surface}>
              <div className="bg-(--surface-raised) px-4 py-2 border-b flex items-center justify-between">
                <span className="font-semibold text-xs tracking-wider uppercase" style={S.primary}>
                  Inventory Journal Lines ({lines.length})
                </span>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-emerald-500 font-semibold">+{totalQtyPositive} In</span>
                  <span className="text-amber-500 font-semibold">-{totalQtyNegative} Out</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      <TableHead className="px-3 py-2 w-10">#</TableHead>
                      <TableHead className="px-3 py-2">Item Code</TableHead>
                      <TableHead className="px-3 py-2">Item Description</TableHead>
                      <TableHead className="px-3 py-2 text-center">Type</TableHead>
                      <TableHead className="px-3 py-2 text-right">Quantity</TableHead>
                      <TableHead className="px-3 py-2">UOM</TableHead>
                      <TableHead className="px-3 py-2 text-right">Unit Cost</TableHead>
                      <TableHead className="px-3 py-2 text-right">Net Value</TableHead>
                      <TableHead className="px-3 py-2">Item Tracking</TableHead>
                      <TableHead className="px-3 py-2 text-right w-12">Action</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, idx) => {
                      const it = items.find((i) => i.item_id === l.item_id);
                      const isTracked = Boolean(it?.is_lot_tracked || it?.is_serial_tracked);
                      const lineVal = Number(l.quantity || 0) * Number(l.rate || 0);

                      return (
                        <TableRow key={idx} className="border-b border-(--row-border)">
                          <TableCell className="px-3 py-2 font-mono" style={S.muted}>
                            {idx + 1}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-mono font-medium" style={S.primary}>
                            {it?.item_code || l.item_id}
                          </TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>
                            {it?.item_name || "—"}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-center">
                            {l.type === "POSITIVE" ? (
                              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-500 border border-emerald-500/30">
                                <ArrowUpRight className="h-3 w-3" /> In (+)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/30">
                                <ArrowDownRight className="h-3 w-3" /> Out (-)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono font-bold" style={S.primary}>
                            {Number(l.quantity).toLocaleString()}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-mono" style={S.sub}>
                            {l.uom}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono" style={S.sub}>
                            ${Number(l.rate || 0).toFixed(2)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-mono font-bold" style={l.type === "POSITIVE" ? { color: "var(--success)" } : { color: "var(--danger)" }}>
                            {l.type === "POSITIVE" ? "+" : "-"}${lineVal.toFixed(2)}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleOpenTracking({ mode: "line", index: idx })}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-mono hover:bg-(--surface-raised) transition-colors"
                              style={S.surface}
                              title="Configure or view Lot/Serial Item Tracking"
                            >
                              <Barcode className="h-3 w-3 text-(--accent)" />
                              {l.lot_no ? (
                                <span className="text-amber-500 font-bold truncate max-w-[120px]">
                                  Lot: {l.lot_no}
                                </span>
                              ) : l.serial_no ? (
                                <span className="text-sky-400 font-bold truncate max-w-[120px]">
                                  Serial: {l.serial_no}
                                </span>
                              ) : isTracked ? (
                                <span className="text-amber-500 font-semibold">Assign</span>
                              ) : (
                                <span style={S.muted}>—</span>
                              )}
                            </button>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="rounded p-1 text-(--danger) hover:bg-(--danger-muted) transition-colors"
                              title="Remove Line"
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
          )}
        </div>
      </Dialog>

      {/* DEDICATED ITEM TRACKING MODAL DIALOG (Matching Transfer Order functionality) */}
      <Dialog
        open={trackingModalOpen}
        onClose={() => setTrackingModalOpen(false)}
        title="Item Tracking Lines Specification"
        maxWidth="lg"
        footer={
          <Button size="sm" onClick={() => setTrackingModalOpen(false)} className="nf-btn-primary">
            Done
          </Button>
        }
      >
        {activeTrackingLine && activeTrackingItem && (
          <div className="flex flex-col gap-4 text-xs">
            {/* Header info */}
            <div className="rounded-[var(--radius-md)] border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2" style={S.raised}>
              <div>
                <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Item</span>
                <span className="font-semibold text-(--text-primary)">{activeTrackingItem.item_code}</span>
                <p className="text-[11px] text-(--text-secondary) truncate">{activeTrackingItem.item_name}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Location</span>
                <span className="font-medium text-(--text-primary)">{warehouseLabel(header.warehouse_id)}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Adjustment Qty</span>
                <span className="font-semibold font-mono text-(--text-primary)">
                  {activeTrackingLine.quantity || 0} {activeTrackingLine.uom}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-(--text-muted) block">Tracking Mode</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                  <CheckCircle2 className="h-3 w-3" />
                  {activeTrackingItem.is_lot_tracked ? "Lot Tracking" : "Serial Tracking"}
                </span>
              </div>
            </div>

            {/* LOT TRACKING SECTION */}
            {activeTrackingItem.is_lot_tracked && (
              <div className="rounded-[var(--radius-md)] border p-4 flex flex-col gap-3" style={S.surface}>
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-(--text-primary)">
                    {activeTrackingLine.type === "NEGATIVE"
                      ? "Select Lot to Deduct From"
                      : "Assign Lot Number for Inbound Adjustment"}
                  </label>
                  {activeTrackingLine.type === "NEGATIVE" && (
                    <span className="text-[11px] text-amber-500 font-medium">
                      Picks from active batches at this location
                    </span>
                  )}
                </div>

                {activeTrackingLine.type === "NEGATIVE" ? (
                  <div className="flex flex-col gap-2">
                    <LotSerialPicker
                      itemId={activeTrackingLine.item_id}
                      warehouseId={header.warehouse_id}
                      trackingType="LOT"
                      value={activeTrackingLine.lot_no || ""}
                      fullWidth
                      targetQuantity={Number(activeTrackingLine.quantity) || undefined}
                      onChange={(val, opt: any) => {
                        updateActiveTracking({
                          lot_no: val,
                          maxQty: opt?.remaining_quantity ? Number(opt.remaining_quantity) : undefined,
                        });
                      }}
                      disabled={!header.warehouse_id}
                      placeholder="Select active lot from location…"
                    />
                    {activeTrackingLine.maxQty !== undefined && (
                      <div className="text-[11px] text-emerald-500 flex items-center justify-between">
                        <span>Available in selected lot:</span>
                        <strong className="font-mono">
                          {activeTrackingLine.maxQty.toLocaleString()} {activeTrackingLine.uom}
                        </strong>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={activeTrackingItem.tracking_series_id ? "Enter lot # or click Generate" : "Enter lot number…"}
                        value={activeTrackingLine.lot_no || ""}
                        onChange={(e) => updateActiveTracking({ lot_no: e.target.value })}
                        className={`${inputCls} font-mono flex-1`}
                        style={S.input}
                      />
                      {activeTrackingItem.tracking_series_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => generateNumber(activeTrackingItem.tracking_series_id, "lot_no")}
                          className="flex items-center gap-1 text-xs"
                        >
                          <Sparkles className="h-3 w-3 text-(--accent)" /> Gen Series
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SERIAL TRACKING SECTION */}
            {activeTrackingItem.is_serial_tracked && (
              <div className="rounded-[var(--radius-md)] border p-4 flex flex-col gap-3" style={S.surface}>
                <label className="font-semibold text-(--text-primary)">
                  {activeTrackingLine.type === "NEGATIVE" ? "Select Serial Number to Deduct" : "Enter Serial Number"}
                </label>

                {activeTrackingLine.type === "NEGATIVE" ? (
                  <LotSerialPicker
                    itemId={activeTrackingLine.item_id}
                    warehouseId={header.warehouse_id}
                    trackingType="SERIAL"
                    value={activeTrackingLine.serial_no || ""}
                    fullWidth
                    onChange={(val) => updateActiveTracking({ serial_no: val })}
                    disabled={!header.warehouse_id}
                    placeholder="Select serial number from location…"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder={activeTrackingItem.tracking_series_id ? "Enter serial or generate" : "Enter serial numbers…"}
                      value={activeTrackingLine.serial_no || ""}
                      onChange={(e) => updateActiveTracking({ serial_no: e.target.value })}
                      className={`${inputCls} font-mono flex-1`}
                      style={S.input}
                    />
                    {activeTrackingItem.tracking_series_id && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => generateNumber(activeTrackingItem.tracking_series_id, "serial_no")}
                        className="flex items-center gap-1 text-xs"
                      >
                        <Sparkles className="h-3 w-3 text-(--accent)" /> Gen Series
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* VIEW / POST MODAL */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `Stock Adjustment — ${viewing.adjustment_no}` : ""}
        maxWidth="xl"
        footer={
          viewing?.status === "DRAFT" ? (
            <Button size="sm" onClick={handlePost} disabled={posting} className="flex items-center gap-1.5 nf-btn-primary">
              <CheckCircle2 className="h-4 w-4" /> {posting ? t("sapPosting") : t("sapPost") || "Post to General Ledger"}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div>
                <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                  {t("sapStatus")}
                </p>
                <StatusBadge status={viewing.status} className="mt-1" />
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                  {t("sapPostingDate")}
                </p>
                <p style={S.primary}>{viewing.posting_date}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                  {t("sapWarehouse")}
                </p>
                <p style={S.primary}>{warehouseLabel(viewing.warehouse_id)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                  {t("sapReason")}
                </p>
                <p style={S.primary}>{viewing.reason || "—"}</p>
              </div>
              {viewing.posted_at && (
                <div>
                  <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                    {t("sapPostedAt")}
                  </p>
                  <p style={S.primary}>{viewing.posted_at}</p>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">{t("sapItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("sapQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("sapUom")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("sapRate")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">Lot No.</TableHead>
                    <TableHead className="h-auto px-3 py-2">Serial No.</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {(viewing.lines || []).map((l: Row) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="px-3 py-2 font-medium" style={S.primary}>
                        {itemLabel(l.item_id)}
                      </TableCell>
                      <TableCell
                        className="px-3 py-2 font-semibold font-mono"
                        style={Number(l.quantity) >= 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}
                      >
                        {Number(l.quantity) > 0 ? `+${l.quantity}` : l.quantity}
                      </TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>
                        {l.uom}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>
                        {l.rate ? `$${Number(l.rate).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>
                        {l.lot_no || "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>
                        {l.serial_no || "—"}
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

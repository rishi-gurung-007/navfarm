"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, CheckCircle2 } from "lucide-react";
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
import { Sparkles } from "lucide-react";

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
  lot_mode: "pick" as "pick" | "new",
  maxQty: undefined as number | undefined,
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

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [header, setHeader] = useState<Row>({ warehouse_id: "", posting_date: "", reason: "", remarks: "" });
  const [lines, setLines] = useState<Row[]>([emptyLine()]);

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

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
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

  const openCreate = () => {
    setHeader({ warehouse_id: "", posting_date: new Date().toISOString().slice(0, 10), reason: "", remarks: "" });
    setLines([emptyLine()]);
    setFormError("");
    setModalOpen(true);
  };

  const setLineField = (idx: number, key: string, value: any) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (key === "item_id") {
          const it = items.find((item) => item.item_id === value);
          return {
            ...l,
            item_id: value,
            uom: it?.uom_primary || it?.uom || l.uom,
            lot_no: "",
            serial_no: "",
            maxQty: undefined,
            quantity: it?.is_serial_tracked ? (Number(l.quantity) < 0 ? "-1" : "1") : l.quantity,
          };
        }
        return { ...l, [key]: value };
      })
    );
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!header.warehouse_id) throw new Error(t("sapWarehouseRequired"));
      if (!header.posting_date) throw new Error(t("sapPostingDateRequired"));
      const cleanLines = lines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => {
          const quantity = Number(l.quantity);
          const it = items.find((i) => i.item_id === l.item_id);
          if (quantity > 0 && !l.rate) {
            throw new Error(t("sapRateRequiredForPositive"));
          }
          if (it?.is_lot_tracked) {
            if (quantity < 0 && !l.lot_no) {
              throw new Error(`Lot number is required for negative adjustment of lot-tracked item "${it.item_code} — ${it.item_name}".`);
            }
            if (quantity < 0 && l.maxQty !== undefined && Math.abs(quantity) > l.maxQty) {
              throw new Error(`Quantity ${Math.abs(quantity)} exceeds available lot stock (${l.maxQty}).`);
            }
            if (quantity > 0 && !l.lot_no && !it.tracking_series_id) {
              throw new Error(`Lot number is required for positive adjustment of lot-tracked item "${it.item_code} — ${it.item_name}".`);
            }
          }
          if (it?.is_serial_tracked) {
            if (quantity < 0 && !l.serial_no) {
              throw new Error(`Serial number is required for negative adjustment of serial-tracked item "${it.item_code} — ${it.item_name}".`);
            }
            if (quantity > 0 && !l.serial_no && !it.tracking_series_id) {
              throw new Error(`Serial number is required for positive adjustment of serial-tracked item "${it.item_code} — ${it.item_name}".`);
            }
          }
          return {
            item_id: l.item_id,
            quantity,
            uom: l.uom,
            rate: quantity > 0 ? Number(l.rate) : undefined,
            lot_no: l.lot_no || undefined,
            serial_no: l.serial_no || undefined,
          };
        });
      if (cleanLines.length === 0) throw new Error(t("sapAddAtLeastOneLine"));

      await api.post("/stock-adjustment", {
        company_id: companyId,
        warehouse_id: header.warehouse_id,
        posting_date: header.posting_date,
        reason: header.reason || undefined,
        remarks: header.remarks || undefined,
        lines: cleanLines,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("sapFailedToSave"));
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
      load();
    } catch (err: any) {
      setError(err?.message || t("sapFailedToPost"));
    } finally {
      setPosting(false);
    }
  };

  const generateNumber = async (idx: number, seriesId: string, field: "lot_no" | "serial_no") => {
    try {
      const res: any = await api.get(`/no-series/${seriesId}/next-number`);
      const val = res?.nextNumber || res?.data?.nextNumber || res;
      if (typeof val === "string") {
        setLineField(idx, field, val);
      }
    } catch (err: any) {
      console.error("Failed to generate tracking number:", err);
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
          <h2 className="text-lg font-semibold" style={S.primary}>{t("sapTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("sapDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="nf-input-sm px-2" style={S.input}>
            <option value="">{t("sapAllStatuses")}</option>
            <option value="DRAFT">{t("sapStatusDraft")}</option>
            <option value="POSTED">{t("sapStatusPosted")}</option>
            <option value="CANCELLED">{t("sapStatusCancelled")}</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("sapSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("sapNewAdjustment")}
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
                <TableHead className="whitespace-nowrap">{t("sapAdjustmentNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapWarehouse")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("sapReason")}</TableHead>
                <TableHead className="text-right">{t("sapStatus")}</TableHead>
                <TableHead className="text-right">{t("sapActions")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("sapLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("sapNoAdjustmentsYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.adjustment_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.adjustment_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.posting_date}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{warehouseLabel(row.warehouse_id)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.reason || "—"}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <button onClick={() => openView(row)} title={t("sapView")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
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

      {/* Create modal */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={t("sapNewStockAdjustment")}
        maxWidth="xl"
        footer={
          <Button size="sm" onClick={handleSave} disabled={saving} className="nf-btn-primary">
            {saving ? t("sapSaving") : t("sapSaveDraft")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("sapWarehouse")} <span className="text-(--danger)">*</span></label>
              <select value={header.warehouse_id} onChange={(e) => setHeader((h) => ({ ...h, warehouse_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("sapSelectEllipsis")}</option>
                {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} — {w.warehouse_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("sapPostingDate")} <span className="text-(--danger)">*</span></label>
              <input type="date" value={header.posting_date} onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("sapReason")}</label>
              <ReasonSelect
                ariaLabel={t("sapReason")}
                value={header.reason}
                onChange={(val) => setHeader((h) => ({ ...h, reason: val }))}
                onClear={() => setHeader((h) => ({ ...h, reason: "" }))}
                placeholder={t("sapPhysicalCountVariance") || "Select adjustment reason…"}
                category="ADJUSTMENT"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("sapRemarks")}</label>
              <input value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} className={inputCls} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("sapLines")}</p>
            <button onClick={addLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("sapAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="h-auto px-3 py-2">{t("sapItem")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("sapQtySigned")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("sapUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("sapRateIfPositive")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">Lot / Serial</TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => {
                  const it = items.find((i) => i.item_id === line.item_id);
                  const trackingType = it?.is_lot_tracked ? "LOT" : it?.is_serial_tracked ? "SERIAL" : "NONE";
                  const isNegative = Number(line.quantity) < 0;

                  return (
                    <TableRow key={idx}>
                      <TableCell className="px-2 py-1.5 min-w-[180px]">
                        <select value={line.item_id} onChange={(e) => setLineField(idx, "item_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                          <option value="">{t("sapSelectEllipsis")}</option>
                          {items.map((itemRow) => <option key={itemRow.item_id} value={itemRow.item_id}>{itemRow.item_code} — {itemRow.item_name}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-28">
                        <input
                          type="number"
                          value={line.quantity}
                          onChange={(e) => setLineField(idx, "quantity", e.target.value)}
                          placeholder={t("sapQtyPlaceholder")}
                          className={inputCls}
                          style={S.input}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-28">
                        <select value={line.uom} onChange={(e) => setLineField(idx, "uom", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                          <option value="">{t("sapSelectEllipsis")}</option>
                          {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                        </select>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 w-24">
                        <input type="number" value={line.rate} onChange={(e) => setLineField(idx, "rate", e.target.value)} disabled={Number(line.quantity) <= 0} className={inputCls} style={S.input} />
                      </TableCell>
                      <TableCell className="px-2 py-1.5 min-w-[210px]">
                        {trackingType === "LOT" ? (
                          isNegative ? (
                            <div className="flex flex-col gap-0.5">
                              <LotSerialPicker
                                itemId={line.item_id}
                                warehouseId={header.warehouse_id}
                                trackingType="LOT"
                                value={line.lot_no}
                                onChange={(val, opt: any) => {
                                  setLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx
                                        ? {
                                            ...l,
                                            lot_no: val,
                                            maxQty: opt?.remaining_quantity ? Number(opt.remaining_quantity) : undefined,
                                          }
                                        : l
                                    )
                                  );
                                }}
                                disabled={!header.warehouse_id}
                                placeholder={!header.warehouse_id ? "Select warehouse first" : undefined}
                              />
                              {line.maxQty !== undefined && (
                                <span className="text-[10px]" style={S.muted}>Available: {line.maxQty}</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {line.lot_mode === "new" ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={line.lot_no}
                                    onChange={(e) => setLineField(idx, "lot_no", e.target.value)}
                                    placeholder={it?.tracking_series_id ? "Auto or enter lot" : "Enter lot…"}
                                    className={`${inputCls} flex-1 font-mono`}
                                    style={S.input}
                                  />
                                  {it?.tracking_series_id && (
                                    <button
                                      type="button"
                                      onClick={() => generateNumber(idx, it.tracking_series_id, "lot_no")}
                                      className="text-[10px] px-1.5 py-1 rounded border flex items-center gap-0.5 hover:bg-(--surface-raised)"
                                      style={S.surface}
                                      title="Generate Lot Number"
                                    >
                                      <Sparkles className="h-3 w-3" /> Gen
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setLineField(idx, "lot_mode", "pick")}
                                    className="text-[10px] px-1.5 py-1 rounded border whitespace-nowrap hover:bg-(--surface-raised)"
                                    style={S.surface}
                                    title="Pick existing lot to top up"
                                  >
                                    Pick
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <div className="flex-1">
                                    <LotSerialPicker
                                      itemId={line.item_id}
                                      warehouseId={header.warehouse_id}
                                      trackingType="LOT"
                                      value={line.lot_no}
                                      onChange={(val) => setLineField(idx, "lot_no", val)}
                                      disabled={!header.warehouse_id}
                                      placeholder="Pick existing lot…"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setLineField(idx, "lot_mode", "new")}
                                    className="text-[10px] px-1.5 py-1 rounded border whitespace-nowrap hover:bg-(--surface-raised)"
                                    style={S.surface}
                                    title="Enter new lot number"
                                  >
                                    + New
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        ) : trackingType === "SERIAL" ? (
                          isNegative ? (
                            <div className="flex flex-col gap-0.5">
                              <LotSerialPicker
                                itemId={line.item_id}
                                warehouseId={header.warehouse_id}
                                trackingType="SERIAL"
                                value={line.serial_no}
                                onChange={(val) => {
                                  setLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx
                                        ? { ...l, serial_no: val, quantity: "-1" }
                                        : l
                                    )
                                  );
                                }}
                                disabled={!header.warehouse_id}
                                placeholder={!header.warehouse_id ? "Select warehouse first" : undefined}
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={line.serial_no}
                                onChange={(e) => setLineField(idx, "serial_no", e.target.value)}
                                placeholder={it?.tracking_series_id ? "Auto or enter serial" : "Enter serial…"}
                                className={`${inputCls} flex-1 font-mono`}
                                style={S.input}
                              />
                              {it?.tracking_series_id && (
                                <button
                                  type="button"
                                  onClick={() => generateNumber(idx, it.tracking_series_id, "serial_no")}
                                  className="text-[10px] px-1.5 py-1 rounded border flex items-center gap-0.5 hover:bg-(--surface-raised)"
                                  style={S.surface}
                                  title="Generate Serial Number"
                                >
                                  <Sparkles className="h-3 w-3" /> Gen
                                </button>
                              )}
                            </div>
                          )
                        ) : (
                          <span className="px-2 text-xs" style={S.muted}>—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <button onClick={() => removeLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
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
        title={viewing ? t("sapStockAdjustmentTitle", { no: viewing.adjustment_no }) : ""}
        maxWidth="xl"
        footer={
          viewing?.status === "DRAFT" ? (
            <Button size="sm" onClick={handlePost} disabled={posting} className="flex items-center gap-1.5 nf-btn-primary">
              <CheckCircle2 className="h-4 w-4" /> {posting ? t("sapPosting") : t("sapPost")}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("sapStatus")}</p><StatusBadge status={viewing.status} className="mt-1" /></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("sapPostingDate")}</p><p style={S.primary}>{viewing.posting_date}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("sapWarehouse")}</p><p style={S.primary}>{warehouseLabel(viewing.warehouse_id)}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("sapReason")}</p><p style={S.primary}>{viewing.reason || "—"}</p></div>
              {viewing.posted_at && <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("sapPostedAt")}</p><p style={S.primary}>{viewing.posted_at}</p></div>}
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
                      <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                      <TableCell className="px-3 py-2 font-semibold" style={Number(l.quantity) >= 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}>{l.quantity}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.uom}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.rate ?? "—"}</TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>{l.lot_no || "—"}</TableCell>
                      <TableCell className="px-3 py-2 font-mono" style={S.primary}>{l.serial_no || "—"}</TableCell>
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
